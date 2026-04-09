// Script global de la wallet y modulo forex.
document.addEventListener("DOMContentLoaded", function () {
    inicializar_menu_responsive();
    inicializar_campana_alertas();
    inicializar_accesos_cuenta();
    inicializar_login();
    inicializar_transferencias();
    inicializar_filtros_movimientos();
    inicializar_simulador();

    const clave_movimientos = "movimientos_wallet_bancaria";
    inicializar_movimientos_base(clave_movimientos);
    const lista_movimientos = obtener_movimientos(clave_movimientos);
    actualizar_paneles_wallet(lista_movimientos);
    aplicar_filtros_movimientos();

    dibujar_grafico_forex_tendencia();
    dibujar_grafico_forex_velas("grafico_forex_velas");
    dibujar_grafico_forex_velas("grafico_simulacion_velas");
});

function inicializar_menu_responsive() {
    const boton_menu = document.getElementById("boton_menu");
    const menu_superior = document.getElementById("menu_superior");
    if (!boton_menu || !menu_superior) return;
    boton_menu.addEventListener("click", function () {
        menu_superior.classList.toggle("menu_abierto");
        boton_menu.setAttribute("aria-expanded", String(menu_superior.classList.contains("menu_abierto")));
    });
}

function inicializar_campana_alertas() {
    const boton = document.getElementById("boton_alertas");
    const panel = document.getElementById("panel_alertas");
    if (!boton || !panel) return;
    boton.addEventListener("click", function () {
        panel.classList.toggle("panel_alertas_abierto");
        boton.setAttribute("aria-expanded", String(panel.classList.contains("panel_alertas_abierto")));
    });
    document.addEventListener("click", function (evento) {
        const click_fuera = !panel.contains(evento.target) && !boton.contains(evento.target);
        if (click_fuera) {
            panel.classList.remove("panel_alertas_abierto");
            boton.setAttribute("aria-expanded", "false");
        }
    });
}

function inicializar_accesos_cuenta() {
    const bloque = document.getElementById("bloque_saldo_toggle");
    const contenedor = document.getElementById("contenedor_atajos_cuenta");
    const cerrar = document.getElementById("boton_cerrar_paneles_wallet");
    const botones = document.querySelectorAll(".atajo_icono");
    const paneles = document.querySelectorAll(".panel_icono");
    if (!bloque || !contenedor) return;

    function alternar() {
        contenedor.classList.toggle("oculto");
        const abierto = !contenedor.classList.contains("oculto");
        bloque.setAttribute("aria-expanded", String(abierto));
        if (!abierto) {
            paneles.forEach(function (p) { p.classList.remove("panel_activo"); });
            botones.forEach(function (b) { b.classList.remove("atajo_activo"); });
        }
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
            panel.classList.toggle("panel_activo");
            boton.classList.toggle("atajo_activo");
        });
    });

    if (cerrar) {
        cerrar.addEventListener("click", function () {
            contenedor.classList.add("oculto");
            paneles.forEach(function (p) { p.classList.remove("panel_activo"); });
            botones.forEach(function (b) { b.classList.remove("atajo_activo"); });
        });
    }
}

function inicializar_login() {
    const formulario = document.getElementById("formulario_login");
    if (!formulario) return;
    formulario.addEventListener("submit", function (evento) {
        evento.preventDefault();
        const correo = obtener_valor("correo_usuario");
        const contrasena = obtener_valor("contrasena_usuario");
        if (!correo || !contrasena) return alert("Completa correo y contrasena.");
        window.location.href = "principal.html";
    });
}

