/**
 * Modulo: models/alerts.model.js
 *
 * Que hace: logica de negocio del centro de alertas (campana de notificaciones).
 * Como lo hace: lecturas mediante alert.dao (via base.model) y escrituras con SQL propio en transacciones.
 * Datos que participan: tabla `alertas_usuario`, id de usuario e id de alerta.
 * Consultas SQL: ver detalle en cada funcion.
 */

const { withTransaction } = require("../db");
const { HttpError, getAlerts, getUnreadAlertCount } = require("./base.model");

/**
 * Funcion: getAlertsCenter
 *
 * Que hace: concentra el listado de alertas y el contador de no leidas para la campana.
 * Como lo hace: ejecuta en paralelo (Promise.all) getAlerts (ultimas 20) y getUnreadAlertCount.
 * Datos que participan: `userId`.
 * Consultas SQL: SELECT ... FROM alertas_usuario WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 20;
 * y SELECT COUNT(*) ... WHERE usuario_id = $1 AND leida = FALSE (ver alert.dao).
 * Retorna: { alerts, unreadAlerts }.
 */
async function getAlertsCenter(userId) {
    const [alerts, unreadAlerts] = await Promise.all([
        getAlerts(userId, 20),
        getUnreadAlertCount(userId)
    ]);

    return {
        alerts,
        unreadAlerts
    };
}

/**
 * Funcion: markAllAlertsAsRead
 *
 * Que hace: marca todas las alertas pendientes del usuario como vistas.
 * Como lo hace: un UPDATE masivo dentro de una transaccion simple.
 * Datos que participan: `userId`.
 * Consulta SQL: UPDATE alertas_usuario SET leida = TRUE WHERE usuario_id = $1 AND leida = FALSE;
 * el filtro leida = FALSE evita reescribir filas que ya estaban leidas.
 * Retorna: { message }.
 */
async function markAllAlertsAsRead(userId) {
    return withTransaction(async (client) => {
        await client.query(
            `
            UPDATE alertas_usuario
            SET leida = TRUE
            WHERE usuario_id = $1
              AND leida = FALSE
            `,
            [userId]
        );

        return {
            message: "Las alertas quedaron marcadas como vistas."
        };
    });
}

/**
 * Funcion: deleteAlert
 *
 * Que hace: elimina una alerta puntual asegurandose de que pertenezca al usuario.
 * Como lo hace: DELETE con doble condicion (id de alerta Y dueno) y RETURNING para saber si borro algo;
 * si no devolvio fila, la alerta no existe o es de otro usuario y se lanza 404.
 * Datos que participan: `userId`, `alertId`.
 * Consulta SQL: DELETE FROM alertas_usuario WHERE id_alerta = $1 AND usuario_id = $2 RETURNING id_alerta.
 * Retorna: { message }.
 */
async function deleteAlert(userId, alertId) {
    return withTransaction(async (client) => {
        const result = await client.query(
            `
            DELETE FROM alertas_usuario
            WHERE id_alerta = $1
              AND usuario_id = $2
            RETURNING id_alerta
            `,
            [Number(alertId), userId]
        );

        if (!result.rows[0]) {
            throw new HttpError(404, "La alerta seleccionada no existe.");
        }

        return {
            message: "La alerta fue eliminada correctamente."
        };
    });
}

module.exports = {
    getAlertsCenter,
    markAllAlertsAsRead,
    deleteAlert
};
