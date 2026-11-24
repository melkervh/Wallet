/**
 * Modulo: server.js
 *
 * Que hace: punto de entrada de la aplicacion. Levanta un servidor HTTP nativo de Node.js que sirve el
 *   frontend estatico (HTML, CSS, JS, imagenes), la API REST /api/*, y los recursos de SEO (robots.txt y
 *   sitemap.xml).
 * Como lo hace: un unico manejador (handleRequest) decide si la ruta es una redireccion, robots/sitemap, API o
 *   archivo estatico. La API se enruta manualmente en handleApiRequest: primero rutas publicas, luego rutas
 *   autenticadas (Bearer token) y por ultimo 404. Todas las respuestas llevan cabeceras de seguridad y los
 *   errores se convierten a JSON con el status de HttpError.
 * Datos que participan: solicitud HTTP (metodo, ruta, cabeceras, cuerpo JSON), configuracion de env.js,
 *   controladores y el almacen en memoria del rate limit.
 * Consultas SQL: solo SELECT 1 en el arranque (healthCheck); el resto lo ejecutan los controladores, modelos y
 *   DAOs.
 */

const fs = require("fs/promises");
const zlib = require("zlib");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { config } = require("./backend/env");
const { healthCheck } = require("./backend/db");
const HttpError = require("./backend/http-error");
const authController = require("./backend/controllers/auth.controller");
const accountsController = require("./backend/controllers/accounts.controller");
const alertsController = require("./backend/controllers/alerts.controller");
const cardsController = require("./backend/controllers/cards.controller");
const catalogController = require("./backend/controllers/catalog.controller");
const dashboardController = require("./backend/controllers/dashboard.controller");
const forexController = require("./backend/controllers/forex.controller");
const profileController = require("./backend/controllers/profile.controller");
const salaryAdvanceController = require("./backend/controllers/salary-advance.controller");
const savingsController = require("./backend/controllers/savings.controller");
const servicesController = require("./backend/controllers/services.controller");
const transferController = require("./backend/controllers/transfer.controller");

const rootDirectory = __dirname;

// Este mapa de MIME me permite servir archivos estaticos
// sin depender de otro servidor o framework adicional.
const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp"
};

const rateLimitStore = new Map();

/**
 * Funcion: buildSecurityHeaders
 *
 * Que hace: concentra cabeceras HTTP defensivas basicas para reducir vectores triviales del navegador.
 * Como lo hace: devuelve nosniff, X-Frame-Options DENY (anti clickjacking), Referrer-Policy same-origin,
 *   Permissions-Policy que bloquea camara/microfono/geolocalizacion y Cross-Origin-Resource-Policy same-origin,
 *   mas las cabeceras extra recibidas.
 * Datos que participan: `extraHeaders`.
 * Consultas SQL: ninguna directa.
 * Retorna: objeto de cabeceras.
 */
function buildSecurityHeaders(extraHeaders = {}) {
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cross-Origin-Resource-Policy": "same-origin",
        ...extraHeaders
    };
}

/**
 * Funcion: sendJson
 *
 * Que hace: centraliza las respuestas JSON para mantener encoding y cache coherentes.
 * Como lo hace: escribe status y cabeceras (Content-Type JSON utf-8, Cache-Control no-store para que no se
 *   cacheen datos de la cuenta) y serializa el payload.
 * Datos que participan: `response`, `statusCode`, `payload`.
 * Consultas SQL: ninguna directa.
 * Retorna: nada (termina la respuesta).
 */
function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, buildSecurityHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    }));
    response.end(JSON.stringify(payload));
}

/**
 * Funcion: sendRedirect
 *
 * Que hace: resuelve redirecciones simples, por ejemplo al login inicial.
 * Como lo hace: responde 302 con la cabecera Location.
 * Datos que participan: `response`, `location`.
 * Consultas SQL: ninguna directa.
 * Retorna: nada.
 */
function sendRedirect(response, location) {
    response.writeHead(302, buildSecurityHeaders({
        Location: location
    }));
    response.end();
}

