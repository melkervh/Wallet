/**
 * Modulo: controllers/services.controller.js
 *
 * Que hace: capa de entrada para pagos de servicios.
 * Como lo hace: cada funcion delega en models/services.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const servicesModel = require("../models/services.model");

/**
 * Funcion: getCenter
 *
 * Que hace: carga proveedores, cuentas y servicios vinculados para pagos.
 * Como lo hace: llama a servicesModel.getServicesCenter.
 * Datos que participan: `userId`.
 * Consultas SQL: las del modelo.
 * Retorna: proveedores, cuentas y servicios.
 */
async function getCenter(userId) {
    return servicesModel.getServicesCenter(userId);
}

/**
 * Funcion: linkService
 *
 * Que hace: delega la vinculacion de un contrato o servicio recurrente.
 * Como lo hace: llama a servicesModel.linkService.
 * Datos que participan: `userId`, `payload` { providerId, accountId, customerIdentifier | serviceIdentifier,
 *   alias }.
 * Consultas SQL: SELECT de proveedor y cuenta e INSERT ... ON CONFLICT en servicios_usuario (ver
 *   services.model).
 * Retorna: { message }.
 */
async function linkService(userId, payload) {
    return servicesModel.linkService(userId, payload);
}

/**
 * Funcion: payService
 *
 * Que hace: delega el pago de un servicio (o del adelanto salarial) desde la wallet.
 * Como lo hace: llama a servicesModel.payService.
 * Datos que participan: `userId`, `payload` { accountId, amount, linkedServiceId | providerId, paymentTarget,
 *   customerIdentifier, concept }.
 * Consultas SQL: bloqueo de cuenta, INSERT en transacciones, UPDATE de cuentas y movimientos_cuenta (ver
 *   services.model).
 * Retorna: { message }.
 */
async function payService(userId, payload) {
    return servicesModel.payService(userId, payload);
}

module.exports = {
    getCenter,
    linkService,
    payService
};
