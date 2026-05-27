const {
    getBankCatalog,
    getServiceProviderCatalog
} = require("./base.model");

// Funcion: getCatalogs
// Aqui junto catalogos base en una sola respuesta para ahorrar llamadas al frontend.
async function getCatalogs() {
    const [banks, serviceProviders] = await Promise.all([
        getBankCatalog(),
        getServiceProviderCatalog()
    ]);

    return {
        banks,
        serviceProviders
    };
}

module.exports = {
    getCatalogs
};
