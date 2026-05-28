const nodemailer = require("nodemailer");
const { config } = require("./env");

let transporter = null;
let legacyPasswordWarningShown = false;

// Funcion: buildEmailShell
// Aqui envuelvo el contenido principal dentro de una plantilla visual mas cuidada.
// Lo hago con estilos inline para que el correo mantenga forma incluso en clientes estrictos.
function buildEmailShell({ pretitle, title, intro, badge, bodyBlocks, footerNote, action }) {
    const blocks = Array.isArray(bodyBlocks) ? bodyBlocks.filter(Boolean) : [];
    const actionHtml = action?.url && action?.label
        ? [
            '<tr>',
            '  <td style="padding: 0 32px 24px 32px;">',
            `    <a href="${action.url}" style="display:inline-block; background:#6b4dff; color:#ffffff; text-decoration:none; padding:14px 22px; border-radius:14px; font-weight:700; font-size:15px;">${action.label}</a>`,
            "  </td>",
            "</tr>"
        ].join("")
        : "";

    return [
        '<!DOCTYPE html>',
        '<html lang="es">',
        "<head>",
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        `  <title>${title}</title>`,
        "</head>",
        '<body style="margin:0; padding:24px 12px; background:#f4f2ff; font-family:Arial, Helvetica, sans-serif; color:#1d1830;">',
        '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; margin:0 auto; border-collapse:collapse;">',
        "    <tr>",
        '      <td style="padding:0;">',
        '        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; background:#ffffff; border:1px solid #e3dbff; border-radius:28px; overflow:hidden;">',
        "          <tr>",
        '            <td style="padding:28px 32px 22px 32px; background:linear-gradient(135deg, #0f0f14 0%, #181824 52%, #6b4dff 100%); color:#ffffff;">',
        '              <div style="display:inline-block; padding:7px 12px; border:1px solid rgba(255,255,255,0.18); border-radius:999px; background:rgba(255,255,255,0.08); font-size:12px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;">Wallet Digital</div>',
        `              <p style="margin:18px 0 10px 0; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#d7cdfd;">${pretitle}</p>`,
        `              <h1 style="margin:0 0 12px 0; font-size:30px; line-height:1.12; color:#ffffff;">${title}</h1>`,
        `              <p style="margin:0; font-size:16px; line-height:1.65; color:#ede9ff;">${intro}</p>`,
        "            </td>",
        "          </tr>",
        badge
            ? [
                "          <tr>",
                '            <td style="padding:24px 32px 10px 32px;">',
                `              <div style="display:inline-block; padding:16px 18px; border-radius:20px; background:#f6f2ff; border:1px solid #ddd1ff;">${badge}</div>`,
                "            </td>",
                "          </tr>"
            ].join("")
            : "",
        blocks.map(function (block) {
            return [
                "          <tr>",
                `            <td style="padding:0 32px 18px 32px; font-size:15px; line-height:1.7; color:#413a59;">${block}</td>`,
                "          </tr>"
            ].join("");
        }).join(""),
        actionHtml,
        "          <tr>",
        '            <td style="padding:0 32px 28px 32px;">',
        '              <div style="padding:18px 18px 0 18px; border-top:1px solid #ece6ff; font-size:13px; line-height:1.7; color:#7d739c;">',
        `                ${footerNote}`,
        "              </div>",
        "            </td>",
        "          </tr>",
        "        </table>",
        "      </td>",
        "    </tr>",
        "  </table>",
        "</body>",
        "</html>"
    ].join("");
}