/**
 * Funcion: sendText
 *
 * Que hace: devuelve respuestas planas para errores o accesos denegados.
 * Como lo hace: responde con Content-Type text/plain.
 * Datos que participan: `response`, `statusCode`, `text`.
 * Consultas SQL: ninguna directa.
 * Retorna: nada.
 */
function sendText(response, statusCode, text) {
    response.writeHead(statusCode, buildSecurityHeaders({
        "Content-Type": "text/plain; charset=utf-8"
    }));
    response.end(text);
}

/**
 * Funcion: getRequestBaseUrl
 *
 * Que hace: reconstruye la URL publica real desde la solicitud actual, para no depender de APP_BASE_URL cuando
 *   el proyecto corre por tunel y el host cambia.
 * Como lo hace: prioriza el header Origin; si no, usa x-forwarded-host/host y el protocolo de
 *   x-forwarded-proto o cf-visitor (Cloudflare); sin informacion, cae en config.appBaseUrl.
 * Datos que participan: `request`.
 * Consultas SQL: ninguna directa.
 * Retorna: URL base sin barra final.
 */
function getRequestBaseUrl(request) {
    const originHeader = String(request.headers.origin || "").trim();
    if (/^https?:\/\//i.test(originHeader)) {
        return originHeader.replace(/\/+$/, "");
    }

    const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "")
        .split(",")[0]
        .trim();

    let protocol = String(request.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim()
        .toLowerCase();

    if (!protocol) {
        const rawCfVisitor = String(request.headers["cf-visitor"] || "").trim();
        if (rawCfVisitor) {
            try {
                const parsedCfVisitor = JSON.parse(rawCfVisitor);
                protocol = String(parsedCfVisitor.scheme || "").trim().toLowerCase();
            } catch (error) {
                // Aqui ignoro errores de parseo y sigo con el fallback normal.
            }
        }
    }

    if (!protocol) {
        protocol = "http";
    }

    if (forwardedHost) {
        return `${protocol}://${forwardedHost}`;
    }

    return String(config.appBaseUrl || "").replace(/\/+$/, "");
}

/**
 * Funcion: enforceJsonContentType
 *
 * Que hace: valida que las rutas API con cuerpo reciban JSON real, cortando peticiones mal formadas antes de
 *   leer el body completo.
 * Como lo hace: solo evalua POST, PUT y PATCH y exige que Content-Type contenga application/json (si no, 415).
 * Datos que participan: `request`.
 * Consultas SQL: ninguna directa.
 * Retorna: nada; lanza HttpError 415.
 */
function enforceJsonContentType(request) {
    if (!["POST", "PUT", "PATCH"].includes(request.method || "")) {
        return;
    }

    const rawContentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!rawContentType.includes("application/json")) {
        throw new HttpError(415, "Esta ruta solo acepta cuerpos JSON.");
    }
}

/**
 * Funcion: enforceRateLimit
 *
 * Que hace: aplica un rate limit sencillo en memoria por IP y ruta sensible; no reemplaza una capa perimetral
 *   pero frena abuso basico en login, reset y adelantos.
 * Como lo hace: guarda en un Map las marcas de tiempo de cada clave 'ruta:IP', descarta las que salieron de la
 *   ventana y, si ya se alcanzo el limite, lanza 429; si no, registra la nueva solicitud.
 * Datos que participan: `request`, `key`, `options` { limit (10 por defecto), windowMs (60 000 ms por defecto)
 *   }.
 * Consultas SQL: ninguna directa.
 * Retorna: nada; lanza HttpError 429.
 */
function enforceRateLimit(request, key, options = {}) {
    const limit = Number(options.limit || 10);
    const windowMs = Number(options.windowMs || 60_000);
    const now = Date.now();
    const ipAddress = getClientIpAddress(request) || "desconocido";
    const bucketKey = `${key}:${ipAddress}`;
    const previousHits = rateLimitStore.get(bucketKey) || [];
    const activeHits = previousHits.filter((timestamp) => now - timestamp < windowMs);

    if (activeHits.length >= limit) {
        throw new HttpError(429, "Se alcanzo el limite temporal de solicitudes. Intenta de nuevo en unos minutos.");
    }

    activeHits.push(now);
    rateLimitStore.set(bucketKey, activeHits);
}

