/**
 * Modulo: recursos/scripts/funcionalidad_global.js
 *
 * Que hace: logica de todo el frontend de Wallet Digital: sesion y tema, menu superior, campana de alertas,
 *   login/registro/recuperacion, panel principal, perfil, transferencias, movimientos, modulo Forex y simulador.
 * Como lo hace: un unico script que se carga en todas las vistas. Al terminar de cargar el DOM,
 *   iniciar_aplicacion() detecta la pagina actual por el nombre del archivo y ejecuta solo la inicializacion que
 *   le corresponde. El estado compartido vive en el objeto `estado_aplicacion`; la preferencia de tema y el
 *   token de sesion se guardan en localStorage.
 * Datos que participan: token Bearer (localStorage 'wallet_api_token'), tema (localStorage 'wallet_theme'),
 *   `estado_aplicacion`, el DOM de cada vista y las respuestas JSON de la API.
 * Consultas (API/SQL): el navegador nunca habla con la base de datos; todo pasa por consumir_api() hacia
 *   /api/*, y es el backend quien ejecuta el SQL (ver carpeta backend).
 */

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

/**
 * Funcion: iniciar_aplicacion
 *
 * Que hace: arranca la aplicacion en cualquier vista.
 * Como lo hace: prepara menu, tema, menu responsive, campana de alertas y accesos de cuenta; si la pagina es
 *   privada valida la sesion (y corta si no es valida); despues llama a la inicializacion propia de la pagina
 *   (login, principal, perfil, operaciones, movimientos, portal Forex o simulador) y por ultimo redibuja los
 *   graficos.
 * Datos que participan: nombre de la pagina actual, PAGINAS_PRIVADAS, `estado_aplicacion`.
 * Consultas (API/SQL): indirectas, segun la pagina (GET /api/auth/session en vistas privadas).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: obtener_pagina_actual
 *
 * Que hace: devuelve el nombre del archivo de la vista abierta.
 * Como lo hace: toma el ultimo segmento de window.location.pathname; si esta vacio asume login.html.
 * Datos que participan: window.location.pathname.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string (ej. 'principal.html').
 */
function obtener_pagina_actual() {
    const partes = window.location.pathname.split("/");
    return partes[partes.length - 1] || "login.html";
}

/**
 * Funcion: obtener_token_sesion
 *
 * Que hace: lee el token Bearer guardado.
 * Como lo hace: localStorage.getItem con la clave 'wallet_api_token'.
 * Datos que participan: localStorage.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string, o '' si no hay sesion.
 */
function obtener_token_sesion() {
    return localStorage.getItem(CLAVE_TOKEN_SESION) || "";
}

/**
 * Funcion: guardar_token_sesion
 *
 * Que hace: guarda el token que devolvio el login.
 * Como lo hace: localStorage.setItem.
 * Datos que participan: `token`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function guardar_token_sesion(token) {
    localStorage.setItem(CLAVE_TOKEN_SESION, token);
}

/**
 * Funcion: limpiar_sesion_local
 *
 * Que hace: borra todo rastro de la sesion en el navegador.
 * Como lo hace: elimina el token de localStorage, vacia perfilActual y sesion del estado y refresca el menu.
 * Datos que participan: localStorage, `estado_aplicacion`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function limpiar_sesion_local() {
    localStorage.removeItem(CLAVE_TOKEN_SESION);
    estado_aplicacion.perfilActual = null;
    estado_aplicacion.sesion = null;
    sincronizar_interfaz_sesion();
}

/**
 * Funcion: cargar_preferencia_tema
 *
 * Que hace: lee el tema elegido (claro u oscuro).
 * Como lo hace: devuelve 'dark' solo si ese es el valor guardado; cualquier otro caso es 'light'.
 * Datos que participan: localStorage 'wallet_theme'.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: 'light' | 'dark'.
 */
function cargar_preferencia_tema() {
    const temaGuardado = localStorage.getItem(CLAVE_TEMA);
    return temaGuardado === "dark" ? "dark" : "light";
}

/**
 * Funcion: guardar_preferencia_tema
 *
 * Que hace: persiste el tema elegido.
 * Como lo hace: localStorage.setItem.
 * Datos que participan: `tema`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function guardar_preferencia_tema(tema) {
    localStorage.setItem(CLAVE_TEMA, tema);
}

/**
 * Funcion: aplicar_tema
 *
 * Que hace: aplica el tema a toda la pagina.
 * Como lo hace: normaliza el valor, lo guarda en el estado y escribe data-theme en <html>, que activa las
 *   variables CSS del tema.
 * Datos que participan: `tema`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function aplicar_tema(tema) {
    const temaNormalizado = tema === "dark" ? "dark" : "light";
    estado_aplicacion.tema = temaNormalizado;
    document.documentElement.dataset.theme = temaNormalizado;
}

/**
 * Funcion: alternar_tema
 *
 * Que hace: cambia entre modo claro y oscuro.
 * Como lo hace: calcula el tema contrario, lo aplica, lo guarda, actualiza el texto del boton y redibuja los
 *   graficos con los colores nuevos.
 * Datos que participan: `estado_aplicacion.tema`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function alternar_tema() {
    const siguienteTema = estado_aplicacion.tema === "dark" ? "light" : "dark";
    aplicar_tema(siguienteTema);
    guardar_preferencia_tema(siguienteTema);
    actualizar_boton_tema();
    redibujar_graficos();
}

/**
 * Funcion: inicializar_tema
 *
 * Que hace: deja listos los controles de tema.
 * Como lo hace: delega en renderizar_controles_superiores.
 * Datos que participan: DOM de la barra superior.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function inicializar_tema() {
    renderizar_controles_superiores();
}

/**
 * Funcion: actualizar_boton_tema
 *
 * Que hace: sincroniza etiqueta y accesibilidad de todos los botones de tema.
 * Como lo hace: recorre los elementos [data-accion-tema] y actualiza aria-label, title, aria-pressed y el
 *   texto interno.
 * Datos que participan: `estado_aplicacion.tema`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_controles_superiores
 *
 * Que hace: dibuja en la barra superior el boton de tema o, con sesion activa en una pagina privada, el menu
 *   de usuario.
 * Como lo hace: elimina los controles previos para no duplicarlos; con sesion crea avatar, submenu
 *   (configuracion, tema, cerrar sesion) y sus eventos; sin sesion crea solo el boton de tema.
 * Datos que participan: token, `estado_aplicacion.sesion`, usuario actual (nombre, correo, foto).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: construir_boton_tema_submenu
 *
 * Que hace: arma el HTML del boton de tema dentro del submenu de usuario.
 * Como lo hace: concatena un <button> con icono de sol y un span para la etiqueta.
 * Datos que participan: ninguno.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string HTML.
 */
function construir_boton_tema_submenu() {
    return [
        '<button type="button" class="item_submenu_usuario" data-accion-tema="true">',
        icono_sol_svg("icono_submenu"),
        '<span data-etiqueta-tema></span>',
        "</button>"
    ].join("");
}

/**
 * Funcion: construir_avatar_superior
 *
 * Que hace: arma el avatar de la barra superior.
 * Como lo hace: si el usuario tiene foto muestra la imagen; si no, sus iniciales. El contenido se escapa con
 *   escapar_html.
 * Datos que participan: `usuario` (fotoPerfilUrl, nombres, apellidos).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string HTML.
 */
function construir_avatar_superior(usuario) {
    if (usuario?.fotoPerfilUrl) {
        return `<img class="avatar_superior_imagen" src="${escapar_html(usuario.fotoPerfilUrl)}" alt="Foto de perfil">`;
    }

    return `<span class="avatar_superior_iniciales">${escapar_html(obtener_iniciales_usuario(usuario))}</span>`;
}

/**
 * Funcion: inicializar_cierre_submenu_usuario
 *
 * Que hace: cierra el submenu de usuario al hacer clic fuera.
 * Como lo hace: registra un unico listener global (marcado con data-menu-usuario-inicializado) que cierra los
 *   submenus abiertos cuando el clic no cae dentro de su contenedor.
 * Datos que participan: DOM.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: icono_sol_svg
 *
 * Que hace: devuelve el icono SVG de sol/tema.
 * Como lo hace: plantilla con la clase CSS opcional.
 * Datos que participan: `claseExtra`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string SVG.
 */
function icono_sol_svg(claseExtra) {
    return `<svg class="${claseExtra || ""}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2.5v2.3"></path><path d="M12 19.2v2.3"></path><path d="M4.9 4.9l1.6 1.6"></path><path d="M17.5 17.5l1.6 1.6"></path><path d="M2.5 12h2.3"></path><path d="M19.2 12h2.3"></path><path d="M4.9 19.1l1.6-1.6"></path><path d="M17.5 6.5l1.6-1.6"></path></svg>`;
}

/**
 * Funcion: icono_configuracion_svg
 *
 * Que hace: devuelve el icono SVG de engranaje.
 * Como lo hace: plantilla con la clase CSS opcional.
 * Datos que participan: `claseExtra`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string SVG.
 */
function icono_configuracion_svg(claseExtra) {
    return `<svg class="${claseExtra || ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"></path><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.7a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0L4.3 18a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H3.5a1 1 0 0 1-1-1v-1.7a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4L5.5 4a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V3.2a1 1 0 0 1 1-1h1.7a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v1.7a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6z"></path></svg>`;
}

/**
 * Funcion: icono_salida_svg
 *
 * Que hace: devuelve el icono SVG de salida.
 * Como lo hace: plantilla con la clase CSS opcional.
 * Datos que participan: `claseExtra`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string SVG.
 */
function icono_salida_svg(claseExtra) {
    return `<svg class="${claseExtra || ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path></svg>`;
}

/**
 * Funcion: es_pagina_privada
 *
 * Que hace: indica si la vista actual exige sesion.
 * Como lo hace: comprueba si el nombre de la pagina esta en PAGINAS_PRIVADAS.
 * Datos que participan: pagina actual.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: boolean.
 */
function es_pagina_privada() {
    return PAGINAS_PRIVADAS.has(obtener_pagina_actual());
}

/**
 * Funcion: obtener_usuario_actual
 *
 * Que hace: devuelve el usuario en memoria.
 * Como lo hace: prefiere perfilActual (mas reciente tras editar el perfil) y si no, el usuario de la sesion.
 * Datos que participan: `estado_aplicacion`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: objeto usuario o null.
 */
function obtener_usuario_actual() {
    return estado_aplicacion.perfilActual || estado_aplicacion.sesion?.user || null;
}

/**
 * Funcion: mostrar_toast_lateral
 *
 * Que hace: muestra una notificacion discreta en la esquina (SweetAlert2 en modo toast).
 * Como lo hace: elige el icono segun el tipo (error, exito o info) y usa window.Swal.fire con temporizador
 *   (3,6 s para errores, 2,4 s en el resto).
 * Datos que participan: `texto`, `tipo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: confirmar_accion
 *
 * Que hace: pide confirmacion antes de operaciones sensibles (transferir, pagar, cerrar sesion).
 * Como lo hace: abre un modal de SweetAlert2 con los colores del tema; si SweetAlert2 no esta disponible usa
 *   window.confirm.
 * Datos que participan: { titulo, texto, botonConfirmar, icono }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: Promise<boolean>: true si el usuario confirmo.
 */
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

