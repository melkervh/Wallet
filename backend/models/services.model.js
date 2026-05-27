const { withTransaction } = require("../db");
const {
    HttpError,
    cleanText,
    createReference,
    toNumber,
    getAccounts,
    getPayments,
    getServiceProviderCatalog,
    getActiveSalaryAdvance,
    ensureWalletOperationAllowed,
    insertAlert
} = require("./base.model");

// Funcion: mapLinkedService
// Aqui convierto el servicio vinculado al formato listo para la interfaz.
function mapLinkedService(row) {
    return {
        id: row.id_servicio_usuario,
        aliasServicio: row.alias_servicio,
        identificadorCliente: row.identificador_cliente,
        activo: Boolean(row.activo),
        proveedor: row.proveedor_nombre,
        categoria: row.categoria,
        cuentaAlias: row.alias_cuenta,
        proveedorId: row.proveedor_id,
        cuentaId: row.cuenta_cargo_id
    };
}

// Funcion: getLinkedServices
// Aqui traigo los servicios que el usuario ya dejo configurados para pago rapido.
async function getLinkedServices(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            su.id_servicio_usuario,
            su.alias_servicio,
            su.identificador_cliente,
            su.activo,
            su.proveedor_id,
            su.cuenta_cargo_id,
            ps.nombre AS proveedor_nombre,
            ps.categoria,
            c.alias_cuenta
        FROM servicios_usuario su
        JOIN proveedores_servicio ps
            ON ps.id_proveedor = su.proveedor_id
        JOIN cuentas c
            ON c.id_cuenta = su.cuenta_cargo_id
        WHERE su.usuario_id = $1
        ORDER BY su.actualizado_en DESC, su.creado_en DESC
        `,
        [userId]
    );

    return result.rows.map(mapLinkedService);
}

// Funcion: getServicesCenter
// Aqui preparo proveedores, cuentas, servicios vinculados y el estado del adelanto para el centro de pagos.
async function getServicesCenter(userId) {
    const [accounts, providers, linkedServices, scheduledPayments, currentAdvance] = await Promise.all([
        getAccounts(userId),
        getServiceProviderCatalog(),
        getLinkedServices(userId),
        getPayments(userId, 12),
        getActiveSalaryAdvance(userId)
    ]);

    return {
        accounts: accounts.filter((account) => account.estado === "activa"),
        providers,
        linkedServices,
        scheduledPayments: scheduledPayments.filter((payment) => payment.categoria !== "suscripcion" || payment.activo),
        salaryAdvancePayment: currentAdvance
            ? {
                enabled: true,
                currentAdvance
            }
            : null,
        walletFrozen: Boolean(currentAdvance?.operacionesCongeladas)
    };
}

// Funcion: linkService
// Aqui guardo la relacion entre un proveedor, el contrato del usuario y la cuenta de cargo.
// Si ya existe, la reactivo o actualizo para no duplicar registros inutilmente.
async function linkService(userId, payload) {
    return withTransaction(async (client) => {
        // En esta seccion vinculo un servicio real del usuario
        // para que despues pueda pagarlo sin volver a escribir
        // el contrato ni la cuenta de cargo.
        const providerId = Number(payload.providerId);
        const accountId = Number(payload.accountId);
        const customerIdentifier = cleanText(payload.customerIdentifier || payload.serviceIdentifier, 80);

        if (!providerId || !accountId) {
            throw new HttpError(400, "Selecciona el proveedor y la cuenta de cargo.");
        }

        if (!customerIdentifier) {
            throw new HttpError(400, "Ingresa el numero de contrato o cliente del servicio.");
        }

        const providerResult = await client.query(
            `
            SELECT id_proveedor, nombre, categoria
            FROM proveedores_servicio
            WHERE id_proveedor = $1
              AND activo = TRUE
            LIMIT 1
            `,
            [providerId]
        );

        const provider = providerResult.rows[0];
        if (!provider) {
            throw new HttpError(404, "El proveedor seleccionado no esta disponible.");
        }

        const accountResult = await client.query(
            `
            SELECT id_cuenta, alias_cuenta
            FROM cuentas
            WHERE id_cuenta = $1
              AND usuario_id = $2
              AND estado = 'activa'
            LIMIT 1
            `,
            [accountId, userId]
        );

        const account = accountResult.rows[0];
        if (!account) {
            throw new HttpError(404, "La cuenta de cargo no existe o no esta activa.");
        }

        await client.query(
            `
            INSERT INTO servicios_usuario (
                usuario_id,
                proveedor_id,
                alias_servicio,
                identificador_cliente,
                cuenta_cargo_id,
                activo
            )
            VALUES ($1, $2, $3, $4, $5, TRUE)
            ON CONFLICT (usuario_id, proveedor_id, identificador_cliente)
            DO UPDATE SET
                alias_servicio = EXCLUDED.alias_servicio,
                cuenta_cargo_id = EXCLUDED.cuenta_cargo_id,
                activo = TRUE,
                actualizado_en = NOW()
            `,
            [
                userId,
                providerId,
                cleanText(payload.alias, 90) || provider.nombre,
                customerIdentifier,
                accountId
            ]
        );

        await insertAlert(client, {
            userId,
            type: "servicio",
            title: "Servicio vinculado",
            message: `Se vinculo ${provider.nombre} a la cuenta ${account.alias_cuenta}.`,
            level: "aceptacion"
        });

        return {
            message: "Servicio vinculado correctamente."
        };
    });
}

// Funcion: paySalaryAdvanceFromServices
// Aqui permito pagar el adelanto desde el mismo centro de pagos.
// Si el adelanto esta vencido, esta es la unica operacion monetaria que dejo pasar hasta normalizar la cuenta.
async function paySalaryAdvanceFromServices(userId, payload, client, account) {
    const amount = Number(payload.amount);
    const currentAdvance = await ensureWalletOperationAllowed(userId, client, {
        allowAdvancePayment: true
    });

    if (!currentAdvance) {
        throw new HttpError(404, "No hay un adelanto salarial pendiente para pagar.");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, "Ingresa un monto valido para pagar el adelanto.");
    }

    if (amount > currentAdvance.saldoPendiente) {
        throw new HttpError(400, "El monto supera el saldo pendiente del adelanto.");
    }

    if (amount > toNumber(account.saldo_disponible)) {
        throw new HttpError(400, "Tu saldo disponible no alcanza para pagar el adelanto.");
    }

    const minimumOverduePayment = Math.min(currentAdvance.cuotaDescuento, currentAdvance.saldoPendiente);
    if (currentAdvance.estado === "vencido" && amount < minimumOverduePayment) {
        throw new HttpError(
            400,
            `Como el adelanto esta vencido, debes pagar al menos ${minimumOverduePayment.toFixed(2)} USD.`
        );
    }

    const transaction = await client.query(
        `
        INSERT INTO transacciones (
            usuario_id,
            adelanto_id,
            tipo,
            estado,
            canal,
            concepto,
            referencia_interna,
            monto_total,
            fecha_ejecucion,
            observaciones
        )
        VALUES ($1, $2, 'pago_servicio', 'completada', 'web', $3, $4, $5, NOW(), $6)
        RETURNING id_transaccion, referencia_interna
        `,
        [
            userId,
            currentAdvance.id,
            cleanText(payload.concept, 200) || `Pago de adelanto salarial ${currentAdvance.numeroAdelanto}`,
            createReference("PAD"),
            amount,
            `Pago aplicado al adelanto ${currentAdvance.numeroAdelanto}`
        ]
    );

    const saldoDisponible = toNumber(account.saldo_disponible) - amount;
    const saldoContable = toNumber(account.saldo_contable) - amount;
    const saldoPendienteRestante = Number((currentAdvance.saldoPendiente - amount).toFixed(2));
    const nextAdvanceState = saldoPendienteRestante <= 0
        ? "pagado"
        : currentAdvance.estado === "vencido"
            ? "vencido"
            : "activo";

    await client.query(
        `
        UPDATE cuentas
        SET
            saldo_disponible = $1,
            saldo_contable = $2,
            actualizado_en = NOW()
        WHERE id_cuenta = $3
        `,
        [saldoDisponible, saldoContable, account.id_cuenta]
    );

    await client.query(
        `
        UPDATE adelantos_salariales
        SET
            estado = $1,
            actualizado_en = NOW()
        WHERE id_adelanto = $2
        `,
        [nextAdvanceState, currentAdvance.id]
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
        VALUES ($1, $2, 'debito', $3, $4, $5)
        `,
        [
            transaction.rows[0].id_transaccion,
            account.id_cuenta,
            amount,
            `Pago de adelanto salarial ${currentAdvance.numeroAdelanto}`,
            saldoDisponible
        ]
    );

    await insertAlert(client, {
        userId,
        type: "adelanto",
        title: saldoPendienteRestante <= 0 ? "Adelanto liquidado" : "Pago de adelanto aplicado",
        message: saldoPendienteRestante <= 0
            ? `Terminaste de pagar el adelanto ${currentAdvance.numeroAdelanto}. Tu wallet vuelve a operar con normalidad.`
            : `Pagaste ${amount.toFixed(2)} USD al adelanto ${currentAdvance.numeroAdelanto}. Saldo pendiente: ${saldoPendienteRestante.toFixed(2)} USD.`,
        level: "aceptacion"
    });

    return {
        message: saldoPendienteRestante <= 0
            ? "Adelanto pagado por completo."
            : "Pago de adelanto aplicado correctamente."
    };
}

