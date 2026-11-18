/**
 * Modulo: models/auth.model.js
 *
 * Que hace: logica de negocio de autenticacion: login con bloqueo por intentos, registro con bono de
 *   bienvenida,
 * activacion por PIN de correo y recuperacion de contrasena por PIN.
 * Como lo hace: cada flujo corre dentro de withTransaction (todo o nada), usa validadores de base.model,
 *   hashes de auth.js
 * (scrypt para claves, HMAC para PINes) y envia correos con mailer.js. Los PINes se guardan hasheados, nunca
 *   en claro.
 * Datos que participan: tablas `usuarios`, `usuarios_credenciales`, `cuentas`, `transacciones`,
 *   `movimientos_cuenta`,
 * `codigos_verificacion` (activacion), `tokens_recuperacion_password`, `accesos_usuario` y `alertas_usuario`.
 * Consultas SQL: ver detalle en cada funcion.
 */

const { withTransaction } = require("../db");
const { config } = require("../env");
const {
    createPasswordHash,
    createToken,
    verifyPassword,
    createOneTimePin,
    hashOneTimeToken,
    hashesMatch,
    createTwoFactorChallengeToken,
    verifyTwoFactorChallengeToken
} = require("../auth");
const {
    sendPasswordResetEmail,
    sendRegistrationVerificationEmail,
    sendTwoFactorCodeEmail
} = require("../mailer");
const {
    HttpError,
    createAccountNumber,
    createReference,
    cleanText,
    ensureHumanName,
    ensureEmailAddress,
    ensurePhoneNumber,
    ensureDui,
    ensureBirthDateIsAdult,
    ensureAddressText,
    ensureUniqueUserIdentityData,
    ensurePasswordStrength,
    insertAccessLog,
    insertAlert,
    getBootstrapState,
    getSession,
    getUserById,
    mapAccount
} = require("./base.model");

/**
 * Funcion: getActiveRecoveryPinRecord
 *
 * Que hace: valida que el correo exista, que el PIN de recuperacion corresponda al usuario y que siga vigente.
 * Como lo hace: valida el correo, busca al usuario activo y luego el token por hash del PIN; revisa que no
 *   este usado ni vencido. Con lockRow=true agrega FOR UPDATE para bloquear las filas y evitar que dos
 *   solicitudes consuman el mismo PIN a la vez.
 * Datos que participan: `client`, `email`, `pin` (se pasa a mayusculas), `lockRow`.
 * Consultas SQL:
 *   1) SELECT id_usuario, estado FROM usuarios WHERE LOWER(correo) = $1 LIMIT 1 [FOR UPDATE].
 *   2) SELECT id_token, expira_en, usado_en FROM tokens_recuperacion_password WHERE usuario_id = $1 AND
 *      token_hash = $2 ORDER BY creado_en DESC LIMIT 1 [FOR UPDATE]: toma el token mas reciente con ese hash.
 * Retorna: { user, recoveryPin, plainPin } o HttpError 400 (mensajes: no valido / ya utilizado / ya vencio).
 */
async function getActiveRecoveryPinRecord(client, email, pin, lockRow = false) {
    const correo = ensureEmailAddress(email);
    const plainPin = cleanText(pin, 120).toUpperCase();

    if (!correo || !plainPin) {
        throw new HttpError(400, "Completa el correo y el PIN.");
    }

    const userResult = await client.query(
        `
        SELECT
            id_usuario,
            estado
        FROM usuarios
        WHERE LOWER(correo) = $1
        LIMIT 1
        ${lockRow ? "FOR UPDATE" : ""}
        `,
        [correo]
    );

    const user = userResult.rows[0];
    if (!user || user.estado !== "activo") {
        throw new HttpError(400, "El PIN de recuperacion no es valido.");
    }

    const pinResult = await client.query(
        `
        SELECT
            id_token,
            expira_en,
            usado_en
        FROM tokens_recuperacion_password
        WHERE usuario_id = $1
          AND token_hash = $2
        ORDER BY creado_en DESC
        LIMIT 1
        ${lockRow ? "FOR UPDATE" : ""}
        `,
        [user.id_usuario, hashOneTimeToken(plainPin)]
    );

    const recoveryPin = pinResult.rows[0];
    if (!recoveryPin) {
        throw new HttpError(400, "El PIN de recuperacion no es valido.");
    }

    if (recoveryPin.usado_en) {
        throw new HttpError(400, "El PIN de recuperacion ya fue utilizado.");
    }

    if (new Date(recoveryPin.expira_en) <= new Date()) {
        throw new HttpError(400, "El PIN de recuperacion ya vencio.");
    }

    return {
        user,
        recoveryPin,
        plainPin
    };
}

/**
 * Funcion: normalizePublicBaseUrl
 *
 * Que hace: normaliza la base publica que se usa en los enlaces de los correos.
 * Como lo hace: si la URL de la solicitud es http(s) valida (por ejemplo un tunel) la prioriza; si no, usa
 *   config.appBaseUrl. Quita las barras finales.
 * Datos que participan: `baseUrl` (de la solicitud) y config.appBaseUrl.
 * Consultas SQL: ninguna.
 * Retorna: URL base sin barra final.
 */
function normalizePublicBaseUrl(baseUrl) {
    const candidate = cleanText(baseUrl, 300).replace(/\/+$/, "");
    if (/^https?:\/\//i.test(candidate)) {
        return candidate;
    }

    return String(config.appBaseUrl || "").replace(/\/+$/, "");
}

/**
 * Funcion: buildRegistrationActivationUrl
 *
 * Que hace: construye el enlace del correo que aterriza directo en la pantalla de activacion.
 * Como lo hace: concatena /views/login.html?modo=activar&correo=...&pin=... con encodeURIComponent; el
 *   frontend abre el modal y, si los parametros vienen completos, puede cerrar la activacion automaticamente.
 * Datos que participan: `baseUrl`, `email`, `pin`.
 * Consultas SQL: ninguna.
 * Retorna: URL absoluta.
 */
