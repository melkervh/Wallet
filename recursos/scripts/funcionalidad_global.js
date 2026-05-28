const CLAVE_TOKEN_SESION = "wallet_api_token";
const CLAVE_TEMA = "wallet_theme";
const PAGINAS_PRIVADAS = new Set([
    "principal.html",
    "perfil.html",
    "operaciones.html",
    "movimientos.html",
    "mercado_forex.html",
    "aprendizaje_forex.html",
    "cuestionario_forex.html",
    "simulador_inversion.html"
]);

const PREFIJOS_TELEFONICOS = [
    { codigo: "+503", pais: "El Salvador", bandera: "🇸🇻", ejemplo: "70000000" },
    { codigo: "+502", pais: "Guatemala", bandera: "🇬🇹", ejemplo: "51234567" },
    { codigo: "+504", pais: "Honduras", bandera: "🇭🇳", ejemplo: "91234567" },
    { codigo: "+505", pais: "Nicaragua", bandera: "🇳🇮", ejemplo: "81234567" },
    { codigo: "+506", pais: "Costa Rica", bandera: "🇨🇷", ejemplo: "61234567" },
    { codigo: "+507", pais: "Panama", bandera: "🇵🇦", ejemplo: "61234567" },
    { codigo: "+52", pais: "Mexico", bandera: "🇲🇽", ejemplo: "5512345678" },
    { codigo: "+1", pais: "Estados Unidos", bandera: "🇺🇸", ejemplo: "2025550123" },
    { codigo: "+57", pais: "Colombia", bandera: "🇨🇴", ejemplo: "3001234567" },
    { codigo: "+34", pais: "Espana", bandera: "🇪🇸", ejemplo: "612345678" }
];

const estado_aplicacion = {
    aplicandoFavorito: false,
    avisoBaseVaciaMostrado: false,
    bootstrap: null,
    centros: {
        adelanto: null,
        ahorros: null,
        servicios: null,
        tarjetas: null
    },
    favoritosTransferencia: [],
    forexAprendizaje: null,
    forexHistorial: [],
    forexHistorialSimulacion: [],
    forexModuloActivo: "",
    forexParActivo: "EURUSD",
    forexProgreso: {},
    forexSimulacion: null,
    graficos: {},
    movimientos: [],
    pinRecuperacionVerificado: false,
    pinRecuperacionModalVerificado: false,
    perfilActual: null,
    sesion: null,
    modoAcceso: "login",
    tema: "light"
};

aplicar_tema(cargar_preferencia_tema());

document.addEventListener("DOMContentLoaded", function () {
    iniciar_aplicacion().catch(function (error) {
        console.error(error);
        mostrar_mensaje("texto_estado_transferencia", error.message || "Ocurrio un error inesperado.", "error");
        mostrar_mensaje("mensaje_login", error.message || "Ocurrio un error inesperado.", "error");
        mostrar_mensaje("mensaje_registro", error.message || "Ocurrio un error inesperado.", "error");
        mostrar_mensaje("mensaje_recuperacion", error.message || "Ocurrio un error inesperado.", "error");
        mostrar_mensaje("mensaje_reset_password", error.message || "Ocurrio un error inesperado.", "error");
    });
});

async function iniciar_aplicacion() {
    normalizar_menu_superior();
    inicializar_tema();
    inicializar_menu_responsive();
    inicializar_campana_alertas();
    inicializar_accesos_cuenta();
    renderizar_panel_alertas_superior([], 0);
    sincronizar_interfaz_sesion();

    const pagina = obtener_pagina_actual();
    if (PAGINAS_PRIVADAS.has(pagina)) {
        const accesoValido = await preparar_vista_privada();
        if (!accesoValido) {
            return;
        }
    }

    if (pagina === "login.html") {
        await inicializar_login();
    }

    if (pagina === "principal.html") {
        await inicializar_principal();
    }

    if (pagina === "perfil.html") {
        await inicializar_perfil();
    }

    if (pagina === "operaciones.html") {
        await inicializar_transferencias();
    }

    if (pagina === "movimientos.html") {
        await inicializar_movimientos();
    }

    if (pagina === "mercado_forex.html" || pagina === "aprendizaje_forex.html" || pagina === "cuestionario_forex.html") {
        await inicializar_portal_forex();
    }

    if (pagina === "simulador_inversion.html") {
        await inicializar_simulador();
    }

    redibujar_graficos();
}

function obtener_pagina_actual() {
    const partes = window.location.pathname.split("/");
    return partes[partes.length - 1] || "login.html";
}

function obtener_token_sesion() {
    return localStorage.getItem(CLAVE_TOKEN_SESION) || "";
}

function guardar_token_sesion(token) {
    localStorage.setItem(CLAVE_TOKEN_SESION, token);
}

function limpiar_sesion_local() {
    localStorage.removeItem(CLAVE_TOKEN_SESION);
    estado_aplicacion.perfilActual = null;
    estado_aplicacion.sesion = null;
    sincronizar_interfaz_sesion();
}

function cargar_preferencia_tema() {
    const temaGuardado = localStorage.getItem(CLAVE_TEMA);
    return temaGuardado === "dark" ? "dark" : "light";
}

function guardar_preferencia_tema(tema) {
    localStorage.setItem(CLAVE_TEMA, tema);
}

function aplicar_tema(tema) {
    const temaNormalizado = tema === "dark" ? "dark" : "light";
    estado_aplicacion.tema = temaNormalizado;
    document.documentElement.dataset.theme = temaNormalizado;
}

function alternar_tema() {
    const siguienteTema = estado_aplicacion.tema === "dark" ? "light" : "dark";
    aplicar_tema(siguienteTema);
    guardar_preferencia_tema(siguienteTema);
    actualizar_boton_tema();
    redibujar_graficos();
}

function inicializar_tema() {
    renderizar_controles_superiores();
}

function actualizar_boton_tema() {
    const etiqueta = estado_aplicacion.tema === "light"
        ? "Cambiar a modo oscuro"
        : "Cambiar a modo dia";

    document.querySelectorAll("[data-accion-tema]").forEach(function (botonTema) {
        botonTema.setAttribute("aria-label", etiqueta);
        botonTema.setAttribute("title", etiqueta);
        botonTema.setAttribute("aria-pressed", String(estado_aplicacion.tema === "light"));
        const etiquetaTexto = botonTema.querySelector("[data-etiqueta-tema]");
        if (etiquetaTexto) {
            etiquetaTexto.textContent = etiqueta;
        }
    });
}

function renderizar_controles_superiores() {
    const contenedorAlertas = document.querySelector(".contenedor_alertas");
    if (!contenedorAlertas) {
        return;
    }

    const controlTemaPrevio = document.getElementById("boton_tema");
    const menuUsuarioPrevio = document.getElementById("menu_usuario_superior");
    const botonCerrarPrevio = document.getElementById("boton_cerrar_sesion");

    if (controlTemaPrevio) {
        controlTemaPrevio.remove();
    }
    if (menuUsuarioPrevio) {
        menuUsuarioPrevio.remove();
    }
    if (botonCerrarPrevio) {
        botonCerrarPrevio.remove();
    }

    const sesionActiva = Boolean(obtener_token_sesion() || estado_aplicacion.sesion);
    if (es_pagina_privada() && sesionActiva) {
        const usuario = obtener_usuario_actual();
        const menuUsuario = document.createElement("div");
        menuUsuario.id = "menu_usuario_superior";
        menuUsuario.className = "menu_usuario_superior";

        const botonAvatar = document.createElement("button");
        botonAvatar.type = "button";
        botonAvatar.className = "boton_avatar_superior";
        botonAvatar.setAttribute("aria-label", "Abrir opciones de usuario");
        botonAvatar.setAttribute("aria-expanded", "false");
        botonAvatar.innerHTML = construir_avatar_superior(usuario);

        const submenu = document.createElement("div");
        submenu.className = "submenu_usuario";
        submenu.innerHTML = [
            `<div class="encabezado_submenu_usuario"><strong>${escapar_html(`${usuario?.nombres || ""} ${usuario?.apellidos || ""}`.trim() || "Tu cuenta")}</strong><span>${escapar_html(usuario?.correo || "Wallet Digital")}</span></div>`,
            `<a class="item_submenu_usuario" href="perfil.html">${icono_configuracion_svg("icono_submenu")}<span>Configuracion</span></a>`,
            construir_boton_tema_submenu(),
            `<button type="button" class="item_submenu_usuario item_submenu_peligro" data-accion-cerrar-sesion="true">${icono_salida_svg("icono_submenu")}<span>Cerrar sesion</span></button>`
        ].join("");

        botonAvatar.addEventListener("click", function (evento) {
            evento.stopPropagation();
            const abierto = submenu.classList.toggle("submenu_usuario_abierto");
            botonAvatar.setAttribute("aria-expanded", String(abierto));
        });

        submenu.querySelector('[data-accion-cerrar-sesion="true"]')?.addEventListener("click", async function () {
            submenu.classList.remove("submenu_usuario_abierto");
            botonAvatar.setAttribute("aria-expanded", "false");
            await cerrar_sesion();
        });

        submenu.querySelector('[data-accion-tema="true"]')?.addEventListener("click", function () {
            alternar_tema();
            actualizar_boton_tema();
        });

        menuUsuario.appendChild(botonAvatar);
        menuUsuario.appendChild(submenu);
        contenedorAlertas.appendChild(menuUsuario);
        inicializar_cierre_submenu_usuario();
        actualizar_boton_tema();
        return;
    }

    const botonTema = document.createElement("button");
    botonTema.id = "boton_tema";
    botonTema.type = "button";
    botonTema.className = "boton_tema";
    botonTema.dataset.accionTema = "true";
    botonTema.innerHTML = icono_sol_svg();
    botonTema.addEventListener("click", alternar_tema);
    contenedorAlertas.insertBefore(botonTema, contenedorAlertas.firstChild);
    actualizar_boton_tema();
}

function construir_boton_tema_submenu() {
    return [
        '<button type="button" class="item_submenu_usuario" data-accion-tema="true">',
        icono_sol_svg("icono_submenu"),
        '<span data-etiqueta-tema></span>',
        "</button>"
    ].join("");
}

function construir_avatar_superior(usuario) {
    if (usuario?.fotoPerfilUrl) {
        return `<img class="avatar_superior_imagen" src="${escapar_html(usuario.fotoPerfilUrl)}" alt="Foto de perfil">`;
    }

    return `<span class="avatar_superior_iniciales">${escapar_html(obtener_iniciales_usuario(usuario))}</span>`;
}

function inicializar_cierre_submenu_usuario() {
    if (document.body.dataset.menuUsuarioInicializado) {
        return;
    }

    document.addEventListener("click", function (evento) {
        document.querySelectorAll(".submenu_usuario_abierto").forEach(function (submenu) {
            const contenedor = submenu.closest(".menu_usuario_superior");
            if (contenedor && !contenedor.contains(evento.target)) {
                submenu.classList.remove("submenu_usuario_abierto");
                const boton = contenedor.querySelector(".boton_avatar_superior");
                if (boton) {
                    boton.setAttribute("aria-expanded", "false");
                }
            }
        });
    });

    document.body.dataset.menuUsuarioInicializado = "true";
}

function icono_sol_svg(claseExtra) {
    return `<svg class="${claseExtra || ""}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2.5v2.3"></path><path d="M12 19.2v2.3"></path><path d="M4.9 4.9l1.6 1.6"></path><path d="M17.5 17.5l1.6 1.6"></path><path d="M2.5 12h2.3"></path><path d="M19.2 12h2.3"></path><path d="M4.9 19.1l1.6-1.6"></path><path d="M17.5 6.5l1.6-1.6"></path></svg>`;
}

function icono_configuracion_svg(claseExtra) {
    return `<svg class="${claseExtra || ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"></path><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.7a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0L4.3 18a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H3.5a1 1 0 0 1-1-1v-1.7a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4L5.5 4a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V3.2a1 1 0 0 1 1-1h1.7a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v1.7a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6z"></path></svg>`;
}

function icono_salida_svg(claseExtra) {
    return `<svg class="${claseExtra || ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path></svg>`;
}

function es_pagina_privada() {
    return PAGINAS_PRIVADAS.has(obtener_pagina_actual());
}

function obtener_usuario_actual() {
    return estado_aplicacion.perfilActual || estado_aplicacion.sesion?.user || null;
}

// Funcion: mostrar_toast_lateral
// Aqui entra SweetAlert2 en modo toast.
// Esta funcion no toca backend ni base de datos; solo pinta una notificacion
// visual discreta al costado usando window.Swal.fire(...).
function mostrar_toast_lateral(texto, tipo) {
    if (!texto || !window.Swal) return;

    const icon = tipo === "error"
        ? "error"
        : tipo === "exito"
            ? "success"
            : "info";

    window.Swal.fire({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: tipo === "error" ? 3600 : 2400,
        timerProgressBar: true,
        icon,
        title: texto,
        customClass: {
            popup: "wallet-toast"
        }
    });
}

// Funcion: confirmar_accion
// Aqui ejecuto SweetAlert2 en modo modal de confirmacion.
// La uso antes de operaciones sensibles como transferir, pagar o cerrar sesion.
// Devuelvo true o false para que el flujo del submit sepa si debe continuar.
async function confirmar_accion({ titulo, texto, botonConfirmar, icono }) {
    if (!window.Swal) {
        return window.confirm(texto || titulo || "Confirma esta accion.");
    }

    const respuesta = await window.Swal.fire({
        title: titulo || "Confirmar accion",
        text: texto || "",
        icon: icono || "question",
        showCancelButton: true,
        confirmButtonText: botonConfirmar || "Continuar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: obtener_color_css("--color_morado_principal", "#6f3df4"),
        background: obtener_color_css("--color_superficie_solida", "#ffffff"),
        color: obtener_color_css("--color_texto_principal", "#1d152d")
    });

    return Boolean(respuesta.isConfirmed);
}

// Funcion: consumir_api
// Aqui vive la salida principal del frontend hacia el backend.
// Todo CRUD del navegador pasa por este punto: crear, leer, actualizar o eliminar.
// Esta funcion:
// 1. agrega el token Bearer si existe
// 2. convierte el body a JSON
// 3. ejecuta fetch() a /api/...
// 4. interpreta la respuesta JSON
// 5. si el backend devuelve 401, limpia sesion y redirige al login
async function consumir_api(ruta, opciones) {
    const configuracion = { method: "GET", headers: {}, ...opciones };
    const token = obtener_token_sesion();

    if (token && !configuracion.omitirAutorizacion) {
        configuracion.headers.Authorization = "Bearer " + token;
    }

    if (configuracion.body && typeof configuracion.body !== "string") {
        configuracion.headers["Content-Type"] = "application/json";
        configuracion.body = JSON.stringify(configuracion.body);
    }

    const respuesta = await fetch(ruta, configuracion);
    let datos = {};

    try {
        datos = await respuesta.json();
    } catch (error) {
        datos = {};
    }

    if (respuesta.status === 401) {
        limpiar_sesion_local();
        if (obtener_pagina_actual() !== "login.html") {
            window.location.href = "login.html?sesion=expirada";
        }
    }

    if (!respuesta.ok) {
        throw new Error(datos.message || "No se pudo completar la operacion.");
    }

    return datos;
}

async function obtener_sesion(forzar) {
    if (!forzar && estado_aplicacion.sesion) {
        return estado_aplicacion.sesion;
    }

    const token = obtener_token_sesion();
    if (!token) {
        throw new Error("Tu sesion no esta activa.");
    }

    const sesion = await consumir_api("/api/auth/session");
    estado_aplicacion.perfilActual = sesion.user || null;
    estado_aplicacion.sesion = sesion;
    sincronizar_interfaz_sesion();
    return sesion;
}

async function preparar_vista_privada() {
    try {
        const sesion = await obtener_sesion(false);
        renderizar_panel_alertas_superior(sesion.alerts || [], sesion.unreadAlerts || 0);
        sincronizar_interfaz_sesion();
        return true;
    } catch (error) {
        limpiar_sesion_local();
        window.location.href = "login.html?sesion=expirada";
        return false;
    }
}

function sincronizar_interfaz_sesion() {
    normalizar_menu_superior();
    inicializar_boton_cerrar_sesion();
}

function normalizar_menu_superior() {
    const menu = document.getElementById("menu_superior");
    if (!menu) return;

    const paginaActual = obtener_pagina_actual();
    const sesionActiva = Boolean(obtener_token_sesion() || estado_aplicacion.sesion);
    const paginasForex = new Set(["mercado_forex.html", "aprendizaje_forex.html", "cuestionario_forex.html"]);
    const enlaces = sesionActiva
        ? [
            { href: "principal.html", label: "Wallet" },
            { href: "operaciones.html", label: "Transferencias" },
            { href: "movimientos.html", label: "Movimientos" },
            {
                tipo: "submenu",
                label: "Modulo Forex",
                activa: paginasForex.has(paginaActual),
                items: [
                    { href: "mercado_forex.html", label: "Mercado actual" },
                    { href: "aprendizaje_forex.html", label: "Aprendizaje" },
                    { href: "cuestionario_forex.html", label: "Cuestionario" }
                ]
            },
            { href: "simulador_inversion.html", label: "Simulador Forex" }
        ]
        : [
            { href: "login.html", label: "Login" }
        ];

    menu.innerHTML = "";

    enlaces.forEach(function (enlaceDefinido) {
        if (enlaceDefinido.tipo === "submenu") {
            const grupo = document.createElement("div");
            grupo.className = "grupo_menu_superior";

            const boton = document.createElement("button");
            boton.type = "button";
            boton.className = "boton_menu_superior";
            boton.textContent = enlaceDefinido.label;
            boton.setAttribute("aria-expanded", "false");
            boton.classList.toggle("enlace_activo", Boolean(enlaceDefinido.activa));

            const submenu = document.createElement("div");
            submenu.className = "submenu_menu_superior";

            enlaceDefinido.items.forEach(function (item) {
                const enlaceSubmenu = document.createElement("a");
                enlaceSubmenu.href = item.href;
                enlaceSubmenu.textContent = item.label;
                enlaceSubmenu.classList.toggle("enlace_activo", paginaActual === item.href);
                submenu.appendChild(enlaceSubmenu);
            });

            boton.addEventListener("click", function (evento) {
                evento.stopPropagation();
                const abierto = grupo.classList.toggle("grupo_menu_superior_abierto");
                boton.setAttribute("aria-expanded", String(abierto));
            });

            grupo.appendChild(boton);
            grupo.appendChild(submenu);
            menu.appendChild(grupo);
            return;
        }

        const enlace = document.createElement("a");
        enlace.href = enlaceDefinido.href;
        enlace.textContent = enlaceDefinido.label;
        enlace.classList.toggle("enlace_activo", paginaActual === enlaceDefinido.href);
        menu.appendChild(enlace);
    });

    if (!document.body.dataset.menuForexInicializado) {
        document.addEventListener("click", function () {
            document.querySelectorAll(".grupo_menu_superior_abierto").forEach(function (grupo) {
                grupo.classList.remove("grupo_menu_superior_abierto");
                grupo.querySelector(".boton_menu_superior")?.setAttribute("aria-expanded", "false");
            });
        });
        document.body.dataset.menuForexInicializado = "true";
    }
}

function inicializar_boton_cerrar_sesion() {
    renderizar_controles_superiores();
}

async function cerrar_sesion() {
    const confirmar = await confirmar_accion({
        titulo: "Cerrar sesion",
        texto: "Se cerrara tu acceso actual en este navegador. ¿Deseas continuar?",
        botonConfirmar: "Cerrar sesion",
        icono: "question"
    });

    if (!confirmar) {
        return;
    }

    limpiar_sesion_local();
    window.location.href = "login.html?sesion=cerrada";
}

function inicializar_menu_responsive() {
    const boton_menu = document.getElementById("boton_menu");
    const menu_superior = document.getElementById("menu_superior");
    if (!boton_menu || !menu_superior) return;
    boton_menu.addEventListener("click", function () {
        menu_superior.classList.toggle("menu_abierto");
        boton_menu.setAttribute("aria-expanded", String(menu_superior.classList.contains("menu_abierto")));
    });
}

function sincronizar_picker_color_ahorro() {
    const inputColor = document.getElementById("ahorro_color");
    const textoColor = document.getElementById("texto_color_ahorro");
    if (!inputColor || !textoColor || inputColor.dataset.inicializado) {
        if (inputColor && textoColor) {
            textoColor.textContent = inputColor.value || "#6f3df4";
        }
        return;
    }

    const actualizar = function () {
        textoColor.textContent = inputColor.value || "#6f3df4";
    };

    inputColor.addEventListener("input", actualizar);
    inputColor.dataset.inicializado = "true";
    actualizar();
}

function inicializar_campana_alertas() {
    const boton = document.getElementById("boton_alertas");
    const panel = document.getElementById("panel_alertas");
    if (!boton || !panel) return;

    if (!boton.dataset.inicializado) {
        boton.addEventListener("click", function () {
            const abierto = panel.classList.toggle("panel_alertas_abierto");
            boton.setAttribute("aria-expanded", String(abierto));

            if (abierto) {
                marcar_alertas_como_vistas().catch(function (error) {
                    console.warn("No pude marcar las alertas como vistas:", error.message);
                });
            }
        });
        boton.dataset.inicializado = "true";
    }

    if (!panel.dataset.inicializado) {
        panel.addEventListener("click", function (evento) {
            const botonEliminar = evento.target.closest("[data-eliminar-alerta]");
            if (!botonEliminar) {
                return;
            }

            evento.preventDefault();
            eliminar_alerta_desde_panel(botonEliminar.getAttribute("data-eliminar-alerta"), botonEliminar).catch(function (error) {
                console.warn("No pude eliminar la alerta:", error.message);
            });
        });
        panel.dataset.inicializado = "true";
    }

    if (!document.body.dataset.campanaAlertasInicializada) {
        document.addEventListener("click", function (evento) {
            const click_fuera = !panel.contains(evento.target) && !boton.contains(evento.target);
            if (click_fuera) {
                panel.classList.remove("panel_alertas_abierto");
                boton.setAttribute("aria-expanded", "false");
            }
        });
        document.body.dataset.campanaAlertasInicializada = "true";
    }
}

