const { query } = require("../db");
const HttpError = require("../http-error");

// Esta capa base concentra helpers y consultas reutilizables.
// La idea es que los modelos de negocio se apoyen aqui para no repetir mapeos ni SQL comun.
const dateFormatter = new Intl.DateTimeFormat("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/El_Salvador"
});

// Funcion: toNumber
// Aqui fuerzo conversion numerica con un fallback seguro para montos y contadores.
function toNumber(value) {
    return Number(value || 0);
}

// Funcion: formatDate
// Aqui convierto fechas crudas a un formato corto y consistente para la UI.
function formatDate(value) {
    if (!value) {
        return "";
    }

    return dateFormatter.format(new Date(value));
}

// Funcion: createReference
// Aqui genero referencias internas con fecha y sufijo aleatorio.
// Lo hago para poder rastrear operaciones sin depender del id numerico de la base.
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

// Funcion: createAccountNumber
// Aqui armo el numero publico de wallet a partir del id del usuario y el anio actual.
function createAccountNumber(userId) {
    const yearSuffix = String(new Date().getFullYear()).slice(-2);
    return `WL-${String(userId).padStart(6, "0")}-${yearSuffix}`;
}

// Funcion: normalizeEmail
// Aqui normalizo correos para comparar y guardar siempre con el mismo criterio.
function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

// Funcion: ensureEmailAddress
// Aqui valido el correo con reglas un poco mas estrictas para cortar formatos rotos o sospechosos.
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

// Funcion: cleanText
// Aqui recorto espacios y limito longitud para no propagar texto sucio al resto del backend.
function cleanText(value, maxLength) {
    const text = String(value || "").trim();
    return maxLength ? text.slice(0, maxLength) : text;
}

// Funcion: ensureHumanName
// Aqui valido nombres y apellidos reales, sin numeros ni mezclas alfanumericas extrañas.
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

// Funcion: ensurePhoneNumber
// Aqui valido el telefono como dato de contacto real y descarto patrones claramente falsos.
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

// Funcion: normalizeDui
// Aqui normalizo el DUI a formato 12345678-9 para compararlo y guardarlo siempre igual.
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

// Funcion: ensureDui
// Aqui obligo el formato correcto del DUI antes de registrarlo o actualizarlo.
function ensureDui(value) {
    const normalizedDui = normalizeDui(value);

    if (!normalizedDui) {
        throw new HttpError(400, "Debes ingresar un DUI valido.");
    }

    return normalizedDui;
}

// Funcion: ensureBirthDateIsAdult
// Aqui valido la fecha y tambien exijo mayoria de edad para operaciones sensibles del sistema.
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

// Funcion: ensureAddressText
// Aqui limpio la direccion y corto caracteres raros que no aportan al dato real.
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