function buildRegistrationActivationUrl(baseUrl, email, pin) {
    const publicBaseUrl = normalizePublicBaseUrl(baseUrl);
    return `${publicBaseUrl}/views/login.html?modo=activar&correo=${encodeURIComponent(email)}&pin=${encodeURIComponent(pin)}`;
}

/**
 * Funcion: issueRegistrationVerificationCode
 *
 * Que hace: emite un PIN nuevo de activacion y dispara el correo que cierra el ciclo del registro.
 * Como lo hace: invalida los codigos vigentes del usuario, genera un PIN de 6 digitos, guarda su hash con
 *   expiracion (config.registrationVerificationCodeMinutes) y envia el correo. Reutiliza codigos_verificacion
 *   porque la cuenta aun no puede solicitar adelantos, asi que ese canal queda reservado para la activacion
 *   inicial.
 * Datos que participan: `client`, { userId, email, userName, requestBaseUrl, ipAddress }.
 * Consultas SQL:
 *   1) UPDATE codigos_verificacion SET usado_en = NOW() WHERE usuario_id = $1 AND canal = 'correo' AND usado_en
 *      IS NULL AND expira_en > NOW(): anula los pendientes.
 *   2) INSERT INTO codigos_verificacion (usuario_id, canal, destino, codigo_hash, expira_en) VALUES ($1,
 *      'correo', ...).
 * Retorna: { plainPin, activationUrl, previewMode, previewPin, previewActivationUrl } (los preview solo vienen
 *   en modo de prueba sin SMTP).
 */
async function issueRegistrationVerificationCode(client, {
    userId,
    email,
    userName,
    requestBaseUrl,
    ipAddress
}) {
    await client.query(
        `
        UPDATE codigos_verificacion
        SET usado_en = NOW()
        WHERE usuario_id = $1
          AND canal = 'correo'
          AND usado_en IS NULL
          AND expira_en > NOW()
        `,
        [userId]
    );

    const plainPin = createOneTimePin(6);
    const expiresAt = new Date(Date.now() + config.registrationVerificationCodeMinutes * 60 * 1000);
    const pinHash = hashOneTimeToken(plainPin);

    await client.query(
        `
        INSERT INTO codigos_verificacion (
            usuario_id,
            canal,
            destino,
            codigo_hash,
            expira_en
        )
        VALUES ($1, 'correo', $2, $3, $4)
        `,
        [userId, email, pinHash, expiresAt]
    );

    const activationUrl = buildRegistrationActivationUrl(requestBaseUrl, email, plainPin);
    const delivery = await sendRegistrationVerificationEmail({
        to: email,
        userName,
        pin: plainPin,
        activationUrl
    });

    return {
        plainPin,
        activationUrl,
        previewMode: Boolean(delivery.preview),
        previewPin: delivery.preview ? plainPin : null,
        previewActivationUrl: delivery.preview ? activationUrl : null
    };
}

/**
 * Funcion: getActiveRegistrationPinRecord
 *
 * Que hace: valida que la cuenta siga pendiente de activacion y que el PIN corresponda al usuario, siga
 *   vigente y no se haya usado.
 * Como lo hace: busca el usuario por correo (estado debe ser 'suspendido'; si ya esta 'activo' avisa que fue
 *   activada) y luego el codigo de verificacion por hash. lockRow=true agrega FOR UPDATE.
 * Datos que participan: `client`, `email`, `pin`, `lockRow`.
 * Consultas SQL:
 *   1) SELECT id_usuario, nombres, apellidos, estado FROM usuarios WHERE LOWER(correo) = $1 LIMIT 1 [FOR
 *      UPDATE].
 *   2) SELECT id_codigo, expira_en, usado_en FROM codigos_verificacion WHERE usuario_id = $1 AND LOWER(destino)
 *      = $2 AND usado_en IS NULL AND expira_en > NOW() AND canal = 'correo' AND codigo_hash = $3 ORDER BY creado_en
 *      DESC LIMIT 1 [FOR UPDATE].
 * Retorna: { user, verification, plainPin } o HttpError 400.
 */
async function getActiveRegistrationPinRecord(client, email, pin, lockRow = false) {
    const correo = ensureEmailAddress(email);
    const plainPin = cleanText(pin, 120).toUpperCase();

    if (!correo || !plainPin) {
        throw new HttpError(400, "Completa el correo y el PIN de activacion.");
    }

    const userResult = await client.query(
        `
        SELECT
            id_usuario,
            nombres,
            apellidos,
            estado
        FROM usuarios
        WHERE LOWER(correo) = $1
        LIMIT 1
        ${lockRow ? "FOR UPDATE" : ""}
        `,
        [correo]
    );

    const user = userResult.rows[0];
    if (!user) {
        throw new HttpError(400, "El PIN de activacion no es valido.");
    }

    if (user.estado === "activo") {
        throw new HttpError(400, "La cuenta ya fue activada anteriormente.");
    }

    if (user.estado !== "suspendido") {
        throw new HttpError(400, "El PIN de activacion no es valido.");
    }

    const pinResult = await client.query(
        `
        SELECT
            id_codigo,
            expira_en,
            usado_en
        FROM codigos_verificacion
        WHERE usuario_id = $1
          AND LOWER(destino) = $2
          AND usado_en IS NULL
          AND expira_en > NOW()
          AND canal = 'correo'
          AND codigo_hash = $3
        ORDER BY creado_en DESC
        LIMIT 1
        ${lockRow ? "FOR UPDATE" : ""}
        `,
        [user.id_usuario, correo, hashOneTimeToken(plainPin)]
    );

    const verification = pinResult.rows[0];
    if (!verification) {
        throw new HttpError(400, "El PIN de activacion no es valido.");
    }

    if (verification.usado_en) {
        throw new HttpError(400, "El PIN de activacion ya fue utilizado.");
    }

    if (new Date(verification.expira_en) <= new Date()) {
        throw new HttpError(400, "El PIN de activacion ya vencio.");
    }

    return {
        user,
        verification,
        plainPin
    };
}

