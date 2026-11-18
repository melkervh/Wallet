/**
 * Modulo: controllers/transfer.controller.js
 *
 * Que hace: capa de entrada para transferencias y beneficiarios.
 * Como lo hace: cada funcion delega en models/transfer.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const transferModel = require("../models/transfer.model");

/**
 * Funcion: getTransferMetadata
 *
 * Que hace: carga cuentas, favoritos y resumen previo para preparar transferencias.
 * Como lo hace: llama a transferModel.getTransferMetadata.
 * Datos que participan: `userId`.
 * Consultas SQL: las del modelo y DAOs.
 * Retorna: metadatos de transferencia.
 */
async function getTransferMetadata(userId) {
    return transferModel.getTransferMetadata(userId);
}

/**
 * Funcion: createBeneficiary
 *
 * Que hace: delega el alta de un beneficiario o favorito de envio.
 * Como lo hace: llama a transferModel.createBeneficiary.
 * Datos que participan: `userId`, `payload` { recipientName, recipientAlias, destinationBank,
 *   destinationAccount, destinationType, notificationEmail, notificationPhone, saveFavorite }.
 * Consultas SQL: UPSERT en beneficiarios (beneficiary.dao.insertOrUpdateBeneficiary).
 * Retorna: beneficiario publico.
 */
async function createBeneficiary(userId, payload) {
    return transferModel.createBeneficiary(userId, payload);
}

/**
 * Funcion: removeFavoriteBeneficiary
 *
 * Que hace: delega la salida de un beneficiario de la lista de favoritos.
 * Como lo hace: llama a transferModel.removeFavoriteBeneficiary.
 * Datos que participan: `userId`, `beneficiaryId`.
 * Consultas SQL: UPDATE de beneficiarios.
 * Retorna: { message }.
 */
async function removeFavoriteBeneficiary(userId, beneficiaryId) {
    return transferModel.removeFavoriteBeneficiary(userId, beneficiaryId);
}

/**
 * Funcion: createTransfer
 *
 * Que hace: delega la transferencia inmediata o programada.
 * Como lo hace: llama a transferModel.createTransfer.
 * Datos que participan: `userId`, `payload` { sourceAccountId, amount, concept, transferType, scheduledDate,
 *   destinationAccount, beneficiaryId, ... }.
 * Consultas SQL: bloqueo de cuenta, INSERT en transacciones, UPDATE de cuentas y movimientos_cuenta (ver
 *   transfer.model).
 * Retorna: { message, transfer }.
 */
async function createTransfer(userId, payload) {
    return transferModel.createTransfer(userId, payload);
}

module.exports = {
    getTransferMetadata,
    createBeneficiary,
    removeFavoriteBeneficiary,
    createTransfer
};
