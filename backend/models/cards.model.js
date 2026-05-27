const { withTransaction } = require("../db");
const {
    HttpError,
    cleanText,
    getAccounts,
    getBankCatalog,
    getCards,
    insertAlert
} = require("./base.model");

// Funcion: getCardsCenter
// Aqui preparo todo lo que necesita la seccion de tarjetas:
// cuentas activas, bancos disponibles y tarjetas ya vinculadas.
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

// Funcion: linkCard
// Aqui vinculo una tarjeta externa a una wallet valida del usuario.
// Primero valido datos sensibles y luego guardo la tarjeta dejando trazabilidad con alerta.
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
                cleanText(payload.alias, 80) || `${cleanText(payload.brand, 40)} terminada en ${last4}`,
                cleanText(payload.brand, 40) || "Tarjeta",
                cleanText(payload.cardType, 20) || "debito",
                last4,
                cleanText(payload.holderName, 120),
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
