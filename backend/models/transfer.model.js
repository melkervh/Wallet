/**
 * Modulo: models/transfer.model.js
 *
 * Que hace: logica de negocio de transferencias y beneficiarios: preparar el formulario, administrar favoritos
 *   y ejecutar o programar envios, incluyendo el abono espejo cuando el destino es otra wallet interna.
 * Como lo hace: cada escritura corre en UNA transaccion; la cuenta origen (y la destino interna en envios
 *   inmediatos) se bloquea con FOR UPDATE para evitar carreras de saldo. Las lecturas reutilizan los DAOs via
 *   base.model.
 * Datos que participan: tablas `cuentas`, `beneficiarios`, `transacciones`, `movimientos_cuenta`, `usuarios`
 *   (datos del titular destino) y `alertas_usuario`.
 * Consultas SQL: ver detalle en cada funcion.
 */

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

/**
 * Funcion: stripBeneficiaryMeta
 *
 * Que hace: limpia metadatos internos del beneficiario antes de devolverlo al frontend.
 * Como lo hace: desestructura el objeto y descarta existedBefore y favoriteAddedNow.
 * Datos que participan: `beneficiary` (resultado de insertOrUpdateBeneficiary).
 * Consultas SQL: ninguna.
 * Retorna: beneficiario publico.
 */
function stripBeneficiaryMeta(beneficiary) {
    const { existedBefore, favoriteAddedNow, ...publicBeneficiary } = beneficiary || {};
    return publicBeneficiary;
}

/**
 * Funcion: getTransferMetadata
 *
 * Que hace: prepara cuentas, favoritos y resumen operativo previo al formulario de transferencias.
 * Como lo hace: Promise.all con tres lecturas de los DAOs y calcula en memoria totales (saldo disponible,
 *   cuentas activas, favoritos activos).
 * Datos que participan: `userId`.
 * Consultas SQL: no escribe SQL a mano; usa getAccounts (cuentas), getFavoriteBeneficiaries (beneficiarios,
 *   20) y getOperationSnapshot (resumen mensual y ultima transferencia sobre transacciones).
 * Retorna: { accounts, favoriteBeneficiaries, summary }.
 */
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

/**
 * Funcion: createBeneficiary
 *
 * Que hace: crea o actualiza un beneficiario y, si aplica, lo marca como favorito.
 * Como lo hace: en una transaccion llama a insertOrUpdateBeneficiary (por defecto saveFavorite = true) y, si
 *   el favorito se agrego en este momento, deja una alerta.
 * Datos que participan: `userId`, payload del beneficiario.
 * Consultas SQL: UPSERT en beneficiarios (INSERT ... ON CONFLICT (usuario_id, numero_cuenta_destino) DO
 *   UPDATE) via beneficiary.dao, y insertAlert.
 * Retorna: beneficiario publico.
 */
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

/**
 * Funcion: removeFavoriteBeneficiary
 *
 * Que hace: saca un beneficiario de favoritos sin eliminar su registro base.
 * Como lo hace: valida el id, hace un UPDATE que solo apaga es_favorito (el beneficiario se conserva para
 *   historial) y deja una alerta.
 * Datos que participan: `userId`, `beneficiaryId`.
 * Consultas SQL: UPDATE beneficiarios SET es_favorito = FALSE, actualizado_en = NOW() WHERE id_beneficiario =
 *   $1 AND usuario_id = $2 AND activo = TRUE AND es_favorito = TRUE RETURNING columnas del beneficiario: si no
 *   devuelve fila, ya no era favorito o no es del usuario (404).
 * Retorna: beneficiario publico.
 */
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

/**
 * Funcion: mapBeneficiaryRow
 *
 * Que hace: traduce la fila SQL usada al quitar favoritos al formato publico del beneficiario.
 * Como lo hace: renombra columnas y usa el nombre como alias si no hay alias.
 * Datos que participan: fila de `beneficiarios`.
 * Consultas SQL: ninguna.
 * Retorna: objeto beneficiario.
 */
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

/**
 * Funcion: mapInternalWalletBeneficiary
 *
 * Que hace: convierte una cuenta wallet interna en un destinatario publico temporal, sin guardarlo como
 *   favorito.
 * Como lo hace: arma el nombre desde nombres y apellidos del titular (o el alias de la cuenta) y fija
 *   tipoDestino 'wallet' y banco 'Wallet Digital'.
 * Datos que participan: fila de cuentas unida a usuarios (getInternalDestinationAccount).
 * Consultas SQL: ninguna.
 * Retorna: objeto beneficiario (id null).
 */
