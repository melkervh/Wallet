// Clase: HttpError
// Aqui encapsulo errores de negocio con un status HTTP explicito.
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

module.exports = HttpError;
