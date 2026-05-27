const { withTransaction } = require("../db");
const {
    HttpError,
    cleanText,
    createAccountNumber,
    getAccounts,
    insertAlert
} = require("./base.model");

// Funcion: getAccountsCenter
// Aqui devuelvo el estado actual de las cuentas del usuario tal como lo consume la vista.
async function getAccountsCenter(userId) {
    const accounts = await getAccounts(userId);
    return {
        accounts
    };
}

// Funcion: createSecondaryAccount
// Aqui creo una wallet secundaria validando alias, moneda y existencia del usuario.
// Tambien genero el numero de cuenta y dejo una alerta para que el frontend lo refleje.
async function createSecondaryAccount(userId, payload) {
    return withTransaction(async (client) => {
        const alias = cleanText(payload.alias, 80);
        const currency = cleanText(payload.currency, 3).toUpperCase() || "USD";

        if (!alias) {
            throw new HttpError(400, "Ingresa un alias para la cuenta secundaria.");
        }

        if (!["USD"].includes(currency)) {
            throw new HttpError(400, "La moneda seleccionada no esta disponible.");
        }

        const userResult = await client.query(
            `
            SELECT id_usuario
            FROM usuarios
            WHERE id_usuario = $1
            LIMIT 1
            `,
            [userId]
        );

        if (!userResult.rows[0]) {
            throw new HttpError(404, "No encontramos al usuario de la cuenta.");
        }

        const currentAccounts = await getAccounts(userId, client);
        const accountNumber = `${createAccountNumber(userId)}-${String(currentAccounts.length + 1).padStart(2, "0")}`;

        const result = await client.query(
            `
            INSERT INTO cuentas (
                usuario_id,
                numero_cuenta,
                alias_cuenta,
                tipo_cuenta,
                moneda,
                saldo_disponible,
                saldo_retenido,
                saldo_contable,
                limite_diario,
                es_principal,
                bono_bienvenida_aplicado,
                estado
            )
            VALUES ($1, $2, $3, 'wallet_secundaria', $4, 0, 0, 0, 0, FALSE, FALSE, 'activa')
            RETURNING id_cuenta
            `,
            [userId, accountNumber, alias, currency]
        );

        await insertAlert(client, {
            userId,
            type: "sistema",
            title: "Cuenta secundaria creada",
            message: `Tu nueva cuenta ${alias} ya esta activa dentro de la wallet.`,
            level: "aceptacion"
        });

        return {
            message: "Cuenta secundaria creada correctamente.",
            accountId: Number(result.rows[0].id_cuenta)
        };
    });
}

module.exports = {
    getAccountsCenter,
    createSecondaryAccount
};
