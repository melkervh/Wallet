/**
 * Modulo: dao/user.dao.js
 *
 * Que hace: acceso a datos de la entidad usuario (tablas `usuarios` y `usuarios_credenciales`).
 * Como lo hace: cada funcion recibe un `executor` (por defecto el pool, o un `client` de
 *               transaccion) y ejecuta SQL parametrizado con `$1, $2...` para evitar
 *               inyeccion SQL.
 * Datos que participan: id de usuario, correo, telefono y documento de identidad.
 * Consultas SQL: ver el detalle en cada funcion.
 */

const { query } = require("../db");
const { mapUser } = require("./mappers");

/**
 * Funcion: getUserById
 *
 * Que hace: recupera al usuario con sus datos de seguridad y estado actual.
 * Como lo hace: ejecuta un SELECT con JOIN y mapea la primera fila con mapUser.
 * Datos que participan: `userId` (parametro $1), `executor` (pool o client de transaccion).
 * Consulta SQL:
 *   - SELECT de datos personales desde `usuarios` (alias u).
 *   - JOIN con `usuarios_credenciales` (alias uc) por uc.usuario_id = u.id_usuario, para traer
 *     doble factor, ultimo login, ultimo cambio de password e intentos fallidos.
 *   - WHERE u.id_usuario = $1 filtra al usuario; LIMIT 1 porque la clave es unica.
 * Retorna: objeto usuario mapeado, o null si no existe.
 */
async function getUserById(userId, executor = { query }) {
    const result = await executor.query(
        `
        SELECT
            u.id_usuario,
            u.nombres,
            u.apellidos,
            u.correo,
            u.telefono,
            u.fecha_nacimiento,
            u.documento_identidad,
            u.direccion,
            u.foto_perfil_archivo,
            u.estado,
            uc.doble_factor_activo,
            uc.ultimo_login_exitoso,
            uc.ultimo_cambio_password,
            uc.intentos_fallidos
        FROM usuarios u
        JOIN usuarios_credenciales uc
            ON uc.usuario_id = u.id_usuario
        WHERE u.id_usuario = $1
        LIMIT 1
        `,
        [userId]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
}

/**
 * Funcion: findDuplicatedIdentity
 *
 * Que hace: busca otro usuario que ya use el mismo correo, telefono o DUI.
 * Como lo hace: ejecuta un SELECT con tres condiciones unidas por OR y devuelve la primera
 *               fila coincidente. La decision de que error lanzar queda en la capa de
 *               negocio (base.model.ensureUniqueUserIdentityData).
 * Datos que participan:
 *   - $1 `email`: correo ya normalizado (minusculas).
 *   - $2 `phoneDigits`: telefono solo con digitos ("" si no se evalua).
 *   - $3 `dui`: DUI normalizado ("" si no se evalua).
 *   - $4 `excludeUserId`: id a ignorar (0 = no excluir nadie); sirve al editar el perfil.
 * Consulta SQL:
 *   - `($4::BIGINT = 0 OR id_usuario <> $4)` excluye al propio usuario cuando se edita.
 *   - `LOWER(correo) = $1` compara correos sin importar mayusculas.
 *   - `REGEXP_REPLACE(telefono, '[^0-9]', '', 'g') = $2` quita simbolos/espacios del
 *     telefono guardado para comparar solo digitos; se omite si $2 es "".
 *   - `documento_identidad = $3` compara DUI exacto; se omite si $3 es "".
 *   - ORDER BY id_usuario ASC + LIMIT 1 devuelve de forma determinista el primer conflicto.
 * Retorna: fila cruda {id_usuario, correo, telefono, documento_identidad} o undefined.
 */
async function findDuplicatedIdentity(executor, { email, phoneDigits, dui, excludeUserId = 0 }) {
    const result = await executor.query(
        `
        SELECT
            id_usuario,
            correo,
            telefono,
            documento_identidad
        FROM usuarios
        WHERE ($4::BIGINT = 0 OR id_usuario <> $4)
          AND (
              LOWER(correo) = $1
              OR ($2 <> '' AND REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '', 'g') = $2)
              OR ($3 <> '' AND documento_identidad = $3)
          )
        ORDER BY id_usuario ASC
        LIMIT 1
        `,
        [email, phoneDigits, dui, Number(excludeUserId || 0)]
    );

    return result.rows[0];
}

module.exports = {
    getUserById,
    findDuplicatedIdentity
};
