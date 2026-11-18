/**
 * Modulo: models/base.model.js
 *
 * Que hace: capa base de los modelos de negocio. Contiene validaciones de datos, generadores
 *           de referencias y las reglas compartidas (congelamiento por mora, sesion,
 *           resumen operativo).
 * Como lo hace: las consultas SQL ya no viven aqui, estan en la carpeta `backend/dao/`.
 *               Este modulo las importa y las vuelve a exportar con los MISMOS nombres de
 *               siempre, de modo que el resto de modelos (accounts, cards, transfer...)
 *               siguen funcionando sin cambiar sus imports (integracion pasiva del patron DAO).
 * Datos que participan: datos de formulario (correo, telefono, DUI, fecha de nacimiento,
 *                       direccion, contrasena) y los resultados de los DAOs.
 * Consultas SQL: ninguna directa; se delegan a los DAOs.
 */

const HttpError = require("../http-error");
const mappers = require("../dao/mappers");
const userDao = require("../dao/user.dao");
const alertDao = require("../dao/alert.dao");
const accountDao = require("../dao/account.dao");
const beneficiaryDao = require("../dao/beneficiary.dao");
const catalogDao = require("../dao/catalog.dao");
const salaryAdvanceDao = require("../dao/salary-advance.dao");
const movementDao = require("../dao/movement.dao");

const { toNumber, formatDate, buildProfileImageUrl, mapAccount } = mappers;

/**
 * Funcion: createReference
 *
 * Que hace: genera referencias internas con fecha y sufijo aleatorio (ej. TRF-20261111103000-A1B2C).
 * Como lo hace: concatena el prefijo, la marca de tiempo aaaammddhhmmss con ceros a la izquierda
 *               y 5 caracteres alfanumericos en mayuscula obtenidos de Math.random().toString(36).
 * Datos que participan: `prefix` (texto que identifica el tipo de operacion).
 * Retorna: string. Permite rastrear operaciones sin depender del id numerico de la base.
 */
