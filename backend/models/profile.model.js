/**
 * Modulo: models/profile.model.js
 *
 * Que hace: logica de negocio del perfil del usuario: lectura con bitacora de accesos y actualizacion de datos
 *   personales y foto.
 * Como lo hace: lecturas con user.dao (via base.model) y SQL propio; la actualizacion corre en una transaccion
 *   y coordina el archivo de imagen en disco con la base de datos para no dejar archivos huerfanos.
 * Datos que participan: tablas `usuarios` y `accesos_usuario`; carpeta recursos/imagenes/perfiles; imagenes
 *   JPG, PNG o WEBP de hasta 5 MB.
 * Consultas SQL: ver detalle en cada funcion.
 */

const fs = require("fs/promises");
const path = require("path");
const { query, withTransaction } = require("../db");
const {
    HttpError,
    ensureHumanName,
    ensurePhoneNumber,
    ensureBirthDateIsAdult,
    ensureDui,
    ensureAddressText,
    ensureUniqueUserIdentityData,
    buildProfileImageUrl,
    getUserById
} = require("./base.model");

const profileImagesDirectory = path.join(process.cwd(), "recursos", "imagenes", "perfiles");
const allowedMimeTypes = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
};

/**
 * Funcion: createStoredProfileImageName
 *
 * Que hace: genera un nombre de archivo controlado para evitar choques y nombres inseguros.
 * Como lo hace: arma perfil-{userId}-{timestamp}{extension}; el timestamp hace que cada foto sea unica.
 * Datos que participan: `userId`, `extension` (.jpg, .png o .webp).
 * Consultas SQL: ninguna.
 * Retorna: string con el nombre de archivo.
 */
function createStoredProfileImageName(userId, extension) {
    return `perfil-${userId}-${Date.now()}${extension}`;
}

/**
 * Funcion: resolveProfileImagePath
 *
 * Que hace: resuelve la ruta fisica de la imagen sin aceptar rutas arbitrarias.
 * Como lo hace: aplica path.basename al nombre (descarta cualquier carpeta o ../) y lo une a la carpeta de
 *   perfiles.
 * Datos que participan: `fileName`.
 * Consultas SQL: ninguna.
 * Retorna: ruta absoluta.
 */
function resolveProfileImagePath(fileName) {
    const safeName = path.basename(String(fileName || ""));
    return path.join(profileImagesDirectory, safeName);
}

/**
 * Funcion: ensureProfileImagesDirectory
 *
 * Que hace: asegura que la carpeta de imagenes exista antes de escribir archivos.
 * Como lo hace: fs.mkdir con recursive: true (no falla si ya existe).
 * Datos que participan: carpeta recursos/imagenes/perfiles.
 * Consultas SQL: ninguna.
 * Retorna: nada.
 */
async function ensureProfileImagesDirectory() {
    await fs.mkdir(profileImagesDirectory, { recursive: true });
}

/**
 * Funcion: deleteStoredProfileImage
 *
 * Que hace: elimina una imagen vieja sin fallar si ya no existe en disco.
 * Como lo hace: fs.unlink y se ignora el error ENOENT; cualquier otro error se relanza.
 * Datos que participan: `fileName`.
 * Consultas SQL: ninguna.
 * Retorna: nada.
 */
async function deleteStoredProfileImage(fileName) {
    if (!fileName) {
        return;
    }

    try {
        await fs.unlink(resolveProfileImagePath(fileName));
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
}

/**
 * Funcion: parseProfileImageDataUrl
 *
 * Que hace: valida y decodifica la imagen enviada por el frontend en formato data URL.
 * Como lo hace: una expresion regular exige data:image/(jpeg|png|webp);base64,...; se decodifica a Buffer, se
 *   confirma que no este vacia y que no supere 5 MB.
 * Datos que participan: `dataUrl`.
 * Consultas SQL: ninguna.
 * Retorna: { extension, buffer } o HttpError 400.
 */
function parseProfileImageDataUrl(dataUrl) {
    const normalizedDataUrl = String(dataUrl || "");
    const match = normalizedDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);

    if (!match) {
        throw new HttpError(400, "La imagen de perfil debe ser JPG, PNG o WEBP.");
    }

    const mimeType = match[1];
    const extension = allowedMimeTypes[mimeType];
    const buffer = Buffer.from(match[2], "base64");

    if (!extension || !buffer.length) {
        throw new HttpError(400, "La imagen de perfil no es valida.");
    }

    if (buffer.length > 5 * 1024 * 1024) {
        throw new HttpError(400, "La imagen de perfil supera el limite de 5 MB.");
    }

    return {
        extension,
        buffer
    };
}

