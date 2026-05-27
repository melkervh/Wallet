const catalogModel = require("../models/catalog.model");

// Funcion: getCatalogs
// Aqui entrego catalogos base como bancos y proveedores de servicios.
async function getCatalogs() {
    return catalogModel.getCatalogs();
}

module.exports = {
    getCatalogs
};
