/**
 * Modulo: mailer.js
 *
 * Que hace: construye y envia los correos transaccionales (recuperacion de contrasena, activacion de cuenta y
 *   codigo de adelanto salarial).
 * Como lo hace: plantillas HTML con estilos inline (para que se vean bien en clientes de correo estrictos) mas
 *   version en texto plano, enviadas con Nodemailer sobre SMTP. Si SMTP no esta configurado o
 *   config.mail.previewMode esta activo, no envia: imprime el PIN en consola y lo devuelve en modo 'preview'
 *   para poder probar el flujo.
 * Datos que participan: destinatario, nombre, PIN o codigo, URLs de accion y la configuracion config.mail
 *   (host, puerto, usuario, from, vigencia de los codigos).
 * Consultas SQL: ninguna.
 */

const nodemailer = require("nodemailer");
const { config } = require("./env");

let transporter = null;
let legacyPasswordWarningShown = false;

/**
 * Funcion: buildEmailShell
 *
 * Que hace: envuelve el contenido principal dentro de una plantilla visual cuidada.
 * Como lo hace: arma el HTML con tabla central, titulo, introduccion, insignia, bloques de contenido, boton de
 *   accion opcional y nota de pie, todo con estilos inline.
 * Datos que participan: { pretitle, title, intro, badge, bodyBlocks, footerNote, action: { url, label } }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: string HTML.
 */
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

/**
 * Funcion: buildPasswordResetMessage
 *
 * Que hace: arma asunto, texto y HTML del correo de recuperacion de contrasena.
 * Como lo hace: inserta nombre, PIN, vigencia en minutos y boton con el enlace de recuperacion en la
 *   plantilla.
 * Datos que participan: { userName, pin, resetUrl, expiresInMinutes }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { subject, text, html }.
 */
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

/**
 * Funcion: buildRegistrationVerificationMessage
 *
 * Que hace: arma asunto, texto y HTML del correo de activacion de cuenta.
 * Como lo hace: inserta nombre, PIN, vigencia y boton con el enlace de activacion.
 * Datos que participan: { userName, pin, activationUrl, expiresInMinutes }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { subject, text, html }.
 */
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

/**
 * Funcion: buildSalaryAdvanceCodeMessage
 *
 * Que hace: arma asunto, texto y HTML del correo con el codigo que autoriza un adelanto salarial.
 * Como lo hace: inserta nombre, codigo, monto solicitado y vigencia.
 * Datos que participan: { userName, pin, amount, expiresInMinutes }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { subject, text, html }.
 */
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

/**
 * Funcion: getTransporter
 *
 * Que hace: crea y reutiliza una unica instancia de Nodemailer para no reconstruir el transporte en cada
 *   solicitud.
 * Como lo hace: devuelve null si el correo no esta habilitado; avisa una sola vez si todavia se usa
 *   SMTP_PASSWORD (variable antigua) y crea el transporte con host, puerto, secure y credenciales si existen.
 * Datos que participan: config.mail.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: transporte de Nodemailer o null.
 */
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

/**
 * Funcion: sendPasswordResetEmail
 *
 * Que hace: envia el PIN de recuperacion por correo real, o simula el envio en modo preview.
 * Como lo hace: sin SMTP o con previewMode devuelve el PIN y la URL sin enviar; con SMTP intenta sendMail y,
 *   si falla estando en previewMode, cae a preview con el error; si falla fuera de previewMode relanza el error.
 * Datos que participan: { to, userName, pin, resetUrl } y config.passwordResetTokenMinutes.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { delivered, preview, messageId | previewPin, previewResetUrl, deliveryError }.
 */
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

/**
 * Funcion: sendRegistrationVerificationEmail
 *
 * Que hace: envia el PIN que cierra el ciclo del registro; en preview devuelve PIN y URL para probar sin SMTP.
 * Como lo hace: misma logica de envio/preview que sendPasswordResetEmail con la plantilla de activacion.
 * Datos que participan: { to, userName, pin, activationUrl } y config.registrationVerificationCodeMinutes.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { delivered, preview, messageId | previewPin, previewActivationUrl, deliveryError }.
 */
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

