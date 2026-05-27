const dashboardModel = require("../models/dashboard.model");

// Funcion: getDashboard
// Aqui delego la construccion del dashboard principal del usuario.
async function getDashboard(userId) {
    return dashboardModel.getDashboard(userId);
}

// Funcion: getMovements
// Aqui delego la consulta del historial aplicando los filtros recibidos.
async function getMovements(userId, filters) {
    return dashboardModel.getMovements(userId, filters);
}

module.exports = {
    getDashboard,
    getMovements
};
