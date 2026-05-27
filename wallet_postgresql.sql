-- =========================================================
-- Wallet Digital
-- Rebuild completo de la base de datos
-- Ordenado por dependencias y sin abuso de ALTER
-- =========================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

GRANT USAGE ON SCHEMA public TO public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa') THEN
        EXECUTE 'GRANT USAGE, CREATE ON SCHEMA public TO sa';
    END IF;
END $$;

-- =========================================================
-- Funciones utilitarias
-- =========================================================

CREATE FUNCTION actualizar_columna_actualizado_en()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$;

-- =========================================================
-- Seguridad y usuarios
-- =========================================================

CREATE TABLE usuarios (
    id_usuario              BIGSERIAL PRIMARY KEY,
    nombres                 VARCHAR(80) NOT NULL,
    apellidos               VARCHAR(80) NOT NULL,
    correo                  VARCHAR(150) NOT NULL UNIQUE,
    telefono                VARCHAR(25)
        CHECK (telefono IS NULL OR telefono ~ '^[+0-9() -]{8,25}$'),
    fecha_nacimiento        DATE,
    documento_identidad     VARCHAR(30)
        CHECK (documento_identidad IS NULL OR documento_identidad ~ '^[0-9]{8}-[0-9]$'),
    direccion               VARCHAR(300),
    foto_perfil_archivo     VARCHAR(255),
    estado                  VARCHAR(20) NOT NULL DEFAULT 'activo'
        CHECK (estado IN ('activo', 'bloqueado', 'suspendido')),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usuarios_credenciales (
    usuario_id              BIGINT PRIMARY KEY
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    password_hash           TEXT NOT NULL,
    doble_factor_activo     BOOLEAN NOT NULL DEFAULT FALSE,
    intentos_fallidos       INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta         TIMESTAMPTZ,
    ultimo_login_exitoso    TIMESTAMPTZ,
    ultimo_cambio_password  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE accesos_usuario (
    id_acceso               BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    fecha_acceso            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    direccion_ip            INET,
    dispositivo             VARCHAR(120),
    navegador               VARCHAR(120),
    resultado               VARCHAR(20) NOT NULL
        CHECK (resultado IN ('exitoso', 'fallido', 'bloqueado')),
    detalle                 VARCHAR(240)
);

CREATE TABLE tokens_recuperacion_password (
    id_token                BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    correo_destino          VARCHAR(150) NOT NULL,
    token_hash              TEXT NOT NULL,
    expira_en               TIMESTAMPTZ NOT NULL,
    usado_en                TIMESTAMPTZ,
    solicitado_desde_ip     INET,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE codigos_verificacion (
    id_codigo               BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    canal                   VARCHAR(20) NOT NULL
        CHECK (canal IN ('correo', 'whatsapp')),
    destino                 VARCHAR(150) NOT NULL,
    codigo_hash             TEXT NOT NULL,
    expira_en               TIMESTAMPTZ NOT NULL,
    usado_en                TIMESTAMPTZ,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alertas_usuario (
    id_alerta               BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    tipo_alerta             VARCHAR(25) NOT NULL
        CHECK (tipo_alerta IN ('seguridad', 'transferencia', 'servicio', 'favoritos', 'adelanto', 'sistema')),
    titulo                  VARCHAR(140) NOT NULL,
    mensaje                 VARCHAR(280) NOT NULL,
    nivel                   VARCHAR(20) NOT NULL DEFAULT 'informativo'
        CHECK (nivel IN ('informativo', 'aceptacion', 'alerta')),
    leida                   BOOLEAN NOT NULL DEFAULT FALSE,
    creada_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Catalogos del sistema
-- =========================================================

CREATE TABLE catalogo_bancos (
    id_banco                BIGSERIAL PRIMARY KEY,
    nombre                  VARCHAR(120) NOT NULL UNIQUE,
    codigo                  VARCHAR(30) NOT NULL UNIQUE,
    tipo_entidad            VARCHAR(20) NOT NULL DEFAULT 'banco'
        CHECK (tipo_entidad IN ('banco', 'wallet', 'cooperativa')),
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    orden_visual            INTEGER NOT NULL DEFAULT 100,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE proveedores_servicio (
    id_proveedor            BIGSERIAL PRIMARY KEY,
    nombre                  VARCHAR(120) NOT NULL UNIQUE,
    categoria               VARCHAR(40) NOT NULL
        CHECK (categoria IN ('energia', 'agua', 'internet', 'telefonia', 'streaming', 'educacion', 'otros')),
    banco_id                BIGINT
        REFERENCES catalogo_bancos(id_banco) ON DELETE SET NULL,
    referencia_recaudo      VARCHAR(80) NOT NULL,
    descripcion             VARCHAR(220),
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Aprendizaje Forex
-- =========================================================

CREATE TABLE cursos_forex (
    id_curso                BIGSERIAL PRIMARY KEY,
    titulo                  VARCHAR(140) NOT NULL,
    descripcion             VARCHAR(300) NOT NULL,
    nivel                   VARCHAR(20) NOT NULL
        CHECK (nivel IN ('basico', 'intermedio', 'avanzado')),
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE modulos_forex (
    id_modulo               BIGSERIAL PRIMARY KEY,
    curso_id                BIGINT NOT NULL
        REFERENCES cursos_forex(id_curso) ON DELETE CASCADE,
    titulo                  VARCHAR(140) NOT NULL,
    contenido               TEXT NOT NULL,
    orden_modulo            INTEGER NOT NULL,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_modulos_forex_curso_orden
        UNIQUE (curso_id, orden_modulo)
);

CREATE TABLE preguntas_forex (
    id_pregunta             BIGSERIAL PRIMARY KEY,
    modulo_id               BIGINT NOT NULL
        REFERENCES modulos_forex(id_modulo) ON DELETE CASCADE,
    pregunta                TEXT NOT NULL,
    explicacion             TEXT,
    orden_pregunta          INTEGER NOT NULL,
    CONSTRAINT uq_preguntas_forex_modulo_orden
        UNIQUE (modulo_id, orden_pregunta)
);

CREATE TABLE opciones_pregunta_forex (
    id_opcion               BIGSERIAL PRIMARY KEY,
    pregunta_id             BIGINT NOT NULL
        REFERENCES preguntas_forex(id_pregunta) ON DELETE CASCADE,
    texto_opcion            VARCHAR(220) NOT NULL,
    es_correcta             BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE progreso_forex_usuario (
    id_progreso             BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    modulo_id               BIGINT NOT NULL
        REFERENCES modulos_forex(id_modulo) ON DELETE CASCADE,
    aprobado                BOOLEAN NOT NULL DEFAULT FALSE,
    puntaje                 NUMERIC(5,2) NOT NULL DEFAULT 0,
    fecha_ultimo_intento    TIMESTAMPTZ,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_progreso_forex_usuario
        UNIQUE (usuario_id, modulo_id)
);

-- =========================================================
-- Wallet y productos del usuario
-- =========================================================

CREATE TABLE cuentas (
    id_cuenta               BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    numero_cuenta           VARCHAR(30) NOT NULL UNIQUE,
    alias_cuenta            VARCHAR(80) NOT NULL,
    tipo_cuenta             VARCHAR(25) NOT NULL DEFAULT 'wallet_principal'
        CHECK (tipo_cuenta IN ('wallet_principal', 'wallet_secundaria')),
    moneda                  CHAR(3) NOT NULL DEFAULT 'USD',
    saldo_disponible        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saldo_disponible >= 0),
    saldo_retenido          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saldo_retenido >= 0),
    saldo_contable          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saldo_contable >= 0),
    limite_diario           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (limite_diario >= 0),
    es_principal            BOOLEAN NOT NULL DEFAULT FALSE,
    bono_bienvenida_aplicado BOOLEAN NOT NULL DEFAULT FALSE,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('activa', 'pausada', 'cerrada')),
    fecha_apertura          DATE NOT NULL DEFAULT CURRENT_DATE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bolsillos_ahorro (
    id_bolsillo             BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    cuenta_id               BIGINT NOT NULL
        REFERENCES cuentas(id_cuenta) ON DELETE CASCADE,
    nombre_bolsillo         VARCHAR(80) NOT NULL,
    meta_monto              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (meta_monto >= 0),
    saldo_actual            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (saldo_actual >= 0),
    color_referencia        VARCHAR(20) NOT NULL DEFAULT '#6f3df4',
    estado                  VARCHAR(20) NOT NULL DEFAULT 'activo'
        CHECK (estado IN ('activo', 'pausado', 'cumplido')),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bolsillos_ahorro_usuario_nombre
        UNIQUE (usuario_id, nombre_bolsillo)
);

CREATE TABLE beneficiarios (
    id_beneficiario         BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    banco_id                BIGINT
        REFERENCES catalogo_bancos(id_banco) ON DELETE SET NULL,
    nombre_beneficiario     VARCHAR(120) NOT NULL,
    alias_beneficiario      VARCHAR(80),
    banco_destino           VARCHAR(120) NOT NULL,
    numero_cuenta_destino   VARCHAR(34) NOT NULL,
    tipo_destino            VARCHAR(25) NOT NULL DEFAULT 'bancaria'
        CHECK (tipo_destino IN ('bancaria', 'wallet', 'servicio')),
    correo_notificacion     VARCHAR(150),
    telefono_notificacion   VARCHAR(25),
    es_favorito             BOOLEAN NOT NULL DEFAULT FALSE,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_beneficiarios_usuario_cuenta_destino
        UNIQUE (usuario_id, numero_cuenta_destino)
);

CREATE TABLE servicios_usuario (
    id_servicio_usuario     BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    proveedor_id            BIGINT NOT NULL
        REFERENCES proveedores_servicio(id_proveedor) ON DELETE RESTRICT,
    alias_servicio          VARCHAR(90) NOT NULL,
    identificador_cliente   VARCHAR(80) NOT NULL,
    cuenta_cargo_id         BIGINT NOT NULL
        REFERENCES cuentas(id_cuenta) ON DELETE RESTRICT,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_servicio_usuario
        UNIQUE (usuario_id, proveedor_id, identificador_cliente)
);

CREATE TABLE pagos_programados (
    id_pago_programado      BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    cuenta_id               BIGINT NOT NULL
        REFERENCES cuentas(id_cuenta) ON DELETE RESTRICT,
    beneficiario_id         BIGINT
        REFERENCES beneficiarios(id_beneficiario) ON DELETE SET NULL,
    proveedor_id            BIGINT
        REFERENCES proveedores_servicio(id_proveedor) ON DELETE SET NULL,
    nombre_servicio         VARCHAR(120) NOT NULL,
    categoria               VARCHAR(40) NOT NULL,
    frecuencia              VARCHAR(20) NOT NULL
        CHECK (frecuencia IN ('mensual', 'quincenal', 'semanal', 'manual')),
    monto                   NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    dia_ejecucion           INTEGER CHECK (dia_ejecucion BETWEEN 1 AND 31),
    proxima_ejecucion       DATE NOT NULL,
    referencia              VARCHAR(80),
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tarjetas (
    id_tarjeta              BIGSERIAL PRIMARY KEY,
    cuenta_id               BIGINT NOT NULL
        REFERENCES cuentas(id_cuenta) ON DELETE CASCADE,
    banco_id                BIGINT
        REFERENCES catalogo_bancos(id_banco) ON DELETE SET NULL,
    alias_tarjeta           VARCHAR(80) NOT NULL,
    marca                   VARCHAR(40) NOT NULL,
    tipo_tarjeta            VARCHAR(20) NOT NULL
        CHECK (tipo_tarjeta IN ('debito', 'credito', 'prepago')),
    ultimos_4               CHAR(4) NOT NULL,
    titular                 VARCHAR(120) NOT NULL,
    limite_diario           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (limite_diario >= 0),
    estado                  VARCHAR(20) NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('activa', 'bloqueada', 'vencida')),
    vence_mes               INTEGER NOT NULL CHECK (vence_mes BETWEEN 1 AND 12),
    vence_anio              INTEGER NOT NULL CHECK (vence_anio BETWEEN 2024 AND 2100),
    es_predeterminada       BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE adelantos_salariales (
    id_adelanto             BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    cuenta_id               BIGINT NOT NULL
        REFERENCES cuentas(id_cuenta) ON DELETE RESTRICT,
    numero_adelanto         VARCHAR(40) NOT NULL UNIQUE,
    monto_aprobado          NUMERIC(14,2) NOT NULL CHECK (monto_aprobado > 0),
    cuota_descuento         NUMERIC(14,2) NOT NULL CHECK (cuota_descuento > 0),
    fecha_solicitud         DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_pago_proxima      DATE NOT NULL,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'activo'
        CHECK (estado IN ('pendiente', 'activo', 'pagado', 'vencido', 'rechazado')),
    observaciones           VARCHAR(250),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Operaciones financieras
-- =========================================================

CREATE TABLE transacciones (
    id_transaccion          BIGSERIAL PRIMARY KEY,
    usuario_id              BIGINT NOT NULL
        REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    beneficiario_id         BIGINT
        REFERENCES beneficiarios(id_beneficiario) ON DELETE SET NULL,
    proveedor_servicio_id   BIGINT
        REFERENCES proveedores_servicio(id_proveedor) ON DELETE SET NULL,
    adelanto_id             BIGINT
        REFERENCES adelantos_salariales(id_adelanto) ON DELETE SET NULL,
    tipo                    VARCHAR(25) NOT NULL
        CHECK (tipo IN ('transferencia', 'deposito', 'pago_servicio', 'bono_bienvenida', 'adelanto_salarial', 'ahorro')),
    estado                  VARCHAR(25) NOT NULL
        CHECK (estado IN ('pendiente', 'completada', 'programada', 'cancelada', 'rechazada')),
    canal                   VARCHAR(20) NOT NULL DEFAULT 'web'
        CHECK (canal IN ('web', 'movil', 'soporte')),
    concepto                VARCHAR(200) NOT NULL,
    referencia_interna      VARCHAR(60) NOT NULL UNIQUE,
    referencia_externa      VARCHAR(60),
    monto_total             NUMERIC(14,2) NOT NULL CHECK (monto_total > 0),
    fecha_programada        TIMESTAMPTZ,
    fecha_ejecucion         TIMESTAMPTZ,
    observaciones           VARCHAR(400),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE movimientos_cuenta (
    id_movimiento           BIGSERIAL PRIMARY KEY,
    transaccion_id          BIGINT NOT NULL
        REFERENCES transacciones(id_transaccion) ON DELETE CASCADE,
    cuenta_id               BIGINT NOT NULL
        REFERENCES cuentas(id_cuenta) ON DELETE RESTRICT,
    tipo_movimiento         VARCHAR(20) NOT NULL
        CHECK (tipo_movimiento IN ('credito', 'debito', 'retencion', 'liberacion')),
    monto                   NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    descripcion             VARCHAR(220) NOT NULL,
    saldo_resultante        NUMERIC(14,2) NOT NULL,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Indices
-- =========================================================

CREATE UNIQUE INDEX uq_cuentas_usuario_principal
    ON cuentas (usuario_id)
    WHERE es_principal = TRUE;

CREATE UNIQUE INDEX uq_usuarios_documento_identidad
    ON usuarios (documento_identidad)
    WHERE documento_identidad IS NOT NULL;

CREATE UNIQUE INDEX uq_usuarios_telefono_normalizado
    ON usuarios ((REGEXP_REPLACE(telefono, '[^0-9]', '', 'g')))
    WHERE telefono IS NOT NULL;

CREATE UNIQUE INDEX uq_tarjetas_cuenta_predeterminada
    ON tarjetas (cuenta_id)
    WHERE es_predeterminada = TRUE;

CREATE INDEX ix_cuentas_usuario_id
    ON cuentas (usuario_id);

CREATE INDEX ix_bolsillos_ahorro_usuario_cuenta
    ON bolsillos_ahorro (usuario_id, cuenta_id, estado);

CREATE INDEX ix_beneficiarios_usuario_favorito
    ON beneficiarios (usuario_id, es_favorito, activo);

CREATE INDEX ix_servicios_usuario_usuario
    ON servicios_usuario (usuario_id, activo);

CREATE INDEX ix_pagos_programados_usuario_activo
    ON pagos_programados (usuario_id, activo, proxima_ejecucion);

CREATE INDEX ix_tarjetas_cuenta_activa
    ON tarjetas (cuenta_id, estado);

CREATE INDEX ix_adelantos_usuario_estado
    ON adelantos_salariales (usuario_id, estado, fecha_pago_proxima);

CREATE INDEX ix_transacciones_usuario_fecha
    ON transacciones (usuario_id, COALESCE(fecha_ejecucion, fecha_programada, creado_en) DESC);

CREATE INDEX ix_movimientos_cuenta_fecha
    ON movimientos_cuenta (cuenta_id, creado_en DESC);

CREATE INDEX ix_alertas_usuario_fecha
    ON alertas_usuario (usuario_id, creada_en DESC);

CREATE INDEX ix_accesos_usuario_fecha
    ON accesos_usuario (usuario_id, fecha_acceso DESC);

CREATE INDEX ix_tokens_recuperacion_password_usuario
    ON tokens_recuperacion_password (usuario_id, expira_en DESC);

CREATE INDEX ix_codigos_verificacion_usuario
    ON codigos_verificacion (usuario_id, canal, expira_en DESC);

CREATE INDEX ix_progreso_forex_usuario
    ON progreso_forex_usuario (usuario_id, aprobado, fecha_ultimo_intento DESC);

-- =========================================================
-- Triggers para actualizado_en
-- =========================================================

CREATE TRIGGER tr_usuarios_actualizado_en
BEFORE UPDATE ON usuarios
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_usuarios_credenciales_actualizado_en
BEFORE UPDATE ON usuarios_credenciales
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_proveedores_servicio_actualizado_en
BEFORE UPDATE ON proveedores_servicio
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_cuentas_actualizado_en
BEFORE UPDATE ON cuentas
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_bolsillos_ahorro_actualizado_en
BEFORE UPDATE ON bolsillos_ahorro
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_beneficiarios_actualizado_en
BEFORE UPDATE ON beneficiarios
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_servicios_usuario_actualizado_en
BEFORE UPDATE ON servicios_usuario
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_pagos_programados_actualizado_en
BEFORE UPDATE ON pagos_programados
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_tarjetas_actualizado_en
BEFORE UPDATE ON tarjetas
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_adelantos_salariales_actualizado_en
BEFORE UPDATE ON adelantos_salariales
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_transacciones_actualizado_en
BEFORE UPDATE ON transacciones
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

CREATE TRIGGER tr_progreso_forex_usuario_actualizado_en
BEFORE UPDATE ON progreso_forex_usuario
FOR EACH ROW
EXECUTE FUNCTION actualizar_columna_actualizado_en();

-- =========================================================
-- Vistas de apoyo
-- =========================================================

CREATE VIEW vw_historial_movimientos_wallet AS
SELECT
    t.id_transaccion,
    t.usuario_id,
    t.tipo,
    t.estado,
    t.concepto,
    t.referencia_interna,
    t.monto_total,
    COALESCE(t.fecha_ejecucion, t.fecha_programada, t.creado_en) AS fecha_operacion,
    b.nombre_beneficiario,
    ps.nombre AS proveedor_servicio,
    STRING_AGG(c.alias_cuenta, ', ' ORDER BY mc.id_movimiento) AS cuentas_afectadas
FROM transacciones t
LEFT JOIN beneficiarios b
    ON b.id_beneficiario = t.beneficiario_id
LEFT JOIN proveedores_servicio ps
    ON ps.id_proveedor = t.proveedor_servicio_id
LEFT JOIN movimientos_cuenta mc
    ON mc.transaccion_id = t.id_transaccion
LEFT JOIN cuentas c
    ON c.id_cuenta = mc.cuenta_id
GROUP BY
    t.id_transaccion,
    t.usuario_id,
    t.tipo,
    t.estado,
    t.concepto,
    t.referencia_interna,
    t.monto_total,
    COALESCE(t.fecha_ejecucion, t.fecha_programada, t.creado_en),
    b.nombre_beneficiario,
    ps.nombre;

CREATE VIEW vw_resumen_cuentas_wallet AS
SELECT
    c.usuario_id,
    COUNT(*) AS total_cuentas,
    COUNT(*) FILTER (WHERE c.estado = 'activa') AS cuentas_activas,
    COALESCE(SUM(c.saldo_disponible), 0) AS saldo_disponible_total,
    COALESCE(SUM(c.saldo_retenido), 0) AS saldo_retenido_total,
    COALESCE(SUM(c.saldo_contable), 0) AS saldo_contable_total,
    COUNT(*) FILTER (WHERE c.bono_bienvenida_aplicado) AS cuentas_con_bono
FROM cuentas c
GROUP BY c.usuario_id;

CREATE VIEW vw_resumen_seguridad_wallet AS
SELECT
    u.id_usuario,
    u.correo,
    uc.ultimo_login_exitoso,
    uc.ultimo_cambio_password,
    uc.intentos_fallidos,
    uc.doble_factor_activo,
    (
        SELECT MAX(a.fecha_acceso)
        FROM accesos_usuario a
        WHERE a.usuario_id = u.id_usuario
    ) AS ultimo_acceso_registrado
FROM usuarios u
JOIN usuarios_credenciales uc
    ON uc.usuario_id = u.id_usuario;

-- =========================================================
-- Catalogos base
-- No incluye usuarios ni movimientos demo
-- =========================================================

INSERT INTO catalogo_bancos (nombre, codigo, tipo_entidad, orden_visual)
VALUES
    ('Wallet Digital', 'WALLET', 'wallet', 1),
    ('Banco Agricola', 'BAGRI', 'banco', 10),
    ('Banco Cuscatlan', 'BCUSC', 'banco', 20),
    ('Davivienda', 'DAVIV', 'banco', 30),
    ('BAC Credomatic', 'BAC', 'banco', 40),
    ('Banco Promerica', 'PROM', 'banco', 50),
    ('Banco Atlantida', 'ATLA', 'banco', 60)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO proveedores_servicio (
    nombre,
    categoria,
    banco_id,
    referencia_recaudo,
    descripcion
)
SELECT
    proveedor.nombre,
    proveedor.categoria,
    banco.id_banco,
    proveedor.referencia,
    proveedor.descripcion
FROM (
    VALUES
        ('AES El Salvador', 'energia', 'BAGRI', 'AES-SV', 'Pago de energia electrica'),
        ('ANDA', 'agua', 'BCUSC', 'ANDA-SV', 'Pago de servicio de agua potable'),
        ('Claro Hogar', 'internet', 'BAC', 'CLARO-H', 'Pago de internet y telefonia hogar'),
        ('Tigo', 'telefonia', 'DAVIV', 'TIGO-M', 'Pago de telefonia movil y fija'),
        ('Netflix', 'streaming', 'WALLET', 'NETFLIX', 'Suscripcion de streaming')
) AS proveedor(nombre, categoria, banco_codigo, referencia, descripcion)
JOIN catalogo_bancos banco
    ON banco.codigo = proveedor.banco_codigo
ON CONFLICT (nombre) DO NOTHING;

-- =========================================================
-- Permisos para el usuario de la aplicacion
-- Se conservan solo los ALTER necesarios para privilegios
-- futuros sobre tablas y secuencias creadas por este owner.
-- =========================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sa';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sa';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sa';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sa';
    END IF;
END $$;
