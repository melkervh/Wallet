/**
 * Modulo: dao/movement.dao.js
 *
 * Que hace: acceso a datos del historial de movimientos y de sus resumenes mensuales.
 * Como lo hace: consulta `transacciones` y la enriquece con beneficiario, proveedor y los
 *               movimientos contables de cuenta.
 * Datos que participan: tablas `transacciones`, `beneficiarios`, `proveedores_servicio`,
 *                       `movimientos_cuenta` y `cuentas`.
 */

const { query } = require("../db");
const { mapMovement, toNumber } = require("./mappers");

/**
 * Funcion: getMovementRows
 *
 * Que hace: construye la consulta dinamica del historial aplicando filtros opcionales.
 * Como lo hace: arma el WHERE por partes (`conditions`) y una lista de parametros (`params`)
 *               en paralelo; `position` lleva el numero del siguiente $n. Todos los valores
 *               viajan como parametros, nunca concatenados al SQL. Devuelve filas crudas
 *               para que otros helpers decidan como mapearlas.
 * Datos que participan: `userId` y el objeto `filters`:
 *   - search: texto libre buscado (en minusculas, con LIKE %texto%) en concepto, nombre y
 *     alias del beneficiario, nombre del proveedor y referencia interna.
 *   - type: tipo de transaccion; "todos" no filtra; "pago" incluye 'pago' y 'pago_servicio'.
 *   - status: estado de la transaccion; "todos" no filtra.
 *   - limit: maximo de filas (100 por defecto).
 * Consulta SQL:
 *   - FROM transacciones (t) con LEFT JOIN a beneficiarios (b) y proveedores_servicio (ps),
 *     porque una transaccion puede no tener ninguno de los dos.
 *   - fecha_operacion = COALESCE(fecha_ejecucion, fecha_programada, creado_en): la fecha
 *     mas representativa disponible.
 *   - CASE para etiquetar el tipo (Pago, Bono, Adelanto o INITCAP del tipo con "_" como espacio).
 *   - contacto: primer valor no nulo entre alias/nombre del beneficiario, proveedor o
 *     "Adelanto salarial" (si es pago de un adelanto), con "-" como ultimo recurso.
 *   - LEFT JOIN LATERAL sobre movimientos_cuenta (mc) JOIN cuentas (c): suma creditos (+) y
 *     debitos (-) para obtener monto_neto y junta los alias de cuentas afectadas con
 *     STRING_AGG. Si no hay movimientos, monto_neto cae a +monto_total (deposito) o
 *     -monto_total (otros).
 *   - ORDER BY fecha_operacion DESC; LIMIT con el ultimo parametro.
 * Retorna: arreglo de filas crudas.
 */
async function getMovementRows(userId, filters = {}, executor = { query }) {
    const params = [userId];
    const conditions = ["t.usuario_id = $1"];
    let position = params.length + 1;

    if (filters.search) {
        params.push(`%${String(filters.search).toLowerCase()}%`);
        conditions.push(
            `(
                LOWER(t.concepto) LIKE $${position}
                OR LOWER(COALESCE(b.nombre_beneficiario, '')) LIKE $${position}
                OR LOWER(COALESCE(b.alias_beneficiario, '')) LIKE $${position}
                OR LOWER(COALESCE(ps.nombre, '')) LIKE $${position}
                OR LOWER(COALESCE(t.referencia_interna, '')) LIKE $${position}
            )`
        );
        position += 1;
    }

    if (filters.type && filters.type !== "todos") {
        const normalizedType = String(filters.type).toLowerCase();
        if (normalizedType === "pago") {
            conditions.push(`LOWER(t.tipo) IN ('pago', 'pago_servicio')`);
        } else {
            params.push(normalizedType);
            conditions.push(`LOWER(t.tipo) = $${position}`);
            position += 1;
        }
    }

    if (filters.status && filters.status !== "todos") {
        params.push(String(filters.status).toLowerCase());
        conditions.push(`LOWER(t.estado) = $${position}`);
        position += 1;
    }

    params.push(Number(filters.limit || 100));

    const result = await executor.query(
        `
        SELECT
            t.id_transaccion,
            COALESCE(t.fecha_ejecucion, t.fecha_programada, t.creado_en) AS fecha_operacion,
            CASE
                WHEN t.tipo = 'pago_servicio' THEN 'Pago'
                WHEN t.tipo = 'bono_bienvenida' THEN 'Bono'
                WHEN t.tipo = 'adelanto_salarial' THEN 'Adelanto'
                ELSE INITCAP(REPLACE(t.tipo, '_', ' '))
            END AS tipo_capitalizado,
            INITCAP(t.estado) AS estado_capitalizado,
            t.concepto,
            t.referencia_interna,
            COALESCE(
                b.alias_beneficiario,
                b.nombre_beneficiario,
                ps.nombre,
                CASE
                    WHEN t.adelanto_id IS NOT NULL AND t.tipo = 'pago_servicio' THEN 'Adelanto salarial'
                    ELSE NULL
                END,
                '-'
            ) AS contacto,
            COALESCE(b.banco_destino, ps.nombre, '') AS banco_destino,
            COALESCE(
                movimientos.monto_neto,
                CASE
                    WHEN t.tipo = 'deposito' THEN t.monto_total
                    ELSE -t.monto_total
                END
            ) AS monto_neto,
            COALESCE(movimientos.cuentas_afectadas, 'Cuenta wallet') AS cuentas_afectadas
        FROM transacciones t
        LEFT JOIN beneficiarios b
            ON b.id_beneficiario = t.beneficiario_id
        LEFT JOIN proveedores_servicio ps
            ON ps.id_proveedor = t.proveedor_servicio_id
        LEFT JOIN LATERAL (
            SELECT
                SUM(
                    CASE
                        WHEN mc.tipo_movimiento = 'credito' THEN mc.monto
                        ELSE -mc.monto
                    END
                ) AS monto_neto,
                STRING_AGG(c.alias_cuenta, ', ' ORDER BY mc.id_movimiento) AS cuentas_afectadas
            FROM movimientos_cuenta mc
            JOIN cuentas c
                ON c.id_cuenta = mc.cuenta_id
            WHERE mc.transaccion_id = t.id_transaccion
        ) movimientos ON TRUE
        WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(t.fecha_ejecucion, t.fecha_programada, t.creado_en) DESC
        LIMIT $${position}
        `,
        params
    );

    return result.rows;
}

