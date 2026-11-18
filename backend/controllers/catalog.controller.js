/**
 * Modulo: controllers/catalog.controller.js
 *
 * Que hace: capa de entrada para catalogos globales.
 * Como lo hace: cada funcion delega en models/catalog.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const catalogModel = require("../models/catalog.model");

/**
 * Funcion: getCatalogs
 *
 * Que hace: entrega los catalogos base como bancos y proveedores de servicios.
 * Como lo hace: llama a catalogModel.getCatalogs.
 * Datos que participan: ninguno.
 * Consultas SQL: SELECT de catalogo_bancos y proveedores_servicio.
 * Retorna: { banks, serviceProviders }.
 */
async function getCatalogs() {
    return catalogModel.getCatalogs();
}

module.exports = {
    getCatalogs
};