/**
 * Funcion: loginUser
 *
 * Que hace: resuelve el inicio de sesion completo.
 * Como lo hace: en una transaccion: valida el correo y la clave, bloquea la fila del usuario (FOR UPDATE),
 *   rechaza cuentas no verificadas, inactivas o bloqueadas (423), verifica la clave con scrypt; si falla suma un
 *   intento y a los 5 bloquea 15 minutos; si acierta rehashea claves antiguas, reinicia intentos, registra el
 *   acceso y firma el token de sesion.
 * Datos que participan: { email, password, ipAddress, userAgent }.
 * Consultas SQL:
 *   1) SELECT u.id_usuario, u.estado, uc.password_hash, uc.intentos_fallidos, uc.bloqueado_hasta FROM usuarios u
 *      JOIN usuarios_credenciales uc ON uc.usuario_id = u.id_usuario WHERE LOWER(u.correo) = $1 FOR UPDATE.
 *   2) UPDATE usuarios_credenciales SET intentos_fallidos, bloqueado_hasta (clave incorrecta).
 *   3) UPDATE ... SET password_hash, ultimo_cambio_password (si needsRehash).
 *   4) UPDATE ... SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login_exitoso = NOW() (exito).
 *   5) INSERT en accesos_usuario (resultado fallido/exitoso) via insertAccessLog.
 * Retorna: { token, user, alerts, unreadAlerts }. Errores: 400, 401 (credenciales invalidas), 403, 423.
 */
async function loginUser({ email, password, ipAddress, userAgent }) {
    return withTransaction(async (client) => {
        const normalizedEmail = ensureEmailAddress(email);
        const rawPassword = String(password || "");

        if (!normalizedEmail || !rawPassword) {
            throw new HttpError(400, "Debes completar correo y contrasena.");
        }

        const result = await client.query(
            `
            SELECT
                u.id_usuario,
                u.estado,
                uc.password_hash,
                uc.intentos_fallidos,
                uc.bloqueado_hasta,
                uc.doble_factor_activo
            FROM usuarios u
            JOIN usuarios_credenciales uc
                ON uc.usuario_id = u.id_usuario
            WHERE LOWER(u.correo) = $1
            FOR UPDATE
            `,
            [normalizedEmail]
        );

        const row = result.rows[0];
        if (!row) {
            throw new HttpError(401, "Credenciales invalidas.");
        }

        if (row.estado === "suspendido") {
            throw new HttpError(403, "La cuenta aun no ha sido verificada. Revisa tu correo y activa el acceso con el PIN enviado.");
        }

        if (row.estado !== "activo") {
            throw new HttpError(403, "La cuenta no esta activa.");
        }

        if (row.bloqueado_hasta && new Date(row.bloqueado_hasta) > new Date()) {
            throw new HttpError(423, "La cuenta esta temporalmente bloqueada. Intenta de nuevo mas tarde.");
        }

        const verification = verifyPassword(rawPassword, row.password_hash);
        if (!verification.valid) {
            const nextAttempts = Number(row.intentos_fallidos || 0) + 1;
            const shouldBlock = nextAttempts >= 5;
            const blockedUntil = shouldBlock ? new Date(Date.now() + 15 * 60 * 1000) : null;

            await client.query(
                `
                UPDATE usuarios_credenciales
                SET
                    intentos_fallidos = $1,
                    bloqueado_hasta = $2,
                    actualizado_en = NOW()
                WHERE usuario_id = $3
                `,
                [nextAttempts, blockedUntil, row.id_usuario]
            );

            await insertAccessLog(client, {
                userId: row.id_usuario,
                ipAddress,
                userAgent,
                result: "fallido",
                detail: "Credenciales invalidas"
            });

            throw new HttpError(401, "Credenciales invalidas.");
        }

        if (verification.needsRehash) {
            await client.query(
                `
                UPDATE usuarios_credenciales
                SET
                    password_hash = $1,
                    ultimo_cambio_password = NOW(),
                    actualizado_en = NOW()
                WHERE usuario_id = $2
                `,
                [createPasswordHash(rawPassword), row.id_usuario]
            );
        }

        // Segundo paso: con la verificacion en dos pasos activa, la contrasena correcta NO basta.
        // Se reinician los intentos fallidos (la contrasena fue valida) pero no se toca ultimo_login_exitoso
        // ni se entrega token: eso ocurre solo cuando verifyTwoFactorLogin recibe el codigo correcto.
        if (row.doble_factor_activo) {
            await client.query(
                `
                UPDATE usuarios_credenciales
                SET
                    intentos_fallidos = 0,
                    bloqueado_hasta = NULL,
                    actualizado_en = NOW()
                WHERE usuario_id = $1
                `,
                [row.id_usuario]
            );

            return issueTwoFactorChallenge(client, row.id_usuario, { ipAddress, userAgent });
        }

        await client.query(
            `
            UPDATE usuarios_credenciales
            SET
                intentos_fallidos = 0,
                bloqueado_hasta = NULL,
                ultimo_login_exitoso = NOW(),
                actualizado_en = NOW()
            WHERE usuario_id = $1
            `,
            [row.id_usuario]
        );

        await insertAccessLog(client, {
            userId: row.id_usuario,
            ipAddress,
            userAgent,
            result: "exitoso",
            detail: "Login web completado"
        });

        const session = await getSession(row.id_usuario, client);
        return {
            token: createToken(row.id_usuario),
            ...session
        };
    });
}

