const salaryAdvanceModel = require("../models/salary-advance.model");

// Funcion: getCenter
// Aqui cargo el estado actual e historial de adelantos salariales.
// Este controller no hace SQL; solo redirige la solicitud al model.
async function getCenter(userId) {
    return salaryAdvanceModel.getSalaryAdvanceCenter(userId);
}

// Funcion: requestAdvanceCode
// Aqui envio el codigo por correo que autoriza la solicitud del adelanto.
// Este controller tampoco consulta la base directamente; el CRUD real vive en salary-advance.model.js.
async function requestAdvanceCode(userId, payload) {
    return salaryAdvanceModel.requestSalaryAdvanceCode(userId, payload);
}

// Funcion: requestAdvance
// Aqui delego la solicitud y acreditacion del adelanto salarial una vez validado el codigo.
// Todo INSERT, UPDATE y validacion SQL ocurre en el model.
async function requestAdvance(userId, payload) {
    return salaryAdvanceModel.requestSalaryAdvance(userId, payload);
}

module.exports = {
    getCenter,
    requestAdvanceCode,
    requestAdvance
};
