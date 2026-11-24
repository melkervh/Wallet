/**
 * Modulo: env.js
 *
 * Que hace: carga y normaliza la configuracion de la aplicacion.
 * Como lo hace: lee .env manualmente, lo mezcla con process.env (el archivo tiene prioridad) y arma el objeto
 *   `config`.
 * Datos que participan: PORT, APP_SECRET, TOKEN_DURATION_HOURS, APP_BASE_URL, tiempos de PIN/tokens,
 *   HTTP_MAX_BODY_BYTES,
 * SMTP_* (correo), WHATSAPP_* (mensajeria) y variables PG y DATABASE_URL (base de datos).
 * Consultas SQL: ninguna.
 */

const fs = require("fs");
const path = require("path");

/**
 * Funcion: parseBoolean
 *
 * Que hace: convierte valores de entorno a booleanos reales.
 * Como lo hace: en .env todo llega como texto; devuelve el valor por defecto si esta vacio y true solo para
 *   "true", "1" o "yes".
 * Datos que participan: `value`, `defaultValue`.
 * Consultas SQL: ninguna.
 * Retorna: boolean.
 */
function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    const normalized = String(value).trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * Funcion: loadEnvFile
 *
 * Que hace: lee manualmente el archivo .env y lo convierte en un objeto simple, sin depender de otra libreria.
 * Como lo hace: busca .env en process.cwd(); recorre cada linea ignorando vacias y comentarios (#), separa en
 *   el primer "=" y quita comillas dobles envolventes.
 * Datos que participan: archivo .env.
 * Consultas SQL: ninguna.
 * Retorna: objeto { CLAVE: valor }, o {} si no existe el archivo.
 */
function loadEnvFile() {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) {
        return {};
    }

    const fileContent = fs.readFileSync(envPath, "utf8");
    const values = {};

    for (const rawLine of fileContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1");
        if (key) {
            values[key] = value;
        }
    }

    return values;
}

const fileEnv = loadEnvFile();
const mergedEnv = { ...fileEnv, ...process.env };
const sslEnabled = parseBoolean(mergedEnv.PGSSL, false);
const port = Number(mergedEnv.PORT || 3000);
const smtpAuthUser = mergedEnv.SMTP_AUTH_USER || mergedEnv.SMTP_USER || "";
const smtpAuthSecret = mergedEnv.SMTP_AUTH_SECRET || mergedEnv.SMTP_PASSWORD || "";
const baseDatabaseConfig = mergedEnv.DATABASE_URL
    ? {
        connectionString: mergedEnv.DATABASE_URL
    }
    : {
        host: mergedEnv.PGHOST || "127.0.0.1",
        port: Number(mergedEnv.PGPORT || 5432),
        database: mergedEnv.PGDATABASE || "wallet",
        user: mergedEnv.PGUSER || "postgres",
        password: mergedEnv.PGPASSWORD || "postgres"
    };

if (sslEnabled) {
    baseDatabaseConfig.ssl = { rejectUnauthorized: false };
}

// En serverless cada instancia abre su propio pool: se limita para no agotar las conexiones del pooler.
baseDatabaseConfig.max = Number(mergedEnv.PG_POOL_MAX || (mergedEnv.VERCEL ? 3 : 10));
baseDatabaseConfig.idleTimeoutMillis = Number(mergedEnv.PG_IDLE_TIMEOUT_MS || 10000);
baseDatabaseConfig.connectionTimeoutMillis = Number(mergedEnv.PG_CONNECT_TIMEOUT_MS || 10000);

const config = {
    port,
    appSecret: mergedEnv.APP_SECRET || "wallet-secret-dev",
    tokenDurationHours: Number(mergedEnv.TOKEN_DURATION_HOURS || 12),
    twoFactorCodeMinutes: Number(mergedEnv.TWO_FACTOR_CODE_MINUTES || 10),
    appBaseUrl: mergedEnv.APP_BASE_URL || `http://localhost:${port}`,
    registrationVerificationCodeMinutes: Number(mergedEnv.REGISTRATION_VERIFICATION_CODE_MINUTES || 15),
    passwordResetTokenMinutes: Number(mergedEnv.PASSWORD_RESET_TOKEN_MINUTES || 30),
    advanceVerificationCodeMinutes: Number(mergedEnv.ADVANCE_VERIFICATION_CODE_MINUTES || 10),
    httpMaxBodyBytes: Number(mergedEnv.HTTP_MAX_BODY_BYTES || 1024 * 1024),
    mail: {
        enabled: Boolean(mergedEnv.SMTP_HOST && mergedEnv.SMTP_FROM && (!smtpAuthUser || smtpAuthSecret)),
        previewMode: parseBoolean(mergedEnv.SMTP_PREVIEW_MODE, false),
        host: mergedEnv.SMTP_HOST || "",
        port: Number(mergedEnv.SMTP_PORT || 587),
        secure: parseBoolean(mergedEnv.SMTP_SECURE, false),
        user: smtpAuthUser,
        secret: smtpAuthSecret,
        from: mergedEnv.SMTP_FROM || "",
        authMode: mergedEnv.SMTP_AUTH_MODE || "secret",
        usingLegacyPasswordVariable: Boolean(!mergedEnv.SMTP_AUTH_SECRET && mergedEnv.SMTP_PASSWORD)
    },
    whatsapp: {
        enabled: Boolean(mergedEnv.WHATSAPP_ACCOUNT_SID && mergedEnv.WHATSAPP_AUTH_TOKEN && mergedEnv.WHATSAPP_FROM),
        previewMode: parseBoolean(mergedEnv.WHATSAPP_PREVIEW_MODE, false),
        accountSid: mergedEnv.WHATSAPP_ACCOUNT_SID || "",
        authToken: mergedEnv.WHATSAPP_AUTH_TOKEN || "",
        from: mergedEnv.WHATSAPP_FROM || "",
        defaultCountryCode: mergedEnv.WHATSAPP_DEFAULT_COUNTRY_CODE || "+503"
    },
    database: baseDatabaseConfig
};

module.exports = {
    config
};
