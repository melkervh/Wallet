/**
 * Modulo: dao/account.dao.js
 *
 * Que hace: acceso a datos de cuentas wallet, tarjetas vinculadas y pagos programados.
 * Como lo hace: SELECT parametrizados que aceptan un `executor` opcional (pool o client).
 * Datos que participan: tablas `cuentas`, `tarjetas` y `pagos_programados`.
 */

const { query } = require("../db");
const { mapAccount, mapCard, mapPayment } = require("./mappers");

/**
 * Funcion: getAccounts
 *
 * Que hace: trae todas las cuentas del usuario privilegiando la principal.
 * Como lo hace: SELECT ordenado y mapeado con mapAccount.
 * Datos que participan: `userId` ($1).
 * Consulta SQL: SELECT de saldos (disponible, retenido, contable), limite diario y estado
 *               FROM cuentas WHERE usuario_id = $1
 *               ORDER BY es_principal DESC (la principal primero), creado_en ASC (luego por
 *               antiguedad).
 * Retorna: arreglo de cuentas.
 */
async function getAccounts(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_cuenta,
            numero_cuenta,
            alias_cuenta,
            tipo_cuenta,
            moneda,
            saldo_disponible,
            saldo_retenido,
            saldo_contable,
            limite_diario,
            bono_bienvenida_aplicado,
            es_principal,
            estado
        FROM cuentas
        WHERE usuario_id = $1
        ORDER BY es_principal DESC, creado_en ASC
        `,
        [userId]
    );

    return result.rows.map(mapAccount);
}

/**
 * Funcion: getCards
 *
 * Que hace: trae las tarjetas vinculadas del usuario junto con el alias de su cuenta.
 * Como lo hace: JOIN tarjetas-cuentas y filtro por el dueno de la cuenta, mapeado con mapCard.
 * Datos que participan: `userId` ($1).
 * Consulta SQL: SELECT de `tarjetas` (alias t) JOIN `cuentas` (alias c) ON c.id_cuenta =
 *               t.cuenta_id. La tarjeta no guarda usuario_id, por eso el filtro es
 *               c.usuario_id = $1. ORDER BY t.creado_en ASC.
 * Retorna: arreglo de tarjetas.
 */
async function getCards(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            t.id_tarjeta,
            t.alias_tarjeta,
            t.marca,
            t.tipo_tarjeta,
            t.ultimos_4,
            t.titular,
            t.limite_diario,
            t.estado,
            t.vence_mes,
            t.vence_anio,
            c.alias_cuenta
        FROM tarjetas t
        JOIN cuentas c
            ON c.id_cuenta = t.cuenta_id
        WHERE c.usuario_id = $1
        ORDER BY t.creado_en ASC
        `,
        [userId]
    );

    return result.rows.map(mapCard);
}

/**
 * Funcion: getPayments
 *
 * Que hace: recupera los pagos programados activos ordenados por proximidad.
 * Como lo hace: SELECT filtrado por usuario y activo, con tope `limit`, mapeado con mapPayment.
 * Datos que participan: `userId` ($1), `limit` ($2, por defecto 10).
 * Consulta SQL: SELECT FROM pagos_programados WHERE usuario_id = $1 AND activo = TRUE
 *               ORDER BY proxima_ejecucion ASC (el mas cercano primero) LIMIT $2.
 * Retorna: arreglo de pagos programados.
 */
async function getPayments(userId, limit = 10, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_pago_programado,
            nombre_servicio,
            categoria,
            frecuencia,
            monto,
            dia_ejecucion,
            proxima_ejecucion,
            activo,
            referencia
        FROM pagos_programados
        WHERE usuario_id = $1
          AND activo = TRUE
        ORDER BY proxima_ejecucion ASC
        LIMIT $2
        `,
        [userId, limit]
    );

    return result.rows.map(mapPayment);
}

module.exports = {
    getAccounts,
    getCards,
    getPayments
};
