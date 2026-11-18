/**
 * Modulo: controllers/alerts.controller.js
 *
 * Que hace: capa de entrada para las alertas del usuario.
 * Como lo hace: cada funcion delega en models/alerts.model.js sin logica propia; el controlador es el punto de
 *   entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const alertsModel = require("../models/alerts.model");

/**
 * Funcion: getCenter
 *
 * Que hace: entrega el listado de alertas y el contador pendiente del usuario.
 * Como lo hace: llama a alertsModel.getAlertsCenter.
 * Datos que participan: `userId`.
 * Consultas SQL: SELECT de alertas y COUNT de no leidas.
 * Retorna: { alerts, unreadAlerts }.
 */
async function getCenter(userId) {
    return alertsModel.getAlertsCenter(userId);
}

/**
 * Funcion: markAllAsRead
 *
 * Que hace: marca todas las alertas visibles como revisadas.
 * Como lo hace: llama a alertsModel.markAllAlertsAsRead.
 * Datos que participan: `userId`.
 * Consultas SQL: UPDATE alertas_usuario SET leida = TRUE.
 * Retorna: { message }.
 */
async function markAllAsRead(userId) {
    return alertsModel.markAllAlertsAsRead(userId);
}

/**
 * Funcion: removeAlert
 *
 * Que hace: elimina una alerta concreta del panel superior.
 * Como lo hace: llama a alertsModel.deleteAlert.
 * Datos que participan: `userId`, `alertId`.
 * Consultas SQL: DELETE FROM alertas_usuario filtrado por id y dueno.
 * Retorna: { message }.
 */
async function removeAlert(userId, alertId) {
    return alertsModel.deleteAlert(userId, alertId);
}

module.exports = {
    getCenter,
    markAllAsRead,
    removeAlert
};
