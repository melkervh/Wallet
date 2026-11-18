/**
 * Modulo: models/forex.model.js
 *
 * Que hace: contenido educativo de Forex y simulador de escenarios, apoyados en datos reales de mercado.
 * Como lo hace: mezcla un plan de estudio fijo (builtInCurriculum) con el historial de 90 dias del Banco
 *   Central Europeo (BCE, XML publico). Si el BCE no responde usa una serie de respaldo para que la seccion siga
 *   funcionando.
 * Datos que participan: par de divisas (EURUSD, GBPUSD, EURGBP, USDJPY), tasas del BCE (EUR como pivote),
 *   capital, porcentaje de riesgo y direccion (buy/sell) del simulador.
 * Consultas SQL: ninguna; este modulo no usa la base de datos.
 */

const { HttpError } = require("./base.model");

const ECB_HISTORY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

// Este archivo mezcla dos piezas:
// contenido educativo fijo para la ruta de aprendizaje
// y datos de mercado para enriquecer lectura y simulacion.
const builtInCurriculum = [
    {
        id: "fx-1",
        nivel: 1,
        duracionMinutos: 12,
        titulo: "Mapa base del mercado Forex",
        descripcion: "En este primer bloque explico como leer un par, que significa base y cotizada, y por que cada movimiento pequeno importa cuando se convierte en una decision real.",
        objetivo: "Entender el idioma minimo del mercado antes de entrar a una simulacion.",
        logro: "Ya sabes leer pares, precios y sentido de compra o venta.",
        bloques: [
            {
                titulo: "Como se arma un par",
                contenido: "EUR/USD compara al euro contra el dolar. Si el precio sube, el euro gana fuerza relativa; si cae, el dolar esta dominando el cruce."
            },
            {
                titulo: "Pip, spread y ejecucion",
                contenido: "El pip mide micro cambios de precio, el spread es el costo de entrada y salida, y ambos determinan si una operacion pequeña realmente vale la pena."
            },
            {
                titulo: "Lectura practica",
                contenido: "Antes de pensar en ganar, primero observo si el precio esta expandiendo, corrigiendo o simplemente lateral. Esa lectura evita operaciones impulsivas."
            }
        ],
        checklist: [
            "Identificar moneda base y moneda cotizada.",
            "Reconocer si comprar el par implica fortaleza de la moneda base.",
            "Diferenciar entre precio, spread y costo operativo."
        ],
        preguntas: [
            {
                id: "fx-1-q1",
                pregunta: "Si compras EUR/USD, que escenario estas buscando?",
                opciones: [
                    "Que el euro suba frente al dolar",
                    "Que el dolar suba frente al euro",
                    "Que ambas monedas queden iguales"
                ],
                correcta: 0,
                explicacion: "Comprar el par significa esperar fortaleza de la moneda base, en este caso el euro."
            },
            {
                id: "fx-1-q2",
                pregunta: "Que representa la segunda moneda del par?",
                opciones: [
                    "La moneda cotizada",
                    "La moneda base",
                    "La comision del broker"
                ],
                correcta: 0,
                explicacion: "La segunda moneda es la cotizada y te dice cuanto pagas por una unidad de la base."
            },
            {
                id: "fx-1-q3",
                pregunta: "Por que el spread importa antes de abrir una operacion?",
                opciones: [
                    "Porque define el costo minimo de entrada y salida",
                    "Porque mueve la tendencia principal",
                    "Porque reemplaza el stop loss"
                ],
                correcta: 0,
                explicacion: "Aunque la idea sea buena, un spread alto puede volver ineficiente una entrada."
            }
        ]
    },
    {
        id: "fx-2",
        nivel: 1,
        duracionMinutos: 14,
        titulo: "Liquidez, sesiones y ritmo del precio",
        descripcion: "Aqui conecto el movimiento del mercado con las horas en las que realmente entra liquidez. No todos los pares se comportan igual durante Asia, Londres o Nueva York.",
        objetivo: "Relacionar volatilidad y horario para dejar de operar en momentos muertos.",
        logro: "Ya puedes ubicar cuando el mercado suele moverse con mas intencion.",
        bloques: [
            {
                titulo: "Sesion asiatica",
                contenido: "Suele tener movimientos mas contenidos en pares europeos, pero puede ser clave para USD/JPY y cruces ligados a Asia."
            },
            {
                titulo: "Cruce Londres-Nueva York",
                contenido: "Es la zona mas activa del dia para muchos pares mayores. Aqui aparecen rupturas, aceleraciones y barridos con mas frecuencia."
            },
            {
                titulo: "Elegir el par correcto",
                contenido: "EUR/USD y GBP/USD suelen respirar mejor en horas europeas y americanas, mientras USD/JPY puede reaccionar distinto por el componente asiatico."
            }
        ],
        checklist: [
            "Reconocer la sesion mas activa para el par elegido.",
            "Evitar abrir operaciones solo por aburrimiento en zonas lentas.",
            "Relacionar volatilidad con la agenda del dia."
        ],
        preguntas: [
            {
                id: "fx-2-q1",
                pregunta: "En que tramo suele concentrarse mas liquidez para pares mayores?",
                opciones: [
                    "Cruce entre Londres y Nueva York",
                    "Ultima hora del sabado",
                    "Madrugada sin mercado abierto"
                ],
                correcta: 0,
                explicacion: "Cuando Londres y Nueva York coinciden suele entrar la mayor actividad institucional."
            },
            {
                id: "fx-2-q2",
                pregunta: "Que riesgo tiene operar una sesion muy lenta?",
                opciones: [
                    "Que el mercado no tenga suficiente intencion y se vuelva erratico",
                    "Que el spread desaparezca por completo",
                    "Que todas las tendencias sean mas claras"
                ],
                correcta: 0,
                explicacion: "En horas lentas es comun ver ruido, recorridos cortos y falsas expectativas."
            },
            {
                id: "fx-2-q3",
                pregunta: "Por que USD/JPY puede reaccionar distinto a EUR/USD?",
                opciones: [
                    "Porque esta influido por flujos y horarios distintos",
                    "Porque no se mueve por oferta y demanda",
                    "Porque no necesita calendario economico"
                ],
                correcta: 0,
                explicacion: "Cada par tiene drivers y ventanas de liquidez diferentes."
            }
        ]
    },
    {
        id: "fx-3",
        nivel: 2,
        duracionMinutos: 16,
        titulo: "Estructura, tendencia y zonas",
        descripcion: "Este bloque baja la teoria al grafico: maximos, minimos, impulsos, retrocesos y zonas donde el precio suele decidir si continua o gira.",
        objetivo: "Leer la estructura antes de pensar en una entrada.",
        logro: "Ya puedes separar una tendencia sana de un mercado desordenado.",
        bloques: [
            {
                titulo: "Impulso y correccion",
                contenido: "Una tendencia no sube o baja en linea recta. Alterna impulsos y respiraciones. Mi trabajo es leer si la correccion mantiene la estructura o la rompe."
            },
            {
                titulo: "Zonas de decision",
                contenido: "Soportes, resistencias y rangos recientes sirven como mapa. No me dicen el futuro, pero si donde debo observar confirmacion."
            },
            {
                titulo: "Confirmacion",
                contenido: "Prefiero entradas donde tendencia, nivel y reaccion del precio coinciden. Una sola señal rara vez basta."
            }
        ],
        checklist: [
            "Ubicar maximos y minimos relevantes.",
            "Marcar una zona donde el precio deba reaccionar para validar la idea.",
            "Esperar confirmacion en vez de adivinar."
        ],
        preguntas: [
            {
                id: "fx-3-q1",
                pregunta: "Que combinacion suele dar una entrada mas estructurada?",
                opciones: [
                    "Tendencia, zona y confirmacion",
                    "Impulso sin contexto",
                    "Entrar por intuicion"
                ],
                correcta: 0,
                explicacion: "Una entrada mejora cuando contexto y ejecucion van de la mano."
            },
            {
                id: "fx-3-q2",
                pregunta: "Que me dice una correccion profunda que rompe minimos previos en una tendencia alcista?",
                opciones: [
                    "Que la estructura puede estar perdiendo fuerza",
                    "Que la tendencia es mas fuerte que antes",
                    "Que el spread desaparecio"
                ],
                correcta: 0,
                explicacion: "Si la estructura se rompe, debo revisar la idea antes de seguir comprando."
            },
            {
                id: "fx-3-q3",
                pregunta: "Para que uso una zona de decision?",
                opciones: [
                    "Para observar si el precio reacciona y confirma mi plan",
                    "Para entrar sin stop",
                    "Para ignorar el contexto"
                ],
                correcta: 0,
                explicacion: "La zona no garantiza nada, pero si define donde debo exigir evidencia."
            }
        ]
    },
    {
        id: "fx-4",
        nivel: 2,
        duracionMinutos: 14,
        titulo: "Gestion de riesgo y tamano de posicion",
        descripcion: "Aqui dejo claro que una buena idea mal dimensionada sigue siendo una mala operacion. El riesgo protege la cuenta y tu continuidad.",
        objetivo: "Convertir el riesgo en una regla antes de entrar al mercado.",
        logro: "Ya sabes cuanto arriesgar y que perder poco tambien es una victoria.",
        bloques: [
            {
                titulo: "Riesgo fijo por operacion",
                contenido: "Cuando arriesgo un porcentaje estable, protejo el capital de una racha mala y hago comparables mis resultados."
            },
            {
                titulo: "Stop loss con logica",
                contenido: "No coloco el stop por capricho. Debe invalidar la idea original sin quedar tan cerca que cualquier ruido lo toque."
            },
            {
                titulo: "Relacion riesgo beneficio",
                contenido: "Busco operaciones donde la posible recompensa compense el riesgo asumido. Si no hay espacio, simplemente no entro."
            }
        ],
        checklist: [
            "Definir un riesgo maximo antes de abrir la operacion.",
            "Colocar el stop donde la idea deje de tener sentido.",
            "Comprobar que la posible recompensa justifique la entrada."
        ],
        preguntas: [
            {
                id: "fx-4-q1",
                pregunta: "Por que un riesgo fijo protege la cuenta?",
                opciones: [
                    "Porque limita el dano de cada operacion",
                    "Porque garantiza que todas ganen",
                    "Porque elimina el spread"
                ],
                correcta: 0,
                explicacion: "El riesgo fijo evita que una sola entrada afecte de forma excesiva el saldo."
            },
            {
                id: "fx-4-q2",
                pregunta: "Que deberia invalidar un stop loss?",
                opciones: [
                    "La idea operativa",
                    "Solo el miedo del momento",
                    "La ultima comision"
                ],
                correcta: 0,
                explicacion: "El stop no es emocional; debe responder a la logica de la entrada."
            },
            {
                id: "fx-4-q3",
                pregunta: "Si una operacion ofrece poco recorrido potencial, que conviene hacer?",
                opciones: [
                    "Evitarla si no compensa el riesgo",
                    "Duplicar el tamano",
                    "Quitar el stop"
                ],
                correcta: 0,
                explicacion: "No toda idea merece capital. La relacion riesgo beneficio tambien filtra entradas."
            }
        ]
    },
    {
        id: "fx-5",
        nivel: 3,
        duracionMinutos: 18,
        titulo: "Catalizadores macro y lectura del calendario",
        descripcion: "En este nivel conecto precio con narrativa: tipos de interes, inflacion, empleo y eventos que pueden acelerar o romper una estructura tecnica.",
        objetivo: "Aprender a no operar a ciegas cuando viene una noticia fuerte.",
        logro: "Ya sabes leer cuando el contexto macro puede dominar el grafico.",
        bloques: [
            {
                titulo: "Tipos de interes",
                contenido: "La expectativa de tasas puede fortalecer o debilitar una moneda porque impacta los flujos hacia ese pais o bloque economico."
            },
            {
                titulo: "Calendario economico",
                contenido: "No necesito reaccionar a todas las noticias, pero si saber cuales pueden disparar volatilidad real y alterar una operacion abierta."
            },
            {
                titulo: "Tecnico mas macro",
                contenido: "Cuando estructura y narrativa van en la misma direccion, la lectura suele ser mas limpia. Si chocan, debo reducir agresividad."
            }
        ],
        checklist: [
            "Revisar si hay evento macro de alto impacto antes de operar.",
            "Entender si la noticia favorece o presiona a la moneda base o cotizada.",
            "Reducir tamano o esperar confirmacion cuando el calendario este cargado."
        ],
        preguntas: [
            {
                id: "fx-5-q1",
                pregunta: "Que efecto puede tener una sorpresa en tasas de interes?",
                opciones: [
                    "Cambiar rapidamente el flujo hacia una moneda",
                    "Eliminar la volatilidad del dia",
                    "Bloquear las tendencias del mercado"
                ],
                correcta: 0,
                explicacion: "Una sorpresa en tasas puede mover expectativas y con ello la demanda por una divisa."
            },
            {
                id: "fx-5-q2",
                pregunta: "Por que reviso el calendario antes de abrir una operacion?",
                opciones: [
                    "Para no quedar atrapado en una expansion de volatilidad sin plan",
                    "Para garantizar beneficios",
                    "Para evitar usar analisis tecnico"
                ],
                correcta: 0,
                explicacion: "La noticia no siempre invalida la idea, pero si cambia el riesgo del momento."
            },
            {
                id: "fx-5-q3",
                pregunta: "Si tecnico y macro chocan, que suele ser mas prudente?",
                opciones: [
                    "Operar con menos agresividad o esperar",
                    "Aumentar el riesgo para compensar",
                    "Ignorar por completo el contexto"
                ],
                correcta: 0,
                explicacion: "Cuando las lecturas no estan alineadas, la paciencia suele proteger mas que la prisa."
            }
        ]
    },
    {
        id: "fx-6",
        nivel: 3,
        duracionMinutos: 20,
        titulo: "Plan de trading, diario y mejora continua",
        descripcion: "Cierro el recorrido con ejecucion consciente: checklist previo, diario de decisiones y revision posterior para no repetir errores.",
        objetivo: "Construir un proceso repetible antes de pasar a simulaciones mas serias.",
        logro: "Ya tienes una rutina base para estudiar, ejecutar y revisar.",
        bloques: [
            {
                titulo: "Checklist preoperativa",
                contenido: "Antes de abrir una posicion reviso contexto, horario, noticia, estructura, riesgo y salida. Si falta algo, no entro."
            },
            {
                titulo: "Diario operativo",
                contenido: "Registrar razon de entrada, error, emocion y resultado me permite mejorar el proceso, no solo mirar ganancias o perdidas."
            },
            {
                titulo: "Revision semanal",
                contenido: "La mejora no llega operacion por operacion, sino revisando patrones repetidos: horarios flojos, errores de riesgo y sesgos personales."
            }
        ],
        checklist: [
            "Tener reglas previas antes de abrir una entrada.",
            "Documentar por que entraste y como saliste.",
            "Revisar errores repetidos para ajustar el plan."
        ],
        preguntas: [
            {
                id: "fx-6-q1",
                pregunta: "Para que sirve una checklist preoperativa?",
                opciones: [
                    "Para evitar improvisar la entrada",
                    "Para mover el mercado",
                    "Para reemplazar el analisis"
                ],
                correcta: 0,
                explicacion: "La checklist reduce decisiones impulsivas y obliga a validar la idea."
            },
            {
                id: "fx-6-q2",
                pregunta: "Que valor tiene el diario de trading?",
                opciones: [
                    "Convertir cada operacion en informacion util",
                    "Justificar entradas malas",
                    "Evitar registrar perdidas"
                ],
                correcta: 0,
                explicacion: "El diario sirve para aprender de la ejecucion real, no para adornarla."
            },
            {
                id: "fx-6-q3",
                pregunta: "Cuando mejora de verdad un trader?",
                opciones: [
                    "Cuando revisa patrones y ajusta su proceso",
                    "Cuando opera todo lo que ve",
                    "Cuando sube el riesgo tras una racha ganadora"
                ],
                correcta: 0,
                explicacion: "El crecimiento sostenible viene de revisar y corregir, no de perseguir emocion."
            }
        ]
    }
];

