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

// Funcion: createStoredProfileImageName
// Aqui genero un nombre de archivo controlado para evitar choques y nombres inseguros.
function createStoredProfileImageName(userId, extension) {
    return `perfil-${userId}-${Date.now()}${extension}`;
}

// Funcion: resolveProfileImagePath
// Aqui resuelvo la ruta fisica de la imagen usando basename para no aceptar rutas arbitrarias.
function resolveProfileImagePath(fileName) {
    const safeName = path.basename(String(fileName || ""));
    return path.join(profileImagesDirectory, safeName);
}

// Funcion: ensureProfileImagesDirectory
// Aqui me aseguro de que la carpeta de imagenes exista antes de escribir archivos.
async function ensureProfileImagesDirectory() {
    await fs.mkdir(profileImagesDirectory, { recursive: true });
}

// Funcion: deleteStoredProfileImage
// Aqui elimino una imagen vieja sin fallar si ya no existe en disco.
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

// Funcion: parseProfileImageDataUrl
// Aqui valido y decodifico la imagen enviada desde frontend en formato data URL.
// Solo acepto tipos concretos y limito el tamano para evitar cargas inesperadas.
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

// Funcion: mapAccessLog
// Aqui adapto los accesos recientes al formato legible que muestra el perfil.
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

// Funcion: getRecentAccessLogs
// Aqui leo una muestra corta de accesos para no sobrecargar el perfil.
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

// Funcion: getProfile
// Aqui construyo el perfil completo combinando datos del usuario y su bitacora reciente.
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

// Funcion: updateProfile
// Aqui actualizo datos personales y manejo de forma segura el reemplazo de foto.
// Mantengo el archivo nuevo y el viejo coordinados para no dejar basura en disco.
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