function sincronizar_alertas_en_estado(respuesta) {
    const alerts = respuesta?.alerts || [];
    const unreadAlerts = Number(respuesta?.unreadAlerts || 0);

    if (!estado_aplicacion.sesion) {
        estado_aplicacion.sesion = {};
    }

    estado_aplicacion.sesion.alerts = alerts;
    estado_aplicacion.sesion.unreadAlerts = unreadAlerts;
    renderizar_panel_alertas_superior(alerts, unreadAlerts);
}

async function cargar_alertas_desde_servidor() {
    if (!obtener_token_sesion()) {
        sincronizar_alertas_en_estado({
            alerts: [],
            unreadAlerts: 0
        });
        return {
            alerts: [],
            unreadAlerts: 0
        };
    }

    const respuesta = await consumir_api("/api/alerts");
    sincronizar_alertas_en_estado(respuesta);
    return respuesta;
}

async function marcar_alertas_como_vistas() {
    if (!obtener_token_sesion() || !Number(estado_aplicacion.sesion?.unreadAlerts || 0)) {
        return;
    }

    await consumir_api("/api/alerts/mark-read", {
        method: "POST",
        body: {}
    });
    await cargar_alertas_desde_servidor();
}

async function eliminar_alerta_desde_panel(alertId, botonActivo) {
    if (!alertId) {
        return;
    }

    if (botonActivo) {
        botonActivo.disabled = true;
    }

    try {
        await consumir_api("/api/alerts/delete", {
            method: "POST",
            body: {
                alertId
            }
        });
        await cargar_alertas_desde_servidor();
    } catch (error) {
        mostrar_toast_lateral(error.message || "No fue posible eliminar la alerta.", "error");
    } finally {
        if (botonActivo) {
            botonActivo.disabled = false;
        }
    }
}

function inicializar_accesos_cuenta() {
    const bloque = document.getElementById("bloque_saldo_toggle");
    const contenedor = document.getElementById("contenedor_atajos_cuenta");
    const cerrar = document.getElementById("boton_cerrar_paneles_wallet");
    const botones = document.querySelectorAll(".atajo_icono");
    const paneles = document.querySelectorAll(".panel_icono");
    if (!bloque || !contenedor) return;

    aplicar_iconos_atajo_wallet();

    function alternar() {
        contenedor.classList.toggle("oculto");
        const abierto = !contenedor.classList.contains("oculto");
        bloque.setAttribute("aria-expanded", String(abierto));
        if (!abierto) {
            paneles.forEach(function (panel) { panel.classList.remove("panel_activo"); });
            botones.forEach(function (boton) { boton.classList.remove("atajo_activo"); });
            return;
        }

        desplazar_hacia_bloque(contenedor);
    }

    bloque.addEventListener("click", alternar);
    bloque.addEventListener("keydown", function (evento) {
        if (evento.key === "Enter" || evento.key === " ") {
            evento.preventDefault();
            alternar();
        }
    });

    botones.forEach(function (boton) {
        boton.addEventListener("click", function () {
            const panel = document.getElementById(boton.getAttribute("data-panel"));
            if (!panel) return;

            const estabaActivo = panel.classList.contains("panel_activo");
            paneles.forEach(function (item) { item.classList.remove("panel_activo"); });
            botones.forEach(function (item) { item.classList.remove("atajo_activo"); });

            if (!estabaActivo) {
                panel.classList.add("panel_activo");
                boton.classList.add("atajo_activo");
                desplazar_hacia_bloque(panel);
            }
        });
    });

    if (cerrar) {
        cerrar.addEventListener("click", function () {
            contenedor.classList.add("oculto");
            paneles.forEach(function (panel) { panel.classList.remove("panel_activo"); });
            botones.forEach(function (boton) { boton.classList.remove("atajo_activo"); });
        });
    }
}

function desplazar_hacia_bloque(elemento) {
    if (!elemento) return;

    window.requestAnimationFrame(function () {
        elemento.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    });
}

function aplicar_iconos_atajo_wallet() {
    const iconos = {
        panel_movimientos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16"></path><path d="M7 16V8"></path><path d="M12 16V5"></path><path d="M17 16v-4"></path></svg>',
        panel_favoritos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20l-7-7a4.2 4.2 0 0 1 6-6L12 8l1-1a4.2 4.2 0 0 1 6 6z"></path></svg>',
        panel_tarjetas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3z"></path><path d="M3 11h18"></path><path d="M7 15h3"></path></svg>',
        panel_cuentas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3z"></path><path d="M3 11h18"></path></svg>',
        panel_ahorros: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18"></path><path d="M7 8c0-2 2-3 5-3s5 1 5 3-2 3-5 3-5 1-5 3 2 3 5 3 5-1 5-3"></path></svg>',
        panel_servicios: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"></path><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path></svg>',
        panel_adelanto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16"></path><path d="M7 9l5-5 5 5"></path><path d="M17 15l-5 5-5-5"></path></svg>',
        panel_seguridad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3 7-8 9-5-2-8-4-8-9V7z"></path><path d="M9 12l2 2 4-4"></path></svg>'
    };

    document.querySelectorAll(".atajo_icono").forEach(function (boton) {
        const destino = boton.getAttribute("data-panel");
        const contenedor = boton.querySelector(".simbolo_atajo");
        if (!contenedor || !destino || contenedor.dataset.iconoAplicado) {
            return;
        }

        contenedor.innerHTML = iconos[destino] || "";
        contenedor.dataset.iconoAplicado = "true";
    });
}

// Funcion: obtener_prefijo_telefono_por_defecto
// Aqui fijo el prefijo base de la interfaz para que el registro arranque listo para El Salvador.
function obtener_prefijo_telefono_por_defecto() {
    return PREFIJOS_TELEFONICOS[0]?.codigo || "+503";
}

// Funcion: poblar_selector_prefijo_telefono
// Aqui cargo el listado de paises en el selector y actualizo el ejemplo del numero local segun el prefijo elegido.
function poblar_selector_prefijo_telefono(selector, inputId, prefijoInicial) {
    if (!selector) {
        return;
    }

    if (!selector.dataset.prefijosCargados) {
        selector.innerHTML = PREFIJOS_TELEFONICOS.map(function (prefijo) {
            return `<option value="${prefijo.codigo}" title="${prefijo.pais}" aria-label="${prefijo.pais}">${prefijo.bandera || "🌍"} ${prefijo.codigo}</option>`;
        }).join("");

        selector.addEventListener("change", function () {
            const inputTelefono = document.getElementById(inputId);
            const configuracionPrefijo = PREFIJOS_TELEFONICOS.find(function (prefijo) {
                return prefijo.codigo === selector.value;
            });

            if (configuracionPrefijo) {
                selector.setAttribute("title", `${configuracionPrefijo.pais} (${configuracionPrefijo.codigo})`);
                selector.setAttribute("aria-label", `${configuracionPrefijo.pais} ${configuracionPrefijo.codigo}`);
            }

            if (inputTelefono && configuracionPrefijo?.ejemplo) {
                inputTelefono.placeholder = configuracionPrefijo.ejemplo;
            }
        });

        selector.dataset.prefijosCargados = "true";
    }

    selector.value = prefijoInicial || obtener_prefijo_telefono_por_defecto();
    selector.dispatchEvent(new Event("change"));
}

// Funcion: descomponer_telefono_internacional
// Aqui separo un telefono ya guardado en prefijo y numero local para volver a pintarlo en la interfaz.
function descomponer_telefono_internacional(valor) {
    const telefono = normalizar_telefono_visual(valor).trim();
    const catalogoOrdenado = [...PREFIJOS_TELEFONICOS].sort(function (a, b) {
        return b.codigo.length - a.codigo.length;
    });

    if (!telefono) {
        return {
            prefijo: obtener_prefijo_telefono_por_defecto(),
            numeroLocal: ""
        };
    }

    const telefonoCompacto = telefono.replace(/[^\d+]/g, "");
    const telefonoConMas = telefonoCompacto.startsWith("+")
        ? telefonoCompacto
        : `+${telefonoCompacto.replace(/\D/g, "")}`;
    const prefijoEncontrado = catalogoOrdenado.find(function (prefijo) {
        return telefonoConMas.startsWith(prefijo.codigo);
    });

    if (!prefijoEncontrado) {
        return {
            prefijo: obtener_prefijo_telefono_por_defecto(),
            numeroLocal: telefonoCompacto.replace(/\D/g, "")
        };
    }

    return {
        prefijo: prefijoEncontrado.codigo,
        numeroLocal: telefonoConMas.slice(prefijoEncontrado.codigo.length).replace(/\D/g, "")
    };
}

// Funcion: rellenar_telefono_en_campos
// Aqui tomo el telefono persistido y lo reparto entre el selector de pais y el input del numero local.
function rellenar_telefono_en_campos(selectorId, inputId, telefonoCompleto) {
    const selector = document.getElementById(selectorId);
    const input = document.getElementById(inputId);
    const telefonoSeparado = descomponer_telefono_internacional(telefonoCompleto);

    poblar_selector_prefijo_telefono(selector, inputId, telefonoSeparado.prefijo);

    if (input) {
        input.value = telefonoSeparado.numeroLocal;
    }
}

// Funcion: construir_telefono_desde_campos
// Aqui uno prefijo y numero local para enviarlos al backend como un telefono internacional valido.
function construir_telefono_desde_campos(selectorId, inputId, requerido) {
    const selector = document.getElementById(selectorId);
    const input = document.getElementById(inputId);
    const prefijo = selector?.value || obtener_prefijo_telefono_por_defecto();
    const numeroLocal = normalizar_telefono_local_visual(input?.value || "");

    if (!numeroLocal) {
        if (requerido) {
            throw new Error("Debes completar el telefono.");
        }

        if (input) {
            input.value = "";
        }
        return "";
    }

    if (input) {
        input.value = numeroLocal;
    }

    if (selector) {
        selector.value = prefijo;
    }

    return validar_telefono_frontend(`${prefijo}${numeroLocal}`);
}

async function inicializar_login() {
    const formularioLogin = document.getElementById("formulario_login");
    const formularioRegistro = document.getElementById("formulario_registro");
    const formularioRecuperacion = document.getElementById("formulario_recuperacion");
    const formularioReset = document.getElementById("formulario_reset_password");
    const formularioActivacionRegistro = document.getElementById("formulario_activacion_registro");
    const botonValidarPin = document.getElementById("boton_validar_pin_reset");
    const botonReenviarPinRegistro = document.getElementById("boton_reenviar_pin_registro");
    const selectorPrefijoTelefonoRegistro = document.getElementById("registro_prefijo_telefono");
    const inputTelefonoRegistro = document.getElementById("registro_telefono");
    const inputDuiRegistro = document.getElementById("registro_documento");
    if (!formularioLogin || !formularioRegistro || !formularioRecuperacion || !formularioReset || !botonValidarPin) return;

    const token = obtener_token_sesion();
    if (token) {
        try {
            await obtener_sesion(true);
            window.location.href = "principal.html";
            return;
        } catch (error) {
            limpiar_sesion_local();
        }
    }

    try {
        estado_aplicacion.bootstrap = await consumir_api("/api/auth/bootstrap", {
            omitirAutorizacion: true
        });
        aplicar_estado_bootstrap_login(estado_aplicacion.bootstrap);
    } catch (error) {
        console.warn("No pude cargar el estado inicial del login:", error.message);
    }

    inicializar_modales_wallet();
    inicializar_activacion_registro_modal(formularioActivacionRegistro, botonReenviarPinRegistro);

    document.querySelectorAll("[data-modo-acceso]").forEach(function (boton) {
        boton.addEventListener("click", function () {
            activar_panel_acceso(boton.getAttribute("data-modo-acceso"));
        });
    });

    document.querySelectorAll("[data-cambiar-acceso]").forEach(function (enlace) {
        enlace.addEventListener("click", function (evento) {
            evento.preventDefault();
            activar_panel_acceso(enlace.getAttribute("data-cambiar-acceso"));
        });
    });

    const modoUrl = obtener_parametro_url("modo");
    const modoInicial = estado_aplicacion.bootstrap?.requiresRegistration
        ? "registro"
        : (modoUrl === "reset" ? "reset" : "login");
    activar_panel_acceso(modoInicial);
    sincronizar_reset_desde_url();
    await sincronizar_activacion_registro_desde_url();
    inicializar_flujo_pin_recuperacion();
    mostrar_estado_sesion_desde_url();
    poblar_selector_prefijo_telefono(selectorPrefijoTelefonoRegistro, "registro_telefono", obtener_prefijo_telefono_por_defecto());
    aplicar_formato_telefono_input(inputTelefonoRegistro);
    aplicar_formato_documento_input(inputDuiRegistro);

    formularioLogin.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        let correo = obtener_valor("correo_usuario");
        const contrasena = obtener_valor("contrasena_usuario");

        try {
            correo = validar_correo_frontend(correo);
            if (!contrasena) {
                throw new Error("Completa correo y contrasena.");
            }

            mostrar_mensaje("mensaje_login", "Validando acceso...", "info");
            const respuesta = await consumir_api("/api/auth/login", {
                method: "POST",
                omitirAutorizacion: true,
                body: {
                    email: correo,
                    password: contrasena
                }
            });

            guardar_sesion_desde_respuesta(respuesta);
            mostrar_mensaje("mensaje_login", "Acceso correcto. Redirigiendo...", "exito");
            window.location.href = "principal.html";
        } catch (error) {
            mostrar_mensaje("mensaje_login", error.message || "No fue posible iniciar sesion.", "error");
            if ((error.message || "").toLowerCase().includes("verificada")) {
                preparar_modal_activacion_registro(correo, "");
                abrir_modal_wallet("modal_activacion_registro");
            }
        }
    });

    formularioRegistro.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        let password = obtener_valor("registro_contrasena");
        const confirmacion = obtener_valor("registro_confirmacion");

        if (!passwords_coinciden(password, confirmacion)) {
            mostrar_mensaje("mensaje_registro", "Las contrasenas del registro no coinciden.", "error");
            return;
        }

        mostrar_mensaje("mensaje_registro", "Creando usuario y cuenta principal...", "info");

        try {
            const firstName = validar_nombre_humano_frontend(obtener_valor("registro_nombres"), "los nombres");
            const lastName = validar_nombre_humano_frontend(obtener_valor("registro_apellidos"), "los apellidos");
            const email = validar_correo_frontend(obtener_valor("registro_correo"));
            const phone = construir_telefono_desde_campos("registro_prefijo_telefono", "registro_telefono", true);
            const birthDate = validar_fecha_nacimiento_frontend(obtener_valor("registro_fecha_nacimiento"), true);
            const documentId = validar_dui_frontend(obtener_valor("registro_documento"));
            const address = validar_direccion_frontend(obtener_valor("registro_direccion"), true);
            password = validar_password_segura_frontend(password);

            establecer_valor("registro_correo", email);
            establecer_valor("registro_documento", documentId);
            establecer_valor("registro_direccion", address);

            const respuesta = await consumir_api("/api/auth/register", {
                method: "POST",
                omitirAutorizacion: true,
                body: {
                    firstName,
                    lastName,
                    email,
                    phone,
                    birthDate,
                    documentId,
                    address,
                    password
                }
            });

            mostrar_mensaje("mensaje_registro", respuesta.message || "Registro correcto.", "exito");

            establecer_valor("correo_usuario", email);
            establecer_valor("contrasena_usuario", "");
            formularioRegistro.reset();
            estado_aplicacion.bootstrap = {
                hasUsers: true,
                requiresRegistration: false,
                totalUsers: Math.max(1, Number(estado_aplicacion.bootstrap?.totalUsers || 0))
            };
            aplicar_estado_bootstrap_login(estado_aplicacion.bootstrap);
            preparar_modal_activacion_registro(email, respuesta.previewPin || "");
            abrir_modal_wallet("modal_activacion_registro");
            mostrar_mensaje(
                "mensaje_activacion_registro",
                respuesta.previewMode && respuesta.previewPin
                    ? "El entorno esta en preview, asi que ya cargue el PIN temporal para que completes la activacion."
                    : (respuesta.message || "Revisa tu correo para activar la cuenta."),
                respuesta.previewMode ? "info" : "exito"
            );
        } catch (error) {
            mostrar_mensaje("mensaje_registro", error.message || "No fue posible completar el registro.", "error");
        }
    });

    formularioRecuperacion.addEventListener("submit", async function (evento) {
        evento.preventDefault();

        try {
            const email = validar_correo_frontend(obtener_valor("recuperacion_correo"));
            mostrar_mensaje("mensaje_recuperacion", "Enviando PIN de recuperacion...", "info");
            const respuesta = await consumir_api("/api/auth/password-reset/request", {
                method: "POST",
                omitirAutorizacion: true,
                body: {
                    email
                }
            });

            mostrar_mensaje("mensaje_recuperacion", "Si tu cuenta existe, revisa tu correo para continuar.", "exito");
            preparar_panel_reset(email, "");
            activar_panel_acceso("reset");

            if (respuesta.previewMode && respuesta.previewPin) {
                preparar_panel_reset(email, respuesta.previewPin);
                mostrar_mensaje(
                    "mensaje_reset_password",
                    "El canal real no esta configurado todavia, asi que cargue un PIN temporal para que puedas seguir probando localmente.",
                    "info"
                );
            }
        } catch (error) {
            mostrar_mensaje("mensaje_recuperacion", error.message || "No fue posible iniciar la recuperacion.", "error");
        }
    });

    botonValidarPin.addEventListener("click", async function () {
        await validar_pin_recuperacion();
    });

        formularioReset.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            if (!estado_aplicacion.pinRecuperacionVerificado) {
                mostrar_mensaje("mensaje_reset_password", "Primero valida tu PIN para habilitar el cambio de contrasena.", "error");
                return;
        }

        let newPassword = obtener_valor("reset_nueva_contrasena");
        const confirmacion = obtener_valor("reset_confirmacion_contrasena");

        if (!passwords_coinciden(newPassword, confirmacion)) {
            mostrar_mensaje("mensaje_reset_password", "Las nuevas contrasenas no coinciden.", "error");
            return;
        }

        try {
            const email = validar_correo_frontend(obtener_valor("reset_correo"));
            newPassword = validar_password_segura_frontend(newPassword);
            mostrar_mensaje("mensaje_reset_password", "Actualizando contrasena...", "info");
            const respuesta = await consumir_api("/api/auth/password-reset/confirm", {
                method: "POST",
                omitirAutorizacion: true,
                body: {
                    email,
                    pin: obtener_valor("reset_pin"),
                    newPassword
                }
            });

            mostrar_mensaje("mensaje_reset_password", respuesta.message, "exito");
            limpiar_query_login();
            if (respuesta.token) {
                guardar_sesion_desde_respuesta(respuesta);
                window.location.href = "principal.html";
                return;
            }

            formularioReset.reset();
            activar_panel_acceso("login");
        } catch (error) {
            mostrar_mensaje("mensaje_reset_password", error.message || "No fue posible actualizar la contrasena.", "error");
        }
    });
}

function aplicar_estado_bootstrap_login(bootstrap) {
    const botonLogin = document.querySelector('[data-modo-acceso="login"]');
    const botonRegistro = document.querySelector('[data-modo-acceso="registro"]');
    const enlacesRecuperacion = document.querySelector(".enlaces_login");
    const avisoBootstrap = document.getElementById("mensaje_bootstrap_login");

    if (!bootstrap) {
        return;
    }

    if (botonLogin) {
        botonLogin.disabled = Boolean(bootstrap.requiresRegistration);
    }

    if (bootstrap.requiresRegistration) {
        activar_panel_acceso("registro");
        if (avisoBootstrap) {
            avisoBootstrap.textContent = "La base esta vacia. Primero debes registrar la cuenta inicial para habilitar el acceso.";
            avisoBootstrap.classList.remove("oculto");
        }

        // Aqui lanzo un aviso de apertura cuando no existe ningun usuario.
        // La idea es que el visitante entienda de inmediato que la web detecto
        // una base vacia y que por eso se le llevo directo al registro inicial.
        if (!estado_aplicacion.avisoBaseVaciaMostrado) {
            mostrar_aviso_base_vacia();
            estado_aplicacion.avisoBaseVaciaMostrado = true;
        }

        mostrar_mensaje(
            "mensaje_registro",
            "Todavia no existe ningun usuario. Registra la primera cuenta para habilitar el inicio de sesion.",
            "info"
        );
        if (enlacesRecuperacion) {
            enlacesRecuperacion.style.display = "none";
        }
        return;
    }

    if (botonRegistro) {
        botonRegistro.disabled = false;
    }

    if (avisoBootstrap) {
        avisoBootstrap.textContent = "";
        avisoBootstrap.classList.add("oculto");
    }

    estado_aplicacion.avisoBaseVaciaMostrado = false;

    if (enlacesRecuperacion) {
        enlacesRecuperacion.style.display = "";
    }
}

// Funcion: mostrar_aviso_base_vacia
// Aqui muestro una notificacion inicial cuando la web detecta que no hay
// usuarios registrados. La interfaz ya cambia al panel de registro, pero
// este aviso deja claro por que sucedio desde el momento en que abre la pagina.
function mostrar_aviso_base_vacia() {
    const titulo = "No hay usuarios registrados";
    const texto = "La base esta vacia. Te llevamos directo al registro para crear la primera cuenta.";

    if (window.Swal) {
        window.Swal.fire({
            icon: "info",
            title: titulo,
            text: texto,
            confirmButtonText: "Ir al registro",
            confirmButtonColor: obtener_color_css("--color_morado_principal", "#6f3df4"),
            background: obtener_color_css("--color_superficie_solida", "#ffffff"),
            color: obtener_color_css("--color_texto_principal", "#1d152d")
        });
        return;
    }

    mostrar_toast_lateral(texto, "info");
}

function inicializar_flujo_pin_recuperacion() {
    ["reset_correo", "reset_pin"].forEach(function (idCampo) {
        const campo = document.getElementById(idCampo);
        if (!campo || campo.dataset.pinRecoveryReady) return;

        campo.addEventListener("input", function () {
            bloquear_cambio_password_reset(true);
        });
        campo.dataset.pinRecoveryReady = "true";
    });

    bloquear_cambio_password_reset(false);
}

function preparar_panel_reset(correo, pin) {
    if (correo) {
        establecer_valor("reset_correo", correo);
        establecer_valor("recuperacion_correo", correo);
    }

    if (pin) {
        establecer_valor("reset_pin", pin);
    }

    bloquear_cambio_password_reset(true);
}

