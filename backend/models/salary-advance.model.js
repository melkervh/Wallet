/**
 * Modulo: models/salary-advance.model.js
 *
 * Que hace: logica de negocio de adelantos salariales: politicas (monto, cupo anual), codigo de autorizacion
 *   por correo y acreditacion en la wallet.
 * Como lo hace: valida elegibilidad antes de tocar saldos; el codigo se guarda hasheado y se consume una sola
 *   vez; la acreditacion corre en UNA transaccion y deja registro maestro, transaccion, movimiento contable y
 *   alerta.
 * Datos que participan: tablas `adelantos_salariales`, `transacciones`, `cuentas`, `movimientos_cuenta`,
 *   `codigos_verificacion` y `alertas_usuario`. Politicas: monto entre $25 y $500, maximo 3 adelantos en 365
 *   dias, un solo adelanto abierto, pago a 15 dias en 2 cuotas.
 * Consultas SQL: ver detalle en cada funcion.
 */

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

/**
 * Funcion: validateAdvanceAmount
 *
 * Que hace: valida el rango permitido del adelanto antes de tocar la base de datos.
 * Como lo hace: comprueba que sea un numero finito entre MIN_ADVANCE_AMOUNT (25) y MAX_ADVANCE_AMOUNT (500).
 * Datos que participan: `amount`.
 * Consultas SQL: ninguna.
 * Retorna: nada; lanza HttpError 400 si esta fuera de rango.
 */
function validateAdvanceAmount(amount) {
    if (!Number.isFinite(amount) || amount < MIN_ADVANCE_AMOUNT || amount > MAX_ADVANCE_AMOUNT) {
        throw new HttpError(
            400,
            `El adelanto salarial debe estar entre $${MIN_ADVANCE_AMOUNT.toFixed(2)} y $${MAX_ADVANCE_AMOUNT.toFixed(2)}.`
        );
    }
}

/**
 * Funcion: getAnnualAdvanceUsage
 *
 * Que hace: cuenta cuantos adelantos uso el cliente durante el ultimo anio para frenar abuso.
 * Como lo hace: COUNT filtrado por estados que implican que el adelanto realmente se otorgo.
 * Datos que participan: `userId` ($1).
 * Consultas SQL: SELECT COUNT(*) AS total FROM adelantos_salariales WHERE usuario_id = $1 AND estado IN
 *   ('activo', 'pagado', 'vencido') AND fecha_solicitud >= CURRENT_DATE - INTERVAL '365 days': ventana movil de
 *   12 meses.
 * Retorna: number.
 */
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

/**
 * Funcion: getPrimaryAccountForAdvance
 *
 * Que hace: recupera la cuenta principal activa sobre la que se acredita el adelanto.
 * Como lo hace: SELECT de la cuenta principal; con lockRow=true agrega FOR UPDATE para que el saldo no cambie
 *   a mitad de la operacion.
 * Datos que participan: `userId`, `executor`, `lockRow`.
 * Consultas SQL: SELECT id_cuenta, alias_cuenta, saldo_disponible, saldo_contable FROM cuentas WHERE
 *   usuario_id = $1 AND es_principal = TRUE AND estado = 'activa' LIMIT 1 [FOR UPDATE].
 * Retorna: fila de cuenta o null.
 */
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

/**
 * Funcion: validateAdvanceEligibility
 *
 * Que hace: concentra las reglas previas del adelanto: rango, adelanto abierto, cupo anual y cuenta principal.
 * Como lo hace: valida el monto, busca un adelanto abierto (vencido => 423; pendiente o activo => 400), revisa
 *   el cupo anual, obtiene la cuenta principal (bloqueada si options.lockAccount) y calcula fecha de pago (+15
 *   dias) y cuota (monto / 2). Devuelve esos datos para no repetir consultas entre la solicitud del codigo y la
 *   acreditacion final.
 * Datos que participan: `userId`, `amount`, `executor`, `options.lockAccount`.
 * Consultas SQL: getActiveSalaryAdvance (salary-advance.dao), getAnnualAdvanceUsage y
 *   getPrimaryAccountForAdvance.
 * Retorna: { account, usedAdvances, remainingAdvances, nextPaymentDate, installment }.
 */
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

