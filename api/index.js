// Punto de entrada serverless para Vercel: reutiliza el manejador de server.js.
const { handleRequest } = require("../server");

module.exports = (request, response) => handleRequest(request, response);