/**
 * Funcion: mapAccessLog
 *
 * Que hace: adapta los accesos recientes al formato legible del perfil.
 * Como lo hace: formatea la fecha con toLocaleString('es-SV') y pone textos por defecto (Sin IP, Desconocido).
 * Datos que participan: fila de `accesos_usuario` (id_acceso, fecha_acceso, direccion_ip, dispositivo,
 *   navegador, resultado, detalle).
 * Consultas SQL: ninguna.
 * Retorna: objeto de acceso.
 */
function mapAccessLog(row) {
    return {
        id: row.id_acceso,
        fecha: new Date(row.fecha_acceso).toLocaleString("es-SV"),
        direccionIp: row.direccion_ip || "Sin IP",
        dispositivo: row.dispositivo || "Desconocido",
        navegador: row.navegador || "Desconocido",
        resultado: row.resultado,
        detalle: row.detalle || ""
    };
}

/**
 * Funcion: getRecentAccessLogs
 *
 * Que hace: lee una muestra corta de accesos para no sobrecargar el perfil.
 * Como lo hace: SELECT ordenado por fecha descendente limitado a 8 filas y mapeado con mapAccessLog.
 * Datos que participan: `userId` ($1).
 * Consultas SQL: SELECT id_acceso, fecha_acceso, direccion_ip, dispositivo, navegador, resultado, detalle FROM
 *   accesos_usuario WHERE usuario_id = $1 ORDER BY fecha_acceso DESC LIMIT 8.
 * Retorna: arreglo de accesos.
 */