/**
 * Funcion: getMovements
 *
 * Que hace: convierte las filas crudas del historial en objetos listos para la interfaz.
 * Como lo hace: llama a getMovementRows y aplica mapMovement a cada fila.
 * Datos que participan: `userId` y `filters` (search, type, status, limit).
 * Consulta SQL: la de getMovementRows.
 * Retorna: arreglo de movimientos.
 */
async function getMovements(userId, filters = {}, executor = { query }) {
    const rows = await getMovementRows(userId, filters, executor);
    return rows.map(mapMovement);
}

/**
 * Funcion: getMonthlySummary
 *
 * Que hace: consolida el comportamiento mensual del usuario con contadores y volumen.
 * Como lo hace: una sola pasada sobre `transacciones` con agregados condicionales
 *               (COUNT(*) FILTER / SUM(...) FILTER) en lugar de varias consultas.
 * Datos que participan: `userId` ($1).
 * Consulta SQL:
 *   - total_movimientos: COUNT(*) de todas las transacciones del usuario.
 *   - depositos_mes / pagos_mes / transferencias_mes: COUNT filtrado por tipo
 *     ('deposito'; 'pago' o 'pago_servicio'; 'transferencia') y por mes actual, comparando
 *     DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) con el de NOW().
 *   - operaciones_programadas: COUNT donde estado = 'programada' (sin limite de mes).
 *   - volumen_mes: SUM(monto_total) del mes actual, 0 si no hay datos.
 * Retorna: { totalMovimientos, depositosMes, pagosMes, transferenciasMes,
 *            operacionesProgramadas, volumenMes }.
 */
async function getMonthlySummary(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            COUNT(*) AS total_movimientos,
            COUNT(*) FILTER (
                WHERE tipo = 'deposito'
                  AND DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ) AS depositos_mes,
            COUNT(*) FILTER (
                WHERE tipo IN ('pago', 'pago_servicio')
                  AND DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ) AS pagos_mes,
            COUNT(*) FILTER (
                WHERE tipo = 'transferencia'
                  AND DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ) AS transferencias_mes,
            COUNT(*) FILTER (
                WHERE estado = 'programada'
            ) AS operaciones_programadas,
            COALESCE(SUM(monto_total) FILTER (
                WHERE DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ), 0) AS volumen_mes
        FROM transacciones
        WHERE usuario_id = $1
        `,
        [userId]
    );

    const row = result.rows[0] || {};
    return {
        totalMovimientos: Number(row.total_movimientos || 0),
        depositosMes: Number(row.depositos_mes || 0),
        pagosMes: Number(row.pagos_mes || 0),
        transferenciasMes: Number(row.transferencias_mes || 0),
        operacionesProgramadas: Number(row.operaciones_programadas || 0),
        volumenMes: toNumber(row.volumen_mes)
    };
}

module.exports = {
    getMovementRows,
    getMovements,
    getMonthlySummary
};
