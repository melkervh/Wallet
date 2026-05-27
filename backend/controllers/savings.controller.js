const savingsModel = require("../models/savings.model");

// Funcion: getCenter
// Aqui cargo cuentas y bolsillos de ahorro del usuario.
async function getCenter(userId) {
    return savingsModel.getSavingsCenter(userId);
}

// Funcion: createPocket
// Aqui delego la creacion de un nuevo bolsillo de ahorro.
async function createPocket(userId, payload) {
    return savingsModel.createSavingsPocket(userId, payload);
}

// Funcion: deposit
// Aqui delego el movimiento de saldo desde una cuenta hacia ahorro.
async function deposit(userId, payload) {
    return savingsModel.depositIntoSavings(userId, payload);
}

module.exports = {
    getCenter,
    createPocket,
    deposit
};