// Funcion: clean_pin_visual
// Aqui limpio el PIN para dejarlo solo numerico antes de enviarlo al backend.
function clean_pin_visual(valor) {
    return String(valor || "").replace(/\D/g, "").slice(0, 6);
}

// Funcion: preparar_modal_activacion_registro
// Aqui precargo el correo y el PIN dentro del modal de activacion.
// Lo reutilizo tanto al terminar el registro como cuando el usuario aterriza desde el enlace del correo.
function preparar_modal_activacion_registro(correo, pin) {
    establecer_valor("activacion_registro_correo", correo || "");
    establecer_valor("activacion_registro_pin", clean_pin_visual(pin));
}

// Funcion: verificar_activacion_registro
// Este es el submit real de activacion:
// toma correo y PIN desde el modal, llama POST /api/auth/register/verify
// y si todo sale bien guarda la sesion devuelta por el backend.
async function verificar_activacion_registro(opciones = {}) {
    const correo = validar_correo_frontend(opciones.correo || obtener_valor("activacion_registro_correo"));
    const pin = clean_pin_visual(opciones.pin || obtener_valor("activacion_registro_pin"));

    if (!pin) {
        throw new Error("Ingresa el PIN de activacion enviado al correo.");
    }

    mostrar_mensaje(
        "mensaje_activacion_registro",
        opciones.automatico ? "Validando enlace de activacion..." : "Validando PIN de activacion...",
        "info"
    );

    const respuesta = await consumir_api("/api/auth/register/verify", {
        method: "POST",
        omitirAutorizacion: true,
        body: {
            email: correo,
            pin
        }
    });

    guardar_sesion_desde_respuesta(respuesta);
    mostrar_mensaje("mensaje_activacion_registro", respuesta.message || "Cuenta activada correctamente.", "exito");
    cerrar_modal_wallet("modal_activacion_registro");
    limpiar_query_login();
    window.location.href = "principal.html";
    return respuesta;
}

// Funcion: reenviar_pin_activacion_registro
// Aqui disparo otro correo de activacion para una cuenta aun pendiente.
async function reenviar_pin_activacion_registro() {
    const correo = validar_correo_frontend(obtener_valor("activacion_registro_correo"));
    mostrar_mensaje("mensaje_activacion_registro", "Reenviando PIN de activacion...", "info");

    const respuesta = await consumir_api("/api/auth/register/resend", {
        method: "POST",
        omitirAutorizacion: true,
        body: {
            email: correo
        }
    });

    if (respuesta.previewMode && respuesta.previewPin) {
        establecer_valor("activacion_registro_pin", respuesta.previewPin);
    }

    mostrar_mensaje(
        "mensaje_activacion_registro",
        respuesta.previewMode && respuesta.previewPin
            ? "Se genero un nuevo PIN temporal y ya quedo cargado en el modal."
            : (respuesta.message || "Te reenviamos un nuevo PIN de activacion."),
        respuesta.previewMode ? "info" : "exito"
    );
}

// Funcion: inicializar_activacion_registro_modal
// Aqui engancho las acciones del modal:
// verificar el PIN o reenviarlo si la activacion todavia esta pendiente.
function inicializar_activacion_registro_modal(formulario, botonReenviar) {
    const campoPin = document.getElementById("activacion_registro_pin");

    if (campoPin && !campoPin.dataset.pinNormalizado) {
        campoPin.addEventListener("input", function () {
            campoPin.value = clean_pin_visual(campoPin.value);
        });
        campoPin.dataset.pinNormalizado = "true";
    }

    if (formulario && !formulario.dataset.inicializado) {
        formulario.addEventListener("submit", async function (evento) {
            evento.preventDefault();

            try {
                await verificar_activacion_registro();
            } catch (error) {
                mostrar_mensaje("mensaje_activacion_registro", error.message || "No fue posible activar la cuenta.", "error");
            }
        });
        formulario.dataset.inicializado = "true";
    }

    if (botonReenviar && !botonReenviar.dataset.inicializado) {
        botonReenviar.addEventListener("click", async function () {
            try {
                await reenviar_pin_activacion_registro();
            } catch (error) {
                mostrar_mensaje("mensaje_activacion_registro", error.message || "No fue posible reenviar el PIN.", "error");
            }
        });
        botonReenviar.dataset.inicializado = "true";
    }
}

function bloquear_cambio_password_reset(limpiarCampos) {
    estado_aplicacion.pinRecuperacionVerificado = false;

    const bloque = document.getElementById("bloque_campos_password_reset");
    const botonConfirmar = document.getElementById("boton_confirmar_reset_password");
    const campoNueva = document.getElementById("reset_nueva_contrasena");
    const campoConfirmacion = document.getElementById("reset_confirmacion_contrasena");

    if (bloque) {
        bloque.classList.add("bloque_password_reset_bloqueado");
        bloque.setAttribute("aria-disabled", "true");
    }

    [campoNueva, campoConfirmacion].forEach(function (campo) {
        if (!campo) return;
        campo.disabled = true;
        if (limpiarCampos !== false) {
            campo.value = "";
        }
    });

    if (botonConfirmar) {
        botonConfirmar.disabled = true;
    }
}

function habilitar_cambio_password_reset() {
    estado_aplicacion.pinRecuperacionVerificado = true;

    const bloque = document.getElementById("bloque_campos_password_reset");
    const botonConfirmar = document.getElementById("boton_confirmar_reset_password");
    const campoNueva = document.getElementById("reset_nueva_contrasena");
    const campoConfirmacion = document.getElementById("reset_confirmacion_contrasena");

    if (bloque) {
        bloque.classList.remove("bloque_password_reset_bloqueado");
        bloque.setAttribute("aria-disabled", "false");
    }

    [campoNueva, campoConfirmacion].forEach(function (campo) {
        if (!campo) return;
        campo.disabled = false;
    });

    if (botonConfirmar) {
        botonConfirmar.disabled = false;
    }

    if (campoNueva) {
        campoNueva.focus();
    }
}

async function validar_pin_recuperacion() {
    let correo = obtener_valor("reset_correo");
    const pin = obtener_valor("reset_pin");

    try {
        correo = validar_correo_frontend(correo);
        if (!pin) {
            throw new Error("Completa tu correo y el PIN para validar el acceso.");
        }

        mostrar_mensaje("mensaje_reset_password", "Validando PIN...", "info");
        const respuesta = await consumir_api("/api/auth/password-reset/verify", {
            method: "POST",
            omitirAutorizacion: true,
            body: {
                email: correo,
                pin
            }
        });

        habilitar_cambio_password_reset();
        mostrar_mensaje("mensaje_reset_password", respuesta.message || "PIN valido.", "exito");
        return true;
    } catch (error) {
        bloquear_cambio_password_reset(false);
        mostrar_mensaje("mensaje_reset_password", error.message || "No fue posible validar el PIN.", "error");
        return false;
    }
}

async function inicializar_principal() {
    inicializar_formularios_principal();
    sincronizar_picker_color_ahorro();
    await cargar_panel_wallet_completo();
}

async function cargar_panel_wallet_completo() {
    const [dashboard, centroTarjetas, centroAhorros, centroServicios, centroAdelanto] = await Promise.all([
        consumir_api("/api/dashboard"),
        consumir_api("/api/cards"),
        consumir_api("/api/savings"),
        consumir_api("/api/services/center"),
        consumir_api("/api/salary-advance")
    ]);

    estado_aplicacion.centros.tarjetas = centroTarjetas;
    estado_aplicacion.centros.ahorros = centroAhorros;
    estado_aplicacion.centros.servicios = centroServicios;
    estado_aplicacion.centros.adelanto = centroAdelanto;

    renderizar_principal(dashboard);
    renderizar_centro_tarjetas(centroTarjetas);
    renderizar_centro_ahorros(centroAhorros);
    renderizar_centro_servicios(centroServicios);
    renderizar_centro_adelanto(centroAdelanto);
}

function renderizar_principal(data) {
    const resumen = data.summary || {};
    const cuentaPrincipal = resumen.cuentaPrincipal || null;
    const mensual = resumen.monthly || {};
    const seguridad = resumen.seguridad || {};

    establecer_texto("texto_saldo_disponible", formatear_moneda(resumen.saldoDisponibleTotal || 0));
    establecer_texto("texto_saldo_contable", "Saldo contable: " + formatear_moneda(resumen.saldoContableTotal || 0));
    establecer_texto(
        "texto_cuenta_saldo",
        cuentaPrincipal
            ? "Cuenta: " + cuentaPrincipal.numeroCuenta + " | " + cuentaPrincipal.aliasCuenta
            : "Aun no hay una cuenta principal disponible."
    );
    establecer_texto("texto_limite_diario", formatear_moneda(resumen.saldoRetenidoTotal || 0));
    establecer_texto(
        "texto_proximo_pago",
        resumen.proximoPago
            ? resumen.proximoPago.nombreServicio + " | " + resumen.proximoPago.fechaTexto
            : "Sin pagos programados"
    );
    establecer_texto(
        "texto_estado_cuenta",
        resumen.adelantoActivo
            ? `Adelanto activo ${resumen.adelantoActivo.numeroAdelanto}`
            : cuentaPrincipal
                ? `${(data.accounts || []).length} cuenta(s) operativas`
                : "Completa tu perfil para activar mas funciones"
    );
    renderizar_alerta_adelanto(resumen.adelantoActivo || null);

    renderizar_lista_movimientos_recientes(data.recentMovements || []);
    renderizar_resumen_mensual(mensual);
    renderizar_favoritos_principales(data.favoriteBeneficiaries || []);
    renderizar_pagos_programados(data.scheduledPayments || []);
    renderizar_suscripciones(data.subscriptions || []);
    renderizar_cuentas(data.accounts || []);
    renderizar_tarjetas(data.cards || []);
}

function renderizar_alerta_adelanto(adelanto) {
    const nota = document.getElementById("texto_alerta_adelanto");
    if (!nota) return;

    if (!adelanto) {
        nota.textContent = "";
        nota.classList.add("oculto");
        return;
    }

    nota.textContent = `Adelanto activo ${adelanto.numeroAdelanto} | Pago ${adelanto.fechaPagoTexto}`;
    nota.classList.remove("oculto");
}

function renderizar_lista_movimientos_recientes(lista) {
    const contenedor = document.getElementById("lista_movimientos_recientes");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    if (!lista.length) {
        agregar_li(contenedor, "No hay movimientos recientes.");
        return;
    }

    lista.forEach(function (movimiento) {
        const item = document.createElement("li");
        item.className = "lista_item_resumen";
        item.innerHTML = [
            `<strong>${escapar_html(movimiento.tipo || "Movimiento")} | ${escapar_html(movimiento.fecha || "Sin fecha")}</strong>`,
            `<span>${escapar_html(movimiento.detalle || "Operacion registrada")} | ${formatear_monto_con_signo(movimiento.monto)}</span>`
        ].join("");
        contenedor.appendChild(item);
    });
}

function renderizar_resumen_mensual(resumen) {
    renderizar_lista_resumen_compacto("lista_resumen_mensual", [
        {
            titulo: "Movimientos visibles",
            detalle: `${resumen.totalMovimientos || 0} registro(s) detectados en el periodo.`
        },
        {
            titulo: "Depositos del mes",
            detalle: `${resumen.depositosMes || 0} ingreso(s) acreditados.`
        },
        {
            titulo: "Pagos del mes",
            detalle: `${resumen.pagosMes || 0} salida(s) aplicadas.`
        },
        {
            titulo: "Transferencias",
            detalle: `${resumen.transferenciasMes || 0} movimiento(s) entre cuentas o terceros.`
        },
        {
            titulo: "Volumen total",
            detalle: formatear_moneda(resumen.volumenMes || 0)
        }
    ]);
}

function renderizar_alertas_seguridad(seguridad, adelantoActivo) {
    const items = [
        {
            titulo: "Doble factor",
            detalle: seguridad.dobleFactorActivo
                ? "Activo y listo para reforzar tus accesos."
                : "Inactivo. Conviene reforzarlo cuando completes la configuracion.",
            clase: seguridad.dobleFactorActivo ? "estado_seguridad_ok" : ""
        },
        {
            titulo: "Intentos fallidos",
            detalle: `${seguridad.intentosFallidos || 0} registro(s) recientes en tu historial de acceso.`,
            clase: Number(seguridad.intentosFallidos || 0) > 0 ? "estado_seguridad_critico" : ""
        },
        {
            titulo: "Ultimo inicio de sesion",
            detalle: formatear_fecha(seguridad.ultimoLoginExitoso) || "Todavia no hay un acceso confirmado."
        },
        {
            titulo: "Ultimo cambio de clave",
            detalle: formatear_fecha(seguridad.ultimoCambioPassword) || "Aun no se ha actualizado la contrasena."
        }
    ];

    if (adelantoActivo) {
        items.push({
            titulo: "Adelanto activo",
            detalle: `${adelantoActivo.numeroAdelanto} | Pago programado ${adelantoActivo.fechaPagoTexto}`,
            clase: "estado_seguridad_critico"
        });
    }

    renderizar_lista_estado_seguridad("lista_seguridad_perfil", items);
    actualizar_meta_desplegable(
        "meta_seguridad_perfil",
        `Ultimo cambio ${formatear_fecha(seguridad.ultimoCambioPassword)} | ${seguridad.intentosFallidos || 0} intento(s) fallidos`
    );
}

function renderizar_lista_estado_seguridad(id, items) {
    const lista = document.getElementById(id);
    if (!lista) {
        return;
    }

    lista.innerHTML = "";

    items.forEach(function (item) {
        const elemento = document.createElement("li");
        if (item.clase) {
            elemento.classList.add(item.clase);
        }
        elemento.innerHTML = `<strong>${escapar_html(item.titulo)}</strong><span>${escapar_html(item.detalle)}</span>`;
        lista.appendChild(elemento);
    });
}

function renderizar_lista_resumen_compacto(id, items) {
    const lista = document.getElementById(id);
    if (!lista) {
        return;
    }

    lista.innerHTML = "";
    items.forEach(function (item) {
        const elemento = document.createElement("li");
        elemento.className = "lista_item_resumen";
        elemento.innerHTML = `<strong>${escapar_html(item.titulo)}</strong><span>${escapar_html(item.detalle)}</span>`;
        lista.appendChild(elemento);
    });
}

function renderizar_favoritos_principales(favoritos) {
    renderizar_favoritos_con_acciones("lista_contactos_frecuentes", favoritos, {
        mensajeVacio: "No hay favoritos registrados."
    });
}

function renderizar_pagos_programados(pagos) {
    const items = pagos.map(function (pago) {
        return pago.nombreServicio + " | " + pago.fechaTexto + " | " + formatear_moneda(pago.monto);
    });
    renderizar_lista_textos("lista_pagos_programados", items.length ? items : ["No hay pagos programados activos."]);
}

function renderizar_suscripciones(suscripciones) {
    const items = suscripciones.map(function (suscripcion) {
        return suscripcion.nombreServicio + " | " + formatear_moneda(suscripcion.monto) + " | " + suscripcion.frecuencia;
    });
    renderizar_lista_textos("lista_suscripciones", items.length ? items : ["No hay suscripciones activas."]);
}

function renderizar_cuentas(cuentas) {
    const lista = document.getElementById("lista_cuentas_wallet");
    const detalle = document.getElementById("detalle_cuentas_wallet");
    if (!lista || !detalle) return;

    lista.innerHTML = "";
    detalle.innerHTML = "";

    if (!cuentas.length) {
        agregar_li(lista, "No hay cuentas registradas.");
        return;
    }

    cuentas.forEach(function (cuenta) {
        const item = document.createElement("li");
        const nombre = document.createElement("span");
        const saldo = document.createElement("strong");
        const tipoVisible = cuenta.esPrincipal ? "Principal" : "Secundaria";
        nombre.textContent = `${cuenta.aliasCuenta} | ${cuenta.numeroCuenta} | ${tipoVisible}`;
        saldo.textContent = formatear_moneda(cuenta.saldoDisponible);
        item.appendChild(nombre);
        item.appendChild(saldo);
        lista.appendChild(item);

        const tarjeta = document.createElement("article");
        tarjeta.className = "tarjeta_detalle_cuenta";
        tarjeta.innerHTML =
            "<p>" + escapar_html(cuenta.aliasCuenta) + "</p>" +
            "<strong>" + escapar_html(tipoVisible) + " | " + escapar_html(capitalizar(cuenta.estado)) + " | Disponible " + formatear_moneda(cuenta.saldoDisponible) + " | Retenido " + formatear_moneda(cuenta.saldoRetenido) + "</strong>";
        detalle.appendChild(tarjeta);
    });
}

function renderizar_tarjetas(tarjetas) {
    const contenedor = document.getElementById("contenedor_tarjetas_wallet");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    if (!tarjetas.length) {
        const articulo = document.createElement("article");
        articulo.className = "bloque_banco";
        articulo.innerHTML = '<div class="tarjeta_visual"><p>Tarjetas</p><strong>No hay tarjetas vinculadas</strong><small>Agrega una tarjeta desde tu wallet cuando la necesites.</small></div>';
        contenedor.appendChild(articulo);
        return;
    }

    tarjetas.forEach(function (tarjeta) {
        const articulo = document.createElement("article");
        articulo.className = "bloque_banco";
        articulo.innerHTML =
            '<div class="tarjeta_visual">' +
            "<p>" + escapar_html(capitalizar(tarjeta.marca)) + " | " + escapar_html(tarjeta.alias) + "</p>" +
            "<strong>**** **** **** " + escapar_html(tarjeta.ultimos4) + "</strong>" +
            "<small>" + escapar_html(tarjeta.cuentaAlias) + " | Limite del emisor: " + formatear_moneda(tarjeta.limiteDiario) + "</small>" +
            "</div>";
        contenedor.appendChild(articulo);
    });
}

