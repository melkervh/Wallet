const { createPasswordHash } = require("../backend/auth");

const password = process.argv[2];

if (!password) {
    console.error("Uso: node scripts/hash-password.js <contrasena>");
    process.exit(1);
}

console.log(createPasswordHash(password));
