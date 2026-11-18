/**
 * Modulo: controllers/profile.controller.js
 *
 * Que hace: capa de entrada para el perfil del usuario.
 * Como lo hace: cada funcion delega en models/profile.model.js sin logica propia; el controlador es el punto
 *   de entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const profileModel = require("../models/profile.model");

/**
 * Funcion: getProfile
 *
 * Que hace: carga el perfil consolidado del usuario junto con accesos recientes.
 * Como lo hace: llama a profileModel.getProfile.
 * Datos que participan: `userId`.
 * Consultas SQL: SELECT de usuario y accesos_usuario.
 * Retorna: perfil y accesos.
 */
async function getProfile(userId) {
    return profileModel.getProfile(userId);
}

/**
 * Funcion: updateProfile
 *
 * Que hace: delega la actualizacion de datos personales y foto de perfil.
 * Como lo hace: llama a profileModel.updateProfile.
 * Datos que participan: `userId`, `payload` { firstName, lastName, phone, birthDate, documentId, address,
 *   removePhoto, photoDataUrl }.
 * Consultas SQL: SELECT ... FOR UPDATE y UPDATE sobre usuarios (ver profile.model).
 * Retorna: { message, profile, recentAccessLogs }.
 */
async function updateProfile(userId, payload) {
    return profileModel.updateProfile(userId, payload);
}

module.exports = {
    getProfile,
    updateProfile
};