/**
 * Funcion: parseEcbHistory
 *
 * Que hace: transforma el XML historico del BCE a una estructura simple por fecha y tasas.
 * Como lo hace: con expresiones regulares busca cada nodo <Cube time=...> y dentro de el cada <Cube
 *   currency=... rate=.../>, y arma { date, rates: { USD: 1.08, ... } }.
 * Datos que participan: `xml` (texto devuelto por el BCE).
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: arreglo de { date, rates }.
 */
function parseEcbHistory(xml) {
    const dayMatches = [...String(xml || "").matchAll(/<Cube time=['"]([^'"]+)['"]>([\s\S]*?)<\/Cube>/g)];
    return dayMatches.map((match) => {
        const date = match[1];
        const rates = {};
        for (const rateMatch of match[2].matchAll(/<Cube currency=['"]([^'"]+)['"] rate=['"]([^'"]+)['"]\s*\/>/g)) {
            rates[rateMatch[1]] = Number(rateMatch[2]);
        }
        return { date, rates };
    });
}

/**
 * Funcion: calculatePairPrice
 *
 * Que hace: calcula el precio de un par a partir de las tasas base del BCE.
 * Como lo hace: el BCE cotiza todo contra EUR, asi que usa EUR como pivote: EUR/XXX es la tasa directa,
 *   XXX/EUR es 1/tasa, y cualquier otro cruce se calcula como tasa(cotizada) / tasa(base).
 * Datos que participan: `rates` (objeto de tasas del dia), `pair` (ej. 'EUR/USD' o 'EURUSD').
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: number o null si el par no se puede resolver.
 */