// Funcion: ensureUniqueUserIdentityData
// Aqui reviso duplicados sensibles antes de guardar un usuario.
// Comparo correo, telefono normalizado y DUI para bloquear identidades repetidas con mensajes claros.
async function ensureUniqueUserIdentityData(executor, { email, phone, documentId, excludeUserId = 0 }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhoneDigits = cleanText(phone, 25).replace(/\D/g, "");
    const normalizedDui = documentId ? normalizeDui(documentId) : "";

    const result = await executor.query(
        `
        SELECT
            id_usuario,
            correo,
            telefono,
            documento_identidad
        FROM usuarios
        WHERE ($4::BIGINT = 0 OR id_usuario <> $4)
          AND (
              LOWER(correo) = $1
              OR ($2 <> '' AND REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '', 'g') = $2)
              OR ($3 <> '' AND documento_identidad = $3)
          )
        ORDER BY id_usuario ASC
        LIMIT 1
        `,
        [normalizedEmail, normalizedPhoneDigits, normalizedDui, Number(excludeUserId || 0)]
    );

    const duplicatedUser = result.rows[0];
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

// Funcion: ensurePasswordStrength
// Aqui exijo la minima complejidad de contrasena antes de aceptar registros o resets.
function ensurePasswordStrength(password) {
    const rawPassword = String(password || "");
    if (rawPassword.length < 8) {
        throw new HttpError(400, "La contrasena debe tener al menos 8 caracteres.");
    }

    if (!/[A-Za-z]/.test(rawPassword) || !/[0-9]/.test(rawPassword)) {
        throw new HttpError(400, "La contrasena debe incluir letras y numeros.");
    }
}

// Funcion: buildProfileImageUrl
// Aqui convierto el nombre del archivo guardado a una URL publica para el frontend.
function buildProfileImageUrl(fileName) {
    const normalizedFileName = cleanText(fileName, 255);
    if (!normalizedFileName) {
        return "";
    }

    return `/recursos/imagenes/perfiles/${encodeURIComponent(normalizedFileName)}`;
}

// Funcion: mapUser
// Aqui adapto la fila SQL del usuario al objeto que consume la aplicacion.
function mapUser(row) {
    return {
        id: row.id_usuario,
        nombres: row.nombres,
        apellidos: row.apellidos,
        correo: row.correo,
        telefono: row.telefono,
        fechaNacimiento: row.fecha_nacimiento,
        documentoIdentidad: row.documento_identidad,
        direccion: row.direccion,
        fotoPerfilArchivo: row.foto_perfil_archivo || "",
        fotoPerfilUrl: buildProfileImageUrl(row.foto_perfil_archivo),
        estado: row.estado,
        dobleFactorActivo: Boolean(row.doble_factor_activo),
        ultimoLoginExitoso: row.ultimo_login_exitoso,
        ultimoCambioPassword: row.ultimo_cambio_password,
        intentosFallidos: Number(row.intentos_fallidos || 0)
    };
}

// Funcion: mapBeneficiary
// Aqui traduzco el beneficiario de base de datos al formato de negocio.
function mapBeneficiary(row) {
    return {
        id: row.id_beneficiario,
        nombre: row.nombre_beneficiario,
        alias: row.alias_beneficiario || row.nombre_beneficiario,
        bancoDestino: row.banco_destino,
        numeroCuentaDestino: row.numero_cuenta_destino,
        tipoDestino: row.tipo_destino,
        correoNotificacion: row.correo_notificacion,
        telefonoNotificacion: row.telefono_notificacion,
        esFavorito: Boolean(row.es_favorito),
        activo: Boolean(row.activo)
    };
}

// Funcion: mapAccount
// Aqui convierto una cuenta SQL a una estructura consistente para wallet y dashboard.
function mapAccount(row) {
    return {
        id: row.id_cuenta,
        numeroCuenta: row.numero_cuenta,
        aliasCuenta: row.alias_cuenta,
        tipoCuenta: row.tipo_cuenta,
        moneda: row.moneda,
        saldoDisponible: toNumber(row.saldo_disponible),
        saldoRetenido: toNumber(row.saldo_retenido),
        saldoContable: toNumber(row.saldo_contable),
        limiteDiario: toNumber(row.limite_diario),
        bonoBienvenidaAplicado: Boolean(row.bono_bienvenida_aplicado),
        esPrincipal: Boolean(row.es_principal),
        estado: row.estado
    };
}

// Funcion: mapAlert
// Aqui doy forma a las alertas con fecha ya lista para pintar.
function mapAlert(row) {
    return {
        id: row.id_alerta,
        tipo: row.tipo_alerta,
        titulo: row.titulo,
        mensaje: row.mensaje,
        nivel: row.nivel,
        leida: Boolean(row.leida),
        creadaEn: row.creada_en,
        fecha: formatDate(row.creada_en)
    };
}

// Funcion: mapCard
// Aqui normalizo la representacion de una tarjeta vinculada.
function mapCard(row) {
    return {
        id: row.id_tarjeta,
        alias: row.alias_tarjeta,
        marca: row.marca,
        tipo: row.tipo_tarjeta,
        ultimos4: row.ultimos_4,
        titular: row.titular,
        limiteDiario: toNumber(row.limite_diario),
        estado: row.estado,
        venceMes: Number(row.vence_mes),
        venceAnio: Number(row.vence_anio),
        cuentaAlias: row.alias_cuenta
    };
}

// Funcion: mapPayment
// Aqui preparo pagos programados para que la vista no haga transformaciones extra.
function mapPayment(row) {
    return {
        id: row.id_pago_programado,
        nombreServicio: row.nombre_servicio,
        categoria: row.categoria,
        frecuencia: row.frecuencia,
        monto: toNumber(row.monto),
        diaEjecucion: row.dia_ejecucion,
        proximaEjecucion: row.proxima_ejecucion,
        fechaTexto: formatDate(row.proxima_ejecucion),
        activo: Boolean(row.activo),
        referencia: row.referencia
    };
}

// Funcion: mapBank
// Aqui simplifico la fila del banco al modelo publico del catalogo.
function mapBank(row) {
    return {
        id: row.id_banco,
        nombre: row.nombre,
        codigo: row.codigo,
        tipoEntidad: row.tipo_entidad
    };
}

// Funcion: mapSalaryAdvance
// Aqui convierto el adelanto activo o historico al formato esperado por la UI.
function mapSalaryAdvance(row) {
    if (!row) {
        return null;
    }

    const montoAprobado = toNumber(row.monto_aprobado);
    const totalPagado = row.total_pagado === undefined
        ? 0
        : toNumber(row.total_pagado);
    const saldoPendiente = row.saldo_pendiente === undefined
        ? Math.max(montoAprobado - totalPagado, 0)
        : toNumber(row.saldo_pendiente);

    return {
        id: row.id_adelanto,
        numeroAdelanto: row.numero_adelanto,
        montoAprobado,
        cuotaDescuento: toNumber(row.cuota_descuento),
        totalPagado,
        saldoPendiente,
        fechaSolicitud: row.fecha_solicitud,
        fechaPagoProxima: row.fecha_pago_proxima,
        fechaPagoTexto: formatDate(row.fecha_pago_proxima),
        estado: row.estado,
        diasAtraso: Number(row.dias_atraso || 0),
        operacionesCongeladas: Boolean(row.operaciones_congeladas) || (row.estado === "vencido" && saldoPendiente > 0)
    };
}

// Funcion: mapServiceProvider
// Aqui adapto proveedores de servicio incluyendo su banco relacionado si existe.
function mapServiceProvider(row) {
    return {
        id: row.id_proveedor,
        nombre: row.nombre,
        categoria: row.categoria,
        referenciaRecaudo: row.referencia_recaudo,
        descripcion: row.descripcion,
        banco: row.banco_nombre || ""
    };
}

// Funcion: mapMovement
// Aqui armo una descripcion legible del movimiento combinando cuenta, destino y concepto.
function mapMovement(row) {
    const contacto = row.contacto && row.contacto !== "-" ? row.contacto : "";
    const banco = row.banco_destino ? ` (${row.banco_destino})` : "";
    const cuentaOrigen = row.cuentas_afectadas || "Cuenta wallet";
    const detalleDestino = contacto ? `${contacto}${banco}` : "Operacion interna";

    return {
        id: row.id_transaccion,
        fecha: formatDate(row.fecha_operacion),
        fechaIso: row.fecha_operacion,
        tipo: row.tipo_capitalizado,
        detalle: `${cuentaOrigen} -> ${detalleDestino} - ${row.concepto}`,
        estado: row.estado_capitalizado,
        monto: toNumber(row.monto_neto),
        contacto,
        referencia: row.referencia_interna
    };
}

// Funcion: normalizeAlertLevel
// Aqui reduzco multiples etiquetas posibles a los tres niveles que usa la interfaz.
function normalizeAlertLevel(level) {
    const rawLevel = String(level || "").trim().toLowerCase();

    if (["aceptacion", "success", "exito", "ok"].includes(rawLevel)) {
        return "aceptacion";
    }

    if (["alerta", "error", "critica", "advertencia"].includes(rawLevel)) {
        return "alerta";
    }

    return "informativo";
}

// Funcion: insertAlert
// Aqui registro una alerta nueva ya normalizada para el usuario.
async function insertAlert(client, { userId, type, title, message, level = "informativo" }) {
    await client.query(
        `
        INSERT INTO alertas_usuario (
            usuario_id,
            tipo_alerta,
            titulo,
            mensaje,
            nivel
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [userId, type, title, message, normalizeAlertLevel(level)]
    );
}

// Funcion: insertAccessLog
// Aqui guardo el rastro de accesos y eventos de autenticacion con IP y agente.
async function insertAccessLog(client, { userId, ipAddress, userAgent, result, detail }) {
    await client.query(
        `
        INSERT INTO accesos_usuario (
            usuario_id,
            direccion_ip,
            dispositivo,
            navegador,
            resultado,
            detalle
        )
        VALUES ($1, NULLIF($2, '')::INET, $3, $4, $5, $6)
        `,
        [
            userId,
            ipAddress || "",
            userAgent || "desconocido",
            userAgent || "desconocido",
            result,
            detail
        ]
    );
}

// Funcion: getUserById
// Aqui recupero al usuario junto con sus datos de seguridad y estado actual.
async function getUserById(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            u.id_usuario,
            u.nombres,
            u.apellidos,
            u.correo,
            u.telefono,
            u.fecha_nacimiento,
            u.documento_identidad,
            u.direccion,
            u.foto_perfil_archivo,
            u.estado,
            uc.doble_factor_activo,
            uc.ultimo_login_exitoso,
            uc.ultimo_cambio_password,
            uc.intentos_fallidos
        FROM usuarios u
        JOIN usuarios_credenciales uc
            ON uc.usuario_id = u.id_usuario
        WHERE u.id_usuario = $1
        LIMIT 1
        `,
        [userId]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
}

// Funcion: getAlerts
// Aqui traigo las alertas mas recientes del usuario.
async function getAlerts(userId, limit = 5, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_alerta,
            tipo_alerta,
            titulo,
            mensaje,
            nivel,
            leida,
            creada_en
        FROM alertas_usuario
        WHERE usuario_id = $1
        ORDER BY creada_en DESC
        LIMIT $2
        `,
        [userId, limit]
    );

    return result.rows.map(mapAlert);
}

// Funcion: getUnreadAlertCount
// Aqui calculo cuantas alertas siguen pendientes para la campana superior.
async function getUnreadAlertCount(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT COUNT(*) AS total
        FROM alertas_usuario
        WHERE usuario_id = $1
          AND leida = FALSE
        `,
        [userId]
    );

    return Number(result.rows[0]?.total || 0);
}

// Funcion: getAccounts
// Aqui traigo todas las cuentas del usuario ordenadas para privilegiar la principal.
async function getAccounts(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
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
        FROM cuentas
        WHERE usuario_id = $1
        ORDER BY es_principal DESC, creado_en ASC
        `,
        [userId]
    );

    return result.rows.map(mapAccount);
}

// Funcion: getFavoriteBeneficiaries
// Aqui consulto beneficiarios activos priorizando favoritos y actividad reciente.
async function getFavoriteBeneficiaries(userId, limit = 10, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_beneficiario,
            nombre_beneficiario,
            alias_beneficiario,
            banco_destino,
            numero_cuenta_destino,
            tipo_destino,
            correo_notificacion,
            telefono_notificacion,
            es_favorito,
            activo
        FROM beneficiarios
        WHERE usuario_id = $1
          AND activo = TRUE
        ORDER BY es_favorito DESC, actualizado_en DESC
        LIMIT $2
        `,
        [userId, limit]
    );

    return result.rows.map(mapBeneficiary);
}

