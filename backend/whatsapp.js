/**
 * Modulo: whatsapp.js
 *
 * Que hace: envia el PIN de recuperacion de contrasena por WhatsApp usando la API de Twilio.
 * Como lo hace: llamada HTTPS directa a api.twilio.com (sin SDK) con autenticacion Basic. Si no esta
 *   configurado y previewMode esta activo, imprime el PIN en consola y lo devuelve como preview.
 * Datos que participan: telefono del usuario, nombre, PIN y config.whatsapp (accountSid, authToken, from,
 *   defaultCountryCode, previewMode).
 * Consultas SQL: ninguna.
 */

const https = require("https");
const { Buffer } = require("buffer");
const { config } = require("./env");

/**
 * Funcion: normalizeWhatsAppTarget
 *
 * Que hace: normaliza el telefono al formato whatsapp:+codigo que Twilio espera.
 * Como lo hace: si empieza con '+' limpia el resto; si no, deja solo digitos y, cuando tiene 10 o menos,
 *   antepone el codigo de pais por defecto (+503); si es mas largo asume que ya trae el codigo de pais.
 * Datos que participan: `phone`.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: string 'whatsapp:+...' o '' si no hay numero.
 */
function normalizeWhatsAppTarget(phone) {
    const rawPhone = String(phone || "").trim();
    if (!rawPhone) {
        return "";
    }

    if (rawPhone.startsWith("+")) {
        return `whatsapp:${rawPhone.replace(/[^\d+]/g, "")}`;
    }

    const digits = rawPhone.replace(/\D/g, "");
    if (!digits) {
        return "";
    }

    const countryCode = String(config.whatsapp.defaultCountryCode || "+503").replace(/[^\d+]/g, "");
    if (digits.length <= 10) {
        return `whatsapp:${countryCode}${digits}`;
    }

    return `whatsapp:+${digits}`;
}

/**
 * Funcion: buildPasswordResetMessage
 *
 * Que hace: arma el texto breve que se envia por WhatsApp para recuperar el acceso.
 * Como lo hace: concatena saludo, aviso de la solicitud, PIN, vigencia e indicacion de ignorar el mensaje si
 *   no lo solicito.
 * Datos que participan: { userName, pin, expiresInMinutes }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: string.
 */
function buildPasswordResetMessage({ userName, pin, expiresInMinutes }) {
    const saludo = userName ? `Hola ${userName}.` : "Hola.";

    return [
        saludo,
        "Recibimos una solicitud para restablecer tu contrasena en Wallet Digital.",
        `Tu PIN temporal es ${pin}.`,
        `Este PIN vence en ${expiresInMinutes} minutos.`,
        "Si no solicitaste este cambio, ignora este mensaje."
    ].join(" ");
}

/**
 * Funcion: sendTwilioWhatsAppMessage
 *
 * Que hace: hace la llamada HTTP directa a Twilio para despachar el mensaje; esta aislada para que el flujo
 *   superior solo piense en negocio.
 * Como lo hace: POST application/x-www-form-urlencoded a /2010-04-01/Accounts/{sid}/Messages.json con To, From
 *   y Body; acumula la respuesta, la parsea y resuelve si el estado es 2xx o rechaza con el mensaje de Twilio.
 * Datos que participan: { to, body } y credenciales de config.whatsapp.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: Promise con la respuesta JSON de Twilio.
 */
function sendTwilioWhatsAppMessage({ to, body }) {
    return new Promise((resolve, reject) => {
        const payload = new URLSearchParams({
            To: to,
            From: config.whatsapp.from,
            Body: body
        }).toString();

        const request = https.request({
            hostname: "api.twilio.com",
            path: `/2010-04-01/Accounts/${config.whatsapp.accountSid}/Messages.json`,
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(`${config.whatsapp.accountSid}:${config.whatsapp.authToken}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(payload)
            }
        }, (response) => {
            let bodyText = "";

            response.on("data", (chunk) => {
                bodyText += chunk;
            });

            response.on("end", () => {
                let parsed = {};
                try {
                    parsed = JSON.parse(bodyText || "{}");
                } catch (error) {
                    parsed = {};
                }

                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(parsed);
                    return;
                }

                reject(new Error(parsed.message || "Twilio rechazo el envio por WhatsApp."));
            });
        });

        request.on("error", reject);
        request.write(payload);
        request.end();
    });
}

/**
 * Funcion: sendPasswordResetWhatsApp
 *
 * Que hace: coordina el envio del PIN por WhatsApp real o por modo preview sin romper el flujo si la
 *   integracion no esta lista.
 * Como lo hace: valida el numero; sin configuracion devuelve preview (si previewMode) o lanza error; con
 *   configuracion envia por Twilio y, ante fallo, cae a preview si previewMode esta activo.
 * Datos que participan: { phone, userName, pin }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { delivered, preview, channel, sid | previewPin, deliveryError }.
 */
async function sendPasswordResetWhatsApp({ phone, userName, pin }) {
    const to = normalizeWhatsAppTarget(phone);
    if (!to) {
        throw new Error("El usuario no tiene un numero valido para recibir WhatsApp.");
    }

    const body = buildPasswordResetMessage({
        userName,
        pin,
        expiresInMinutes: config.passwordResetTokenMinutes
    });

    if (!config.whatsapp.enabled) {
        if (config.whatsapp.previewMode) {
            console.log("[wallet-whatsapp-preview] Recuperacion de contrasena");
            console.log(`Para: ${to}`);
            console.log(`PIN: ${pin}`);
            return {
                delivered: false,
                preview: true,
                previewPin: pin,
                channel: "whatsapp-preview"
            };
        }

        throw new Error("WhatsApp no esta configurado para enviar el PIN.");
    }

    try {
        const response = await sendTwilioWhatsAppMessage({ to, body });
        return {
            delivered: true,
            preview: false,
            channel: "whatsapp",
            sid: response.sid || ""
        };
    } catch (error) {
        if (config.whatsapp.previewMode) {
            console.warn("No se pudo enviar el WhatsApp real:", error.message);
            console.log("[wallet-whatsapp-preview] Recuperacion de contrasena");
            console.log(`Para: ${to}`);
            console.log(`PIN: ${pin}`);
            return {
                delivered: false,
                preview: true,
                previewPin: pin,
                channel: "whatsapp-preview",
                deliveryError: error.message
            };
        }

        throw error;
    }
}

module.exports = {
    sendPasswordResetWhatsApp,
    normalizeWhatsAppTarget
};
