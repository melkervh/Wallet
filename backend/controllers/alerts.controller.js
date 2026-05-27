const alertsModel = require("../models/alerts.model");

// Funcion: getCenter
// Aqui entrego el listado de alertas y el contador pendiente del usuario.
async function getCenter(userId) {
    return alertsModel.getAlertsCenter(userId);
}

// Funcion: markAllAsRead
// Aqui marco todas las alertas visibles como revisadas.
async function markAllAsRead(userId) {
    return alertsModel.markAllAlertsAsRead(userId);
}

// Funcion: removeAlert
// Aqui elimino una alerta concreta del panel superior.
async function removeAlert(userId, alertId) {
    return alertsModel.deleteAlert(userId, alertId);
}

module.exports = {
    getCenter,
    markAllAsRead,
    removeAlert
};
