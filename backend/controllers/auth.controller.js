/**
 * Modulo: controllers/auth.controller.js
 *
 * Que hace: capa de entrada para autenticacion: login, registro, verificacion por PIN, recuperacion de
 *   contrasena y validacion del token de sesion.
 * Como lo hace: cada funcion delega en models/auth.model.js sin logica propia; el controlador es el punto de
 *   entrada que usa server.js.
 * Datos que participan: el id del usuario autenticado y el cuerpo/parametros de la solicitud HTTP.
 * Consultas SQL: ninguna directa; las ejecutan el modelo y sus DAOs.
 */

const { extractBearerToken, verifyToken } = require("../auth");
const HttpError = require("../http-error");
const authModel = require("../models/auth.model");

/**
 * Funcion: login
 *
 * Que hace: delega el acceso del usuario al modelo de autenticacion.
 * Como lo hace: llama a authModel.loginUser.
 * Datos que participan: `payload` { correo, contrasena }.
 * Consultas SQL: las del modelo (usuario, credenciales, bitacora de accesos).
 * Retorna: sesion con token.
 */
async function login(payload) {
    return authModel.loginUser(payload);
}

/**
 * Funcion: getBootstrap
 *
 * Que hace: consulta si la base ya tiene usuarios o si debe arrancar en modo registro.
 * Como lo hace: llama a authModel.getBootstrapState.
 * Datos que participan: ninguno.
 * Consultas SQL: SELECT COUNT(*) FROM usuarios.
 * Retorna: { totalUsers, hasUsers, requiresRegistration }.
 */
async function getBootstrap() {
    return authModel.getBootstrapState();
}

/**
 * Funcion: register
 *
 * Que hace: delega el alta de usuario con cuenta principal incluida.
 * Como lo hace: el modelo crea la cuenta, dispara el PIN por correo y deja pendiente la activacion final.
 * Datos que participan: `payload` con datos personales y contrasena.
 * Consultas SQL: INSERTs de usuario, credenciales, cuenta y PIN (ver auth.model).
 * Retorna: mensaje y datos de verificacion.
 */
async function register(payload) {
    return authModel.registerUser(payload);
}

/**
 * Funcion: verifyRegistrationPin
 *
 * Que hace: cierra la activacion de una cuenta nueva usando PIN o enlace de correo.
 * Como lo hace: llama a authModel.verifyRegistrationPin.
 * Datos que participan: `payload` { correo, pin | token }.
 * Consultas SQL: las del modelo.
 * Retorna: sesion activada.
 */
async function verifyRegistrationPin(payload) {
    return authModel.verifyRegistrationPin(payload);
}

/**
 * Funcion: resendRegistrationPin
 *
 * Que hace: reenvia un PIN de activacion cuando la persona todavia no completo la verificacion inicial.
 * Como lo hace: llama a authModel.resendRegistrationPin.
 * Datos que participan: `payload` { correo }.
 * Consultas SQL: las del modelo.
 * Retorna: mensaje de confirmacion.
 */
async function resendRegistrationPin(payload) {
    return authModel.resendRegistrationPin(payload);
}

/**
 * Funcion: requestPasswordReset
 *
 * Que hace: lanza el flujo para enviar el PIN de recuperacion.
 * Como lo hace: llama a authModel.requestPasswordReset.
 * Datos que participan: `payload` { correo }.
 * Consultas SQL: las del modelo.
 * Retorna: mensaje generico de confirmacion.
 */
async function requestPasswordReset(payload) {
    return authModel.requestPasswordReset(payload);
}

/**
 * Funcion: verifyPasswordResetPin
 *
 * Que hace: valida que el PIN ingresado siga activo y corresponda al usuario.
 * Como lo hace: llama a authModel.verifyPasswordResetPin.
 * Datos que participan: `payload` { correo, pin }.
 * Consultas SQL: las del modelo.
 * Retorna: resultado de la validacion.
 */
async function verifyPasswordResetPin(payload) {
    return authModel.verifyPasswordResetPin(payload);
}

/**
 * Funcion: resetPassword
 *
 * Que hace: cierra la recuperacion cambiando la contrasena y devolviendo nueva sesion.
 * Como lo hace: llama a authModel.resetPasswordWithToken.
 * Datos que participan: `payload` { token/pin, nueva contrasena }.
 * Consultas SQL: las del modelo.
 * Retorna: sesion nueva.
 */
async function resetPassword(payload) {
    return authModel.resetPasswordWithToken(payload);
}

/**
 * Funcion: authenticate
 *
 * Que hace: valida el Bearer token y recupera la sesion viva del usuario, para que todas las rutas privadas
 *   reutilicen el mismo filtro.
 * Como lo hace: extrae el token del header Authorization, verifica firma y vigencia (auth.js) y, si el payload
 *   trae userId, carga la sesion con authModel.getSession. Si no, lanza 401.
 * Datos que participan: `headers` de la solicitud HTTP.
 * Consultas SQL: las de getSession (usuario, alertas, no leidas).
 * Retorna: { user, session }.
 */
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

/**
 * Funcion: verifyTwoFactorLogin
 *
 * Que hace: delega la validacion del codigo del segundo paso de login.
 * Como lo hace: llama a authModel.verifyTwoFactorLogin.
 * Datos que participan: `payload` { token (desafio), pin, ipAddress, userAgent }.
 * Consultas SQL: las del modelo (accesos_usuario, usuarios, usuarios_credenciales).
 * Retorna: sesion { token, user, alerts, unreadAlerts }.
 */
async function verifyTwoFactorLogin(payload) {
    return authModel.verifyTwoFactorLogin(payload);
}

/**
 * Funcion: setTwoFactor
 *
 * Que hace: delega la activacion o desactivacion de la verificacion en dos pasos.
 * Como lo hace: llama a authModel.setTwoFactorEnabled.
 * Datos que participan: `userId`, `payload` { enabled, password, ipAddress, userAgent }.
 * Consultas SQL: las del modelo (usuarios_credenciales, alertas_usuario, accesos_usuario).
 * Retorna: { message, twoFactorEnabled }.
 */
async function setTwoFactor(userId, payload) {
    return authModel.setTwoFactorEnabled(userId, payload);
}

module.exports = {
    verifyTwoFactorLogin,
    setTwoFactor,
    login,
    getBootstrap,
    register,
    verifyRegistrationPin,
    resendRegistrationPin,
    requestPasswordReset,
    verifyPasswordResetPin,
    resetPassword,
    authenticate
};