/**
 * Funcion: parseJsonBody
 *
 * Que hace: lee el cuerpo de la solicitud y lo convierte a objeto.
 * Como lo hace: acumula los fragmentos contando bytes; si superan config.httpMaxBodyBytes lanza 413; un cuerpo
 *   vacio devuelve {}; un JSON roto lanza 400 legible.
 * Datos que participan: `request`.
 * Consultas SQL: ninguna directa.
 * Retorna: objeto.
 */
async function parseJsonBody(request) {
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of request) {
        totalBytes += chunk.length;
        if (totalBytes > config.httpMaxBodyBytes) {
            throw new HttpError(413, "El cuerpo de la solicitud supera el limite permitido.");
        }

        chunks.push(chunk);
    }

    if (!chunks.length) {
        return {};
    }

    const rawBody = Buffer.concat(chunks).toString("utf8").trim();
    if (!rawBody) {
        return {};
    }

    try {
        return JSON.parse(rawBody);
    } catch (error) {
        throw new HttpError(400, "El cuerpo enviado no es JSON valido.");
    }
}

/**
 * Funcion: getClientIpAddress
 *
 * Que hace: obtiene la IP real considerando proxy y ejecucion local.
 * Como lo hace: usa el primer valor de x-forwarded-for; si no existe usa socket.remoteAddress, quitando el
 *   prefijo ::ffff: de IPv4 mapeada y convirtiendo ::1 en 127.0.0.1.
 * Datos que participan: `request`.
 * Consultas SQL: ninguna directa.
 * Retorna: string con la IP.
 */
function getClientIpAddress(request) {
    const forwarded = request.headers["x-forwarded-for"];
    if (forwarded) {
        return String(forwarded).split(",")[0].trim();
    }

    const remoteAddress = request.socket?.remoteAddress || "";
    if (remoteAddress.startsWith("::ffff:")) {
        return remoteAddress.slice(7);
    }

    if (remoteAddress === "::1") {
        return "127.0.0.1";
    }

    return remoteAddress;
}

/**
 * Funcion: handleApiRequest
 *
 * Que hace: concentra el ruteo manual de toda la API; el orden importa: rutas publicas, luego autenticadas y
 *   por ultimo el 404.
 * Como lo hace: compara metodo y ruta; en las publicas aplica rate limit donde hay riesgo (login, registro,
 *   verificacion, reset, adelantos); en las privadas llama a authController.authenticate (Bearer token), lee el
 *   JSON y delega en el controlador correspondiente.
 * Datos que participan: `request`, `response`, `url`. Rutas publicas: GET /api/health, POST /api/auth/login,
 *   GET /api/auth/bootstrap, POST /api/auth/register (+/verify, +/resend), POST
 *   /api/auth/password-reset/(request|verify|confirm). Rutas privadas: sesion, catalogos, dashboard, perfil,
 *   movimientos, tarjetas, cuentas, alertas, servicios, ahorros, adelanto salarial, forex, beneficiarios y
 *   transferencias.
 * Consultas SQL: las de cada controlador; /api/health ejecuta SELECT 1.
 * Retorna: nada; escribe la respuesta JSON y lanza HttpError 404 si la ruta no existe.
 */
