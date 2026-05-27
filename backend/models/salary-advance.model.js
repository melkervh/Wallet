const { withTransaction } = require("../db");
const { config } = require("../env");
const { createOneTimePin, hashOneTimeToken } = require("../auth");
const { sendSalaryAdvanceCodeEmail } = require("../mailer");
const {
    HttpError,
    cleanText,
    createReference,
    toNumber,
    getActiveSalaryAdvance,
    getUserById,
    insertAlert
} = require("./base.model");

const MIN_ADVANCE_AMOUNT = 25;
const MAX_ADVANCE_AMOUNT = 500;
const MAX_ADVANCES_PER_YEAR = 3;

// Funcion: validateAdvanceAmount
// Aqui valido el rango permitido del adelanto antes de tocar base de datos.
function validateAdvanceAmount(amount) {
    if (!Number.isFinite(amount) || amount < MIN_ADVANCE_AMOUNT || amount > MAX_ADVANCE_AMOUNT) {
        throw new HttpError(
            400,
            `El adelanto salarial debe estar entre $${MIN_ADVANCE_AMOUNT.toFixed(2)} y $${MAX_ADVANCE_AMOUNT.toFixed(2)}.`
        );
    }
}

// Funcion: getAnnualAdvanceUsage
// Aqui cuento cuantos adelantos ya uso el cliente durante el ultimo anio.
// Lo hago para frenar abuso y mantener un maximo operativo claro.
async function getAnnualAdvanceUsage(userId, executor) {
    const result = await executor.query(
        `
        SELECT COUNT(*) AS total
        FROM adelantos_salariales
        WHERE usuario_id = $1
          AND estado IN ('activo', 'pagado', 'vencido')
          AND fecha_solicitud >= CURRENT_DATE - INTERVAL '365 days'
        `,
        [userId]
    );

    return Number(result.rows[0]?.total || 0);
}

// Funcion: getPrimaryAccountForAdvance
// Aqui recupero la cuenta principal activa sobre la que se acredita el adelanto.
// Cuando lockRow es true tambien la bloqueo para que el saldo no cambie a mitad de la operacion.
async function getPrimaryAccountForAdvance(userId, executor, lockRow = false) {
    const result = await executor.query(
        `
        SELECT
            id_cuenta,
            alias_cuenta,
            saldo_disponible,
            saldo_contable
        FROM cuentas
        WHERE usuario_id = $1
          AND es_principal = TRUE
          AND estado = 'activa'
        LIMIT 1
        ${lockRow ? "FOR UPDATE" : ""}
        `,
        [userId]
    );

    return result.rows[0] || null;
}

// Funcion: validateAdvanceEligibility
// Aqui concentro las reglas previas del adelanto: rango, cuenta principal, adelanto abierto y cupo anual.
// Devuelvo tambien datos calculados para no repetir consultas entre solicitud de codigo y acreditacion final.
async function validateAdvanceEligibility(userId, amount, executor, options = {}) {
    const lockAccount = Boolean(options.lockAccount);
    validateAdvanceAmount(amount);

    const currentAdvance = await getActiveSalaryAdvance(userId, executor);
    if (currentAdvance) {
        if (currentAdvance.estado === "vencido") {
            throw new HttpError(
                423,
                `Tienes el adelanto ${currentAdvance.numeroAdelanto} vencido. Regularizalo antes de solicitar uno nuevo.`
            );
        }

        throw new HttpError(400, "Ya tienes un adelanto salarial pendiente o activo.");
    }

    const usedAdvances = await getAnnualAdvanceUsage(userId, executor);
    if (usedAdvances >= MAX_ADVANCES_PER_YEAR) {
        throw new HttpError(
            400,
            `Ya alcanzaste el maximo de ${MAX_ADVANCES_PER_YEAR} adelantos durante los ultimos 12 meses.`
        );
    }

    const account = await getPrimaryAccountForAdvance(userId, executor, lockAccount);
    if (!account) {
        throw new HttpError(404, "No encontro una cuenta principal activa para acreditar el adelanto.");
    }

    const nextPaymentDate = new Date();
    nextPaymentDate.setDate(nextPaymentDate.getDate() + 15);

    return {
        account,
        usedAdvances,
        remainingAdvances: Math.max(MAX_ADVANCES_PER_YEAR - usedAdvances, 0),
        nextPaymentDate,
        installment: Number((amount / 2).toFixed(2))
    };
}

