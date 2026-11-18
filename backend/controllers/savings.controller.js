/**
 * Modulo: controllers/savings.controller.js
 *
 * Que hace: capa de entrada para ahorros y bolsillos.
 * Como lo hace: cada funcion delega en models/savings.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const savingsModel = require("../models/savings.model");

/**
 * Funcion: getCenter
 *
 * Que hace: carga cuentas y bolsillos de ahorro del usuario.
 * Como lo hace: llama a savingsModel.getSavingsCenter.
 * Datos que participan: `userId`.
 * Consultas SQL: las del modelo.
 * Retorna: cuentas y bolsillos.
 */
async function getCenter(userId) {
    return savingsModel.getSavingsCenter(userId);
}

/**
 * Funcion: createPocket
 *
 * Que hace: delega la creacion de un nuevo bolsillo de ahorro.
 * Como lo hace: llama a savingsModel.createSavingsPocket.
 * Datos que participan: `userId`, `payload` { accountId, name, goalAmount, color }.
 * Consultas SQL: SELECT de cuenta e INSERT en bolsillos_ahorro (ver savings.model).
 * Retorna: { message }.
 */
async function createPocket(userId, payload) {
    return savingsModel.createSavingsPocket(userId, payload);
}

/**
 * Funcion: deposit
 *
 * Que hace: delega el movimiento de saldo desde una cuenta hacia un bolsillo de ahorro.
 * Como lo hace: llama a savingsModel.depositIntoSavings.
 * Datos que participan: `userId`, `payload` { pocketId, accountId, amount }.
 * Consultas SQL: SELECT ... FOR UPDATE, INSERT en transacciones y movimientos_cuenta, UPDATE de cuentas y
 *   bolsillos_ahorro (ver savings.model).
 * Retorna: { message }.
 */
async function deposit(userId, payload) {
    return savingsModel.depositIntoSavings(userId, payload);
}

module.exports = {
    getCenter,
    createPocket,
    deposit
};