function mapInternalWalletBeneficiary(accountRow) {
    const ownerName = cleanText(`${accountRow.nombres || ""} ${accountRow.apellidos || ""}`, 120) || accountRow.alias_cuenta;

    return {
        id: null,
        nombre: ownerName,
        alias: accountRow.alias_cuenta,
        bancoDestino: accountRow.banco_destino || "Wallet Digital",
        numeroCuentaDestino: accountRow.numero_cuenta,
        tipoDestino: "wallet",
        correoNotificacion: accountRow.correo || "",
        telefonoNotificacion: accountRow.telefono || "",
        esFavorito: false,
        activo: true
    };
}

/**
 * Funcion: getInternalDestinationAccount
 *
 * Que hace: busca si el numero de cuenta destino pertenece a una wallet interna.
 * Como lo hace: SELECT por numero de cuenta; con options.lockRow bloquea la fila (FOR UPDATE) cuando la
 *   transferencia es inmediata para evitar carreras de saldo al acreditar.
 * Datos que participan: `client`, `destinationAccountNumber` (max 34), `options.lockRow`.
 * Consultas SQL: SELECT c.id_cuenta, c.usuario_id, c.alias_cuenta, c.numero_cuenta, c.saldo_disponible,
 *   c.saldo_contable, c.estado, u.nombres, u.apellidos, u.correo, u.telefono FROM cuentas c JOIN usuarios u ON
 *   u.id_usuario = c.usuario_id WHERE c.numero_cuenta = $1 LIMIT 1 [FOR UPDATE]: el JOIN trae los datos del
 *   titular para notificar y nombrar al destinatario.
 * Retorna: fila o null.
 */
async function getInternalDestinationAccount(client, destinationAccountNumber, options = {}) {
    const numeroCuenta = cleanText(destinationAccountNumber, 34);
    if (!numeroCuenta) {
        return null;
    }

    const shouldLock = Boolean(options.lockRow);
    const result = await client.query(
        `
        SELECT
            c.id_cuenta,
            c.usuario_id,
            c.alias_cuenta,
            c.numero_cuenta,
            c.saldo_disponible,
            c.saldo_contable,
            c.estado,
            u.nombres,
            u.apellidos,
            u.correo,
            u.telefono
        FROM cuentas c
        JOIN usuarios u
            ON u.id_usuario = c.usuario_id
        WHERE c.numero_cuenta = $1
        LIMIT 1
        ${shouldLock ? "FOR UPDATE" : ""}
        `,
        [numeroCuenta]
    );

    return result.rows[0] || null;
}

/**
 * Funcion: createRecipientMirrorTransaction
 *
 * Que hace: registra la contraparte de una transferencia interna como abono en la cuenta destino, para que el
 *   receptor vea saldo e historial.
 * Como lo hace: inserta una transaccion 'deposito' a nombre del receptor ligada a la referencia del emisor,
 *   suma el monto a la cuenta destino, escribe el movimiento 'credito' y, si el receptor es otro usuario, le
 *   deja una alerta.
 * Datos que participan: `client`, { destinationAccount, sourceAccount, senderUserId, amount, concept,
 *   senderReference }.
 * Consultas SQL:
 *   1) INSERT INTO transacciones (tipo 'deposito', estado 'completada', referencia REC-..., referencia_externa =
 *      referencia del emisor) RETURNING id_transaccion, referencia_interna.
 *   2) UPDATE cuentas SET saldo_disponible, saldo_contable WHERE id_cuenta = $3.
 *   3) INSERT INTO movimientos_cuenta (tipo 'credito', saldo_resultante).
 *   4) insertAlert al receptor.
 * Retorna: { transactionId, balance }.
 */