/**
 * Funcion: registerUser
 *
 * Que hace: da de alta al usuario y le deja su wallet principal operativa; el acceso se cierra hasta verificar
 *   el correo.
 * Como lo hace: en una transaccion: valida cada dato (nombre, correo, telefono, mayoria de edad, DUI,
 *   direccion, fortaleza de clave), bloquea duplicados, inserta el usuario en estado 'suspendido', sus
 *   credenciales con hash scrypt, la cuenta principal con bono de $50, la transaccion y el movimiento contable
 *   del bono, bitacora, alerta y emite el PIN de activacion por correo.
 * Datos que participan: { firstName, lastName, email, phone, birthDate, documentId, address, password,
 *   requestBaseUrl, ipAddress, userAgent }.
 * Consultas SQL:
 *   1) ensureUniqueUserIdentityData: busca correo/telefono/DUI repetidos.
 *   2) getBootstrapState: COUNT de usuarios para saber si es el primero.
 *   3) INSERT INTO usuarios (...) VALUES (..., 'suspendido') RETURNING id_usuario.
 *   4) INSERT INTO usuarios_credenciales (usuario_id, password_hash, doble_factor_activo, intentos_fallidos,
 *      ultimo_cambio_password).
 *   5) INSERT INTO cuentas (... 'wallet_principal', 'USD', saldo = bono, es_principal = TRUE,
 *      bono_bienvenida_aplicado = TRUE, 'activa') RETURNING columnas de cuenta.
 *   6) INSERT INTO transacciones (tipo 'bono_bienvenida', estado 'completada', canal 'web', referencia BONO-...)
 *      RETURNING id_transaccion.
 *   7) INSERT INTO movimientos_cuenta (tipo 'credito', monto, saldo_resultante) que respalda contablemente el
 *      bono.
 *   8) accesos_usuario, alertas_usuario y codigos_verificacion.
 * Retorna: { message, requiresVerification: true, account, isFirstSystemUser, activationEmail, previewMode,
 *   previewPin, previewActivationUrl }.
 */
async function registerUser({
    firstName,
    lastName,
    email,
    phone,
    birthDate,
    documentId,
    address,
    password,
    requestBaseUrl,
    ipAddress,
    userAgent
}) {
    return withTransaction(async (client) => {
        // En este flujo preparo todo de una vez para que
        // el usuario salga con wallet lista y trazabilidad
        // financiera real desde el primer minuto.
        const nombres = ensureHumanName(firstName, "los nombres", 80);
        const apellidos = ensureHumanName(lastName, "los apellidos", 80);
        const correo = ensureEmailAddress(email);
        const telefono = ensurePhoneNumber(phone);
        const fechaNacimiento = ensureBirthDateIsAdult(birthDate, true);
        const documentoIdentidad = ensureDui(documentId);
        const direccion = ensureAddressText(address, true);
        const rawPassword = String(password || "");

        ensurePasswordStrength(rawPassword);

        // Aqui bloqueo identidades duplicadas antes de crear nada en la base.
        // Reviso correo, telefono y DUI para devolver errores claros y no depender solo del fallo SQL final.
        await ensureUniqueUserIdentityData(client, {
            email: correo,
            phone: telefono,
            documentId: documentoIdentidad
        });

        const bootstrapState = await getBootstrapState(client);
        const isFirstSystemUser = bootstrapState.totalUsers === 0;

        const userResult = await client.query(
            `
            INSERT INTO usuarios (
                nombres,
                apellidos,
                correo,
                telefono,
                fecha_nacimiento,
                documento_identidad,
                direccion,
                estado
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'suspendido')
            RETURNING id_usuario
            `,
            [
                nombres,
                apellidos,
                correo,
                telefono || null,
                fechaNacimiento || null,
                documentoIdentidad || null,
                direccion || null
            ]
        );

        const userId = userResult.rows[0].id_usuario;
        const accountNumber = createAccountNumber(userId);
        const welcomeBonus = 50;

        await client.query(
            `
            INSERT INTO usuarios_credenciales (
                usuario_id,
                password_hash,
                doble_factor_activo,
                intentos_fallidos,
                ultimo_cambio_password
            )
            VALUES ($1, $2, FALSE, 0, NOW())
            `,
            [userId, createPasswordHash(rawPassword)]
        );

        const accountResult = await client.query(
            `
            INSERT INTO cuentas (
                usuario_id,
                numero_cuenta,
                alias_cuenta,
                tipo_cuenta,
                moneda,
                saldo_disponible,
                saldo_retenido,
                saldo_contable,
                limite_diario,
                es_principal,
                bono_bienvenida_aplicado,
                estado,
                fecha_apertura
            )
            VALUES ($1, $2, 'Cuenta principal', 'wallet_principal', 'USD', $3, 0, $3, 0, TRUE, TRUE, 'activa', CURRENT_DATE)
            RETURNING
                id_cuenta,
                numero_cuenta,
                alias_cuenta,
                tipo_cuenta,
                moneda,
                saldo_disponible,
                saldo_retenido,
                saldo_contable,
                limite_diario,
                bono_bienvenida_aplicado,
                es_principal,
                estado
            `,
            [userId, accountNumber, welcomeBonus]
        );

        const account = mapAccount(accountResult.rows[0]);

        const bonusTransaction = await client.query(
            `
            INSERT INTO transacciones (
                usuario_id,
                tipo,
                estado,
                canal,
                concepto,
                referencia_interna,
                monto_total,
                fecha_ejecucion,
                observaciones
            )
            VALUES ($1, 'bono_bienvenida', 'completada', 'web', $2, $3, $4, NOW(), $5)
            RETURNING id_transaccion
            `,
            [
                userId,
                'Bono de bienvenida',
                createReference("BONO"),
                welcomeBonus,
                'Abono inicial al crear la wallet principal'
            ]
        );

        await client.query(
            `
            INSERT INTO movimientos_cuenta (
                transaccion_id,
                cuenta_id,
                tipo_movimiento,
                monto,
                descripcion,
                saldo_resultante
            )
            VALUES ($1, $2, 'credito', $3, $4, $5)
            `,
            [
                bonusTransaction.rows[0].id_transaccion,
                account.id,
                welcomeBonus,
                'Bono de bienvenida acreditado',
                welcomeBonus
            ]
        );

        await insertAccessLog(client, {
            userId,
            ipAddress,
            userAgent,
            result: "exitoso",
            detail: "Registro web completado"
        });

        await insertAlert(client, {
            userId,
            type: "sistema",
            title: "Bono de bienvenida acreditado",
            message: "Tu cuenta principal recibio un bono de bienvenida de $50.00.",
            level: "informativo"
        });

        const userName = `${nombres} ${apellidos}`.trim();
        const verificationDelivery = await issueRegistrationVerificationCode(client, {
            userId,
            email: correo,
            userName,
            requestBaseUrl,
            ipAddress
        });

        return {
            message: "Registro completado. Verifica tu correo para activar la cuenta y terminar el acceso inicial.",
            requiresVerification: true,
            account,
            isFirstSystemUser,
            activationEmail: correo,
            previewMode: verificationDelivery.previewMode,
            previewPin: verificationDelivery.previewPin,
            previewActivationUrl: verificationDelivery.previewActivationUrl
        };
    });
}