// Funcion: getCards
// Aqui traigo las tarjetas vinculadas cruzadas con el alias de su cuenta.
async function getCards(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            t.id_tarjeta,
            t.alias_tarjeta,
            t.marca,
            t.tipo_tarjeta,
            t.ultimos_4,
            t.titular,
            t.limite_diario,
            t.estado,
            t.vence_mes,
            t.vence_anio,
            c.alias_cuenta
        FROM tarjetas t
        JOIN cuentas c
            ON c.id_cuenta = t.cuenta_id
        WHERE c.usuario_id = $1
        ORDER BY t.creado_en ASC
        `,
        [userId]
    );

    return result.rows.map(mapCard);
}

// Funcion: getPayments
// Aqui recupero pagos programados activos ordenados por proximidad.
async function getPayments(userId, limit = 10, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_pago_programado,
            nombre_servicio,
            categoria,
            frecuencia,
            monto,
            dia_ejecucion,
            proxima_ejecucion,
            activo,
            referencia
        FROM pagos_programados
        WHERE usuario_id = $1
          AND activo = TRUE
        ORDER BY proxima_ejecucion ASC
        LIMIT $2
        `,
        [userId, limit]
    );

    return result.rows.map(mapPayment);
}

// Funcion: getBootstrapState
// Aqui detecto si la plataforma ya tiene usuarios o si debe forzar el primer registro.
async function getBootstrapState(executor = { query }) {
    const result = await executor.query(
        `
        SELECT COUNT(*) AS total
        FROM usuarios
        `
    );

    const totalUsers = Number(result.rows[0]?.total || 0);
    return {
        totalUsers,
        hasUsers: totalUsers > 0,
        requiresRegistration: totalUsers === 0
    };
}