function inicializar_formularios_principal() {
    const formularioFavorito = document.getElementById("formulario_favorito");
    const formularioTarjeta = document.getElementById("formulario_tarjeta");
    const formularioCuentaSecundaria = document.getElementById("formulario_cuenta_secundaria");
    const formularioAhorro = document.getElementById("formulario_ahorro");
    const formularioAporteAhorro = document.getElementById("formulario_aporte_ahorro");
    const formularioVincularServicio = document.getElementById("formulario_vincular_servicio");
    const formularioPagoServicio = document.getElementById("formulario_pago_servicio");
    const formularioAdelanto = document.getElementById("formulario_adelanto");
    const formularioRecuperacionModal = document.getElementById("formulario_recuperacion_modal");
    const formularioResetModal = document.getElementById("formulario_reset_modal");
    const botonValidarPinModal = document.getElementById("boton_validar_pin_modal");
    const botonSolicitarCodigoAdelanto = document.getElementById("boton_solicitar_codigo_adelanto");
    const selectServicioVinculado = document.getElementById("pago_servicio_vinculado_id");
    const selectProveedorManual = document.getElementById("pago_servicio_proveedor_id");

    inicializar_modales_wallet();
    sincronizar_picker_color_ahorro();
    inicializar_recuperacion_seguridad_modal(formularioRecuperacionModal, formularioResetModal, botonValidarPinModal);

    if (formularioFavorito && !formularioFavorito.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Este submit captura el formulario del modal de favorito
        // y crea o actualiza el beneficiario via POST /api/beneficiaries.
        formularioFavorito.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_favoritos", "mensaje_favoritos_modal"], "Guardando favorito...", "info");

            try {
                const respuesta = await consumir_api("/api/beneficiaries", {
                    method: "POST",
                    body: {
                        recipientName: obtener_valor("favorito_nombre"),
                        recipientAlias: obtener_valor("favorito_alias"),
                        destinationBank: obtener_valor("favorito_banco"),
                        destinationAccount: obtener_valor("favorito_numero_cuenta"),
                        destinationType: "bancaria",
                        saveFavorite: true
                    }
                });

                formularioFavorito.reset();
                cerrar_modal_wallet("modal_favorito_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_favoritos", "mensaje_favoritos_modal"], respuesta.message || "Favorito guardado.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_favoritos", "mensaje_favoritos_modal"], error.message || "No fue posible guardar el favorito.", "error");
            }
        });
        formularioFavorito.dataset.inicializado = "true";
    }

    if (formularioTarjeta && !formularioTarjeta.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Aqui tomo los datos del modal de tarjeta
        // y los envio a POST /api/cards para vincular una tarjeta externa.
        formularioTarjeta.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_tarjetas", "mensaje_tarjetas_modal"], "Vinculando tarjeta...", "info");

            try {
                const respuesta = await consumir_api("/api/cards", {
                    method: "POST",
                    body: {
                        accountId: obtener_valor("tarjeta_cuenta_id"),
                        bankId: obtener_valor("tarjeta_banco_id"),
                        alias: obtener_valor("tarjeta_alias"),
                        brand: obtener_valor("tarjeta_marca"),
                        cardType: obtener_valor("tarjeta_tipo"),
                        last4: obtener_valor("tarjeta_ultimos4"),
                        holderName: obtener_valor("tarjeta_titular"),
                        dailyLimit: obtener_valor("tarjeta_limite_diario"),
                        expiryMonth: obtener_valor("tarjeta_vence_mes"),
                        expiryYear: obtener_valor("tarjeta_vence_anio"),
                        makeDefault: Boolean(document.getElementById("tarjeta_predeterminada")?.checked)
                    }
                });

                formularioTarjeta.reset();
                cerrar_modal_wallet("modal_tarjeta_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_tarjetas", "mensaje_tarjetas_modal"], respuesta.message || "Tarjeta vinculada.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_tarjetas", "mensaje_tarjetas_modal"], error.message || "No fue posible vincular la tarjeta.", "error");
            }
        });
        formularioTarjeta.dataset.inicializado = "true";
    }

    if (formularioCuentaSecundaria && !formularioCuentaSecundaria.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Este submit crea una cuenta secundaria usando POST /api/accounts.
        formularioCuentaSecundaria.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_cuentas", "mensaje_cuenta_modal"], "Creando cuenta secundaria...", "info");

            try {
                const respuesta = await consumir_api("/api/accounts", {
                    method: "POST",
                    body: {
                        alias: obtener_valor("cuenta_secundaria_alias"),
                        currency: obtener_valor("cuenta_secundaria_moneda")
                    }
                });

                formularioCuentaSecundaria.reset();
                cerrar_modal_wallet("modal_cuenta_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_cuentas", "mensaje_cuenta_modal"], respuesta.message || "Cuenta secundaria creada.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_cuentas", "mensaje_cuenta_modal"], error.message || "No fue posible crear la cuenta secundaria.", "error");
            }
        });
        formularioCuentaSecundaria.dataset.inicializado = "true";
    }

    if (formularioAhorro && !formularioAhorro.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Aqui creo un nuevo bolsillo de ahorro con POST /api/savings.
        formularioAhorro.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_meta_ahorro", "mensaje_meta_ahorro_modal"], "Creando bolsillo de ahorro...", "info");

            try {
                const respuesta = await consumir_api("/api/savings", {
                    method: "POST",
                    body: {
                        accountId: obtener_valor("ahorro_cuenta_id"),
                        name: obtener_valor("ahorro_nombre"),
                        targetAmount: obtener_valor("ahorro_meta"),
                        color: obtener_valor("ahorro_color")
                    }
                });

                formularioAhorro.reset();
                establecer_valor("ahorro_color", "#6f3df4");
                sincronizar_picker_color_ahorro();
                cerrar_modal_wallet("modal_meta_ahorro_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_meta_ahorro", "mensaje_meta_ahorro_modal"], respuesta.message || "Ahorro creado.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_meta_ahorro", "mensaje_meta_ahorro_modal"], error.message || "No fue posible crear el ahorro.", "error");
            }
        });
        formularioAhorro.dataset.inicializado = "true";
    }

    if (formularioAporteAhorro && !formularioAporteAhorro.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Aqui envio un deposito desde la cuenta wallet hacia el bolsillo de ahorro
        // usando POST /api/savings/deposit.
        formularioAporteAhorro.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_aporte_ahorro", "mensaje_aporte_ahorro_modal"], "Moviendo saldo a ahorro...", "info");

            try {
                const respuesta = await consumir_api("/api/savings/deposit", {
                    method: "POST",
                    body: {
                        accountId: obtener_valor("aporte_ahorro_cuenta_id"),
                        pocketId: obtener_valor("aporte_ahorro_bolsillo_id"),
                        amount: obtener_valor("aporte_ahorro_monto")
                    }
                });

                formularioAporteAhorro.reset();
                cerrar_modal_wallet("modal_aporte_ahorro_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_aporte_ahorro", "mensaje_aporte_ahorro_modal"], respuesta.message || "Ahorro actualizado.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_aporte_ahorro", "mensaje_aporte_ahorro_modal"], error.message || "No fue posible mover el saldo a ahorro.", "error");
            }
        });
        formularioAporteAhorro.dataset.inicializado = "true";
    }

    if (formularioVincularServicio && !formularioVincularServicio.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Aqui vinculo un servicio recurrente del usuario
        // usando POST /api/services/link.
        formularioVincularServicio.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_vincular_servicio", "mensaje_vincular_servicio_modal"], "Vinculando servicio...", "info");

            try {
                const respuesta = await consumir_api("/api/services/link", {
                    method: "POST",
                    body: {
                        providerId: obtener_valor("servicio_proveedor_id"),
                        alias: obtener_valor("servicio_alias"),
                        serviceIdentifier: obtener_valor("servicio_identificador"),
                        accountId: obtener_valor("servicio_cuenta_id")
                    }
                });

                formularioVincularServicio.reset();
                cerrar_modal_wallet("modal_vincular_servicio_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_vincular_servicio", "mensaje_vincular_servicio_modal"], respuesta.message || "Servicio vinculado.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_vincular_servicio", "mensaje_vincular_servicio_modal"], error.message || "No fue posible vincular el servicio.", "error");
            }
        });
        formularioVincularServicio.dataset.inicializado = "true";
    }

    if (selectServicioVinculado && !selectServicioVinculado.dataset.inicializado) {
        selectServicioVinculado.addEventListener("change", sincronizar_pago_servicio_desde_vinculo);
        selectServicioVinculado.dataset.inicializado = "true";
    }

    if (selectProveedorManual && !selectProveedorManual.dataset.inicializado) {
        selectProveedorManual.addEventListener("change", sincronizar_pago_servicio_desde_vinculo);
        selectProveedorManual.dataset.inicializado = "true";
    }

    if (formularioPagoServicio && !formularioPagoServicio.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Aqui primero uso SweetAlert2 con confirmar_accion()
        // y luego mando POST /api/services/pay para ejecutar el pago.
        formularioPagoServicio.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            const monto = Number(obtener_valor("pago_servicio_monto"));
            const esPagoAdelanto = obtener_valor("pago_servicio_proveedor_id") === "adelanto_salarial";
            const confirmacion = await confirmar_accion({
                titulo: "Confirmar pago",
                texto: esPagoAdelanto
                    ? `Se debitara ${formatear_moneda(monto)} de tu cuenta para pagar tu adelanto salarial.`
                    : `Se debitara ${formatear_moneda(monto)} de tu cuenta para pagar el servicio seleccionado.`,
                botonConfirmar: esPagoAdelanto ? "Pagar adelanto" : "Pagar ahora",
                icono: "question"
            });

            if (!confirmacion) {
                return;
            }

            mostrar_mensaje_grupo(["mensaje_pagar_servicio", "mensaje_pagar_servicio_modal"], "Procesando pago de servicio...", "info");

            try {
                const respuesta = await consumir_api("/api/services/pay", {
                    method: "POST",
                    body: {
                        accountId: obtener_valor("pago_servicio_cuenta_id"),
                        linkedServiceId: esPagoAdelanto ? null : obtener_valor("pago_servicio_vinculado_id") || null,
                        providerId: esPagoAdelanto ? null : obtener_valor("pago_servicio_proveedor_id") || null,
                        paymentTarget: esPagoAdelanto ? "adelanto_salarial" : "servicio",
                        serviceIdentifier: esPagoAdelanto ? null : obtener_valor("pago_servicio_identificador"),
                        amount: monto,
                        concept: obtener_valor("pago_servicio_concepto") || (esPagoAdelanto ? "Pago de adelanto salarial" : "")
                    }
                });

                formularioPagoServicio.reset();
                cerrar_modal_wallet("modal_pagar_servicio_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_pagar_servicio", "mensaje_pagar_servicio_modal"], respuesta.message || "Pago aplicado.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_pagar_servicio", "mensaje_pagar_servicio_modal"], error.message || "No fue posible pagar el servicio.", "error");
            }
        });
        formularioPagoServicio.dataset.inicializado = "true";
    }

    if (botonSolicitarCodigoAdelanto && !botonSolicitarCodigoAdelanto.dataset.inicializado) {
        // Aqui pido el codigo por correo antes de autorizar el adelanto.
        // La llamada real sale por POST /api/salary-advance/request-code.
        botonSolicitarCodigoAdelanto.addEventListener("click", async function () {
            const monto = Number(obtener_valor("adelanto_monto"));

            if (!Number.isFinite(monto) || monto <= 0) {
                mostrar_mensaje_grupo(["mensaje_adelanto", "mensaje_adelanto_modal"], "Primero ingresa el monto que deseas solicitar.", "error");
                return;
            }

            mostrar_mensaje_grupo(["mensaje_adelanto", "mensaje_adelanto_modal"], "Enviando codigo de autorizacion al correo...", "info");

            try {
                const respuesta = await consumir_api("/api/salary-advance/request-code", {
                    method: "POST",
                    body: {
                        amount: monto
                    }
                });

                if (respuesta.previewPin) {
                    establecer_valor("adelanto_codigo", respuesta.previewPin);
                }

                mostrar_mensaje_grupo(
                    ["mensaje_adelanto", "mensaje_adelanto_modal"],
                    respuesta.previewPin
                        ? "El correo real no esta configurado todavia. Cargue un codigo temporal para que sigas probando localmente."
                        : (respuesta.message || "Codigo enviado al correo asociado a tu cuenta."),
                    "exito"
                );
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_adelanto", "mensaje_adelanto_modal"], error.message || "No fue posible enviar el codigo del adelanto.", "error");
            }
        });
        botonSolicitarCodigoAdelanto.dataset.inicializado = "true";
    }

    if (formularioAdelanto && !formularioAdelanto.dataset.inicializado) {
        // CRUD frontend -> backend:
        // Este submit acredita el adelanto final con POST /api/salary-advance.
        // El backend valida codigo, cupo, cuenta y luego registra SQL en varias tablas.
        formularioAdelanto.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje_grupo(["mensaje_adelanto", "mensaje_adelanto_modal"], "Solicitando adelanto salarial...", "info");

            try {
                const respuesta = await consumir_api("/api/salary-advance", {
                    method: "POST",
                    body: {
                        amount: obtener_valor("adelanto_monto"),
                        verificationCode: obtener_valor("adelanto_codigo")
                    }
                });

                formularioAdelanto.reset();
                cerrar_modal_wallet("modal_adelanto_wallet");
                await cargar_panel_wallet_completo();
                await refrescar_panel_alertas_desde_servidor();
                mostrar_mensaje_grupo(["mensaje_adelanto", "mensaje_adelanto_modal"], respuesta.message || "Adelanto acreditado.", "exito");
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_adelanto", "mensaje_adelanto_modal"], error.message || "No fue posible solicitar el adelanto.", "error");
            }
        });
        formularioAdelanto.dataset.inicializado = "true";
    }
}

function renderizar_centro_tarjetas(data) {
    poblar_select_generico("favorito_banco", data?.banks || [], function (banco) {
        return {
            value: banco.nombre,
            text: banco.nombre
        };
    }, "Selecciona un banco");

    poblar_select_generico("tarjeta_cuenta_id", data?.accounts || [], function (cuenta) {
        return {
            value: cuenta.id,
            text: `${cuenta.aliasCuenta} | ${cuenta.numeroCuenta}`
        };
    }, "Selecciona una cuenta");

    poblar_select_generico("tarjeta_banco_id", data?.banks || [], function (banco) {
        return {
            value: banco.id,
            text: banco.nombre
        };
    }, "Selecciona un banco");

    renderizar_tarjetas(data?.cards || []);
}

function renderizar_centro_ahorros(data) {
    const cuentas = data?.accounts || [];
    const bolsillos = data?.pockets || [];

    poblar_select_generico("ahorro_cuenta_id", cuentas, function (cuenta) {
        return {
            value: cuenta.id,
            text: `${cuenta.aliasCuenta} | ${cuenta.numeroCuenta}`
        };
    }, "Selecciona una cuenta");

    poblar_select_generico("aporte_ahorro_cuenta_id", cuentas, function (cuenta) {
        return {
            value: cuenta.id,
            text: `${cuenta.aliasCuenta} | ${formatear_moneda(cuenta.saldoDisponible)}`
        };
    }, "Selecciona una cuenta");

    poblar_select_generico("aporte_ahorro_bolsillo_id", bolsillos, function (bolsillo) {
        return {
            value: bolsillo.id,
            text: `${bolsillo.nombre} | ${formatear_moneda(bolsillo.saldoActual)}`
        };
    }, "Selecciona un bolsillo");

    const contenedor = document.getElementById("contenedor_ahorros_wallet");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    if (!bolsillos.length) {
        const tarjeta = document.createElement("article");
        tarjeta.className = "bloque_banco";
        tarjeta.innerHTML = '<div class="tarjeta_visual"><p>Ahorros</p><strong>Aun no creaste bolsillos</strong><small>Crea uno para separar metas, fondo de emergencia o gastos puntuales.</small></div>';
        contenedor.appendChild(tarjeta);
        return;
    }

    bolsillos.forEach(function (bolsillo) {
        const progreso = bolsillo.metaMonto > 0
            ? Math.min(100, Math.round((bolsillo.saldoActual / bolsillo.metaMonto) * 100))
            : 0;

        const tarjeta = document.createElement("article");
        tarjeta.className = "tarjeta_ahorro";
        tarjeta.innerHTML = [
            `<p>${escapar_html(bolsillo.nombre)}</p>`,
            `<strong>${formatear_moneda(bolsillo.saldoActual)}</strong>`,
            `<small>Meta: ${bolsillo.metaMonto ? formatear_moneda(bolsillo.metaMonto) : "Sin meta definida"}</small>`,
            `<div class="barra_progreso_ahorro"><span style="width:${progreso}%; background:${escapar_html(bolsillo.colorReferencia || "#6f3df4")}"></span></div>`,
            `<small>Avance: ${progreso}%</small>`
        ].join("");
        contenedor.appendChild(tarjeta);
    });
}

function renderizar_centro_servicios(data) {
    const cuentas = data?.accounts || [];
    const proveedores = data?.providers || [];
    const vinculados = data?.linkedServices || [];
    const pagosProgramados = data?.scheduledPayments || [];
    const adelantoPago = data?.salaryAdvancePayment?.currentAdvance || null;

    poblar_select_generico("servicio_proveedor_id", proveedores, function (proveedor) {
        return {
            value: proveedor.id,
            text: `${proveedor.nombre} | ${proveedor.categoria}`
        };
    }, "Selecciona un proveedor");

    poblar_select_generico("servicio_cuenta_id", cuentas, function (cuenta) {
        return {
            value: cuenta.id,
            text: `${cuenta.aliasCuenta} | ${cuenta.numeroCuenta}`
        };
    }, "Selecciona una cuenta");

    poblar_select_generico("pago_servicio_cuenta_id", cuentas, function (cuenta) {
        return {
            value: cuenta.id,
            text: `${cuenta.aliasCuenta} | ${formatear_moneda(cuenta.saldoDisponible)}`
        };
    }, "Selecciona una cuenta");

    poblar_select_generico("pago_servicio_proveedor_id", proveedores, function (proveedor) {
        return {
            value: proveedor.id,
            text: `${proveedor.nombre} | ${proveedor.categoria}`
        };
    }, "Selecciona un proveedor manual");

    const selectProveedorManual = document.getElementById("pago_servicio_proveedor_id");
    if (selectProveedorManual && adelantoPago) {
        const opcionAdelanto = document.createElement("option");
        opcionAdelanto.value = "adelanto_salarial";
        opcionAdelanto.textContent = `Pagar adelanto ${adelantoPago.numeroAdelanto}`;
        selectProveedorManual.appendChild(opcionAdelanto);
    }

    poblar_select_generico("pago_servicio_vinculado_id", vinculados, function (servicio) {
        return {
            value: servicio.id,
            text: `${servicio.proveedor} | ${servicio.identificadorCliente}`
        };
    }, "Selecciona un servicio vinculado");

    sincronizar_pago_servicio_desde_vinculo();

    const lista = document.getElementById("lista_servicios_vinculados");
    if (!lista) return;
    lista.innerHTML = "";

    if (!vinculados.length && !pagosProgramados.length) {
        agregar_li(lista, "Aun no tienes servicios vinculados ni pagos programados.");
        return;
    }

    vinculados.forEach(function (servicio) {
        const item = document.createElement("li");
        item.className = "item_favorito_accion";
        item.innerHTML = `
            <div class="contenido_favorito">
                <strong>${escapar_html(servicio.aliasServicio || servicio.proveedor)}</strong>
                <span>${escapar_html(servicio.proveedor)} | ${escapar_html(servicio.identificadorCliente)} | ${escapar_html(servicio.cuentaAlias)}</span>
            </div>
        `;
        lista.appendChild(item);
    });

    pagosProgramados.forEach(function (pago) {
        const item = document.createElement("li");
        item.className = "item_favorito_accion";
        item.innerHTML = `
            <div class="contenido_favorito">
                <strong>Pago programado</strong>
                <span>${escapar_html(pago.nombreServicio)} | ${formatear_moneda(pago.monto)} | ${escapar_html(pago.fechaTexto)}</span>
            </div>
        `;
        lista.appendChild(item);
    });

    if (adelantoPago) {
        agregar_li(
            lista,
            `Adelanto ${adelantoPago.numeroAdelanto} | Pendiente ${formatear_moneda(adelantoPago.saldoPendiente)} | Pago ${formatear_fecha(adelantoPago.fechaPagoProxima)}`
        );
    }
}

function sincronizar_pago_servicio_desde_vinculo() {
    const select = document.getElementById("pago_servicio_vinculado_id");
    const inputIdentificador = document.getElementById("pago_servicio_identificador");
    const selectProveedor = document.getElementById("pago_servicio_proveedor_id");
    const centroServicios = estado_aplicacion.centros.servicios;
    if (!select || !inputIdentificador || !selectProveedor || !centroServicios) {
        return;
    }

    if (selectProveedor.value === "adelanto_salarial") {
        inputIdentificador.value = "";
        inputIdentificador.readOnly = true;
        select.value = "";
        return;
    }

    const servicio = (centroServicios.linkedServices || []).find(function (item) {
        return String(item.id) === String(select.value);
    });

    if (!servicio) {
        inputIdentificador.readOnly = false;
        if (!select.value) {
            inputIdentificador.value = "";
        }
        return;
    }

    inputIdentificador.value = servicio.identificadorCliente || "";
    inputIdentificador.readOnly = true;
    selectProveedor.value = servicio.proveedorId || "";

    // Aqui mantengo coherente el formulario:
    // si el usuario eligio un servicio ya vinculado, el proveedor manual
    // deja de ser una decision libre y pasa a reflejar el proveedor real del contrato.
    // Asi evito mandar combinaciones ambiguas al backend.
}

function renderizar_centro_adelanto(data) {
    const actual = data?.currentAdvance || null;
    const historial = data?.history || [];
    const politica = data?.policy || null;
    const formulario = document.getElementById("formulario_adelanto");
    const lista = document.getElementById("lista_historial_adelanto");
    const mensaje = document.getElementById("mensaje_adelanto");
    const boton = formulario?.querySelector('button[type="submit"]');
    const botonCodigo = document.getElementById("boton_solicitar_codigo_adelanto");

    if (mensaje) {
        mensaje.textContent = actual
            ? actual.operacionesCongeladas
                ? `Tu wallet esta congelada por mora en ${actual.numeroAdelanto}. Saldo pendiente: ${formatear_moneda(actual.saldoPendiente)}.`
                : `Tienes activo ${actual.numeroAdelanto}. Saldo pendiente: ${formatear_moneda(actual.saldoPendiente)} | Proximo pago: ${actual.fechaPagoTexto}.`
            : politica
                ? `Puedes solicitar entre ${formatear_moneda(politica.minimumAmount)} y ${formatear_moneda(politica.maximumAmount)}. Cupo anual restante: ${politica.remainingAnnualAdvances}.`
                : "Si calificas, el adelanto se acredita en tu cuenta principal.";
        mensaje.classList.remove("mensaje_info", "mensaje_error", "mensaje_exito");
        mensaje.classList.add(actual?.operacionesCongeladas ? "mensaje_error" : "mensaje_info");
    }

    if (boton) {
        boton.disabled = Boolean(actual) || Boolean(politica && politica.remainingAnnualAdvances <= 0);
    }

    if (botonCodigo) {
        botonCodigo.disabled = Boolean(actual) || Boolean(politica && politica.remainingAnnualAdvances <= 0);
    }

    if (!lista) {
        return;
    }

    const items = actual ? [actual, ...historial.filter((item) => item.id !== actual.id)] : historial;
    lista.innerHTML = "";

    if (!items.length) {
        agregar_li(lista, "Todavia no hay adelantos registrados.");
        return;
    }

    items.forEach(function (adelanto) {
        agregar_li(
            lista,
            `${adelanto.numeroAdelanto} | ${capitalizar(adelanto.estado)} | ${formatear_moneda(adelanto.montoAprobado)} | Pendiente ${formatear_moneda(adelanto.saldoPendiente || 0)} | Pago ${formatear_fecha(adelanto.fechaPagoProxima)}`
        );
    });
}

async function refrescar_panel_alertas_desde_servidor() {
    await cargar_alertas_desde_servidor();
}

function inicializar_modales_wallet() {
    const disparadores = [
        { botonId: "boton_abrir_modal_favorito", modalId: "modal_favorito_wallet" },
        { botonId: "boton_abrir_modal_tarjeta", modalId: "modal_tarjeta_wallet" },
        { botonId: "boton_abrir_modal_cuenta", modalId: "modal_cuenta_wallet" },
        { botonId: "boton_abrir_modal_meta_ahorro", modalId: "modal_meta_ahorro_wallet" },
        { botonId: "boton_abrir_modal_aporte_ahorro", modalId: "modal_aporte_ahorro_wallet" },
        { botonId: "boton_abrir_modal_vincular_servicio", modalId: "modal_vincular_servicio_wallet" },
        { botonId: "boton_abrir_modal_pagar_servicio", modalId: "modal_pagar_servicio_wallet" },
        { botonId: "boton_abrir_modal_adelanto", modalId: "modal_adelanto_wallet" },
        { botonId: "boton_abrir_modal_recuperacion_seguridad", modalId: "modal_recuperacion_seguridad" }
    ];

    disparadores.forEach(function (item) {
        const boton = document.getElementById(item.botonId);
        const modal = document.getElementById(item.modalId);
        if (!boton || !modal || boton.dataset.inicializado) {
            return;
        }

        boton.addEventListener("click", function () {
            abrir_modal_wallet(item.modalId);
        });
        boton.dataset.inicializado = "true";

        if (!modal.dataset.cierreFondo) {
            modal.addEventListener("click", function (evento) {
                const rect = modal.getBoundingClientRect();
                const clicDentro =
                    evento.clientX >= rect.left &&
                    evento.clientX <= rect.right &&
                    evento.clientY >= rect.top &&
                    evento.clientY <= rect.bottom;

                if (!clicDentro) {
                    cerrar_modal_wallet(item.modalId);
                }
            });
            modal.dataset.cierreFondo = "true";
        }
    });

    document.querySelectorAll(".modal_wallet").forEach(function (modal) {
        if (modal.dataset.cierreFondo) {
            return;
        }

        modal.addEventListener("click", function (evento) {
            const rect = modal.getBoundingClientRect();
            const clicDentro =
                evento.clientX >= rect.left &&
                evento.clientX <= rect.right &&
                evento.clientY >= rect.top &&
                evento.clientY <= rect.bottom;

            if (!clicDentro) {
                cerrar_modal_wallet(modal.id);
            }
        });
        modal.dataset.cierreFondo = "true";
    });

    document.querySelectorAll("[data-cerrar-modal]").forEach(function (boton) {
        if (boton.dataset.inicializado) {
            return;
        }

        boton.addEventListener("click", function () {
            cerrar_modal_wallet(boton.getAttribute("data-cerrar-modal"));
        });
        boton.dataset.inicializado = "true";
    });
}