/**
 * Funcion: verifyRegistrationPin
 *
 * Que hace: cierra la activacion del registro y devuelve una sesion real.
 * Como lo hace: en una transaccion: valida el PIN con bloqueo de fila, pasa el usuario a 'activo', consume los
 *   codigos de correo pendientes, registra el acceso y una alerta de seguridad y firma el token.
 * Datos que participan: { email, pin, ipAddress, userAgent }.
 * Consultas SQL:
 *   1) getActiveRegistrationPinRecord (SELECT ... FOR UPDATE).
 *   2) UPDATE usuarios SET estado = 'activo', actualizado_en = NOW() WHERE id_usuario = $1.
 *   3) UPDATE codigos_verificacion SET usado_en = NOW() WHERE usuario_id = $1 AND canal = 'correo' AND usado_en
 *      IS NULL.
 *   4) INSERT en accesos_usuario y alertas_usuario.
 *   5) getSession.
 * Retorna: { message, activationConsumed, token, user, alerts, unreadAlerts }.
 */
async function verifyRegistrationPin({ email, pin, ipAddress, userAgent }) {
    return withTransaction(async (client) => {
        const { user, verification } = await getActiveRegistrationPinRecord(client, email, pin, true);

        await client.query(
            `
            UPDATE usuarios
            SET
                estado = 'activo',
                actualizado_en = NOW()
            WHERE id_usuario = $1
            `,
            [user.id_usuario]
        );

        await client.query(
            `
            UPDATE codigos_verificacion
            SET usado_en = NOW()
            WHERE usuario_id = $1
              AND canal = 'correo'
              AND usado_en IS NULL
            `,
            [user.id_usuario]
        );

        await insertAccessLog(client, {
            userId: user.id_usuario,
            ipAddress,
            userAgent,
            result: "exitoso",
            detail: "Correo de registro verificado"
        });

        await insertAlert(client, {
            userId: user.id_usuario,
            type: "seguridad",
            title: "Correo verificado",
            message: "La cuenta ya quedo activada y lista para operar.",
            level: "aceptacion"
        });

        const session = await getSession(user.id_usuario, client);

        return {
            message: "Cuenta activada correctamente. Bienvenido a tu wallet.",
            activationConsumed: Boolean(verification.id_codigo),
            token: createToken(user.id_usuario),
            ...session
        };
    });
}

/**
 * Funcion: resendRegistrationPin
 *
 * Que hace: genera un PIN nuevo solo si la cuenta sigue pendiente.
 * Como lo hace: busca el usuario por correo; si no existe o ya no esta 'suspendido' responde con un mensaje
 *   generico (no revela si el correo existe). Reutiliza la salida de preview para ambientes sin correo real.
 * Datos que participan: { email, requestBaseUrl, ipAddress }.
 * Consultas SQL: SELECT id_usuario, nombres, apellidos, correo, estado FROM usuarios WHERE LOWER(correo) = $1
 *   LIMIT 1; luego issueRegistrationVerificationCode (UPDATE + INSERT en codigos_verificacion).
 * Retorna: { message, activationEmail?, previewMode?, previewPin?, previewActivationUrl? }.
 */
async function resendRegistrationPin({ email, requestBaseUrl, ipAddress }) {
    const correo = ensureEmailAddress(email);

    return withTransaction(async (client) => {
        const userResult = await client.query(
            `
            SELECT
                id_usuario,
                nombres,
                apellidos,
                correo,
                estado
            FROM usuarios
            WHERE LOWER(correo) = $1
            LIMIT 1
            `,
            [correo]
        );

        const user = userResult.rows[0];
        if (!user || user.estado !== "suspendido") {
            return {
                message: "Si la cuenta sigue pendiente, te reenviamos un nuevo PIN de activacion."
            };
        }

        const delivery = await issueRegistrationVerificationCode(client, {
            userId: user.id_usuario,
            email: user.correo,
            userName: `${user.nombres || ""} ${user.apellidos || ""}`.trim(),
            requestBaseUrl,
            ipAddress
        });

        return {
            message: "Te reenviamos un nuevo PIN de activacion al correo asociado a tu cuenta.",
            activationEmail: user.correo,
            previewMode: delivery.previewMode,
            previewPin: delivery.previewPin,
            previewActivationUrl: delivery.previewActivationUrl
        };
    });
}

