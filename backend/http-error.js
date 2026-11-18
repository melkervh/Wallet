/**
 * Modulo: http-error.js
 *
 * Que hace: define el error de negocio con codigo HTTP.
 * Como lo hace: extiende Error y agrega `status`; server.js lo reconoce para responder con ese codigo y el
 *   mensaje.
 * Datos que participan: status (400, 401, 404, 409, 423...) y message.
 * Consultas SQL: ninguna.
 */

/**
 * Clase: HttpError
 *
 * Que hace: encapsula errores de negocio con un status HTTP explicito.
 * Como lo hace: el constructor llama a super(message) y guarda `status`.
 * Datos que participan: `status` (number) y `message` (texto mostrado al usuario).
 * Consultas SQL: ninguna.
 */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

module.exports = HttpError;