function abrir_modal_wallet(id) {
    const modal = document.getElementById(id);
    if (!modal) {
        return;
    }

    preparar_modal_wallet(id);

    if (typeof modal.showModal === "function") {
        if (!modal.open) {
            modal.showModal();
        }
        return;
    }

    modal.setAttribute("open", "open");
}

function cerrar_modal_wallet(id) {
    const modal = document.getElementById(id);
    if (!modal) {
        return;
    }

    if (typeof modal.close === "function") {
        modal.close();
        return;
    }

    modal.removeAttribute("open");
}

function preparar_modal_wallet(id) {
    if (id === "modal_recuperacion_seguridad") {
        preparar_modal_recuperacion_seguridad();
        return;
    }

    if (id === "modal_pagar_servicio_wallet") {
        sincronizar_pago_servicio_desde_vinculo();
    }
}

function inicializar_recuperacion_seguridad_modal(formularioRecuperacionModal, formularioResetModal, botonValidarPinModal) {
    if (!formularioRecuperacionModal || !formularioResetModal || !botonValidarPinModal) {
        return;
    }

    if (!formularioRecuperacionModal.dataset.inicializado) {
        formularioRecuperacionModal.addEventListener("submit", async function (evento) {
            evento.preventDefault();

            try {
                const correo = validar_correo_frontend(obtener_valor("recuperacion_modal_correo"));
                mostrar_mensaje_grupo(["mensaje_recuperacion_modal"], "Enviando PIN de recuperacion...", "info");
                const respuesta = await consumir_api("/api/auth/password-reset/request", {
                    method: "POST",
                    omitirAutorizacion: true,
                    body: {
                        email: correo
                    }
                });

                mostrar_mensaje_grupo(["mensaje_recuperacion_modal", "mensaje_reset_modal"], "Si tu cuenta existe, revisa tu correo para continuar.", "exito");
                preparar_modal_reset_con_datos(correo, "");

                if (respuesta.previewMode && respuesta.previewPin) {
                    preparar_modal_reset_con_datos(correo, respuesta.previewPin);
                    mostrar_mensaje_grupo(
                        ["mensaje_reset_modal"],
                        "El canal real no esta configurado todavia, asi que cargue un PIN temporal para que puedas seguir probando localmente.",
                        "info"
                    );
                }
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_recuperacion_modal"], error.message || "No fue posible iniciar la recuperacion.", "error");
            }
        });
        formularioRecuperacionModal.dataset.inicializado = "true";
    }

    if (!botonValidarPinModal.dataset.inicializado) {
        botonValidarPinModal.addEventListener("click", async function () {
            await validar_pin_recuperacion_modal();
        });
        botonValidarPinModal.dataset.inicializado = "true";
    }

    if (!formularioResetModal.dataset.inicializado) {
        formularioResetModal.addEventListener("submit", async function (evento) {
            evento.preventDefault();

            if (!estado_aplicacion.pinRecuperacionModalVerificado) {
                mostrar_mensaje_grupo(["mensaje_reset_modal"], "Primero valida tu PIN para habilitar el cambio de contrasena.", "error");
                return;
            }

            let newPassword = obtener_valor("reset_modal_nueva_contrasena");
            const confirmacion = obtener_valor("reset_modal_confirmacion_contrasena");

            if (!passwords_coinciden(newPassword, confirmacion)) {
                mostrar_mensaje_grupo(["mensaje_reset_modal"], "Las nuevas contrasenas no coinciden.", "error");
                return;
            }

            try {
                const email = validar_correo_frontend(obtener_valor("reset_modal_correo"));
                newPassword = validar_password_segura_frontend(newPassword);
                mostrar_mensaje_grupo(["mensaje_reset_modal"], "Actualizando contrasena...", "info");
                const respuesta = await consumir_api("/api/auth/password-reset/confirm", {
                    method: "POST",
                    omitirAutorizacion: true,
                    body: {
                        email,
                        pin: obtener_valor("reset_modal_pin"),
                        newPassword
                    }
                });

                mostrar_mensaje_grupo(["mensaje_reset_modal"], respuesta.message || "Contrasena actualizada.", "exito");
                formularioResetModal.reset();
                bloquear_cambio_password_reset_modal(false);
                cerrar_modal_wallet("modal_recuperacion_seguridad");

                if (respuesta.token) {
                    guardar_sesion_desde_respuesta(respuesta);
                    if (obtener_pagina_actual() === "perfil.html") {
                        renderizar_alertas_seguridad(
                            respuesta.user || estado_aplicacion.perfilActual || {},
                            estado_aplicacion.centros?.adelanto?.currentAdvance || null
                        );
                    }
                    await refrescar_panel_alertas_desde_servidor();
                    return;
                }
            } catch (error) {
                mostrar_mensaje_grupo(["mensaje_reset_modal"], error.message || "No fue posible actualizar la contrasena.", "error");
            }
        });
        formularioResetModal.dataset.inicializado = "true";
    }

    ["reset_modal_correo", "reset_modal_pin"].forEach(function (idCampo) {
        const campo = document.getElementById(idCampo);
        if (!campo || campo.dataset.pinRecoveryReady) return;

        campo.addEventListener("input", function () {
            bloquear_cambio_password_reset_modal(true);
        });
        campo.dataset.pinRecoveryReady = "true";
    });

    bloquear_cambio_password_reset_modal(false);
}

function preparar_modal_recuperacion_seguridad() {
    const correo = obtener_usuario_actual()?.correo || "";
    preparar_modal_reset_con_datos(correo, "");
    establecer_valor("recuperacion_modal_correo", correo);
    mostrar_mensaje_grupo(["mensaje_recuperacion_modal"], "Te enviaremos un PIN temporal al correo asociado a tu cuenta.", "info", true);
    mostrar_mensaje_grupo(["mensaje_reset_modal"], "Primero valida tu PIN y luego se habilitara el cambio de contrasena.", "info", true);
}

function preparar_modal_reset_con_datos(correo, pin) {
    establecer_valor("recuperacion_modal_correo", correo || "");
    establecer_valor("reset_modal_correo", correo || "");
    establecer_valor("reset_modal_pin", pin || "");
    bloquear_cambio_password_reset_modal(true);
}

function bloquear_cambio_password_reset_modal(limpiarCampos) {
    estado_aplicacion.pinRecuperacionModalVerificado = false;

    const bloque = document.getElementById("bloque_campos_password_reset_modal");
    const botonConfirmar = document.getElementById("boton_confirmar_reset_modal");
    const campoNueva = document.getElementById("reset_modal_nueva_contrasena");
    const campoConfirmacion = document.getElementById("reset_modal_confirmacion_contrasena");

    if (bloque) {
        bloque.classList.add("bloque_password_reset_bloqueado");
        bloque.setAttribute("aria-disabled", "true");
    }

    [campoNueva, campoConfirmacion].forEach(function (campo) {
        if (!campo) return;
        campo.disabled = true;
        if (limpiarCampos !== false) {
            campo.value = "";
        }
    });

    if (botonConfirmar) {
        botonConfirmar.disabled = true;
    }
}

function habilitar_cambio_password_reset_modal() {
    estado_aplicacion.pinRecuperacionModalVerificado = true;

    const bloque = document.getElementById("bloque_campos_password_reset_modal");
    const botonConfirmar = document.getElementById("boton_confirmar_reset_modal");
    const campoNueva = document.getElementById("reset_modal_nueva_contrasena");
    const campoConfirmacion = document.getElementById("reset_modal_confirmacion_contrasena");

    if (bloque) {
        bloque.classList.remove("bloque_password_reset_bloqueado");
        bloque.setAttribute("aria-disabled", "false");
    }

    [campoNueva, campoConfirmacion].forEach(function (campo) {
        if (!campo) return;
        campo.disabled = false;
    });

    if (botonConfirmar) {
        botonConfirmar.disabled = false;
    }

    campoNueva?.focus();
}

async function validar_pin_recuperacion_modal() {
    let correo = obtener_valor("reset_modal_correo");
    const pin = obtener_valor("reset_modal_pin");

    try {
        correo = validar_correo_frontend(correo);
        if (!pin) {
            throw new Error("Completa tu correo y el PIN para validar el acceso.");
        }

        mostrar_mensaje_grupo(["mensaje_reset_modal"], "Validando PIN...", "info");
        const respuesta = await consumir_api("/api/auth/password-reset/verify", {
            method: "POST",
            omitirAutorizacion: true,
            body: {
                email: correo,
                pin
            }
        });

        habilitar_cambio_password_reset_modal();
        mostrar_mensaje_grupo(["mensaje_reset_modal"], respuesta.message || "PIN valido.", "exito");
        return true;
    } catch (error) {
        bloquear_cambio_password_reset_modal(false);
        mostrar_mensaje_grupo(["mensaje_reset_modal"], error.message || "No fue posible validar el PIN.", "error");
        return false;
    }
}

async function inicializar_perfil() {
    const formulario = document.getElementById("formulario_perfil");
    const campoFoto = document.getElementById("perfil_foto");
    const controlEliminarFoto = document.getElementById("perfil_eliminar_foto");
    const selectorPrefijoTelefonoPerfil = document.getElementById("perfil_prefijo_telefono");
    const formularioRecuperacionModal = document.getElementById("formulario_recuperacion_modal");
    const formularioResetModal = document.getElementById("formulario_reset_modal");
    const botonValidarPinModal = document.getElementById("boton_validar_pin_modal");
    if (!formulario) return;

    let fotoTemporal = "";
    inicializar_modales_wallet();
    inicializar_recuperacion_seguridad_modal(formularioRecuperacionModal, formularioResetModal, botonValidarPinModal);
    poblar_selector_prefijo_telefono(selectorPrefijoTelefonoPerfil, "perfil_telefono", obtener_prefijo_telefono_por_defecto());
    aplicar_formato_telefono_input(document.getElementById("perfil_telefono"));
    aplicar_formato_documento_input(document.getElementById("perfil_documento"));

    const [respuesta, tarjetas, servicios, ahorros, adelanto] = await Promise.all([
        consumir_api("/api/profile"),
        consumir_api("/api/cards"),
        consumir_api("/api/services/center"),
        consumir_api("/api/savings"),
        consumir_api("/api/salary-advance")
    ]);
    estado_aplicacion.centros.adelanto = adelanto;
    estado_aplicacion.perfilActual = respuesta.profile || null;
    if (estado_aplicacion.sesion) {
        estado_aplicacion.sesion.user = respuesta.profile || null;
    }

    renderizar_perfil(respuesta.profile, respuesta.recentAccessLogs || []);
    renderizar_alertas_seguridad(respuesta.profile || {}, adelanto?.currentAdvance || null);
    renderizar_logros_perfil({
        cards: tarjetas?.cards || [],
        linkedServices: servicios?.linkedServices || [],
        pockets: ahorros?.pockets || [],
        currentAdvance: adelanto?.currentAdvance || null
    });
    renderizar_trofeos_perfil({
        cards: tarjetas?.cards || [],
        linkedServices: servicios?.linkedServices || [],
        pockets: ahorros?.pockets || [],
        currentAdvance: adelanto?.currentAdvance || null
    });

    if (campoFoto && !campoFoto.dataset.inicializado) {
        campoFoto.addEventListener("change", async function () {
            const archivo = campoFoto.files && campoFoto.files[0];
            if (!archivo) {
                fotoTemporal = "";
                actualizar_texto_archivo_perfil({
                    pendienteEliminar: Boolean(controlEliminarFoto?.checked),
                    tieneFotoGuardada: Boolean(estado_aplicacion.perfilActual?.fotoPerfilUrl)
                });
                renderizar_avatar_perfil(estado_aplicacion.perfilActual, controlEliminarFoto?.checked ? "" : "");
                return;
            }

            try {
                fotoTemporal = await leer_archivo_como_data_url(archivo);
                actualizar_texto_archivo_perfil({
                    nombreArchivo: archivo.name,
                    vistaPrevia: true
                });
                if (controlEliminarFoto) {
                    controlEliminarFoto.checked = false;
                }
                renderizar_avatar_perfil(estado_aplicacion.perfilActual, fotoTemporal);
                mostrar_mensaje("mensaje_perfil", "Vista previa lista. Guarda para aplicar tu foto.", "info");
            } catch (error) {
                campoFoto.value = "";
                fotoTemporal = "";
                actualizar_texto_archivo_perfil({
                    tieneFotoGuardada: Boolean(estado_aplicacion.perfilActual?.fotoPerfilUrl)
                });
                mostrar_mensaje("mensaje_perfil", error.message || "No fue posible leer la imagen seleccionada.", "error");
            }
        });
        campoFoto.dataset.inicializado = "true";
    }

    if (controlEliminarFoto && !controlEliminarFoto.dataset.inicializado) {
        controlEliminarFoto.addEventListener("change", function () {
            if (controlEliminarFoto.checked) {
                fotoTemporal = "";
                if (campoFoto) {
                    campoFoto.value = "";
                }
                actualizar_texto_archivo_perfil({
                    pendienteEliminar: true
                });
                renderizar_avatar_perfil({
                    ...(estado_aplicacion.perfilActual || {}),
                    fotoPerfilUrl: ""
                }, "");
                return;
            }

            actualizar_texto_archivo_perfil({
                nombreArchivo: campoFoto?.files?.[0]?.name || "",
                tieneFotoGuardada: Boolean(estado_aplicacion.perfilActual?.fotoPerfilUrl),
                vistaPrevia: Boolean(campoFoto?.files?.[0]?.name)
            });
            renderizar_avatar_perfil(estado_aplicacion.perfilActual, fotoTemporal);
        });
        controlEliminarFoto.dataset.inicializado = "true";
    }

    if (!formulario.dataset.inicializado) {
        formulario.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            mostrar_mensaje("mensaje_perfil", "Guardando cambios del perfil...", "info");

            try {
                const firstName = validar_nombre_humano_frontend(obtener_valor("perfil_nombres"), "los nombres");
                const lastName = validar_nombre_humano_frontend(obtener_valor("perfil_apellidos"), "los apellidos");
                const phone = obtener_valor("perfil_telefono")
                    ? construir_telefono_desde_campos("perfil_prefijo_telefono", "perfil_telefono", false)
                    : "";
                const birthDate = obtener_valor("perfil_fecha_nacimiento")
                    ? validar_fecha_nacimiento_frontend(obtener_valor("perfil_fecha_nacimiento"), false)
                    : "";
                const documentId = validar_dui_frontend(obtener_valor("perfil_documento"));
                const address = validar_direccion_frontend(obtener_valor("perfil_direccion"), true);

                establecer_valor("perfil_documento", documentId);
                establecer_valor("perfil_direccion", address);

                const resultado = await consumir_api("/api/profile", {
                    method: "POST",
                    body: {
                        firstName,
                        lastName,
                        phone,
                        birthDate,
                        documentId,
                        address,
                        removePhoto: Boolean(controlEliminarFoto?.checked),
                        photoDataUrl: fotoTemporal || ""
                    }
                });

                estado_aplicacion.perfilActual = resultado.profile || null;
                if (estado_aplicacion.sesion) {
                    estado_aplicacion.sesion.user = resultado.profile || null;
                }

                renderizar_perfil(resultado.profile, resultado.recentAccessLogs || []);
                sincronizar_interfaz_sesion();
                fotoTemporal = "";
                if (campoFoto) {
                    campoFoto.value = "";
                }
                if (controlEliminarFoto) {
                    controlEliminarFoto.checked = false;
                }
                actualizar_texto_archivo_perfil({
                    tieneFotoGuardada: Boolean(resultado.profile?.fotoPerfilUrl)
                });
                mostrar_mensaje("mensaje_perfil", resultado.message || "Perfil actualizado.", "exito");
            } catch (error) {
                mostrar_mensaje("mensaje_perfil", error.message || "No fue posible actualizar tu perfil.", "error");
            }
        });
        formulario.dataset.inicializado = "true";
    }
}

function renderizar_perfil(profile, recentAccessLogs) {
    if (!profile) {
        return;
    }

    establecer_texto("texto_nombre_perfil", `${profile.nombres || ""} ${profile.apellidos || ""}`.trim() || "Tu perfil");
    establecer_texto("texto_correo_perfil", profile.correo || "Sin correo");
    establecer_texto(
        "texto_estado_perfil",
        `${capitalizar(profile.estado || "activa")} | Ultimo acceso ${formatear_fecha(profile.ultimoLoginExitoso)}`
    );
    actualizar_meta_desplegable(
        "meta_perfil_datos",
        [
            profile.telefono ? "Telefono listo" : "Telefono pendiente",
            profile.documentoIdentidad
                ? `DUI ${profile.documentoIdentidad}`
                : "Documento pendiente"
        ].join(" | ")
    );

    establecer_valor("perfil_nombres", profile.nombres || "");
    establecer_valor("perfil_apellidos", profile.apellidos || "");
    establecer_valor("perfil_correo", profile.correo || "");
    rellenar_telefono_en_campos("perfil_prefijo_telefono", "perfil_telefono", profile.telefono || "");
    establecer_valor("perfil_fecha_nacimiento", formatear_fecha_input(profile.fechaNacimiento));
    establecer_valor("perfil_documento", profile.documentoIdentidad || "");
    establecer_valor("perfil_direccion", profile.direccion || "");

    actualizar_texto_archivo_perfil({
        tieneFotoGuardada: Boolean(profile.fotoPerfilUrl)
    });
    renderizar_avatar_perfil(profile, "");
    renderizar_accesos_perfil(recentAccessLogs || []);
}

function renderizar_avatar_perfil(profile, fotoTemporal) {
    const contenedor = document.getElementById("perfil_avatar");
    if (!contenedor) return;

    const urlImagen = fotoTemporal || profile?.fotoPerfilUrl || "";
    contenedor.innerHTML = "";

    if (urlImagen) {
        const imagen = document.createElement("img");
        imagen.className = "perfil_avatar_imagen";
        imagen.src = urlImagen;
        imagen.alt = "Foto de perfil";
        contenedor.appendChild(imagen);
        return;
    }

    const iniciales = document.createElement("span");
    iniciales.className = "perfil_avatar_iniciales";
    iniciales.textContent = obtener_iniciales_usuario(profile);
    contenedor.appendChild(iniciales);
}

function renderizar_accesos_perfil(accesos) {
    const lista = document.getElementById("lista_accesos_perfil");
    if (!lista) return;

    lista.innerHTML = "";
    if (!accesos.length) {
        actualizar_meta_desplegable("meta_accesos_perfil", "Sin accesos recientes registrados.");
        agregar_li(lista, "Todavia no hay accesos registrados en tu cuenta.");
        return;
    }

    const accesosVisibles = accesos.slice(0, 4);
    actualizar_meta_desplegable(
        "meta_accesos_perfil",
        `${accesosVisibles.length} acceso(s) recientes visibles`
    );

    accesosVisibles.forEach(function (acceso) {
        const item = document.createElement("li");
        const fecha = document.createElement("strong");
        const detalle = document.createElement("span");
        const dispositivo = document.createElement("span");
        const entorno = document.createElement("span");

        const resultado = capitalizar(acceso.resultado || "desconocido");
        const detalleAcceso = acceso.detalle || "Acceso wallet";
        const ip = acceso.direccionIp ? `IP ${acceso.direccionIp}` : "IP no disponible";
        const dispositivoTexto = resumir_texto_entorno(acceso.dispositivo || "");
        const navegadorTexto = resumir_texto_entorno(acceso.navegador || "");

        fecha.textContent = acceso.fecha || "Sin fecha";
        detalle.textContent = `${resultado} | ${detalleAcceso}`;
        dispositivo.textContent = ip;
        entorno.textContent = [dispositivoTexto, navegadorTexto]
            .filter(Boolean)
            .filter(function (valor, indice, listaValores) { return listaValores.indexOf(valor) === indice; })
            .join(" | ") || "Navegador web";

        item.appendChild(fecha);
        item.appendChild(detalle);
        item.appendChild(dispositivo);
        item.appendChild(entorno);
        lista.appendChild(item);
    });
}

function actualizar_meta_desplegable(id, texto) {
    const elemento = document.getElementById(id);
    if (!elemento) {
        return;
    }

    elemento.textContent = texto || "";
}

function actualizar_texto_archivo_perfil(configuracion) {
    const textoArchivo = document.getElementById("texto_archivo_perfil");
    const meta = document.getElementById("meta_perfil_foto");
    if (!textoArchivo) {
        return;
    }

    const nombreArchivo = configuracion?.nombreArchivo || "";
    const tieneFotoGuardada = Boolean(configuracion?.tieneFotoGuardada);
    const pendienteEliminar = Boolean(configuracion?.pendienteEliminar);
    const vistaPrevia = Boolean(configuracion?.vistaPrevia);

    if (pendienteEliminar) {
        textoArchivo.textContent = "La foto actual se eliminara al guardar.";
        actualizar_meta_desplegable("meta_perfil_foto", "La foto actual se quitara cuando confirmes los cambios.");
        return;
    }

    if (nombreArchivo) {
        textoArchivo.textContent = nombreArchivo;
        actualizar_meta_desplegable(
            "meta_perfil_foto",
            vistaPrevia ? "Nueva imagen lista para guardarse." : "Archivo seleccionado para tu perfil."
        );
        return;
    }

    if (tieneFotoGuardada) {
        textoArchivo.textContent = "Foto actual guardada";
        actualizar_meta_desplegable("meta_perfil_foto", "Ya tienes una foto activa en tu perfil.");
        return;
    }

    textoArchivo.textContent = "Ningun archivo seleccionado";
    if (meta) {
        meta.textContent = "Aun no subes una foto a tu perfil.";
    }
}

