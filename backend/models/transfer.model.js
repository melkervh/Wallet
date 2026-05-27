const { withTransaction } = require("../db");
const {
    HttpError,
    createReference,
    cleanText,
    toNumber,
    formatDate,
    insertAlert,
    getAccounts,
    getFavoriteBeneficiaries,
    getOperationSnapshot,
    ensureWalletOperationAllowed,
    insertOrUpdateBeneficiary
} = require("./base.model");

// Funcion: stripBeneficiaryMeta
// Aqui limpio metadatos internos del beneficiario antes de devolverlo al frontend.
function stripBeneficiaryMeta(beneficiary) {
    const { existedBefore, favoriteAddedNow, ...publicBeneficiary } = beneficiary || {};
    return publicBeneficiary;
}

// Funcion: getTransferMetadata
// Aqui preparo las cuentas, favoritos y resumen operativo previo al formulario de transferencias.
async function getTransferMetadata(userId) {
    // Lectura SQL indirecta:
    // Aqui no escribo consultas a mano en este bloque porque reutilizo helpers de base.model.js.
    // Esos helpers si hacen SELECT reales sobre cuentas, beneficiarios y transacciones.
    const [accounts, favorites, snapshot] = await Promise.all([
        getAccounts(userId),
        getFavoriteBeneficiaries(userId, 20),
        getOperationSnapshot(userId)
    ]);

    const totalDisponible = accounts.reduce((sum, account) => sum + account.saldoDisponible, 0);

    return {
        accounts,
        favoriteBeneficiaries: favorites.filter((beneficiary) => beneficiary.esFavorito),
        summary: {
            cuentasActivas: accounts.filter((account) => account.estado === "activa").length,
            favoritosActivos: favorites.filter((beneficiary) => beneficiary.esFavorito && beneficiary.activo).length,
            saldoDisponibleTotal: totalDisponible,
            transferenciasMes: snapshot.transferenciasMes,
            operacionesProgramadas: snapshot.operacionesProgramadas,
            ultimaTransferencia: snapshot.ultimaTransferencia
        }
    };
}

// Funcion: createBeneficiary
// Aqui creo o actualizo un beneficiario y, si aplica, lo marco como favorito.
async function createBeneficiary(userId, payload) {
    return withTransaction(async (client) => {
        // INSERT o UPDATE SQL indirecto:
        // insertOrUpdateBeneficiary() decide si crea un nuevo beneficiario
        // o si actualiza uno existente en la tabla beneficiarios.
        const beneficiary = await insertOrUpdateBeneficiary(client, userId, {
            ...payload,
            saveFavorite: payload.saveFavorite !== false
        });

        if (beneficiary.favoriteAddedNow) {
            await insertAlert(client, {
                userId,
                type: "favoritos",
                title: "Favorito agregado",
                message: `Se agrego a ${beneficiary.nombre} a tus favoritos para futuros envios.`,
                level: "informativo"
            });
        }

        return stripBeneficiaryMeta(beneficiary);
    });
}

// Funcion: removeFavoriteBeneficiary
// Aqui saco un beneficiario de favoritos sin eliminar por completo su registro base.
async function removeFavoriteBeneficiary(userId, beneficiaryId) {
    return withTransaction(async (client) => {
        const favoriteId = Number(beneficiaryId);
        if (!favoriteId || Number.isNaN(favoriteId)) {
            throw new HttpError(400, "Selecciona un favorito valido.");
        }

        // UPDATE SQL:
        // Aqui no borro el beneficiario. Solo cambio es_favorito a FALSE
        // dentro de la tabla beneficiarios.
        const result = await client.query(
            `
            UPDATE beneficiarios
            SET
                es_favorito = FALSE,
                actualizado_en = NOW()
            WHERE id_beneficiario = $1
              AND usuario_id = $2
              AND activo = TRUE
              AND es_favorito = TRUE
            RETURNING
                id_beneficiario,
                nombre_beneficiario,
                alias_beneficiario,
                banco_destino,
                numero_cuenta_destino,
                tipo_destino,
                correo_notificacion,
                telefono_notificacion,
                es_favorito,
                activo
            `,
            [favoriteId, userId]
        );

        const beneficiary = result.rows[0];
        if (!beneficiary) {
            throw new HttpError(404, "El favorito seleccionado ya no esta disponible.");
        }

        await insertAlert(client, {
            userId,
            type: "favoritos",
            title: "Favorito eliminado",
            message: `Quitaste a ${beneficiary.nombre_beneficiario} de tu lista de favoritos.`,
            level: "informativo"
        });

        return stripBeneficiaryMeta(mapBeneficiaryRow(beneficiary));
    });
}