/**
 * Funcion: consumir_api
 *
 * Que hace: es la unica salida del frontend hacia el backend; todo crear, leer, actualizar o eliminar pasa por
 *   aqui.
 * Como lo hace: agrega el header Authorization: Bearer si hay token (salvo omitirAutorizacion), serializa el
 *   body a JSON, ejecuta fetch, interpreta la respuesta y, si el servidor responde 401, limpia la sesion y
 *   redirige al login con ?sesion=expirada. Si la respuesta no es ok lanza Error con el mensaje del servidor.
 * Datos que participan: `ruta` (/api/...), `opciones` { method, body, headers, omitirAutorizacion }.
 * Consultas (API/SQL): cualquier endpoint /api/*.
 * Retorna: Promise con el JSON de la respuesta.
 */
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

/**
 * Funcion: obtener_sesion
 *
 * Que hace: obtiene la sesion viva del usuario, con cache en memoria.
 * Como lo hace: devuelve la sesion guardada salvo que se pida `forzar`; si no hay token lanza error; si lo hay
 *   consulta al servidor y actualiza perfilActual y sesion.
 * Datos que participan: `forzar` (boolean), token.
 * Consultas (API/SQL): GET /api/auth/session (backend: usuario, 5 alertas recientes y contador de no leidas).
 * Retorna: Promise con { user, alerts, unreadAlerts }.
 */
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

/**
 * Funcion: preparar_vista_privada
 *
 * Que hace: valida el acceso a una vista privada y pinta la campana.
 * Como lo hace: intenta obtener la sesion; si funciona renderiza alertas; si falla limpia la sesion y redirige
 *   a login.html?sesion=expirada.
 * Datos que participan: sesion.
 * Consultas (API/SQL): GET /api/auth/session (via obtener_sesion).
 * Retorna: Promise<boolean>: true si el acceso es valido.
 */
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

/**
 * Funcion: sincronizar_interfaz_sesion
 *
 * Que hace: refresca todo lo que depende de si hay sesion.
 * Como lo hace: reconstruye el menu superior y los controles de usuario.
 * Datos que participan: estado de sesion.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function sincronizar_interfaz_sesion() {
    normalizar_menu_superior();
    inicializar_boton_cerrar_sesion();
}

/**
 * Funcion: normalizar_menu_superior
 *
 * Que hace: construye el menu de navegacion segun haya sesion o no.
 * Como lo hace: con sesion arma Wallet, Transferencias, Movimientos, el submenu 'Modulo Forex' y el Simulador,
 *   marcando el enlace activo; sin sesion oculta menu y boton hamburguesa. Registra una sola vez el listener que
 *   cierra los submenus al hacer clic fuera.
 * Datos que participan: pagina actual, token, `estado_aplicacion.sesion`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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
        : [];

    // Sin sesion no hay a donde navegar: oculto el menu y el boton hamburguesa.
    document.querySelector(".barra_superior")?.classList.toggle("barra_sin_menu", enlaces.length === 0);
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

/**
 * Funcion: inicializar_boton_cerrar_sesion
 *
 * Que hace: asegura que exista el control de cerrar sesion.
 * Como lo hace: delega en renderizar_controles_superiores.
 * Datos que participan: DOM.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function inicializar_boton_cerrar_sesion() {
    renderizar_controles_superiores();
}

/**
 * Funcion: cerrar_sesion
 *
 * Que hace: cierra la sesion del usuario en este navegador.
 * Como lo hace: pide confirmacion, limpia la sesion local y redirige a login.html?sesion=cerrada. El token es
 *   sin estado en el servidor, por eso no hay llamada al backend.
 * Datos que participan: token.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: inicializar_menu_responsive
 *
 * Que hace: activa el boton hamburguesa del menu en pantallas pequenas.
 * Como lo hace: alterna la clase menu_abierto del menu y actualiza aria-expanded.
 * Datos que participan: #boton_menu y #menu_superior.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function inicializar_menu_responsive() {
    const boton_menu = document.getElementById("boton_menu");
    const menu_superior = document.getElementById("menu_superior");
    if (!boton_menu || !menu_superior) return;
    boton_menu.addEventListener("click", function () {
        menu_superior.classList.toggle("menu_abierto");
        boton_menu.setAttribute("aria-expanded", String(menu_superior.classList.contains("menu_abierto")));
    });
}

/**
 * Funcion: sincronizar_picker_color_ahorro
 *
 * Que hace: mantiene visible el codigo hexadecimal del color elegido para un bolsillo de ahorro.
 * Como lo hace: escribe el valor de #ahorro_color en #texto_color_ahorro y registra el listener 'input' una
 *   sola vez.
 * Datos que participan: #ahorro_color, #texto_color_ahorro.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: inicializar_campana_alertas
 *
 * Que hace: da vida a la campana de alertas.
 * Como lo hace: abre/cierra el panel al hacer clic (al abrirlo marca las alertas como vistas), delega el clic
 *   en el boton eliminar de cada alerta y cierra el panel al hacer clic fuera. Usa banderas data-inicializado
 *   para no duplicar listeners.
 * Datos que participan: #boton_alertas, #panel_alertas.
 * Consultas (API/SQL): indirectas: POST /api/alerts/mark-read y POST /api/alerts/delete.
 * Retorna: nada.
 */
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

/**
 * Funcion: sincronizar_alertas_en_estado
 *
 * Que hace: guarda en memoria las alertas recibidas y repinta la campana.
 * Como lo hace: actualiza estado_aplicacion.sesion.alerts y unreadAlerts y llama a
 *   renderizar_panel_alertas_superior.
 * Datos que participan: `respuesta` { alerts, unreadAlerts }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: cargar_alertas_desde_servidor
 *
 * Que hace: recarga las alertas desde el backend.
 * Como lo hace: sin token vacia la campana; con token consulta la API y sincroniza el estado.
 * Datos que participan: token.
 * Consultas (API/SQL): GET /api/alerts (backend: ultimas 20 alertas del usuario y contador de no leidas).
 * Retorna: Promise con { alerts, unreadAlerts }.
 */
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

/**
 * Funcion: marcar_alertas_como_vistas
 *
 * Que hace: marca como leidas las alertas pendientes.
 * Como lo hace: solo actua si hay token y hay no leidas; despues recarga la lista.
 * Datos que participan: `unreadAlerts`.
 * Consultas (API/SQL): POST /api/alerts/mark-read (backend: UPDATE alertas_usuario SET leida = TRUE WHERE
 *   usuario_id = $1 AND leida = FALSE).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: eliminar_alerta_desde_panel
 *
 * Que hace: elimina una alerta puntual desde la campana.
 * Como lo hace: deshabilita el boton mientras trabaja, llama a la API, recarga las alertas y, ante error,
 *   muestra un toast; siempre rehabilita el boton.
 * Datos que participan: `alertId`, `botonActivo`.
 * Consultas (API/SQL): POST /api/alerts/delete (backend: DELETE FROM alertas_usuario WHERE id_alerta = $1 AND
 *   usuario_id = $2).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: inicializar_accesos_cuenta
 *
 * Que hace: controla el bloque de saldo y los atajos (iconos) que abren paneles del panel principal.
 * Como lo hace: al hacer clic o pulsar Enter/Espacio en el bloque de saldo alterna la visibilidad de los
 *   atajos; cada atajo activa su panel (data-panel) y desactiva los demas; el boton de cerrar oculta todo.
 *   Define internamente alternar().
 * Datos que participan: #bloque_saldo_toggle, #contenedor_atajos_cuenta, .atajo_icono, .panel_icono.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: desplazar_hacia_bloque
 *
 * Que hace: lleva la vista hacia un elemento con desplazamiento suave.
 * Como lo hace: usa requestAnimationFrame para esperar al repintado y llama a scrollIntoView({ behavior:
 *   'smooth', block: 'start' }).
 * Datos que participan: `elemento`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function desplazar_hacia_bloque(elemento) {
    if (!elemento) return;

    window.requestAnimationFrame(function () {
        elemento.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    });
}

/**
 * Funcion: aplicar_iconos_atajo_wallet
 *
 * Que hace: pinta el icono SVG de cada atajo del panel de la wallet.
 * Como lo hace: tiene un mapa panel -> SVG y lo inserta en .simbolo_atajo una sola vez (bandera
 *   data-icono-aplicado).
 * Datos que participan: .atajo_icono[data-panel].
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_prefijo_telefono_por_defecto
 *
 * Que hace: fija el prefijo base de la interfaz para que el registro arranque listo para El Salvador.
 * Como lo hace: devuelve el primer elemento de PREFIJOS_TELEFONICOS (+503).
 * Datos que participan: PREFIJOS_TELEFONICOS.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string, ej. '+503'.
 */
function obtener_prefijo_telefono_por_defecto() {
    return PREFIJOS_TELEFONICOS[0]?.codigo || "+503";
}

/**
 * Funcion: poblar_selector_prefijo_telefono
 *
 * Que hace: carga la lista de paises en el selector y actualiza el ejemplo del numero local segun el prefijo
 *   elegido.
 * Como lo hace: crea las <option> con bandera y codigo una sola vez; en cada cambio actualiza title,
 *   aria-label y el placeholder del input con el numero de ejemplo del pais; deja seleccionado el prefijo
 *   inicial.
 * Datos que participan: `selector`, `inputId`, `prefijoInicial`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: descomponer_telefono_internacional
 *
 * Que hace: separa un telefono ya guardado en prefijo y numero local para volver a pintarlo en la interfaz.
 * Como lo hace: ordena los prefijos de mayor a menor longitud (para que +503 gane a +5), normaliza el telefono
 *   a '+digitos' y busca el prefijo que coincida; si no hay coincidencia usa el prefijo por defecto.
 * Datos que participan: `valor` (telefono completo).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: { prefijo, numeroLocal }.
 */
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

/**
 * Funcion: rellenar_telefono_en_campos
 *
 * Que hace: reparte el telefono guardado entre el selector de pais y el input del numero local.
 * Como lo hace: descompone el telefono, puebla el selector con su prefijo y escribe el numero local.
 * Datos que participan: `selectorId`, `inputId`, `telefonoCompleto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function rellenar_telefono_en_campos(selectorId, inputId, telefonoCompleto) {
    const selector = document.getElementById(selectorId);
    const input = document.getElementById(inputId);
    const telefonoSeparado = descomponer_telefono_internacional(telefonoCompleto);

    poblar_selector_prefijo_telefono(selector, inputId, telefonoSeparado.prefijo);

    if (input) {
        input.value = telefonoSeparado.numeroLocal;
    }
}

/**
 * Funcion: construir_telefono_desde_campos
 *
 * Que hace: une prefijo y numero local para enviarlos al backend como telefono internacional valido.
 * Como lo hace: normaliza el numero local, lanza error si es obligatorio y esta vacio y valida el resultado
 *   completo con validar_telefono_frontend.
 * Datos que participan: `selectorId`, `inputId`, `requerido`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string con el telefono validado, o '' si es opcional y esta vacio.
 */
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

/**
 * Funcion: inicializar_login
 *
 * Que hace: prepara toda la pantalla de acceso: login, registro, recuperacion de contrasena y activacion por
 *   PIN.
 * Como lo hace: si ya hay un token valido redirige a principal.html; consulta el estado inicial (si la base
 *   esta vacia obliga al registro); engancha los botones de modo, aplica formatos de telefono y DUI y registra
 *   el submit de cada formulario con sus validaciones del lado del cliente.
 * Datos que participan: formularios de la vista, parametros de la URL (modo, correo, pin).
 * Consultas (API/SQL): GET /api/auth/session (si hay token); GET /api/auth/bootstrap (backend: SELECT COUNT(*)
 *   FROM usuarios); POST /api/auth/login; POST /api/auth/register; POST /api/auth/password-reset/request; POST
 *   /api/auth/password-reset/confirm.
 * Retorna: Promise<void>.
 */
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
    inicializar_doble_factor_login();

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

            if (respuesta.requiresTwoFactor) {
                abrir_modal_doble_factor(respuesta);
                mostrar_mensaje("mensaje_login", "Contrasena correcta. Falta el codigo de verificacion.", "info");
                return;
            }

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