// Funcion: getBankCatalog
// Aqui devuelvo el catalogo de bancos visibles y activos.
async function getBankCatalog(executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_banco,
            nombre,
            codigo,
            tipo_entidad
        FROM catalogo_bancos
        WHERE activo = TRUE
        ORDER BY orden_visual ASC, nombre ASC
        `
    );

    return result.rows.map(mapBank);
}

// Funcion: getServiceProviderCatalog
// Aqui devuelvo el catalogo de proveedores de servicios con su banco asociado.
async function getServiceProviderCatalog(executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            ps.id_proveedor,
            ps.nombre,
            ps.categoria,
            ps.referencia_recaudo,
            ps.descripcion,
            cb.nombre AS banco_nombre
        FROM proveedores_servicio ps
        LEFT JOIN catalogo_bancos cb
            ON cb.id_banco = ps.banco_id
        WHERE ps.activo = TRUE
        ORDER BY ps.categoria ASC, ps.nombre ASC
        `
    );

    return result.rows.map(mapServiceProvider);
}

// Funcion: syncSalaryAdvanceStatuses
// Aqui sincronizo el estado real de los adelantos con base en vencimiento y pagos acumulados.
// Asi evito que un adelanto siga activo cuando ya vencio o cuando ya quedo completamente pagado.
async function syncSalaryAdvanceStatuses(userId, executor = { query }) {
    const result = await executor.query(
        `
        WITH pagos AS (
            SELECT
                a.id_adelanto,
                COALESCE(SUM(t.monto_total), 0) AS total_pagado
            FROM adelantos_salariales a
            LEFT JOIN transacciones t
                ON t.adelanto_id = a.id_adelanto
               AND t.tipo = 'pago_servicio'
               AND t.estado = 'completada'
            WHERE a.usuario_id = $1
            GROUP BY a.id_adelanto
        )
        UPDATE adelantos_salariales a
        SET
            estado = CASE
                WHEN GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) <= 0 THEN 'pagado'
                WHEN a.estado IN ('pendiente', 'activo') AND CURRENT_DATE > a.fecha_pago_proxima THEN 'vencido'
                ELSE a.estado
            END,
            actualizado_en = NOW()
        FROM pagos
        WHERE a.id_adelanto = pagos.id_adelanto
          AND a.usuario_id = $1
          AND (
              (GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) <= 0 AND a.estado <> 'pagado')
              OR (a.estado IN ('pendiente', 'activo') AND CURRENT_DATE > a.fecha_pago_proxima)
          )
        RETURNING
            a.id_adelanto,
            a.numero_adelanto,
            a.monto_aprobado,
            a.cuota_descuento,
            a.fecha_solicitud,
            a.fecha_pago_proxima,
            a.estado,
            COALESCE(pagos.total_pagado, 0) AS total_pagado,
            GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) AS saldo_pendiente,
            GREATEST(CURRENT_DATE - a.fecha_pago_proxima, 0) AS dias_atraso
        `,
        [userId]
    );

    for (const row of result.rows) {
        if (row.estado === "vencido") {
            await insertAlert(executor, {
                userId,
                type: "adelanto",
                title: "Adelanto vencido",
                message: `El adelanto ${row.numero_adelanto} vencio y tu wallet queda congelada hasta regularizar el saldo pendiente.`,
                level: "alerta"
            });
        }
    }

    return result.rows.map(mapSalaryAdvance);
}