function createReference(prefix) {
    const date = new Date();
    const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
        String(date.getHours()).padStart(2, "0"),
        String(date.getMinutes()).padStart(2, "0"),
        String(date.getSeconds()).padStart(2, "0")
    ].join("");
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${stamp}-${suffix}`;
}

/**
 * Funcion: createAccountNumber
 *
 * Que hace: arma el numero publico de wallet con el formato WL-000123-26.
 * Como lo hace: rellena el id del usuario a 6 digitos y le agrega los 2 ultimos digitos del
 *               anio actual.
 * Datos que participan: `userId`.
 * Retorna: string.
 */
function createAccountNumber(userId) {
    const yearSuffix = String(new Date().getFullYear()).slice(-2);
    return `WL-${String(userId).padStart(6, "0")}-${yearSuffix}`;
}

/**
 * Funcion: normalizeEmail
 *
 * Que hace: normaliza correos para compararlos y guardarlos siempre con el mismo criterio.
 * Como lo hace: convierte a string, recorta espacios y pasa a minusculas.
 * Datos que participan: `value` (correo escrito por el usuario).
 * Retorna: string.
 */
function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

/**
 * Funcion: ensureEmailAddress
 *
 * Que hace: valida un correo con reglas estrictas para cortar formatos rotos o sospechosos.
 * Como lo hace: normaliza y luego comprueba, en orden: que no este vacio, longitud maxima 150,
 *               exactamente un "@", parte local (max 64, solo caracteres permitidos, sin punto
 *               al inicio/fin ni "..") y dominio (max 253, al menos 2 etiquetas de max 63
 *               caracteres sin guion al borde, y TLD de solo letras con 2 o mas).
 * Datos que participan: `value`.
 * Retorna: el correo normalizado, o lanza HttpError 400 con el motivo.
 */
function ensureEmailAddress(value) {
    const email = normalizeEmail(value);
    const emailParts = email.split("@");

    if (!email) {
        throw new HttpError(400, "Debes ingresar un correo valido.");
    }

    if (email.length > 150) {
        throw new HttpError(400, "El correo excede la longitud permitida.");
    }

    if (emailParts.length !== 2) {
        throw new HttpError(400, "Ingresa un correo con un formato valido.");
    }

    const localPart = emailParts[0];
    const domainPart = emailParts[1];
    const domainLabels = domainPart.split(".");

    if (
        localPart.length > 64
        || domainPart.length > 253
        || !/^[a-z0-9._%+-]+$/i.test(localPart)
        || localPart.startsWith(".")
        || localPart.endsWith(".")
        || email.includes("..")
    ) {
        throw new HttpError(400, "Ingresa un correo con un formato valido.");
    }

    if (
        domainLabels.length < 2
        || domainLabels.some(function (label) {
            return (
                !label
                || label.length > 63
                || !/^[a-z0-9-]+$/i.test(label)
                || label.startsWith("-")
                || label.endsWith("-")
            );
        })
        || !/^[a-z]{2,}$/i.test(domainLabels[domainLabels.length - 1] || "")
    ) {
        throw new HttpError(400, "Ingresa un correo con un formato valido.");
    }

    return email;
}

/**
 * Funcion: cleanText
 *
 * Que hace: recorta espacios y limita la longitud para no propagar texto sucio al backend.
 * Como lo hace: String(value || "").trim() y slice(0, maxLength) cuando se indica un maximo.
 * Datos que participan: `value` y `maxLength` (opcional).
 * Retorna: string.
 */
function cleanText(value, maxLength) {
    const text = String(value || "").trim();
    return maxLength ? text.slice(0, maxLength) : text;
}

/**
 * Funcion: ensureHumanName
 *
 * Que hace: valida nombres y apellidos reales, sin numeros ni mezclas alfanumericas extranas.
 * Como lo hace: limpia el texto y exige minimo 2 caracteres; una expresion regular permite
 *               letras (con tildes, u y enie) separadas por espacio, apostrofe, guion o punto.
 * Datos que participan: `value`, `label` (nombre del campo para el mensaje), `maxLength` (80).
 * Retorna: el texto limpio, o lanza HttpError 400.
 */
function ensureHumanName(value, label, maxLength = 80) {
    const text = cleanText(value, maxLength);

    if (!text) {
        throw new HttpError(400, `Debes completar ${label}.`);
    }

    if (text.length < 2) {
        throw new HttpError(400, `${label} debe tener al menos 2 caracteres.`);
    }

    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-\.][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/.test(text)) {
        throw new HttpError(400, `${label} solo puede contener letras, espacios y signos de nombre validos.`);
    }

    return text;
}

/**
 * Funcion: ensurePhoneNumber
 *
 * Que hace: valida el telefono como dato de contacto real y descarta patrones claramente falsos.
 * Como lo hace: exige que exista, que solo tenga digitos, +, espacios, parentesis o guiones,
 *               que tenga entre 8 y 15 digitos, que no sean todos iguales y que no empiece
 *               por secuencias tipicas (12345678, 00000000, 99999999...).
 * Datos que participan: `value`, `label` (nombre del campo para el mensaje).
 * Retorna: el telefono limpio tal como se escribio, o lanza HttpError 400.
 */
function ensurePhoneNumber(value, label = "telefono") {
    const rawPhone = cleanText(value, 25);
    const digits = rawPhone.replace(/\D/g, "");

    if (!rawPhone) {
        throw new HttpError(400, `Debes completar ${label}.`);
    }

    if (!/^[+\d\s()-]+$/.test(rawPhone)) {
        throw new HttpError(400, `Ingresa un ${label} valido.`);
    }

    if (digits.length < 8 || digits.length > 15) {
        throw new HttpError(400, `El ${label} debe tener entre 8 y 15 digitos.`);
    }

    if (/^(\d)\1+$/.test(digits)) {
        throw new HttpError(400, `El ${label} no parece real.`);
    }

    if (/^(12345678|123456789|00000000|99999999)/.test(digits)) {
        throw new HttpError(400, `El ${label} no parece real.`);
    }

    return rawPhone;
}

/**
 * Funcion: normalizeDui
 *
 * Que hace: normaliza el DUI al formato 12345678-9 para compararlo y guardarlo siempre igual.
 * Como lo hace: deja solo digitos, exige exactamente 9, rechaza los repetidos (111111111) y
 *               coloca el guion antes del ultimo digito.
 * Datos que participan: `value`.
 * Retorna: string con guion, "" si viene vacio, o lanza HttpError 400.
 */
function normalizeDui(value) {
    const digits = cleanText(value, 20).replace(/\D/g, "");

    if (!digits) {
        return "";
    }

    if (digits.length !== 9) {
        throw new HttpError(400, "El DUI debe tener exactamente 9 digitos.");
    }

    if (/^(\d)\1+$/.test(digits)) {
        throw new HttpError(400, "El DUI no parece valido.");
    }

    return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

/**
 * Funcion: ensureDui
 *
 * Que hace: obliga a que el DUI exista y tenga el formato correcto antes de registrarlo.
 * Como lo hace: llama a normalizeDui y lanza error si el resultado esta vacio.
 * Datos que participan: `value`.
 * Retorna: DUI normalizado, o lanza HttpError 400.
 */
function ensureDui(value) {
    const normalizedDui = normalizeDui(value);

    if (!normalizedDui) {
        throw new HttpError(400, "Debes ingresar un DUI valido.");
    }

    return normalizedDui;
}

/**
 * Funcion: ensureBirthDateIsAdult
 *
 * Que hace: valida la fecha de nacimiento y exige mayoria de edad (18 anios).
 * Como lo hace: interpreta la fecha como medianoche local, verifica que sea valida y no
 *               futura, y calcula la edad restando anios y ajustando si aun no cumplio
 *               anios este ano (comparando mes y dia).
 * Datos que participan: `value` (aaaa-mm-dd), `required` (si es obligatoria).
 * Retorna: la fecha limpia, "" si es opcional y vino vacia, o lanza HttpError 400.
 */
function ensureBirthDateIsAdult(value, required = false) {
    const rawDate = cleanText(value, 30);

    if (!rawDate) {
        if (required) {
            throw new HttpError(400, "Debes ingresar tu fecha de nacimiento.");
        }

        return "";
    }

    const parsedDate = new Date(`${rawDate}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
        throw new HttpError(400, "La fecha de nacimiento no es valida.");
    }

    const now = new Date();
    if (parsedDate >= now) {
        throw new HttpError(400, "La fecha de nacimiento no puede ser futura.");
    }

    let age = now.getFullYear() - parsedDate.getFullYear();
    const monthDiff = now.getMonth() - parsedDate.getMonth();
    const dayDiff = now.getDate() - parsedDate.getDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        age -= 1;
    }

    if (age < 18) {
        throw new HttpError(400, "Debes ser mayor de edad para registrarte en la wallet.");
    }

    return rawDate;
}

