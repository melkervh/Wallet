const profileModel = require("../models/profile.model");

// Funcion: getProfile
// Aqui cargo el perfil consolidado del usuario junto con accesos recientes.
async function getProfile(userId) {
    return profileModel.getProfile(userId);
}

// Funcion: updateProfile
// Aqui delego la actualizacion de datos y foto de perfil.
async function updateProfile(userId, payload) {
    return profileModel.updateProfile(userId, payload);
}

module.exports = {
    getProfile,
    updateProfile
};