function inicializar_transferencias() {
    const formulario = document.getElementById("formulario_transferencia");
    if (!formulario) return;
    document.querySelectorAll(".boton_monto_rapido").forEach(function (boton) {
        boton.addEventListener("click", function () { const i = document.getElementById("monto_transferencia"); if (i) i.value = boton.dataset.monto; });
    });
    formulario.addEventListener("submit", function (evento) {
        evento.preventDefault();
        const monto = Number(obtener_valor("monto_transferencia"));
        const destino = obtener_valor("destinatario_transferencia");
        const cuenta = obtener_valor("cuenta_origen_transferencia");
        const banco = obtener_valor("banco_destino_transferencia");
        const concepto = obtener_valor("concepto_transferencia");
        const estado = document.getElementById("texto_estado_transferencia");
        if (!monto || !destino || !cuenta || !banco || !concepto || monto <= 0) {
            if (estado) estado.textContent = "Completa todos los campos con datos validos.";
            return;
        }
        const movimiento = {
            fecha: new Date().toLocaleDateString("es-SV"),
            tipo: "Transferencia",
            detalle: cuenta + " -> " + destino + " (" + banco + ") - " + concepto,
            estado: "Completada",
            monto: -Math.abs(monto),
            contacto: destino
        };
        const clave = "movimientos_wallet_bancaria";
        const lista = obtener_movimientos(clave);
        lista.unshift(movimiento);
        localStorage.setItem(clave, JSON.stringify(lista));
        if (estado) estado.textContent = "Transferencia realizada por $" + monto.toFixed(2) + ".";
        formulario.reset();
        actualizar_paneles_wallet(lista);
        aplicar_filtros_movimientos();
    });
}

function inicializar_filtros_movimientos() {
    ["filtro_busqueda_movimientos", "filtro_tipo_movimientos", "filtro_estado_movimientos"].forEach(function (id) {
        const filtro = document.getElementById(id);
        if (filtro) {
            filtro.addEventListener("input", aplicar_filtros_movimientos);
            filtro.addEventListener("change", aplicar_filtros_movimientos);
        }
    });
}

function inicializar_simulador() {
    const formulario = document.getElementById("formulario_simulador");
    if (!formulario) return;
    formulario.addEventListener("submit", function (evento) {
        evento.preventDefault();
        const capital = Number(obtener_valor("capital_inicial"));
        const riesgo = Number(obtener_valor("porcentaje_riesgo"));
        const operaciones = Number(obtener_valor("cantidad_operaciones"));
        const salida = document.getElementById("texto_resultado_simulacion");
        if (!capital || !riesgo || !operaciones || capital <= 0 || riesgo <= 0 || operaciones <= 0) {
            if (salida) salida.textContent = "Ingresa valores validos mayores a cero.";
            return;
        }
        const por_operacion = capital * (riesgo / 100);
        if (salida) salida.textContent = "Riesgo por operacion: $" + por_operacion.toFixed(2);
    });
}

function inicializar_movimientos_base(clave) {
    if (localStorage.getItem(clave)) return;
    const base = [
        { fecha: "01/03/2026", tipo: "Deposito", detalle: "Recarga inicial de wallet", estado: "Completada", monto: 850, contacto: "-" },
        { fecha: "01/03/2026", tipo: "Pago", detalle: "Pago servicio de internet", estado: "Completada", monto: -45.5, contacto: "Internet SV" },
        { fecha: "02/03/2026", tipo: "Transferencia", detalle: "Wallet Principal -> Ana Lopez (Banco Uno) - Ahorro familiar", estado: "Completada", monto: -120, contacto: "Ana Lopez" }
    ];
    localStorage.setItem(clave, JSON.stringify(base));
}

function obtener_movimientos(clave) {
    try { return JSON.parse(localStorage.getItem(clave) || "[]"); } catch (error) { return []; }
}