function calculatePairPrice(rates, pair) {
    const normalizedPair = String(pair || "").toUpperCase().replace("/", "");
    const base = normalizedPair.slice(0, 3);
    const quote = normalizedPair.slice(3, 6);

    if (base === "EUR" && rates[quote]) {
        return rates[quote];
    }

    if (quote === "EUR" && rates[base]) {
        return 1 / rates[base];
    }

    if (rates[base] && rates[quote]) {
        return rates[quote] / rates[base];
    }

    return null;
}

/**
 * Funcion: buildSeriesFromHistory
 *
 * Que hace: convierte el historial crudo en una serie limpia de fecha y precio para un par especifico.
 * Como lo hace: aplica calculatePairPrice a cada dia, redondea a 5 decimales y descarta los dias sin precio.
 * Datos que participan: `history` (resultado de parseEcbHistory), `pair`.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: arreglo de { date, price }.
 */
function buildSeriesFromHistory(history, pair) {
    return history
        .map((entry) => {
            const price = calculatePairPrice(entry.rates, pair);
            return price ? { date: entry.date, price: Number(price.toFixed(5)) } : null;
        })
        .filter(Boolean);
}

/**
 * Funcion: buildFallbackSeries
 *
 * Que hace: prepara una serie de respaldo para no dejar vacia la experiencia si el proveedor externo falla o
 *   trae pocos datos.
 * Como lo hace: toma 7 precios de referencia por par y les asigna fechas consecutivas terminando hoy.
 * Datos que participan: `pair`.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: arreglo de { date, price }.
 */