function resumir_texto_entorno(texto) {
    const limpio = String(texto || "").trim();
    if (!limpio) {
        return "";
    }

    const coincidenciaChrome = limpio.match(/Chrome\/([0-9.]+)/i);
    if (coincidenciaChrome) {
        return `Chrome ${coincidenciaChrome[1].split(".")[0]}`;
    }

    const coincidenciaFirefox = limpio.match(/Firefox\/([0-9.]+)/i);
    if (coincidenciaFirefox) {
        return `Firefox ${coincidenciaFirefox[1].split(".")[0]}`;
    }

    const coincidenciaSafari = limpio.match(/Version\/([0-9.]+).*Safari/i);
    if (coincidenciaSafari) {
        return `Safari ${coincidenciaSafari[1].split(".")[0]}`;
    }

    if (/Windows/i.test(limpio)) {
        return "Windows";
    }
    if (/Android/i.test(limpio)) {
        return "Android";
    }
    if (/iPhone|iOS/i.test(limpio)) {
        return "iPhone";
    }
    if (/Mac/i.test(limpio)) {
        return "Mac";
    }

    return limpio.split("|")[0].slice(0, 52);
}

function renderizar_logros_perfil(resumen) {
    const progresoForex = obtener_progreso_forex_local();
    const modulosForex = Object.keys(progresoForex).filter(function (clave) {
        return Boolean(progresoForex[clave]);
    }).length;
    const historialSimulacion = obtener_historial_simulacion_local();

    const lista = document.getElementById("lista_logros_perfil");
    if (!lista) {
        return;
    }

    const logros = [
        {
            titulo: "Cuenta base",
            detalle: "Wallet principal lista para operar."
        },
        {
            titulo: "Tarjetas",
            detalle: `${resumen.cards.length} vinculada(s).`
        },
        {
            titulo: "Servicios",
            detalle: `${resumen.linkedServices.length} en pago rapido.`
        },
        {
            titulo: "Ahorros",
            detalle: `${resumen.pockets.length} bolsillo(s) activos.`
        },
        {
            titulo: "Forex",
            detalle: `${modulosForex} modulo(s) superados.`
        },
        {
            titulo: "Simulador",
            detalle: `${historialSimulacion.length} ejercicio(s) registrados.`
        }
    ];

    if (resumen.currentAdvance) {
        logros.push({
            titulo: "Adelanto activo",
            detalle: `${resumen.currentAdvance.numeroAdelanto} con pago previsto para ${resumen.currentAdvance.fechaPagoTexto}.`
        });
    }

    actualizar_meta_desplegable(
        "meta_panel_perfil",
        `${resumen.cards.length} tarjeta(s) | ${resumen.linkedServices.length} servicio(s) | ${resumen.pockets.length} ahorro(s)`
    );

    lista.innerHTML = "";
    logros.forEach(function (logro) {
        const item = document.createElement("li");
        item.className = "lista_item_resumen";
        item.innerHTML = `<strong>${escapar_html(logro.titulo)}</strong><span>${escapar_html(logro.detalle)}</span>`;
        lista.appendChild(item);
    });
}

function renderizar_trofeos_perfil(resumen) {
    const lista = document.getElementById("lista_trofeos_perfil");
    if (!lista) {
        return;
    }

    const progresoForex = obtener_progreso_forex_local();
    const modulosForex = Object.keys(progresoForex).filter(function (clave) {
        return Boolean(progresoForex[clave]);
    }).length;
    const simulaciones = obtener_historial_simulacion_local().length;
    const trofeos = [
        {
            titulo: "Inicio disciplinado",
            detalle: "Registraste tu wallet y comenzaste a construir tu espacio financiero.",
            activo: true
        },
        {
            titulo: "Ahorrador activo",
            detalle: "Se obtiene al crear al menos un bolsillo de ahorro.",
            activo: (resumen.pockets || []).length > 0
        },
        {
            titulo: "Trader aprendiz",
            detalle: "Se obtiene al completar el primer modulo Forex.",
            activo: modulosForex >= 1
        },
        {
            titulo: "Ruta intermedia",
            detalle: "Se obtiene al superar tres cuestionarios Forex.",
            activo: modulosForex >= 3
        },
        {
            titulo: "Ruta maestra",
            detalle: "Se obtiene al completar todos los modulos de estudio.",
            activo: modulosForex >= 6
        },
        {
            titulo: "Simulador constante",
            detalle: "Se obtiene al registrar tres simulaciones de mercado.",
            activo: simulaciones >= 3
        }
    ];

    actualizar_meta_desplegable(
        "meta_trofeos_perfil",
        `${trofeos.filter(function (trofeo) { return trofeo.activo; }).length} de ${trofeos.length} trofeo(s) desbloqueados`
    );

    lista.innerHTML = "";
    trofeos.forEach(function (trofeo) {
        const item = document.createElement("li");
        item.className = "trofeo_item";
        item.innerHTML = `<strong>${escapar_html(trofeo.titulo)}</strong><span>${escapar_html(trofeo.activo ? "Desbloqueado. " + trofeo.detalle : trofeo.detalle)}</span>`;
        if (!trofeo.activo) {
            item.style.opacity = "0.62";
        }
        lista.appendChild(item);
    });
}

function obtener_iniciales_usuario(profile) {
    const nombres = `${profile?.nombres || ""} ${profile?.apellidos || ""}`.trim();
    if (!nombres) {
        return "WD";
    }

    return nombres
        .split(/\s+/)
        .slice(0, 2)
        .map(function (parte) {
            return parte.charAt(0).toUpperCase();
        })
        .join("");
}

// Funcion: leer_archivo_como_data_url
// Aqui convierto archivos a data URL y aplico reglas configurables de tipo y tamano.
// Esto me permite reutilizar el mismo helper para foto de perfil y documento DUI sin duplicar logica.
async function leer_archivo_como_data_url(archivo, opciones) {
    if (!archivo) {
        return "";
    }

    const configuracion = opciones || {};
    const tiposPermitidos = configuracion.tiposPermitidos || ["image/jpeg", "image/png", "image/webp"];
    const sizeMaximaBytes = Number(configuracion.sizeMaximaBytes || 5 * 1024 * 1024);
    const mensajeTipo = configuracion.mensajeTipo || "Selecciona una imagen JPG, PNG o WEBP.";
    const mensajeTamano = configuracion.mensajeTamano || "La imagen supera el limite de 5 MB.";
    const mensajeLectura = configuracion.mensajeLectura || "No fue posible leer la imagen.";

    if (!tiposPermitidos.includes(archivo.type)) {
        throw new Error(mensajeTipo);
    }

    if (archivo.size > sizeMaximaBytes) {
        throw new Error(mensajeTamano);
    }

    return new Promise(function (resolve, reject) {
        const lector = new FileReader();
        lector.onload = function () {
            resolve(String(lector.result || ""));
        };
        lector.onerror = function () {
            reject(new Error(mensajeLectura));
        };
        lector.readAsDataURL(archivo);
    });
}

async function inicializar_transferencias() {
    const formulario = document.getElementById("formulario_transferencia");
    const selectFavoritos = document.getElementById("beneficiario_favorito_transferencia");
    const selectTipo = document.getElementById("tipo_transferencia");
    const fechaProgramada = document.getElementById("fecha_programada_transferencia");
    if (!formulario || !selectFavoritos || !selectTipo || !fechaProgramada) return;

    await cargar_metadata_transferencias();
    alternar_fecha_programada();

    document.querySelectorAll(".boton_monto_rapido").forEach(function (boton) {
        boton.addEventListener("click", function () {
            const input = document.getElementById("monto_transferencia");
            if (input) input.value = boton.dataset.monto;
        });
    });

    selectTipo.addEventListener("change", alternar_fecha_programada);
    selectFavoritos.addEventListener("change", aplicar_favorito_seleccionado);
    ["destinatario_transferencia", "banco_destino_transferencia", "numero_cuenta_destino_transferencia"].forEach(function (id) {
        const campo = document.getElementById(id);
        if (!campo) return;
        campo.addEventListener("input", function () {
            if (estado_aplicacion.aplicandoFavorito) return;
            if (selectFavoritos.value) {
                selectFavoritos.value = "";
            }
        });
    });

    // CRUD frontend -> backend:
    // Este es el submit principal de transferencias.
    // Captura el formulario, pide confirmacion con SweetAlert2
    // y luego envia POST /api/transfers al backend.
    formulario.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        const payload = {
            sourceAccountId: obtener_valor("cuenta_origen_transferencia"),
            transferType: obtener_valor("tipo_transferencia"),
            scheduledDate: obtener_valor("fecha_programada_transferencia") || null,
            beneficiaryId: obtener_valor("beneficiario_favorito_transferencia") || null,
            recipientName: obtener_valor("destinatario_transferencia"),
            destinationBank: obtener_valor("banco_destino_transferencia"),
            destinationAccount: obtener_valor("numero_cuenta_destino_transferencia"),
            amount: Number(obtener_valor("monto_transferencia")),
            concept: obtener_valor("concepto_transferencia"),
            internalReference: obtener_valor("referencia_transferencia"),
            saveFavorite: Boolean(document.getElementById("guardar_beneficiario_favorito")?.checked)
        };

        const confirmacion = await confirmar_accion({
            titulo: "Confirmar transferencia",
            texto: `Vas a enviar ${formatear_moneda(payload.amount)} a ${payload.recipientName || "este destinatario"}.`,
            botonConfirmar: payload.transferType === "programada" ? "Programar" : "Transferir",
            icono: "question"
        });

        if (!confirmacion) {
            return;
        }

        mostrar_mensaje("texto_estado_transferencia", "Procesando transferencia...", "info");

        try {
            const respuesta = await consumir_api("/api/transfers", {
                method: "POST",
                body: payload
            });

            mostrar_mensaje("texto_estado_transferencia", respuesta.message, "exito");
            formulario.reset();
            alternar_fecha_programada();
            await cargar_metadata_transferencias(true);
            await refrescar_panel_alertas_desde_servidor();
        } catch (error) {
            mostrar_mensaje("texto_estado_transferencia", error.message || "No fue posible completar la transferencia.", "error");
        }
    });
}

async function cargar_metadata_transferencias(forzarSesion) {
    if (forzarSesion) {
        await obtener_sesion(true);
    }

    // Lectura frontend -> backend:
    // Aqui cargo datos previos para armar la pantalla antes del submit.
    // /api/transfers/metadata devuelve cuentas, favoritos y resumen.
    // /api/catalogs devuelve bancos y catalogos generales.
    const [metadata, catalogs] = await Promise.all([
        consumir_api("/api/transfers/metadata"),
        consumir_api("/api/catalogs", { omitirAutorizacion: true })
    ]);
    estado_aplicacion.favoritosTransferencia = metadata.favoriteBeneficiaries || [];
    poblar_select_cuentas(metadata.accounts || []);
    poblar_select_favoritos(metadata.favoriteBeneficiaries || []);
    poblar_select_bancos(catalogs.banks || []);
    renderizar_resumen_operaciones(metadata.summary || {});
    renderizar_beneficiarios_operaciones(metadata.favoriteBeneficiaries || []);
}

function poblar_select_cuentas(cuentas) {
    const select = document.getElementById("cuenta_origen_transferencia");
    if (!select) return;

    select.innerHTML = "";
    cuentas.forEach(function (cuenta) {
        const option = document.createElement("option");
        option.value = cuenta.id;
        option.textContent = cuenta.aliasCuenta + " | " + cuenta.numeroCuenta + " | " + formatear_moneda(cuenta.saldoDisponible);
        select.appendChild(option);
    });
}

function poblar_select_favoritos(favoritos) {
    const select = document.getElementById("beneficiario_favorito_transferencia");
    if (!select) return;

    select.innerHTML = "";
    const vacio = document.createElement("option");
    vacio.value = "";
    vacio.textContent = "Selecciona un favorito opcional";
    select.appendChild(vacio);

    favoritos.forEach(function (favorito) {
        const option = document.createElement("option");
        option.value = favorito.id;
        option.textContent = favorito.nombre + " | " + favorito.bancoDestino + " | " + favorito.numeroCuentaDestino;
        select.appendChild(option);
    });
}

function poblar_select_bancos(bancos) {
    const select = document.getElementById("banco_destino_transferencia");
    if (!select) return;

    const valorActual = select.value;
    select.innerHTML = "";

    const vacio = document.createElement("option");
    vacio.value = "";
    vacio.textContent = "Selecciona un banco o wallet";
    select.appendChild(vacio);

    bancos.forEach(function (banco) {
        const option = document.createElement("option");
        option.value = banco.nombre;
        option.textContent = banco.nombre;
        select.appendChild(option);
    });

    if (valorActual) {
        select.value = valorActual;
    }
}

function poblar_select_generico(id, elementos, formateador, placeholder) {
    const select = document.getElementById(id);
    if (!select) {
        return;
    }

    const valorActual = select.value;
    select.innerHTML = "";

    if (placeholder) {
        const vacio = document.createElement("option");
        vacio.value = "";
        vacio.textContent = placeholder;
        select.appendChild(vacio);
    }

    elementos.forEach(function (elemento) {
        const option = document.createElement("option");
        const datos = formateador(elemento);
        option.value = datos.value;
        option.textContent = datos.text;
        select.appendChild(option);
    });

    if (valorActual) {
        select.value = valorActual;
    }
}

function renderizar_resumen_operaciones(resumen) {
    const items = [
        "Cuentas activas: " + (resumen.cuentasActivas || 0),
        "Favoritos activos: " + (resumen.favoritosActivos || 0),
        "Saldo total disponible: " + formatear_moneda(resumen.saldoDisponibleTotal || 0),
        "Transferencias del mes: " + (resumen.transferenciasMes || 0),
        "Programadas: " + (resumen.operacionesProgramadas || 0),
        "Ultima transferencia: " + (resumen.ultimaTransferencia ? resumen.ultimaTransferencia.fecha : "Sin registros")
    ];
    renderizar_lista_textos("lista_resumen_operaciones", items);
}

function renderizar_beneficiarios_operaciones(favoritos) {
    renderizar_favoritos_con_acciones("lista_beneficiarios_operaciones", favoritos, {
        mensajeVacio: "Aun no tienes beneficiarios favoritos.",
        mensajeEstadoId: "texto_estado_transferencia"
    });
}

function alternar_fecha_programada() {
    const tipo = obtener_valor("tipo_transferencia");
    const fecha = document.getElementById("fecha_programada_transferencia");
    if (!fecha) return;
    const programada = tipo === "programada";
    fecha.required = programada;
    fecha.disabled = !programada;
    if (!programada) {
        fecha.value = "";
    }
}

function aplicar_favorito_seleccionado() {
    const idFavorito = obtener_valor("beneficiario_favorito_transferencia");
    const favorito = estado_aplicacion.favoritosTransferencia.find(function (item) {
        return String(item.id) === String(idFavorito);
    });

    if (!favorito) {
        return;
    }

    estado_aplicacion.aplicandoFavorito = true;
    establecer_valor("destinatario_transferencia", favorito.nombre);
    establecer_valor("banco_destino_transferencia", favorito.bancoDestino);
    establecer_valor("numero_cuenta_destino_transferencia", favorito.numeroCuentaDestino);
    estado_aplicacion.aplicandoFavorito = false;
}

function renderizar_favoritos_con_acciones(idLista, favoritos, opciones) {
    const lista = document.getElementById(idLista);
    if (!lista) return;

    lista.innerHTML = "";
    if (!favoritos.length) {
        agregar_li(lista, opciones?.mensajeVacio || "No hay favoritos disponibles.");
        return;
    }

    favoritos.forEach(function (favorito) {
        const item = document.createElement("li");
        item.className = "item_favorito_accion";

        const contenido = document.createElement("div");
        contenido.className = "contenido_favorito";

        const nombre = document.createElement("strong");
        nombre.textContent = favorito.nombre;

        const detalle = document.createElement("span");
        detalle.textContent = favorito.bancoDestino + " | " + favorito.numeroCuentaDestino;

        contenido.appendChild(nombre);
        contenido.appendChild(detalle);

        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "boton_icono boton_accion_favorito";
        boton.textContent = "Quitar";
        boton.addEventListener("click", function () {
            eliminar_favorito(favorito.id, opciones?.mensajeEstadoId || "", boton);
        });

        item.appendChild(contenido);
        item.appendChild(boton);
        lista.appendChild(item);
    });
}

async function eliminar_favorito(beneficiaryId, mensajeEstadoId, botonActivo) {
    if (botonActivo) {
        botonActivo.disabled = true;
    }

    if (mensajeEstadoId) {
        mostrar_mensaje(mensajeEstadoId, "Quitando favorito...", "info");
    }

    try {
        // CRUD frontend -> backend:
        // Esta llamada no borra el beneficiario completo de la base.
        // Solo lo saca de favoritos usando POST /api/beneficiaries/remove-favorite.
        const respuesta = await consumir_api("/api/beneficiaries/remove-favorite", {
            method: "POST",
            body: {
                beneficiaryId
            }
        });

        if (obtener_pagina_actual() === "principal.html") {
            await inicializar_principal();
        }

        if (obtener_pagina_actual() === "operaciones.html") {
            await cargar_metadata_transferencias(true);
        }

        await refrescar_panel_alertas_desde_servidor();

        if (mensajeEstadoId) {
            mostrar_mensaje(mensajeEstadoId, respuesta.message || "Favorito eliminado.", "exito");
        }
    } catch (error) {
        if (mensajeEstadoId) {
            mostrar_mensaje(mensajeEstadoId, error.message || "No fue posible quitar el favorito.", "error");
        }
    } finally {
        if (botonActivo) {
            botonActivo.disabled = false;
        }
    }
}

async function inicializar_movimientos() {
    const buscador = document.getElementById("filtro_busqueda_movimientos");
    const tipo = document.getElementById("filtro_tipo_movimientos");
    const estado = document.getElementById("filtro_estado_movimientos");
    if (!buscador || !tipo || !estado) return;

    let temporizador = null;

    function programar_carga() {
        window.clearTimeout(temporizador);
        temporizador = window.setTimeout(cargar_movimientos_filtrados, 180);
    }

    buscador.addEventListener("input", programar_carga);
    tipo.addEventListener("change", cargar_movimientos_filtrados);
    estado.addEventListener("change", cargar_movimientos_filtrados);

    await cargar_movimientos_filtrados();
}

async function cargar_movimientos_filtrados() {
    const parametros = new URLSearchParams({
        search: obtener_valor("filtro_busqueda_movimientos"),
        type: normalizar_tipo_movimiento(obtener_valor("filtro_tipo_movimientos")),
        status: normalizar_estado_movimiento(obtener_valor("filtro_estado_movimientos"))
    });

    const respuesta = await consumir_api("/api/movements?" + parametros.toString());
    estado_aplicacion.movimientos = respuesta.items || [];
    renderizar_tabla_movimientos(estado_aplicacion.movimientos);
    renderizar_actividad_movimientos(estado_aplicacion.movimientos);
    renderizar_resumen_movimientos(estado_aplicacion.movimientos);
    renderizar_graficos_movimientos(estado_aplicacion.movimientos);
}

function renderizar_tabla_movimientos(lista) {
    const cuerpo = document.getElementById("cuerpo_tabla_movimientos");
    if (!cuerpo) return;
    cuerpo.innerHTML = "";

    if (!lista.length) {
        const fila = document.createElement("tr");
        fila.innerHTML = '<td colspan="5">No hay movimientos que coincidan con el filtro actual.</td>';
        cuerpo.appendChild(fila);
        return;
    }

    lista.forEach(function (movimiento) {
        const fila = document.createElement("tr");
        [
            movimiento.fecha,
            movimiento.tipo,
            movimiento.detalle,
            movimiento.estado,
            formatear_monto_con_signo(movimiento.monto)
        ].forEach(function (texto) {
            const celda = document.createElement("td");
            celda.textContent = texto;
            fila.appendChild(celda);
        });
        cuerpo.appendChild(fila);
    });
}

function renderizar_actividad_movimientos(lista) {
    const items = lista.slice(0, 4).map(function (movimiento) {
        return {
            titulo: `${movimiento.tipo} | ${movimiento.fecha}`,
            detalle: `${movimiento.estado} | ${formatear_monto_con_signo(movimiento.monto)}`
        };
    });

    if (!items.length) {
        renderizar_lista_textos("lista_actividad_transferencias", ["Sin actividad reciente."]);
        return;
    }

    renderizar_lista_resumen_compacto("lista_actividad_transferencias", items);
}

function renderizar_resumen_movimientos(lista) {
    const ingresos = lista.filter(function (movimiento) { return movimiento.monto > 0; }).length;
    const egresos = lista.filter(function (movimiento) { return movimiento.monto < 0; }).length;
    const totalMostrado = lista.reduce(function (acumulado, movimiento) {
        return acumulado + Math.abs(Number(movimiento.monto || 0));
    }, 0);

    renderizar_lista_resumen_compacto("lista_resumen_operaciones", [
        {
            titulo: "Resultados visibles",
            detalle: `${lista.length} movimiento(s) aplicando el filtro actual.`
        },
        {
            titulo: "Ingresos",
            detalle: `${ingresos} registro(s) positivos en el periodo mostrado.`
        },
        {
            titulo: "Egresos",
            detalle: `${egresos} salida(s) reconocidas en esta vista.`
        },
        {
            titulo: "Volumen mostrado",
            detalle: formatear_moneda(totalMostrado)
        }
    ]);
}