/**
 * Funcion: aplicar_estado_bootstrap_login
 *
 * Que hace: adapta el login cuando la base de datos no tiene usuarios.
 * Como lo hace: si requiresRegistration es true deshabilita el modo login, abre el registro, muestra el aviso
 *   de base vacia una sola vez y oculta los enlaces de recuperacion; si no, restablece todo.
 * Datos que participan: `bootstrap` { totalUsers, hasUsers, requiresRegistration }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: mostrar_aviso_base_vacia
 *
 * Que hace: muestra la notificacion inicial cuando la web detecta que no hay usuarios registrados.
 * Como lo hace: usa un modal de SweetAlert2 o, si no esta disponible, un toast.
 * Datos que participan: ninguno.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: inicializar_flujo_pin_recuperacion
 *
 * Que hace: obliga a revalidar el PIN cada vez que se edita el correo o el PIN.
 * Como lo hace: registra un listener 'input' en #reset_correo y #reset_pin que bloquea los campos de
 *   contrasena nueva, y deja el bloque bloqueado desde el inicio.
 * Datos que participan: #reset_correo, #reset_pin.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: preparar_panel_reset
 *
 * Que hace: precarga correo y PIN en el panel de restablecimiento.
 * Como lo hace: escribe los valores en los campos y bloquea el cambio de contrasena hasta validar el PIN.
 * Datos que participan: `correo`, `pin`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: clean_pin_visual
 *
 * Que hace: limpia el PIN para dejarlo solo numerico antes de enviarlo al backend.
 * Como lo hace: quita todo lo que no sea digito y limita a 6 caracteres.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string de hasta 6 digitos.
 */
function clean_pin_visual(valor) {
    return String(valor || "").replace(/\D/g, "").slice(0, 6);
}

/**
 * Funcion: preparar_modal_activacion_registro
 *
 * Que hace: precarga correo y PIN dentro del modal de activacion; se reutiliza al terminar el registro y
 *   cuando el usuario llega desde el enlace del correo.
 * Como lo hace: escribe ambos valores en los campos del modal (el PIN pasa por clean_pin_visual).
 * Datos que participan: `correo`, `pin`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function preparar_modal_activacion_registro(correo, pin) {
    establecer_valor("activacion_registro_correo", correo || "");
    establecer_valor("activacion_registro_pin", clean_pin_visual(pin));
}

/**
 * Funcion: verificar_activacion_registro
 *
 * Que hace: es el submit real de activacion de cuenta.
 * Como lo hace: toma correo y PIN del modal (o de `opciones`), los valida, llama a la API, guarda la sesion
 *   devuelta, cierra el modal, limpia la URL y redirige a principal.html.
 * Datos que participan: `opciones` { correo, pin, automatico }.
 * Consultas (API/SQL): POST /api/auth/register/verify (backend: valida PIN con FOR UPDATE, UPDATE usuarios SET
 *   estado = 'activo', consume codigos_verificacion y devuelve sesion).
 * Retorna: Promise con la respuesta del servidor.
 */
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

/**
 * Funcion: reenviar_pin_activacion_registro
 *
 * Que hace: dispara otro correo de activacion para una cuenta aun pendiente.
 * Como lo hace: valida el correo, llama a la API y, en modo preview, carga el PIN temporal en el modal.
 * Datos que participan: #activacion_registro_correo.
 * Consultas (API/SQL): POST /api/auth/register/resend (backend: anula codigos vigentes e INSERT en
 *   codigos_verificacion).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: inicializar_activacion_registro_modal
 *
 * Que hace: engancha las acciones del modal de activacion: verificar el PIN o reenviarlo.
 * Como lo hace: normaliza el PIN mientras se escribe y registra, una sola vez, el submit del formulario y el
 *   clic de reenviar con manejo de errores.
 * Datos que participan: `formulario`, `botonReenviar`.
 * Consultas (API/SQL): indirectas: verificar y reenviar.
 * Retorna: nada.
 */
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

/**
 * Funcion: bloquear_cambio_password_reset
 *
 * Que hace: bloquea los campos de contrasena nueva hasta que el PIN se valide.
 * Como lo hace: marca pinRecuperacionVerificado = false, deshabilita campos y boton, aplica la clase de
 *   bloqueo y limpia los campos salvo que limpiarCampos sea false.
 * Datos que participan: `limpiarCampos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: habilitar_cambio_password_reset
 *
 * Que hace: habilita los campos de contrasena nueva despues de validar el PIN.
 * Como lo hace: marca pinRecuperacionVerificado = true, quita el bloqueo visual, habilita campos y boton y
 *   enfoca la contrasena nueva.
 * Datos que participan: estado del PIN.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: validar_pin_recuperacion
 *
 * Que hace: valida el PIN de recuperacion antes de dejar cambiar la contrasena.
 * Como lo hace: valida el correo, exige el PIN, llama a la API y habilita o bloquea los campos segun el
 *   resultado.
 * Datos que participan: #reset_correo, #reset_pin.
 * Consultas (API/SQL): POST /api/auth/password-reset/verify (backend: SELECT en usuarios y
 *   tokens_recuperacion_password por hash del PIN; no consume el PIN).
 * Retorna: Promise<boolean>.
 */
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

/**
 * Funcion: inicializar_principal
 *
 * Que hace: prepara el panel principal de la wallet.
 * Como lo hace: registra los formularios, sincroniza el selector de color de ahorro y carga todos los datos.
 * Datos que participan: DOM de principal.html.
 * Consultas (API/SQL): indirectas: ver cargar_panel_wallet_completo.
 * Retorna: Promise<void>.
 */
async function inicializar_principal() {
    inicializar_formularios_principal();
    sincronizar_picker_color_ahorro();
    await cargar_panel_wallet_completo();
}

/**
 * Funcion: cargar_panel_wallet_completo
 *
 * Que hace: carga en paralelo todo lo que muestra el panel principal y lo pinta.
 * Como lo hace: Promise.all con cinco peticiones independientes, guarda los centros en
 *   estado_aplicacion.centros y llama a los renderizadores de cada seccion.
 * Datos que participan: token de sesion.
 * Consultas (API/SQL): GET /api/dashboard (backend: 9 lecturas en paralelo: usuario, cuentas, favoritos,
 *   tarjetas, pagos, alertas, resumen mensual, movimientos y adelanto activo); GET /api/cards; GET /api/savings;
 *   GET /api/services/center; GET /api/salary-advance.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: renderizar_principal
 *
 * Que hace: pinta el resumen del dashboard: saldos, cuenta principal, proximo pago, estado y listas.
 * Como lo hace: escribe los textos con establecer_texto y delega en los renderizadores de movimientos, resumen
 *   mensual, favoritos, pagos, suscripciones, cuentas y tarjetas.
 * Datos que participan: `data` del dashboard { summary, accounts, recentMovements, favoriteBeneficiaries,
 *   scheduledPayments, subscriptions, cards }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_alerta_adelanto
 *
 * Que hace: muestra u oculta el aviso del adelanto activo.
 * Como lo hace: escribe numero y fecha de pago en #texto_alerta_adelanto o lo oculta si no hay adelanto.
 * Datos que participan: `adelanto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_lista_movimientos_recientes
 *
 * Que hace: pinta la lista de movimientos recientes.
 * Como lo hace: crea un <li> por movimiento con tipo, fecha, detalle y monto con signo; escapa todo con
 *   escapar_html.
 * Datos que participan: `lista` de movimientos.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_resumen_mensual
 *
 * Que hace: pinta el resumen del mes.
 * Como lo hace: arma cinco items (movimientos, depositos, pagos, transferencias y volumen) y los entrega a
 *   renderizar_lista_resumen_compacto.
 * Datos que participan: `resumen` { totalMovimientos, depositosMes, pagosMes, transferenciasMes, volumenMes }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_alertas_seguridad
 *
 * Que hace: pinta el estado de seguridad del perfil.
 * Como lo hace: arma items de doble factor, intentos fallidos, ultimo login y ultimo cambio de clave (y
 *   adelanto activo) con clases de estado, y actualiza el texto del desplegable.
 * Datos que participan: `seguridad`, `adelantoActivo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function renderizar_alertas_seguridad(seguridad, adelantoActivo) {
    const items = [
        {
            titulo: "Doble factor",
            detalle: seguridad.dobleFactorActivo
                ? "Activo: al iniciar sesion se pide un codigo enviado a tu correo."
                : "Inactivo. Activalo desde el boton de esta seccion para proteger tu acceso.",
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

/**
 * Funcion: renderizar_lista_estado_seguridad
 *
 * Que hace: pinta una lista con titulo, detalle y clase de estado por item.
 * Como lo hace: vacia la lista y agrega un <li> por elemento, escapando el texto.
 * Datos que participan: `id` de la lista, `items`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_lista_resumen_compacto
 *
 * Que hace: pinta una lista compacta de resumen (titulo y detalle).
 * Como lo hace: vacia la lista y agrega un <li class='lista_item_resumen'> por elemento.
 * Datos que participan: `id` de la lista, `items`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_favoritos_principales
 *
 * Que hace: pinta los favoritos del panel principal.
 * Como lo hace: delega en renderizar_favoritos_con_acciones con el mensaje de lista vacia.
 * Datos que participan: `favoritos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function renderizar_favoritos_principales(favoritos) {
    renderizar_favoritos_con_acciones("lista_contactos_frecuentes", favoritos, {
        mensajeVacio: "No hay favoritos registrados."
    });
}

/**
 * Funcion: renderizar_pagos_programados
 *
 * Que hace: pinta los pagos programados.
 * Como lo hace: construye textos 'servicio | fecha | monto' y usa renderizar_lista_textos.
 * Datos que participan: `pagos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function renderizar_pagos_programados(pagos) {
    const items = pagos.map(function (pago) {
        return pago.nombreServicio + " | " + pago.fechaTexto + " | " + formatear_moneda(pago.monto);
    });
    renderizar_lista_textos("lista_pagos_programados", items.length ? items : ["No hay pagos programados activos."]);
}

/**
 * Funcion: renderizar_suscripciones
 *
 * Que hace: pinta las suscripciones activas.
 * Como lo hace: construye textos 'servicio | monto | frecuencia' y usa renderizar_lista_textos.
 * Datos que participan: `suscripciones`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function renderizar_suscripciones(suscripciones) {
    const items = suscripciones.map(function (suscripcion) {
        return suscripcion.nombreServicio + " | " + formatear_moneda(suscripcion.monto) + " | " + suscripcion.frecuencia;
    });
    renderizar_lista_textos("lista_suscripciones", items.length ? items : ["No hay suscripciones activas."]);
}

/**
 * Funcion: renderizar_cuentas
 *
 * Que hace: pinta la lista y el detalle de cuentas de la wallet.
 * Como lo hace: por cada cuenta crea un <li> (alias, numero, tipo y saldo) y una tarjeta de detalle (estado,
 *   disponible y retenido).
 * Datos que participan: `cuentas`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_tarjetas
 *
 * Que hace: pinta las tarjetas vinculadas.
 * Como lo hace: muestra marca, alias, '**** **** **** ultimos4', cuenta y limite; si no hay tarjetas muestra
 *   un bloque vacio. Nunca se maneja el numero completo, solo los ultimos 4 digitos.
 * Datos que participan: `tarjetas`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: inicializar_formularios_principal
 *
 * Que hace: registra los submit de todos los formularios y modales del panel principal (una sola vez por
 *   formulario).
 * Como lo hace: cada formulario sigue el mismo patron: evita el envio normal, muestra 'cargando', llama a la
 *   API, resetea y cierra el modal, recarga el panel y las alertas, y muestra el resultado o el error.
 * Datos que participan: formularios de favorito, tarjeta, cuenta secundaria, ahorro, aporte, servicio, pago y
 *   adelanto.
 * Consultas (API/SQL): POST /api/beneficiaries (UPSERT en beneficiarios); POST /api/cards (INSERT en
 *   tarjetas); POST /api/accounts (INSERT en cuentas); POST /api/savings (INSERT en bolsillos_ahorro); POST
 *   /api/savings/deposit (UPDATE de cuentas y bolsillos + movimientos); POST /api/services/link (UPSERT en
 *   servicios_usuario); POST /api/services/pay (pago con confirmacion previa); POST
 *   /api/salary-advance/request-code y POST /api/salary-advance (acredita el adelanto).
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_centro_tarjetas
 *
 * Que hace: llena los selectores de banco y cuenta y pinta las tarjetas.
 * Como lo hace: usa poblar_select_generico para #favorito_banco, #tarjeta_cuenta_id y #tarjeta_banco_id y
 *   despues renderizar_tarjetas.
 * Datos que participan: `data` { banks, accounts, cards }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_centro_ahorros
 *
 * Que hace: llena los selectores de ahorro y pinta los bolsillos con su barra de progreso.
 * Como lo hace: calcula progreso = min(100, saldoActual / metaMonto * 100) y usa el color del bolsillo en la
 *   barra; si no hay bolsillos muestra un bloque vacio.
 * Datos que participan: `data` { accounts, pockets }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_centro_servicios
 *
 * Que hace: llena los selectores de servicios y pinta servicios vinculados, pagos programados y adelanto.
 * Como lo hace: puebla proveedores y cuentas, agrega la opcion 'Pagar adelanto' cuando existe un adelanto y
 *   lista los items.
 * Datos que participan: `data` { accounts, providers, linkedServices, scheduledPayments, salaryAdvancePayment
 *   }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: sincronizar_pago_servicio_desde_vinculo
 *
 * Que hace: mantiene coherente el formulario de pago: si se elige un servicio vinculado, el proveedor y el
 *   identificador pasan a ser los del contrato real.
 * Como lo hace: si el destino es el adelanto bloquea el identificador; si hay servicio vinculado copia su
 *   identificador, lo deja de solo lectura y fija el proveedor. Asi no se mandan combinaciones ambiguas al
 *   backend.
 * Datos que participan: #pago_servicio_vinculado_id, #pago_servicio_identificador,
 *   #pago_servicio_proveedor_id, estado_aplicacion.centros.servicios.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_centro_adelanto
 *
 * Que hace: pinta el estado del adelanto salarial, su politica y el historial.
 * Como lo hace: elige el mensaje segun haya adelanto (congelado o activo) o politica disponible, deshabilita
 *   los botones si ya hay adelanto o se agoto el cupo anual y lista el historial.
 * Datos que participan: `data` { currentAdvance, history, policy }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: refrescar_panel_alertas_desde_servidor
 *
 * Que hace: recarga la campana despues de una operacion que genera alertas.
 * Como lo hace: delega en cargar_alertas_desde_servidor.
 * Datos que participan: token.
 * Consultas (API/SQL): GET /api/alerts.
 * Retorna: Promise<void>.
 */