function buildFallbackSeries(pair) {
    const seed = {
        EURUSD: [1.082, 1.081, 1.084, 1.086, 1.089, 1.091, 1.093],
        GBPUSD: [1.264, 1.267, 1.266, 1.269, 1.272, 1.274, 1.276],
        EURGBP: [0.856, 0.854, 0.855, 0.857, 0.858, 0.859, 0.857],
        USDJPY: [154.2, 154.8, 155.1, 154.7, 155.4, 155.9, 156.2]
    };

    const values = seed[pair] || seed.EURUSD;
    const dates = Array.from({ length: values.length }, function (_, index) {
        const date = new Date();
        date.setDate(date.getDate() - (values.length - index - 1));
        return date.toISOString().slice(0, 10);
    });

    return dates.map((date, index) => ({
        date,
        price: values[index]
    }));
}

/**
 * Funcion: fetchForexSeries
 *
 * Que hace: obtiene mercado real desde el BCE y, si falla, regresa una serie de respaldo.
 * Como lo hace: descarga el XML con fetch, lo parsea y construye la serie; si hay al menos 5 puntos devuelve
 *   los ultimos 30 con source 'ecb'. Ante cualquier error de red o datos insuficientes devuelve source
 *   'fallback'.
 * Datos que participan: `pair`, URL ECB_HISTORY_URL.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { source: 'ecb' | 'fallback', pair, series }.
 */
