/**
 * Modulo: dao/mappers.js
 *
 * Que hace: concentra las funciones puras que transforman filas crudas de PostgreSQL
 *           (nombres de columna en snake_case) en objetos de negocio (camelCase) listos
 *           para la interfaz.
 * Como lo hace: cada mapper recibe una fila (`row`) devuelta por `pg` y arma un objeto nuevo,
 *               convirtiendo numeros, booleanos y fechas con helpers compartidos.
 * Datos que participan: filas de las tablas usuarios, cuentas, beneficiarios, alertas_usuario,
 *                       tarjetas, pagos_programados, catalogo_bancos, adelantos_salariales,
 *                       proveedores_servicio y transacciones.
 * Consultas SQL: ninguna. Este modulo no habla con la base de datos; por eso los DAOs
 *                lo importan sin riesgo de dependencias circulares.
 */

const dateFormatter = new Intl.DateTimeFormat("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/El_Salvador"
});

/**
 * Funcion: toNumber
 *
 * Que hace: convierte cualquier valor a numero con un valor seguro por defecto.
 * Como lo hace: aplica `Number(value || 0)`, de modo que null, undefined, "" y NaN-like
 *               se transforman en 0 en lugar de propagar NaN.
 * Datos que participan: `value` (montos, saldos o contadores que PostgreSQL devuelve como
 *                       string cuando la columna es NUMERIC o BIGINT).
 * Retorna: number.
 */
function toNumber(value) {
    return Number(value || 0);
}

/**
 * Funcion: formatDate
 *
 * Que hace: da formato corto dd/mm/aaaa a una fecha para mostrarla en la UI.
 * Como lo hace: usa un `Intl.DateTimeFormat` con locale `es-SV` y zona horaria
 *               America/El_Salvador, creado una sola vez a nivel de modulo.
 * Datos que participan: `value` (Date, string ISO o timestamp que viene de columnas
 *                       TIMESTAMP/DATE).
 * Retorna: string con la fecha, o "" si `value` esta vacio.
 */
function formatDate(value) {
    if (!value) {
        return "";
    }

    return dateFormatter.format(new Date(value));
}

/**
 * Funcion: buildProfileImageUrl
 *
 * Que hace: convierte el nombre de archivo de la foto de perfil en una URL publica.
 * Como lo hace: recorta el nombre a 255 caracteres, lo codifica con `encodeURIComponent`
 *               y lo concatena a la ruta estatica /recursos/imagenes/perfiles/.
 * Datos que participan: `fileName` (columna usuarios.foto_perfil_archivo).
 * Retorna: string con la URL, o "" si no hay archivo.
 */
function buildProfileImageUrl(fileName) {
    const normalizedFileName = String(fileName || "").trim().slice(0, 255);
    if (!normalizedFileName) {
        return "";
    }

    return `/recursos/imagenes/perfiles/${encodeURIComponent(normalizedFileName)}`;
}

/**
 * Funcion: mapUser
 *
 * Que hace: adapta la fila de usuario al objeto que consume la aplicacion.
 * Como lo hace: renombra columnas, fuerza booleanos/numeros y agrega `fotoPerfilUrl`
 *               calculada con buildProfileImageUrl.
 * Datos que participan: columnas de `usuarios` (id_usuario, nombres, apellidos, correo,
 *                       telefono, fecha_nacimiento, documento_identidad, direccion,
 *                       foto_perfil_archivo, estado) y de `usuarios_credenciales`
 *                       (doble_factor_activo, ultimo_login_exitoso,
 *                       ultimo_cambio_password, intentos_fallidos).
 * Retorna: objeto usuario.
 */
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

/**
 * Funcion: mapBeneficiary
 *
 * Que hace: traduce un beneficiario de base de datos al formato de negocio.
 * Como lo hace: renombra columnas y usa el nombre como alias cuando no hay alias propio.
 * Datos que participan: columnas de `beneficiarios` (id_beneficiario, nombre_beneficiario,
 *                       alias_beneficiario, banco_destino, numero_cuenta_destino,
 *                       tipo_destino, correo_notificacion, telefono_notificacion,
 *                       es_favorito, activo).
 * Retorna: objeto beneficiario.
 */
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

/**
 * Funcion: mapAccount
 *
 * Que hace: convierte una cuenta SQL a una estructura consistente para wallet y dashboard.
 * Como lo hace: renombra columnas y convierte los saldos NUMERIC (llegan como string) a number.
 * Datos que participan: columnas de `cuentas` (id_cuenta, numero_cuenta, alias_cuenta,
 *                       tipo_cuenta, moneda, saldo_disponible, saldo_retenido,
 *                       saldo_contable, limite_diario, bono_bienvenida_aplicado,
 *                       es_principal, estado).
 * Retorna: objeto cuenta.
 */
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

