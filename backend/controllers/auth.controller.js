const { extractBearerToken, verifyToken } = require("../auth");
const HttpError = require("../http-error");
const authModel = require("../models/auth.model");

// Funcion: login
// Aqui delego el acceso del usuario al modelo de autenticacion.
async function login(payload) {
    return authModel.loginUser(payload);
}

// Funcion: getBootstrap
// Aqui consulto si la base ya tiene usuarios o si debe arrancar en modo registro.
async function getBootstrap() {
    return authModel.getBootstrapState();
}

// Funcion: register
// Aqui delego el alta de usuario con cuenta principal incluida.
async function register(payload) {
    return authModel.registerUser(payload);
}

// Funcion: requestPasswordReset
// Aqui lanzo el flujo para enviar PIN de recuperacion.
async function requestPasswordReset(payload) {
    return authModel.requestPasswordReset(payload);
}

// Funcion: verifyPasswordResetPin
// Aqui valido que el PIN ingresado siga activo y corresponda al usuario.
async function verifyPasswordResetPin(payload) {
    return authModel.verifyPasswordResetPin(payload);
}

// Funcion: resetPassword
// Aqui cierro la recuperacion cambiando la contrasena y devolviendo nueva sesion.
async function resetPassword(payload) {
    return authModel.resetPasswordWithToken(payload);
}

// Funcion: authenticate
// Aqui valido el Bearer token y recupero la sesion viva del usuario.
// Lo hago en el controlador para que todas las rutas privadas reutilicen el mismo filtro.
async function authenticate(headers = {}) {
    const token = extractBearerToken(headers);
    const payload = verifyToken(token);

    if (!payload?.userId) {
        throw new HttpError(401, "Tu sesion expiro o no es valida.");
    }

    const session = await authModel.getSession(payload.userId);
    return {
        user: session.user,
        session
    };
}

module.exports = {
    login,
    getBootstrap,
    register,
    requestPasswordReset,
    verifyPasswordResetPin,
    resetPassword,
    authenticate
};
