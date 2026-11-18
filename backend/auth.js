/**
 * Modulo: auth.js
 *
 * Que hace: utilidades criptograficas de autenticacion: hash de contrasenas, tokens de sesion firmados, PINs y
 *   tokens de un solo uso.
 * Como lo hace: usa el modulo nativo `crypto` (scrypt para contrasenas, HMAC-SHA256 para firmas y hashes,
 *   randomBytes para aleatoriedad).
 * Datos que participan: contrasenas, secreto de la app (config.appSecret), duracion del token
 *   (config.tokenDurationHours).
 * Consultas SQL: ninguna.
 */

const crypto = require("crypto");
const { config } = require("./env");

/**
 * Funcion: createPasswordHash
 *
 * Que hace: transforma una contrasena en un hash scrypt con salt unica, para no guardarla en texto plano.
 * Como lo hace: genera 16 bytes aleatorios de salt, deriva 64 bytes con scryptSync y devuelve
 *   "scrypt$salt$hash".
 * Datos que participan: `password`.
 * Consultas SQL: ninguna.
 * Retorna: string con formato scrypt$salt$hash.
 */
function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
}

/**
 * Funcion: verifyPassword
 *
 * Que hace: compara la contrasena recibida contra el formato guardado en la base y detecta hashes viejos.
 * Como lo hace: si es scrypt recalcula con la misma salt y compara con timingSafeEqual (evita ataques de
 *   tiempo); si es "plain$" o texto plano compara directo y marca needsRehash para migrarlo.
 * Datos que participan: `password`, `storedHash`.
 * Consultas SQL: ninguna.
 * Retorna: { valid, needsRehash }.
 */
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

/**
 * Funcion: encodePayload
 *
 * Que hace: convierte el payload del token a base64url para poder firmarlo.
 * Como lo hace: JSON.stringify y Buffer.toString("base64url").
 * Datos que participan: `payload` (objeto).
 * Consultas SQL: ninguna.
 * Retorna: string base64url.
 */
function encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Funcion: decodePayload
 *
 * Que hace: reconstruye el payload original del token antes de validarlo.
 * Como lo hace: decodifica base64url y hace JSON.parse (lanza si esta corrupto).
 * Datos que participan: `payload` (string base64url).
 * Consultas SQL: ninguna.
 * Retorna: objeto.
 */
function decodePayload(payload) {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

/**
 * Funcion: signValue
 *
 * Que hace: firma un valor sensible con el secreto de la app; es la base de la validez de los tokens.
 * Como lo hace: HMAC-SHA256 con config.appSecret, salida en base64url.
 * Datos que participan: `value`.
 * Consultas SQL: ninguna.
 * Retorna: firma (string).
 */
function signValue(value) {
    return crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
}

/**
 * Funcion: hashOneTimeToken
 *
 * Que hace: hashea PINes y tokens temporales antes de guardarlos para que no queden en texto claro.
 * Como lo hace: HMAC-SHA256 con config.appSecret, salida hexadecimal.
 * Datos que participan: `value` (PIN o token).
 * Consultas SQL: ninguna.
 * Retorna: hash hexadecimal.
 */
function hashOneTimeToken(value) {
    return crypto.createHmac("sha256", config.appSecret).update(String(value || "")).digest("hex");
}

/**
 * Funcion: createOneTimePin
 *
 * Que hace: genera un PIN numerico corto para recuperacion y verificaciones.
 * Como lo hace: toma bytes aleatorios criptograficos y mapea cada uno a un digito 0-9 con modulo.
 * Datos que participan: `length` (6 por defecto).
 * Consultas SQL: ninguna.
 * Retorna: string numerico.
 */
function createOneTimePin(length = 6) {
    const digits = "0123456789";
    const randomBytes = crypto.randomBytes(length);
    let pin = "";

    for (let index = 0; index < length; index += 1) {
        pin += digits[randomBytes[index] % digits.length];
    }

    return pin;
}

/**
 * Funcion: createOneTimeToken
 *
 * Que hace: genera un token alfanumerico mas largo cuando hace falta una clave temporal.
 * Como lo hace: bytes aleatorios mapeados a un alfabeto sin caracteres ambiguos (sin I, O, 0, 1).
 * Datos que participan: `length` (10 por defecto).
 * Consultas SQL: ninguna.
 * Retorna: string alfanumerico.
 */
function createOneTimeToken(length = 10) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const randomBytes = crypto.randomBytes(length);
    let token = "";

    for (let index = 0; index < length; index += 1) {
        token += alphabet[randomBytes[index] % alphabet.length];
    }

    return token;
}