async function handleApiRequest(request, response, url) {
    if (request.method === "OPTIONS") {
        response.writeHead(204, buildSecurityHeaders());
        response.end();
        return;
    }

    enforceJsonContentType(request);

    // Salud del servicio para monitoreo rapido.
    if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
            ok: true,
            service: "wallet-api"
        });
        return;
    }

    // Flujo de autenticacion y bootstrap inicial.
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
        enforceRateLimit(request, "auth-login", {
            limit: 8,
            windowMs: 10 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.login({
            email: body.email,
            password: body.password,
            ipAddress: getClientIpAddress(request),
            userAgent: String(request.headers["user-agent"] || "web")
        });

        sendJson(response, 200, result);
        return;
    }

    // Segundo paso del login: el desafio firmado + el codigo del correo se canjean por el token de sesion.
    if (request.method === "POST" && url.pathname === "/api/auth/login/verify-2fa") {
        enforceRateLimit(request, "auth-login-2fa", {
            limit: 15,
            windowMs: 10 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.verifyTwoFactorLogin({
            token: body.twoFactorToken,
            pin: body.pin,
            ipAddress: getClientIpAddress(request),
            userAgent: String(request.headers["user-agent"] || "web")
        });

        sendJson(response, 200, result);
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/bootstrap") {
        const bootstrap = await authController.getBootstrap();
        sendJson(response, 200, bootstrap);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
        enforceRateLimit(request, "auth-register", {
            limit: 5,
            windowMs: 30 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.register({
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: body.phone,
            birthDate: body.birthDate,
            documentId: body.documentId,
            address: body.address,
            password: body.password,
            requestBaseUrl: getRequestBaseUrl(request),
            ipAddress: getClientIpAddress(request),
            userAgent: String(request.headers["user-agent"] || "web")
        });

        sendJson(response, 201, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register/verify") {
        enforceRateLimit(request, "auth-register-verify", {
            limit: 8,
            windowMs: 20 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.verifyRegistrationPin({
            email: body.email,
            pin: body.pin,
            ipAddress: getClientIpAddress(request),
            userAgent: String(request.headers["user-agent"] || "web")
        });

        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register/resend") {
        enforceRateLimit(request, "auth-register-resend", {
            limit: 5,
            windowMs: 30 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.resendRegistrationPin({
            email: body.email,
            requestBaseUrl: getRequestBaseUrl(request),
            ipAddress: getClientIpAddress(request)
        });

        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password-reset/request") {
        enforceRateLimit(request, "auth-password-reset-request", {
            limit: 4,
            windowMs: 15 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.requestPasswordReset({
            email: body.email,
            requestBaseUrl: getRequestBaseUrl(request),
            ipAddress: getClientIpAddress(request)
        });

        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password-reset/verify") {
        enforceRateLimit(request, "auth-password-reset-verify", {
            limit: 8,
            windowMs: 15 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.verifyPasswordResetPin({
            email: body.email,
            pin: body.pin
        });

        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password-reset/confirm") {
        enforceRateLimit(request, "auth-password-reset-confirm", {
            limit: 6,
            windowMs: 15 * 60 * 1000
        });

        const body = await parseJsonBody(request);
        const result = await authController.resetPassword({
            email: body.email,
            pin: body.pin,
            newPassword: body.newPassword,
            ipAddress: getClientIpAddress(request),
            userAgent: String(request.headers["user-agent"] || "web")
        });

        sendJson(response, 200, result);
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/session") {
        const { session } = await authController.authenticate(request.headers);
        sendJson(response, 200, session);
        return;
    }

    // Catalogos publicos que el frontend necesita para formularios base.
    if (request.method === "GET" && url.pathname === "/api/catalogs") {
        const catalogs = await catalogController.getCatalogs();
        sendJson(response, 200, catalogs);
        return;
    }

    // Dashboard y perfil requieren sesion valida.
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const { user } = await authController.authenticate(request.headers);
        const dashboard = await dashboardController.getDashboard(user.id);
        sendJson(response, 200, dashboard);
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/profile") {
        const { user } = await authController.authenticate(request.headers);
        const profile = await profileController.getProfile(user.id);
        sendJson(response, 200, profile);
        return;
    }

    // Activa o desactiva la verificacion en dos pasos (exige la contrasena actual).
    if (request.method === "POST" && url.pathname === "/api/auth/two-factor") {
        enforceRateLimit(request, "auth-two-factor-toggle", {
            limit: 10,
            windowMs: 10 * 60 * 1000
        });

        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await authController.setTwoFactor(user.id, {
            enabled: body.enabled,
            password: body.password,
            ipAddress: getClientIpAddress(request),
            userAgent: String(request.headers["user-agent"] || "web")
        });
        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/profile") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const profile = await profileController.updateProfile(user.id, body);
        sendJson(response, 200, profile);
        return;
    }

    // Historial y metadata operativa para transferencias.
    if (request.method === "GET" && url.pathname === "/api/movements") {
        const { user } = await authController.authenticate(request.headers);
        const movements = await dashboardController.getMovements(user.id, {
            search: url.searchParams.get("search") || "",
            type: url.searchParams.get("type") || "todos",
            status: url.searchParams.get("status") || "todos",
            limit: url.searchParams.get("limit") || "100"
        });

        sendJson(response, 200, {
            items: movements
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/transfers/metadata") {
        const { user } = await authController.authenticate(request.headers);
        const metadata = await transferController.getTransferMetadata(user.id);
        sendJson(response, 200, metadata);
        return;
    }

    // Centro de tarjetas y vinculacion de nuevas tarjetas.
    if (request.method === "GET" && url.pathname === "/api/cards") {
        const { user } = await authController.authenticate(request.headers);
        const center = await cardsController.getCenter(user.id);
        sendJson(response, 200, center);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/cards") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await cardsController.linkCard(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    // Cuentas secundarias y gestion del centro de cuentas.
    if (request.method === "GET" && url.pathname === "/api/accounts") {
        const { user } = await authController.authenticate(request.headers);
        const center = await accountsController.getCenter(user.id);
        sendJson(response, 200, center);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/accounts") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await accountsController.createSecondary(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    // Centro de alertas y acciones de lectura o borrado.
    if (request.method === "GET" && url.pathname === "/api/alerts") {
        const { user } = await authController.authenticate(request.headers);
        const center = await alertsController.getCenter(user.id);
        sendJson(response, 200, center);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/alerts/mark-read") {
        const { user } = await authController.authenticate(request.headers);
        const result = await alertsController.markAllAsRead(user.id);
        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/alerts/delete") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await alertsController.removeAlert(user.id, body.alertId);
        sendJson(response, 200, result);
        return;
    }

    // Servicios vinculados y pagos desde wallet.
    if (request.method === "GET" && url.pathname === "/api/services/center") {
        const { user } = await authController.authenticate(request.headers);
        const center = await servicesController.getCenter(user.id);
        sendJson(response, 200, center);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/services/link") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await servicesController.linkService(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/services/pay") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await servicesController.payService(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    // Bolsillos de ahorro y movimientos internos hacia ahorro.
    if (request.method === "GET" && url.pathname === "/api/savings") {
        const { user } = await authController.authenticate(request.headers);
        const center = await savingsController.getCenter(user.id);
        sendJson(response, 200, center);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/savings") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await savingsController.createPocket(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/savings/deposit") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await savingsController.deposit(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    // Adelanto salarial activo y nuevas solicitudes.
    if (request.method === "GET" && url.pathname === "/api/salary-advance") {
        const { user } = await authController.authenticate(request.headers);
        const center = await salaryAdvanceController.getCenter(user.id);
        sendJson(response, 200, center);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/salary-advance/request-code") {
        enforceRateLimit(request, "salary-advance-code", {
            limit: 5,
            windowMs: 30 * 60 * 1000
        });

        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await salaryAdvanceController.requestAdvanceCode(user.id, body);
        sendJson(response, 200, result);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/salary-advance") {
        enforceRateLimit(request, "salary-advance-request", {
            limit: 6,
            windowMs: 30 * 60 * 1000
        });

        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const result = await salaryAdvanceController.requestAdvance(user.id, body);
        sendJson(response, 201, result);
        return;
    }

    // Forex se mantiene publico para aprendizaje y simulacion.
    if (request.method === "GET" && url.pathname === "/api/forex/learning") {
        const content = await forexController.getLearningContent({
            pair: url.searchParams.get("pair") || "EURUSD"
        });
        sendJson(response, 200, content);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/forex/simulate") {
        const body = await parseJsonBody(request);
        const result = await forexController.simulate(body);
        sendJson(response, 200, result);
        return;
    }

    // Beneficiarios y transferencias de dinero.
    if (request.method === "POST" && url.pathname === "/api/beneficiaries") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const beneficiary = await transferController.createBeneficiary(user.id, body);
        sendJson(response, 201, {
            message: "Beneficiario guardado correctamente.",
            beneficiary
        });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/beneficiaries/remove-favorite") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const beneficiary = await transferController.removeFavoriteBeneficiary(user.id, body.beneficiaryId);
        sendJson(response, 200, {
            message: "Favorito eliminado correctamente.",
            beneficiary
        });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/transfers") {
        const { user } = await authController.authenticate(request.headers);
        const body = await parseJsonBody(request);
        const transfer = await transferController.createTransfer(user.id, body);
        sendJson(response, 201, transfer);
        return;
    }

    throw new HttpError(404, "La ruta solicitada no existe.");
}

// Paginas HTML que si pueden indexarse en buscadores. El resto de vistas son pantallas
// autenticadas (saldos, movimientos, perfil) y se marcan como noindex tambien por cabecera.
const publicPagePaths = new Set(["/views/login.html"]);

/**
 * Funcion: sendRobotsTxt
 *
 * Que hace: responde /robots.txt indicando a los buscadores que pueden rastrear.
 * Como lo hace: permite el login publico y los recursos, bloquea /api/ y las vistas privadas, y apunta al
 *   sitemap usando la URL base reconstruida de la solicitud (getRequestBaseUrl). Cache publica de 1 hora.
 * Datos que participan: `request` (cabeceras host/proto) y `response`.
 * Consultas SQL: ninguna.
 * Retorna: nada (termina la respuesta).
 */
function sendRobotsTxt(request, response) {
    const baseUrl = getRequestBaseUrl(request);
    const lines = [
        "User-agent: *",
        "Allow: /views/login.html",
        "Allow: /recursos/",
        "Disallow: /api/",
        "Disallow: /views/principal.html",
        "Disallow: /views/operaciones.html",
        "Disallow: /views/movimientos.html",
        "Disallow: /views/perfil.html",
        "Disallow: /views/aprendizaje_forex.html",
        "Disallow: /views/cuestionario_forex.html",
        "Disallow: /views/mercado_forex.html",
        "Disallow: /views/simulador_inversion.html",
        "",
        `Sitemap: ${baseUrl}/sitemap.xml`,
        ""
    ];

    response.writeHead(200, buildSecurityHeaders({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
    }));
    response.end(lines.join("\n"));
}

/**
 * Funcion: sendSitemapXml
 *
 * Que hace: responde /sitemap.xml con las URLs publicas indexables.
 * Como lo hace: genera un XML con una entrada <url> por cada ruta de publicPagePaths, con URL absoluta formada
 *   con la URL base de la solicitud. Cache publica de 1 hora.
 * Datos que participan: `request`, `response` y el conjunto publicPagePaths.
 * Consultas SQL: ninguna.
 * Retorna: nada (termina la respuesta).
 */
function sendSitemapXml(request, response) {
    const baseUrl = getRequestBaseUrl(request);
    const entries = [...publicPagePaths]
        .map((pagePath) => `  <url><loc>${baseUrl}${pagePath}</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>`)
        .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;

    response.writeHead(200, buildSecurityHeaders({
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
    }));
    response.end(xml);
}

// Extensiones de texto que se comprimen (las imagenes ya vienen comprimidas y no ganan nada).
const compressibleExtensions = new Set([".html", ".css", ".js", ".json", ".svg", ".txt"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"]);

// Cache en memoria de los archivos de texto estaticos: { mtimeMs, size, etag, raw, br, gzip }.
const staticTextCache = new Map();

/**
 * Funcion: pickEncoding
 *
 * Que hace: elige la compresion que el navegador acepta.
 * Como lo hace: lee la cabecera Accept-Encoding y prefiere brotli (br) sobre gzip.
 * Datos que participan: `request.headers["accept-encoding"]`.
 * Consultas SQL: ninguna.
 * Retorna: "br" | "gzip" | "" (sin compresion).
 */
function pickEncoding(request) {
    const accepted = String(request?.headers?.["accept-encoding"] || "");
    if (/\bbr\b/.test(accepted)) {
        return "br";
    }

    return /\bgzip\b/.test(accepted) ? "gzip" : "";
}

/**
 * Funcion: getStaticCacheControl
 *
 * Que hace: decide cuanto tiempo puede guardar el navegador cada tipo de archivo.
 * Como lo hace: HTML siempre se revalida (no-cache: puede cambiar y lleva la URL base inyectada); imagenes 7 dias
 *               (las fotos de perfil tienen nombre unico por subida); CSS y JS 5 minutos, y pasado ese tiempo el
 *               navegador pregunta con ETag y recibe un 304 casi sin bytes si no cambiaron.
 * Datos que participan: `extension` del archivo.
 * Consultas SQL: ninguna.
 * Retorna: valor para la cabecera Cache-Control.
 */
function getStaticCacheControl(extension) {
    if (extension === ".html") {
        return "no-cache";
    }

    return imageExtensions.has(extension) ? "public, max-age=604800" : "public, max-age=300";
}

/**
 * Funcion: sendCompressed
 *
 * Que hace: envia un cuerpo ya preparado aplicando la compresion elegida y el Content-Length correcto.
 * Como lo hace: escribe las cabeceras (Content-Encoding, Vary: Accept-Encoding, longitud) y termina la respuesta.
 * Datos que participan: `response`, `headers`, `body` (Buffer) y `encoding`.
 * Consultas SQL: ninguna.
 * Retorna: nada.
 */
function sendCompressed(response, headers, body, encoding) {
    const finalHeaders = { ...headers, Vary: "Accept-Encoding", "Content-Length": body.length };
    if (encoding) {
        finalHeaders["Content-Encoding"] = encoding;
    }

    response.writeHead(200, buildSecurityHeaders(finalHeaders));
    response.end(body);
}

/**
 * Funcion: serveStaticAsset
 *
 * Que hace: sirve HTML, CSS, JS e imagenes desde el proyecto de forma rapida.
 * Como lo hace: resuelve la ruta y rechaza (403) cualquier ruta que salga del directorio raiz (proteccion contra ../).
 *   - Texto (css, js, json, svg): se lee una vez, se comprime con brotli y gzip y se guarda en memoria junto con un
 *     ETag; se vuelve a leer solo si el archivo cambio en disco. Si el navegador manda If-None-Match con el mismo
 *     ETag responde 304 sin cuerpo.
 *   - Imagenes: se valida con ETag (basado en tamano y fecha) y se sirven con cache de 7 dias.
 *   - HTML: sustituye {{BASE_URL}} por la URL publica real (canonical, Open Graph y JSON-LD), agrega X-Robots-Tag:
 *     noindex a las vistas no publicas y se comprime al vuelo (es pequeno y depende del host).
 *   Un archivo inexistente responde 404.
 * Datos que participan: `requestPath`, `response`, `request` (Accept-Encoding, If-None-Match), mimeTypes y
 *   publicPagePaths.
 * Consultas SQL: ninguna.
 * Retorna: nada (termina la respuesta).
 */
async function serveStaticAsset(requestPath, response, request) {
    const normalizedPath = requestPath === "/" ? "/views/login.html" : requestPath;
    const resolvedPath = path.resolve(rootDirectory, `.${decodeURIComponent(normalizedPath)}`);

    if (!resolvedPath.startsWith(rootDirectory)) {
        sendText(response, 403, "Acceso denegado.");
        return;
    }

    try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isFile()) {
            sendText(response, 404, "Archivo no encontrado.");
            return;
        }

        const extension = path.extname(resolvedPath).toLowerCase();
        const compressible = compressibleExtensions.has(extension);
        const encoding = compressible ? pickEncoding(request) : "";
        const headers = {
            "Content-Type": mimeTypes[extension] || "application/octet-stream",
            "Cache-Control": getStaticCacheControl(extension)
        };

        // HTML: dinamico (URL base y noindex), se comprime al vuelo.
        if (extension === ".html") {
            let html = await fs.readFile(resolvedPath, "utf8");
            if (request) {
                html = html.replace(/\{\{BASE_URL\}\}/g, getRequestBaseUrl(request));
            }

            if (!publicPagePaths.has(requestPath)) {
                headers["X-Robots-Tag"] = "noindex, nofollow";
            }

            const raw = Buffer.from(html, "utf8");
            let payload = raw;
            if (encoding === "br") {
                payload = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
            } else if (encoding === "gzip") {
                payload = zlib.gzipSync(raw, { level: 6 });
            }

            sendCompressed(response, headers, payload, encoding);
            return;
        }

        const etag = `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
        headers.ETag = etag;

        if (request?.headers?.["if-none-match"] === etag) {
            response.writeHead(304, buildSecurityHeaders({ ETag: etag, "Cache-Control": headers["Cache-Control"], Vary: "Accept-Encoding" }));
            response.end();
            return;
        }

        // Texto estatico: cache en memoria con las versiones comprimidas.
        if (compressible) {
            let entry = staticTextCache.get(resolvedPath);
            if (!entry || entry.etag !== etag) {
                const raw = await fs.readFile(resolvedPath);
                entry = {
                    etag,
                    raw,
                    br: raw.length > 1024
                        ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
                        : null,
                    gzip: raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null
                };
                staticTextCache.set(resolvedPath, entry);
            }

            const chosen = encoding && entry[encoding] ? encoding : "";
            sendCompressed(response, headers, chosen ? entry[chosen] : entry.raw, chosen);
            return;
        }

        // Imagenes y otros binarios: se leen del disco (el sistema operativo ya los cachea) con ETag y cache largo.
        sendCompressed(response, headers, await fs.readFile(resolvedPath), "");
    } catch (error) {
        if (error.code === "ENOENT") {
            sendText(response, 404, "Archivo no encontrado.");
            return;
        }

        throw error;
    }
}

/**
 * Funcion: handleRequest
 *
 * Que hace: decide si la peticion va a redireccion, robots/sitemap, API o archivo estatico y centraliza el
 *   manejo de errores para responder siempre con formato consistente.
 * Como lo hace: '/' redirige a /views/login.html; /robots.txt y /sitemap.xml se generan; /api/* va a
 *   handleApiRequest; lo demas a serveStaticAsset. En el catch usa el status de HttpError o 500 con mensaje
 *   generico (el detalle de errores internos solo va a la consola).
 * Datos que participan: `request`, `response`.
 * Consultas SQL: ninguna directa.
 * Retorna: nada.
 */
async function handleRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
        if (url.pathname === "/") {
            sendRedirect(response, "/views/login.html");
            return;
        }

        if (url.pathname === "/robots.txt") {
            sendRobotsTxt(request, response);
            return;
        }

        if (url.pathname === "/sitemap.xml") {
            sendSitemapXml(request, response);
            return;
        }

        if (url.pathname.startsWith("/api/")) {
            await handleApiRequest(request, response, url);
            return;
        }

        await serveStaticAsset(url.pathname, response, request);
    } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof HttpError
            ? error.message
            : "Ocurrio un error interno en el servidor.";

        if (!(error instanceof HttpError)) {
            console.error(error);
        }

        sendJson(response, status, {
            message
        });
    }
}

// Aqui levanto el servidor HTTP nativo y delego todo al manejador principal.
// En Vercel (funcion serverless) no se llama a listen: api/index.js importa handleRequest.
if (require.main === module) {
    const server = http.createServer((request, response) => {
        handleRequest(request, response);
    });

    // Al iniciar valido la base para detectar pronto si el entorno quedo mal configurado.
    server.listen(config.port, async () => {
        console.log(`Wallet disponible en http://localhost:${config.port}`);

        try {
            await healthCheck();
            console.log("Conexion con PostgreSQL verificada.");
        } catch (error) {
            console.warn("No se pudo validar la conexion con PostgreSQL:", error.message);
        }
    });
}

module.exports = { handleRequest };
