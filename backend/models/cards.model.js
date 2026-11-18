/**
 * Modulo: models/cards.model.js
 *
 * Que hace: logica de negocio de tarjetas vinculadas (consulta y alta).
 * Como lo hace: lecturas via DAOs (cuentas, bancos, tarjetas) y alta con validaciones y SQL propio en
 *   transaccion.
 * Datos que participan: tablas `tarjetas`, `cuentas`, `catalogo_bancos` y alertas del usuario.
 * Consultas SQL: ver detalle en cada funcion.
 */

const { withTransaction } = require("../db");
const {
    HttpError,
    cleanText,
    getAccounts,
    getBankCatalog,
    getCards,
    insertAlert
} = require("./base.model");

/**
 * Funcion: getCardsCenter
 *
 * Que hace: prepara todo lo que necesita la seccion de tarjetas.
 * Como lo hace: en paralelo trae cuentas, catalogo de bancos y tarjetas; luego deja solo las cuentas
 * con estado "activa" porque solo a esas se puede vincular una tarjeta.
 * Datos que participan: `userId`.
 * Consultas SQL: getAccounts, getBankCatalog y getCards (ver account.dao y catalog.dao).
 * Retorna: { accounts, banks, cards }.
 */
async function getCardsCenter(userId) {
    const [accounts, banks, cards] = await Promise.all([
        getAccounts(userId),
        getBankCatalog(),
        getCards(userId)
    ]);

    return {
        accounts: accounts.filter((account) => account.estado === "activa"),
        banks,
        cards
    };
}

/**
 * Funcion: linkCard
 *
 * Que hace: vincula una tarjeta externa a una wallet valida del usuario y deja alerta de trazabilidad.
 * Como lo hace: en UNA transaccion: normaliza y valida los datos, verifica que la cuenta sea del
 * usuario y este activa, verifica el banco, opcionalmente quita la marca de predeterminada a las
 * demas tarjetas de la cuenta, inserta la tarjeta y registra la alerta.
 * Datos que participan: `userId`, payload { accountId, bankId, last4, cardType|type, holderName,
 * brand, alias, dailyLimit, expiryMonth, expiryYear, makeDefault }. Solo se guardan los ultimos 4 digitos.
 * Consultas SQL:
 *
 *   1) SELECT id_cuenta, alias_cuenta, estado FROM cuentas WHERE id_cuenta = $1 AND usuario_id = $2:
 *      comprueba que la cuenta exista y pertenezca al usuario.
 *
 *   2) SELECT id_banco, nombre FROM catalogo_bancos WHERE id_banco = $1 AND activo = TRUE: banco disponible.
 *
 *   3) UPDATE tarjetas SET es_predeterminada = FALSE WHERE cuenta_id = $1 (solo si makeDefault).
 *
 *   4) INSERT INTO tarjetas (...) VALUES (..., 'activa', ...) RETURNING id_tarjeta.
 *
 *   5) insertAlert(...): alerta "Tarjeta vinculada".
 * Validaciones: cuenta y banco obligatorios, 4 digitos, mes 1-12, anio no pasado, tipo
 * debito/credito/prepago, titular y marca obligatorios.
 * Retorna: { message, cardId }. Lanza HttpError 400/404.
 */
async function linkCard(userId, payload) {
    return withTransaction(async (client) => {
        // Aqui valido primero la cuenta y el banco porque una tarjeta
        // vinculada solo tiene sentido si apunta a una wallet activa.
        const accountId = Number(payload.accountId);
        const bankId = Number(payload.bankId);
        const expiryMonth = Number(payload.expiryMonth);
        const expiryYear = Number(payload.expiryYear);
        const dailyLimit = Number(payload.dailyLimit || 0);
        const last4 = cleanText(payload.last4, 4).replace(/\D/g, "");
        const cardType = cleanText(payload.cardType || payload.type, 20).toLowerCase();
        const holderName = cleanText(payload.holderName, 120);
        const brand = cleanText(payload.brand, 40);

        if (!accountId || !bankId) {
            throw new HttpError(400, "Selecciona la cuenta y el banco de la tarjeta.");
        }

        if (last4.length !== 4) {
            throw new HttpError(400, "Ingresa los ultimos 4 digitos de la tarjeta.");
        }

        if (!expiryMonth || expiryMonth < 1 || expiryMonth > 12) {
            throw new HttpError(400, "El mes de vencimiento no es valido.");
        }

        if (!expiryYear || expiryYear < new Date().getFullYear()) {
            throw new HttpError(400, "El anio de vencimiento no es valido.");
        }

        if (!["debito", "credito", "prepago"].includes(cardType)) {
            throw new HttpError(400, "Selecciona un tipo de tarjeta valido.");
        }

        if (!holderName) {
            throw new HttpError(400, "Ingresa el nombre del titular de la tarjeta.");
        }

        if (!brand) {
            throw new HttpError(400, "Selecciona la marca de la tarjeta.");
        }

        const accountResult = await client.query(
            `
            SELECT id_cuenta, alias_cuenta, estado
            FROM cuentas
            WHERE id_cuenta = $1
              AND usuario_id = $2
            LIMIT 1
            `,
            [accountId, userId]
        );

        const account = accountResult.rows[0];
        if (!account) {
            throw new HttpError(404, "La cuenta seleccionada no existe.");
        }

        if (account.estado !== "activa") {
            throw new HttpError(400, "Solo puedes vincular tarjetas a cuentas activas.");
        }

        const bankResult = await client.query(
            `
            SELECT id_banco, nombre
            FROM catalogo_bancos
            WHERE id_banco = $1
              AND activo = TRUE
            LIMIT 1
            `,
            [bankId]
        );

        const bank = bankResult.rows[0];
        if (!bank) {
            throw new HttpError(404, "El banco seleccionado ya no esta disponible.");
        }

        if (payload.makeDefault) {
            await client.query(
                `
                UPDATE tarjetas
                SET
                    es_predeterminada = FALSE,
                    actualizado_en = NOW()
                WHERE cuenta_id = $1
                `,
                [accountId]
            );
        }

        const result = await client.query(
            `
            INSERT INTO tarjetas (
                cuenta_id,
                banco_id,
                alias_tarjeta,
                marca,
                tipo_tarjeta,
                ultimos_4,
                titular,
                limite_diario,
                estado,
                vence_mes,
                vence_anio,
                es_predeterminada
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activa', $9, $10, $11)
            RETURNING id_tarjeta
            `,
            [
                accountId,
                bankId,
                cleanText(payload.alias, 80) || `${brand} terminada en ${last4}`,
                brand || "Tarjeta",
                cardType,
                last4,
                holderName,
                Number.isFinite(dailyLimit) ? dailyLimit : 0,
                expiryMonth,
                expiryYear,
                Boolean(payload.makeDefault)
            ]
        );

        await insertAlert(client, {
            userId,
            type: "sistema",
            title: "Tarjeta vinculada",
            message: `Se vinculo una tarjeta ${bank.nombre} terminada en ${last4} a ${account.alias_cuenta}.`,
            level: "aceptacion"
        });

        return {
            message: "Tarjeta vinculada correctamente.",
            cardId: result.rows[0].id_tarjeta
        };
    });
}

module.exports = {
    getCardsCenter,
    linkCard
};
