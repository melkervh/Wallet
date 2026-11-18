/**
 * Modulo: models/dashboard.model.js
 *
 * Que hace: arma el dashboard principal del usuario.
 * Como lo hace: consulta varios DAOs en paralelo y calcula totales en memoria.
 * Datos que participan: usuario, cuentas, beneficiarios, tarjetas, pagos programados, alertas,
 * adelanto salarial activo y movimientos.
 * Consultas SQL: las de los DAOs (user, account, beneficiary, alert, salary-advance y movement).
 */

const {
    HttpError,
    getUserById,
    getAccounts,
    getFavoriteBeneficiaries,
    getCards,
    getPayments,
    getAlerts,
    getActiveSalaryAdvance,
    getMonthlySummary,
    getMovements
} = require("./base.model");

/**
 * Funcion: getDashboard
 *
 * Que hace: arma el dashboard principal mezclando resumen financiero, seguridad, favoritos,
 * pagos, alertas y movimientos recientes.
 * Como lo hace: Promise.all con 9 lecturas independientes (una sola espera en lugar de nueve).
 * Luego suma con reduce los saldos disponible/retenido/contable de todas las cuentas, elige la
 * cuenta principal (o la primera), toma el pago mas proximo y separa pagos programados de
 * suscripciones segun `categoria`.
 * Datos que participan: `userId`; limites: 8 favoritos, 8 pagos, 6 alertas, 8 movimientos.
 * Consultas SQL: getUserById, getAccounts, getFavoriteBeneficiaries, getCards, getPayments, getAlerts,
 * getMonthlySummary, getMovements y getActiveSalaryAdvance (ver carpeta dao).
 * Retorna: { user, summary, accounts, favoriteBeneficiaries, cards, scheduledPayments, subscriptions,
 * alerts, recentMovements }. Lanza 401 si el usuario ya no existe.
 */
async function getDashboard(userId) {
    const [user, accounts, favorites, cards, payments, alerts, summary, recentMovements, activeSalaryAdvance] = await Promise.all([
        getUserById(userId),
        getAccounts(userId),
        getFavoriteBeneficiaries(userId, 8),
        getCards(userId),
        getPayments(userId, 8),
        getAlerts(userId, 6),
        getMonthlySummary(userId),
        getMovements(userId, { limit: 8 }),
        getActiveSalaryAdvance(userId)
    ]);

    if (!user) {
        throw new HttpError(401, "No se encontro la sesion activa.");
    }

    const saldoDisponibleTotal = accounts.reduce((sum, account) => sum + account.saldoDisponible, 0);
    const saldoRetenidoTotal = accounts.reduce((sum, account) => sum + account.saldoRetenido, 0);
    const saldoContableTotal = accounts.reduce((sum, account) => sum + account.saldoContable, 0);
    const cuentaPrincipal = accounts.find((account) => account.esPrincipal) || accounts[0] || null;
    const proximoPago = payments[0] || null;

    return {
        user,
        summary: {
            saldoDisponibleTotal,
            saldoRetenidoTotal,
            saldoContableTotal,
            proximoPago,
            adelantoActivo: activeSalaryAdvance,
            monthly: summary,
            seguridad: {
                dobleFactorActivo: user.dobleFactorActivo,
                ultimoLoginExitoso: user.ultimoLoginExitoso,
                ultimoCambioPassword: user.ultimoCambioPassword,
                intentosFallidos: user.intentosFallidos
            },
            cuentaPrincipal
        },
        accounts,
        favoriteBeneficiaries: favorites.filter((beneficiary) => beneficiary.esFavorito),
        cards,
        scheduledPayments: payments.filter((payment) => payment.categoria !== "suscripcion"),
        subscriptions: payments.filter((payment) => payment.categoria === "suscripcion"),
        alerts,
        recentMovements
    };
}

module.exports = {
    getDashboard,
    getMovements
};