function renderizar_graficos_movimientos(lista) {
    if (!window.Chart) {
        return;
    }

    const flujoPorFecha = {};
    const distribucion = {
        gastos: 0,
        ahorros: 0,
        ingresos: 0
    };

    lista.forEach(function (movimiento) {
        const fecha = movimiento.fecha || "Sin fecha";
        if (!flujoPorFecha[fecha]) {
            flujoPorFecha[fecha] = {
                ingresos: 0,
                egresos: 0
            };
        }

        const monto = Number(movimiento.monto || 0);
        if (monto >= 0) {
            flujoPorFecha[fecha].ingresos += monto;
            if (String(movimiento.tipo || "").toLowerCase() === "ahorro") {
                distribucion.ahorros += monto;
            } else {
                distribucion.ingresos += monto;
            }
            return;
        }

        flujoPorFecha[fecha].egresos += Math.abs(monto);
        distribucion.gastos += Math.abs(monto);
    });

    const fechas = Object.keys(flujoPorFecha).slice(-7);
    crear_o_actualizar_grafico("grafico_movimientos_flujo", "bar", {
        labels: fechas,
        datasets: [
            {
                label: "Ingresos",
                data: fechas.map(function (fecha) { return Number(flujoPorFecha[fecha]?.ingresos || 0); }),
                backgroundColor: obtener_color_css("--color_exito", "#1f9d62"),
                borderRadius: 10
            },
            {
                label: "Egresos",
                data: fechas.map(function (fecha) { return Number(flujoPorFecha[fecha]?.egresos || 0); }),
                backgroundColor: obtener_color_css("--color_error", "#cf4469"),
                borderRadius: 10
            }
        ]
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: obtener_color_css("--color_texto_secundario", "#5f5674")
                }
            }
        },
        scales: construir_escalas_grafico()
    });

    crear_o_actualizar_grafico("grafico_movimientos_balance", "doughnut", {
        labels: ["Gastos", "Ahorro", "Ingresos"],
        datasets: [
            {
                data: [distribucion.gastos, distribucion.ahorros, distribucion.ingresos],
                backgroundColor: [
                    obtener_color_css("--color_error", "#cf4469"),
                    obtener_color_css("--color_morado_principal", "#6f3df4"),
                    obtener_color_css("--color_exito", "#1f9d62")
                ],
                borderColor: obtener_color_css("--color_superficie_solida", "#ffffff"),
                borderWidth: 3
            }
        ]
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: "bottom",
                labels: {
                    color: obtener_color_css("--color_texto_secundario", "#5f5674")
                }
            }
        }
    });
}

async function inicializar_portal_forex() {
    const selector = document.getElementById("selector_par_forex");
    const formularioQuiz = document.getElementById("formulario_quiz_forex");
    const paginaActual = obtener_pagina_actual();
    if (!selector) {
        return;
    }

    if (!selector.dataset.inicializado) {
        selector.addEventListener("change", async function () {
            await cargar_aprendizaje_forex(selector.value);
        });
        selector.dataset.inicializado = "true";
    }

    if (formularioQuiz && !formularioQuiz.dataset.inicializado) {
        formularioQuiz.addEventListener("submit", function (evento) {
            evento.preventDefault();
            validar_quiz_forex_activo();
        });
        formularioQuiz.dataset.inicializado = "true";
    }

    if (paginaActual === "mercado_forex.html" && !selector.dataset.autoRefresh) {
        window.setInterval(async function () {
            if (obtener_pagina_actual() === "mercado_forex.html") {
                await cargar_aprendizaje_forex(selector.value || "EURUSD");
            }
        }, 60000);
        selector.dataset.autoRefresh = "true";
    }

    await cargar_aprendizaje_forex(selector.value || "EURUSD");
}

async function cargar_aprendizaje_forex(par) {
    estado_aplicacion.forexParActivo = String(par || "EURUSD").toUpperCase();
    estado_aplicacion.forexAprendizaje = await consumir_api(`/api/forex/learning?pair=${encodeURIComponent(estado_aplicacion.forexParActivo)}`);
    estado_aplicacion.forexProgreso = obtener_progreso_forex_local();
    estado_aplicacion.forexHistorial = obtener_historial_forex_local();

    const curriculum = estado_aplicacion.forexAprendizaje.curriculum || [];
    const moduloDisponible = curriculum.find(function (_, indice) {
        return modulo_desbloqueado(indice);
    }) || curriculum[0];

    if (!curriculum.some(function (modulo) { return modulo.id === estado_aplicacion.forexModuloActivo; })) {
        estado_aplicacion.forexModuloActivo = moduloDisponible?.id || "";
    }

    renderizar_modulos_forex();
    renderizar_tablero_progreso_forex();
    renderizar_mercado_forex();
    renderizar_modulo_forex_activo();
}

function renderizar_modulos_forex() {
    const contenedor = document.getElementById("contenedor_cursos_forex");
    const curriculum = estado_aplicacion.forexAprendizaje?.curriculum || [];
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = "";
    curriculum.forEach(function (modulo, indice) {
        const completado = Boolean(estado_aplicacion.forexProgreso[modulo.id]);
        const desbloqueado = modulo_desbloqueado(indice);
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "tarjeta_modulo_forex";
        boton.disabled = !desbloqueado;
        boton.classList.toggle("tarjeta_modulo_forex_activa", modulo.id === estado_aplicacion.forexModuloActivo);
        boton.classList.toggle("tarjeta_modulo_forex_completa", completado);
        boton.classList.toggle("tarjeta_modulo_forex_bloqueada", !desbloqueado);
        boton.innerHTML = [
            `<div class="encabezado_tarjeta_modulo"><strong>${escapar_html(modulo.titulo)}</strong><span class="chip_nivel_forex">Nivel ${escapar_html(modulo.nivel || 1)}</span></div>`,
            `<span>${escapar_html(modulo.objetivo || modulo.descripcion)}</span>`,
            `<small>${completado ? "Modulo superado" : desbloqueado ? `Duracion aproximada ${escapar_html(modulo.duracionMinutos || 10)} min` : "Supera el modulo anterior para continuar"}</small>`
        ].join("");
        boton.addEventListener("click", function () {
            estado_aplicacion.forexModuloActivo = modulo.id;
            renderizar_modulos_forex();
            renderizar_modulo_forex_activo();
        });
        contenedor.appendChild(boton);
    });
}

function renderizar_tablero_progreso_forex() {
    const curriculum = estado_aplicacion.forexAprendizaje?.curriculum || [];
    const completados = curriculum.filter(function (modulo) {
        return Boolean(estado_aplicacion.forexProgreso[modulo.id]);
    }).length;
    const porcentaje = curriculum.length ? Math.round((completados / curriculum.length) * 100) : 0;
    const barra = document.getElementById("barra_progreso_forex");
    const texto = document.getElementById("texto_progreso_forex");
    const logro = document.getElementById("texto_logro_forex");
    const lista = document.getElementById("lista_historial_forex");

    if (barra) {
        barra.style.width = `${porcentaje}%`;
    }
    if (texto) {
        texto.textContent = `${porcentaje}%`;
    }
    if (logro) {
        logro.textContent = completados
            ? `${completados} modulo(s) completados de ${curriculum.length}.`
            : "Aun no hay modulos completados. Empieza por el nivel 1.";
    }
    if (!lista) {
        return;
    }

    lista.innerHTML = "";
    if (!estado_aplicacion.forexHistorial.length) {
        agregar_li(lista, "Tu historial de estudio aparecera aqui cuando superes cuestionarios.");
        return;
    }

    estado_aplicacion.forexHistorial
        .slice(-5)
        .reverse()
        .forEach(function (registro) {
            agregar_li(lista, `${registro.fechaTexto} | ${registro.moduloTitulo} | ${registro.pair}`);
        });
}

function modulo_desbloqueado(indice) {
    if (indice <= 0) {
        return true;
    }

    const curriculum = estado_aplicacion.forexAprendizaje?.curriculum || [];
    for (let posicion = 0; posicion < indice; posicion += 1) {
        if (!estado_aplicacion.forexProgreso[curriculum[posicion]?.id]) {
            return false;
        }
    }

    return true;
}

function renderizar_mercado_forex() {
    const mercado = estado_aplicacion.forexAprendizaje?.market;
    if (!mercado) {
        return;
    }

    const variacion = Number(mercado.summary?.variationPercent || 0);
    establecer_texto(
        "texto_resumen_forex",
        `${estado_aplicacion.forexParActivo} | Ultimo precio ${mercado.summary?.latestPrice || 0} | Variacion ${variacion >= 0 ? "+" : ""}${variacion}% | Volatilidad ${capitalizar(mercado.summary?.volatilityLabel || "media")}`
    );

    crear_o_actualizar_grafico("grafico_forex_real", "line", {
        labels: (mercado.series || []).map(function (punto) { return punto.date; }),
        datasets: [
            {
                label: estado_aplicacion.forexParActivo,
                data: (mercado.series || []).map(function (punto) { return punto.price; }),
                borderColor: obtener_color_css("--color_morado_principal", "#6f3df4"),
                backgroundColor: "rgba(111, 61, 244, 0.08)",
                pointRadius: 0,
                fill: true,
                tension: 0.32
            }
        ]
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: obtener_color_css("--color_texto_secundario", "#5f5674")
                }
            }
        },
        scales: construir_escalas_grafico()
    });

    const contenedorMetricas = document.getElementById("contenedor_metricas_forex");
    if (contenedorMetricas) {
        contenedorMetricas.innerHTML = "";
        (mercado.insights?.contextCards || []).forEach(function (tarjeta) {
            const articulo = document.createElement("article");
            articulo.className = "tarjeta_metrica_forex";
            articulo.innerHTML = `<strong>${escapar_html(tarjeta.titulo)}</strong><span>${escapar_html(tarjeta.valor)}</span><small>${escapar_html(tarjeta.detalle)}</small>`;
            contenedorMetricas.appendChild(articulo);
        });
    }

    renderizar_lista_textos("lista_contexto_forex", mercado.insights?.notes || []);
}

function renderizar_modulo_forex_activo() {
    const curriculum = estado_aplicacion.forexAprendizaje?.curriculum || [];
    const modulo = curriculum.find(function (item) {
        return item.id === estado_aplicacion.forexModuloActivo;
    }) || curriculum[0];

    if (!modulo) {
        return;
    }

    estado_aplicacion.forexModuloActivo = modulo.id;
    const mercado = estado_aplicacion.forexAprendizaje?.market;
    const texto = [
        `${modulo.titulo}. ${modulo.descripcion}`,
        `Objetivo de este nivel: ${modulo.objetivo}.`,
        `Estoy usando ${estado_aplicacion.forexParActivo} como ejemplo vivo. Ultimo precio ${mercado?.summary?.latestPrice || 0}, sesgo ${mercado?.summary?.bias || "mixto"} y rango reciente ${mercado?.summary?.rangePercent || 0}%.`
    ].join(" ");
    establecer_texto("texto_contenido_forex", texto);

    const bloques = document.getElementById("contenedor_bloques_forex");
    if (bloques) {
        bloques.innerHTML = "";
        (modulo.bloques || []).forEach(function (bloque) {
            const articulo = document.createElement("article");
            articulo.className = "bloque_forex_detalle";
            articulo.innerHTML = `<h3>${escapar_html(bloque.titulo)}</h3><p>${escapar_html(bloque.contenido)}</p>`;
            bloques.appendChild(articulo);
        });
    }

    renderizar_lista_textos("lista_checklist_forex", modulo.checklist || []);
    renderizar_lista_textos("lista_dominios_forex", [
        `Nivel ${modulo.nivel || 1} | ${modulo.duracionMinutos || 10} min estimados`,
        modulo.logro || "Completa este modulo para desbloquear el siguiente.",
        `Aplicacion sugerida sobre ${estado_aplicacion.forexParActivo}: observa estructura, riesgo y contexto antes de simular.`
    ]);
    renderizar_quiz_forex(modulo);
}

function renderizar_quiz_forex(modulo) {
    const contenedor = document.getElementById("contenedor_quiz_forex");
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = "";
    (modulo.preguntas || []).forEach(function (pregunta, indicePregunta) {
        const bloque = document.createElement("fieldset");
        bloque.className = "item_quiz_forex";
        bloque.innerHTML = `<legend>${indicePregunta + 1}. ${escapar_html(pregunta.pregunta)}</legend>`;

        pregunta.opciones.forEach(function (opcion, indiceOpcion) {
            const etiqueta = document.createElement("label");
            etiqueta.className = "fila_control_login fila_opcion_quiz";
            etiqueta.innerHTML = `
                <input type="radio" name="quiz_${escapar_html(pregunta.id)}" value="${indiceOpcion}">
                <span>${escapar_html(opcion)}</span>
            `;
            bloque.appendChild(etiqueta);
        });

        contenedor.appendChild(bloque);
    });
}

function validar_quiz_forex_activo() {
    const curriculum = estado_aplicacion.forexAprendizaje?.curriculum || [];
    const modulo = curriculum.find(function (item) {
        return item.id === estado_aplicacion.forexModuloActivo;
    });

    if (!modulo) {
        return;
    }

    const errores = [];
    let aciertos = 0;
    (modulo.preguntas || []).forEach(function (pregunta) {
        const seleccion = document.querySelector(`input[name="quiz_${pregunta.id}"]:checked`);
        if (!seleccion) {
            errores.push("Debes responder todas las preguntas del modulo.");
            return;
        }

        if (Number(seleccion.value) !== Number(pregunta.correcta)) {
            errores.push(pregunta.explicacion);
            return;
        }

        aciertos += 1;
    });

    if (errores.length) {
        mostrar_mensaje("mensaje_quiz_forex", errores[0], "error");
        return;
    }

    estado_aplicacion.forexProgreso[modulo.id] = true;
    guardar_progreso_forex_local(estado_aplicacion.forexProgreso);
    registrar_hito_forex(modulo);
    renderizar_modulos_forex();
    renderizar_tablero_progreso_forex();

    const curriculumIds = curriculum.map(function (item) { return item.id; });
    const indiceActual = curriculumIds.indexOf(modulo.id);
    const siguiente = curriculum[indiceActual + 1];
    if (siguiente && modulo_desbloqueado(indiceActual + 1)) {
        estado_aplicacion.forexModuloActivo = siguiente.id;
        renderizar_modulo_forex_activo();
    }

    mostrar_mensaje("mensaje_quiz_forex", `Nota sobresaliente ${aciertos}/${(modulo.preguntas || []).length}. ${modulo.logro || "Ya puedes avanzar al siguiente bloque."}`, "exito");
}

function obtener_progreso_forex_local() {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_progress_${usuarioId}`;

    try {
        return JSON.parse(localStorage.getItem(clave) || "{}");
    } catch (error) {
        return {};
    }
}

function guardar_progreso_forex_local(progreso) {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_progress_${usuarioId}`;
    localStorage.setItem(clave, JSON.stringify(progreso || {}));
}

function obtener_historial_forex_local() {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_history_${usuarioId}`;

    try {
        return JSON.parse(localStorage.getItem(clave) || "[]");
    } catch (error) {
        return [];
    }
}

function guardar_historial_forex_local(historial) {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_history_${usuarioId}`;
    localStorage.setItem(clave, JSON.stringify(historial || []));
}

function registrar_hito_forex(modulo) {
    const historial = obtener_historial_forex_local();
    historial.push({
        moduloId: modulo.id,
        moduloTitulo: modulo.titulo,
        pair: estado_aplicacion.forexParActivo,
        fechaIso: new Date().toISOString(),
        fechaTexto: formatear_fecha(new Date())
    });
    estado_aplicacion.forexHistorial = historial.slice(-30);
    guardar_historial_forex_local(estado_aplicacion.forexHistorial);
}

function renderizar_panel_alertas_superior(alertas, totalNoLeidas) {
    const lista = document.querySelector(".lista_alertas_superior");
    const contador = document.querySelector(".contador_alertas");
    if (contador) {
        contador.textContent = String(totalNoLeidas || 0);
        contador.classList.toggle("contador_alertas_oculto", !Number(totalNoLeidas || 0));
    }

    if (!lista) return;
    lista.innerHTML = "";

    if (!alertas.length) {
        agregar_li(lista, "Tus alertas apareceran aqui cuando hagas una operacion.");
        return;
    }

    alertas.forEach(function (alerta) {
        const item = document.createElement("li");
        item.classList.add("alerta_nivel_" + normalizar_nivel_alerta_visual(alerta.nivel));
        if (alerta.leida) {
            item.classList.add("alerta_superior_vista");
        }
        item.innerHTML = [
            '<div class="contenido_alerta_superior">',
            `<strong>${escapar_html(alerta.titulo || "Alerta")}</strong>`,
            `<span>${escapar_html(alerta.mensaje || "")}</span>`,
            `<span>${escapar_html(alerta.fecha || "")}</span>`,
            "</div>",
            '<div class="acciones_alerta_superior">',
            `<button type="button" class="boton_icono boton_alerta_icono" data-eliminar-alerta="${escapar_html(String(alerta.id || ""))}" aria-label="Eliminar alerta">&times;</button>`,
            "</div>"
        ].join("");
        lista.appendChild(item);
    });
}

function normalizar_nivel_alerta_visual(nivel) {
    const nivelNormalizado = String(nivel || "").toLowerCase();
    if (["aceptacion", "exito", "success"].includes(nivelNormalizado)) {
        return "aceptacion";
    }
    if (["alerta", "error", "critica", "advertencia"].includes(nivelNormalizado)) {
        return "alerta";
    }
    return "informativo";
}

async function inicializar_simulador() {
    const formulario = document.getElementById("formulario_simulador");
    const selectorPar = document.getElementById("par_simulacion_forex");
    if (!formulario || !selectorPar) {
        return;
    }

    estado_aplicacion.forexHistorialSimulacion = obtener_historial_simulacion_local();
    renderizar_estado_inicial_simulador();

    if (!selectorPar.dataset.inicializado) {
        selectorPar.addEventListener("change", async function () {
            await cargar_mercado_referencia_simulador(selectorPar.value);
        });
        selectorPar.dataset.inicializado = "true";
    }

    if (!formulario.dataset.inicializado) {
        formulario.addEventListener("submit", async function (evento) {
            evento.preventDefault();
            const capital = Number(obtener_valor("capital_inicial"));
            const riesgo = Number(obtener_valor("porcentaje_riesgo"));
            const salida = document.getElementById("texto_resultado_simulacion");
            if (!capital || !riesgo || capital <= 0 || riesgo <= 0) {
                if (salida) {
                    salida.textContent = "Ingresa valores validos mayores a cero.";
                }
                return;
            }

            if (salida) {
                salida.textContent = "Calculando simulacion sobre mercado real...";
            }

            try {
                const respuesta = await consumir_api("/api/forex/simulate", {
                    method: "POST",
                    body: {
                        pair: obtener_valor("par_simulacion_forex"),
                        direction: obtener_valor("direccion_simulacion"),
                        capital,
                        riskPercent: riesgo
                    }
                });

                estado_aplicacion.forexSimulacion = respuesta;
                registrar_simulacion_local(respuesta);
                renderizar_simulacion_forex(respuesta);
            } catch (error) {
                if (salida) {
                    salida.textContent = error.message || "No fue posible calcular la simulacion.";
                }
                alternar_estado_vacio_simulador(true);
            }
        });
        formulario.dataset.inicializado = "true";
    }

    await cargar_mercado_referencia_simulador(selectorPar.value || "EURUSD");
}

function renderizar_estado_inicial_simulador() {
    renderizar_lista_textos("lista_diario_simulacion", [
        "Primero analiza el mercado activo y luego calcula una idea con riesgo controlado.",
        "Cuando ejecutes una simulacion, aqui veras la lectura paso a paso del escenario.",
        "Usa este espacio para comparar si tu sesgo coincide con el comportamiento reciente del par."
    ]);

    const contenedorTarjetas = document.getElementById("contenedor_tarjetas_simulacion");
    if (contenedorTarjetas) {
        contenedorTarjetas.innerHTML = "";
        [
            { titulo: "Riesgo", valor: "Pendiente", detalle: "Se calculara cuando ejecutes una simulacion." },
            { titulo: "Objetivo", valor: "Pendiente", detalle: "Aparecera con la distancia estimada del escenario." },
            { titulo: "Confianza", valor: "Pendiente", detalle: "Mostrara una lectura orientativa del contexto." }
        ].forEach(function (tarjeta) {
            const articulo = document.createElement("article");
            articulo.className = "tarjeta_metrica_forex";
            articulo.innerHTML = `<strong>${escapar_html(tarjeta.titulo)}</strong><span>${escapar_html(tarjeta.valor)}</span><small>${escapar_html(tarjeta.detalle)}</small>`;
            contenedorTarjetas.appendChild(articulo);
        });
    }

    alternar_estado_vacio_simulador(true);
}

async function cargar_mercado_referencia_simulador(par) {
    const referencia = await consumir_api(`/api/forex/learning?pair=${encodeURIComponent(par)}`);
    estado_aplicacion.forexSimulacion = {
        ...(estado_aplicacion.forexSimulacion || {}),
        pair: referencia.pair,
        source: referencia.market?.source,
        series: referencia.market?.series || [],
        marketSummary: referencia.market?.summary || null
    };

    const summary = referencia.market?.summary || {};
    establecer_texto(
        "texto_resumen_simulador_mercado",
        `${referencia.pair} | Ultimo precio ${summary.latestPrice || 0} | Variacion ${summary.variationPercent >= 0 ? "+" : ""}${summary.variationPercent || 0}% | Volatilidad ${capitalizar(summary.volatilityLabel || "media")}`
    );

    const contenedorMetricas = document.getElementById("contenedor_metricas_simulacion");
    if (contenedorMetricas) {
        contenedorMetricas.innerHTML = "";
        [
            { titulo: "Sesgo", valor: capitalizar(summary.bias || "mixto"), detalle: `Cierre ${summary.latestDate || "sin fecha"}` },
            { titulo: "Rango", valor: `${summary.rangePercent || 0}%`, detalle: `Max ${summary.highestPrice || 0} | Min ${summary.lowestPrice || 0}` },
            { titulo: "Promedio", valor: String(summary.averagePrice || 0), detalle: "Precio medio del tramo analizado" }
        ].forEach(function (tarjeta) {
            const articulo = document.createElement("article");
            articulo.className = "tarjeta_metrica_forex";
            articulo.innerHTML = `<strong>${escapar_html(tarjeta.titulo)}</strong><span>${escapar_html(tarjeta.valor)}</span><small>${escapar_html(tarjeta.detalle)}</small>`;
            contenedorMetricas.appendChild(articulo);
        });
    }

    renderizar_lista_textos("lista_senales_simulacion", referencia.market?.insights?.notes || []);
    renderizar_historial_simulacion();
    renderizar_lista_textos("lista_plan_simulacion", [
        "1. Revisa primero si el sesgo del mercado acompana tu idea de compra o venta.",
        "2. Define un riesgo pequeno y realista antes de simular el escenario.",
        "3. Anota por que entrarias hoy, que invalida la idea y que esperas conseguir.",
        "4. Al final compara el resultado con tu plan, no solo con la ganancia."
    ]);
    renderizar_grafico_mercado_simulador(referencia.market?.series || [], referencia.pair);
}

