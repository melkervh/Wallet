const forexModel = require("../models/forex.model");

// Funcion: getLearningContent
// Aqui pido el contenido educativo y el contexto de mercado para el par elegido.
async function getLearningContent(query) {
    return forexModel.getForexLearningContent(query?.pair);
}

// Funcion: simulate
// Aqui delego la simulacion de escenario Forex usando los parametros del usuario.
async function simulate(payload) {
    return forexModel.simulateForexScenario(payload);
}

module.exports = {
    getLearningContent,
    simulate
};
