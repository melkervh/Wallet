/**
 * Modulo: scripts/hash-password.js
 *
 * Que hace: utilidad de linea de comandos que genera el hash scrypt de una contrasena, util para insertar un
 *   usuario manualmente en la base.
 * Como lo hace: lee la contrasena de process.argv[2], llama a createPasswordHash (backend/auth.js) e imprime
 *   'scrypt$salt$hash'. Sin argumento muestra el uso y termina con codigo 1. Se ejecuta con: npm run
 *   hash:password -- <contrasena>
 * Datos que participan: la contrasena recibida por argumento (no se guarda en ningun sitio).
 * Consultas SQL: ninguna.
 */

const { createPasswordHash } = require("../backend/auth");

const password = process.argv[2];

if (!password) {
    console.error("Uso: node scripts/hash-password.js <contrasena>");
    process.exit(1);
}

console.log(createPasswordHash(password));
