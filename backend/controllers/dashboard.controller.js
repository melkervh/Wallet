/**
 * Modulo: controllers/dashboard.controller.js
 *
 * Que hace: capa de entrada para el dashboard y el historial de movimientos.
 * Como lo hace: cada funcion delega en models/dashboard.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const dashboardModel = require("../models/dashboard.model");

/**
 * Funcion: getDashboard
 *
 * Que hace: delega la construccion del dashboard principal del usuario.
 * Como lo hace: llama a dashboardModel.getDashboard.
 * Datos que participan: `userId`.
 * Consultas SQL: las de 9 lecturas en paralelo (ver dashboard.model).
 * Retorna: objeto dashboard completo.
 */
async function getDashboard(userId) {
    return dashboardModel.getDashboard(userId);
}

/**
 * Funcion: getMovements
 *
 * Que hace: delega la consulta del historial aplicando los filtros recibidos.
 * Como lo hace: llama a dashboardModel.getMovements.
 * Datos que participan: `userId`, `filters` { search, type, status, limit }.
 * Consultas SQL: SELECT dinamico de transacciones (movement.dao.getMovementRows).
 * Retorna: arreglo de movimientos.
 */
async function getMovements(userId, filters) {
    return dashboardModel.getMovements(userId, filters);
}

module.exports = {
    getDashboard,
    getMovements
};
