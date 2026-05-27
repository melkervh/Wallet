const servicesModel = require("../models/services.model");

// Funcion: getCenter
// Aqui cargo proveedores, cuentas y servicios vinculados para pagos.
async function getCenter(userId) {
    return servicesModel.getServicesCenter(userId);
}

// Funcion: linkService
// Aqui delego la vinculacion de un contrato o servicio recurrente.
async function linkService(userId, payload) {
    return servicesModel.linkService(userId, payload);
}

// Funcion: payService
// Aqui delego el pago de un servicio desde la wallet.
async function payService(userId, payload) {
    return servicesModel.payService(userId, payload);
}

module.exports = {
    getCenter,
    linkService,
    payService
};
