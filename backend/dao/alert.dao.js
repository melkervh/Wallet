/**
 * Modulo: dao/alert.dao.js
 *
 * Que hace: acceso a datos de alertas del usuario y bitacora de accesos.
 * Como lo hace: SQL parametrizado; los INSERT reciben un `client` para poder participar
 *               en la misma transaccion que la operacion que los origina.
 * Datos que participan: tablas `alertas_usuario` y `accesos_usuario`.
 */

const { query } = require("../db");
const { mapAlert, normalizeAlertLevel } = require("./mappers");

/**
 * Funcion: insertAlert
 *
 * Que hace: registra una alerta nueva ya normalizada para el usuario.
 * Como lo hace: normaliza el nivel con normalizeAlertLevel y ejecuta un INSERT.
 * Datos que participan: `userId`, `type` (tipo de alerta), `title`, `message`, `level`.
 * Consulta SQL: INSERT INTO alertas_usuario (usuario_id, tipo_alerta, titulo, mensaje, nivel)
 *               VALUES ($1..$5). `leida` y `creada_en` toman el DEFAULT de la tabla.
 * Retorna: nada (Promise<void>).
 */
async function insertAlert(client, { userId, type, title, message, level = "informativo" }) {
    await client.query(
        `
        INSERT INTO alertas_usuario (
            usuario_id,
            tipo_alerta,
            titulo,
            mensaje,
            nivel
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [userId, type, title, message, normalizeAlertLevel(level)]
    );
}

/**
 * Funcion: insertAccessLog
 *
 * Que hace: guarda el rastro de accesos y eventos de autenticacion con IP y agente.
 * Como lo hace: inserta una fila en la bitacora; si no hay IP guarda NULL en lugar de fallar.
 * Datos que participan: `userId`, `ipAddress`, `userAgent`, `result` (exitoso/fallido...),
 *                       `detail` (texto del evento).
 * Consulta SQL: INSERT INTO accesos_usuario (...) VALUES (...). `NULLIF($2, '')::INET`
 *               convierte "" en NULL y luego castea a tipo INET de PostgreSQL. El user agent
 *               se guarda en `dispositivo` y `navegador`. Esas columnas son VARCHAR(120) y `detalle`
 *               VARCHAR(240), por eso los textos se recortan antes de insertar (el user agent de Edge
 *               supera los 120 caracteres y sin recorte el registro y el login fallaban con error 500).
 * Retorna: nada (Promise<void>).
 */
async function insertAccessLog(client, { userId, ipAddress, userAgent, result, detail }) {
    await client.query(
        `
        INSERT INTO accesos_usuario (
            usuario_id,
            direccion_ip,
            dispositivo,
            navegador,
            resultado,
            detalle
        )
        VALUES ($1, NULLIF($2, '')::INET, $3, $4, $5, $6)
        `,
        [
            userId,
            ipAddress || "",
            String(userAgent || "desconocido").slice(0, 120),
            String(userAgent || "desconocido").slice(0, 120),
            result,
            String(detail || "").slice(0, 240)
        ]
    );
}

/**
 * Funcion: getAlerts
 *
 * Que hace: trae las alertas mas recientes del usuario.
 * Como lo hace: SELECT ordenado por fecha descendente con tope `limit`, mapeado con mapAlert.
 * Datos que participan: `userId` ($1), `limit` ($2, por defecto 5).
 * Consulta SQL: SELECT desde `alertas_usuario` WHERE usuario_id = $1
 *               ORDER BY creada_en DESC LIMIT $2.
 * Retorna: arreglo de alertas.
 */
async function getAlerts(userId, limit = 5, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_alerta,
            tipo_alerta,
            titulo,
            mensaje,
            nivel,
            leida,
            creada_en
        FROM alertas_usuario
        WHERE usuario_id = $1
        ORDER BY creada_en DESC
        LIMIT $2
        `,
        [userId, limit]
    );

    return result.rows.map(mapAlert);
}

/**
 * Funcion: getUnreadAlertCount
 *
 * Que hace: calcula cuantas alertas siguen pendientes para la campana superior.
 * Como lo hace: COUNT(*) filtrado por usuario y leida = FALSE.
 * Datos que participan: `userId` ($1).
 * Consulta SQL: SELECT COUNT(*) AS total FROM alertas_usuario
 *               WHERE usuario_id = $1 AND leida = FALSE. COUNT llega como string, por eso
 *               se convierte con Number.
 * Retorna: number.
 */
async function getUnreadAlertCount(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT COUNT(*) AS total
        FROM alertas_usuario
        WHERE usuario_id = $1
          AND leida = FALSE
        `,
        [userId]
    );

    return Number(result.rows[0]?.total || 0);
}

module.exports = {
    insertAlert,
    insertAccessLog,
    getAlerts,
    getUnreadAlertCount
};
