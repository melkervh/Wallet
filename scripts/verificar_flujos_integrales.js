/**
 * Modulo: scripts/verificar_flujos_integrales.js
 *
 * ADVERTENCIA: este script BORRA TODOS LOS DATOS de las tablas operativas (usuarios, cuentas,
 *   transacciones...) de la base configurada en .env, antes y despues de la prueba. Nunca lo ejecutes contra una
 *   base con datos reales.
 *
 * Que hace: prueba de integracion de extremo a extremo contra la API local: registro, activacion, login,
 *   perfil, cuentas, tarjetas, favoritos, transferencias, ahorros, servicios, adelanto salarial y recuperacion
 *   de contrasena.
 * Como lo hace: espera a que /api/health responda, limpia la base, ejecuta cada flujo por HTTP con un cliente
 *   que maneja el token, valida respuestas con assert, fuerza PINes y codigos conocidos directamente en la base
 *   (para no depender del correo) y al final vuelve a dejar las tablas en cero y lo comprueba.
 * Datos que participan: usuario de prueba (correo, telefono y DUI de las constantes del archivo), la API en
 *   http://127.0.0.1:{PORT} y las tablas listadas en CLEANUP_TABLES.
 * Consultas SQL: DELETE y COUNT sobre cada tabla de CLEANUP_TABLES, y UPDATE/SELECT puntuales de codigos y
 *   usuarios (ver cada funcion). El servidor debe estar encendido (npm start).
 */

const assert = require("assert");
const { query } = require("../backend/db");
const { config } = require("../backend/env");
const { hashOneTimeToken } = require("../backend/auth");

const API_BASE_URL = `http://127.0.0.1:${config.port}`;
const TEST_EMAIL = "jg2652050+wallete2e@gmail.com";
const TEST_PASSWORD = "Wallet2026";
const TEST_PASSWORD_UPDATED = "Wallet2030";
const TEST_PHONE = "+50370001234";
const TEST_PHONE_UPDATED = "+50370004567";
const TEST_DUI = "12345678-9";
const TEST_DUI_UPDATED = "87654321-0";
const ADVANCE_TEST_CODE = "778899";
const RECOVERY_TEST_PIN = "665544";
const REGISTRATION_TEST_PIN = "112233";
const CLEANUP_TABLES = [
    "movimientos_cuenta",
    "transacciones",
    "adelantos_salariales",
    "pagos_programados",
    "servicios_usuario",
    "bolsillos_ahorro",
    "tarjetas",
    "beneficiarios",
    "cuentas",
    "progreso_forex_usuario",
    "accesos_usuario",
    "alertas_usuario",
    "tokens_recuperacion_password",
    "codigos_verificacion",
    "usuarios_credenciales",
    "usuarios"
];

/**
 * Funcion: createApiClient
 *
 * Que hace: centraliza las llamadas HTTP para que todos los flujos usen el mismo manejo de token, JSON y
 *   errores.
 * Como lo hace: devuelve un objeto con setToken (cambia el Bearer activo) y request (envia la solicitud JSON,
 *   compara el status con el esperado y lanza un error con el detalle del backend si no coincide).
 * Datos que participan: token en memoria, API_BASE_URL.
 * Consultas SQL: ninguna.
 * Retorna: cliente { setToken, request }.
 */