function actualizar_paneles_wallet(lista) {
    const saldo = document.getElementById("texto_saldo_disponible");
    const saldo_contable = document.getElementById("texto_saldo_contable");
    const lista_movimientos = document.getElementById("lista_movimientos_recientes");
    const lista_alertas = document.getElementById("lista_alertas_seguridad");
    const tabla = document.getElementById("cuerpo_tabla_movimientos");
    const resumen = document.getElementById("lista_resumen_operaciones");
    const actividad = document.getElementById("lista_actividad_transferencias");
    const total = lista.reduce(function (a, m) { return a + Number(m.monto || 0); }, 0);
    if (saldo) saldo.textContent = "$ " + total.toFixed(2);
    if (saldo_contable) saldo_contable.textContent = "Saldo contable: $ " + (total - 35.5).toFixed(2);
    if (lista_movimientos) { lista_movimientos.innerHTML = ""; lista.slice(0, 8).forEach(function (m) { agregar_li(lista_movimientos, m.fecha + " | " + m.tipo + " | $" + Math.abs(Number(m.monto)).toFixed(2)); }); }
    if (lista_alertas) { lista_alertas.innerHTML = ""; agregar_li(lista_alertas, "Ultimo acceso: hoy 08:42 a.m."); agregar_li(lista_alertas, "Sin intentos fallidos en las ultimas 24h"); }
    if (resumen) { resumen.innerHTML = ""; agregar_li(resumen, "Total movimientos: " + lista.length); }
    if (actividad) { actividad.innerHTML = ""; lista.slice(0, 6).forEach(function (m) { agregar_li(actividad, m.fecha + " | " + m.estado + " | " + m.tipo); }); }
    if (tabla) { tabla.innerHTML = ""; lista.forEach(function (m) { const f = document.createElement("tr"); [m.fecha, m.tipo, m.detalle, m.estado, "$" + Math.abs(Number(m.monto)).toFixed(2)].forEach(function (t) { const c = document.createElement("td"); c.textContent = t; f.appendChild(c); }); tabla.appendChild(f); }); }
    renderizar_lista_basica("lista_contactos_frecuentes", ["Ana Lopez", "Carlos Mejia", "Lucia Perez"]);
    renderizar_lista_basica("lista_pagos_programados", ["Energia electrica | 10 de cada mes | $42.00", "Internet hogar | 12 de cada mes | $38.00"]);
    renderizar_lista_basica("lista_suscripciones", ["Streaming Video | $11.99 / mes", "Musica Premium | $5.99 / mes"]);
    renderizar_lista_basica("lista_resumen_mensual", ["Depositos este mes: 4", "Pagos este mes: 3", "Transferencias este mes: 2"]);
    renderizar_lista_cuentas_demo();
    renderizar_beneficiarios_demo(lista);
}

function aplicar_filtros_movimientos() {
    const tabla = document.getElementById("cuerpo_tabla_movimientos");
    if (!tabla) return;
    const texto = obtener_valor("filtro_busqueda_movimientos").toLowerCase();
    const tipo = obtener_valor("filtro_tipo_movimientos") || "todos";
    const estado = obtener_valor("filtro_estado_movimientos") || "todos";
    const lista = obtener_movimientos("movimientos_wallet_bancaria").filter(function (m) {
        const ok_texto = !texto || (m.detalle || "").toLowerCase().includes(texto) || (m.contacto || "").toLowerCase().includes(texto);
        const ok_tipo = tipo === "todos" || m.tipo === tipo;
        const ok_estado = estado === "todos" || m.estado === estado;
        return ok_texto && ok_tipo && ok_estado;
    });
    actualizar_paneles_wallet(lista);
}

function dibujar_grafico_forex_tendencia() {
    const lienzo = document.getElementById("grafico_forex_tendencia");
    if (!lienzo) return;
    const contexto = lienzo.getContext("2d");
    const ancho = lienzo.width;
    const alto = lienzo.height;
    const puntos = [101, 104, 103, 107, 110, 108, 113, 117, 115, 120];
    const maximo = Math.max.apply(null, puntos);
    const minimo = Math.min.apply(null, puntos);
    const rango = Math.max(1, maximo - minimo);
    contexto.clearRect(0, 0, ancho, alto);
    contexto.strokeStyle = "#2e2547";
    for (let i = 0; i <= 4; i += 1) {
        const y = 20 + (i * (alto - 40)) / 4;
        contexto.beginPath();
        contexto.moveTo(22, y);
        contexto.lineTo(ancho - 22, y);
        contexto.stroke();
    }
    contexto.strokeStyle = "#a77bff";
    contexto.lineWidth = 3;
    contexto.beginPath();
    puntos.forEach(function (valor, indice) {
        const x = 30 + (indice * (ancho - 60)) / (puntos.length - 1);
        const y = alto - 24 - ((valor - minimo) / rango) * (alto - 52);
        if (indice === 0) contexto.moveTo(x, y);
        else contexto.lineTo(x, y);
    });
    contexto.stroke();
}