/**
 * Funcion: ensureAddressText
 *
 * Que hace: limpia y valida la direccion rechazando caracteres que no aportan al dato real.
 * Como lo hace: limita a 300 caracteres, exige minimo 10 y solo permite letras, numeros,
 *               espacios y # . , - /
 * Datos que participan: `value`, `required`.
 * Retorna: la direccion limpia, "" si es opcional y vino vacia, o lanza HttpError 400.
 */
function ensureAddressText(value, required = false) {
    const address = cleanText(value, 300);

    if (!address) {
        if (required) {
            throw new HttpError(400, "Debes ingresar tu direccion.");
        }

        return "";
    }

    if (address.length < 10) {
        throw new HttpError(400, "La direccion debe ser mas completa.");
    }

    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9#.,\-\/\s]+$/.test(address)) {
        throw new HttpError(400, "La direccion contiene caracteres no permitidos.");
    }

    return address;
}

/**
 * Funcion: ensureUniqueUserIdentityData
 *
 * Que hace: revisa duplicados sensibles (correo, telefono, DUI) antes de guardar un usuario.
 * Como lo hace: normaliza los tres datos, delega la busqueda a userDao.findDuplicatedIdentity
 *               y, si hay coincidencia, decide el mensaje segun cual dato choco (correo,
 *               luego telefono, luego DUI). La regla de negocio vive aqui; el SQL en el DAO.
 * Datos que participan: `executor` (pool o client), `{ email, phone, documentId,
 *                       excludeUserId }`; excludeUserId evita compararse consigo mismo al editar.
 * Retorna: nada si no hay duplicado; lanza HttpError 409 si lo hay.
 */