/**
 * Funcion: sendSalaryAdvanceCodeEmail
 *
 * Que hace: envia el codigo que autoriza un adelanto salarial; si no hay correo real devuelve un preview para
 *   que el flujo siga sirviendo en pruebas.
 * Como lo hace: misma logica de envio/preview con la plantilla del adelanto.
 * Datos que participan: { to, userName, pin, amount } y config.advanceVerificationCodeMinutes.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { delivered, preview, messageId | previewPin, deliveryError }.
 */
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

/**
 * Funcion: buildTwoFactorMessage
 *
 * Que hace: arma asunto, texto y HTML del correo con el codigo del segundo paso de inicio de sesion.
 * Como lo hace: inserta nombre, codigo y vigencia en la plantilla comun (buildEmailShell) y advierte que, si la
 *               persona no intento entrar, debe cambiar su contrasena.
 * Datos que participan: { userName, pin, expiresInMinutes }.
 * Consultas SQL: ninguna.
 * Retorna: { subject, text, html }.
 */
function buildTwoFactorMessage({ userName, pin, expiresInMinutes }) {
    const saludo = userName ? `Hola ${userName},` : "Hola,";
    const text = [
        saludo,
        "",
        "Alguien acaba de introducir tu correo y contrasena en Wallet Digital.",
        `Tu codigo de verificacion es: ${pin}`,
        `Este codigo vence en ${expiresInMinutes} minutos y solo sirve una vez.`,
        "",
        "Si no fuiste tu, cambia tu contrasena de inmediato y no compartas este codigo."
    ].join("\n");

    const html = buildEmailShell({
        pretitle: "Verificacion en dos pasos",
        title: "Confirma que eres tu",
        intro: "Tu contrasena fue correcta. Para terminar de iniciar sesion, ingresa este codigo en la pantalla de acceso.",
        badge: [
            '<div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#765cff; margin-bottom:8px; font-weight:700;">Codigo de verificacion</div>',
            `<div style="font-size:34px; line-height:1; font-weight:800; letter-spacing:0.14em; color:#1d1830;">${pin}</div>`,
            `<div style="margin-top:10px; font-size:13px; color:#766b98;">Vence en ${expiresInMinutes} minutos</div>`
        ].join(""),
        bodyBlocks: [
            `<strong style="display:block; color:#1d1830;">${saludo}</strong>`,
            "Si no intentaste iniciar sesion, alguien conoce tu contrasena: cambiala cuanto antes."
        ],
        footerNote: "Nunca compartas este codigo. Wallet Digital no te lo pedira por telefono ni por mensaje."
    });

    return {
        subject: "Tu codigo de verificacion | Wallet Digital",
        text,
        html
    };
}

/**
 * Funcion: sendTwoFactorCodeEmail
 *
 * Que hace: envia por correo el codigo del segundo paso de inicio de sesion, o simula el envio en modo preview.
 * Como lo hace: sin SMTP o con previewMode devuelve el codigo sin enviar; con SMTP intenta sendMail y, si
 *               falla estando en previewMode, cae a preview con el error; fuera de previewMode relanza el
 *               error (el login falla y no se entrega ningun token, nunca se salta el segundo paso).
 * Datos que participan: { to, userName, pin } y config.twoFactorCodeMinutes.
 * Consultas SQL: ninguna.
 * Retorna: { delivered, preview, messageId | previewPin, deliveryError }.
 */
async function sendTwoFactorCodeEmail({ to, userName, pin }) {
    const message = buildTwoFactorMessage({
        userName,
        pin,
        expiresInMinutes: config.twoFactorCodeMinutes
    });

    if (!config.mail.enabled || config.mail.previewMode) {
        console.log("[wallet-mail-preview] Codigo de verificacion en dos pasos");
        console.log(`Para: ${to}`);
        console.log(`Codigo: ${pin}`);
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
        console.warn("No se pudo enviar el correo del segundo paso:", error.message);
        throw error;
    }
}

module.exports = {
    sendTwoFactorCodeEmail,
    sendRegistrationVerificationEmail,
    sendPasswordResetEmail,
    sendSalaryAdvanceCodeEmail
};
