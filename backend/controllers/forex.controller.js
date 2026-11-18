/**
 * Modulo: controllers/forex.controller.js
 *
 * Que hace: capa de entrada para el contenido educativo y el simulador Forex.
 * Como lo hace: cada funcion delega en models/forex.model.js sin logica propia; el controlador es el punto de
 *   entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const forexModel = require("../models/forex.model");

/**
 * Funcion: getLearningContent
 *
 * Que hace: pide el contenido educativo y el contexto de mercado para el par elegido.
 * Como lo hace: toma `query.pair` y llama a forexModel.getForexLearningContent.
 * Datos que participan: `query` con el par de divisas (ej. EUR/USD).
 * Consultas SQL: ninguna (datos de mercado y contenido en el modelo).
 * Retorna: contenido educativo y mercado.
 */
async function getLearningContent(query) {
    return forexModel.getForexLearningContent(query?.pair);
}

/**
 * Funcion: simulate
 *
 * Que hace: delega la simulacion de escenario Forex usando los parametros del usuario.
 * Como lo hace: llama a forexModel.simulateForexScenario.
 * Datos que participan: `payload` con par, monto, direccion, etc.
 * Consultas SQL: ninguna (calculo en memoria).
 * Retorna: resultado de la simulacion.
 */
async function simulate(payload) {
    return forexModel.simulateForexScenario(payload);
}

module.exports = {
    getLearningContent,
    simulate
};