async function ensureUniqueUserIdentityData(executor, { email, phone, documentId, excludeUserId = 0 }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhoneDigits = cleanText(phone, 25).replace(/\D/g, "");
    const normalizedDui = documentId ? normalizeDui(documentId) : "";

    const duplicatedUser = await userDao.findDuplicatedIdentity(executor, {
        email: normalizedEmail,
        phoneDigits: normalizedPhoneDigits,
        dui: normalizedDui,
        excludeUserId
    });

    if (!duplicatedUser) {
        return;
    }

    if (normalizeEmail(duplicatedUser.correo) === normalizedEmail) {
        throw new HttpError(409, "Ya existe un usuario registrado con ese correo.");
    }

    if (
        normalizedPhoneDigits
        && cleanText(duplicatedUser.telefono, 25).replace(/\D/g, "") === normalizedPhoneDigits
    ) {
        throw new HttpError(409, "Ese telefono ya esta vinculado a otra cuenta.");
    }

    if (normalizedDui && duplicatedUser.documento_identidad === normalizedDui) {
        throw new HttpError(409, "Ese DUI ya esta vinculado a otra cuenta.");
    }
}

/**
 * Funcion: ensurePasswordStrength
 *
 * Que hace: exige la complejidad minima de contrasena antes de aceptar registros o resets.
 * Como lo hace: comprueba largo minimo de 8 y la presencia de al menos una letra y un numero.
 * Datos que participan: `password`.
 * Retorna: nada si es valida; lanza HttpError 400 si no.
 */
function ensurePasswordStrength(password) {
    const rawPassword = String(password || "");
    if (rawPassword.length < 8) {
        throw new HttpError(400, "La contrasena debe tener al menos 8 caracteres.");
    }

    if (!/[A-Za-z]/.test(rawPassword) || !/[0-9]/.test(rawPassword)) {
        throw new HttpError(400, "La contrasena debe incluir letras y numeros.");
    }
}

/**
 * Funcion: ensureWalletOperationAllowed
 *
 * Que hace: revisa si la wallet del usuario esta congelada por mora en un adelanto salarial.
 * Como lo hace: obtiene el adelanto vigente con salaryAdvanceDao.getActiveSalaryAdvance (que
 *               antes sincroniza estados). Si no hay adelanto o no congela operaciones, lo
 *               devuelve; si esta congelado y `allowAdvancePayment` es true tambien lo
 *               devuelve (para permitir solo el pago de ese adelanto); en otro caso lanza 423.
 * Datos que participan: `userId`, `executor`, `options.allowAdvancePayment`.
 * Retorna: el adelanto vigente (o null), o lanza HttpError 423 (Locked).
 */