// Funcion: buildPasswordResetMessage
// Aqui preparo la version texto y HTML del correo de recuperacion.
// Lo hago separado para reutilizar el contenido sin mezclarlo con el envio.
function buildPasswordResetMessage({ userName, pin, resetUrl, expiresInMinutes }) {
    const saludo = userName ? `Hola ${userName},` : "Hola,";
    const text = [
        saludo,
        "",
        "Recibimos una solicitud para restablecer tu contrasena en Wallet Digital.",
        `PIN de recuperacion: ${pin}`,
        `Enlace directo: ${resetUrl}`,
        `Este PIN vence en ${expiresInMinutes} minutos.`,
        "",
        "Si no solicitaste este cambio, puedes ignorar este mensaje."
    ].join("\n");

    const html = buildEmailShell({
        pretitle: "Seguridad de acceso",
        title: "PIN de recuperacion",
        intro: "Recibimos una solicitud para restablecer tu contrasena. Usa este codigo dentro de la app y completa el cambio antes de que expire.",
        badge: [
            '<div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#765cff; margin-bottom:8px; font-weight:700;">Codigo temporal</div>',
            `<div style="font-size:34px; line-height:1; font-weight:800; letter-spacing:0.14em; color:#1d1830;">${pin}</div>`,
            `<div style="margin-top:10px; font-size:13px; color:#766b98;">Vence en ${expiresInMinutes} minutos</div>`
        ].join(""),
        bodyBlocks: [
            `<strong style="display:block; color:#1d1830;">${saludo}</strong>`,
            "Si no reconoces esta solicitud, no compartas el codigo y cambia tu contrasena cuando entres de nuevo a tu cuenta."
        ],
        action: {
            label: "Abrir recuperacion",
            url: resetUrl
        },
        footerNote: "Este PIN es personal, vence pronto y solo funciona una vez. Si no solicitaste el cambio, puedes ignorar este correo con tranquilidad."
    });

    return {
        subject: "PIN de recuperacion | Wallet Digital",
        text,
        html
    };
}

// Funcion: buildRegistrationVerificationMessage
// Aqui armo el correo que confirma el alta inicial de la cuenta.
// Incluyo PIN y enlace directo para que la activacion pueda cerrarse
// tanto desde un modal como desde el boton del correo.
function buildRegistrationVerificationMessage({ userName, pin, activationUrl, expiresInMinutes }) {
    const saludo = userName ? `Hola ${userName},` : "Hola,";
    const text = [
        saludo,
        "",
        "Tu cuenta en Wallet Digital ya fue creada.",
        "Antes de iniciar sesion, necesitamos verificar que el correo realmente te pertenece.",
        `PIN de activacion: ${pin}`,
        `Enlace directo: ${activationUrl}`,
        `Este PIN vence en ${expiresInMinutes} minutos.`,
        "",
        "Si no realizaste este registro, puedes ignorar este mensaje."
    ].join("\n");

    const html = buildEmailShell({
        pretitle: "Activacion de cuenta",
        title: "Confirma tu correo",
        intro: "Tu wallet ya fue creada. Para proteger el acceso, activa la cuenta con este PIN o usando el boton directo del correo.",
        badge: [
            '<div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#765cff; margin-bottom:8px; font-weight:700;">PIN de activacion</div>',
            `<div style="font-size:34px; line-height:1; font-weight:800; letter-spacing:0.14em; color:#1d1830;">${pin}</div>`,
            `<div style="margin-top:10px; font-size:13px; color:#766b98;">Vence en ${expiresInMinutes} minutos</div>`
        ].join(""),
        bodyBlocks: [
            `<strong style="display:block; color:#1d1830;">${saludo}</strong>`,
            "Una vez verifiques el correo, la app cerrara el registro y te dejara entrar a tu wallet con normalidad."
        ],
        action: {
            label: "Activar mi cuenta",
            url: activationUrl
        },
        footerNote: "Este PIN solo sirve para activar el correo de la cuenta recien creada. Si no fuiste tu, no compartas el codigo."
    });

    return {
        subject: "Activa tu cuenta | Wallet Digital",
        text,
        html
    };
}