async function fetchForexSeries(pair) {
    try {
        const response = await fetch(ECB_HISTORY_URL);
        if (!response.ok) {
            throw new Error("No pude consultar el historial del BCE.");
        }

        const xml = await response.text();
        const history = parseEcbHistory(xml);
        const series = buildSeriesFromHistory(history, pair);

        if (series.length >= 5) {
            return {
                source: "ecb",
                pair,
                series: series.slice(-30)
            };
        }
    } catch (error) {
        // Si el mercado real no responde, no tumbo la experiencia:
        // entrego una serie de respaldo para que la seccion siga siendo util.
    }

    return {
        source: "fallback",
        pair,
        series: buildFallbackSeries(pair)
    };
}

/**
 * Funcion: summarizeSeries
 *
 * Que hace: saca un resumen estadistico corto del tramo analizado.
 * Como lo hace: calcula ultimo precio, maximo, minimo, promedio, variacion porcentual entre el primer y el
 *   ultimo punto, rango porcentual respecto al promedio, sesgo (alcista si la variacion es >=
 *   0) y etiqueta de volatilidad (alta >= 2%, media >= 1%, baja).
 * Datos que participan: `series` (arreglo de { date, price }).
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: objeto resumen.
 */
function summarizeSeries(series) {
    const prices = series.map((entry) => Number(entry.price || 0)).filter(Boolean);
    const first = series[0];
    const last = series[series.length - 1];
    const highest = prices.length ? Math.max(...prices) : 0;
    const lowest = prices.length ? Math.min(...prices) : 0;
    const average = prices.length
        ? Number((prices.reduce((sum, value) => sum + value, 0) / prices.length).toFixed(5))
        : 0;
    const variation = first && last
        ? Number((((last.price - first.price) / first.price) * 100).toFixed(2))
        : 0;
    const intradayRangePercent = average
        ? Number((((highest - lowest) / average) * 100).toFixed(2))
        : 0;

    return {
        latestPrice: last?.price || 0,
        variationPercent: variation,
        latestDate: last?.date || "",
        highestPrice: Number(highest.toFixed(5)),
        lowestPrice: Number(lowest.toFixed(5)),
        averagePrice: average,
        rangePercent: intradayRangePercent,
        bias: variation >= 0 ? "alcista" : "bajista",
        volatilityLabel: intradayRangePercent >= 2 ? "alta" : intradayRangePercent >= 1 ? "media" : "baja"
    };
}

