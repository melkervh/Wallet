const https = require("https");
const { Buffer } = require("buffer");
const { config } = require("./env");

// Funcion: normalizeWhatsAppTarget
// Aqui normalizo el telefono al formato que Twilio espera para WhatsApp.
// Con esto acepto tanto numeros con prefijo como valores mas sueltos del usuario.
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

// Funcion: buildPasswordResetMessage
// Aqui armo el texto breve que se envia por WhatsApp para recuperar acceso.
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

// Funcion: sendTwilioWhatsAppMessage
// Aqui hago la llamada HTTP directa a Twilio para despachar el mensaje.
// Mantengo este paso aislado para que el flujo superior solo piense en negocio.
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

// Funcion: sendPasswordResetWhatsApp
// Aqui coordino el envio del PIN por WhatsApp real o por modo preview.
// Si la integracion no esta lista, controlo el fallback sin romper el flujo.
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
