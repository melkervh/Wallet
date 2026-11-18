/**
 * Modulo: dao/salary-advance.dao.js
 *
 * Que hace: acceso a datos de adelantos salariales (tabla `adelantos_salariales`) y de los
 *           pagos que los amortizan (tabla `transacciones`).
 * Como lo hace: SQL parametrizado con CTE y LATERAL para calcular lo pagado en la misma consulta.
 * Datos que participan: id de usuario; estados pendiente/activo/vencido/pagado.
 */

const { query } = require("../db");
const { mapSalaryAdvance } = require("./mappers");
const { insertAlert } = require("./alert.dao");

/**
 * Funcion: syncSalaryAdvanceStatuses
 *
 * Que hace: sincroniza el estado real de los adelantos segun vencimiento y pagos acumulados,
 *           para que un adelanto no siga activo cuando ya vencio o ya quedo pagado.
 * Como lo hace: un solo UPDATE ... FROM (CTE) que cambia solo las filas que realmente
 *               necesitan cambio y devuelve esas filas con RETURNING. Luego, por cada
 *               adelanto que paso a "vencido", inserta una alerta de congelamiento.
 * Datos que participan: `userId` ($1), `executor` (client si va dentro de una transaccion,
 *                       porque tambien escribe alertas).
 * Consulta SQL:
 *   - CTE `pagos`: por cada adelanto del usuario suma transacciones.monto_total de tipo
 *     'pago_servicio' y estado 'completada' ligadas por adelanto_id (LEFT JOIN: un adelanto
 *     sin pagos suma 0 gracias a COALESCE).
 *   - UPDATE: estado = 'pagado' si lo pendiente (monto_aprobado - pagado, minimo 0) es <= 0;
 *     'vencido' si estaba pendiente/activo y CURRENT_DATE supera fecha_pago_proxima; si no,
 *     conserva el estado. Tambien refresca actualizado_en.
 *   - WHERE: limita a adelantos del usuario y a los que de verdad cambian (evita escrituras
 *     inutiles).
 *   - RETURNING: devuelve los campos ya recalculados (pagado, saldo_pendiente, dias_atraso).
 * Retorna: arreglo de adelantos actualizados (mapSalaryAdvance).
 */
async function syncSalaryAdvanceStatuses(userId, executor = { query }) {
    const result = await executor.query(
        `
        WITH pagos AS (
            SELECT
                a.id_adelanto,
                COALESCE(SUM(t.monto_total), 0) AS total_pagado
            FROM adelantos_salariales a
            LEFT JOIN transacciones t
                ON t.adelanto_id = a.id_adelanto
               AND t.tipo = 'pago_servicio'
               AND t.estado = 'completada'
            WHERE a.usuario_id = $1
            GROUP BY a.id_adelanto
        )
        UPDATE adelantos_salariales a
        SET
            estado = CASE
                WHEN GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) <= 0 THEN 'pagado'
                WHEN a.estado IN ('pendiente', 'activo') AND CURRENT_DATE > a.fecha_pago_proxima THEN 'vencido'
                ELSE a.estado
            END,
            actualizado_en = NOW()
        FROM pagos
        WHERE a.id_adelanto = pagos.id_adelanto
          AND a.usuario_id = $1
          AND (
              (GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) <= 0 AND a.estado <> 'pagado')
              OR (a.estado IN ('pendiente', 'activo') AND CURRENT_DATE > a.fecha_pago_proxima)
          )
        RETURNING
            a.id_adelanto,
            a.numero_adelanto,
            a.monto_aprobado,
            a.cuota_descuento,
            a.fecha_solicitud,
            a.fecha_pago_proxima,
            a.estado,
            COALESCE(pagos.total_pagado, 0) AS total_pagado,
            GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) AS saldo_pendiente,
            GREATEST(CURRENT_DATE - a.fecha_pago_proxima, 0) AS dias_atraso
        `,
        [userId]
    );

    for (const row of result.rows) {
        if (row.estado === "vencido") {
            await insertAlert(executor, {
                userId,
                type: "adelanto",
                title: "Adelanto vencido",
                message: `El adelanto ${row.numero_adelanto} vencio y tu wallet queda congelada hasta regularizar el saldo pendiente.`,
                level: "alerta"
            });
        }
    }

    return result.rows.map(mapSalaryAdvance);
}

/**
 * Funcion: getActiveSalaryAdvance
 *
 * Que hace: busca el adelanto vigente del usuario calculando cuanto ha pagado y si ya
 *           congela operaciones.
 * Como lo hace: primero llama a syncSalaryAdvanceStatuses para no devolver datos atrasados
 *               frente a mora o pagos completos; despues ejecuta el SELECT y mapea la fila.
 * Datos que participan: `userId` ($1).
 * Consulta SQL:
 *   - FROM adelantos_salariales (a) LEFT JOIN LATERAL: subconsulta que, para cada adelanto,
 *     suma sus pagos completados de tipo 'pago_servicio' (LATERAL permite referenciar a.id_adelanto).
 *   - Calcula saldo_pendiente, dias_atraso y operaciones_congeladas (TRUE si esta vencido con
 *     saldo > 0).
 *   - WHERE: del usuario, estado pendiente/activo/vencido y saldo pendiente mayor a 0.
 *   - ORDER BY: primero los vencidos, luego el mas reciente; LIMIT 1 = solo el vigente.
 * Retorna: adelanto mapeado o null si no hay vigente.
 */
async function getActiveSalaryAdvance(userId, executor = { query }) {
    await syncSalaryAdvanceStatuses(userId, executor);

    const result = await executor.query(
        `
        SELECT
            a.id_adelanto,
            a.numero_adelanto,
            a.monto_aprobado,
            a.cuota_descuento,
            a.fecha_solicitud,
            a.fecha_pago_proxima,
            a.estado,
            COALESCE(pagos.total_pagado, 0) AS total_pagado,
            GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) AS saldo_pendiente,
            GREATEST(CURRENT_DATE - a.fecha_pago_proxima, 0) AS dias_atraso,
            CASE
                WHEN a.estado = 'vencido'
                     AND GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) > 0
                    THEN TRUE
                ELSE FALSE
            END AS operaciones_congeladas
        FROM adelantos_salariales a
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(t.monto_total), 0) AS total_pagado
            FROM transacciones t
            WHERE t.adelanto_id = a.id_adelanto
              AND t.tipo = 'pago_servicio'
              AND t.estado = 'completada'
        ) pagos ON TRUE
        WHERE a.usuario_id = $1
          AND a.estado IN ('pendiente', 'activo', 'vencido')
          AND GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) > 0
        ORDER BY
            CASE WHEN a.estado = 'vencido' THEN 0 ELSE 1 END,
            a.fecha_solicitud DESC,
            a.creado_en DESC
        LIMIT 1
        `,
        [userId]
    );

    return mapSalaryAdvance(result.rows[0] || null);
}

module.exports = {
    syncSalaryAdvanceStatuses,
    getActiveSalaryAdvance
};