/**
 * Funcion: buildMarketInsights
 *
 * Que hace: convierte el resumen numerico en mensajes y tarjetas mas legibles para el usuario.
 * Como lo hace: arma tres tarjetas de contexto (sesgo, volatilidad, zona alta/baja) y cuatro notas que
 *   combinan una pista de sesion por par, el promedio y recomendaciones segun volatilidad y sesgo.
 * Datos que participan: `pair`, `summary` (de summarizeSeries).
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { contextCards, notes }.
 */
function buildMarketInsights(pair, summary) {
    const sessionHint = {
        EURUSD: "Suele reaccionar mejor cuando Europa y Nueva York coinciden.",
        GBPUSD: "Tiende a mostrar expansion cuando Londres toma el control de la sesion.",
        EURGBP: "Normalmente requiere paciencia porque puede comprimirse mas que otros majors.",
        USDJPY: "El componente asiatico pesa mas y la lectura del yen cambia el ritmo del par."
    };

    const contextCards = [
        {
            titulo: "Sesgo actual",
            valor: summary.bias === "alcista" ? "Presion compradora" : "Presion vendedora",
            detalle: `Variacion reciente ${summary.variationPercent >= 0 ? "+" : ""}${summary.variationPercent}%`
        },
        {
            titulo: "Volatilidad",
            valor: String(summary.volatilityLabel || "media").toUpperCase(),
            detalle: `Rango reciente ${summary.rangePercent}%`
        },
        {
            titulo: "Zona alta / baja",
            valor: `${summary.highestPrice} / ${summary.lowestPrice}`,
            detalle: "Extremos recientes del tramo analizado"
        }
    ];

    const notes = [
        `El promedio reciente del par ${pair} esta alrededor de ${summary.averagePrice}.`,
        sessionHint[pair] || "Observa que horas traen mas continuidad para este cruce.",
        summary.volatilityLabel === "alta"
            ? "La volatilidad esta exigente: conviene bajar agresividad y ser mas selectivo."
            : "La volatilidad esta controlada y permite estudiar mejor estructura y reaccion.",
        summary.bias === "alcista"
            ? "El ultimo tramo favorece continuidad alcista, pero aun necesito confirmacion en zonas."
            : "El ultimo tramo favorece continuidad bajista, pero aun necesito confirmacion antes de vender."
    ];

    return {
        contextCards,
        notes
    };
}

