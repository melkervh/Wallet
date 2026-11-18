/**
 * Modulo: controllers/cards.controller.js
 *
 * Que hace: capa de entrada para tarjetas vinculadas.
 * Como lo hace: cada funcion delega en models/cards.model.js sin logica propia; el controlador es el punto de
 *   entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const cardsModel = require("../models/cards.model");

/**
 * Funcion: getCenter
 *
 * Que hace: carga el centro de tarjetas con cuentas, bancos y tarjetas vinculadas.
 * Como lo hace: llama a cardsModel.getCardsCenter.
 * Datos que participan: `userId`.
 * Consultas SQL: SELECT de cuentas, bancos y tarjetas.
 * Retorna: { accounts, banks, cards }.
 */
async function getCenter(userId) {
    return cardsModel.getCardsCenter(userId);
}

/**
 * Funcion: linkCard
 *
 * Que hace: delega la vinculacion de una tarjeta externa a una wallet del usuario.
 * Como lo hace: llama a cardsModel.linkCard.
 * Datos que participan: `userId`, `payload` de la tarjeta.
 * Consultas SQL: SELECT de cuenta y banco, INSERT en tarjetas (ver cards.model).
 * Retorna: { message, cardId }.
 */
async function linkCard(userId, payload) {
    return cardsModel.linkCard(userId, payload);
}

module.exports = {
    getCenter,
    linkCard
};
