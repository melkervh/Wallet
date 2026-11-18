/**
 * Modulo: models/savings.model.js
 *
 * Que hace: logica de negocio de ahorros: bolsillos de ahorro y aportes desde una cuenta.
 * Como lo hace: lecturas y escrituras con SQL propio dentro de transacciones; los aportes bloquean filas con
 *   FOR UPDATE para evitar saldos inconsistentes en operaciones simultaneas.
 * Datos que participan: tablas `bolsillos_ahorro`, `cuentas`, `transacciones`, `movimientos_cuenta` y
 *   `alertas_usuario`.
 * Consultas SQL: ver detalle en cada funcion.
 */

const { withTransaction } = require("../db");
const {
    HttpError,
    cleanText,
    createReference,
    toNumber,
    getAccounts,
    ensureWalletOperationAllowed,
    insertAlert
} = require("./base.model");

/**
 * Funcion: mapPocket
 *
 * Que hace: convierte una fila SQL del bolsillo de ahorro al formato que usa el frontend.
 * Como lo hace: renombra columnas y convierte meta y saldo a number.
 * Datos que participan: columnas de `bolsillos_ahorro` (id_bolsillo, nombre_bolsillo, meta_monto,
 *   saldo_actual, color_referencia, estado, cuenta_id).
 * Consultas SQL: ninguna.
 * Retorna: objeto bolsillo.
 */
function mapPocket(row) {
    return {
        id: row.id_bolsillo,
        nombre: row.nombre_bolsillo,
        metaMonto: toNumber(row.meta_monto),
        saldoActual: toNumber(row.saldo_actual),
        colorReferencia: row.color_referencia,
        estado: row.estado,
        cuentaId: row.cuenta_id
    };
}

/**
 * Funcion: getSavingsCenter
 *
 * Que hace: junta cuentas activas y bolsillos existentes para renderizar la seccion de ahorro.
 * Como lo hace: Promise.all entre getAccounts y la consulta de bolsillos; filtra las cuentas con estado
 *   'activa'.
 * Datos que participan: `userId` ($1).
 * Consultas SQL: SELECT id_bolsillo, nombre_bolsillo, meta_monto, saldo_actual, color_referencia, estado,
 *   cuenta_id FROM bolsillos_ahorro WHERE usuario_id = $1 ORDER BY creado_en ASC; mas la de
 *   account.dao.getAccounts.
 * Retorna: { accounts, pockets }.
 */
async function getSavingsCenter(userId) {
    const [accounts, pockets] = await Promise.all([
        getAccounts(userId),
        withTransaction(async (client) => {
            const result = await client.query(
                `
                SELECT
                    id_bolsillo,
                    nombre_bolsillo,
                    meta_monto,
                    saldo_actual,
                    color_referencia,
                    estado,
                    cuenta_id
                FROM bolsillos_ahorro
                WHERE usuario_id = $1
                ORDER BY creado_en ASC
                `,
                [userId]
            );

            return result.rows.map(mapPocket);
        })
    ]);

    return {
        accounts: accounts.filter((account) => account.estado === "activa"),
        pockets
    };
}

/**
 * Funcion: createSavingsPocket
 *
 * Que hace: crea un nuevo bolsillo de ahorro ligado a una cuenta del usuario.
 * Como lo hace: en una transaccion valida cuenta, nombre y meta, verifica que la cuenta sea del usuario,
 *   inserta el bolsillo con saldo 0 y deja una alerta para que el cambio se vea en la campana.
 * Datos que participan: `userId`, payload { accountId, name (max 80), goalAmount >= 0, color (por defecto
 *   #6f3df4) }.
 * Consultas SQL:
 *   1) SELECT id_cuenta, alias_cuenta FROM cuentas WHERE id_cuenta = $1 AND usuario_id = $2 LIMIT 1: la cuenta
 *      debe ser del usuario.
 *   2) INSERT INTO bolsillos_ahorro (usuario_id, cuenta_id, nombre_bolsillo, meta_monto, saldo_actual,
 *      color_referencia, estado) VALUES (..., 0, ..., 'activo').
 *   3) insertAlert.
 * Retorna: { message }. Errores 400/404.
 */
async function createSavingsPocket(userId, payload) {
    return withTransaction(async (client) => {
        const accountId = Number(payload.accountId);
        const pocketName = cleanText(payload.name, 80);
        const goalAmount = Number(payload.goalAmount || 0);

        if (!accountId) {
            throw new HttpError(400, "Selecciona la cuenta principal para crear tu ahorro.");
        }

        if (!pocketName) {
            throw new HttpError(400, "Ingresa un nombre para el bolsillo de ahorro.");
        }

        if (!Number.isFinite(goalAmount) || goalAmount < 0) {
            throw new HttpError(400, "Ingresa una meta valida para el ahorro.");
        }

        const accountResult = await client.query(
            `
            SELECT id_cuenta, alias_cuenta
            FROM cuentas
            WHERE id_cuenta = $1
              AND usuario_id = $2
            LIMIT 1
            `,
            [accountId, userId]
        );

        const account = accountResult.rows[0];
        if (!account) {
            throw new HttpError(404, "La cuenta seleccionada no existe.");
        }

        await client.query(
            `
            INSERT INTO bolsillos_ahorro (
                usuario_id,
                cuenta_id,
                nombre_bolsillo,
                meta_monto,
                saldo_actual,
                color_referencia,
                estado
            )
            VALUES ($1, $2, $3, $4, 0, $5, 'activo')
            `,
            [
                userId,
                accountId,
                pocketName,
                goalAmount,
                cleanText(payload.color, 20) || "#6f3df4"
            ]
        );

        await insertAlert(client, {
            userId,
            type: "sistema",
            title: "Nuevo bolsillo de ahorro",
            message: `Creaste un nuevo ahorro ligado a ${account.alias_cuenta}.`,
            level: "aceptacion"
        });

        return {
            message: "Bolsillo de ahorro creado correctamente."
        };
    });
}