function dibujar_grafico_forex_velas(id_lienzo) {
    const lienzo = document.getElementById(id_lienzo);
    if (!lienzo) return;
    const contexto = lienzo.getContext("2d");
    const ancho = lienzo.width;
    const alto = lienzo.height;
    const velas = [
        { apertura: 110, cierre: 114, maximo: 116, minimo: 108 },
        { apertura: 114, cierre: 112, maximo: 115, minimo: 110 },
        { apertura: 112, cierre: 118, maximo: 120, minimo: 111 },
        { apertura: 118, cierre: 116, maximo: 121, minimo: 115 },
        { apertura: 116, cierre: 122, maximo: 124, minimo: 114 },
        { apertura: 122, cierre: 119, maximo: 123, minimo: 117 },
        { apertura: 119, cierre: 125, maximo: 127, minimo: 118 }
    ];
    const maximo = Math.max.apply(null, velas.map(function (v) { return v.maximo; }));
    const minimo = Math.min.apply(null, velas.map(function (v) { return v.minimo; }));
    const rango = Math.max(1, maximo - minimo);
    contexto.clearRect(0, 0, ancho, alto);
    contexto.strokeStyle = "#2e2547";
    for (let i = 0; i <= 5; i += 1) {
        const y = 16 + (i * (alto - 32)) / 5;
        contexto.beginPath();
        contexto.moveTo(20, y);
        contexto.lineTo(ancho - 20, y);
        contexto.stroke();
    }
    velas.forEach(function (vela, indice) {
        const x = 45 + indice * ((ancho - 90) / velas.length);
        const apertura = alto - 20 - ((vela.apertura - minimo) / rango) * (alto - 44);
        const cierre = alto - 20 - ((vela.cierre - minimo) / rango) * (alto - 44);
        const max_y = alto - 20 - ((vela.maximo - minimo) / rango) * (alto - 44);
        const min_y = alto - 20 - ((vela.minimo - minimo) / rango) * (alto - 44);
        const alcista = vela.cierre >= vela.apertura;
        contexto.strokeStyle = alcista ? "#6ce2a3" : "#ff6c8d";
        contexto.fillStyle = alcista ? "#6ce2a3" : "#ff6c8d";
        contexto.beginPath();
        contexto.moveTo(x, max_y);
        contexto.lineTo(x, min_y);
        contexto.stroke();
        contexto.fillRect(x - 7, Math.min(apertura, cierre), 14, Math.max(3, Math.abs(apertura - cierre)));
    });
}

function obtener_valor(id) {
    const elemento = document.getElementById(id);
    return elemento ? String(elemento.value || "").trim() : "";
}

function agregar_li(lista, texto) {
    const li = document.createElement("li");
    li.textContent = texto;
    lista.appendChild(li);
}

function renderizar_lista_basica(id_lista, elementos) {
    const lista = document.getElementById(id_lista);
    if (!lista) return;
    lista.innerHTML = "";
    elementos.forEach(function (texto) { agregar_li(lista, texto); });
}

function renderizar_lista_cuentas_demo() {
    const lista = document.getElementById("lista_cuentas_wallet");
    if (!lista) return;
    lista.innerHTML = "";
    [
        { nombre: "Cuenta principal", saldo: 820.50 },
        { nombre: "Cuenta ahorro", saldo: 430.00 },
        { nombre: "Cuenta gastos", saldo: 120.25 }
    ].forEach(function (cuenta) {
        const item = document.createElement("li");
        const nombre = document.createElement("span");
        const saldo = document.createElement("strong");
        nombre.textContent = cuenta.nombre;
        saldo.textContent = "$ " + cuenta.saldo.toFixed(2);
        item.appendChild(nombre);
        item.appendChild(saldo);
        lista.appendChild(item);
    });
}

function renderizar_beneficiarios_demo(lista_movimientos) {
    const lista = document.getElementById("lista_beneficiarios_operaciones");
    if (!lista) return;
    lista.innerHTML = "";
    const nombres = lista_movimientos.filter(function (m) { return m.contacto && m.contacto !== "-"; }).map(function (m) { return m.contacto; }).slice(0, 5);
    if (!nombres.length) {
        agregar_li(lista, "No hay beneficiarios registrados.");
        return;
    }
    nombres.forEach(function (nombre) { agregar_li(lista, nombre); });
}