/**
 * Funcion: requestPasswordReset
 *
 * Que hace: arranca la recuperacion de contrasena por PIN.
 * Como lo hace: invalida PINes anteriores, genera uno nuevo, guarda su hash con expiracion
 *   (config.passwordResetTokenMinutes) y lo envia por correo. Siempre responde igual exista o no el correo, para
 *   no filtrar que cuentas existen.
 * Datos que participan: { email, requestBaseUrl, ipAddress }.
 * Consultas SQL:
 *   1) SELECT id_usuario, nombres, apellidos, correo, telefono, estado FROM usuarios WHERE LOWER(correo) = $1
 *      LIMIT 1.
 *   2) UPDATE tokens_recuperacion_password SET usado_en = NOW() WHERE usuario_id = $1 AND usado_en IS NULL AND
 *      expira_en > NOW().
 *   3) INSERT INTO tokens_recuperacion_password (usuario_id, correo_destino, token_hash, expira_en,
 *      solicitado_desde_ip) con NULLIF($5,'')::INET para la IP.
 * Retorna: { message, deliveryChannel, previewMode, previewPin, previewResetUrl }.
 */
async function requestPasswordReset({ email, requestBaseUrl, ipAddress }) {
    const correo = ensureEmailAddress(email);

    return withTransaction(async (client) => {
        const genericResponse = {
            message: "Si el correo existe en la wallet, se envio un PIN de recuperacion."
        };

        const userResult = await client.query(
            `
            SELECT
                id_usuario,
                nombres,
                apellidos,
                correo,
                telefono,
                estado
            FROM usuarios
            WHERE LOWER(correo) = $1
            LIMIT 1
            `,
            [correo]
        );

        const user = userResult.rows[0];
        if (!user || user.estado !== "activo") {
            return genericResponse;
        }

        await client.query(
            `
            UPDATE tokens_recuperacion_password
            SET usado_en = NOW()
            WHERE usuario_id = $1
              AND usado_en IS NULL
              AND expira_en > NOW()
            `,
            [user.id_usuario]
        );

        const plainPin = createOneTimePin(6);
        const tokenHash = hashOneTimeToken(plainPin);
        const expiresAt = new Date(Date.now() + config.passwordResetTokenMinutes * 60 * 1000);

        await client.query(
            `
            INSERT INTO tokens_recuperacion_password (
                usuario_id,
                correo_destino,
                token_hash,
                expira_en,
                solicitado_desde_ip
            )
            VALUES ($1, $2, $3, $4, NULLIF($5, '')::INET)
            `,
            [user.id_usuario, user.correo, tokenHash, expiresAt, ipAddress || ""]
        );

        const resetUrl = `${normalizePublicBaseUrl(requestBaseUrl)}/views/login.html?modo=reset&correo=${encodeURIComponent(user.correo)}`;
        const userName = `${user.nombres} ${user.apellidos || ""}`.trim();
        const delivery = await sendPasswordResetEmail({
            to: user.correo,
            userName,
            pin: plainPin,
            resetUrl
        });

        return {
            ...genericResponse,
            deliveryChannel: "email",
            previewMode: Boolean(delivery.preview),
            previewPin: delivery.preview ? plainPin : null,
            previewResetUrl: delivery.preview ? resetUrl : null
        };
    });
}

/**
 * Funcion: verifyPasswordResetPin
 *
 * Que hace: hace una validacion previa del PIN para habilitar el cambio de contrasena en el frontend.
 * Como lo hace: reutiliza getActiveRecoveryPinRecord sin bloquear filas y sin consumir el PIN.
 * Datos que participan: { email, pin }.
 * Consultas SQL: las de getActiveRecoveryPinRecord.
 * Retorna: { message, pinValidated: true }.
 */
async function verifyPasswordResetPin({ email, pin }) {
    return withTransaction(async (client) => {
        await getActiveRecoveryPinRecord(client, email, pin, false);
        return {
            message: "PIN valido. Ya puedes cambiar tu contrasena.",
            pinValidated: true
        };
    });
}

/**
 * Funcion: resetPasswordWithToken
 *
 * Que hace: cierra la recuperacion reemplazando la contrasena y devolviendo una sesion nueva.
 * Como lo hace: valida datos y fortaleza de la clave, y en una transaccion verifica el PIN con bloqueo, guarda
 *   el nuevo hash, limpia intentos y bloqueos, marca los PINes como usados, registra el acceso y firma el token.
 * Datos que participan: { email, pin, newPassword, ipAddress, userAgent }.
 * Consultas SQL:
 *   1) getActiveRecoveryPinRecord (FOR UPDATE).
 *   2) UPDATE usuarios_credenciales SET password_hash, intentos_fallidos = 0, bloqueado_hasta = NULL,
 *      ultimo_cambio_password = NOW() WHERE usuario_id = $2.
 *   3) UPDATE tokens_recuperacion_password SET usado_en = NOW() WHERE usuario_id = $1 AND usado_en IS NULL.
 *   4) accesos_usuario.
 *   5) getSession.
 * Retorna: { message, token, user, alerts, unreadAlerts }.
 */