/**
 * Funcion: depositIntoSavings
 *
 * Que hace: mueve dinero desde una cuenta activa hacia un bolsillo de ahorro.
 * Como lo hace: en una transaccion (toca cuenta, bolsillo, movimiento y alerta): primero verifica que la
 *   wallet no este congelada por mora, bloquea bolsillo y cuenta con FOR UPDATE, comprueba saldo suficiente,
 *   registra la transaccion, descuenta la cuenta, suma al bolsillo, escribe el movimiento contable y la alerta.
 * Datos que participan: `userId`, payload { pocketId, accountId, amount > 0 }.
 * Consultas SQL:
 *   1) ensureWalletOperationAllowed (adelanto vencido => 423).
 *   2) SELECT id_bolsillo, nombre_bolsillo, saldo_actual FROM bolsillos_ahorro WHERE id_bolsillo = $1 AND
 *      usuario_id = $2 AND estado = 'activo' LIMIT 1 FOR UPDATE.
 *   3) SELECT id_cuenta, alias_cuenta, saldo_disponible, saldo_contable FROM cuentas WHERE id_cuenta = $1 AND
 *      usuario_id = $2 AND estado = 'activa' LIMIT 1 FOR UPDATE.
 *   4) INSERT INTO transacciones (tipo 'ahorro', estado 'completada', canal 'web', referencia AHO-...) RETURNING
 *      id_transaccion.
 *   5) UPDATE cuentas SET saldo_disponible, saldo_contable (restan el monto).
 *   6) UPDATE bolsillos_ahorro SET saldo_actual (suma el monto).
 *   7) INSERT INTO movimientos_cuenta (tipo 'debito', monto, saldo_resultante).
 *   8) insertAlert.
 * Retorna: { message }. Errores 400 (datos o saldo insuficiente), 404 y 423.
 */
async function depositIntoSavings(userId, payload) {
    return withTransaction(async (client) => {
        await ensureWalletOperationAllowed(userId, client);

        const pocketId = Number(payload.pocketId);
        const accountId = Number(payload.accountId);
        const amount = Number(payload.amount);

        if (!pocketId || !accountId || !Number.isFinite(amount) || amount <= 0) {
            throw new HttpError(400, "Completa la cuenta, el bolsillo y el monto del ahorro.");
        }

        const pocketResult = await client.query(
            `
            SELECT
                id_bolsillo,
                nombre_bolsillo,
                saldo_actual
            FROM bolsillos_ahorro
            WHERE id_bolsillo = $1
              AND usuario_id = $2
              AND estado = 'activo'
            LIMIT 1
            FOR UPDATE
            `,
            [pocketId, userId]
        );

        const pocket = pocketResult.rows[0];
        if (!pocket) {
            throw new HttpError(404, "El bolsillo de ahorro no existe o no esta activo.");
        }

        const accountResult = await client.query(
            `
            SELECT
                id_cuenta,
                alias_cuenta,
                saldo_disponible,
                saldo_contable
            FROM cuentas
            WHERE id_cuenta = $1
              AND usuario_id = $2
              AND estado = 'activa'
            LIMIT 1
            FOR UPDATE
            `,
            [accountId, userId]
        );

        const account = accountResult.rows[0];
        if (!account) {
            throw new HttpError(404, "La cuenta seleccionada no esta disponible.");
        }

        if (amount > toNumber(account.saldo_disponible)) {
            throw new HttpError(400, "No tienes saldo suficiente para mover ese monto a ahorro.");
        }

        const transaction = await client.query(
            `
            INSERT INTO transacciones (
                usuario_id,
                tipo,
                estado,
                canal,
                concepto,
                referencia_interna,
                monto_total,
                fecha_ejecucion,
                observaciones
            )
            VALUES ($1, 'ahorro', 'completada', 'web', $2, $3, $4, NOW(), $5)
            RETURNING id_transaccion
            `,
            [
                userId,
                `Aporte al ahorro ${pocket.nombre_bolsillo}`,
                createReference("AHO"),
                amount,
                `Transferencia interna a bolsillo de ahorro`
            ]
        );

        const saldoDisponible = toNumber(account.saldo_disponible) - amount;
        const saldoContable = toNumber(account.saldo_contable) - amount;
        const nuevoSaldoAhorro = toNumber(pocket.saldo_actual) + amount;

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
            UPDATE bolsillos_ahorro
            SET
                saldo_actual = $1,
                actualizado_en = NOW()
            WHERE id_bolsillo = $2
            `,
            [nuevoSaldoAhorro, pocketId]
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
                `Aporte al ahorro ${pocket.nombre_bolsillo}`,
                saldoDisponible
            ]
        );

        await insertAlert(client, {
            userId,
            type: "sistema",
            title: "Ahorro actualizado",
            message: `Moviste ${amount.toFixed(2)} USD a tu bolsillo ${pocket.nombre_bolsillo}.`,
            level: "aceptacion"
        });

        return {
            message: "Tu ahorro se actualizo correctamente."
        };
    });
}

module.exports = {
    getSavingsCenter,
    createSavingsPocket,
    depositIntoSavings
};