async function createRecipientMirrorTransaction(client, {
    destinationAccount,
    sourceAccount,
    senderUserId,
    amount,
    concept,
    senderReference
}) {
    const senderName = cleanText(sourceAccount.sender_name || sourceAccount.alias_cuenta, 120) || sourceAccount.alias_cuenta;
    const destinationBalance = toNumber(destinationAccount.saldo_disponible) + amount;
    const destinationAccountingBalance = toNumber(destinationAccount.saldo_contable) + amount;

    const recipientTransaction = await client.query(
        `
        INSERT INTO transacciones (
            usuario_id,
            tipo,
            estado,
            canal,
            concepto,
            referencia_interna,
            referencia_externa,
            monto_total,
            fecha_ejecucion,
            observaciones
        )
        VALUES ($1, 'deposito', 'completada', 'web', $2, $3, $4, $5, NOW(), $6)
        RETURNING id_transaccion, referencia_interna
        `,
        [
            destinationAccount.usuario_id,
            `Transferencia recibida - ${concept}`,
            createReference("REC"),
            senderReference,
            amount,
            `Ingreso recibido desde ${senderName}`
        ]
    );

    await client.query(
        `
        UPDATE cuentas
        SET
            saldo_disponible = $1,
            saldo_contable = $2,
            actualizado_en = NOW()
        WHERE id_cuenta = $3
        `,
        [destinationBalance, destinationAccountingBalance, destinationAccount.id_cuenta]
    );

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
        VALUES ($1, $2, 'credito', $3, $4, $5)
        `,
        [
            recipientTransaction.rows[0].id_transaccion,
            destinationAccount.id_cuenta,
            amount,
            `${sourceAccount.alias_cuenta} -> ${destinationAccount.alias_cuenta}`,
            destinationBalance
        ]
    );

    if (destinationAccount.usuario_id !== senderUserId) {
        await insertAlert(client, {
            userId: destinationAccount.usuario_id,
            type: "transferencia",
            title: "Transferencia recibida",
            message: `Recibiste ${amount.toFixed(2)} USD en ${destinationAccount.alias_cuenta}. Ref: ${senderReference}.`,
            level: "aceptacion"
        });
    }

    return {
        transactionId: recipientTransaction.rows[0].id_transaccion,
        balance: destinationBalance
    };
}

/**
 * Funcion: createTransfer
 *
 * Que hace: ejecuta o programa una transferencia validando cuenta, saldo, fechas y beneficiario.
 * Como lo hace: en una transaccion: verifica que la wallet no este congelada, valida datos, bloquea la cuenta
 *   origen, comprueba saldo (inmediata) o fecha futura (programada), detecta si el destino es una wallet
 *   interna, crea o reutiliza el beneficiario, inserta la transaccion y, si es inmediata, descuenta el origen,
 *   registra el debito y acredita el espejo al destino interno. Cierra con alertas.
 * Datos que participan: `userId`, payload { sourceAccountId, amount, concept, transferType ('inmediata' |
 *   'programada'), scheduledDate, destinationAccount, beneficiaryId, saveFavorite, internalReference,
 *   externalReference, notes, ... }.
 * Consultas SQL:
 *   1) SELECT ... FROM cuentas WHERE id_cuenta = $1 AND usuario_id = $2 FOR UPDATE: bloquea la cuenta origen.
 *   2) getInternalDestinationAccount: detecta wallet destino.
 *   3) insertOrUpdateBeneficiary: INSERT ... ON CONFLICT DO UPDATE sobre beneficiarios.
 *   4) INSERT INTO transacciones (tipo 'transferencia', estado 'completada' o 'programada') RETURNING
 *      id_transaccion, referencia_interna: el error 23505 (clave unica) se traduce a 'La referencia interna ya
 *      existe'.
 *   5) UPDATE cuentas SET saldo_disponible, saldo_contable (descuento del origen, solo inmediata).
 *   6) INSERT INTO movimientos_cuenta (tipo 'debito', saldo_resultante).
 *   7) createRecipientMirrorTransaction si el destino es interno.
 *   8) insertAlert (transferencia y favorito agregado).
 * Retorna: { message, transfer: { id, referencia, estado, monto, beneficiario, saldoDisponibleActual, fecha }
 *   }.
 */
async function createTransfer(userId, payload) {
    return withTransaction(async (client) => {
        await ensureWalletOperationAllowed(userId, client);

        const sourceAccountId = Number(payload.sourceAccountId);
        const amount = Number(payload.amount);
        const transferMode = payload.transferType === "programada" ? "programada" : "inmediata";
        const concept = cleanText(payload.concept, 200);
        const internalReference = cleanText(payload.internalReference, 60) || createReference("TRX");
        const destinationAccountNumber = cleanText(payload.destinationAccount, 34);

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

        // SELECT SQL:
        // Aqui detecto si el numero destino pertenece a otra wallet de la misma base.
        // Si existe, mas abajo acredito el dinero tambien en esa cuenta.
        let internalDestination = await getInternalDestinationAccount(client, destinationAccountNumber, {
            lockRow: transferMode === "inmediata"
        });

        if (internalDestination && Number(internalDestination.id_cuenta) === sourceAccountId) {
            throw new HttpError(400, "No puedes transferir dinero hacia la misma cuenta de origen.");
        }

        if (internalDestination && internalDestination.estado !== "activa") {
            throw new HttpError(400, "La cuenta wallet destino existe, pero no esta activa.");
        }

        // INSERT o UPDATE SQL indirecto:
        // Aqui creo o reutilizo el beneficiario destino antes de insertar la transferencia.
        let beneficiary = null;
        let publicBeneficiary = null;

        if (payload.beneficiaryId) {
            beneficiary = await insertOrUpdateBeneficiary(client, userId, payload);
            publicBeneficiary = stripBeneficiaryMeta(beneficiary);
        } else if (internalDestination && payload.saveFavorite) {
            beneficiary = await insertOrUpdateBeneficiary(client, userId, {
                ...payload,
                recipientName: cleanText(payload.recipientName, 120)
                    || cleanText(`${internalDestination.nombres || ""} ${internalDestination.apellidos || ""}`, 120)
                    || internalDestination.alias_cuenta,
                destinationBank: cleanText(payload.destinationBank, 120) || "Wallet Digital",
                destinationAccount: internalDestination.numero_cuenta,
                destinationType: "wallet",
                notificationEmail: internalDestination.correo || "",
                notificationPhone: internalDestination.telefono || "",
                saveFavorite: true
            });
            publicBeneficiary = stripBeneficiaryMeta(beneficiary);
        } else if (internalDestination) {
            publicBeneficiary = mapInternalWalletBeneficiary(internalDestination);
        } else {
            beneficiary = await insertOrUpdateBeneficiary(client, userId, payload);
            publicBeneficiary = stripBeneficiaryMeta(beneficiary);
        }

        // SELECT SQL:
        // Si la transferencia llega solo con beneficiaryId, aqui reutilizo el numero ya
        // guardado en ese beneficiario para detectar igualmente una cuenta wallet interna.
        if (!internalDestination && publicBeneficiary?.numeroCuentaDestino) {
            internalDestination = await getInternalDestinationAccount(client, publicBeneficiary.numeroCuentaDestino, {
                lockRow: transferMode === "inmediata"
            });

            if (internalDestination && Number(internalDestination.id_cuenta) === sourceAccountId) {
                throw new HttpError(400, "No puedes transferir dinero hacia la misma cuenta de origen.");
            }

            if (internalDestination && internalDestination.estado !== "activa") {
                throw new HttpError(400, "La cuenta wallet destino existe, pero no esta activa.");
            }
        }

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
                    beneficiary?.id || null,
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
                    `${sourceAccount.alias_cuenta} -> ${(publicBeneficiary?.nombre || publicBeneficiary?.alias || "Destino wallet")}`,
                    saldoResultante
                ]
            );

            // UPDATE + INSERT SQL:
            // Si la cuenta destino tambien vive en la wallet, aqui creo el abono espejo.
            // Esto hace que la transferencia se refleje en cuentas secundarias propias
            // y tambien en cuentas principales de otros usuarios.
            if (internalDestination) {
                await createRecipientMirrorTransaction(client, {
                    destinationAccount: internalDestination,
                    sourceAccount: {
                        alias_cuenta: sourceAccount.alias_cuenta,
                        sender_name: sourceAccount.alias_cuenta
                    },
                    senderUserId: userId,
                    amount,
                    concept,
                    senderReference: transaction.referencia_interna
                });
            }
        }

        await insertAlert(client, {
            userId,
            type: "transferencia",
            title: transferMode === "programada" ? "Transferencia programada" : "Transferencia completada",
            message: transferMode === "programada"
                ? `Se programo un envio de ${amount.toFixed(2)} USD para ${(publicBeneficiary?.nombre || publicBeneficiary?.alias || "el destinatario")}. Ref: ${transaction.referencia_interna}.`
                : `Se envio ${amount.toFixed(2)} USD a ${(publicBeneficiary?.nombre || publicBeneficiary?.alias || "el destinatario")}. Ref: ${transaction.referencia_interna}.`,
            level: "aceptacion"
        });

        if (beneficiary?.favoriteAddedNow) {
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
