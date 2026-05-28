const fs = require("fs/promises");
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

// Funcion: buildSecurityHeaders
// Aqui concentro cabeceras HTTP defensivas basicas para reducir vectores triviales del navegador.
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

// Funcion: sendJson
// Aqui centralizo respuestas JSON para mantener encoding y cache coherentes.
function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, buildSecurityHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    }));
    response.end(JSON.stringify(payload));
}

// Funcion: sendRedirect
// Aqui resuelvo redirecciones simples, por ejemplo al login inicial.
function sendRedirect(response, location) {
    response.writeHead(302, buildSecurityHeaders({
        Location: location
    }));
    response.end();
}

// Funcion: sendText
// Aqui devuelvo respuestas planas para errores o accesos denegados.
function sendText(response, statusCode, text) {
    response.writeHead(statusCode, buildSecurityHeaders({
        "Content-Type": "text/plain; charset=utf-8"
    }));
    response.end(text);
}

// Funcion: getRequestBaseUrl
// Aqui reconstruyo la URL publica real desde la solicitud actual.
// Esto evita depender de APP_BASE_URL cuando el proyecto corre por tunel y el host cambia.
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

// Funcion: enforceJsonContentType
// Aqui valido que las rutas API que esperan cuerpo reciban JSON real.
// Lo hago temprano para cortar peticiones mal formadas antes de leer el body completo.
function enforceJsonContentType(request) {
    if (!["POST", "PUT", "PATCH"].includes(request.method || "")) {
        return;
    }

    const rawContentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!rawContentType.includes("application/json")) {
        throw new HttpError(415, "Esta ruta solo acepta cuerpos JSON.");
    }
}

// Funcion: enforceRateLimit
// Aqui aplico un rate limit sencillo en memoria por IP y ruta sensible.
// No reemplaza una capa perimetral, pero si frena abuso basico en login, reset y adelantos.
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

// Funcion: parseJsonBody
// Aqui leo el cuerpo de la solicitud y lo convierto a objeto.
// Si el JSON viene roto, corto el flujo con un HttpError legible.
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

// Funcion: getClientIpAddress
// Aqui intento obtener la IP real considerando proxy y ejecucion local.
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

// Funcion: handleApiRequest
// Aqui concentro el ruteo manual de toda la API.
// El orden importa: primero rutas publicas, luego rutas autenticadas y por ultimo el 404.
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

// Funcion: serveStaticAsset
// Aqui sirvo HTML, CSS, JS e imagenes desde el proyecto.
// Antes valido la ruta resuelta para evitar salir del directorio raiz.
async function serveStaticAsset(requestPath, response) {
    const normalizedPath = requestPath === "/" ? "/views/login.html" : requestPath;
    const resolvedPath = path.resolve(rootDirectory, `.${decodeURIComponent(normalizedPath)}`);

    if (!resolvedPath.startsWith(rootDirectory)) {
        sendText(response, 403, "Acceso denegado.");
        return;
    }

    try {
        const file = await fs.readFile(resolvedPath);
        const extension = path.extname(resolvedPath).toLowerCase();
        response.writeHead(200, buildSecurityHeaders({
            "Content-Type": mimeTypes[extension] || "application/octet-stream"
        }));
        response.end(file);
    } catch (error) {
        if (error.code === "ENOENT") {
            sendText(response, 404, "Archivo no encontrado.");
            return;
        }

        throw error;
    }
}

// Funcion: handleRequest
// Aqui decido si la peticion va a redireccion, API o archivo estatico.
// Tambien centralizo el manejo de errores para responder siempre con formato consistente.
async function handleRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
        if (url.pathname === "/") {
            sendRedirect(response, "/views/login.html");
            return;
        }

        if (url.pathname.startsWith("/api/")) {
            await handleApiRequest(request, response, url);
            return;
        }

        await serveStaticAsset(url.pathname, response);
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
