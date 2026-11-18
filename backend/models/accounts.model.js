/**
 * Modulo: models/accounts.model.js
 *
 * Que hace: logica de negocio de las cuentas wallet (consulta y creacion de cuentas secundarias).
 * Como lo hace: combina validaciones con los DAOs (account.dao via base.model) y SQL propio dentro de
 *   transacciones (withTransaction).
 * Datos que participan: usuario autenticado, alias y moneda de la cuenta, tablas `cuentas` y `usuarios`,
 *   alertas del sistema.
 * Consultas SQL: ver detalle en cada funcion.
 */

const { withTransaction } = require("../db");
const {
    HttpError,
    cleanText,
    createAccountNumber,
    getAccounts,
    insertAlert
} = require("./base.model");

/**
 * Funcion: getAccountsCenter
 *
 * Que hace: devuelve el estado actual de las cuentas del usuario tal como lo consume la vista.
 * Como lo hace: delega la lectura en getAccounts (account.dao) y la envuelve en { accounts }.
 * Datos que participan: `userId`.
 * Consulta SQL: SELECT de saldos y estado FROM cuentas WHERE usuario_id = $1 (ver account.dao.getAccounts).
 * Retorna: { accounts: [...] }.
 */
async function getAccountsCenter(userId) {
    const accounts = await getAccounts(userId);
    return {
        accounts
    };
}

/**
 * Funcion: createSecondaryAccount
 *
 * Que hace: crea una wallet secundaria para el usuario y le avisa con una alerta.
 * Como lo hace: dentro de UNA transaccion (si algo falla se revierte todo): valida alias y moneda,
 * comprueba que el usuario exista, cuenta sus cuentas actuales para armar el numero
 * (WL-000123-26-02), inserta la cuenta con saldos en 0 y registra la alerta.
 * Datos que participan: `userId`, payload { alias (max 80), currency (solo USD, por defecto USD) }.
 * Consultas SQL:
 *
 *   1) SELECT id_usuario FROM usuarios WHERE id_usuario = $1 LIMIT 1: confirma que el usuario existe.
 *
 *   2) getAccounts(userId, client): cuantas cuentas tiene, para el consecutivo del numero.
 *
 *   3) INSERT INTO cuentas (...) VALUES (..., 'wallet_secundaria', moneda, 0, 0, 0, 0, FALSE, FALSE, 'activa')
 *      RETURNING id_cuenta: nace activa, sin saldo, sin limite, no principal y sin bono de bienvenida.
 *
 *   4) insertAlert(...): alerta de nivel "aceptacion" para el frontend.
 * Retorna: { message, accountId }. Lanza HttpError 400 (alias/moneda) o 404 (usuario).
 */
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
