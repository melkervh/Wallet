/**
 * Modulo: controllers/accounts.controller.js
 *
 * Que hace: capa de entrada para las cuentas wallet.
 * Como lo hace: cada funcion delega en models/accounts.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const accountsModel = require("../models/accounts.model");

/**
 * Funcion: getCenter
 *
 * Que hace: delega la carga del centro de cuentas del usuario.
 * Como lo hace: llama a accountsModel.getAccountsCenter.
 * Datos que participan: `userId`.
 * Consultas SQL: SELECT de cuentas del usuario (account.dao.getAccounts).
 * Retorna: { accounts }.
 */
async function getCenter(userId) {
    return accountsModel.getAccountsCenter(userId);
}

/**
 * Funcion: createSecondary
 *
 * Que hace: delega la creacion de una cuenta secundaria con su validacion de negocio.
 * Como lo hace: llama a accountsModel.createSecondaryAccount.
 * Datos que participan: `userId`, `payload` { alias, currency }.
 * Consultas SQL: SELECT de usuario, INSERT en cuentas y alerta (ver accounts.model).
 * Retorna: { message, accountId }.
 */
async function createSecondary(userId, payload) {
    return accountsModel.createSecondaryAccount(userId, payload);
}

module.exports = {
    getCenter,
    createSecondary
};
