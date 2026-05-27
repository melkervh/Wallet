const { withTransaction } = require("../db");
const { HttpError, getAlerts, getUnreadAlertCount } = require("./base.model");

// Funcion: getAlertsCenter
// Aqui concentro el listado de alertas y el contador no leido para la campana.
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

// Funcion: markAllAlertsAsRead
// Aqui marco todas las alertas pendientes como vistas dentro de una transaccion simple.
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

// Funcion: deleteAlert
// Aqui elimino una alerta puntual asegurandome de que pertenezca al usuario.
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