// Funcion: getValidAdvanceVerificationCode
// Aqui verifico que el codigo enviado por correo siga vigente, no este usado y pertenezca al usuario autenticado.
// Si lockRow es true tomo bloqueo de fila para consumirlo sin condiciones de carrera.
async function getValidAdvanceVerificationCode(client, userId, verificationCode, lockRow = false) {
    const plainCode = cleanText(verificationCode, 20);

    if (!plainCode) {
        throw new HttpError(400, "Debes ingresar el codigo enviado por correo para autorizar el adelanto.");
    }

    const result = await client.query(
        `
        SELECT
            id_codigo,
            expira_en,
            usado_en,
            destino
        FROM codigos_verificacion
        WHERE usuario_id = $1
          AND canal = 'correo'
          AND codigo_hash = $2
        ORDER BY creado_en DESC
        LIMIT 1
        ${lockRow ? "FOR UPDATE" : ""}
        `,
        [userId, hashOneTimeToken(plainCode)]
    );

    const codeRecord = result.rows[0];
    if (!codeRecord) {
        throw new HttpError(400, "El codigo de autorizacion del adelanto no es valido.");
    }

    if (codeRecord.usado_en) {
        throw new HttpError(400, "El codigo de autorizacion del adelanto ya fue utilizado.");
    }

    if (new Date(codeRecord.expira_en) <= new Date()) {
        throw new HttpError(400, "El codigo de autorizacion del adelanto ya vencio.");
    }

    return codeRecord;
}

// Funcion: getSalaryAdvanceCenter
// Aqui devuelvo el adelanto vigente, el historial reciente y un resumen de politicas operativas.
async function getSalaryAdvanceCenter(userId) {
    return withTransaction(async (client) => {
        const currentAdvance = await getActiveSalaryAdvance(userId, client);
        const usedAdvances = await getAnnualAdvanceUsage(userId, client);
        // Lectura SQL:
        // Aqui leo el historial del adelanto directamente desde adelantos_salariales
        // y lo cruzo con transacciones para calcular total pagado y saldo pendiente.
        const historyResult = await client.query(
            `
            SELECT
                a.id_adelanto,
                a.numero_adelanto,
                a.monto_aprobado,
                a.cuota_descuento,
                a.fecha_pago_proxima,
                a.estado,
                COALESCE(pagos.total_pagado, 0) AS total_pagado,
                GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) AS saldo_pendiente
            FROM adelantos_salariales a
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(t.monto_total), 0) AS total_pagado
                FROM transacciones t
                WHERE t.adelanto_id = a.id_adelanto
                  AND t.tipo = 'pago_servicio'
                  AND t.estado = 'completada'
            ) pagos ON TRUE
            WHERE a.usuario_id = $1
            ORDER BY a.creado_en DESC
            LIMIT 8
            `,
            [userId]
        );

        return {
            currentAdvance,
            history: historyResult.rows.map((row) => ({
                id: row.id_adelanto,
                numeroAdelanto: row.numero_adelanto,
                montoAprobado: toNumber(row.monto_aprobado),
                cuotaDescuento: toNumber(row.cuota_descuento),
                totalPagado: toNumber(row.total_pagado),
                saldoPendiente: toNumber(row.saldo_pendiente),
                fechaPagoProxima: row.fecha_pago_proxima,
                estado: row.estado
            })),
            policy: {
                minimumAmount: MIN_ADVANCE_AMOUNT,
                maximumAmount: MAX_ADVANCE_AMOUNT,
                maxAnnualAdvances: MAX_ADVANCES_PER_YEAR,
                usedAnnualAdvances: usedAdvances,
                remainingAnnualAdvances: Math.max(MAX_ADVANCES_PER_YEAR - usedAdvances, 0),
                verificationChannel: "correo",
                codeLifetimeMinutes: config.advanceVerificationCodeMinutes
            }
        };
    });
}

// Funcion: requestSalaryAdvanceCode
// Aqui envio por correo un codigo temporal para autorizar un adelanto salarial.
// Antes valido el monto, el cupo del usuario y que no exista otro adelanto abierto.
async function requestSalaryAdvanceCode(userId, payload) {
    return withTransaction(async (client) => {
        const amount = Number(payload.amount);
        await validateAdvanceEligibility(userId, amount, client, { lockAccount: false });

        const user = await getUserById(userId, client);
        if (!user || !user.correo) {
            throw new HttpError(404, "No se encontro un correo activo para enviar el codigo del adelanto.");
        }

        // UPDATE SQL:
        // Antes de crear un codigo nuevo, marco como usados los codigos vigentes anteriores
        // para que solo exista un codigo util por usuario al mismo tiempo.
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

        const plainCode = createOneTimePin(6);
        const expiresAt = new Date(Date.now() + config.advanceVerificationCodeMinutes * 60 * 1000);

        // INSERT SQL:
        // Aqui guardo el codigo nuevo en codigos_verificacion.
        // Lo guardo hasheado, no en texto plano.
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
            [userId, user.correo, hashOneTimeToken(plainCode), expiresAt]
        );

        const delivery = await sendSalaryAdvanceCodeEmail({
            to: user.correo,
            userName: `${user.nombres || ""} ${user.apellidos || ""}`.trim(),
            pin: plainCode,
            amount
        });

        return {
            message: "Te enviamos un codigo de autorizacion al correo asociado a tu cuenta.",
            deliveryChannel: "email",
            previewMode: Boolean(delivery.preview),
            previewPin: delivery.preview ? plainCode : null
        };
    });
}