/**
 * Funcion: mapAlert
 *
 * Que hace: da forma a una alerta con la fecha ya lista para pintar.
 * Como lo hace: renombra columnas y agrega `fecha` formateada con formatDate.
 * Datos que participan: columnas de `alertas_usuario` (id_alerta, tipo_alerta, titulo,
 *                       mensaje, nivel, leida, creada_en).
 * Retorna: objeto alerta.
 */
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

/**
 * Funcion: mapCard
 *
 * Que hace: normaliza la representacion de una tarjeta vinculada.
 * Como lo hace: renombra columnas, convierte limite y vencimiento a number y expone el
 *               alias de la cuenta asociada (viene de un JOIN con `cuentas`).
 * Datos que participan: columnas de `tarjetas` (id_tarjeta, alias_tarjeta, marca,
 *                       tipo_tarjeta, ultimos_4, titular, limite_diario, estado,
 *                       vence_mes, vence_anio) mas `cuentas.alias_cuenta`.
 * Retorna: objeto tarjeta.
 */
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

/**
 * Funcion: mapPayment
 *
 * Que hace: prepara un pago programado para que la vista no haga transformaciones extra.
 * Como lo hace: renombra columnas, convierte el monto a number y agrega `fechaTexto`.
 * Datos que participan: columnas de `pagos_programados` (id_pago_programado,
 *                       nombre_servicio, categoria, frecuencia, monto, dia_ejecucion,
 *                       proxima_ejecucion, activo, referencia).
 * Retorna: objeto pago programado.
 */
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

/**
 * Funcion: mapBank
 *
 * Que hace: simplifica la fila del banco al modelo publico del catalogo.
 * Como lo hace: copia solo las cuatro columnas que necesita la UI.
 * Datos que participan: columnas de `catalogo_bancos` (id_banco, nombre, codigo,
 *                       tipo_entidad).
 * Retorna: objeto banco.
 */
function mapBank(row) {
    return {
        id: row.id_banco,
        nombre: row.nombre,
        codigo: row.codigo,
        tipoEntidad: row.tipo_entidad
    };
}

/**
 * Funcion: mapSalaryAdvance
 *
 * Que hace: convierte un adelanto salarial (activo o historico) al formato esperado por la UI.
 * Como lo hace: calcula `totalPagado` y `saldoPendiente` (si la fila no los trae, los deriva
 *               de monto_aprobado) y marca `operacionesCongeladas` cuando el adelanto esta
 *               vencido con saldo pendiente.
 * Datos que participan: columnas de `adelantos_salariales` (id_adelanto, numero_adelanto,
 *                       monto_aprobado, cuota_descuento, fecha_solicitud,
 *                       fecha_pago_proxima, estado) y los calculados total_pagado,
 *                       saldo_pendiente, dias_atraso, operaciones_congeladas.
 * Retorna: objeto adelanto, o null si `row` es falsy.
 */
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

/**
 * Funcion: mapServiceProvider
 *
 * Que hace: adapta un proveedor de servicio incluyendo su banco relacionado si existe.
 * Como lo hace: renombra columnas y usa "" cuando el LEFT JOIN con el banco no encontro nada.
 * Datos que participan: columnas de `proveedores_servicio` (id_proveedor, nombre, categoria,
 *                       referencia_recaudo, descripcion) y `catalogo_bancos.nombre`
 *                       (alias banco_nombre).
 * Retorna: objeto proveedor.
 */
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

/**
 * Funcion: mapMovement
 *
 * Que hace: arma una descripcion legible del movimiento combinando cuenta, destino y concepto.
 * Como lo hace: ignora el contacto "-" (placeholder del SQL), concatena el banco entre
 *               parentesis y construye `detalle` con el formato "cuenta -> destino - concepto".
 * Datos que participan: columnas calculadas por la consulta de historial (id_transaccion,
 *                       fecha_operacion, tipo_capitalizado, estado_capitalizado, concepto,
 *                       referencia_interna, contacto, banco_destino, monto_neto,
 *                       cuentas_afectadas).
 * Retorna: objeto movimiento.
 */
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

/**
 * Funcion: normalizeAlertLevel
 *
 * Que hace: reduce multiples etiquetas posibles de nivel a los tres que usa la interfaz.
 * Como lo hace: pasa el texto a minusculas y lo compara contra listas de sinonimos;
 *               "aceptacion" (success/exito/ok), "alerta" (error/critica/advertencia),
 *               cualquier otro valor cae en "informativo".
 * Datos que participan: `level` (texto libre enviado por quien crea la alerta).
 * Retorna: "aceptacion" | "alerta" | "informativo".
 */
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

module.exports = {
    toNumber,
    formatDate,
    buildProfileImageUrl,
    mapUser,
    mapBeneficiary,
    mapAccount,
    mapAlert,
    mapCard,
    mapPayment,
    mapBank,
    mapSalaryAdvance,
    mapServiceProvider,
    mapMovement,
    normalizeAlertLevel
};