async function resetPasswordWithToken({ email, pin, newPassword, ipAddress, userAgent }) {
    const correo = ensureEmailAddress(email);
    const rawPassword = String(newPassword || "");

    if (!cleanText(pin, 120) || !rawPassword) {
        throw new HttpError(400, "Completa correo, PIN y nueva contrasena.");
    }

    ensurePasswordStrength(rawPassword);

    return withTransaction(async (client) => {
        const { user } = await getActiveRecoveryPinRecord(client, correo, pin, true);

        await client.query(
            `
            UPDATE usuarios_credenciales
            SET
                password_hash = $1,
                intentos_fallidos = 0,
                bloqueado_hasta = NULL,
                ultimo_cambio_password = NOW(),
                actualizado_en = NOW()
            WHERE usuario_id = $2
            `,
            [createPasswordHash(rawPassword), user.id_usuario]
        );

        await client.query(
            `
            UPDATE tokens_recuperacion_password
            SET usado_en = NOW()
            WHERE usuario_id = $1
              AND usado_en IS NULL
            `,
            [user.id_usuario]
        );

        await insertAccessLog(client, {
            userId: user.id_usuario,
            ipAddress,
            userAgent,
            result: "exitoso",
            detail: "Recuperacion de contrasena completada"
        });

        const session = await getSession(user.id_usuario, client);

        return {
            message: "Contrasena actualizada correctamente. Accediste de nuevo a tu wallet.",
            token: createToken(user.id_usuario),
            ...session
        };
    });
}

const TWO_FACTOR_MAX_ATTEMPTS = 5;

// Estado en memoria de cada desafio de segundo paso: intentos fallidos y uso unico. Se purga al vencer.
// Si el servidor se reinicia, los desafios pendientes se pierden y la persona simplemente inicia sesion otra vez.
const twoFactorChallengeState = new Map();

/**
 * Funcion: maskEmail
 *
 * Que hace: oculta parte del correo para mostrarlo sin exponerlo completo (j***@gmail.com).
 * Como lo hace: conserva la primera letra de la parte local y el dominio completo.
 * Datos que participan: `email`.
 * Consultas SQL: ninguna.
 * Retorna: string.
 */
