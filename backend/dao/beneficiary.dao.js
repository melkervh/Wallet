/**
 * Modulo: dao/beneficiary.dao.js
 *
 * Que hace: acceso a datos de beneficiarios (destinatarios guardados de transferencias).
 * Como lo hace: SQL parametrizado; las escrituras usan el `client` de la transaccion de
 *               la operacion que las invoca.
 * Datos que participan: tabla `beneficiarios`.
 */

const { query } = require("../db");
const HttpError = require("../http-error");
const { mapBeneficiary } = require("./mappers");

/**
 * Funcion: cleanText (local)
 *
 * Que hace: recorta espacios y limita la longitud de un texto.
 * Como lo hace: String(value || "").trim() y slice(0, maxLength) si se indica un maximo.
 * Datos que participan: `value` (texto del formulario) y `maxLength`.
 * Retorna: string limpio.
 */
function cleanText(value, maxLength) {
    const text = String(value || "").trim();
    return maxLength ? text.slice(0, maxLength) : text;
}

/**
 * Funcion: getFavoriteBeneficiaries
 *
 * Que hace: consulta beneficiarios activos priorizando favoritos y actividad reciente.
 * Como lo hace: SELECT filtrado y ordenado, mapeado con mapBeneficiary.
 * Datos que participan: `userId` ($1), `limit` ($2, por defecto 10).
 * Consulta SQL: SELECT FROM beneficiarios WHERE usuario_id = $1 AND activo = TRUE
 *               ORDER BY es_favorito DESC (favoritos primero), actualizado_en DESC LIMIT $2.
 * Retorna: arreglo de beneficiarios.
 */
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

/**
 * Funcion: insertOrUpdateBeneficiary
 *
 * Que hace: reutiliza o crea un beneficiario segun el contexto de la operacion.
 * Como lo hace: tiene dos caminos.
 *   1) Con `payload.beneficiaryId`: lo busca (debe ser del usuario y estar activo); si no
 *      existe lanza 404; si se pidio guardarlo como favorito y no lo era, lo actualiza.
 *   2) Sin id: valida nombre, banco y cuenta, detecta si ya existia esa cuenta para el
 *      usuario y hace un UPSERT.
 * Datos que participan: `userId`, `payload` {beneficiaryId, recipientName, recipientAlias,
 *                       destinationBank, destinationAccount, destinationType,
 *                       notificationEmail, notificationPhone, saveFavorite}.
 * Consulta SQL:
 *   - SELECT por id_beneficiario + usuario_id + activo (evita tocar beneficiarios ajenos).
 *   - UPDATE ... SET es_favorito = TRUE ... RETURNING: marca favorito y devuelve la fila.
 *   - SELECT por (usuario_id, numero_cuenta_destino) para saber si ya existia.
 *   - INSERT ... ON CONFLICT (usuario_id, numero_cuenta_destino) DO UPDATE: si la cuenta ya
 *     esta guardada, actualiza nombre, banco y tipo; conserva alias/correo/telefono previos
 *     con COALESCE si el nuevo viene vacio; es_favorito se queda en TRUE si ya lo era
 *     (OR); reactiva con activo = TRUE; RETURNING devuelve la fila resultante.
 * Retorna: beneficiario mapeado mas {existedBefore, favoriteAddedNow}.
 */
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
    getFavoriteBeneficiaries,
    insertOrUpdateBeneficiary
};
