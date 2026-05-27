const transferModel = require("../models/transfer.model");

// Funcion: getTransferMetadata
// Aqui cargo cuentas, favoritos y resumen previo para preparar transferencias.
async function getTransferMetadata(userId) {
    return transferModel.getTransferMetadata(userId);
}

// Funcion: createBeneficiary
// Aqui delego el alta de un beneficiario o favorito de envio.
async function createBeneficiary(userId, payload) {
    return transferModel.createBeneficiary(userId, payload);
}

// Funcion: removeFavoriteBeneficiary
// Aqui delego la salida de un beneficiario de la lista de favoritos.
async function removeFavoriteBeneficiary(userId, beneficiaryId) {
    return transferModel.removeFavoriteBeneficiary(userId, beneficiaryId);
}

// Funcion: createTransfer
// Aqui delego la transferencia inmediata o programada.
async function createTransfer(userId, payload) {
    return transferModel.createTransfer(userId, payload);
}

module.exports = {
    getTransferMetadata,
    createBeneficiary,
    removeFavoriteBeneficiary,
    createTransfer
};
