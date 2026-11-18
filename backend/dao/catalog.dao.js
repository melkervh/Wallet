/**
 * Modulo: dao/catalog.dao.js
 *
 * Que hace: acceso a datos de catalogos globales (bancos, proveedores de servicio) y al
 *           estado de arranque de la plataforma.
 * Como lo hace: SELECT sin filtro por usuario, porque son datos compartidos por todos.
 * Datos que participan: tablas `usuarios`, `catalogo_bancos` y `proveedores_servicio`.
 */

const { query } = require("../db");
const { mapBank, mapServiceProvider } = require("./mappers");

/**
 * Funcion: getBootstrapState
 *
 * Que hace: detecta si la plataforma ya tiene usuarios o si debe forzar el primer registro.
 * Como lo hace: cuenta las filas de `usuarios` y deriva dos banderas booleanas.
 * Datos que participan: ninguno de entrada; se lee el total global de usuarios.
 * Consulta SQL: SELECT COUNT(*) AS total FROM usuarios (llega como string, se pasa a Number).
 * Retorna: { totalUsers, hasUsers, requiresRegistration }.
 */
async function getBootstrapState(executor = { query }) {
    const result = await executor.query(
        `
        SELECT COUNT(*) AS total
        FROM usuarios
        `
    );

    const totalUsers = Number(result.rows[0]?.total || 0);
    return {
        totalUsers,
        hasUsers: totalUsers > 0,
        requiresRegistration: totalUsers === 0
    };
}

/**
 * Funcion: getBankCatalog
 *
 * Que hace: devuelve el catalogo de bancos visibles y activos.
 * Como lo hace: SELECT filtrado por activo y mapeado con mapBank.
 * Datos que participan: ninguno de entrada.
 * Consulta SQL: SELECT id_banco, nombre, codigo, tipo_entidad FROM catalogo_bancos
 *               WHERE activo = TRUE ORDER BY orden_visual ASC (orden definido por el negocio),
 *               nombre ASC (desempate alfabetico).
 * Retorna: arreglo de bancos.
 */
async function getBankCatalog(executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            id_banco,
            nombre,
            codigo,
            tipo_entidad
        FROM catalogo_bancos
        WHERE activo = TRUE
        ORDER BY orden_visual ASC, nombre ASC
        `
    );

    return result.rows.map(mapBank);
}

/**
 * Funcion: getServiceProviderCatalog
 *
 * Que hace: devuelve el catalogo de proveedores de servicios con su banco asociado.
 * Como lo hace: LEFT JOIN para no perder proveedores que no tienen banco, mapeado con
 *               mapServiceProvider.
 * Datos que participan: ninguno de entrada.
 * Consulta SQL: SELECT de `proveedores_servicio` (alias ps) LEFT JOIN `catalogo_bancos`
 *               (alias cb) ON cb.id_banco = ps.banco_id; trae cb.nombre como banco_nombre.
 *               WHERE ps.activo = TRUE ORDER BY categoria y luego nombre.
 * Retorna: arreglo de proveedores.
 */
async function getServiceProviderCatalog(executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            ps.id_proveedor,
            ps.nombre,
            ps.categoria,
            ps.referencia_recaudo,
            ps.descripcion,
            cb.nombre AS banco_nombre
        FROM proveedores_servicio ps
        LEFT JOIN catalogo_bancos cb
            ON cb.id_banco = ps.banco_id
        WHERE ps.activo = TRUE
        ORDER BY ps.categoria ASC, ps.nombre ASC
        `
    );

    return result.rows.map(mapServiceProvider);
}

module.exports = {
    getBootstrapState,
    getBankCatalog,
    getServiceProviderCatalog
};