async function refrescar_panel_alertas_desde_servidor() {
    await cargar_alertas_desde_servidor();
}

/**
 * Funcion: inicializar_modales_wallet
 *
 * Que hace: conecta cada boton con su modal (<dialog>) y define como se cierran.
 * Como lo hace: recorre la tabla de disparadores y registra, una sola vez, el clic que abre el modal; cierra
 *   al hacer clic en el fondo (comparando las coordenadas con el rectangulo del dialogo) y en los botones
 *   [data-cerrar-modal].
 * Datos que participan: botones #boton_abrir_modal_*, elementos .modal_wallet.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: abrir_modal_wallet
 *
 * Que hace: abre un modal por su id.
 * Como lo hace: prepara el contenido segun el modal y usa showModal() o, si el navegador no lo soporta, el
 *   atributo open.
 * Datos que participan: `id`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: cerrar_modal_wallet
 *
 * Que hace: cierra un modal por su id.
 * Como lo hace: usa close() o quita el atributo open.
 * Datos que participan: `id`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: preparar_modal_wallet
 *
 * Que hace: deja listo el contenido de ciertos modales antes de abrirlos.
 * Como lo hace: para el de recuperacion de seguridad precarga el correo del usuario; para el de pago de
 *   servicios sincroniza proveedor e identificador.
 * Datos que participan: `id`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function preparar_modal_wallet(id) {
    if (id === "modal_recuperacion_seguridad") {
        preparar_modal_recuperacion_seguridad();
        return;
    }

    if (id === "modal_pagar_servicio_wallet") {
        sincronizar_pago_servicio_desde_vinculo();
    }
}

/**
 * Funcion: inicializar_recuperacion_seguridad_modal
 *
 * Que hace: engancha el flujo de cambio de contrasena dentro de un modal (perfil y panel principal).
 * Como lo hace: sincroniza el correo entre pasos para no escribirlo dos veces, limpia el PIN a solo numeros, y
 *   registra el submit de solicitar PIN, el boton de validar PIN y el submit de cambiar contrasena (que exige
 *   haber validado el PIN y que ambas claves coincidan).
 * Datos que participan: `formularioRecuperacionModal`, `formularioResetModal`, `botonValidarPinModal`.
 * Consultas (API/SQL): POST /api/auth/password-reset/request (genera y envia el PIN); POST
 *   /api/auth/password-reset/verify (valida el PIN sin consumirlo); POST /api/auth/password-reset/confirm
 *   (backend: UPDATE usuarios_credenciales con el nuevo hash scrypt y marca los tokens como usados).
 * Retorna: nada.
 */
