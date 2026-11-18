/**
 * Modulo: models/catalog.model.js
 *
 * Que hace: expone los catalogos globales (bancos y proveedores de servicio) en una sola respuesta.
 * Como lo hace: reutiliza los DAOs de catalogo mediante base.model.
 * Datos que participan: tablas `catalogo_bancos` y `proveedores_servicio`.
 * Consultas SQL: las de catalog.dao (getBankCatalog y getServiceProviderCatalog).
 */

const {
    getBankCatalog,
    getServiceProviderCatalog
} = require("./base.model");

/**
 * Funcion: getCatalogs
 *
 * Que hace: junta los catalogos base en una sola respuesta para ahorrar llamadas al frontend.
 * Como lo hace: lanza ambas lecturas en paralelo con Promise.all.
 * Datos que participan: ninguno de entrada (los catalogos son globales).
 * Consultas SQL: SELECT de bancos activos y SELECT de proveedores activos con LEFT JOIN a su banco.
 * Retorna: { banks, serviceProviders }.
 */
async function getCatalogs() {
    const [banks, serviceProviders] = await Promise.all([
        getBankCatalog(),
        getServiceProviderCatalog()
    ]);

    return {
        banks,
        serviceProviders
    };
}

module.exports = {
    getCatalogs
};