/**
 * Funcion: getForexLearningContent
 *
 * Que hace: une el plan de estudio fijo con el estado actual del mercado para el par elegido.
 * Como lo hace: normaliza el par (mayusculas, sin '/'), obtiene la serie, el resumen y los insights.
 * Datos que participan: `pair` (por defecto EURUSD).
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: { pair, curriculum, market: { source, pair, summary, series, insights } }.
 */
async function getForexLearningContent(pair = "EURUSD") {
    const normalizedPair = String(pair || "EURUSD").toUpperCase().replace("/", "");
    const market = await fetchForexSeries(normalizedPair);
    const summary = summarizeSeries(market.series);
    const insights = buildMarketInsights(normalizedPair, summary);

    return {
        pair: normalizedPair,
        curriculum: builtInCurriculum,
        market: {
            source: market.source,
            pair: normalizedPair,
            summary,
            series: market.series,
            insights
        }
    };
}

/**
 * Funcion: buildCapitalPath
 *
 * Que hace: simula una curva de capital sencilla para que el usuario vea una secuencia de presion, reaccion y
 *   cierre y no solo un numero final.
 * Como lo hace: calcula cinco puntos: inicio, presion inicial (capital - 35% del riesgo), reaccion (45% de la
 *   ganancia/perdida estimada), confirmacion (78%) y cierre (100%).
 * Datos que participan: `capital`, `estimatedProfitLoss`, `riskCapital`.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: arreglo de { etapa, capital }.
 */
function buildCapitalPath(capital, estimatedProfitLoss, riskCapital) {
    const firstDip = Number((capital - (riskCapital * 0.35)).toFixed(2));
    const recovery = Number((capital + (estimatedProfitLoss * 0.45)).toFixed(2));
    const confirmation = Number((capital + (estimatedProfitLoss * 0.78)).toFixed(2));
    const finalCapital = Number((capital + estimatedProfitLoss).toFixed(2));

    return [
        { etapa: "Inicio", capital: Number(capital.toFixed(2)) },
        { etapa: "Presion inicial", capital: firstDip },
        { etapa: "Reaccion", capital: recovery },
        { etapa: "Confirmacion", capital: confirmation },
        { etapa: "Cierre", capital: finalCapital }
    ];
}