async function ensureWalletOperationAllowed(userId, executor, options = {}) {
    const currentAdvance = await salaryAdvanceDao.getActiveSalaryAdvance(userId, executor);
    const allowAdvancePayment = Boolean(options.allowAdvancePayment);

    if (!currentAdvance || !currentAdvance.operacionesCongeladas) {
        return currentAdvance;
    }

    if (allowAdvancePayment) {
        return currentAdvance;
    }

    throw new HttpError(
        423,
        `Tu wallet esta congelada por mora en el adelanto ${currentAdvance.numeroAdelanto}. Solo puedes pagar ese adelanto hasta regularizarlo.`
    );
}

/**
 * Funcion: getOperationSnapshot
 *
 * Que hace: mezcla el resumen mensual con la ultima transferencia para la seccion operativa.
 * Como lo hace: pide a movementDao el resumen del mes y la transferencia mas reciente
 *               (filtro type = "transferencia", limit = 1) y los combina en un solo objeto.
 * Datos que participan: `userId`, `executor`.
 * Retorna: resumen mensual + `ultimaTransferencia` (movimiento mapeado o null).
 */
async function getOperationSnapshot(userId, executor) {
    const monthlySummary = await movementDao.getMonthlySummary(userId, executor);
    const recentTransferRows = await movementDao.getMovementRows(
        userId,
        { type: "transferencia", limit: 1 },
        executor
    );

    return {
        ...monthlySummary,
        ultimaTransferencia: recentTransferRows[0] ? mappers.mapMovement(recentTransferRows[0]) : null
    };
}

/**
 * Funcion: getSession
 *
 * Que hace: reconstruye la sesion viva del usuario con perfil, alertas y contador pendiente.
 * Como lo hace: lanza en paralelo (Promise.all) tres lecturas de los DAOs: usuario, ultimas 5
 *               alertas y cantidad de no leidas. Si el usuario ya no existe, lanza 401.
 * Datos que participan: `userId`, `executor`.
 * Retorna: { user, alerts, unreadAlerts }.
 */
async function getSession(userId, executor) {
    const [user, alerts, unreadAlerts] = await Promise.all([
        userDao.getUserById(userId, executor),
        alertDao.getAlerts(userId, 5, executor),
        alertDao.getUnreadAlertCount(userId, executor)
    ]);

    if (!user) {
        throw new HttpError(401, "La sesion ya no es valida.");
    }

    return {
        user,
        alerts,
        unreadAlerts
    };
}

module.exports = {
    HttpError,
    toNumber,
    formatDate,
    createReference,
    createAccountNumber,
    normalizeEmail,
    ensureEmailAddress,
    cleanText,
    ensureHumanName,
    ensurePhoneNumber,
    normalizeDui,
    ensureDui,
    ensureBirthDateIsAdult,
    ensureAddressText,
    ensureUniqueUserIdentityData,
    buildProfileImageUrl,
    ensurePasswordStrength,
    insertAlert: alertDao.insertAlert,
    insertAccessLog: alertDao.insertAccessLog,
    getUserById: userDao.getUserById,
    getAlerts: alertDao.getAlerts,
    getUnreadAlertCount: alertDao.getUnreadAlertCount,
    getAccounts: accountDao.getAccounts,
    getFavoriteBeneficiaries: beneficiaryDao.getFavoriteBeneficiaries,
    getCards: accountDao.getCards,
    getPayments: accountDao.getPayments,
    getBootstrapState: catalogDao.getBootstrapState,
    getBankCatalog: catalogDao.getBankCatalog,
    getServiceProviderCatalog: catalogDao.getServiceProviderCatalog,
    syncSalaryAdvanceStatuses: salaryAdvanceDao.syncSalaryAdvanceStatuses,
    getActiveSalaryAdvance: salaryAdvanceDao.getActiveSalaryAdvance,
    ensureWalletOperationAllowed,
    getMovementRows: movementDao.getMovementRows,
    getMovements: movementDao.getMovements,
    getMonthlySummary: movementDao.getMonthlySummary,
    getOperationSnapshot,
    getSession,
    insertOrUpdateBeneficiary: beneficiaryDao.insertOrUpdateBeneficiary,
    mapAccount
};