// Funcion: getActiveSalaryAdvance
// Aqui busco el adelanto vigente del usuario calculando cuanto ha pagado y si ya congela operaciones.
// Antes de leerlo sincronizo estados para que la respuesta no se quede atrasada frente a mora o pagos completos.
async function getActiveSalaryAdvance(userId, executor = { query }) {
    await syncSalaryAdvanceStatuses(userId, executor);

    const result = await executor.query(
        `
        SELECT
            a.id_adelanto,
            a.numero_adelanto,
            a.monto_aprobado,
            a.cuota_descuento,
            a.fecha_solicitud,
            a.fecha_pago_proxima,
            a.estado,
            COALESCE(pagos.total_pagado, 0) AS total_pagado,
            GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) AS saldo_pendiente,
            GREATEST(CURRENT_DATE - a.fecha_pago_proxima, 0) AS dias_atraso,
            CASE
                WHEN a.estado = 'vencido'
                     AND GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) > 0
                    THEN TRUE
                ELSE FALSE
            END AS operaciones_congeladas
        FROM adelantos_salariales a
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(t.monto_total), 0) AS total_pagado
            FROM transacciones t
            WHERE t.adelanto_id = a.id_adelanto
              AND t.tipo = 'pago_servicio'
              AND t.estado = 'completada'
        ) pagos ON TRUE
        WHERE a.usuario_id = $1
          AND a.estado IN ('pendiente', 'activo', 'vencido')
          AND GREATEST(a.monto_aprobado - COALESCE(pagos.total_pagado, 0), 0) > 0
        ORDER BY
            CASE WHEN a.estado = 'vencido' THEN 0 ELSE 1 END,
            a.fecha_solicitud DESC,
            a.creado_en DESC
        LIMIT 1
        `,
        [userId]
    );

    return mapSalaryAdvance(result.rows[0] || null);
}

