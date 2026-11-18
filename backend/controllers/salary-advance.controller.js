/**
 * Modulo: controllers/salary-advance.controller.js
 *
 * Que hace: capa de entrada para adelantos salariales.
 * Como lo hace: cada funcion delega en models/salary-advance.model.js sin logica propia; el controlador es el
 *   punto de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const salaryAdvanceModel = require("../models/salary-advance.model");

/**
 * Funcion: getCenter
 *
 * Que hace: carga el estado actual e historial de adelantos salariales.
 * Como lo hace: no hace SQL; redirige a salaryAdvanceModel.getSalaryAdvanceCenter.
 * Datos que participan: `userId`.
 * Consultas SQL: las del modelo y salary-advance.dao.
 * Retorna: estado e historial.
 */
async function getCenter(userId) {
    return salaryAdvanceModel.getSalaryAdvanceCenter(userId);
}

/**
 * Funcion: requestAdvanceCode
 *
 * Que hace: envia por correo el codigo temporal que autoriza la solicitud del adelanto.
 * Como lo hace: no consulta la base directamente; redirige a salaryAdvanceModel.requestSalaryAdvanceCode.
 * Datos que participan: `userId`, `payload` { amount }.
 * Consultas SQL: las del modelo (elegibilidad, UPDATE e INSERT en codigos_verificacion).
 * Retorna: { message, deliveryChannel, previewMode, previewPin }.
 */
async function requestAdvanceCode(userId, payload) {
    return salaryAdvanceModel.requestSalaryAdvanceCode(userId, payload);
}

/**
 * Funcion: requestAdvance
 *
 * Que hace: delega la solicitud y acreditacion del adelanto una vez validado el codigo.
 * Como lo hace: redirige a salaryAdvanceModel.requestSalaryAdvance; todo INSERT, UPDATE y validacion SQL
 *   ocurre en el modelo.
 * Datos que participan: `userId`, `payload` { amount, verificationCode }.
 * Consultas SQL: las del modelo (adelantos_salariales, transacciones, cuentas, movimientos_cuenta,
 *   codigos_verificacion).
 * Retorna: { message, number }.
 */
async function requestAdvance(userId, payload) {
    return salaryAdvanceModel.requestSalaryAdvance(userId, payload);
}

module.exports = {
    getCenter,
    requestAdvanceCode,
    requestAdvance
};