/**
 * Funcion: getValidAdvanceVerificationCode
 *
 * Que hace: verifica que el codigo enviado por correo siga vigente, no este usado y pertenezca al usuario
 *   autenticado.
 * Como lo hace: busca el codigo mas reciente por hash; con lockRow=true toma bloqueo de fila para consumirlo
 *   sin condiciones de carrera.
 * Datos que participan: `client`, `userId`, `verificationCode` (max 20), `lockRow`.
 * Consultas SQL: SELECT id_codigo, expira_en, usado_en, destino FROM codigos_verificacion WHERE usuario_id =
 *   $1 AND canal = 'correo' AND codigo_hash = $2 ORDER BY creado_en DESC LIMIT 1 [FOR UPDATE].
 * Retorna: fila del codigo, o HttpError 400 (vacio, no valido, ya utilizado, vencido).
 */
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

/**
 * Funcion: getSalaryAdvanceCenter
 *
 * Que hace: devuelve el adelanto vigente, el historial reciente y el resumen de politicas operativas.
 * Como lo hace: en una transaccion obtiene el adelanto activo, el uso anual y el historial de los ultimos 8
 *   adelantos con lo pagado de cada uno.
 * Datos que participan: `userId` ($1).
 * Consultas SQL: SELECT de adelantos_salariales (alias a) con LEFT JOIN LATERAL que suma
 *   transacciones.monto_total de tipo 'pago_servicio' y estado 'completada' ligadas al adelanto; saldo_pendiente
 *   = GREATEST(monto_aprobado - total_pagado, 0); WHERE usuario_id = $1 ORDER BY creado_en DESC LIMIT 8.
 * Retorna: { currentAdvance, history, policy }.
 */
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

/**
 * Funcion: requestSalaryAdvanceCode
 *
 * Que hace: envia por correo un codigo temporal para autorizar un adelanto salarial.
 * Como lo hace: valida elegibilidad, obtiene el correo del usuario, anula codigos vigentes anteriores (solo un
 *   codigo util a la vez), genera un PIN de 6 digitos, lo guarda hasheado con expiracion y lo envia.
 * Datos que participan: `userId`, payload { amount }.
 * Consultas SQL:
 *   1) UPDATE codigos_verificacion SET usado_en = NOW() WHERE usuario_id = $1 AND canal = 'correo' AND usado_en
 *      IS NULL AND expira_en > NOW().
 *   2) INSERT INTO codigos_verificacion (usuario_id, canal, destino, codigo_hash, expira_en) VALUES ($1,
 *      'correo', ...). Mas getUserById y getActiveSalaryAdvance.
 * Retorna: { message, deliveryChannel, previewMode, previewPin }.
 */
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

/**
 * Funcion: requestSalaryAdvance
 *
 * Que hace: acredita un adelanto salarial de forma controlada.
 * Como lo hace: en una transaccion: valida limites y cupo, valida y bloquea el codigo, crea el adelanto,
 *   registra la transaccion, suma el monto a la cuenta, escribe el movimiento contable, consume el codigo y deja
 *   la alerta.
 * Datos que participan: `userId`, payload { amount, verificationCode }.
 * Consultas SQL:
 *   1) INSERT INTO adelantos_salariales (...) VALUES (..., 'activo', ...) RETURNING id_adelanto,
 *      numero_adelanto: registro maestro.
 *   2) INSERT INTO transacciones (tipo 'adelanto_salarial', estado 'completada', adelanto_id) RETURNING
 *      id_transaccion: libro central de operaciones.
 *   3) UPDATE cuentas SET saldo_disponible, saldo_contable (sumados) WHERE id_cuenta = $3.
 *   4) INSERT INTO movimientos_cuenta (tipo 'credito', saldo_resultante): trazabilidad contable.
 *   5) UPDATE codigos_verificacion SET usado_en = NOW() WHERE id_codigo = $1: impide reutilizar el codigo.
 *   6) insertAlert.
 * Retorna: { message, number }.
 */
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