// Funcion: ensureWalletOperationAllowed
// Aqui reviso si la wallet del usuario esta congelada por mora en un adelanto.
// Cuando allowAdvancePayment es true devuelvo el adelanto bloqueante pero no corto el flujo, para permitir solo su pago.
async function ensureWalletOperationAllowed(userId, executor = { query }, options = {}) {
    const currentAdvance = await getActiveSalaryAdvance(userId, executor);
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

// Funcion: getMovementRows
// Aqui construyo la consulta dinamica del historial aplicando filtros sin perder trazabilidad.
// Devuelvo filas crudas para que otros helpers puedan decidir como mapearlas.
async function getMovementRows(userId, filters = {}, executor = { query }) {
    const params = [userId];
    const conditions = ["t.usuario_id = $1"];
    let position = params.length + 1;

    if (filters.search) {
        params.push(`%${String(filters.search).toLowerCase()}%`);
        conditions.push(
            `(
                LOWER(t.concepto) LIKE $${position}
                OR LOWER(COALESCE(b.nombre_beneficiario, '')) LIKE $${position}
                OR LOWER(COALESCE(b.alias_beneficiario, '')) LIKE $${position}
                OR LOWER(COALESCE(ps.nombre, '')) LIKE $${position}
                OR LOWER(COALESCE(t.referencia_interna, '')) LIKE $${position}
            )`
        );
        position += 1;
    }

    if (filters.type && filters.type !== "todos") {
        const normalizedType = String(filters.type).toLowerCase();
        if (normalizedType === "pago") {
            conditions.push(`LOWER(t.tipo) IN ('pago', 'pago_servicio')`);
        } else {
            params.push(normalizedType);
            conditions.push(`LOWER(t.tipo) = $${position}`);
            position += 1;
        }
    }

    if (filters.status && filters.status !== "todos") {
        params.push(String(filters.status).toLowerCase());
        conditions.push(`LOWER(t.estado) = $${position}`);
        position += 1;
    }

    params.push(Number(filters.limit || 100));

    const result = await executor.query(
        `
        SELECT
            t.id_transaccion,
            COALESCE(t.fecha_ejecucion, t.fecha_programada, t.creado_en) AS fecha_operacion,
            CASE
                WHEN t.tipo = 'pago_servicio' THEN 'Pago'
                WHEN t.tipo = 'bono_bienvenida' THEN 'Bono'
                WHEN t.tipo = 'adelanto_salarial' THEN 'Adelanto'
                ELSE INITCAP(REPLACE(t.tipo, '_', ' '))
            END AS tipo_capitalizado,
            INITCAP(t.estado) AS estado_capitalizado,
            t.concepto,
            t.referencia_interna,
            COALESCE(
                b.alias_beneficiario,
                b.nombre_beneficiario,
                ps.nombre,
                CASE
                    WHEN t.adelanto_id IS NOT NULL AND t.tipo = 'pago_servicio' THEN 'Adelanto salarial'
                    ELSE NULL
                END,
                '-'
            ) AS contacto,
            COALESCE(b.banco_destino, ps.nombre, '') AS banco_destino,
            COALESCE(
                movimientos.monto_neto,
                CASE
                    WHEN t.tipo = 'deposito' THEN t.monto_total
                    ELSE -t.monto_total
                END
            ) AS monto_neto,
            COALESCE(movimientos.cuentas_afectadas, 'Cuenta wallet') AS cuentas_afectadas
        FROM transacciones t
        LEFT JOIN beneficiarios b
            ON b.id_beneficiario = t.beneficiario_id
        LEFT JOIN proveedores_servicio ps
            ON ps.id_proveedor = t.proveedor_servicio_id
        LEFT JOIN LATERAL (
            SELECT
                SUM(
                    CASE
                        WHEN mc.tipo_movimiento = 'credito' THEN mc.monto
                        ELSE -mc.monto
                    END
                ) AS monto_neto,
                STRING_AGG(c.alias_cuenta, ', ' ORDER BY mc.id_movimiento) AS cuentas_afectadas
            FROM movimientos_cuenta mc
            JOIN cuentas c
                ON c.id_cuenta = mc.cuenta_id
            WHERE mc.transaccion_id = t.id_transaccion
        ) movimientos ON TRUE
        WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(t.fecha_ejecucion, t.fecha_programada, t.creado_en) DESC
        LIMIT $${position}
        `,
        params
    );

    return result.rows;
}

// Funcion: getMovements
// Aqui convierto las filas crudas del historial en objetos listos para la interfaz.
async function getMovements(userId, filters = {}, executor = { query }) {
    const rows = await getMovementRows(userId, filters, executor);
    return rows.map(mapMovement);
}

// Funcion: getMonthlySummary
// Aqui consolido el comportamiento mensual del usuario con contadores y volumen.
async function getMonthlySummary(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            COUNT(*) AS total_movimientos,
            COUNT(*) FILTER (
                WHERE tipo = 'deposito'
                  AND DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ) AS depositos_mes,
            COUNT(*) FILTER (
                WHERE tipo IN ('pago', 'pago_servicio')
                  AND DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ) AS pagos_mes,
            COUNT(*) FILTER (
                WHERE tipo = 'transferencia'
                  AND DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ) AS transferencias_mes,
            COUNT(*) FILTER (
                WHERE estado = 'programada'
            ) AS operaciones_programadas,
            COALESCE(SUM(monto_total) FILTER (
                WHERE DATE_TRUNC('month', COALESCE(fecha_ejecucion, creado_en)) = DATE_TRUNC('month', NOW())
            ), 0) AS volumen_mes
        FROM transacciones
        WHERE usuario_id = $1
        `,
        [userId]
    );

    const row = result.rows[0] || {};
    return {
        totalMovimientos: Number(row.total_movimientos || 0),
        depositosMes: Number(row.depositos_mes || 0),
        pagosMes: Number(row.pagos_mes || 0),
        transferenciasMes: Number(row.transferencias_mes || 0),
        operacionesProgramadas: Number(row.operaciones_programadas || 0),
        volumenMes: toNumber(row.volumen_mes)
    };
}

// Funcion: getOperationSnapshot
// Aqui mezclo resumen mensual y ultima transferencia para la seccion operativa.
async function getOperationSnapshot(userId, executor = { query }) {
    const monthlySummary = await getMonthlySummary(userId, executor);
    const recentTransferRows = await getMovementRows(
        userId,
        { type: "transferencia", limit: 1 },
        executor
    );

    return {
        ...monthlySummary,
        ultimaTransferencia: recentTransferRows[0] ? mapMovement(recentTransferRows[0]) : null
    };
}

// Funcion: getSession
// Aqui reconstruyo la sesion viva del usuario con perfil, alertas y contador pendiente.
async function getSession(userId, executor = { query }) {
    const [user, alerts, unreadAlerts] = await Promise.all([
        getUserById(userId, executor),
        getAlerts(userId, 5, executor),
        getUnreadAlertCount(userId, executor)
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

// Funcion: insertOrUpdateBeneficiary
// Aqui reutilizo o creo beneficiarios segun el contexto de la operacion.
// Si ya existe, actualizo lo necesario; si no existe, lo inserto y resuelvo si queda favorito.
async function insertOrUpdateBeneficiary(client, userId, payload) {
    const beneficiaryId = payload.beneficiaryId ? Number(payload.beneficiaryId) : null;

    if (beneficiaryId) {
        const result = await client.query(
            `
            SELECT
                id_beneficiario,
                nombre_beneficiario,
                alias_beneficiario,
                banco_destino,
                numero_cuenta_destino,
                tipo_destino,
                correo_notificacion,
                telefono_notificacion,
                es_favorito,
                activo
            FROM beneficiarios
            WHERE id_beneficiario = $1
              AND usuario_id = $2
              AND activo = TRUE
            LIMIT 1
            `,
            [beneficiaryId, userId]
        );

        const currentBeneficiary = result.rows[0];
        if (!currentBeneficiary) {
            throw new HttpError(404, "El beneficiario seleccionado no existe.");
        }

        if (payload.saveFavorite && !currentBeneficiary.es_favorito) {
            const updatedResult = await client.query(
                `
                UPDATE beneficiarios
                SET
                    es_favorito = TRUE,
                    actualizado_en = NOW()
                WHERE id_beneficiario = $1
                  AND usuario_id = $2
                RETURNING
                    id_beneficiario,
                    nombre_beneficiario,
                    alias_beneficiario,
                    banco_destino,
                    numero_cuenta_destino,
                    tipo_destino,
                    correo_notificacion,
                    telefono_notificacion,
                    es_favorito,
                    activo
                `,
                [beneficiaryId, userId]
            );

            return {
                ...mapBeneficiary(updatedResult.rows[0]),
                existedBefore: true,
                favoriteAddedNow: true
            };
        }

        return {
            ...mapBeneficiary(currentBeneficiary),
            existedBefore: true,
            favoriteAddedNow: false
        };
    }

    const recipientName = cleanText(payload.recipientName, 120);
    const destinationBank = cleanText(payload.destinationBank, 120);
    const destinationAccount = cleanText(payload.destinationAccount, 34);

    if (!recipientName || !destinationBank || !destinationAccount) {
        throw new HttpError(400, "Completa el nombre, banco y numero de cuenta del destinatario.");
    }

    const existingBeneficiaryResult = await client.query(
        `
        SELECT
            id_beneficiario,
            es_favorito
        FROM beneficiarios
        WHERE usuario_id = $1
          AND numero_cuenta_destino = $2
        LIMIT 1
        `,
        [userId, destinationAccount]
    );

    const existingBeneficiary = existingBeneficiaryResult.rows[0] || null;
    const result = await client.query(
        `
        INSERT INTO beneficiarios (
            usuario_id,
            nombre_beneficiario,
            alias_beneficiario,
            banco_destino,
            numero_cuenta_destino,
            tipo_destino,
            correo_notificacion,
            telefono_notificacion,
            es_favorito,
            activo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        ON CONFLICT (usuario_id, numero_cuenta_destino)
        DO UPDATE SET
            nombre_beneficiario = EXCLUDED.nombre_beneficiario,
            alias_beneficiario = COALESCE(EXCLUDED.alias_beneficiario, beneficiarios.alias_beneficiario),
            banco_destino = EXCLUDED.banco_destino,
            tipo_destino = EXCLUDED.tipo_destino,
            correo_notificacion = COALESCE(EXCLUDED.correo_notificacion, beneficiarios.correo_notificacion),
            telefono_notificacion = COALESCE(EXCLUDED.telefono_notificacion, beneficiarios.telefono_notificacion),
            es_favorito = beneficiarios.es_favorito OR EXCLUDED.es_favorito,
            activo = TRUE,
            actualizado_en = NOW()
        RETURNING
            id_beneficiario,
            nombre_beneficiario,
            alias_beneficiario,
            banco_destino,
            numero_cuenta_destino,
            tipo_destino,
            correo_notificacion,
            telefono_notificacion,
            es_favorito,
            activo
        `,
        [
            userId,
            recipientName,
            cleanText(payload.recipientAlias || recipientName, 80) || recipientName,
            destinationBank,
            destinationAccount,
            payload.destinationType || "bancaria",
            cleanText(payload.notificationEmail, 150) || null,
            cleanText(payload.notificationPhone, 25) || null,
            Boolean(payload.saveFavorite)
        ]
    );

    return {
        ...mapBeneficiary(result.rows[0]),
        existedBefore: Boolean(existingBeneficiary),
        favoriteAddedNow: Boolean(payload.saveFavorite) && !Boolean(existingBeneficiary?.es_favorito)
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
    insertAlert,
    insertAccessLog,
    getUserById,
    getAlerts,
    getUnreadAlertCount,
    getAccounts,
    getFavoriteBeneficiaries,
    getCards,
    getPayments,
    getBootstrapState,
    getBankCatalog,
    getServiceProviderCatalog,
    syncSalaryAdvanceStatuses,
    getActiveSalaryAdvance,
    ensureWalletOperationAllowed,
    getMovementRows,
    getMovements,
    getMonthlySummary,
    getOperationSnapshot,
    getSession,
    insertOrUpdateBeneficiary,
    mapAccount
};