function createApiClient() {
    const state = {
        token: ""
    };

    return {
        // Funcion: setToken
        // Aqui cambio el Bearer token activo del cliente para pasar
        // de una sesion a otra sin reescribir headers a mano.
        setToken(token) {
            state.token = String(token || "");
        },

        // Funcion: request
        // Aqui envio una solicitud JSON a la API local.
        // Si el estado no coincide con lo esperado, levanto un error
        // con el detalle que haya respondido el backend.
        async request(method, path, body = undefined, expectedStatus = 200) {
            const headers = {
                "Content-Type": "application/json"
            };

            if (state.token) {
                headers.Authorization = `Bearer ${state.token}`;
            }

            const response = await fetch(`${API_BASE_URL}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body)
            });

            const rawText = await response.text();
            let data = {};

            if (rawText) {
                try {
                    data = JSON.parse(rawText);
                } catch (error) {
                    throw new Error(`La API devolvio texto no JSON en ${method} ${path}: ${rawText}`);
                }
            }

            if (response.status !== expectedStatus) {
                const detail = data?.message || data?.error || rawText || `HTTP ${response.status}`;
                throw new Error(`Fallo ${method} ${path}. Esperaba ${expectedStatus} y recibi ${response.status}. Detalle: ${detail}`);
            }

            return data;
        }
    };
}

/**
 * Funcion: waitForHealth
 *
 * Que hace: espera a que la API local este lista.
 * Como lo hace: consulta /api/health hasta 20 veces con pausas de 500 ms, ignorando el ruido del arranque.
 * Datos que participan: `maxAttempts`.
 * Consultas SQL: ninguna directa (el endpoint ejecuta SELECT 1).
 * Retorna: Promise<void>; lanza error si nunca responde.
 */
async function waitForHealth(maxAttempts = 20) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/health`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            // Aqui ignoro el primer ruido del arranque y vuelvo a intentar.
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("La API local no respondio en /api/health dentro del tiempo esperado.");
}

/**
 * Funcion: cleanupDatabase
 *
 * Que hace: deja la base operativa en cero.
 * Como lo hace: DELETE FROM de cada tabla en el orden de CLEANUP_TABLES (hijas antes que padres para respetar
 *   las claves foraneas). Usa DELETE y no TRUNCATE porque el usuario de la app no siempre es duenio de todas las
 *   tablas.
 * Datos que participan: CLEANUP_TABLES.
 * Consultas SQL: DELETE FROM {tabla} por cada tabla.
 * Retorna: Promise<void>.
 */
async function cleanupDatabase() {
    for (const tableName of CLEANUP_TABLES) {
        await query(`DELETE FROM ${tableName}`);
    }
}

/**
 * Funcion: getOperationalCounts
 *
 * Que hace: lee cuantos registros hay en cada tabla operativa, para demostrar el antes, el despues y el estado
 *   final limpio.
 * Como lo hace: recorre CLEANUP_TABLES con un COUNT por tabla.
 * Datos que participan: CLEANUP_TABLES.
 * Consultas SQL: SELECT COUNT(*) AS total FROM {tabla}.
 * Retorna: objeto { tabla: total }.
 */
async function getOperationalCounts() {
    const counts = {};

    for (const tableName of CLEANUP_TABLES) {
        const result = await query(`SELECT COUNT(*) AS total FROM ${tableName}`);
        counts[tableName] = Number(result.rows[0]?.total || 0);
    }

    return counts;
}

/**
 * Funcion: getLatestUserIdByEmail
 *
 * Que hace: obtiene el id del usuario de prueba a partir de su correo.
 * Como lo hace: busca ignorando mayusculas y toma el mas reciente.
 * Datos que participan: `email`.
 * Consultas SQL: SELECT id_usuario FROM usuarios WHERE LOWER(correo) = LOWER($1) ORDER BY id_usuario DESC
 *   LIMIT 1.
 * Retorna: number; lanza error si no existe.
 */
async function getLatestUserIdByEmail(email) {
    const result = await query(
        `
        SELECT id_usuario
        FROM usuarios
        WHERE LOWER(correo) = LOWER($1)
        ORDER BY id_usuario DESC
        LIMIT 1
        `,
        [email]
    );

    const userId = Number(result.rows[0]?.id_usuario || 0);
    if (!userId) {
        throw new Error(`No encontre el usuario de prueba para el correo ${email}.`);
    }

    return userId;
}

/**
 * Funcion: forceLatestAdvanceCode
 *
 * Que hace: reemplaza el hash del ultimo codigo de adelanto por un valor conocido, para validar el flujo sin
 *   abrir el correo.
 * Como lo hace: un UPDATE sobre el codigo mas reciente (CTE latest_code) que fija el hash del codigo de
 *   prueba, lo vuelve a poner vigente 15 minutos y lo marca como no usado.
 * Datos que participan: `userId`, `plainCode`.
 * Consultas SQL: WITH latest_code AS (SELECT id_codigo FROM codigos_verificacion WHERE usuario_id = $1 ORDER
 *   BY creado_en DESC LIMIT
 *   1) UPDATE codigos_verificacion SET codigo_hash = $2, expira_en = NOW() + 15 min, usado_en = NULL WHERE
 *      id_codigo IN (SELECT ...) RETURNING id_codigo.
 * Retorna: Promise<void>; lanza error si no habia codigo.
 */
async function forceLatestAdvanceCode(userId, plainCode) {
    const result = await query(
        `
        WITH latest_code AS (
            SELECT id_codigo
            FROM codigos_verificacion
            WHERE usuario_id = $1
            ORDER BY creado_en DESC
            LIMIT 1
        )
        UPDATE codigos_verificacion
        SET
            codigo_hash = $2,
            expira_en = NOW() + INTERVAL '15 minutes',
            usado_en = NULL
        WHERE id_codigo IN (SELECT id_codigo FROM latest_code)
        RETURNING id_codigo
        `,
        [userId, hashOneTimeToken(plainCode)]
    );

    if (!result.rows[0]) {
        throw new Error("No encontre un codigo de adelanto para forzarlo en la base.");
    }
}

/**
 * Funcion: forceLatestRecoveryPin
 *
 * Que hace: hace lo mismo con el PIN de recuperacion para probar verify y confirm sin depender del correo.
 * Como lo hace: UPDATE del token mas reciente con el hash del PIN de prueba, 15 minutos de vigencia y usado_en
 *   = NULL.
 * Datos que participan: `userId`, `plainPin`.
 * Consultas SQL: WITH latest_pin AS (SELECT id_token FROM tokens_recuperacion_password WHERE usuario_id = $1
 *   ORDER BY creado_en DESC LIMIT
 *   1) UPDATE tokens_recuperacion_password SET token_hash = $2, expira_en = NOW() + 15 min, usado_en = NULL ...
 *      RETURNING id_token.
 * Retorna: Promise<void>; lanza error si no habia token.
 */
async function forceLatestRecoveryPin(userId, plainPin) {
    const result = await query(
        `
        WITH latest_pin AS (
            SELECT id_token
            FROM tokens_recuperacion_password
            WHERE usuario_id = $1
            ORDER BY creado_en DESC
            LIMIT 1
        )
        UPDATE tokens_recuperacion_password
        SET
            token_hash = $2,
            expira_en = NOW() + INTERVAL '15 minutes',
            usado_en = NULL
        WHERE id_token IN (SELECT id_token FROM latest_pin)
        RETURNING id_token
        `,
        [userId, hashOneTimeToken(plainPin)]
    );

    if (!result.rows[0]) {
        throw new Error("No encontre un PIN de recuperacion para forzarlo en la base.");
    }
}

/**
 * Funcion: forceLatestRegistrationPin
 *
 * Que hace: fuerza el ultimo PIN de activacion de registro para no depender del correo en la prueba
 *   automatica.
 * Como lo hace: igual que el de adelanto pero eligiendo solo entre codigos aun no usados (usado_en IS NULL).
 * Datos que participan: `userId`, `plainPin`.
 * Consultas SQL: WITH latest_pin AS (SELECT id_codigo FROM codigos_verificacion WHERE usuario_id = $1 AND
 *   usado_en IS NULL ORDER BY creado_en DESC LIMIT
 *   1) UPDATE codigos_verificacion SET codigo_hash = $2, expira_en = NOW() + 15 min, usado_en = NULL ...
 *      RETURNING id_codigo.
 * Retorna: Promise<void>; lanza error si no habia codigo.
 */
async function forceLatestRegistrationPin(userId, plainPin) {
    const result = await query(
        `
        WITH latest_pin AS (
            SELECT id_codigo
            FROM codigos_verificacion
            WHERE usuario_id = $1
              AND usado_en IS NULL
            ORDER BY creado_en DESC
            LIMIT 1
        )
        UPDATE codigos_verificacion
        SET
            codigo_hash = $2,
            expira_en = NOW() + INTERVAL '15 minutes',
            usado_en = NULL
        WHERE id_codigo IN (SELECT id_codigo FROM latest_pin)
        RETURNING id_codigo
        `,
        [userId, hashOneTimeToken(plainPin)]
    );

    if (!result.rows[0]) {
        throw new Error("No encontre un PIN de activacion de registro para forzarlo en la base.");
    }
}

/**
 * Funcion: ensureZeroedCounts
 *
 * Que hace: valida que el cierre haya dejado todas las tablas operativas en cero.
 * Como lo hace: obtiene los conteos y lanza error listando las tablas con datos si alguna no esta vacia.
 * Datos que participan: conteos de getOperationalCounts.
 * Consultas SQL: SELECT COUNT(*) por tabla (via getOperationalCounts).
 * Retorna: objeto de conteos (todos en 0).
 */
async function ensureZeroedCounts() {
    const counts = await getOperationalCounts();
    const dirtyEntries = Object.entries(counts).filter(([, total]) => total !== 0);

    if (dirtyEntries.length) {
        const detail = dirtyEntries.map(([tableName, total]) => `${tableName}:${total}`).join(", ");
        throw new Error(`La base no quedo limpia al final. Tablas con datos: ${detail}`);
    }

    return counts;
}

/**
 * Funcion: assertHasMessage
 *
 * Que hace: confirma que una respuesta de negocio traiga mensaje, para detectar respuestas incompletas aunque
 *   el status sea 200/201.
 * Como lo hace: assert.ok sobre response.message (string no vacio).
 * Datos que participan: `response`, `context`.
 * Consultas SQL: ninguna.
 * Retorna: nada; lanza AssertionError.
 */
function assertHasMessage(response, context) {
    assert.ok(response && typeof response.message === "string" && response.message.trim(), `${context} debia devolver message.`);
}

/**
 * Funcion: main
 *
 * Que hace: ejecuta la bateria completa.
 * Como lo hace: limpia la base, recorre los flujos de cada modulo con sus validaciones (incluido rechazo de
 *   una transferencia mayor al saldo), corre la recuperacion de contrasena y, en el bloque finally, vuelve a
 *   dejar todo en cero y comprueba el resultado. Imprime un resumen JSON con los conteos antes, durante y
 *   despues.
 * Datos que participan: usuario y datos de prueba, API local.
 * Consultas SQL: las de las funciones auxiliares y las que ejecuta el backend en cada endpoint.
 * Retorna: Promise<void>; ante un error imprime el mensaje y termina con codigo 1.
 */
async function main() {
    const api = createApiClient();
    const summary = {
        before: null,
        afterFlow: null,
        final: null,
        notes: []
    };

    await waitForHealth();

    try {
        await cleanupDatabase();
        summary.before = await getOperationalCounts();

        const bootstrapBefore = await api.request("GET", "/api/auth/bootstrap", undefined, 200);
        assert.equal(bootstrapBefore.requiresRegistration, true, "La base limpia debia forzar registro inicial.");

        const registerResponse = await api.request(
            "POST",
            "/api/auth/register",
            {
                firstName: "Jorge",
                lastName: "Polanco",
                email: TEST_EMAIL,
                phone: TEST_PHONE,
                birthDate: "1998-04-14",
                documentId: TEST_DUI,
                address: "Colonia San Benito #21, San Salvador",
                password: TEST_PASSWORD
            },
            201
        );
        assertHasMessage(registerResponse, "Registro");
        assert.equal(registerResponse.requiresVerification, true, "El registro debe exigir activacion por PIN.");

        const userId = await getLatestUserIdByEmail(TEST_EMAIL);
        await forceLatestRegistrationPin(userId, REGISTRATION_TEST_PIN);

        let loginBeforeVerificationRejected = false;
        try {
            await api.request(
                "POST",
                "/api/auth/login",
                {
                    email: TEST_EMAIL,
                    password: TEST_PASSWORD
                },
                200
            );
        } catch (error) {
            loginBeforeVerificationRejected = /verificada|activ/i.test(error.message);
        }
        assert.equal(loginBeforeVerificationRejected, true, "El login debia bloquearse antes de verificar la cuenta.");

        const activationResponse = await api.request(
            "POST",
            "/api/auth/register/verify",
            {
                email: TEST_EMAIL,
                pin: REGISTRATION_TEST_PIN
            },
            200
        );
        assert.ok(activationResponse.token, "La activacion debia devolver token y abrir sesion.");
        api.setToken(activationResponse.token);

        const sessionResponse = await api.request("GET", "/api/auth/session", undefined, 200);
        assert.equal(sessionResponse.user.correo, TEST_EMAIL, "La sesion activa no coincide con el usuario registrado.");

        const dashboardResponse = await api.request("GET", "/api/dashboard", undefined, 200);
        assert.ok(Array.isArray(dashboardResponse.accounts) && dashboardResponse.accounts.length === 1, "El dashboard debia traer la cuenta principal.");
        assert.equal(Number(dashboardResponse.summary.saldoDisponibleTotal), 50, "El bono inicial no quedo acreditado como se esperaba.");

        const profileResponse = await api.request("GET", "/api/profile", undefined, 200);
        assert.equal(profileResponse.profile.correo, TEST_EMAIL, "El perfil devuelto no coincide con el correo de prueba.");

        const updateProfileResponse = await api.request(
            "POST",
            "/api/profile",
            {
                firstName: "Jorge Daniel",
                lastName: "Polanco Rivera",
                phone: TEST_PHONE_UPDATED,
                birthDate: "1998-04-14",
                documentId: TEST_DUI_UPDATED,
                address: "Residencial Escalon #77, San Salvador",
                removePhoto: false
            },
            200
        );
        assertHasMessage(updateProfileResponse, "Perfil");
        assert.equal(updateProfileResponse.profile.telefono, TEST_PHONE_UPDATED, "El telefono actualizado no quedo guardado.");

        const cardsCenter = await api.request("GET", "/api/cards", undefined, 200);
        assert.ok(Array.isArray(cardsCenter.banks) && cardsCenter.banks.length > 0, "El centro de tarjetas debia traer bancos.");
        const primaryAccountId = dashboardResponse.accounts.find((account) => account.esPrincipal)?.id || dashboardResponse.accounts[0].id;

        const createCardResponse = await api.request(
            "POST",
            "/api/cards",
            {
                accountId: primaryAccountId,
                bankId: cardsCenter.banks[0].id,
                alias: "Tarjeta principal de prueba",
                brand: "Visa",
                cardType: "debito",
                last4: "1234",
                holderName: "Jorge Daniel Polanco Rivera",
                dailyLimit: 250,
                expiryMonth: 12,
                expiryYear: new Date().getFullYear() + 2,
                makeDefault: true
            },
            201
        );
        assertHasMessage(createCardResponse, "Tarjeta");

        const accountsBeforeSecondary = await api.request("GET", "/api/accounts", undefined, 200);
        assert.equal(accountsBeforeSecondary.accounts.length, 1, "Antes de la cuenta secundaria solo debia existir la principal.");

        const createSecondaryAccountResponse = await api.request(
            "POST",
            "/api/accounts",
            {
                alias: "Cuenta respaldo",
                currency: "USD"
            },
            201
        );
        assertHasMessage(createSecondaryAccountResponse, "Cuenta secundaria");

        const accountsAfterSecondary = await api.request("GET", "/api/accounts", undefined, 200);
        assert.equal(accountsAfterSecondary.accounts.length, 2, "La cuenta secundaria no aparecio en el centro de cuentas.");

        const beneficiaryResponse = await api.request(
            "POST",
            "/api/beneficiaries",
            {
                recipientName: "Ana Lopez",
                recipientAlias: "Ana ahorro",
                destinationBank: "Banco Uno",
                destinationAccount: "0012345678901",
                destinationType: "bancaria",
                notificationEmail: "ana.lopez@example.com",
                notificationPhone: "+50371112222",
                saveFavorite: true
            },
            201
        );
        assert.ok(beneficiaryResponse.beneficiary?.id, "El beneficiario favorito debia devolver id.");

        const transferMetadata = await api.request("GET", "/api/transfers/metadata", undefined, 200);
        assert.ok(Array.isArray(transferMetadata.favoriteBeneficiaries) && transferMetadata.favoriteBeneficiaries.length >= 1, "El favorito creado no aparecio en metadata de transferencias.");

        const transferResponse = await api.request(
            "POST",
            "/api/transfers",
            {
                sourceAccountId: primaryAccountId,
                beneficiaryId: beneficiaryResponse.beneficiary.id,
                amount: 5,
                transferType: "inmediata",
                concept: "Transferencia de prueba integral"
            },
            201
        );
        assertHasMessage(transferResponse, "Transferencia");
        assert.equal(transferResponse.transfer.estado, "completada", "La transferencia de prueba debia quedar completada.");

        let excessiveTransferRejected = false;
        try {
            await api.request(
                "POST",
                "/api/transfers",
                {
                    sourceAccountId: primaryAccountId,
                    beneficiaryId: beneficiaryResponse.beneficiary.id,
                    amount: 1000,
                    transferType: "inmediata",
                    concept: "Transferencia invalida por saldo"
                },
                201
            );
        } catch (error) {
            excessiveTransferRejected = /Saldo insuficiente/i.test(error.message);
        }
        assert.equal(excessiveTransferRejected, true, "La validacion de saldo insuficiente para transferencias no respondio como se esperaba.");

        const savingsCreateResponse = await api.request(
            "POST",
            "/api/savings",
            {
                accountId: primaryAccountId,
                name: "Fondo emergencia",
                goalAmount: 300,
                color: "#6f3df4"
            },
            201
        );
        assertHasMessage(savingsCreateResponse, "Ahorro");

        const savingsCenter = await api.request("GET", "/api/savings", undefined, 200);
        assert.ok(Array.isArray(savingsCenter.pockets) && savingsCenter.pockets.length === 1, "El bolsillo de ahorro no quedo creado.");
        const pocketId = savingsCenter.pockets[0].id;

        const savingsDepositResponse = await api.request(
            "POST",
            "/api/savings/deposit",
            {
                pocketId,
                accountId: primaryAccountId,
                amount: 5
            },
            201
        );
        assertHasMessage(savingsDepositResponse, "Deposito a ahorro");

        const servicesCenterBeforeLink = await api.request("GET", "/api/services/center", undefined, 200);
        assert.ok(Array.isArray(servicesCenterBeforeLink.providers) && servicesCenterBeforeLink.providers.length > 0, "El centro de servicios debia traer proveedores.");

        const linkServiceResponse = await api.request(
            "POST",
            "/api/services/link",
            {
                providerId: servicesCenterBeforeLink.providers[0].id,
                accountId: primaryAccountId,
                alias: "Internet casa",
                customerIdentifier: "00123456"
            },
            201
        );
        assertHasMessage(linkServiceResponse, "Vincular servicio");

        const servicesCenterAfterLink = await api.request("GET", "/api/services/center", undefined, 200);
        assert.ok(Array.isArray(servicesCenterAfterLink.linkedServices) && servicesCenterAfterLink.linkedServices.length >= 1, "El servicio vinculado no aparecio en el centro de servicios.");

        const payServiceResponse = await api.request(
            "POST",
            "/api/services/pay",
            {
                linkedServiceId: servicesCenterAfterLink.linkedServices[0].id,
                accountId: primaryAccountId,
                amount: 5,
                concept: "Pago de internet de prueba"
            },
            201
        );
        assertHasMessage(payServiceResponse, "Pago de servicio");

        const requestAdvanceCodeResponse = await api.request(
            "POST",
            "/api/salary-advance/request-code",
            {
                amount: 80
            },
            200
        );
        assertHasMessage(requestAdvanceCodeResponse, "Solicitud de codigo de adelanto");

        await forceLatestAdvanceCode(userId, ADVANCE_TEST_CODE);

        const requestAdvanceResponse = await api.request(
            "POST",
            "/api/salary-advance",
            {
                amount: 80,
                verificationCode: ADVANCE_TEST_CODE
            },
            201
        );
        assertHasMessage(requestAdvanceResponse, "Solicitud de adelanto");

        const salaryAdvanceCenter = await api.request("GET", "/api/salary-advance", undefined, 200);
        assert.ok(salaryAdvanceCenter.currentAdvance, "El adelanto activo no aparecio en el centro correspondiente.");

        const payAdvanceResponse = await api.request(
            "POST",
            "/api/services/pay",
            {
                paymentTarget: "adelanto_salarial",
                accountId: primaryAccountId,
                amount: 20,
                concept: "Pago parcial de adelanto desde servicios"
            },
            201
        );
        assertHasMessage(payAdvanceResponse, "Pago de adelanto");

        const removeFavoriteResponse = await api.request(
            "POST",
            "/api/beneficiaries/remove-favorite",
            {
                beneficiaryId: beneficiaryResponse.beneficiary.id
            },
            200
        );
        assert.ok(removeFavoriteResponse.beneficiary && removeFavoriteResponse.beneficiary.esFavorito === false, "El favorito debia quedar desmarcado.");

        const alertsBeforeRead = await api.request("GET", "/api/alerts", undefined, 200);
        assert.ok(Array.isArray(alertsBeforeRead.alerts) && alertsBeforeRead.alerts.length > 0, "Debian existir alertas despues de las operaciones.");
        assert.ok(alertsBeforeRead.unreadAlerts > 0, "Debia haber alertas pendientes antes de marcarlas.");

        const markReadResponse = await api.request("POST", "/api/alerts/mark-read", {}, 200);
        assertHasMessage(markReadResponse, "Marcar alertas");

        const alertsAfterRead = await api.request("GET", "/api/alerts", undefined, 200);
        assert.equal(alertsAfterRead.unreadAlerts, 0, "La campana debia quedar sin pendientes tras marcar las alertas.");

        const deleteAlertResponse = await api.request(
            "POST",
            "/api/alerts/delete",
            {
                alertId: alertsAfterRead.alerts[0].id
            },
            200
        );
        assertHasMessage(deleteAlertResponse, "Eliminar alerta");

        const movementsResponse = await api.request("GET", "/api/movements?limit=50", undefined, 200);
        assert.ok(Array.isArray(movementsResponse.items) && movementsResponse.items.length >= 5, "El historial de movimientos debia reflejar varias operaciones.");

        const forexLearningResponse = await api.request("GET", "/api/forex/learning?pair=EURUSD", undefined, 200);
        assert.ok(forexLearningResponse && typeof forexLearningResponse === "object", "El contenido Forex de aprendizaje no respondio.");

        const forexSimulationResponse = await api.request(
            "POST",
            "/api/forex/simulate",
            {
                pair: "EURUSD",
                capital: 1000,
                riskPercent: 2,
                direction: "buy"
            },
            200
        );
        assert.ok(forexSimulationResponse && typeof forexSimulationResponse === "object", "La simulacion Forex no respondio como objeto.");

        const passwordResetRequestResponse = await api.request(
            "POST",
            "/api/auth/password-reset/request",
            {
                email: TEST_EMAIL
            },
            200
        );
        assertHasMessage(passwordResetRequestResponse, "Recuperacion de contrasena");

        await forceLatestRecoveryPin(userId, RECOVERY_TEST_PIN);

        const passwordResetVerifyResponse = await api.request(
            "POST",
            "/api/auth/password-reset/verify",
            {
                email: TEST_EMAIL,
                pin: RECOVERY_TEST_PIN
            },
            200
        );
        assert.equal(passwordResetVerifyResponse.pinValidated, true, "El PIN forzado de recuperacion debia validar.");

        const passwordResetConfirmResponse = await api.request(
            "POST",
            "/api/auth/password-reset/confirm",
            {
                email: TEST_EMAIL,
                pin: RECOVERY_TEST_PIN,
                newPassword: TEST_PASSWORD_UPDATED
            },
            200
        );
        assert.ok(passwordResetConfirmResponse.token, "La recuperacion debia abrir una nueva sesion con token.");
        api.setToken(passwordResetConfirmResponse.token);

        const reloginResponse = await api.request(
            "POST",
            "/api/auth/login",
            {
                email: TEST_EMAIL,
                password: TEST_PASSWORD_UPDATED
            },
            200
        );
        assert.ok(reloginResponse.token, "El login con la nueva contrasena debia funcionar.");
        api.setToken(reloginResponse.token);

        const finalDashboard = await api.request("GET", "/api/dashboard", undefined, 200);
        assert.ok(finalDashboard.summary.adelantoActivo, "El dashboard final debia reflejar el adelanto activo tras la prueba.");

        summary.afterFlow = await getOperationalCounts();
        summary.notes.push("Todos los CRUD principales insertaron o actualizaron datos correctamente.");
        summary.notes.push("Tambien se valido que una transferencia superior al saldo disponible sea rechazada.");
    } finally {
        await cleanupDatabase();
        summary.final = await ensureZeroedCounts();
    }

    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error("[verificar_flujos_integrales] Error:", error.message);
    process.exit(1);
});