async function getRecentAccessLogs(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_acceso,
            fecha_acceso,
            direccion_ip,
            dispositivo,
            navegador,
            resultado,
            detalle
        FROM accesos_usuario
        WHERE usuario_id = $1
        ORDER BY fecha_acceso DESC
        LIMIT 8
        `,
        [userId]
    );

    return result.rows.map(mapAccessLog);
}

/**
 * Funcion: getProfile
 *
 * Que hace: construye el perfil completo combinando datos del usuario y su bitacora reciente.
 * Como lo hace: Promise.all entre getUserById y getRecentAccessLogs; si el usuario no existe lanza 404.
 * Datos que participan: `userId`, `executor`.
 * Consultas SQL: las de user.dao.getUserById (JOIN usuarios + usuarios_credenciales) y getRecentAccessLogs.
 * Retorna: { profile, recentAccessLogs }.
 */
async function getProfile(userId, executor = { query }) {
    const [profile, recentAccessLogs] = await Promise.all([
        getUserById(userId, executor),
        getRecentAccessLogs(userId, executor)
    ]);

    if (!profile) {
        throw new HttpError(404, "No fue posible cargar tu perfil.");
    }

    return {
        profile,
        recentAccessLogs
    };
}

/**
 * Funcion: updateProfile
 *
 * Que hace: actualiza datos personales y reemplaza la foto de forma segura.
 * Como lo hace: en una transaccion bloquea la fila del usuario, valida todos los campos, comprueba que
 *   telefono y DUI no pertenezcan a otra cuenta, guarda la foto nueva en disco si viene y hace el UPDATE. Si la
 *   transaccion tiene exito borra la foto anterior; si falla borra la foto nueva recien escrita, asi disco y
 *   base quedan coordinados.
 * Datos que participan: `userId`, payload { firstName, lastName, phone, birthDate, documentId, address,
 *   removePhoto, photoDataUrl }.
 * Consultas SQL:
 *   1) SELECT id_usuario, nombres, apellidos, telefono, fecha_nacimiento, documento_identidad, direccion,
 *      foto_perfil_archivo FROM usuarios WHERE id_usuario = $1 LIMIT 1 FOR UPDATE: lee el estado actual y bloquea
 *      la fila.
 *   2) ensureUniqueUserIdentityData (SELECT de duplicados, excluyendo al propio usuario).
 *   3) UPDATE usuarios SET nombres, apellidos, telefono, fecha_nacimiento, documento_identidad, direccion,
 *      foto_perfil_archivo = NULLIF($7, ''), actualizado_en = NOW() WHERE id_usuario = $8: NULLIF convierte '' en
 *      NULL para quitar la foto.
 *   4) getUserById y getRecentAccessLogs para devolver el perfil ya actualizado.
 * Retorna: { message, profile, recentAccessLogs }. Errores 400/404/409.
 */
async function updateProfile(userId, payload) {
    let newStoredPhotoFileName = "";

    try {
        const result = await withTransaction(async (client) => {
            const currentUserResult = await client.query(
                `
                SELECT
                    id_usuario,
                    nombres,
                    apellidos,
                    telefono,
                    fecha_nacimiento,
                    documento_identidad,
                    direccion,
                    foto_perfil_archivo
                FROM usuarios
                WHERE id_usuario = $1
                LIMIT 1
                FOR UPDATE
                `,
                [userId]
            );

            const currentUser = currentUserResult.rows[0];
            if (!currentUser) {
                throw new HttpError(404, "No fue posible actualizar el perfil.");
            }

            const firstName = ensureHumanName(payload.firstName, "los nombres", 80);
            const lastName = ensureHumanName(payload.lastName, "los apellidos", 80);
            const nextPhone = payload.phone ? ensurePhoneNumber(payload.phone) : null;
            const nextBirthDate = payload.birthDate ? ensureBirthDateIsAdult(payload.birthDate, false) : null;
            const nextDocumentId = ensureDui(payload.documentId);
            const nextAddress = ensureAddressText(payload.address, true);

            // Aqui corto choques de identidad cuando el usuario cambia telefono o documento.
            // Excluyo al mismo usuario para permitir que conserve sus datos actuales sin falsos positivos.
            await ensureUniqueUserIdentityData(client, {
                email: currentUser.correo,
                phone: nextPhone,
                documentId: nextDocumentId,
                excludeUserId: userId
            });

            let nextPhotoFileName = currentUser.foto_perfil_archivo || "";

            if (payload.removePhoto) {
                nextPhotoFileName = "";
            }

            if (payload.photoDataUrl) {
                const image = parseProfileImageDataUrl(payload.photoDataUrl);
                await ensureProfileImagesDirectory();

                nextPhotoFileName = createStoredProfileImageName(userId, image.extension);
                newStoredPhotoFileName = nextPhotoFileName;
                await fs.writeFile(resolveProfileImagePath(nextPhotoFileName), image.buffer);
            }

            await client.query(
                `
                UPDATE usuarios
                SET
                    nombres = $1,
                    apellidos = $2,
                    telefono = $3,
                    fecha_nacimiento = $4,
                    documento_identidad = $5,
                    direccion = $6,
                    foto_perfil_archivo = NULLIF($7, ''),
                    actualizado_en = NOW()
                WHERE id_usuario = $8
                `,
                [
                    firstName,
                    lastName,
                    nextPhone,
                    nextBirthDate || null,
                    nextDocumentId || null,
                    nextAddress || null,
                    nextPhotoFileName,
                    userId
                ]
            );

            const [profile, recentAccessLogs] = await Promise.all([
                getUserById(userId, client),
                getRecentAccessLogs(userId, client)
            ]);

            return {
                message: "Perfil actualizado correctamente.",
                previousPhotoFileName:
                    currentUser.foto_perfil_archivo && currentUser.foto_perfil_archivo !== nextPhotoFileName
                        ? currentUser.foto_perfil_archivo
                        : "",
                profile: {
                    ...profile,
                    fotoPerfilUrl: buildProfileImageUrl(profile.fotoPerfilArchivo)
                },
                recentAccessLogs
            };
        });

        if (result.previousPhotoFileName) {
            await deleteStoredProfileImage(result.previousPhotoFileName);
        }

        return {
            message: result.message,
            profile: result.profile,
            recentAccessLogs: result.recentAccessLogs
        };
    } catch (error) {
        if (newStoredPhotoFileName) {
            await deleteStoredProfileImage(newStoredPhotoFileName);
        }

        throw error;
    }
}

module.exports = {
    getProfile,
    updateProfile
};