// Funcion: buildSalaryAdvanceCodeMessage
// Aqui preparo el correo que autoriza un adelanto salarial con un codigo temporal.
// Lo separo para poder reutilizar el contenido sin mezclar construccion y envio.
function buildSalaryAdvanceCodeMessage({ userName, pin, amount, expiresInMinutes }) {
    const saludo = userName ? `Hola ${userName},` : "Hola,";
    const montoTexto = Number.isFinite(Number(amount)) ? `${Number(amount).toFixed(2)} USD` : "el adelanto solicitado";
    const text = [
        saludo,
        "",
        "Recibimos una solicitud para autorizar un adelanto salarial en Wallet Digital.",
        `Monto solicitado: ${montoTexto}`,
        `Codigo de verificacion: ${pin}`,
        `Este codigo vence en ${expiresInMinutes} minutos.`,
        "",
        "Si no realizaste esta solicitud, no compartas el codigo y cambia tu contrasena."
    ].join("\n");

    const html = buildEmailShell({
        pretitle: "Aprobacion de adelanto",
        title: "Codigo de verificacion",
        intro: "Antes de acreditar el adelanto salarial, necesitamos confirmar que la solicitud fue iniciada por ti desde tu wallet.",
        badge: [
            '<div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#765cff; margin-bottom:8px; font-weight:700;">Monto solicitado</div>',
            `<div style="font-size:24px; line-height:1.2; font-weight:800; color:#1d1830;">${montoTexto}</div>`,
            `<div style="margin:14px 0 8px 0; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#765cff; font-weight:700;">Codigo temporal</div>`,
            `<div style="font-size:30px; line-height:1; font-weight:800; letter-spacing:0.14em; color:#1d1830;">${pin}</div>`,
            `<div style="margin-top:10px; font-size:13px; color:#766b98;">Vence en ${expiresInMinutes} minutos</div>`
        ].join(""),
        bodyBlocks: [
            `<strong style="display:block; color:#1d1830;">${saludo}</strong>`,
            "Ingresa este codigo dentro de la wallet para terminar la autorizacion. Si no reconoces esta solicitud, no compartas el codigo y revisa tu cuenta."
        ],
        footerNote: "Este codigo solo autoriza el adelanto solicitado y deja de funcionar al vencer o al primer uso."
    });

    return {
        subject: "Codigo para adelanto salarial | Wallet Digital",
        text,
        html
    };
}

// Funcion: getTransporter
// Aqui creo y reutilizo una unica instancia de Nodemailer.
// Asi evito reconstruir el transporte en cada solicitud.
async function getTransporter() {
    if (!config.mail.enabled) {
        return null;
    }

    // Funcion: aviso de compatibilidad
    // Aqui dejo una advertencia amable cuando el proyecto aun usa SMTP_PASSWORD.
    // La app sigue funcionando, pero dejo claro que lo mas sano es migrar a SMTP_AUTH_SECRET.
    if (config.mail.usingLegacyPasswordVariable && !legacyPasswordWarningShown) {
        console.warn("Aviso de correo: SMTP_PASSWORD sigue siendo compatible, pero conviene migrarlo a SMTP_AUTH_SECRET.");
        legacyPasswordWarningShown = true;
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: config.mail.host,
            port: config.mail.port,
            secure: config.mail.secure,
            auth: config.mail.user
                ? {
                    user: config.mail.user,
                    pass: config.mail.secret
                }
                : undefined
        });
    }

    return transporter;
}

// Funcion: sendPasswordResetEmail
// Aqui intento enviar el PIN de recuperacion por correo real.
// Si el entorno esta en preview, devuelvo datos simulados para pruebas locales.
async function sendPasswordResetEmail({ to, userName, pin, resetUrl }) {
    const expiresInMinutes = config.passwordResetTokenMinutes;
    const message = buildPasswordResetMessage({
        userName,
        pin,
        resetUrl,
        expiresInMinutes
    });

    if (!config.mail.enabled) {
        console.log("[wallet-mail-preview] Recuperacion de contrasena");
        console.log(`Para: ${to}`);
        console.log(`PIN: ${pin}`);
        console.log(`URL: ${resetUrl}`);
        return {
            delivered: false,
            preview: true,
            previewPin: pin,
            previewResetUrl: resetUrl
        };
    }

    if (config.mail.previewMode) {
        console.log("[wallet-mail-preview] Recuperacion de contrasena");
        console.log(`Para: ${to}`);
        console.log(`PIN: ${pin}`);
        console.log(`URL: ${resetUrl}`);
        return {
            delivered: false,
            preview: true,
            previewPin: pin,
            previewResetUrl: resetUrl
        };
    }

    try {
        const activeTransporter = await getTransporter();
        const info = await activeTransporter.sendMail({
            from: config.mail.from,
            to,
            subject: message.subject,
            text: message.text,
            html: message.html
        });

        return {
            delivered: true,
            preview: false,
            messageId: info.messageId
        };
    } catch (error) {
        console.warn("No se pudo enviar el correo real de recuperacion:", error.message);

        if (config.mail.previewMode) {
            console.log("[wallet-mail-preview] Recuperacion de contrasena");
            console.log(`Para: ${to}`);
            console.log(`PIN: ${pin}`);
            console.log(`URL: ${resetUrl}`);
            return {
                delivered: false,
                preview: true,
                previewPin: pin,
                previewResetUrl: resetUrl,
                deliveryError: error.message
            };
        }

        throw error;
    }
}