function maskEmail(email) {
    const [local = "", domain = ""] = String(email || "").split("@");
    return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Funcion: purgeTwoFactorState
 *
 * Que hace: elimina del Map en memoria los desafios ya vencidos para que no crezca indefinidamente.
 * Como lo hace: recorre las entradas y borra las que tienen expiresAt en el pasado.
 * Datos que participan: twoFactorChallengeState.
 * Consultas SQL: ninguna.
 * Retorna: nada.
 */
function purgeTwoFactorState() {
    const now = Date.now();
    for (const [jti, state] of twoFactorChallengeState) {
        if (state.expiresAt < now) {
            twoFactorChallengeState.delete(jti);
        }
    }
}

/**
 * Funcion: issueTwoFactorChallenge
 *
 * Que hace: genera y envia el codigo del segundo paso y devuelve el desafio firmado al navegador.
 * Como lo hace: crea un PIN de 6 digitos, lo envia por correo y arma el desafio con createTwoFactorChallengeToken;
 *               registra el evento en la bitacora de accesos. Si el correo no se puede enviar lanza el error y la
 *               transaccion del login se revierte (no hay forma de entrar sin segundo paso).
 * Datos que participan: `client` (transaccion del login), `userId`, { ipAddress, userAgent }.
 * Consultas SQL: getUserById (SELECT usuarios JOIN usuarios_credenciales) e INSERT en accesos_usuario.
 * Retorna: { requiresTwoFactor: true, twoFactorToken, maskedEmail, expiresInMinutes, message, previewMode, previewPin }.
 */
async function issueTwoFactorChallenge(client, userId, { ipAddress, userAgent }) {
    const user = await getUserById(userId, client);
    const plainPin = createOneTimePin(6);
    const challenge = createTwoFactorChallengeToken(userId, plainPin, config.twoFactorCodeMinutes);

    const delivery = await sendTwoFactorCodeEmail({
        to: user.correo,
        userName: `${user.nombres || ""} ${user.apellidos || ""}`.trim(),
        pin: plainPin
    });

    twoFactorChallengeState.set(challenge.jti, {
        attempts: 0,
        used: false,
        expiresAt: Date.now() + config.twoFactorCodeMinutes * 60 * 1000
    });

    await insertAccessLog(client, {
        userId,
        ipAddress,
        userAgent,
        result: "exitoso",
        detail: "Contrasena validada; pendiente codigo de verificacion"
    });

    return {
        requiresTwoFactor: true,
        twoFactorToken: challenge.token,
        maskedEmail: maskEmail(user.correo),
        expiresInMinutes: config.twoFactorCodeMinutes,
        message: "Te enviamos un codigo de verificacion al correo. Ingresalo para terminar de iniciar sesion.",
        previewMode: Boolean(delivery.preview),
        previewPin: delivery.preview ? plainPin : null
    };
}

/**
 * Funcion: verifyTwoFactorLogin
 *
 * Que hace: completa el inicio de sesion validando el codigo del segundo paso y, solo entonces, entrega el token.
 * Como lo hace: verifica la firma y vigencia del desafio, comprueba que no se haya usado ni agotado sus 5
 *               intentos, compara el hash del codigo con timingSafeEqual y marca el desafio como usado (un solo uso).
 *               Un codigo incorrecto suma un intento y queda en la bitacora como 'fallido'.
 * Datos que participan: { token (desafio), pin, ipAddress, userAgent }.
 * Consultas SQL:
 *   1) INSERT INTO accesos_usuario (resultado 'fallido') por cada codigo incorrecto.
 *   2) SELECT u.estado FROM usuarios u WHERE id_usuario = $1: la cuenta debe seguir activa.
 *   3) UPDATE usuarios_credenciales SET ultimo_login_exitoso = NOW(): recien aqui cuenta como login exitoso.
 *   4) INSERT INTO accesos_usuario (resultado 'exitoso') y getSession.
 * Retorna: { token, user, alerts, unreadAlerts }. Errores 400 (codigo vacio) y 401 (desafio invalido, codigo
 *          incorrecto o intentos agotados).
 */
async function verifyTwoFactorLogin({ token, pin, ipAddress, userAgent }) {
    const payload = verifyTwoFactorChallengeToken(token);
    if (!payload) {
        throw new HttpError(401, "La verificacion expiro o no es valida. Inicia sesion de nuevo.");
    }

    purgeTwoFactorState();
    const state = twoFactorChallengeState.get(payload.jti);
    if (!state || state.used) {
        throw new HttpError(401, "Este codigo ya no esta disponible. Inicia sesion de nuevo.");
    }

    if (state.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
        throw new HttpError(401, "Agotaste los intentos del codigo. Inicia sesion de nuevo.");
    }

    const plainPin = cleanText(pin, 20).replace(/\D/g, "");
    if (!plainPin) {
        throw new HttpError(400, "Ingresa el codigo de verificacion enviado a tu correo.");
    }

    if (!hashesMatch(hashOneTimeToken(plainPin), payload.codeHash)) {
        state.attempts += 1;
        await withTransaction(async (client) => {
            await insertAccessLog(client, {
                userId: payload.userId,
                ipAddress,
                userAgent,
                result: "fallido",
                detail: "Codigo de verificacion en dos pasos incorrecto"
            });
        });

        const remaining = TWO_FACTOR_MAX_ATTEMPTS - state.attempts;
        throw new HttpError(
            401,
            remaining > 0
                ? `Codigo incorrecto. Te quedan ${remaining} intento(s).`
                : "Agotaste los intentos del codigo. Inicia sesion de nuevo."
        );
    }

    state.used = true;

    return withTransaction(async (client) => {
        const userResult = await client.query(
            `
            SELECT estado
            FROM usuarios
            WHERE id_usuario = $1
            LIMIT 1
            `,
            [payload.userId]
        );

        if (!userResult.rows[0] || userResult.rows[0].estado !== "activo") {
            throw new HttpError(403, "La cuenta no esta activa.");
        }

        await client.query(
            `
            UPDATE usuarios_credenciales
            SET
                ultimo_login_exitoso = NOW(),
                actualizado_en = NOW()
            WHERE usuario_id = $1
            `,
            [payload.userId]
        );

        await insertAccessLog(client, {
            userId: payload.userId,
            ipAddress,
            userAgent,
            result: "exitoso",
            detail: "Login web completado con verificacion en dos pasos"
        });

        const session = await getSession(payload.userId, client);
        return {
            token: createToken(payload.userId),
            ...session
        };
    });
}

/**
 * Funcion: setTwoFactorEnabled
 *
 * Que hace: activa o desactiva la verificacion en dos pasos de la cuenta autenticada.
 * Como lo hace: exige la contrasena actual (evita que alguien con una sesion abierta cambie la seguridad), la
 *               verifica con scrypt bajo bloqueo de fila, actualiza la bandera y deja alerta de seguridad y
 *               registro en la bitacora.
 * Datos que participan: `userId`, { enabled (boolean), password, ipAddress, userAgent }.
 * Consultas SQL:
 *   1) SELECT password_hash FROM usuarios_credenciales WHERE usuario_id = $1 FOR UPDATE.
 *   2) UPDATE usuarios_credenciales SET doble_factor_activo = $2, actualizado_en = NOW() WHERE usuario_id = $1.
 *   3) INSERT en alertas_usuario (tipo 'seguridad') y en accesos_usuario.
 * Retorna: { message, twoFactorEnabled }. Errores 400 (sin contrasena) y 401 (contrasena incorrecta).
 */
async function setTwoFactorEnabled(userId, { enabled, password, ipAddress, userAgent }) {
    const rawPassword = String(password || "");
    if (!rawPassword) {
        throw new HttpError(400, "Ingresa tu contrasena para confirmar el cambio.");
    }

    const nextValue = Boolean(enabled);

    return withTransaction(async (client) => {
        const result = await client.query(
            `
            SELECT password_hash
            FROM usuarios_credenciales
            WHERE usuario_id = $1
            FOR UPDATE
            `,
            [userId]
        );

        const row = result.rows[0];
        if (!row || !verifyPassword(rawPassword, row.password_hash).valid) {
            throw new HttpError(401, "La contrasena no es correcta.");
        }

        await client.query(
            `
            UPDATE usuarios_credenciales
            SET
                doble_factor_activo = $2,
                actualizado_en = NOW()
            WHERE usuario_id = $1
            `,
            [userId, nextValue]
        );

        await insertAlert(client, {
            userId,
            type: "seguridad",
            title: nextValue ? "Verificacion en dos pasos activada" : "Verificacion en dos pasos desactivada",
            message: nextValue
                ? "Desde ahora, al iniciar sesion te pediremos un codigo enviado a tu correo."
                : "Ya no se pedira codigo por correo al iniciar sesion. Puedes volver a activarla cuando quieras.",
            level: nextValue ? "aceptacion" : "alerta"
        });

        await insertAccessLog(client, {
            userId,
            ipAddress,
            userAgent,
            result: "exitoso",
            detail: nextValue ? "Verificacion en dos pasos activada" : "Verificacion en dos pasos desactivada"
        });

        return {
            message: nextValue
                ? "Verificacion en dos pasos activada."
                : "Verificacion en dos pasos desactivada.",
            twoFactorEnabled: nextValue
        };
    });
}

module.exports = {
    verifyTwoFactorLogin,
    setTwoFactorEnabled,
    loginUser,
    registerUser,
    verifyRegistrationPin,
    resendRegistrationPin,
    getBootstrapState,
    requestPasswordReset,
    verifyPasswordResetPin,
    resetPasswordWithToken,
    getSession
};
