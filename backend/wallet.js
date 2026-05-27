const authController = require("./controllers/auth.controller");
const dashboardController = require("./controllers/dashboard.controller");
const transferController = require("./controllers/transfer.controller");
const HttpError = require("./http-error");

// Este modulo deja una fachada pequena para exponer funciones clave del backend.
// Me sirve como punto de compatibilidad si otra parte del proyecto importa wallet.js.
module.exports = {
    HttpError,
    loginUser: authController.login,
    registerUser: authController.register,
    requestPasswordReset: authController.requestPasswordReset,
    resetPasswordWithToken: authController.resetPassword,
    getSession: async (userId) => {
        const { getSession } = require("./models/auth.model");
        return getSession(userId);
    },
    getDashboard: dashboardController.getDashboard,
    getMovements: dashboardController.getMovements,
    getTransferMetadata: transferController.getTransferMetadata,
    createBeneficiary: transferController.createBeneficiary,
    createTransfer: transferController.createTransfer
};