// Funcion: sendRegistrationVerificationEmail
// Aqui envio el PIN que cierra el ciclo del registro.
// Si el entorno esta en preview, devuelvo el PIN y la URL para seguir
// probando el flujo sin depender de un servidor SMTP real.
async function sendRegistrationVerificationEmail({ to, userName, pin, activationUrl }) {
    const expiresInMinutes = config.registrationVerificationCodeMinutes;
    const message = buildRegistrationVerificationMessage({
        userName,
        pin,
        activationUrl,
        expiresInMinutes
    });

    if (!config.mail.enabled) {
        console.log("[wallet-mail-preview] Activacion de cuenta");
        console.log(`Para: ${to}`);
        console.log(`PIN: ${pin}`);
        console.log(`URL: ${activationUrl}`);
        return {
            delivered: false,
            preview: true,
            previewPin: pin,
            previewActivationUrl: activationUrl
        };
    }

    if (config.mail.previewMode) {
        console.log("[wallet-mail-preview] Activacion de cuenta");
        console.log(`Para: ${to}`);
        console.log(`PIN: ${pin}`);
        console.log(`URL: ${activationUrl}`);
        return {
            delivered: false,
            preview: true,
            previewPin: pin,
            previewActivationUrl: activationUrl
        };
    }

    try {
        const activeTransporter = await getTransporter();
        const info = await activeTransporter.sendMail({
            from: config.mail.from,
            to,
            subject: message.subject,
            text: message.text,
            html: message.html
        });

        return {
            delivered: true,
            preview: false,
            messageId: info.messageId
        };
    } catch (error) {
        console.warn("No se pudo enviar el correo real de activacion:", error.message);

        if (config.mail.previewMode) {
            console.log("[wallet-mail-preview] Activacion de cuenta");
            console.log(`Para: ${to}`);
            console.log(`PIN: ${pin}`);
            console.log(`URL: ${activationUrl}`);
            return {
                delivered: false,
                preview: true,
                previewPin: pin,
                previewActivationUrl: activationUrl,
                deliveryError: error.message
            };
        }

        throw error;
    }
}

// Funcion: sendSalaryAdvanceCodeEmail
// Aqui envio el codigo que autoriza un adelanto salarial.
// Si el correo real no esta configurado, devuelvo un preview para que el flujo siga sirviendo en pruebas.
async function sendSalaryAdvanceCodeEmail({ to, userName, pin, amount }) {
    const expiresInMinutes = config.advanceVerificationCodeMinutes;
    const message = buildSalaryAdvanceCodeMessage({
        userName,
        pin,
        amount,
        expiresInMinutes
    });

    if (!config.mail.enabled) {
        console.log("[wallet-mail-preview] Codigo de adelanto salarial");
        console.log(`Para: ${to}`);
        console.log(`Codigo: ${pin}`);
        console.log(`Monto: ${amount}`);
        return {
            delivered: false,
            preview: true,
            previewPin: pin
        };
    }

    if (config.mail.previewMode) {
        console.log("[wallet-mail-preview] Codigo de adelanto salarial");
        console.log(`Para: ${to}`);
        console.log(`Codigo: ${pin}`);
        console.log(`Monto: ${amount}`);
        return {
            delivered: false,
            preview: true,
            previewPin: pin
        };
    }

    try {
        const activeTransporter = await getTransporter();
        const info = await activeTransporter.sendMail({
            from: config.mail.from,
            to,
            subject: message.subject,
            text: message.text,
            html: message.html
        });

        return {
            delivered: true,
            preview: false,
            messageId: info.messageId
        };
    } catch (error) {
        console.warn("No se pudo enviar el correo real del codigo de adelanto:", error.message);

        if (config.mail.previewMode) {
            console.log("[wallet-mail-preview] Codigo de adelanto salarial");
            console.log(`Para: ${to}`);
            console.log(`Codigo: ${pin}`);
            console.log(`Monto: ${amount}`);
            return {
                delivered: false,
                preview: true,
                previewPin: pin,
                deliveryError: error.message
            };
        }

        throw error;
    }
}

module.exports = {
    sendRegistrationVerificationEmail,
    sendPasswordResetEmail,
    sendSalaryAdvanceCodeEmail
};