function renderizar_simulacion_forex(resultado) {
    const salida = document.getElementById("texto_resultado_simulacion");
    if (salida) {
        const tipoEscenario = resultado.direction === "buy" ? "compra" : "venta";
        const resultadoTexto = Number(resultado.estimatedProfitLoss || 0) >= 0 ? "habria cerrado con ganancia" : "habria cerrado con perdida";
        salida.textContent = `Tu escenario de ${tipoEscenario} en ${resultado.pair} ${resultadoTexto}. Arriesgabas ${formatear_moneda(resultado.riskCapital)}, el recorrido observado fue ${resultado.movePercent >= 0 ? "+" : ""}${resultado.movePercent}% y tu capital estimado terminaba en ${formatear_moneda(resultado.finalCapital)}.`;
    }

    renderizar_lista_resumen_compacto("lista_diario_simulacion", [
        {
            titulo: "Punto de entrada",
            detalle: `${resultado.entryDate} | Precio ${resultado.entryPrice}`
        },
        {
            titulo: "Ultimo cierre observado",
            detalle: `${resultado.latestDate} | Precio ${resultado.latestPrice}`
        },
        {
            titulo: "Resultado del escenario",
            detalle: `${formatear_moneda(resultado.estimatedProfitLoss)} | Capital final ${formatear_moneda(resultado.finalCapital)}`
        },
        {
            titulo: "Relacion riesgo beneficio",
            detalle: `${resultado.riskRewardRatio}:1 con confianza orientativa de ${resultado.scenarioConfidence}%`
        },
        {
            titulo: "Fuente utilizada",
            detalle: String(resultado.source || "").toUpperCase() || "REFERENCIA"
        }
    ]);

    renderizar_lista_textos("lista_plan_simulacion", resultado.setupChecklist || []);
    renderizar_historial_simulacion();

    const contenedorTarjetas = document.getElementById("contenedor_tarjetas_simulacion");
    if (contenedorTarjetas) {
        contenedorTarjetas.innerHTML = "";
        [
            { titulo: "Riesgo", valor: formatear_moneda(resultado.riskCapital), detalle: `${resultado.riskPercent}% del capital` },
            { titulo: "Objetivo", valor: `${resultado.targetDistancePercent}%`, detalle: `Stop ${resultado.stopDistancePercent}%` },
            { titulo: "Confianza", valor: `${resultado.scenarioConfidence}%`, detalle: "Lectura orientativa del contexto" },
            { titulo: "Capital final", valor: formatear_moneda(resultado.finalCapital), detalle: "Saldo estimado si siguieras este escenario" }
        ].forEach(function (tarjeta) {
            const articulo = document.createElement("article");
            articulo.className = "tarjeta_metrica_forex";
            articulo.innerHTML = `<strong>${escapar_html(tarjeta.titulo)}</strong><span>${escapar_html(tarjeta.valor)}</span><small>${escapar_html(tarjeta.detalle)}</small>`;
            contenedorTarjetas.appendChild(articulo);
        });
    }

    alternar_estado_vacio_simulador(false);

    crear_o_actualizar_grafico("grafico_simulacion_capital", "line", {
        labels: (resultado.capitalPath || []).map(function (punto) { return punto.etapa; }),
        datasets: [
            {
                label: "Capital simulado",
                data: (resultado.capitalPath || []).map(function (punto) { return punto.capital; }),
                borderColor: obtener_color_css("--color_morado_principal", "#6f3df4"),
                backgroundColor: "rgba(111, 61, 244, 0.1)",
                fill: true,
                tension: 0.3
            }
        ]
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: obtener_color_css("--color_texto_secundario", "#5f5674")
                }
            }
        },
        scales: construir_escalas_grafico()
    });

    renderizar_grafico_mercado_simulador(resultado.series || [], resultado.pair);
}

function obtener_historial_simulacion_local() {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_sim_history_${usuarioId}`;

    try {
        return JSON.parse(localStorage.getItem(clave) || "[]");
    } catch (error) {
        return [];
    }
}

function guardar_historial_simulacion_local(historial) {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_sim_history_${usuarioId}`;
    localStorage.setItem(clave, JSON.stringify(historial || []));
}

function registrar_simulacion_local(resultado) {
    const historial = obtener_historial_simulacion_local();
    historial.push({
        pair: resultado.pair,
        direction: resultado.direction,
        finalCapital: resultado.finalCapital,
        movePercent: resultado.movePercent,
        fechaTexto: formatear_fecha(new Date())
    });
    estado_aplicacion.forexHistorialSimulacion = historial.slice(-20);
    guardar_historial_simulacion_local(estado_aplicacion.forexHistorialSimulacion);
}

function renderizar_historial_simulacion() {
    const lista = document.getElementById("lista_historial_simulacion");
    if (!lista) {
        return;
    }

    lista.innerHTML = "";
    if (!estado_aplicacion.forexHistorialSimulacion.length) {
        agregar_li(lista, "Cuando ejecutes simulaciones, veras aqui tus ultimos escenarios.");
        return;
    }

    estado_aplicacion.forexHistorialSimulacion
        .slice(-5)
        .reverse()
        .forEach(function (registro) {
            agregar_li(lista, `${registro.fechaTexto} | ${registro.pair} | ${registro.direction === "buy" ? "Compra" : "Venta"} | ${formatear_moneda(registro.finalCapital)}`);
        });
}

function alternar_estado_vacio_simulador(mostrar) {
    const estado = document.getElementById("estado_vacio_simulacion");
    if (!estado) {
        return;
    }

    estado.classList.toggle("estado_vacio_grafico_oculto", !mostrar);
}

function renderizar_grafico_mercado_simulador(series, pair) {
    crear_o_actualizar_grafico("grafico_simulacion_velas", "line", {
        labels: series.map(function (punto) { return punto.date; }),
        datasets: [
            {
                label: pair || "Mercado",
                data: series.map(function (punto) { return punto.price; }),
                borderColor: obtener_color_css("--color_morado_principal", "#6f3df4"),
                backgroundColor: "rgba(111, 61, 244, 0.08)",
                fill: true,
                pointRadius: 0,
                tension: 0.32
            }
        ]
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: obtener_color_css("--color_texto_secundario", "#5f5674")
                }
            }
        },
        scales: construir_escalas_grafico()
    });
}

function redibujar_graficos() {
    if (estado_aplicacion.movimientos.length) {
        renderizar_graficos_movimientos(estado_aplicacion.movimientos);
    }

    if (estado_aplicacion.forexAprendizaje?.market) {
        renderizar_mercado_forex();
    }

    if (estado_aplicacion.forexSimulacion?.series) {
        renderizar_grafico_mercado_simulador(estado_aplicacion.forexSimulacion.series, estado_aplicacion.forexSimulacion.pair);
    }

    if (estado_aplicacion.forexSimulacion?.finalCapital) {
        renderizar_simulacion_forex(estado_aplicacion.forexSimulacion);
    }
}

function obtener_color_css(nombreVariable, respaldo) {
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nombreVariable).trim();
    return valor || respaldo;
}

function crear_o_actualizar_grafico(id, tipo, data, options) {
    if (!window.Chart) {
        return;
    }

    const canvas = document.getElementById(id);
    if (!canvas) {
        return;
    }

    if (estado_aplicacion.graficos[id]) {
        estado_aplicacion.graficos[id].destroy();
    }

    estado_aplicacion.graficos[id] = new window.Chart(canvas, {
        type: tipo,
        data,
        options
    });
}

function construir_escalas_grafico() {
    return {
        x: {
            ticks: {
                color: obtener_color_css("--color_texto_suave", "#82789a")
            },
            grid: {
                color: obtener_color_css("--color_grafico_rejilla", "#ded4f9")
            }
        },
        y: {
            ticks: {
                color: obtener_color_css("--color_texto_suave", "#82789a")
            },
            grid: {
                color: obtener_color_css("--color_grafico_rejilla", "#ded4f9")
            }
        }
    };
}

function activar_panel_acceso(modo) {
    const modoNormalizado = modo || "login";
    estado_aplicacion.modoAcceso = modoNormalizado;
    const modoSelectorActivo = modoNormalizado === "registro" ? "registro" : "login";

    document.querySelectorAll("[data-modo-acceso]").forEach(function (boton) {
        const activo = boton.getAttribute("data-modo-acceso") === modoSelectorActivo;
        boton.classList.toggle("selector_acceso_activo", activo);
    });

    document.querySelectorAll("[data-panel-acceso]").forEach(function (panel) {
        const activo = panel.getAttribute("data-panel-acceso") === modoNormalizado;
        panel.classList.toggle("panel_formulario_activo", activo);
    });
}

function obtener_parametro_url(nombre) {
    return new URLSearchParams(window.location.search).get(nombre) || "";
}

function sincronizar_reset_desde_url() {
    const modo = obtener_parametro_url("modo");
    const correo = obtener_parametro_url("correo");
    const pin = obtener_parametro_url("pin") || obtener_parametro_url("token");

    if (modo === "reset") {
        activar_panel_acceso("reset");
    }

    if (correo) {
        preparar_panel_reset(correo, "");
    }

    if (pin) {
        preparar_panel_reset(correo || obtener_valor("reset_correo"), pin);
        mostrar_mensaje("mensaje_reset_password", "PIN cargado desde el enlace de recuperacion.", "info");
    }
}

// Funcion: sincronizar_activacion_registro_desde_url
// Aqui leo el enlace del correo de activacion.
// Si el enlace trae PIN y correo, intento cerrar la activacion automaticamente;
// si solo trae correo, abro el modal ya precargado para que la persona complete el PIN.
async function sincronizar_activacion_registro_desde_url() {
    const modo = obtener_parametro_url("modo");
    const correo = obtener_parametro_url("correo");
    const pin = obtener_parametro_url("pin");

    if (modo !== "activar") {
        return;
    }

    preparar_modal_activacion_registro(correo, pin);
    abrir_modal_wallet("modal_activacion_registro");

    if (!correo || !pin) {
        mostrar_mensaje("mensaje_activacion_registro", "Completa el PIN para terminar la activacion de la cuenta.", "info");
        return;
    }

    try {
        await verificar_activacion_registro({
            correo,
            pin,
            automatico: true
        });
    } catch (error) {
        mostrar_mensaje("mensaje_activacion_registro", error.message || "No fue posible validar el enlace de activacion.", "error");
    }
}

function mostrar_estado_sesion_desde_url() {
    const estadoSesion = obtener_parametro_url("sesion");

    if (estadoSesion === "cerrada") {
        mostrar_mensaje("mensaje_login", "Sesion cerrada correctamente.", "info");
        limpiar_parametro_url("sesion");
        return;
    }

    if (estadoSesion === "expirada") {
        mostrar_mensaje("mensaje_login", "Tu sesion expiro. Ingresa de nuevo para continuar.", "error");
        limpiar_parametro_url("sesion");
    }
}

function limpiar_query_login() {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, document.title, url.toString());
}

function limpiar_parametro_url(nombre) {
    const url = new URL(window.location.href);
    url.searchParams.delete(nombre);
    window.history.replaceState({}, document.title, url.toString());
}

function passwords_coinciden(password, confirmation) {
    return String(password || "") === String(confirmation || "");
}

// Funcion: normalizar_correo_local
// Aqui bajo el correo a un formato comparable desde la interfaz para evitar espacios o mayusculas accidentales.
function normalizar_correo_local(valor) {
    return String(valor || "").trim().toLowerCase();
}

// Funcion: normalizar_dui_visual
// Aqui formateo el DUI a 12345678-9 mientras la persona escribe para reducir errores manuales.
function normalizar_dui_visual(valor) {
    const digitos = String(valor || "").replace(/\D/g, "").slice(0, 9);
    if (digitos.length <= 8) {
        return digitos;
    }

    return `${digitos.slice(0, 8)}-${digitos.slice(8)}`;
}

// Funcion: normalizar_telefono_visual
// Aqui dejo pasar solo caracteres propios de telefono y corto la longitud antes de enviar al backend.
function normalizar_telefono_visual(valor) {
    return String(valor || "")
        .replace(/[^\d+() -]/g, "")
        .slice(0, 25);
}

// Funcion: normalizar_telefono_local_visual
// Aqui limpio el numero local para que en pantalla solo queden digitos y el prefijo viva aparte en el selector.
function normalizar_telefono_local_visual(valor) {
    return String(valor || "")
        .replace(/\D/g, "")
        .slice(0, 15);
}

// Funcion: validar_correo_frontend
// Aqui replico la validacion fuerte del backend para fallar antes desde la UI.
function validar_correo_frontend(valor) {
    const correo = normalizar_correo_local(valor);
    const partes = correo.split("@");

    if (!correo || correo.length > 150 || partes.length !== 2) {
        throw new Error("Ingresa un correo con un formato valido.");
    }

    const local = partes[0];
    const dominio = partes[1];
    const etiquetasDominio = dominio.split(".");

    if (
        local.length > 64
        || dominio.length > 253
        || !/^[a-z0-9._%+-]+$/i.test(local)
        || local.startsWith(".")
        || local.endsWith(".")
        || correo.includes("..")
    ) {
        throw new Error("Ingresa un correo con un formato valido.");
    }

    if (
        etiquetasDominio.length < 2
        || etiquetasDominio.some(function (etiqueta) {
            return (
                !etiqueta
                || etiqueta.length > 63
                || !/^[a-z0-9-]+$/i.test(etiqueta)
                || etiqueta.startsWith("-")
                || etiqueta.endsWith("-")
            );
        })
        || !/^[a-z]{2,}$/i.test(etiquetasDominio[etiquetasDominio.length - 1] || "")
    ) {
        throw new Error("Ingresa un correo con un formato valido.");
    }

    return correo;
}

// Funcion: validar_nombre_humano_frontend
// Aqui rechazo nombres mezclados con numeros o simbolos raros para mantener identidad consistente.
function validar_nombre_humano_frontend(valor, etiqueta) {
    const texto = String(valor || "").trim();

    if (!texto || texto.length < 2 || texto.length > 80) {
        throw new Error(`Completa ${etiqueta} con un nombre real.`);
    }

    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-.][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/.test(texto)) {
        throw new Error(`${capitalizar(etiqueta)} solo puede contener letras y signos propios de nombre.`);
    }

    return texto;
}

// Funcion: validar_telefono_frontend
// Aqui valido telefono visible y descarto patrones demasiado simples o falsos.
function validar_telefono_frontend(valor, etiqueta = "telefono") {
    const telefono = normalizar_telefono_visual(valor).trim();
    const digitos = telefono.replace(/\D/g, "");

    if (!telefono) {
        throw new Error(`Debes completar ${etiqueta}.`);
    }

    if (!/^[+\d\s()-]+$/.test(telefono) || digitos.length < 8 || digitos.length > 15) {
        throw new Error(`El ${etiqueta} debe tener entre 8 y 15 digitos.`);
    }

    if (/^(\d)\1+$/.test(digitos) || /^(12345678|123456789|00000000|99999999)/.test(digitos)) {
        throw new Error(`El ${etiqueta} no parece real.`);
    }

    return telefono;
}

// Funcion: validar_dui_frontend
// Aqui exijo 9 digitos de DUI y regreso el valor ya normalizado para reutilizarlo al enviar.
function validar_dui_frontend(valor) {
    const dui = normalizar_dui_visual(valor);
    const digitos = dui.replace(/\D/g, "");

    if (digitos.length !== 9) {
        throw new Error("El DUI debe tener exactamente 9 digitos.");
    }

    if (/^(\d)\1+$/.test(digitos)) {
        throw new Error("El DUI no parece valido.");
    }

    return dui;
}

// Funcion: validar_fecha_nacimiento_frontend
// Aqui compruebo mayoria de edad antes de golpear el backend con registros incompletos.
function validar_fecha_nacimiento_frontend(valor, requerida) {
    const fechaTexto = String(valor || "").trim();

    if (!fechaTexto) {
        if (requerida) {
            throw new Error("Debes ingresar tu fecha de nacimiento.");
        }

        return "";
    }

    const fecha = new Date(`${fechaTexto}T00:00:00`);
    if (Number.isNaN(fecha.getTime())) {
        throw new Error("La fecha de nacimiento no es valida.");
    }

    const hoy = new Date();
    if (fecha >= hoy) {
        throw new Error("La fecha de nacimiento no puede ser futura.");
    }

    let edad = hoy.getFullYear() - fecha.getFullYear();
    const diferenciaMes = hoy.getMonth() - fecha.getMonth();
    const diferenciaDia = hoy.getDate() - fecha.getDate();
    if (diferenciaMes < 0 || (diferenciaMes === 0 && diferenciaDia < 0)) {
        edad -= 1;
    }

    if (edad < 18) {
        throw new Error("Debes ser mayor de edad para usar la wallet.");
    }

    return fechaTexto;
}

// Funcion: validar_direccion_frontend
// Aqui filtro caracteres raros y exijo una direccion util de verdad.
function validar_direccion_frontend(valor, requerida) {
    const direccion = String(valor || "").trim();

    if (!direccion) {
        if (requerida) {
            throw new Error("Debes ingresar tu direccion.");
        }

        return "";
    }

    if (direccion.length < 10 || direccion.length > 300) {
        throw new Error("La direccion debe ser mas completa.");
    }

    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9#.,\-\/\s]+$/.test(direccion)) {
        throw new Error("La direccion contiene caracteres no permitidos.");
    }

    return direccion;
}

// Funcion: validar_password_segura_frontend
// Aqui replico la regla minima de contrasena para avisar rapido antes del envio.
function validar_password_segura_frontend(valor) {
    const password = String(valor || "");
    if (password.length < 8) {
        throw new Error("La contrasena debe tener al menos 8 caracteres.");
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        throw new Error("La contrasena debe incluir letras y numeros.");
    }

    return password;
}

// Funcion: aplicar_formato_documento_input
// Aqui conecto el formateo del DUI al input para que la persona vea el patron correcto mientras escribe.
function aplicar_formato_documento_input(input) {
    if (!input || input.dataset.formatoDuiAplicado) {
        return;
    }

    input.addEventListener("input", function () {
        input.value = normalizar_dui_visual(input.value);
    });
    input.dataset.formatoDuiAplicado = "true";
}

// Funcion: aplicar_formato_telefono_input
// Aqui limpio el numero local en tiempo real para dejarlo solo con digitos antes de componer el telefono final.
function aplicar_formato_telefono_input(input) {
    if (!input || input.dataset.formatoTelefonoAplicado) {
        return;
    }

    input.addEventListener("input", function () {
        input.value = normalizar_telefono_local_visual(input.value);
    });
    input.dataset.formatoTelefonoAplicado = "true";
}

function guardar_sesion_desde_respuesta(respuesta) {
    if (respuesta.token) {
        guardar_token_sesion(respuesta.token);
    }

    estado_aplicacion.perfilActual = respuesta.user || null;
    estado_aplicacion.sesion = {
        user: respuesta.user,
        alerts: respuesta.alerts || [],
        unreadAlerts: respuesta.unreadAlerts || 0
    };
    sincronizar_interfaz_sesion();
}

function obtener_valor(id) {
    const elemento = document.getElementById(id);
    return elemento ? String(elemento.value || "").trim() : "";
}

function establecer_valor(id, valor) {
    const elemento = document.getElementById(id);
    if (elemento) {
        elemento.value = valor || "";
    }
}

function establecer_texto(id, texto) {
    const elemento = document.getElementById(id);
    if (elemento) {
        elemento.textContent = texto;
    }
}

function agregar_li(lista, texto) {
    const li = document.createElement("li");
    li.textContent = texto;
    lista.appendChild(li);
}

function renderizar_lista_textos(id_lista, elementos) {
    const lista = document.getElementById(id_lista);
    if (!lista) return;
    lista.innerHTML = "";
    elementos.forEach(function (texto) { agregar_li(lista, texto); });
}

function mostrar_mensaje(id, texto, tipo) {
    const elemento = document.getElementById(id);
    if (!elemento) return;
    elemento.textContent = texto || "";
    elemento.classList.remove("mensaje_info", "mensaje_error", "mensaje_exito");
    if (tipo === "error") elemento.classList.add("mensaje_error");
    if (tipo === "exito") elemento.classList.add("mensaje_exito");
    if (tipo === "info") elemento.classList.add("mensaje_info");
    if (texto) {
        mostrar_toast_lateral(texto, tipo);
    }
}

function mostrar_mensaje_grupo(ids, texto, tipo, silencioso) {
    const listaIds = Array.isArray(ids) ? ids : [ids];
    let primerElemento = null;

    listaIds.forEach(function (id) {
        const elemento = document.getElementById(id);
        if (!elemento) {
            return;
        }

        if (!primerElemento) {
            primerElemento = elemento;
        }

        elemento.textContent = texto || "";
        elemento.classList.remove("mensaje_info", "mensaje_error", "mensaje_exito");
        if (tipo === "error") elemento.classList.add("mensaje_error");
        if (tipo === "exito") elemento.classList.add("mensaje_exito");
        if (tipo === "info") elemento.classList.add("mensaje_info");
    });

    if (texto && !silencioso && primerElemento) {
        mostrar_toast_lateral(texto, tipo);
    }
}

function formatear_moneda(valor) {
    return new Intl.NumberFormat("es-SV", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2
    }).format(Number(valor || 0));
}

function formatear_monto_con_signo(valor) {
    const numero = Number(valor || 0);
    const signo = numero > 0 ? "+" : numero < 0 ? "-" : "";
    return signo + formatear_moneda(Math.abs(numero));
}

function formatear_fecha(valor) {
    if (!valor) {
        return "Sin registros";
    }

    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) {
        return "Sin registros";
    }

    return fecha.toLocaleDateString("es-SV");
}

function formatear_fecha_input(valor) {
    if (!valor) {
        return "";
    }

    const texto = String(valor);
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        return texto;
    }

    const fecha = new Date(texto);
    if (Number.isNaN(fecha.getTime())) {
        return "";
    }

    return fecha.toISOString().slice(0, 10);
}

function normalizar_tipo_movimiento(tipo) {
    if (!tipo || tipo === "todos") return "todos";
    return tipo.toLowerCase();
}

function normalizar_estado_movimiento(estado) {
    if (!estado || estado === "todos") return "todos";
    return estado.toLowerCase();
}

function capitalizar(texto) {
    const valor = String(texto || "");
    return valor ? valor.charAt(0).toUpperCase() + valor.slice(1) : "";
}

function escapar_html(texto) {
    return String(texto || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
