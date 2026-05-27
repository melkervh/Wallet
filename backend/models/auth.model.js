const { withTransaction } = require("../db");
const { config } = require("../env");
const {
    createPasswordHash,
    createToken,
    verifyPassword,
    createOneTimePin,
    hashOneTimeToken
} = require("../auth");
const { sendPasswordResetEmail } = require("../mailer");
const {
    HttpError,
    createAccountNumber,
    createReference,
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
    mapAccount
} = require("./base.model");

// Funcion: getActiveRecoveryPinRecord
// Aqui valido que el correo exista, que el PIN corresponda al usuario
// y que siga vigente antes de permitir cualquier paso de recuperacion.
// Cuando lockRow es true, tomo bloqueo de fila para evitar carreras al consumir el PIN.
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

// Funcion: loginUser
// Aqui resuelvo el inicio de sesion completo:
// valido credenciales, controlo intentos fallidos, rehasheo si hace falta,
// registro el acceso y finalmente construyo la sesion firmada.
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
                uc.bloqueado_hasta
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

// Funcion: registerUser
// Aqui doy de alta al usuario y le dejo su wallet principal operativa desde el primer minuto.
// Tambien creo la credencial, aplico el bono de bienvenida, registro movimiento y genero alerta.
async function registerUser({
    firstName,
    lastName,
    email,
    phone,
    birthDate,
    documentId,
    address,
    password,
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo')
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

        return {
            message: "Registro completado. Ya puedes iniciar sesion. Tu cuenta principal recibio un bono de bienvenida de $50.00.",
            requiresLogin: true,
            account,
            isFirstSystemUser,
            user: await getSession(userId, client).then((session) => session.user)
        };
    });
}

// Funcion: requestPasswordReset
// Aqui arranco la recuperacion por PIN.
// Invalido PINes anteriores, genero uno nuevo, lo guardo hasheado y lo envio por correo.
async function requestPasswordReset({ email, ipAddress }) {
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

        const resetUrl = `${config.appBaseUrl}/views/login.html?modo=reset&correo=${encodeURIComponent(user.correo)}`;
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

// Funcion: verifyPasswordResetPin
// Aqui hago una validacion previa del PIN para habilitar el cambio de contrasena en frontend.
async function verifyPasswordResetPin({ email, pin }) {
    return withTransaction(async (client) => {
        await getActiveRecoveryPinRecord(client, email, pin, false);
        return {
            message: "PIN valido. Ya puedes cambiar tu contrasena.",
            pinValidated: true
        };
    });
}

// Funcion: resetPasswordWithToken
// Aqui cierro la recuperacion reemplazando la contrasena,
// limpiando bloqueos anteriores, marcando PINes usados y devolviendo nueva sesion.
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

module.exports = {
    loginUser,
    registerUser,
    getBootstrapState,
    requestPasswordReset,
    verifyPasswordResetPin,
    resetPasswordWithToken,
    getSession
};
