/**
 * Modulo: db.js
 *
 * Que hace: administra la conexion con PostgreSQL.
 * Como lo hace: crea un unico Pool de `pg` con la configuracion de env.js y expone consultas simples y
 *   transacciones.
 * Datos que participan: config.database (host, puerto, base, usuario, clave o DATABASE_URL).
 * Consultas SQL: SELECT 1 (healthCheck) y BEGIN/COMMIT/ROLLBACK (withTransaction).
 */

const { Pool } = require("pg");
const { config } = require("./env");

const pool = new Pool(config.database);

/**
 * Funcion: query
 *
 * Que hace: expone una consulta simple reutilizable sobre el pool compartido.
 * Como lo hace: delega en pool.query, que toma una conexion libre, ejecuta y la devuelve al pool.
 * Datos que participan: `text` (SQL con $1, $2...) y `params`.
 * Consultas SQL: la que reciba.
 * Retorna: resultado de pg ({ rows, rowCount }).
 */
async function query(text, params = []) {
    return pool.query(text, params);
}

/**
 * Funcion: withTransaction
 *
 * Que hace: envuelve una operacion completa en BEGIN/COMMIT/ROLLBACK.
 * Como lo hace: toma un client dedicado, ejecuta BEGIN, corre el callback con ese client, hace COMMIT si todo
 *   salio bien o ROLLBACK si hubo error (relanzandolo) y siempre libera el client en finally.
 * Datos que participan: `callback(client)`: funcion con las consultas relacionadas.
 * Consultas SQL: BEGIN, las del callback, COMMIT o ROLLBACK.
 * Retorna: lo que retorne el callback.
 */
async function withTransaction(callback) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("No se pudo hacer rollback:", rollbackError);
        }

        throw error;
    } finally {
        client.release();
    }
}

/**
 * Funcion: healthCheck
 *
 * Que hace: prueba la conexion con PostgreSQL con la consulta minima posible.
 * Como lo hace: ejecuta SELECT 1; si falla, la excepcion sube al llamador.
 * Datos que participan: ninguno.
 * Consultas SQL: SELECT 1.
 * Retorna: nada.
 */
async function healthCheck() {
    await query("SELECT 1");
}

module.exports = {
    pool,
    query,
    withTransaction,
    healthCheck
};