function inicializar_recuperacion_seguridad_modal(formularioRecuperacionModal, formularioResetModal, botonValidarPinModal) {
    if (!formularioRecuperacionModal || !formularioResetModal || !botonValidarPinModal) {
        return;
    }

    const campoCorreoRecuperacion = document.getElementById("recuperacion_modal_correo");
    const campoCorreoReset = document.getElementById("reset_modal_correo");
    const campoPinReset = document.getElementById("reset_modal_pin");

    // Funcion: sincronizar correo entre pasos del modal
    // Aqui mantengo el correo del primer formulario reflejado en el segundo,
    // para que el usuario no tenga que escribirlo dos veces al recuperar acceso.
    if (campoCorreoRecuperacion && campoCorreoReset && !campoCorreoRecuperacion.dataset.correoSincronizado) {
        campoCorreoRecuperacion.addEventListener("input", function () {
            establecer_valor("reset_modal_correo", campoCorreoRecuperacion.value);
            bloquear_cambio_password_reset_modal(false);
        });
        campoCorreoRecuperacion.dataset.correoSincronizado = "true";
    }

    // Funcion: normalizar PIN del modal de recuperacion
    // Aqui limpio el PIN para dejarlo solo numerico aunque el usuario pegue
    // espacios o caracteres que no correspondan.
    if (campoPinReset && !campoPinReset.dataset.pinNormalizado) {
        campoPinReset.addEventListener("input", function () {
            campoPinReset.value = clean_pin_visual(campoPinReset.value);
        });
        campoPinReset.dataset.pinNormalizado = "true";
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
                document.getElementById("reset_modal_pin")?.focus();
                mostrar_mensaje_grupo(
                    ["mensaje_reset_modal"],
                    "Ahora ingresa el PIN recibido en tu correo y luego valida el acceso.",
                    "info"
                );

                if (respuesta.previewMode && respuesta.previewPin) {
                    preparar_modal_reset_con_datos(correo, respuesta.previewPin);
                    document.getElementById("reset_modal_pin")?.focus();
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

/**
 * Funcion: preparar_modal_recuperacion_seguridad
 *
 * Que hace: reinicia el modal de recuperacion con el correo del usuario autenticado.
 * Como lo hace: resetea ambos formularios, precarga el correo y deja los mensajes iniciales.
 * Datos que participan: usuario actual.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function preparar_modal_recuperacion_seguridad() {
    const correo = obtener_usuario_actual()?.correo || "";
    document.getElementById("formulario_recuperacion_modal")?.reset();
    document.getElementById("formulario_reset_modal")?.reset();
    preparar_modal_reset_con_datos(correo, "");
    establecer_valor("recuperacion_modal_correo", correo);
    mostrar_mensaje_grupo(["mensaje_recuperacion_modal"], "Te enviaremos un PIN temporal al correo asociado a tu cuenta.", "info", true);
    mostrar_mensaje_grupo(["mensaje_reset_modal"], "Primero valida tu PIN y luego se habilitara el cambio de contrasena.", "info", true);
}

/**
 * Funcion: preparar_modal_reset_con_datos
 *
 * Que hace: precarga correo y PIN en el modal y bloquea el cambio de clave hasta validar.
 * Como lo hace: escribe los valores en los campos y llama a bloquear_cambio_password_reset_modal.
 * Datos que participan: `correo`, `pin`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function preparar_modal_reset_con_datos(correo, pin) {
    establecer_valor("recuperacion_modal_correo", correo || "");
    establecer_valor("reset_modal_correo", correo || "");
    establecer_valor("reset_modal_pin", pin || "");
    bloquear_cambio_password_reset_modal(true);
}

/**
 * Funcion: bloquear_cambio_password_reset_modal
 *
 * Que hace: bloquea los campos de contrasena nueva del modal hasta validar el PIN.
 * Como lo hace: marca pinRecuperacionModalVerificado = false, deshabilita campos y boton y aplica la clase de
 *   bloqueo; limpia los campos salvo que limpiarCampos sea false.
 * Datos que participan: `limpiarCampos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: habilitar_cambio_password_reset_modal
 *
 * Que hace: habilita los campos de contrasena nueva del modal tras validar el PIN.
 * Como lo hace: marca pinRecuperacionModalVerificado = true, quita el bloqueo y enfoca el primer campo.
 * Datos que participan: estado del PIN.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: validar_pin_recuperacion_modal
 *
 * Que hace: valida el PIN de recuperacion dentro del modal.
 * Como lo hace: valida correo, limpia el PIN, llama a la API y habilita o bloquea el cambio de contrasena
 *   segun el resultado.
 * Datos que participan: #reset_modal_correo, #reset_modal_pin.
 * Consultas (API/SQL): POST /api/auth/password-reset/verify (backend: SELECT en usuarios y
 *   tokens_recuperacion_password por hash del PIN).
 * Retorna: Promise<boolean>.
 */
async function validar_pin_recuperacion_modal() {
    let correo = obtener_valor("reset_modal_correo");
    const pin = clean_pin_visual(obtener_valor("reset_modal_pin"));

    try {
        correo = validar_correo_frontend(correo);
        establecer_valor("reset_modal_pin", pin);
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

/**
 * Funcion: inicializar_perfil
 *
 * Que hace: prepara la pagina de perfil: carga datos, logros, trofeos y gestiona el formulario de edicion y la
 *   foto.
 * Como lo hace: carga en paralelo perfil, tarjetas, servicios, ahorros y adelanto; renderiza todo; al elegir
 *   una foto la lee como data URL para una vista previa (no se sube hasta guardar); el checkbox 'eliminar foto'
 *   anula la vista previa; el submit valida todo en el cliente y envia el perfil.
 * Datos que participan: formulario_perfil, #perfil_foto, #perfil_eliminar_foto.
 * Consultas (API/SQL): GET /api/profile (backend: SELECT de usuarios JOIN usuarios_credenciales y los ultimos
 *   8 accesos_usuario); GET /api/cards; GET /api/services/center; GET /api/savings; GET /api/salary-advance;
 *   POST /api/profile (backend: SELECT ... FOR UPDATE y UPDATE usuarios, con la foto guardada en disco).
 * Retorna: Promise<void>.
 */
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
    inicializar_doble_factor_perfil();
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

/**
 * Funcion: renderizar_perfil
 *
 * Que hace: pinta los datos del perfil y rellena el formulario.
 * Como lo hace: escribe nombre, correo, estado y resumen, llena los campos (telefono separado en prefijo y
 *   numero), muestra avatar y accesos recientes.
 * Datos que participan: `profile`, `recentAccessLogs`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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
    actualizar_boton_doble_factor();
}

/**
 * Funcion: renderizar_avatar_perfil
 *
 * Que hace: pinta el avatar grande del perfil.
 * Como lo hace: prefiere la foto temporal (vista previa), luego la guardada y, si no hay ninguna, las
 *   iniciales.
 * Datos que participan: `profile`, `fotoTemporal` (data URL).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_accesos_perfil
 *
 * Que hace: pinta los accesos recientes a la cuenta.
 * Como lo hace: muestra hasta 4: fecha, resultado y detalle, IP y un resumen de dispositivo y navegador sin
 *   repetidos.
 * Datos que participan: `accesos` (tabla accesos_usuario).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: actualizar_meta_desplegable
 *
 * Que hace: actualiza el texto resumen de un panel desplegable.
 * Como lo hace: escribe el texto en el elemento por id.
 * Datos que participan: `id`, `texto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function actualizar_meta_desplegable(id, texto) {
    const elemento = document.getElementById(id);
    if (!elemento) {
        return;
    }

    elemento.textContent = texto || "";
}

/**
 * Funcion: actualizar_texto_archivo_perfil
 *
 * Que hace: refleja en pantalla el estado de la foto de perfil.
 * Como lo hace: segun la configuracion muestra: foto marcada para eliminar, archivo seleccionado (vista
 *   previa), foto guardada o ningun archivo.
 * Datos que participan: `configuracion` { nombreArchivo, tieneFotoGuardada, pendienteEliminar, vistaPrevia }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: resumir_texto_entorno
 *
 * Que hace: convierte un user agent largo en una etiqueta corta (Chrome 120, Windows...).
 * Como lo hace: busca con expresiones regulares Chrome, Firefox o Safari con su version mayor y, si no, el
 *   sistema operativo; como ultimo recurso recorta el texto a 52 caracteres.
 * Datos que participan: `texto` (dispositivo o navegador guardado en accesos_usuario).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
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

/**
 * Funcion: renderizar_logros_perfil
 *
 * Que hace: pinta el resumen de logros del usuario.
 * Como lo hace: cuenta tarjetas, servicios, bolsillos, modulos Forex superados (localStorage) y simulaciones,
 *   y agrega el adelanto activo si existe.
 * Datos que participan: `resumen` { cards, linkedServices, pockets, currentAdvance }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_trofeos_perfil
 *
 * Que hace: pinta los trofeos y marca cuales estan desbloqueados.
 * Como lo hace: evalua reglas simples (primer bolsillo, 1, 3 y 6 modulos Forex, 3 simulaciones) y atenua los
 *   bloqueados.
 * Datos que participan: `resumen`, progreso e historial locales.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_iniciales_usuario
 *
 * Que hace: obtiene las iniciales para el avatar sin foto.
 * Como lo hace: toma las dos primeras palabras de nombres y apellidos; si no hay nombre devuelve 'WD'.
 * Datos que participan: `profile`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string de hasta 2 letras.
 */
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

/**
 * Funcion: leer_archivo_como_data_url
 *
 * Que hace: convierte un archivo a data URL aplicando reglas de tipo y tamano; se reutiliza para la foto de
 *   perfil y otros archivos.
 * Como lo hace: valida tipo MIME (JPG, PNG o WEBP por defecto) y tamano (5 MB por defecto) y lee el archivo
 *   con FileReader.
 * Datos que participan: `archivo`, `opciones` { tiposPermitidos, sizeMaximaBytes, mensajeTipo, mensajeTamano,
 *   mensajeLectura }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: Promise<string> con el data URL; rechaza con el mensaje correspondiente.
 */
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

/**
 * Funcion: inicializar_transferencias
 *
 * Que hace: prepara la pagina de transferencias y registra el envio.
 * Como lo hace: carga metadatos, activa o desactiva la fecha programada segun el tipo, conecta los botones de
 *   monto rapido, rellena el destino al elegir un favorito (y lo des-selecciona si el usuario edita a mano) y,
 *   en el submit, arma el payload, pide confirmacion con SweetAlert2 y llama a la API.
 * Datos que participan: formulario_transferencia y sus campos.
 * Consultas (API/SQL): GET /api/transfers/metadata y GET /api/catalogs (via cargar_metadata_transferencias);
 *   POST /api/transfers (backend: bloquea la cuenta origen FOR UPDATE, INSERT en transacciones, UPDATE de
 *   cuentas, INSERT en movimientos_cuenta y abono espejo si el destino es una wallet interna).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: cargar_metadata_transferencias
 *
 * Que hace: carga los datos previos para armar el formulario de transferencias.
 * Como lo hace: opcionalmente refresca la sesion y pide en paralelo metadatos y catalogo; guarda los favoritos
 *   en el estado y llena selects y resumenes.
 * Datos que participan: `forzarSesion`.
 * Consultas (API/SQL): GET /api/transfers/metadata (backend: cuentas, 20 favoritos y resumen mensual) y GET
 *   /api/catalogs (backend: SELECT de catalogo_bancos y proveedores_servicio activos).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: poblar_select_cuentas
 *
 * Que hace: llena el select de cuenta de origen.
 * Como lo hace: crea una <option> por cuenta con alias, numero y saldo disponible.
 * Datos que participan: `cuentas`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: poblar_select_favoritos
 *
 * Que hace: llena el select de favoritos.
 * Como lo hace: agrega una opcion vacia y una por favorito (nombre, banco y numero de cuenta).
 * Datos que participan: `favoritos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: poblar_select_bancos
 *
 * Que hace: llena el select de banco destino conservando la seleccion previa.
 * Como lo hace: recrea las opciones desde el catalogo y restaura el valor que habia.
 * Datos que participan: `bancos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: poblar_select_generico
 *
 * Que hace: llena cualquier select con una lista de elementos.
 * Como lo hace: recibe un formateador que devuelve { value, text } por elemento, agrega un placeholder
 *   opcional y conserva el valor seleccionado antes del repintado.
 * Datos que participan: `id`, `elementos`, `formateador`, `placeholder`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_resumen_operaciones
 *
 * Que hace: pinta el resumen de la pagina de transferencias.
 * Como lo hace: arma textos de cuentas activas, favoritos, saldo total, transferencias del mes, programadas y
 *   ultima transferencia.
 * Datos que participan: `resumen`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_beneficiarios_operaciones
 *
 * Que hace: pinta los favoritos de la pagina de transferencias con boton 'Quitar'.
 * Como lo hace: delega en renderizar_favoritos_con_acciones.
 * Datos que participan: `favoritos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function renderizar_beneficiarios_operaciones(favoritos) {
    renderizar_favoritos_con_acciones("lista_beneficiarios_operaciones", favoritos, {
        mensajeVacio: "Aun no tienes beneficiarios favoritos.",
        mensajeEstadoId: "texto_estado_transferencia"
    });
}

/**
 * Funcion: alternar_fecha_programada
 *
 * Que hace: habilita el campo de fecha solo cuando la transferencia es programada.
 * Como lo hace: ajusta required y disabled segun el tipo y limpia el valor si no aplica.
 * Datos que participan: #tipo_transferencia, #fecha_programada_transferencia.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: aplicar_favorito_seleccionado
 *
 * Que hace: copia al formulario los datos del favorito elegido.
 * Como lo hace: busca el favorito en el estado y rellena destinatario, banco y cuenta; usa la bandera
 *   aplicandoFavorito para que esos cambios no des-seleccionen el favorito.
 * Datos que participan: `estado_aplicacion.favoritosTransferencia`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_favoritos_con_acciones
 *
 * Que hace: pinta una lista de favoritos con un boton para quitar cada uno.
 * Como lo hace: crea el contenido con textContent (sin HTML) y conecta el boton a eliminar_favorito.
 * Datos que participan: `idLista`, `favoritos`, `opciones` { mensajeVacio, mensajeEstadoId }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: eliminar_favorito
 *
 * Que hace: quita un beneficiario de favoritos sin borrarlo de la base.
 * Como lo hace: deshabilita el boton, llama a la API, recarga la pagina correspondiente (principal u
 *   operaciones) y las alertas y muestra el resultado.
 * Datos que participan: `beneficiaryId`, `mensajeEstadoId`, `botonActivo`.
 * Consultas (API/SQL): POST /api/beneficiaries/remove-favorite (backend: UPDATE beneficiarios SET es_favorito
 *   = FALSE WHERE id_beneficiario = $1 AND usuario_id = $2 ...).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: inicializar_movimientos
 *
 * Que hace: prepara la pagina de movimientos con filtros.
 * Como lo hace: conecta el buscador (con retardo de 180 ms para no consultar en cada tecla) y los selects de
 *   tipo y estado, y hace la primera carga.
 * Datos que participan: #filtro_busqueda_movimientos, #filtro_tipo_movimientos, #filtro_estado_movimientos.
 * Consultas (API/SQL): indirecta: GET /api/movements.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: cargar_movimientos_filtrados
 *
 * Que hace: pide al backend los movimientos con los filtros actuales y repinta la pagina.
 * Como lo hace: arma la query string con search, type y status normalizados y renderiza tabla, actividad,
 *   resumen y graficos.
 * Datos que participan: valores de los filtros.
 * Consultas (API/SQL): GET /api/movements?search=&type=&status= (backend: SELECT dinamico sobre transacciones
 *   con LEFT JOIN a beneficiarios, proveedores_servicio y movimientos_cuenta; ver movement.dao.getMovementRows).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: renderizar_tabla_movimientos
 *
 * Que hace: pinta la tabla de movimientos.
 * Como lo hace: crea una fila por movimiento (fecha, tipo, detalle, estado, monto con signo) usando
 *   textContent; si no hay datos muestra una fila informativa.
 * Datos que participan: `lista`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_actividad_movimientos
 *
 * Que hace: pinta la actividad reciente (4 ultimos movimientos).
 * Como lo hace: convierte cada movimiento en un item compacto de titulo y detalle.
 * Datos que participan: `lista`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_resumen_movimientos
 *
 * Que hace: calcula y pinta el resumen de lo que se ve con el filtro actual.
 * Como lo hace: cuenta ingresos (monto >
 *   0) y egresos (monto <
 *   0) y suma el volumen absoluto.
 * Datos que participan: `lista`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_graficos_movimientos
 *
 * Que hace: dibuja los graficos de movimientos con Chart.js.
 * Como lo hace: agrupa por fecha ingresos y egresos (ultimas 7 fechas) para un grafico de barras y reparte
 *   gastos, ahorro e ingresos en un grafico de dona; usa los colores del tema. Si Chart.js no cargo, no hace
 *   nada.
 * Datos que participan: `lista`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: inicializar_portal_forex
 *
 * Que hace: prepara las paginas del modulo Forex (mercado, aprendizaje y cuestionario).
 * Como lo hace: conecta el selector de par, el submit del cuestionario y, solo en la pagina de mercado, un
 *   refresco automatico cada 60 segundos; luego carga el contenido.
 * Datos que participan: #selector_par_forex, #formulario_quiz_forex.
 * Consultas (API/SQL): indirecta: GET /api/forex/learning.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: cargar_aprendizaje_forex
 *
 * Que hace: carga el contenido educativo y el mercado del par elegido y repinta el modulo Forex.
 * Como lo hace: guarda el par activo, consulta la API, lee progreso e historial locales, escoge el modulo
 *   activo (el primero desbloqueado si el actual ya no existe) y llama a los renderizadores.
 * Datos que participan: `par` (ej. EURUSD).
 * Consultas (API/SQL): GET /api/forex/learning?pair= (backend: plan de estudio fijo + serie del BCE o
 *   respaldo; no usa base de datos).
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: renderizar_modulos_forex
 *
 * Que hace: pinta las tarjetas de los modulos de estudio.
 * Como lo hace: crea un boton por modulo; deshabilita los bloqueados y marca activo, completo o bloqueado; al
 *   hacer clic cambia el modulo activo.
 * Datos que participan: curriculum, progreso local.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_tablero_progreso_forex
 *
 * Que hace: pinta el porcentaje de avance y el historial de estudio.
 * Como lo hace: calcula completados / total, ajusta la barra y lista los ultimos 5 hitos.
 * Datos que participan: curriculum, progreso e historial locales.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: modulo_desbloqueado
 *
 * Que hace: indica si un modulo ya se puede abrir.
 * Como lo hace: el primero siempre esta libre; los demas exigen que todos los anteriores esten superados.
 * Datos que participan: `indice` del modulo.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: boolean.
 */
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

/**
 * Funcion: renderizar_mercado_forex
 *
 * Que hace: pinta el resumen, el grafico de precio, las metricas y las notas del mercado.
 * Como lo hace: escribe el resumen del par, dibuja una linea con la serie, crea una tarjeta por cada
 *   contextCard y lista las notas.
 * Datos que participan: estado_aplicacion.forexAprendizaje.market.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_modulo_forex_activo
 *
 * Que hace: pinta el contenido del modulo seleccionado.
 * Como lo hace: muestra descripcion y objetivo usando el par activo como ejemplo, los bloques, el checklist,
 *   los dominios y el cuestionario.
 * Datos que participan: modulo activo y mercado.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_quiz_forex
 *
 * Que hace: dibuja el cuestionario de un modulo.
 * Como lo hace: crea un fieldset por pregunta con opciones tipo radio; el HTML se escapa con escapar_html.
 * Datos que participan: `modulo` (preguntas, opciones).
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: validar_quiz_forex_activo
 *
 * Que hace: corrige el cuestionario del modulo activo.
 * Como lo hace: exige todas las respuestas y que sean correctas; si hay un error muestra el primero (con su
 *   explicacion). Si todo es correcto marca el modulo como superado, guarda el progreso y el hito y abre el
 *   siguiente.
 * Datos que participan: respuestas marcadas, modulo activo.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_progreso_forex_local
 *
 * Que hace: lee el progreso de estudio del usuario.
 * Como lo hace: JSON en localStorage con la clave wallet_forex_progress_{id de usuario} (o 'anonimo');
 *   devuelve {} si esta vacio o corrupto. El progreso vive solo en este navegador.
 * Datos que participan: usuario actual, localStorage.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: objeto { moduloId: true }.
 */
function obtener_progreso_forex_local() {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_progress_${usuarioId}`;

    try {
        return JSON.parse(localStorage.getItem(clave) || "{}");
    } catch (error) {
        return {};
    }
}

/**
 * Funcion: guardar_progreso_forex_local
 *
 * Que hace: guarda el progreso de estudio.
 * Como lo hace: JSON.stringify en localStorage.
 * Datos que participan: `progreso`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function guardar_progreso_forex_local(progreso) {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_progress_${usuarioId}`;
    localStorage.setItem(clave, JSON.stringify(progreso || {}));
}

/**
 * Funcion: obtener_historial_forex_local
 *
 * Que hace: lee el historial de modulos superados.
 * Como lo hace: localStorage wallet_forex_history_{id}; [] si esta vacio o corrupto.
 * Datos que participan: usuario actual.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: arreglo.
 */
function obtener_historial_forex_local() {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_history_${usuarioId}`;

    try {
        return JSON.parse(localStorage.getItem(clave) || "[]");
    } catch (error) {
        return [];
    }
}

/**
 * Funcion: guardar_historial_forex_local
 *
 * Que hace: guarda el historial de modulos superados.
 * Como lo hace: JSON.stringify en localStorage.
 * Datos que participan: `historial`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function guardar_historial_forex_local(historial) {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_history_${usuarioId}`;
    localStorage.setItem(clave, JSON.stringify(historial || []));
}

/**
 * Funcion: registrar_hito_forex
 *
 * Que hace: registra un modulo superado en el historial.
 * Como lo hace: agrega modulo, par y fecha, conserva los ultimos 30 y los guarda.
 * Datos que participan: `modulo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_panel_alertas_superior
 *
 * Que hace: pinta la campana: contador y lista de alertas.
 * Como lo hace: actualiza el numero de no leidas (lo oculta si es
 *   0) y crea un item por alerta con clase segun su nivel, marcada como vista si ya se leyo, y boton para
 *      eliminarla. Si no hay alertas muestra un mensaje.
 * Datos que participan: `alertas`, `totalNoLeidas`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: normalizar_nivel_alerta_visual
 *
 * Que hace: reduce el nivel de alerta a las tres clases visuales.
 * Como lo hace: mapea sinonimos a 'aceptacion', 'alerta' o 'informativo' (igual que el backend).
 * Datos que participan: `nivel`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
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

/**
 * Funcion: inicializar_simulador
 *
 * Que hace: prepara la pagina del simulador Forex.
 * Como lo hace: carga el historial local, muestra el estado inicial, conecta el cambio de par y el submit
 *   (valida capital y riesgo, llama a la API, guarda la simulacion local y la pinta) y carga el mercado de
 *   referencia.
 * Datos que participan: formulario_simulador, #par_simulacion_forex.
 * Consultas (API/SQL): POST /api/forex/simulate (backend: calculo en memoria con datos del BCE; no escribe en
 *   la base); GET /api/forex/learning.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: renderizar_estado_inicial_simulador
 *
 * Que hace: muestra el estado vacio antes de simular.
 * Como lo hace: pone textos guia y tres tarjetas 'Pendiente' y muestra el estado vacio del grafico.
 * Datos que participan: ninguno.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: cargar_mercado_referencia_simulador
 *
 * Que hace: carga el mercado del par para acompanar la simulacion.
 * Como lo hace: guarda la serie y el resumen en el estado, escribe el resumen, crea tres tarjetas (sesgo,
 *   rango, promedio), lista senales, historial y plan, y dibuja el grafico.
 * Datos que participan: `par`.
 * Consultas (API/SQL): GET /api/forex/learning?pair=.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: renderizar_simulacion_forex
 *
 * Que hace: pinta el resultado de una simulacion.
 * Como lo hace: redacta el resumen (compra o venta, ganancia o perdida, riesgo, recorrido y capital final),
 *   llena el diario, el plan, el historial y las cuatro tarjetas, y dibuja la curva de capital y el grafico de
 *   mercado.
 * Datos que participan: `resultado` { pair, direction, riskCapital, movePercent, finalCapital,
 *   estimatedProfitLoss, entryDate, latestDate, riskRewardRatio, scenarioConfidence, setupChecklist,
 *   capitalPath, series }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_historial_simulacion_local
 *
 * Que hace: lee el historial de simulaciones.
 * Como lo hace: localStorage wallet_forex_sim_history_{id}; [] si esta vacio o corrupto.
 * Datos que participan: usuario actual.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: arreglo.
 */
function obtener_historial_simulacion_local() {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_sim_history_${usuarioId}`;

    try {
        return JSON.parse(localStorage.getItem(clave) || "[]");
    } catch (error) {
        return [];
    }
}

/**
 * Funcion: guardar_historial_simulacion_local
 *
 * Que hace: guarda el historial de simulaciones.
 * Como lo hace: JSON.stringify en localStorage.
 * Datos que participan: `historial`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function guardar_historial_simulacion_local(historial) {
    const usuarioId = obtener_usuario_actual()?.id || "anonimo";
    const clave = `wallet_forex_sim_history_${usuarioId}`;
    localStorage.setItem(clave, JSON.stringify(historial || []));
}

/**
 * Funcion: registrar_simulacion_local
 *
 * Que hace: agrega una simulacion al historial local.
 * Como lo hace: guarda par, direccion, capital final, recorrido y fecha, conservando las ultimas 20.
 * Datos que participan: `resultado`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: renderizar_historial_simulacion
 *
 * Que hace: pinta las ultimas 5 simulaciones.
 * Como lo hace: las invierte para mostrar primero la mas reciente.
 * Datos que participan: historial local.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: alternar_estado_vacio_simulador
 *
 * Que hace: muestra u oculta el mensaje de grafico vacio.
 * Como lo hace: alterna la clase estado_vacio_grafico_oculto.
 * Datos que participan: `mostrar`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function alternar_estado_vacio_simulador(mostrar) {
    const estado = document.getElementById("estado_vacio_simulacion");
    if (!estado) {
        return;
    }

    estado.classList.toggle("estado_vacio_grafico_oculto", !mostrar);
}

/**
 * Funcion: renderizar_grafico_mercado_simulador
 *
 * Que hace: dibuja la linea de precio del mercado en el simulador.
 * Como lo hace: usa crear_o_actualizar_grafico con los colores del tema.
 * Datos que participan: `series`, `pair`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: redibujar_graficos
 *
 * Que hace: repinta los graficos con los colores del tema actual.
 * Como lo hace: vuelve a renderizar movimientos, mercado Forex, mercado del simulador y simulacion si hay
 *   datos en memoria.
 * Datos que participan: estado_aplicacion.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_color_css
 *
 * Que hace: lee el valor de una variable CSS del tema.
 * Como lo hace: getComputedStyle sobre <html>; usa el respaldo si la variable no existe.
 * Datos que participan: `nombreVariable`, `respaldo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string de color.
 */
function obtener_color_css(nombreVariable, respaldo) {
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nombreVariable).trim();
    return valor || respaldo;
}

/**
 * Funcion: crear_o_actualizar_grafico
 *
 * Que hace: crea un grafico de Chart.js o lo reemplaza.
 * Como lo hace: destruye el grafico previo del mismo canvas (evita fugas y superposiciones) y crea uno nuevo;
 *   no hace nada si Chart.js o el canvas no existen.
 * Datos que participan: `id`, `tipo`, `data`, `options`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: construir_escalas_grafico
 *
 * Que hace: arma las escalas X/Y con los colores del tema.
 * Como lo hace: devuelve la configuracion de ticks y rejilla con variables CSS.
 * Datos que participan: variables --color_texto_suave y --color_grafico_rejilla.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: objeto de escalas.
 */
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

/**
 * Funcion: activar_panel_acceso
 *
 * Que hace: muestra el panel de acceso elegido (login, registro o reset).
 * Como lo hace: guarda el modo en el estado, marca activo el selector login/registro (reset cuenta como login)
 *   y activa el panel [data-panel-acceso] correspondiente.
 * Datos que participan: `modo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_parametro_url
 *
 * Que hace: lee un parametro de la query string.
 * Como lo hace: URLSearchParams sobre window.location.search.
 * Datos que participan: `nombre`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string, o '' si no existe.
 */
function obtener_parametro_url(nombre) {
    return new URLSearchParams(window.location.search).get(nombre) || "";
}

/**
 * Funcion: sincronizar_reset_desde_url
 *
 * Que hace: prepara el panel de restablecimiento con los datos del enlace del correo.
 * Como lo hace: si modo=reset activa el panel; si llegan correo y PIN (o token) los precarga y avisa.
 * Datos que participan: parametros modo, correo, pin|token.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: sincronizar_activacion_registro_desde_url
 *
 * Que hace: lee el enlace del correo de activacion.
 * Como lo hace: con modo=activar abre el modal precargado; si el enlace trae correo y PIN intenta cerrar la
 *   activacion automaticamente, y si solo trae correo pide completar el PIN.
 * Datos que participan: parametros modo, correo, pin.
 * Consultas (API/SQL): indirecta: POST /api/auth/register/verify.
 * Retorna: Promise<void>.
 */
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

/**
 * Funcion: mostrar_estado_sesion_desde_url
 *
 * Que hace: informa por que se llego al login (sesion cerrada o expirada).
 * Como lo hace: lee ?sesion=cerrada|expirada, muestra el mensaje y limpia el parametro.
 * Datos que participan: parametro sesion.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: limpiar_query_login
 *
 * Que hace: borra toda la query string de la URL sin recargar.
 * Como lo hace: history.replaceState con la URL sin search, para que el PIN no quede visible.
 * Datos que participan: URL actual.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function limpiar_query_login() {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, document.title, url.toString());
}

/**
 * Funcion: limpiar_parametro_url
 *
 * Que hace: borra un parametro de la URL sin recargar.
 * Como lo hace: URL.searchParams.delete y history.replaceState.
 * Datos que participan: `nombre`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function limpiar_parametro_url(nombre) {
    const url = new URL(window.location.href);
    url.searchParams.delete(nombre);
    window.history.replaceState({}, document.title, url.toString());
}

/**
 * Funcion: passwords_coinciden
 *
 * Que hace: compara contrasena y confirmacion.
 * Como lo hace: igualdad estricta de strings.
 * Datos que participan: `password`, `confirmation`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: boolean.
 */
/**
 * Funcion: abrir_modal_doble_factor
 *
 * Que hace: muestra el modal donde se escribe el codigo del segundo paso despues de una contrasena correcta.
 * Como lo hace: guarda el desafio firmado que devolvio el servidor (twoFactorToken) en estado_aplicacion, muestra a que
 *               correo (enmascarado) se envio el codigo y abre el modal. En modo preview (sin correo real) precarga
 *               el codigo para poder probar localmente.
 * Datos que participan: `respuesta` { twoFactorToken, maskedEmail, expiresInMinutes, previewMode, previewPin }.
 * Consultas (API/SQL): ninguna; el codigo ya fue enviado por POST /api/auth/login.
 * Retorna: nada.
 */
function abrir_modal_doble_factor(respuesta) {
    estado_aplicacion.twoFactorToken = respuesta.twoFactorToken || "";
    establecer_valor("doble_factor_pin", respuesta.previewPin || "");
    establecer_texto(
        "doble_factor_destino",
        `Enviamos un codigo de 6 digitos a ${respuesta.maskedEmail || "tu correo"}. Vence en ${respuesta.expiresInMinutes || 10} minutos.`
    );
    mostrar_mensaje_grupo(
        ["mensaje_doble_factor"],
        respuesta.previewMode && respuesta.previewPin
            ? "El correo real no esta configurado, asi que cargue el codigo temporal para que sigas probando."
            : "Revisa tu correo e ingresa el codigo.",
        "info",
        true
    );
    abrir_modal_wallet("modal_doble_factor");
    document.getElementById("doble_factor_pin")?.focus();
}

/**
 * Funcion: inicializar_doble_factor_login
 *
 * Que hace: conecta el formulario del modal de segundo paso para canjear el codigo por la sesion.
 * Como lo hace: limpia el codigo a solo numeros mientras se escribe y, en el submit, envia el desafio guardado y el
 *               codigo; si el servidor acepta guarda la sesion y redirige al panel; si no, muestra el error
 *               (por ejemplo "Te quedan 3 intento(s)"). Usa banderas data-inicializado para no duplicar listeners.
 * Datos que participan: #formulario_doble_factor, #doble_factor_pin, estado_aplicacion.twoFactorToken.
 * Consultas (API/SQL): POST /api/auth/login/verify-2fa (backend: valida firma y codigo del desafio, UPDATE
 *               usuarios_credenciales SET ultimo_login_exitoso, INSERT en accesos_usuario y entrega el token).
 * Retorna: nada.
 */
function inicializar_doble_factor_login() {
    const formulario = document.getElementById("formulario_doble_factor");
    const campoPin = document.getElementById("doble_factor_pin");
    if (!formulario || formulario.dataset.inicializado) {
        return;
    }

    campoPin?.addEventListener("input", function () {
        campoPin.value = clean_pin_visual(campoPin.value);
    });

    formulario.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        const pin = clean_pin_visual(obtener_valor("doble_factor_pin"));
        if (!pin) {
            mostrar_mensaje_grupo(["mensaje_doble_factor"], "Ingresa el codigo de verificacion.", "error");
            return;
        }

        try {
            mostrar_mensaje_grupo(["mensaje_doble_factor"], "Verificando codigo...", "info", true);
            const respuesta = await consumir_api("/api/auth/login/verify-2fa", {
                method: "POST",
                omitirAutorizacion: true,
                body: {
                    twoFactorToken: estado_aplicacion.twoFactorToken,
                    pin
                }
            });

            estado_aplicacion.twoFactorToken = "";
            guardar_sesion_desde_respuesta(respuesta);
            cerrar_modal_wallet("modal_doble_factor");
            window.location.href = "principal.html";
        } catch (error) {
            mostrar_mensaje_grupo(["mensaje_doble_factor"], error.message || "No fue posible verificar el codigo.", "error");
        }
    });

    formulario.dataset.inicializado = "true";
}

/**
 * Funcion: actualizar_boton_doble_factor
 *
 * Que hace: refleja en el boton del perfil si la verificacion en dos pasos esta activa o no.
 * Como lo hace: lee perfilActual.dobleFactorActivo y cambia el texto y aria-pressed del boton.
 * Datos que participan: #boton_doble_factor, estado_aplicacion.perfilActual.
 * Consultas (API/SQL): ninguna; es logica del navegador.
 * Retorna: nada.
 */
function actualizar_boton_doble_factor() {
    const boton = document.getElementById("boton_doble_factor");
    if (!boton) {
        return;
    }

    const activo = Boolean(estado_aplicacion.perfilActual?.dobleFactorActivo);
    boton.textContent = activo ? "Desactivar verificacion en dos pasos" : "Activar verificacion en dos pasos";
    boton.setAttribute("aria-pressed", String(activo));
}

/**
 * Funcion: pedir_contrasena_confirmacion
 *
 * Que hace: pide la contrasena actual antes de cambiar un ajuste de seguridad.
 * Como lo hace: abre un cuadro de SweetAlert2 con campo de contrasena; si SweetAlert2 no esta disponible usa
 *               window.prompt. La contrasena no se guarda en ningun lado, solo se envia a la API.
 * Datos que participan: `titulo`, `texto`.
 * Consultas (API/SQL): ninguna.
 * Retorna: Promise<string>, contrasena escrita o "" si se cancela.
 */
async function pedir_contrasena_confirmacion(titulo, texto) {
    if (!window.Swal) {
        return window.prompt(texto || titulo || "Escribe tu contrasena") || "";
    }

    const respuesta = await window.Swal.fire({
        title: titulo,
        text: texto,
        input: "password",
        inputPlaceholder: "Tu contrasena",
        inputAttributes: { autocomplete: "current-password" },
        showCancelButton: true,
        confirmButtonText: "Confirmar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: obtener_color_css("--color_morado_principal", "#6f3df4"),
        background: obtener_color_css("--color_superficie_solida", "#ffffff"),
        color: obtener_color_css("--color_texto_principal", "#1d152d"),
        inputValidator: function (valor) {
            return valor ? undefined : "Ingresa tu contrasena.";
        }
    });

    return respuesta.isConfirmed ? String(respuesta.value || "") : "";
}

/**
 * Funcion: inicializar_doble_factor_perfil
 *
 * Que hace: da vida al boton que activa o desactiva la verificacion en dos pasos desde el perfil.
 * Como lo hace: al hacer clic pide la contrasena actual, llama a la API con el valor contrario al actual, actualiza
 *               el perfil en memoria, repinta el boton y la lista de seguridad y recarga las alertas.
 * Datos que participan: #boton_doble_factor, estado_aplicacion.perfilActual y estado_aplicacion.centros.adelanto.
 * Consultas (API/SQL): POST /api/auth/two-factor (backend: verifica la contrasena con scrypt y
 *               UPDATE usuarios_credenciales SET doble_factor_activo; deja alerta de seguridad).
 * Retorna: nada.
 */
function inicializar_doble_factor_perfil() {
    const boton = document.getElementById("boton_doble_factor");
    if (!boton || boton.dataset.inicializado) {
        return;
    }

    boton.addEventListener("click", async function () {
        const activar = !estado_aplicacion.perfilActual?.dobleFactorActivo;
        const password = await pedir_contrasena_confirmacion(
            activar ? "Activar verificacion en dos pasos" : "Desactivar verificacion en dos pasos",
            "Por seguridad, confirma tu contrasena actual."
        );

        if (!password) {
            return;
        }

        boton.disabled = true;
        try {
            const resultado = await consumir_api("/api/auth/two-factor", {
                method: "POST",
                body: { enabled: activar, password }
            });

            estado_aplicacion.perfilActual = {
                ...(estado_aplicacion.perfilActual || {}),
                dobleFactorActivo: Boolean(resultado.twoFactorEnabled)
            };
            if (estado_aplicacion.sesion) {
                estado_aplicacion.sesion.user = estado_aplicacion.perfilActual;
            }

            actualizar_boton_doble_factor();
            renderizar_alertas_seguridad(
                estado_aplicacion.perfilActual,
                estado_aplicacion.centros?.adelanto?.currentAdvance || null
            );
            await refrescar_panel_alertas_desde_servidor();
            mostrar_mensaje("mensaje_perfil", resultado.message || "Seguridad actualizada.", "exito");
        } catch (error) {
            mostrar_mensaje("mensaje_perfil", error.message || "No fue posible cambiar la verificacion en dos pasos.", "error");
        } finally {
            boton.disabled = false;
        }
    });

    boton.dataset.inicializado = "true";
}

function passwords_coinciden(password, confirmation) {
    return String(password || "") === String(confirmation || "");
}

/**
 * Funcion: normalizar_correo_local
 *
 * Que hace: baja el correo a un formato comparable (sin espacios ni mayusculas).
 * Como lo hace: trim y toLowerCase.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function normalizar_correo_local(valor) {
    return String(valor || "").trim().toLowerCase();
}

/**
 * Funcion: normalizar_dui_visual
 *
 * Que hace: formatea el DUI a 12345678-9 mientras se escribe.
 * Como lo hace: deja solo digitos (maximo
 *   9) y agrega el guion antes del ultimo.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function normalizar_dui_visual(valor) {
    const digitos = String(valor || "").replace(/\D/g, "").slice(0, 9);
    if (digitos.length <= 8) {
        return digitos;
    }

    return `${digitos.slice(0, 8)}-${digitos.slice(8)}`;
}

/**
 * Funcion: normalizar_telefono_visual
 *
 * Que hace: deja pasar solo caracteres propios de un telefono.
 * Como lo hace: elimina todo lo que no sea digito, +, parentesis, espacio o guion y limita a 25 caracteres.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function normalizar_telefono_visual(valor) {
    return String(valor || "")
        .replace(/[^\d+() -]/g, "")
        .slice(0, 25);
}

/**
 * Funcion: normalizar_telefono_local_visual
 *
 * Que hace: limpia el numero local para dejar solo digitos (el prefijo vive aparte en el selector).
 * Como lo hace: elimina no digitos y limita a 15.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function normalizar_telefono_local_visual(valor) {
    return String(valor || "")
        .replace(/\D/g, "")
        .slice(0, 15);
}

/**
 * Funcion: validar_correo_frontend
 *
 * Que hace: valida el correo con las mismas reglas estrictas del backend para fallar antes desde la UI. las
 *   validaciones del frontend replican las del backend (base.model.js) solo para avisar mas rapido; el backend
 *   vuelve a validar siempre.
 * Como lo hace: comprueba longitud, un solo '@', parte local y etiquetas del dominio con TLD de solo letras.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: correo normalizado, o lanza Error.
 */
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

/**
 * Funcion: validar_nombre_humano_frontend
 *
 * Que hace: rechaza nombres con numeros o simbolos raros. las validaciones del frontend replican las del
 *   backend (base.model.js) solo para avisar mas rapido; el backend vuelve a validar siempre.
 * Como lo hace: exige entre 2 y 80 caracteres y una expresion regular de letras separadas por espacio,
 *   apostrofe, guion o punto.
 * Datos que participan: `valor`, `etiqueta`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: texto, o lanza Error.
 */
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

/**
 * Funcion: validar_telefono_frontend
 *
 * Que hace: valida el telefono visible y descarta patrones falsos. las validaciones del frontend replican las
 *   del backend (base.model.js) solo para avisar mas rapido; el backend vuelve a validar siempre.
 * Como lo hace: exige 8 a 15 digitos y rechaza repetidos (11111111) y secuencias tipicas.
 * Datos que participan: `valor`, `etiqueta`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: telefono, o lanza Error.
 */
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

/**
 * Funcion: validar_dui_frontend
 *
 * Que hace: exige 9 digitos de DUI y devuelve el valor ya normalizado. las validaciones del frontend replican
 *   las del backend (base.model.js) solo para avisar mas rapido; el backend vuelve a validar siempre.
 * Como lo hace: normaliza con guion y rechaza todos los digitos iguales.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: DUI normalizado, o lanza Error.
 */
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

/**
 * Funcion: validar_fecha_nacimiento_frontend
 *
 * Que hace: comprueba fecha valida, no futura y mayoria de edad. las validaciones del frontend replican las
 *   del backend (base.model.js) solo para avisar mas rapido; el backend vuelve a validar siempre.
 * Como lo hace: calcula la edad ajustando por mes y dia y exige 18 anios.
 * Datos que participan: `valor`, `requerida`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: fecha (texto), '' si es opcional y vacia, o lanza Error.
 */
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

/**
 * Funcion: validar_direccion_frontend
 *
 * Que hace: filtra caracteres raros y exige una direccion util. las validaciones del frontend replican las del
 *   backend (base.model.js) solo para avisar mas rapido; el backend vuelve a validar siempre.
 * Como lo hace: entre 10 y 300 caracteres con letras, numeros y # . , - /
 * Datos que participan: `valor`, `requerida`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: direccion, '' si es opcional y vacia, o lanza Error.
 */
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

/**
 * Funcion: validar_password_segura_frontend
 *
 * Que hace: replica la regla minima de contrasena para avisar rapido. las validaciones del frontend replican
 *   las del backend (base.model.js) solo para avisar mas rapido; el backend vuelve a validar siempre.
 * Como lo hace: minimo 8 caracteres con al menos una letra y un numero.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: contrasena, o lanza Error.
 */
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

/**
 * Funcion: aplicar_formato_documento_input
 *
 * Que hace: formatea el DUI en vivo en un input.
 * Como lo hace: registra una sola vez un listener 'input' que aplica normalizar_dui_visual.
 * Datos que participan: `input`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function aplicar_formato_documento_input(input) {
    if (!input || input.dataset.formatoDuiAplicado) {
        return;
    }

    input.addEventListener("input", function () {
        input.value = normalizar_dui_visual(input.value);
    });
    input.dataset.formatoDuiAplicado = "true";
}

/**
 * Funcion: aplicar_formato_telefono_input
 *
 * Que hace: limpia el telefono local en vivo en un input.
 * Como lo hace: registra una sola vez un listener 'input' que deja solo digitos.
 * Datos que participan: `input`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function aplicar_formato_telefono_input(input) {
    if (!input || input.dataset.formatoTelefonoAplicado) {
        return;
    }

    input.addEventListener("input", function () {
        input.value = normalizar_telefono_local_visual(input.value);
    });
    input.dataset.formatoTelefonoAplicado = "true";
}

/**
 * Funcion: guardar_sesion_desde_respuesta
 *
 * Que hace: guarda en el navegador la sesion devuelta por login, activacion o cambio de contrasena.
 * Como lo hace: guarda el token en localStorage, el usuario en perfilActual y { user, alerts, unreadAlerts }
 *   en sesion, y refresca el menu.
 * Datos que participan: `respuesta` { token, user, alerts, unreadAlerts }.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: obtener_valor
 *
 * Que hace: lee el valor de un campo por id, sin espacios sobrantes.
 * Como lo hace: getElementById y trim; devuelve '' si el campo no existe.
 * Datos que participan: `id`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function obtener_valor(id) {
    const elemento = document.getElementById(id);
    return elemento ? String(elemento.value || "").trim() : "";
}

/**
 * Funcion: establecer_valor
 *
 * Que hace: escribe el valor de un campo por id.
 * Como lo hace: asigna element.value si el campo existe.
 * Datos que participan: `id`, `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function establecer_valor(id, valor) {
    const elemento = document.getElementById(id);
    if (elemento) {
        elemento.value = valor || "";
    }
}

/**
 * Funcion: establecer_texto
 *
 * Que hace: escribe un texto en un elemento por id.
 * Como lo hace: usa textContent (no interpreta HTML).
 * Datos que participan: `id`, `texto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function establecer_texto(id, texto) {
    const elemento = document.getElementById(id);
    if (elemento) {
        elemento.textContent = texto;
    }
}

/**
 * Funcion: agregar_li
 *
 * Que hace: agrega un <li> con texto a una lista.
 * Como lo hace: crea el elemento con textContent y lo anade.
 * Datos que participan: `lista`, `texto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function agregar_li(lista, texto) {
    const li = document.createElement("li");
    li.textContent = texto;
    lista.appendChild(li);
}

/**
 * Funcion: renderizar_lista_textos
 *
 * Que hace: reemplaza el contenido de una lista por items de texto.
 * Como lo hace: vacia la lista y agrega un <li> por texto.
 * Datos que participan: `id_lista`, `elementos`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
function renderizar_lista_textos(id_lista, elementos) {
    const lista = document.getElementById(id_lista);
    if (!lista) return;
    lista.innerHTML = "";
    elementos.forEach(function (texto) { agregar_li(lista, texto); });
}

/**
 * Funcion: mostrar_mensaje
 *
 * Que hace: muestra un mensaje de estado en un elemento y, ademas, un toast.
 * Como lo hace: escribe el texto, reemplaza la clase de tipo (info, error o exito) y llama a
 *   mostrar_toast_lateral.
 * Datos que participan: `id`, `texto`, `tipo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: mostrar_mensaje_grupo
 *
 * Que hace: muestra el mismo mensaje en varios elementos (por ejemplo, pagina y modal).
 * Como lo hace: aplica texto y clase a cada id existente y lanza un unico toast salvo que sea silencioso.
 * Datos que participan: `ids`, `texto`, `tipo`, `silencioso`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: nada.
 */
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

/**
 * Funcion: formatear_moneda
 *
 * Que hace: formatea un monto en dolares.
 * Como lo hace: Intl.NumberFormat con locale es-SV, moneda USD y 2 decimales.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string, ej. '$1,250.00'.
 */
function formatear_moneda(valor) {
    return new Intl.NumberFormat("es-SV", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2
    }).format(Number(valor || 0));
}

/**
 * Funcion: formatear_monto_con_signo
 *
 * Que hace: formatea un monto con + o - segun corresponda.
 * Como lo hace: calcula el signo y formatea el valor absoluto.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function formatear_monto_con_signo(valor) {
    const numero = Number(valor || 0);
    const signo = numero > 0 ? "+" : numero < 0 ? "-" : "";
    return signo + formatear_moneda(Math.abs(numero));
}

/**
 * Funcion: formatear_fecha
 *
 * Que hace: formatea una fecha corta para mostrar.
 * Como lo hace: toLocaleDateString('es-SV'); devuelve 'Sin registros' si es vacia o invalida.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
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

/**
 * Funcion: formatear_fecha_input
 *
 * Que hace: convierte una fecha al formato aaaa-mm-dd que exige <input type='date'>.
 * Como lo hace: si ya viene asi la deja; si no, la interpreta y toma los primeros 10 caracteres del ISO.
 * Datos que participan: `valor`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string, o ''.
 */
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

/**
 * Funcion: normalizar_tipo_movimiento
 *
 * Que hace: normaliza el filtro de tipo antes de enviarlo a la API.
 * Como lo hace: vacio o 'todos' => 'todos'; si no, minusculas.
 * Datos que participan: `tipo`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function normalizar_tipo_movimiento(tipo) {
    if (!tipo || tipo === "todos") return "todos";
    return tipo.toLowerCase();
}

/**
 * Funcion: normalizar_estado_movimiento
 *
 * Que hace: normaliza el filtro de estado antes de enviarlo a la API.
 * Como lo hace: vacio o 'todos' => 'todos'; si no, minusculas.
 * Datos que participan: `estado`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function normalizar_estado_movimiento(estado) {
    if (!estado || estado === "todos") return "todos";
    return estado.toLowerCase();
}

/**
 * Funcion: capitalizar
 *
 * Que hace: pone la primera letra en mayuscula.
 * Como lo hace: charAt(0).toUpperCase() mas el resto sin cambios.
 * Datos que participan: `texto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function capitalizar(texto) {
    const valor = String(texto || "");
    return valor ? valor.charAt(0).toUpperCase() + valor.slice(1) : "";
}

/**
 * Funcion: escapar_html
 *
 * Que hace: escapa caracteres especiales para insertar texto de forma segura en HTML (previene XSS).
 * Como lo hace: reemplaza & < > " y ' por sus entidades. Debe usarse siempre que un dato del usuario o del
 *   servidor entre a un innerHTML.
 * Datos que participan: `texto`.
 * Consultas (API/SQL): ninguna; es logica del navegador y no consulta backend ni base de datos.
 * Retorna: string.
 */
function escapar_html(texto) {
    return String(texto || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
