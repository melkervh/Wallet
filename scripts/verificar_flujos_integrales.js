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

// Funcion: createApiClient
// Aqui centralizo las llamadas HTTP para que todos los flujos usen
// el mismo manejo de token, JSON y errores de respuesta.
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

// Funcion: waitForHealth
// Aqui espero a que la API local responda antes de disparar CRUDs.
// Esto evita que la prueba arranque cuando el server aun esta levantando.
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

// Funcion: cleanupDatabase
// Aqui dejo la base operativa en cero eliminando filas tabla por tabla.
// Uso DELETE en lugar de TRUNCATE porque el usuario actual de la app
// no siempre es duenio de todas las tablas en PostgreSQL local.
async function cleanupDatabase() {
    for (const tableName of CLEANUP_TABLES) {
        await query(`DELETE FROM ${tableName}`);
    }
}

// Funcion: getOperationalCounts
// Aqui leo cuantos registros quedan en cada tabla operativa para
// demostrar el antes, el despues y el estado final limpio.
async function getOperationalCounts() {
    const counts = {};

    for (const tableName of CLEANUP_TABLES) {
        const result = await query(`SELECT COUNT(*) AS total FROM ${tableName}`);
        counts[tableName] = Number(result.rows[0]?.total || 0);
    }

    return counts;
}

// Funcion: getLatestUserIdByEmail
// Aqui encuentro el usuario de prueba que acaba de registrarse para poder
// ajustar codigos temporales desde SQL sin depender del correo recibido.
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

// Funcion: forceLatestAdvanceCode
// Aqui reemplazo el hash del ultimo codigo de adelanto por un valor conocido.
// Lo hago para validar el flujo completo sin depender de abrir el correo manualmente.
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

// Funcion: forceLatestRecoveryPin
// Aqui hago lo mismo con el PIN de recuperacion para poder probar
// verify y confirm sin depender del cliente de correo.
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

// Funcion: ensureZeroedCounts
// Aqui valido que el cierre haya dejado todas las tablas operativas en cero.
async function ensureZeroedCounts() {
    const counts = await getOperationalCounts();
    const dirtyEntries = Object.entries(counts).filter(([, total]) => total !== 0);

    if (dirtyEntries.length) {
        const detail = dirtyEntries.map(([tableName, total]) => `${tableName}:${total}`).join(", ");
        throw new Error(`La base no quedo limpia al final. Tablas con datos: ${detail}`);
    }

    return counts;
}

// Funcion: assertHasMessage
// Aqui confirmo que una respuesta de negocio traiga mensaje, porque
// eso nos ayuda a detectar respuestas incompletas aunque el status sea 200/201.
function assertHasMessage(response, context) {
    assert.ok(response && typeof response.message === "string" && response.message.trim(), `${context} debia devolver message.`);
}

// Funcion: main
// Aqui ejecuto la bateria completa:
// limpio base, inserto datos en los modulos clave, pruebo validaciones,
// corro recuperacion y al final vuelvo a dejar todo en cero.
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
        assert.equal(registerResponse.requiresLogin, true, "El registro debe forzar login posterior.");

        const loginResponse = await api.request(
            "POST",
            "/api/auth/login",
            {
                email: TEST_EMAIL,
                password: TEST_PASSWORD
            },
            200
        );
        assert.ok(loginResponse.token, "Login debia devolver token.");
        api.setToken(loginResponse.token);

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

        const userId = await getLatestUserIdByEmail(TEST_EMAIL);
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