// Funcion: payService
// Aqui ejecuto el pago de un servicio o, si el formulario lo pide, el pago del adelanto salarial.
// Valido saldo, proveedor y cuenta, luego registro transaccion, movimiento y alerta.
async function payService(userId, payload) {
    return withTransaction(async (client) => {
        const amount = Number(payload.amount);
        const linkedServiceId = payload.linkedServiceId ? Number(payload.linkedServiceId) : null;
        const providerId = payload.providerId ? Number(payload.providerId) : null;
        const accountId = Number(payload.accountId);
        const paymentTarget = cleanText(payload.paymentTarget, 40).toLowerCase() || "servicio";
        const customerIdentifier = cleanText(payload.customerIdentifier || payload.serviceIdentifier, 80);

        if (!accountId) {
            throw new HttpError(400, "Selecciona la cuenta desde la que haras el pago.");
        }

        const accountResult = await client.query(
            `
            SELECT id_cuenta, alias_cuenta, saldo_disponible, saldo_contable
            FROM cuentas
            WHERE id_cuenta = $1
              AND usuario_id = $2
              AND estado = 'activa'
            FOR UPDATE
            `,
            [accountId, userId]
        );

        const account = accountResult.rows[0];
        if (!account) {
            throw new HttpError(404, "La cuenta de cargo no esta disponible.");
        }

        if (paymentTarget === "adelanto_salarial") {
            return paySalaryAdvanceFromServices(userId, payload, client, account);
        }

        await ensureWalletOperationAllowed(userId, client);

        if (!linkedServiceId && !providerId) {
            throw new HttpError(400, "Selecciona la cuenta y el servicio que deseas pagar.");
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            throw new HttpError(400, "Ingresa un monto valido para el pago.");
        }

        if (amount > toNumber(account.saldo_disponible)) {
            throw new HttpError(400, "Tu saldo disponible no alcanza para pagar este servicio.");
        }

        let provider;
        let linkedService = null;

        if (linkedServiceId) {
            const linkedResult = await client.query(
                `
                SELECT
                    su.id_servicio_usuario,
                    su.alias_servicio,
                    su.identificador_cliente,
                    ps.id_proveedor,
                    ps.nombre,
                    ps.categoria
                FROM servicios_usuario su
                JOIN proveedores_servicio ps
                    ON ps.id_proveedor = su.proveedor_id
                WHERE su.id_servicio_usuario = $1
                  AND su.usuario_id = $2
                  AND su.activo = TRUE
                LIMIT 1
                `,
                [linkedServiceId, userId]
            );

            linkedService = linkedResult.rows[0];
            if (!linkedService) {
                throw new HttpError(404, "El servicio vinculado seleccionado ya no existe.");
            }

            provider = linkedService;
        } else {
            const providerResult = await client.query(
                `
                SELECT id_proveedor, nombre, categoria
                FROM proveedores_servicio
                WHERE id_proveedor = $1
                  AND activo = TRUE
                LIMIT 1
                `,
                [providerId]
            );

            provider = providerResult.rows[0];
            if (!provider) {
                throw new HttpError(404, "El proveedor seleccionado ya no esta disponible.");
            }

            if (!customerIdentifier) {
                throw new HttpError(400, "Ingresa el numero de contrato o cliente del servicio.");
            }
        }

        const transaction = await client.query(
            `
            INSERT INTO transacciones (
                usuario_id,
                proveedor_servicio_id,
                tipo,
                estado,
                canal,
                concepto,
                referencia_interna,
                monto_total,
                fecha_ejecucion,
                observaciones
            )
            VALUES ($1, $2, 'pago_servicio', 'completada', 'web', $3, $4, $5, NOW(), $6)
            RETURNING id_transaccion, referencia_interna
            `,
            [
                userId,
                provider.id_proveedor,
                cleanText(payload.concept, 200) || `Pago de ${provider.nombre}`,
                createReference("SERV"),
                amount,
                linkedService
                    ? `Contrato ${linkedService.identificador_cliente}`
                    : customerIdentifier || null
            ]
        );

        const saldoDisponible = toNumber(account.saldo_disponible) - amount;
        const saldoContable = toNumber(account.saldo_contable) - amount;

        await client.query(
            `
            UPDATE cuentas
            SET
                saldo_disponible = $1,
                saldo_contable = $2,
                actualizado_en = NOW()
            WHERE id_cuenta = $3
            `,
            [saldoDisponible, saldoContable, accountId]
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
            VALUES ($1, $2, 'debito', $3, $4, $5)
            `,
            [
                transaction.rows[0].id_transaccion,
                accountId,
                amount,
                `Pago de servicio ${provider.nombre}`,
                saldoDisponible
            ]
        );

        await insertAlert(client, {
            userId,
            type: "servicio",
            title: "Pago de servicio completado",
            message: `Pagaste ${provider.nombre} por ${amount.toFixed(2)} USD. Ref: ${transaction.rows[0].referencia_interna}.`,
            level: "aceptacion"
        });

        return {
            message: "Pago de servicio realizado correctamente."
        };
    });
}

module.exports = {
    getServicesCenter,
    linkService,
    payService
};
