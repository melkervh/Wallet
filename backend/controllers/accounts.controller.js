const accountsModel = require("../models/accounts.model");

// Funcion: getCenter
// Aqui delego la carga del centro de cuentas del usuario.
async function getCenter(userId) {
    return accountsModel.getAccountsCenter(userId);
}

// Funcion: createSecondary
// Aqui delego la creacion de una cuenta secundaria con su validacion de negocio.
async function createSecondary(userId, payload) {
    return accountsModel.createSecondaryAccount(userId, payload);
}

module.exports = {
    getCenter,
    createSecondary
};