/**
 * Funcion: simulateForexScenario
 *
 * Que hace: calcula un escenario de simulacion con el mercado reciente, el capital, el riesgo y la direccion
 *   elegida. Es educativo: no mueve dinero ni toca la wallet.
 * Como lo hace: valida capital > 0, riesgo entre 0 y 100 y direccion buy/sell; toma el penultimo y el ultimo
 *   precio de la serie, calcula el movimiento porcentual (invertido si es venta), el capital en riesgo, la
 *   relacion riesgo/beneficio (1.5 con volatilidad alta, 1.8 en otro caso), la ganancia o perdida estimada,
 *   distancias de stop y objetivo, una confianza acotada entre 35 y 82 y la curva de capital.
 * Datos que participan: `payload` { pair, direction, capital, riskPercent }.
 * Consultas SQL: ninguna (no usa base de datos).
 * Retorna: objeto con precios de entrada y actual, capital, riesgo, ganancia/perdida estimada, stop, objetivo,
 *   confianza y curva. Lanza HttpError 400 si hay datos invalidos.
 */
async function simulateForexScenario(payload) {
    const pair = String(payload.pair || "EURUSD").toUpperCase().replace("/", "");
    const direction = String(payload.direction || "buy").toLowerCase();
    const capital = Number(payload.capital || 0);
    const riskPercent = Number(payload.riskPercent || 0);

    if (!Number.isFinite(capital) || capital <= 0) {
        throw new HttpError(400, "Ingresa un capital valido para el simulador.");
    }

    if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100) {
        throw new HttpError(400, "Ingresa un porcentaje de riesgo valido.");
    }

    if (!["buy", "sell"].includes(direction)) {
        throw new HttpError(400, "La direccion de la simulacion debe ser compra o venta.");
    }

    const market = await fetchForexSeries(pair);
    const series = market.series;
    const summary = summarizeSeries(series);
    const entry = series[series.length - 2] || series[0];
    const latest = series[series.length - 1] || entry;
    const movePercentRaw = entry && latest ? ((latest.price - entry.price) / entry.price) * 100 : 0;
    const directionalMove = direction === "buy" ? movePercentRaw : -movePercentRaw;
    const riskCapital = capital * (riskPercent / 100);
    const riskRewardRatio = summary.volatilityLabel === "alta" ? 1.5 : 1.8;
    const estimatedProfitLoss = Number((riskCapital * (directionalMove / 2)).toFixed(2));
    const stopDistancePercent = Number((summary.rangePercent / 3 || 0.45).toFixed(2));
    const targetDistancePercent = Number((stopDistancePercent * riskRewardRatio).toFixed(2));
    const scenarioConfidence = Math.max(35, Math.min(82, Number((55 + directionalMove * 4).toFixed(0))));

    return {
        pair,
        source: market.source,
        entryDate: entry?.date || "",
        entryPrice: entry?.price || 0,
        latestDate: latest?.date || "",
        latestPrice: latest?.price || 0,
        direction,
        capital: Number(capital.toFixed(2)),
        riskPercent: Number(riskPercent.toFixed(2)),
        riskCapital: Number(riskCapital.toFixed(2)),
        movePercent: Number(directionalMove.toFixed(2)),
        estimatedProfitLoss,
        finalCapital: Number((capital + estimatedProfitLoss).toFixed(2)),
        riskRewardRatio,
        stopDistancePercent,
        targetDistancePercent,
        scenarioConfidence,
        marketSummary: summary,
        setupChecklist: [
            "Validar que el horario tenga liquidez para este par.",
            "Confirmar estructura y zona antes de entrar.",
            "Aceptar el riesgo maximo antes de ejecutar.",
            "Definir salida parcial o total antes de abrir la operacion."
        ],
        journalPrompts: [
            "Que razon tecnica y de contexto me hizo entrar?",
            "La volatilidad del par justificaba este riesgo?",
            "Mi salida fue por plan o por reaccion emocional?",
            "Que repetiria y que corregiria en la siguiente simulacion?"
        ],
        capitalPath: buildCapitalPath(capital, estimatedProfitLoss, riskCapital),
        series
    };
}

module.exports = {
    getForexLearningContent,
    simulateForexScenario
};