// Funcion: requestSalaryAdvance
// Aqui acredito un adelanto salarial de forma controlada.
// Valido limites, cupo anual, codigo por correo, saldo de la cuenta y registro todo en una sola transaccion.
async function requestSalaryAdvance(userId, payload) {
    return withTransaction(async (client) => {
        const amount = Number(payload.amount);
        const verificationCode = cleanText(payload.verificationCode, 20);
        const eligibility = await validateAdvanceEligibility(userId, amount, client, { lockAccount: true });
        const codeRecord = await getValidAdvanceVerificationCode(client, userId, verificationCode, true);

        // INSERT SQL:
        // Aqui nace formalmente el adelanto en la tabla adelantos_salariales.
        // Este es el registro maestro del prestamo o adelanto del usuario.
        const advanceResult = await client.query(
            `
            INSERT INTO adelantos_salariales (
                usuario_id,
                cuenta_id,
                numero_adelanto,
                monto_aprobado,
                cuota_descuento,
                fecha_solicitud,
                fecha_pago_proxima,
                estado,
                observaciones
            )
            VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'activo', $7)
            RETURNING id_adelanto, numero_adelanto
            `,
            [
                userId,
                eligibility.account.id_cuenta,
                createReference("ADS"),
                amount,
                eligibility.installment,
                eligibility.nextPaymentDate,
                "Adelanto salarial acreditado desde la wallet"
            ]
        );

        // INSERT SQL:
        // Aqui registro la transaccion financiera que representa la acreditacion del adelanto.
        // La tabla transacciones me sirve como libro central de operaciones.
        const transaction = await client.query(
            `
            INSERT INTO transacciones (
                usuario_id,
                adelanto_id,
                tipo,
                estado,
                canal,
                concepto,
                referencia_interna,
                monto_total,
                fecha_ejecucion,
                observaciones
            )
            VALUES ($1, $2, 'adelanto_salarial', 'completada', 'web', $3, $4, $5, NOW(), $6)
            RETURNING id_transaccion
            `,
            [
                userId,
                advanceResult.rows[0].id_adelanto,
                "Acreditacion de adelanto salarial",
                createReference("TRX-ADS"),
                amount,
                `Adelanto ${advanceResult.rows[0].numero_adelanto}`
            ]
        );

        const saldoDisponible = toNumber(eligibility.account.saldo_disponible) + amount;
        const saldoContable = toNumber(eligibility.account.saldo_contable) + amount;

        // UPDATE SQL:
        // Aqui actualizo el saldo real de la cuenta wallet para reflejar el dinero acreditado.
        await client.query(
            `
            UPDATE cuentas
            SET
                saldo_disponible = $1,
                saldo_contable = $2,
                actualizado_en = NOW()
            WHERE id_cuenta = $3
            `,
                [saldoDisponible, saldoContable, eligibility.account.id_cuenta]
            );

        // INSERT SQL:
        // Aqui guardo el movimiento de cuenta que deja trazabilidad contable del credito.
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
                transaction.rows[0].id_transaccion,
                eligibility.account.id_cuenta,
                amount,
                "Acreditacion de adelanto salarial",
                saldoDisponible
                ]
            );

        // UPDATE SQL:
        // Una vez usado el codigo, lo marco como consumido para impedir reutilizacion.
        await client.query(
            `
            UPDATE codigos_verificacion
            SET usado_en = NOW()
            WHERE id_codigo = $1
            `,
            [codeRecord.id_codigo]
        );

        await insertAlert(client, {
            userId,
            type: "adelanto",
            title: "Adelanto salarial acreditado",
            message: `Se acredito el adelanto ${advanceResult.rows[0].numero_adelanto}. Tu proximo pago es el ${eligibility.nextPaymentDate.toLocaleDateString("es-SV")}.`,
            level: "aceptacion"
        });

        return {
            message: "Adelanto salarial acreditado correctamente.",
            number: advanceResult.rows[0].numero_adelanto
        };
    });
}

module.exports = {
    getSalaryAdvanceCenter,
    requestSalaryAdvanceCode,
    requestSalaryAdvance
};