/**
 * Funcion: createToken
 *
 * Que hace: construye el token de sesion con usuario, fecha de emision y expiracion.
 * Como lo hace: arma { userId, issuedAt, expiresAt } (ahora + tokenDurationHours), lo codifica y le agrega la
 *   firma: "payload.firma".
 * Datos que participan: `userId`.
 * Consultas SQL: ninguna.
 * Retorna: token string.
 */
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

/**
 * Funcion: verifyToken
 *
 * Que hace: valida formato, firma y vigencia del token de sesion.
 * Como lo hace: separa payload y firma, recalcula la firma esperada, compara con timingSafeEqual, decodifica y
 *   revisa expiresAt. Cualquier falla devuelve null.
 * Datos que participan: `token`.
 * Consultas SQL: ninguna.
 * Retorna: payload { userId, issuedAt, expiresAt } o null.
 */
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

/**
 * Funcion: extractBearerToken
 *
 * Que hace: saca el token del header Authorization cuando llega como Bearer.
 * Como lo hace: lee authorization/Authorization, exige el prefijo "Bearer " y recorta el resto.
 * Datos que participan: `headers`.
 * Consultas SQL: ninguna.
 * Retorna: token string o null.
 */
function extractBearerToken(headers = {}) {
    const authorization = headers.authorization || headers.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    return authorization.slice("Bearer ".length).trim();
}

/**
 * Funcion: hashesMatch
 *
 * Que hace: compara dos hashes hexadecimales sin filtrar informacion por tiempo de respuesta.
 * Como lo hace: convierte ambos a Buffer y usa crypto.timingSafeEqual (tarda lo mismo acierte o no);
 *               si las longitudes difieren devuelve false sin comparar.
 * Datos que participan: `a` y `b` (hashes producidos por hashOneTimeToken).
 * Consultas SQL: ninguna.
 * Retorna: boolean.
 */
function hashesMatch(a, b) {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

/**
 * Funcion: createTwoFactorChallengeToken
 *
 * Que hace: crea el "desafio" firmado que representa un segundo paso de login pendiente.
 * Como lo hace: arma un payload { purpose: "2fa", userId, jti, codeHash, expiresAt } con el HASH del codigo
 *               (nunca el codigo en claro), lo codifica y lo firma con HMAC usando el contexto "2fa:". Ese
 *               contexto distinto hace que el desafio NO sirva como token de sesion (verifyToken firma sin
 *               contexto) y que un token de sesion no sirva como desafio. No se guarda nada en la base.
 * Datos que participan: `userId`, `pin` (codigo enviado por correo) y `minutes` (vigencia).
 * Consultas SQL: ninguna.
 * Retorna: { token, jti } (jti identifica el desafio para limitar intentos y su uso unico).
 */
function createTwoFactorChallengeToken(userId, pin, minutes) {
    const payload = {
        purpose: "2fa",
        userId,
        jti: crypto.randomBytes(12).toString("hex"),
        codeHash: hashOneTimeToken(pin),
        expiresAt: Date.now() + Number(minutes || 10) * 60 * 1000
    };

    const encodedPayload = encodePayload(payload);
    return {
        token: `${encodedPayload}.${signValue("2fa:" + encodedPayload)}`,
        jti: payload.jti
    };
}

/**
 * Funcion: verifyTwoFactorChallengeToken
 *
 * Que hace: valida un desafio de segundo paso (formato, firma, proposito y vigencia).
 * Como lo hace: separa payload y firma, recalcula la firma con el contexto "2fa:", compara con
 *               timingSafeEqual, decodifica y exige purpose === "2fa" y expiresAt futuro. Cualquier falla
 *               devuelve null.
 * Datos que participan: `token` (el desafio que el navegador devuelve junto con el codigo).
 * Consultas SQL: ninguna.
 * Retorna: payload { userId, jti, codeHash, expiresAt } o null.
 */
function verifyTwoFactorChallengeToken(token) {
    if (!token || !String(token).includes(".")) {
        return null;
    }

    const [encodedPayload, signature] = String(token).split(".");
    if (!encodedPayload || !signature) {
        return null;
    }

    if (!hashesMatch(signature, signValue("2fa:" + encodedPayload))) {
        return null;
    }

    try {
        const payload = decodePayload(encodedPayload);
        if (payload.purpose !== "2fa" || !payload.userId || !payload.expiresAt || payload.expiresAt < Date.now()) {
            return null;
        }

        return payload;
    } catch (error) {
        return null;
    }
}

module.exports = {
    hashesMatch,
    createTwoFactorChallengeToken,
    verifyTwoFactorChallengeToken,
    createPasswordHash,
    verifyPassword,
    createToken,
    verifyToken,
    extractBearerToken,
    createOneTimePin,
    createOneTimeToken,
    hashOneTimeToken
};
