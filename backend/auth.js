const crypto = require("crypto");
const { config } = require("./env");

// Funcion: createPasswordHash
// Aqui transformo una contrasena en un hash scrypt con salt unica.
// Lo hago para no guardar claves en texto plano y poder verificarlas despues.
function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
}

// Funcion: verifyPassword
// Aqui comparo la contrasena recibida contra el formato guardado en la base.
// Tambien detecto hashes viejos para avisar si conviene rehashear al vuelo.
function verifyPassword(password, storedHash) {
    if (!storedHash) {
        return { valid: false, needsRehash: false };
    }

    if (storedHash.startsWith("scrypt$")) {
        const [, salt, expectedHash] = storedHash.split("$");
        if (!salt || !expectedHash) {
            return { valid: false, needsRehash: false };
        }

        const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
        const expectedBuffer = Buffer.from(expectedHash, "hex");
        const actualBuffer = Buffer.from(actualHash, "hex");

        if (expectedBuffer.length !== actualBuffer.length) {
            return { valid: false, needsRehash: false };
        }

        return {
            valid: crypto.timingSafeEqual(expectedBuffer, actualBuffer),
            needsRehash: false
        };
    }

    if (storedHash.startsWith("plain$")) {
        return {
            valid: storedHash.slice(6) === password,
            needsRehash: true
        };
    }

    return {
        valid: storedHash === password,
        needsRehash: true
    };
}

// Funcion: encodePayload
// Aqui convierto el payload del token a base64url para poder firmarlo.
function encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

// Funcion: decodePayload
// Aqui reconstruyo el payload original del token antes de validarlo.
function decodePayload(payload) {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// Funcion: signValue
// Aqui firmo cualquier valor sensible usando el secreto de la app.
// Esta firma es la base de la validez de nuestros tokens.
function signValue(value) {
    return crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
}

// Funcion: hashOneTimeToken
// Aqui hasheo PINes y tokens temporales antes de guardarlos.
// Lo hago para que tampoco queden expuestos en texto claro si la base se revisa.
function hashOneTimeToken(value) {
    return crypto.createHmac("sha256", config.appSecret).update(String(value || "")).digest("hex");
}

// Funcion: createOneTimePin
// Aqui genero un PIN numerico corto para recuperacion y verificaciones.
function createOneTimePin(length = 6) {
    const digits = "0123456789";
    const randomBytes = crypto.randomBytes(length);
    let pin = "";

    for (let index = 0; index < length; index += 1) {
        pin += digits[randomBytes[index] % digits.length];
    }

    return pin;
}

// Funcion: createOneTimeToken
// Aqui genero un token alfanumerico mas largo cuando hace falta una clave temporal.
function createOneTimeToken(length = 10) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const randomBytes = crypto.randomBytes(length);
    let token = "";

    for (let index = 0; index < length; index += 1) {
        token += alphabet[randomBytes[index] % alphabet.length];
    }

    return token;
}

// Funcion: createToken
// Aqui construyo el token de sesion con usuario, fecha de emision y expiracion.
// Luego firmo el payload para que el backend pueda detectar alteraciones.
function createToken(userId) {
    const payload = {
        userId,
        issuedAt: Date.now(),
        expiresAt: Date.now() + config.tokenDurationHours * 60 * 60 * 1000
    };

    const encodedPayload = encodePayload(payload);
    const signature = signValue(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

// Funcion: verifyToken
// Aqui valido formato, firma y vigencia del token de sesion.
// Si algo no cuadra devuelvo null para que la capa superior corte el acceso.
function verifyToken(token) {
    if (!token || !token.includes(".")) {
        return null;
    }

    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
        return null;
    }

    const expectedSignature = signValue(encodedPayload);
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (receivedBuffer.length !== expectedBuffer.length) {
        return null;
    }

    if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
        return null;
    }

    try {
        const payload = decodePayload(encodedPayload);
        if (!payload.expiresAt || payload.expiresAt < Date.now()) {
            return null;
        }

        return payload;
    } catch (error) {
        return null;
    }
}

// Funcion: extractBearerToken
// Aqui saco el token del header Authorization cuando llega como Bearer.
function extractBearerToken(headers = {}) {
    const authorization = headers.authorization || headers.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    return authorization.slice("Bearer ".length).trim();
}

module.exports = {
    createPasswordHash,
    verifyPassword,
    createToken,
    verifyToken,
    extractBearerToken,
    createOneTimePin,
    createOneTimeToken,
    hashOneTimeToken
};