// Funcion: mapBeneficiaryRow
// Aqui traduzco la fila SQL usada al quitar favoritos al formato publico del beneficiario.
function mapBeneficiaryRow(row) {
    return {
        id: row.id_beneficiario,
        nombre: row.nombre_beneficiario,
        alias: row.alias_beneficiario || row.nombre_beneficiario,
        bancoDestino: row.banco_destino,
        numeroCuentaDestino: row.numero_cuenta_destino,
        tipoDestino: row.tipo_destino,
        correoNotificacion: row.correo_notificacion,
        telefonoNotificacion: row.telefono_notificacion,
        esFavorito: Boolean(row.es_favorito),
        activo: Boolean(row.activo)
    };
}

// Funcion: createTransfer
// Aqui ejecuto o programo una transferencia validando cuenta, saldo, fechas y beneficiario.
// Tambien actualizo saldo, movimiento y alertas dentro de la misma transaccion.
async function createTransfer(userId, payload) {
    return withTransaction(async (client) => {
        await ensureWalletOperationAllowed(userId, client);

        const sourceAccountId = Number(payload.sourceAccountId);
        const amount = Number(payload.amount);
        const transferMode = payload.transferType === "programada" ? "programada" : "inmediata";
        const concept = cleanText(payload.concept, 200);
        const internalReference = cleanText(payload.internalReference, 60) || createReference("TRX");

        if (!sourceAccountId || Number.isNaN(sourceAccountId)) {
            throw new HttpError(400, "Selecciona una cuenta de origen valida.");
        }

        if (!amount || Number.isNaN(amount) || amount <= 0) {
            throw new HttpError(400, "Ingresa un monto valido mayor a cero.");
        }

        if (!concept) {
            throw new HttpError(400, "Ingresa un concepto para la transferencia.");
        }

        // SELECT SQL:
        // Aqui leo y bloqueo la cuenta origen con FOR UPDATE para que el saldo
        // no cambie a mitad de la transferencia.
        const accountResult = await client.query(
            `
            SELECT
                id_cuenta,
                alias_cuenta,
                numero_cuenta,
                saldo_disponible,
                saldo_contable,
                limite_diario,
                estado
            FROM cuentas
            WHERE id_cuenta = $1
              AND usuario_id = $2
            FOR UPDATE
            `,
            [sourceAccountId, userId]
        );

        const sourceAccount = accountResult.rows[0];
        if (!sourceAccount) {
            throw new HttpError(404, "La cuenta de origen no existe.");
        }

        if (sourceAccount.estado !== "activa") {
            throw new HttpError(400, "La cuenta de origen no esta activa.");
        }

        if (transferMode === "inmediata" && amount > toNumber(sourceAccount.saldo_disponible)) {
            throw new HttpError(400, "Saldo insuficiente para completar la transferencia.");
        }

        let scheduledDate = null;
        if (transferMode === "programada") {
            if (!payload.scheduledDate) {
                throw new HttpError(400, "Debes indicar una fecha para programar la transferencia.");
            }

            scheduledDate = new Date(`${payload.scheduledDate}T12:00:00`);
            if (Number.isNaN(scheduledDate.getTime())) {
                throw new HttpError(400, "La fecha programada no es valida.");
            }

            if (scheduledDate <= new Date()) {
                throw new HttpError(400, "La fecha programada debe ser futura.");
            }
        }

        // INSERT o UPDATE SQL indirecto:
        // Aqui creo o reutilizo el beneficiario destino antes de insertar la transferencia.
        const beneficiary = await insertOrUpdateBeneficiary(client, userId, payload);
        const publicBeneficiary = stripBeneficiaryMeta(beneficiary);
        const transactionStatus = transferMode === "programada" ? "programada" : "completada";

        let transactionResult;
        try {
            // INSERT SQL:
            // Aqui registro la transferencia en la tabla transacciones.
            transactionResult = await client.query(
                `
                INSERT INTO transacciones (
                    usuario_id,
                    beneficiario_id,
                    tipo,
                    estado,
                    canal,
                    concepto,
                    referencia_interna,
                    referencia_externa,
                    monto_total,
                    fecha_programada,
                    fecha_ejecucion,
                    observaciones
                )
                VALUES ($1, $2, 'transferencia', $3, 'web', $4, $5, $6, $7, $8, $9, $10)
                RETURNING id_transaccion, referencia_interna, fecha_ejecucion, fecha_programada
                `,
                [
                    userId,
                    beneficiary.id,
                    transactionStatus,
                    concept,
                    internalReference,
                    cleanText(payload.externalReference, 60) || null,
                    amount,
                    transferMode === "programada" ? scheduledDate : null,
                    transferMode === "inmediata" ? new Date() : null,
                    cleanText(payload.notes, 400) || null
                ]
            );
        } catch (error) {
            if (error.code === "23505") {
                throw new HttpError(400, "La referencia interna ya existe. Usa otra referencia.");
            }

            throw error;
        }

        const transaction = transactionResult.rows[0];
        let saldoResultante = toNumber(sourceAccount.saldo_disponible);

        if (transferMode === "inmediata") {
            saldoResultante -= amount;
            const saldoContable = toNumber(sourceAccount.saldo_contable) - amount;

            // UPDATE SQL:
            // Aqui descuento el saldo de la cuenta origen.
            await client.query(
                `
                UPDATE cuentas
                SET
                    saldo_disponible = $1,
                    saldo_contable = $2,
                    actualizado_en = NOW()
                WHERE id_cuenta = $3
                `,
                [saldoResultante, saldoContable, sourceAccountId]
            );

            // INSERT SQL:
            // Aqui guardo el movimiento contable que deja rastro del debito.
            await client.query(
                `
                INSERT INTO movimientos_cuenta (
                    transaccion_id,
                    cuenta_id,
                    tipo_movimiento,
                    monto,
                    descripcion,
                    saldo_resultante
                )
                VALUES ($1, $2, 'debito', $3, $4, $5)
                `,
                [
                    transaction.id_transaccion,
                    sourceAccountId,
                    amount,
                    `${sourceAccount.alias_cuenta} -> ${beneficiary.nombre}`,
                    saldoResultante
                ]
            );
        }

        await insertAlert(client, {
            userId,
            type: "transferencia",
            title: transferMode === "programada" ? "Transferencia programada" : "Transferencia completada",
            message: transferMode === "programada"
                ? `Se programo un envio de ${amount.toFixed(2)} USD para ${beneficiary.nombre}. Ref: ${transaction.referencia_interna}.`
                : `Se envio ${amount.toFixed(2)} USD a ${beneficiary.nombre}. Ref: ${transaction.referencia_interna}.`,
            level: "aceptacion"
        });

        if (beneficiary.favoriteAddedNow) {
            await insertAlert(client, {
                userId,
                type: "favoritos",
                title: "Favorito agregado",
                message: `Se agrego a ${beneficiary.nombre} a tus favoritos desde la operacion actual.`,
                level: "informativo"
            });
        }

        return {
            message: transferMode === "programada"
                ? "Transferencia programada correctamente."
                : "Transferencia realizada correctamente.",
            transfer: {
                id: transaction.id_transaccion,
                referencia: transaction.referencia_interna,
                estado: transactionStatus,
                monto: amount,
                beneficiario: publicBeneficiary,
                saldoDisponibleActual: saldoResultante,
                fecha: formatDate(transaction.fecha_ejecucion || transaction.fecha_programada || new Date())
            }
        };
    });
}

module.exports = {
    getTransferMetadata,
    createBeneficiary,
    removeFavoriteBeneficiary,
    createTransfer
};
