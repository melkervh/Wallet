const { Pool } = require("pg");
const { config } = require("./env");

const pool = new Pool(config.database);

// Funcion: query
// Aqui expongo una consulta simple reutilizable sobre el pool compartido.
async function query(text, params = []) {
    return pool.query(text, params);
}

// Funcion: withTransaction
// Aqui envuelvo una operacion completa en BEGIN/COMMIT/ROLLBACK.
// Lo hago para que los cambios relacionados queden consistentes si algo falla.
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

// Funcion: healthCheck
// Aqui pruebo la conexion con PostgreSQL con la consulta minima posible.
async function healthCheck() {
    await query("SELECT 1");
}

module.exports = {
    pool,
    query,
    withTransaction,
    healthCheck
};
