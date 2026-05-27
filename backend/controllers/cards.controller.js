const cardsModel = require("../models/cards.model");

// Funcion: getCenter
// Aqui cargo el centro de tarjetas con cuentas, bancos y tarjetas vinculadas.
async function getCenter(userId) {
    return cardsModel.getCardsCenter(userId);
}

// Funcion: linkCard
// Aqui delego la vinculacion de una tarjeta externa a una wallet del usuario.
async function linkCard(userId, payload) {
    return cardsModel.linkCard(userId, payload);
}

module.exports = {
    getCenter,
    linkCard
};
