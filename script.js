"use strict";



/* ==========================================

   AGRUPÉMONOS

   Aplicación estudiantil colaborativa

   Firebase Authentication + Cloud Firestore

========================================== */



const CLAVE_GRUPOS = "agrupemonos_grupos";

const CLAVE_SESION = "agrupemonos_sesion";



let usuarioActual = null;

let grupoSeleccionado = null;

let pestanaGrupo = "tareas";

let participantesNuevos = [];

let gruposNube = new Map();

let nubeLista = false;

let escuchadorGrupos = null;

let versionSesion = 0;

let uidActivo = null;

let avisoTimer = null;

let guardando = false;



const $ = id => document.getElementById(id);

const firebaseAPI = () => window.firebaseServicios;



function copiar(valor) {

  return JSON.parse(JSON.stringify(valor));

}



function leer(clave, defecto) {

  try {

    const dato = localStorage.getItem(clave);

    return dato ? JSON.parse(dato) : defecto;

  } catch {

    return defecto;

  }

}



function idNuevo() {

  if (typeof crypto !== "undefined" && crypto.randomUUID) {

    return crypto.randomUUID();

  }



  const bytes = new Uint8Array(16);

  crypto.getRandomValues(bytes);



  return Array.from(bytes, x =>

    x.toString(16).padStart(2, "0")

  ).join("");

}



function normalizar(texto) {

  return String(texto || "")

    .trim()

    .normalize("NFD")

    .replace(/[\u0300-\u036f]/g, "")

    .replace(/\s+/g, " ")

    .toLowerCase();

}



function elemento(etiqueta, texto = "", clase = "") {

  const el = document.createElement(etiqueta);

  el.textContent = texto;

  if (clase) el.className = clase;

  return el;

}



function boton(texto, accion, clase = "ag-btn") {

  const b = elemento("button", texto, clase);

  b.type = "button";

  b.addEventListener("click", accion);

  return b;

}



function entrada(placeholder = "", tipo = "text") {

  const e = elemento("input");

  e.type = tipo;

  e.placeholder = placeholder;

  e.className = "ag-input";

  return e;

}



function notificar(texto) {

  const caja = $("mensaje");



  if (!caja) {

    console.log(texto);

    return;

  }



  caja.textContent = texto;

  caja.classList.remove("oculta");



  clearTimeout(avisoTimer);



  avisoTimer = setTimeout(() => {

    caja.classList.add("oculta");

  }, 4500);

}



function mostrar(pantalla) {

  document.querySelectorAll(".pantalla").forEach(el => {

    el.classList.add("oculta");

  });



  $(pantalla)?.classList.remove("oculta");



  if (pantalla === "grupos") {

    renderizarGrupos();

  }



  if (pantalla === "perfil" && usuarioActual) {

    $("perfilNombre").textContent = usuarioActual.nombre;

    $("perfilCorreo").textContent = usuarioActual.correo;

  }



  window.scrollTo(0, 0);

}



function mensajeError(error) {

  const mensajes = {

    "auth/email-already-in-use": "Ese correo ya tiene una cuenta.",

    "auth/invalid-email": "El correo electrónico no es válido.",

    "auth/weak-password": "La contraseña es demasiado débil.",

    "auth/invalid-credential": "Correo o contraseña incorrectos.",

    "auth/network-request-failed": "Revisa tu conexión a internet.",

    "auth/too-many-requests": "Demasiados intentos. Inténtalo más tarde.",

    "permission-denied": "Firestore rechazó la operación. Revisa sus reglas.",

    "unavailable": "No hay conexión con Firestore."

  };



  return mensajes[error?.code] ||

    error?.message ||

    "No se pudo completar la operación.";

}



/* ==========================================

   DATOS LOCALES

========================================== */



function prepararGrupo(g) {

  if (!g.id) g.id = idNuevo();



  if (!Array.isArray(g.integrantes)) {

    g.integrantes = Array.isArray(g.participantes)

      ? [...g.participantes]

      : [];

  }



  if (!Array.isArray(g.integrantesUID)) {

    g.integrantesUID = [];

  }



  if (!Array.isArray(g.tareas)) {

    g.tareas = [];

  }



  if (!Array.isArray(g.mensajes)) {

    g.mensajes = [];

  }



  g.tareas.forEach(t => {

    if (!t.id) t.id = idNuevo();



    if (!["Pendiente", "En progreso", "Completada"].includes(t.estado)) {

      t.estado = "Pendiente";

    }

  });



  return g;

}



function gruposLocales() {

  const datos = leer(CLAVE_GRUPOS, []);

  if (!Array.isArray(datos)) return [];

  return datos.map(g => prepararGrupo(copiar(g)));

}



function guardarGrupoLocal(grupo) {

  const datos = gruposLocales();

  const copia = copiar(grupo);



  const indice = datos.findIndex(

    g => String(g.id) === String(copia.id)

  );



  if (indice === -1) {

    datos.push(copia);

  } else {

    datos[indice] = copia;

  }



  localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(datos));

}



function gruposVisibles() {

  if (!usuarioActual || !nubeLista) return [];

  return Array.from(gruposNube.values());

}



function grupoActual() {

  return gruposVisibles().find(

    g => String(g.id) === String(grupoSeleccionado)

  );

}



function progreso(tareas) {

  if (!Array.isArray(tareas) || !tareas.length) {

    return 0;

  }



  const completas = tareas.filter(

    t => t.estado === "Completada"

  ).length;



  return Math.round(completas * 100 / tareas.length);

}



function barra(valor) {

  const fondo = elemento("div", "", "ag-barra");

  const relleno = elemento("div", "", "ag-relleno");



  relleno.style.width = `${valor}%`;

  fondo.appendChild(relleno);



  return fondo;

}



/* ==========================================

   AUTENTICACIÓN

========================================== */



function establecerUsuario(user) {

  usuarioActual = {

    uid: user.uid,

    nombre:

      user.displayName?.trim() ||

      user.email?.split("@")[0] ||

      "Estudiante",

    correo: (user.email || "").toLowerCase()

  };



  localStorage.setItem(

    CLAVE_SESION,

    JSON.stringify(usuarioActual)

  );



  if ($("nombreUsuario")) {

    $("nombreUsuario").textContent =

      usuarioActual.nombre.split(" ")[0];

  }



  mostrar("inicio");

}



$("formRegistro")?.addEventListener("submit", async e => {

  e.preventDefault();



  const api = firebaseAPI();

  const nombre = $("nombreRegistro").value.trim();

  const correo = $("correoRegistro").value.trim().toLowerCase();

  const clave = $("claveRegistro").value;



  if (!nombre || !correo || clave.length < 8) {

    notificar(

      "Completa los datos. La contraseña debe tener al menos 8 caracteres."

    );

    return;

  }



  const enviar = e.target.querySelector('button[type="submit"]');

  enviar.disabled = true;



  try {

    const credencial = await api.createUserWithEmailAndPassword(

      api.auth,

      correo,

      clave

    );



    await api.updateProfile(credencial.user, {

      displayName: nombre

    });



    establecerUsuario({

      uid: credencial.user.uid,

      email: correo,

      displayName: nombre

    });



    e.target.reset();

    notificar("¡Tu cuenta fue creada!");

  } catch (error) {

    notificar(mensajeError(error));

  } finally {

    enviar.disabled = false;

  }

});



$("formLogin")?.addEventListener("submit", async e => {

  e.preventDefault();



  const api = firebaseAPI();

  const correo = $("correoLogin").value.trim().toLowerCase();

  const clave = $("claveLogin").value;

  const enviar = e.target.querySelector('button[type="submit"]');



  enviar.disabled = true;



  try {

    await api.signInWithEmailAndPassword(

      api.auth,

      correo,

      clave

    );



    e.target.reset();

  } catch (error) {

    notificar(mensajeError(error));

  } finally {

    enviar.disabled = false;

  }

});



async function cerrarSesion() {

  try {

    await firebaseAPI().signOut(firebaseAPI().auth);

  } catch (error) {

    notificar(mensajeError(error));

  }

}



/* ==========================================

   FIRESTORE

========================================== */



function iniciarNube(uid) {

  const api = firebaseAPI();

  const version = ++versionSesion;



  if (escuchadorGrupos) {

    escuchadorGrupos();

    escuchadorGrupos = null;

  }



  nubeLista = false;

  gruposNube.clear();



  const consulta = api.query(

    api.collection(api.db, "grupos"),

    api.where("integrantesUID", "array-contains", uid)

  );



  escuchadorGrupos = api.onSnapshot(

    consulta,

    instantanea => {

      if (version !== versionSesion) return;



      const nuevos = new Map();



      instantanea.forEach(documento => {

        const grupo = prepararGrupo({

          ...documento.data(),

          id: documento.id

        });



        nuevos.set(String(grupo.id), grupo);

      });



      gruposNube = nuevos;

      nubeLista = true;



      renderizarGrupos();



      if (grupoSeleccionado !== null) {

        dibujarDetalle();

      }

    },

    error => {

      if (version !== versionSesion) return;



      console.error("Firestore:", error);

      notificar(mensajeError(error));

    }

  );

}



/* ==========================================

   CAMBIOS SEGUROS EN GRUPOS

========================================== */



async function modificarGrupo(accion, campo = "tareas") {

  if (guardando) {

    notificar("Espera a que termine el guardado anterior.");

    return false;

  }



  const api = firebaseAPI();

  const actual = grupoActual();

  const uid = api.auth.currentUser?.uid;



  if (!actual || !uid) return false;



  const esPropietario = actual.propietarioUID === uid;



  if (campo === "ajustes" && !esPropietario) {

    notificar("Solo el creador puede cambiar los ajustes.");

    return false;

  }



  guardando = true;



  try {

    const referencia = api.doc(

      api.db,

      "grupos",

      String(actual.id)

    );



    const actualizado = await api.runTransaction(

      api.db,

      async transaccion => {

        const documento = await transaccion.get(referencia);



        if (!documento.exists()) {

          throw new Error("El grupo ya no existe.");

        }



        const original = documento.data();

        const copia = prepararGrupo(copiar(original));



        accion(copia);



        let cambios;



        if (campo === "ajustes") {

          cambios = {

            nombre: copia.nombre,

            materia: copia.materia,

            descripcion: copia.descripcion,

            integrantes: copia.integrantes

          };

        } else {

          cambios = {

            [campo]: copia[campo]

          };

        }



        transaccion.update(referencia, cambios);



        return {

          ...original,

          ...cambios,

          id: actual.id

        };

      }

    );



    gruposNube.set(

      String(actualizado.id),

      prepararGrupo(actualizado)

    );



    renderizarGrupos();

    dibujarDetalle();



    return true;

  } catch (error) {

    console.error(error);

    notificar(mensajeError(error));

    return false;

  } finally {

    guardando = false;

  }

}



/* ==========================================

   CREAR GRUPOS

========================================== */



function mostrarFormularioGrupo() {

  grupoSeleccionado = null;



  mostrar("grupos");

  cerrarDetalleGrupo();



  $("formGrupo")?.classList.remove("oculta");

  $("nombreGrupo")?.focus();

}



function ocultarFormularioGrupo() {

  $("formGrupo")?.reset();

  $("formGrupo")?.classList.add("oculta");



  participantesNuevos = [];

  dibujarParticipantesCrear();

}



function dibujarParticipantesCrear() {

  const caja = $("participantesCrear");

  if (!caja) return;



  caja.replaceChildren();



  participantesNuevos.forEach((nombre, indice) => {

    const fila = elemento("div", "", "participante-chip");



    fila.append(

      elemento("span", "👤 " + nombre),

      boton("✕", () => {

        participantesNuevos.splice(indice, 1);

        dibujarParticipantesCrear();

      })

    );



    caja.appendChild(fila);

  });

}



function agregarParticipanteCrear() {

  const campo = $("nuevoParticipante");

  const nombre = campo.value.trim();



  if (!nombre) {

    notificar("Escribe un nombre.");

    return;

  }



  if (

    participantesNuevos.some(

      p => normalizar(p) === normalizar(nombre)

    )

  ) {

    notificar("Ese integrante ya está agregado.");

    return;

  }



  participantesNuevos.push(nombre);

  campo.value = "";



  dibujarParticipantesCrear();

}



$("btnAgregarParticipante")?.addEventListener(

  "click",

  agregarParticipanteCrear

);



$("nuevoParticipante")?.addEventListener("keydown", e => {

  if (e.key === "Enter") {

    e.preventDefault();

    agregarParticipanteCrear();

  }

});



$("formGrupo")?.addEventListener("submit", async e => {

  e.preventDefault();



  const api = firebaseAPI();

  const uid = api.auth.currentUser?.uid;



  if (!uid) {

    notificar("Inicia sesión primero.");

    return;

  }



  const nombre = $("nombreGrupo").value.trim();

  const materia = $("materiaGrupo").value.trim();

  const descripcion = $("descripcionGrupo").value.trim();



  if (!nombre || !materia) {

    notificar("Completa nombre y asignatura.");

    return;

  }



  if (!participantesNuevos.length) {

    notificar("Agrega al menos un integrante.");

    return;

  }



  const nuevo = {

    id: idNuevo(),

    nombre,

    materia,

    descripcion,

    propietario: usuarioActual.correo,

    propietarioUID: uid,

    integrantesUID: [uid],

    integrantes: [...participantesNuevos],

    tareas: [],

    mensajes: []

  };



  const enviar = e.target.querySelector('button[type="submit"]');

  enviar.disabled = true;



  try {

    await api.setDoc(

      api.doc(api.db, "grupos", nuevo.id),

      nuevo

    );



    gruposNube.set(nuevo.id, nuevo);



    ocultarFormularioGrupo();

    renderizarGrupos();

    abrirGrupo(nuevo.id);



    notificar("¡Grupo creado!");

  } catch (error) {

    notificar(mensajeError(error));

  } finally {

    enviar.disabled = false;

  }

});



/* ==========================================

   LISTADO DE GRUPOS

========================================== */



function renderizarGrupos() {

  const caja = $("listaGrupos");

  if (!caja) return;



  caja.replaceChildren();



  const cabecera = $("cabeceraGrupos");



  if (grupoSeleccionado !== null) {

    caja.classList.add("oculta");

    cabecera?.classList.add("oculta");

    return;

  }



  caja.classList.remove("oculta");

  cabecera?.classList.remove("oculta");



  const lista = gruposVisibles();



  if (!nubeLista) {

    caja.appendChild(

      elemento("p", "Cargando tus grupos...", "vacio")

    );

    return;

  }



  if (!lista.length) {

    caja.appendChild(

      elemento(

        "p",

        "Todavía no tienes grupos en Firebase.",

        "vacio"

      )

    );

    return;

  }



  lista.forEach(g => {

    const tarjeta = elemento(

      "article",

      "",

      "tarjeta-grupo"

    );



    const avance = progreso(g.tareas);



    const encabezado = elemento("div", "", "mochi-grupo-encabezado");
    const emblema = elemento("span", "✿", "mochi-grupo-emblema");
    const datos = elemento("div", "", "mochi-grupo-datos");
    datos.append(elemento("span", g.materia || "Proyecto compartido", "mochi-grupo-materia"), elemento("h3", g.nombre));
    encabezado.append(emblema, datos, elemento("span", "↗", "mochi-grupo-flecha"));
    const resumen = elemento("div", "", "mochi-grupo-resumen");
    resumen.append(elemento("span", `◉ ${g.integrantes.length} personas`), elemento("span", `✓ ${g.tareas.length} tareas`));
    const avanceFila = elemento("div", "", "mochi-grupo-avance");
    avanceFila.append(elemento("span", "Avance del equipo"), elemento("strong", `${avance}%`));
    const acceso = boton("Entrar al grupo", () => abrirGrupo(g.id), "mochi-grupo-abrir");
    tarjeta.append(encabezado, resumen, avanceFila, barra(avance), acceso);



    caja.appendChild(tarjeta);

  });

}



function abrirGrupo(id) {

  const g = gruposVisibles().find(

    x => String(x.id) === String(id)

  );



  if (!g) {

    notificar("No se encontró el grupo.");

    return;

  }



  grupoSeleccionado = String(id);

  pestanaGrupo = "tareas";



  ocultarFormularioGrupo();

  dibujarDetalle();



  window.scrollTo(0, 0);

}



function cerrarDetalleGrupo() {

  grupoSeleccionado = null;



  const detalle = $("detalleGrupo");



  if (detalle) {

    detalle.replaceChildren();

    detalle.classList.add("oculta");

  }



  $("listaGrupos")?.classList.remove("oculta");

  $("cabeceraGrupos")?.classList.remove("oculta");



  renderizarGrupos();

}



/* ==========================================

   DETALLE DEL GRUPO

========================================== */



function dibujarDetalle() {

  if (grupoSeleccionado === null) return;



  const g = grupoActual();



  if (!g) {

    cerrarDetalleGrupo();

    return;

  }



  const caja = $("detalleGrupo");



  caja.replaceChildren();

  caja.classList.remove("oculta");



  $("listaGrupos")?.classList.add("oculta");

  $("cabeceraGrupos")?.classList.add("oculta");



  const cabecera = elemento("div", "", "ag-hero");



  cabecera.append(

    boton(

      "← Mis grupos",

      cerrarDetalleGrupo,

      "ag-volver"

    ),

    elemento("div", "☁", "ag-logo"),

    elemento("h2", g.nombre),

    elemento("p", g.materia),

    elemento(

      "span",

      `👥 ${g.integrantes.length} integrantes`,

      "ag-chip"

    )

  );



  const avance = progreso(g.tareas);



  cabecera.append(

    elemento(

      "strong",

      `Progreso del proyecto: ${avance}%`

    ),

    barra(avance)

  );



  caja.appendChild(cabecera);



  const pestanas = elemento("div", "", "ag-tabs");



  [

    ["tareas", "Tareas"],

    ["equipo", "Equipo"],

    ["chat", "Chat"],

    ["ajustes", "Ajustes"]

  ].forEach(([id, texto]) => {

    pestanas.appendChild(

      boton(

        texto,

        () => {

          pestanaGrupo = id;

          dibujarDetalle();

        },

        "ag-tab" + (pestanaGrupo === id ? " activa" : "")

      )

    );

  });



  caja.appendChild(pestanas);



  const contenido = elemento("div", "", "ag-panel mochi-panel-" + pestanaGrupo);



  if (pestanaGrupo === "tareas") {

    dibujarTareas(g, contenido);

  }



  if (pestanaGrupo === "equipo") {

    dibujarEquipo(g, contenido);

  }



  if (pestanaGrupo === "chat") {

    dibujarChat(g, contenido);

  }



  if (pestanaGrupo === "ajustes") {

    dibujarAjustes(g, contenido);

  }



  caja.appendChild(contenido);

}



function selectorPersonas(g, valor = "") {

  const select = elemento("select", "", "ag-input");



  g.integrantes.forEach(nombre => {

    const opcion = elemento("option", nombre);

    opcion.value = nombre;

    select.appendChild(opcion);

  });



  select.value = valor || g.integrantes[0] || "";

  return select;

}



/* ==========================================

   TAREAS DESPLEGABLES

========================================== */



function dibujarTareas(g, caja) {

  caja.appendChild(

    elemento("h3", "Tareas del equipo")

  );



  // Función auxiliar para crear secciones desplegables.

  function crearPanel(titulo, clase = "ag-card") {

    const panel = elemento("div", "", clase);

    const encabezado = elemento(

      "button",

      titulo + "  ⌄",

      "ag-btn claro"

    );



    encabezado.type = "button";

    encabezado.style.width = "100%";

    encabezado.style.textAlign = "left";

    encabezado.setAttribute("aria-expanded", "false");



    const contenido = elemento("div");

    contenido.hidden = true;

    contenido.style.paddingTop = "16px";



    encabezado.addEventListener("click", () => {

      contenido.hidden = !contenido.hidden;



      const abierto = !contenido.hidden;

      encabezado.textContent =

        titulo + (abierto ? "  ⌃" : "  ⌄");



      encabezado.setAttribute(

        "aria-expanded",

        String(abierto)

      );

    });



    panel.append(encabezado, contenido);



    return { panel, contenido, encabezado };

  }



  // ========================================

  // NUEVA TAREA

  // ========================================



  const nuevaSeccion = crearPanel("＋ Nueva tarea");



  const formulario = elemento("form");



  const nombre = entrada("Nombre de la tarea");

  nombre.required = true;



  const descripcion = elemento("textarea");

  descripcion.className = "ag-input";

  descripcion.placeholder = "Descripción de la tarea";



  const fecha = entrada("", "date");



  const dificultad = elemento(

    "select",

    "",

    "ag-input"

  );



  [

    { texto: "Fácil", valor: 1 },

    { texto: "Media", valor: 3 },

    { texto: "Difícil", valor: 5 }

  ].forEach(item => {

    const opcion = elemento("option", item.texto);

    opcion.value = item.valor;

    dificultad.appendChild(opcion);

  });



  dificultad.value = "3";



  const responsable = selectorPersonas(g);



  const sinAsignar = elemento("option", "Sin asignar");

  sinAsignar.value = "";



  responsable.insertBefore(

    sinAsignar,

    responsable.firstChild

  );



  responsable.value = "";



  const enviar = elemento(

    "button",

    "Guardar tarea",

    "ag-btn principal"

  );



  enviar.type = "submit";



  formulario.append(

    elemento("label", "Nombre de la tarea"),

    nombre,

    elemento("label", "Descripción"),

    descripcion,

    elemento("label", "Fecha de entrega"),

    fecha,

    elemento("label", "Dificultad de la tarea"),

    dificultad,

    elemento("label", "Responsable"),

    responsable,

    enviar

  );



  [

    nombre,

    descripcion,

    fecha,

    dificultad,

    responsable

  ].forEach(campo => {

    campo.style.display = "block";

    campo.style.width = "100%";

    campo.style.marginBottom = "14px";

  });



  formulario.querySelectorAll("label").forEach(etiqueta => {

    etiqueta.style.display = "block";

    etiqueta.style.marginBottom = "6px";

    etiqueta.style.fontWeight = "600";

  });



  formulario.addEventListener("submit", async e => {

    e.preventDefault();



    if (!nombre.value.trim()) {

      notificar("Escribe el nombre de la tarea.");

      return;

    }



    if (!g.integrantes.length) {

      notificar("Primero agrega integrantes.");

      return;

    }



    const nueva = {

      id: idNuevo(),

      nombre: nombre.value.trim(),

      descripcion: descripcion.value.trim(),

      fecha: fecha.value,

      esfuerzo: Number(dificultad.value),

      responsable: responsable.value,

      estado: "Pendiente"

    };



    enviar.disabled = true;



    try {

      const correcto = await modificarGrupo(grupo => {

        grupo.tareas.push(nueva);

      });



      if (correcto) {

        notificar("¡Tarea creada correctamente!");

      }

    } finally {

      enviar.disabled = false;

    }

  });



  nuevaSeccion.contenido.appendChild(formulario);

  caja.appendChild(nuevaSeccion.panel);



  // ========================================

  // DISTRIBUCIÓN EQUITATIVA

  // ========================================



  const reparto = crearPanel("⚖️ Distribución equitativa");



  reparto.contenido.appendChild(

    elemento(

      "p",

      "Agrupémonos puede sugerir cómo repartir las tareas pendientes entre los integrantes del equipo.",

      "ag-suave"

    )

  );



  const resultadoReparto = elemento("div");
  const sugerir = boton("✨ Sugerir distribución", () => {
    if (typeof sugerirRepartoTareas !== "function") {
      notificar("No se cargó el algoritmo de reparto."); return;
    }
    const sugerencias = sugerirRepartoTareas(g.tareas, g.integrantes);
    resultadoReparto.replaceChildren();
    if (!sugerencias.length) {
      resultadoReparto.append(elemento("p", "No hay tareas pendientes sin asignar.", "ag-suave"));
      return;
    }
    resultadoReparto.append(elemento("h4", "Propuesta de distribución"));
    sugerencias.forEach(t => {
      const fila = elemento("div", "", "ag-card");
      fila.append(elemento("strong", t.nombre), elemento("p", "👤 " + t.responsableSugerido, "ag-suave"));
      resultadoReparto.append(fila);
    });
    resultadoReparto.append(elemento("p", "Vista previa: aún no se ha guardado nada.", "ag-suave"));
    const confirmar = boton("✓ Confirmar y guardar distribución", async () => {
      if (!confirm("¿Asignar estas tareas en Firebase?")) return;
      confirmar.disabled = true;
      const propuesta = new Map(sugerencias.map(t => [String(t.id), t.responsableSugerido]));
      const correcto = await modificarGrupo(grupo => {
        for (const tarea of grupo.tareas) {
          const asignado = propuesta.get(String(tarea.id));
          if (!asignado) continue;
          if (tarea.estado !== "Pendiente" || String(tarea.responsable || "").trim()) {
            throw new Error("Las tareas cambiaron. Genera una nueva propuesta.");
          }
          if (!grupo.integrantes.includes(asignado)) {
            throw new Error("Cambió el equipo. Genera una nueva propuesta.");
          }
          tarea.responsable = asignado;
        }
      });
      if (correcto) notificar("Distribución guardada correctamente.");
      else confirmar.disabled = false;
    }, "ag-btn principal");
    resultadoReparto.append(confirmar);
  }, "ag-btn principal");

  reparto.contenido.append(

    sugerir,

    resultadoReparto

  );



  caja.appendChild(reparto.panel);



  // ========================================

  // LISTADO DE TAREAS

  // ========================================



  caja.appendChild(

    elemento("h4", `📋 Tareas registradas (${g.tareas.length})`)

  );



  g.tareas.forEach(t => {

    const tarjeta = elemento(

      "article",

      "",

      "ag-card"

    );



    const encabezado = elemento(

      "button",

      "",

      "ag-btn claro"

    );



    encabezado.type = "button";

    encabezado.style.width = "100%";

    encabezado.style.textAlign = "left";

    encabezado.style.display = "flex";

    encabezado.style.justifyContent = "space-between";

    encabezado.style.alignItems = "center";

    encabezado.style.gap = "12px";



    const resumen = elemento("div");

    resumen.style.display = "flex";

    resumen.style.flexDirection = "column";

    resumen.style.gap = "6px";

    resumen.style.minWidth = "0";



    const titulo = elemento("strong", t.nombre);



    const responsableResumen = elemento(

      "span",

      "👤 " + (t.responsable || "Sin asignar"),

      "ag-suave"

    );



    responsableResumen.style.fontSize = "13px";



    const estadoResumen = elemento(

      "span",

      t.estado || "Pendiente",

      "ag-estado"

    );



    resumen.append(

      titulo,

      responsableResumen,

      estadoResumen

    );



    const flecha = elemento("span", "⌄");

    flecha.style.fontSize = "24px";

    flecha.style.flexShrink = "0";



    encabezado.append(resumen, flecha);



    const contenido = elemento("div");

    contenido.hidden = true;

    contenido.style.paddingTop = "16px";



    encabezado.setAttribute("aria-expanded", "false");



    encabezado.addEventListener("click", () => {

      contenido.hidden = !contenido.hidden;



      const abierto = !contenido.hidden;

      flecha.textContent = abierto ? "⌃" : "⌄";



      encabezado.setAttribute(

        "aria-expanded",

        String(abierto)

      );

    });



    if (t.descripcion) {

      contenido.appendChild(

        elemento(

          "p",

          t.descripcion,

          "ag-suave"

        )

      );

    }



    contenido.appendChild(

      elemento(

        "p",

        t.fecha

          ? "📅 Fecha de entrega: " + t.fecha

          : "📅 Sin fecha de entrega",

        "ag-suave"

      )

    );



    const esfuerzo = Number(t.esfuerzo) || 1;



    const dificultadTexto =

      esfuerzo >= 5

        ? "Difícil"

        : esfuerzo >= 3

          ? "Media"

          : "Fácil";



    contenido.appendChild(

      elemento(

        "p",

        "⭐ Dificultad: " + dificultadTexto,

        "ag-suave"

      )

    );



    contenido.appendChild(

      elemento("label", "Estado de la tarea")

    );



    const select = elemento(

      "select",

      "",

      "ag-input"

    );



    [

      "Pendiente",

      "En progreso",

      "Completada"

    ].forEach(nombreEstado => {

      const opcion = elemento(

        "option",

        nombreEstado

      );



      opcion.value = nombreEstado;

      select.appendChild(opcion);

    });



    select.value = t.estado || "Pendiente";



    select.addEventListener("change", async () => {

      const nuevoEstado = select.value;

      select.disabled = true;



      try {

        const correcto = await modificarGrupo(grupo => {

          const tarea = grupo.tareas.find(

            x => x.id === t.id

          );



          if (tarea) {

            tarea.estado = nuevoEstado;

          }

        });



        if (!correcto) {

          select.value = t.estado;

        }

      } finally {

        select.disabled = false;

      }

    });



    const acciones = elemento(

      "div",

      "",

      "ag-acciones"

    );



    acciones.style.marginTop = "16px";



    acciones.append(

      boton(

        "✏️ Editar",

        () => editarTarea(g, t),

        "ag-btn claro"

      ),



      boton(

        "🗑️ Eliminar",

        async () => {

          if (!confirm("¿Eliminar esta tarea?")) {

            return;

          }



          await modificarGrupo(grupo => {

            grupo.tareas = grupo.tareas.filter(

              x => x.id !== t.id

            );

          });

        },

        "ag-btn peligro"

      )

    );



    contenido.append(select, acciones);

    tarjeta.append(encabezado, contenido);

    caja.appendChild(tarjeta);

  });



  if (!g.tareas.length) {

    caja.appendChild(

      elemento(

        "p",

        "Todavía no hay tareas. Puedes crear una arriba.",

        "ag-card"

      )

    );

  }

}



/* ==========================================

   EDITAR TAREA

========================================== */



async function editarTarea(g, t) {

  const anterior = document.getElementById(

    "ag-editor-tarea"

  );



  if (anterior) anterior.remove();



  const fondo = elemento("div");

  fondo.id = "ag-editor-tarea";



  Object.assign(fondo.style, {

    position: "fixed",

    inset: "0",

    background: "rgba(15, 23, 42, 0.65)",

    display: "flex",

    alignItems: "center",

    justifyContent: "center",

    padding: "16px",

    zIndex: "9999",

    overflowY: "auto"

  });



  const formulario = elemento(

    "form",

    "",

    "ag-card"

  );



  Object.assign(formulario.style, {

    width: "100%",

    maxWidth: "460px",

    maxHeight: "90vh",

    overflowY: "auto",

    background: "#ffffff",

    borderRadius: "20px",

    padding: "24px",

    boxShadow: "0 20px 60px rgba(0,0,0,0.2)"

  });



  formulario.append(

    elemento("h3", "✏️ Editar tarea"),

    elemento(

      "p",

      "Modifica los datos de la tarea.",

      "ag-suave"

    )

  );



  const etiquetaNombre = elemento(

    "label",

    "Nombre de la tarea"

  );



  const nombre = entrada("Nombre de la tarea");

  nombre.value = t.nombre || "";

  nombre.required = true;



  const etiquetaDescripcion = elemento(

    "label",

    "Descripción"

  );



  const descripcion = elemento("textarea");

  descripcion.className = "ag-input";

  descripcion.rows = 3;

  descripcion.value = t.descripcion || "";

  descripcion.placeholder = "Describe la actividad";



  const etiquetaResponsable = elemento(

    "label",

    "Responsable"

  );



  const responsable = elemento(

    "select",

    "",

    "ag-input"

  );



  const opcionLibre = elemento(

    "option",

    "Sin asignar"

  );



  opcionLibre.value = "";

  responsable.appendChild(opcionLibre);



  g.integrantes.forEach(persona => {

    const opcion = elemento("option", persona);

    opcion.value = persona;

    responsable.appendChild(opcion);

  });



  responsable.value = t.responsable || "";



  const etiquetaFecha = elemento(

    "label",

    "Fecha de entrega"

  );



  const fecha = entrada("", "date");

  fecha.value = t.fecha || "";



  const etiquetaEstado = elemento(

    "label",

    "Estado"

  );



  const estado = elemento(

    "select",

    "",

    "ag-input"

  );



  [

    "Pendiente",

    "En progreso",

    "Completada"

  ].forEach(valor => {

    const opcion = elemento("option", valor);

    opcion.value = valor;

    estado.appendChild(opcion);

  });



  estado.value = t.estado || "Pendiente";



  const acciones = elemento(

    "div",

    "",

    "ag-acciones"

  );



  const cancelar = boton(

    "Cancelar",

    () => fondo.remove(),

    "ag-btn claro"

  );



  const guardar = elemento(

    "button",

    "Guardar cambios",

    "ag-btn principal"

  );



  guardar.type = "submit";



  acciones.append(cancelar, guardar);



  formulario.append(

    etiquetaNombre,

    nombre,

    etiquetaDescripcion,

    descripcion,

    etiquetaResponsable,

    responsable,

    etiquetaFecha,

    fecha,

    etiquetaEstado,

    estado,

    acciones

  );



  [

    nombre,

    descripcion,

    responsable,

    fecha,

    estado

  ].forEach(campo => {

    campo.style.display = "block";

    campo.style.width = "100%";

    campo.style.marginBottom = "14px";

  });



  [

    etiquetaNombre,

    etiquetaDescripcion,

    etiquetaResponsable,

    etiquetaFecha,

    etiquetaEstado

  ].forEach(etiqueta => {

    etiqueta.style.display = "block";

    etiqueta.style.marginBottom = "6px";

    etiqueta.style.fontWeight = "600";

  });



  formulario.addEventListener("submit", async e => {

    e.preventDefault();



    if (!nombre.value.trim()) {

      notificar("Escribe un nombre para la tarea.");

      return;

    }



    guardar.disabled = true;

    guardar.textContent = "Guardando...";



    try {

      const correcto = await modificarGrupo(grupo => {

        const tarea = grupo.tareas.find(

          x => x.id === t.id

        );



        if (!tarea) return;



        tarea.nombre = nombre.value.trim();

        tarea.descripcion = descripcion.value.trim();

        tarea.responsable = responsable.value;

        tarea.fecha = fecha.value;

        tarea.estado = estado.value;

      });



      if (correcto) {

        fondo.remove();

        notificar("Tarea actualizada correctamente.");

      }

    } catch (error) {

      notificar("No se pudieron guardar los cambios.");

    } finally {

      guardar.disabled = false;

      guardar.textContent = "Guardar cambios";

    }

  });



  fondo.appendChild(formulario);

  document.body.appendChild(fondo);



  nombre.focus();

}



/* ==========================================

   EQUIPO

========================================== */



function dibujarEquipo(g, caja) {

  caja.appendChild(

    elemento("h3", "Progreso por integrante")

  );



  g.integrantes.forEach(persona => {

    const tareas = g.tareas.filter(

      t => normalizar(t.responsable) ===

        normalizar(persona)

    );



    const completas = tareas.filter(

      t => t.estado === "Completada"

    ).length;



    const tarjeta = elemento(

      "article",

      "",

      "ag-card"

    );



    tarjeta.append(

      elemento("h4", "👤 " + persona),

      elemento(

        "p",

        `${completas} de ${tareas.length} tareas completadas`

      ),

      barra(progreso(tareas))

    );



    tareas.forEach(t => {

      tarjeta.appendChild(

        elemento(

          "p",

          (t.estado === "Completada" ? "✓ " : "○ ") +

            t.nombre,

          "ag-suave"

        )

      );

    });



    caja.appendChild(tarjeta);

  });

}



/* ==========================================

   CHAT

========================================== */



function dibujarChat(g, caja) {

  caja.appendChild(

    elemento("h3", "Chat del grupo")

  );



  const mensajes = elemento(

    "div",

    "",

    "ag-card ag-chat"

  );



  g.mensajes.forEach(m => {

    const burbuja = elemento(

      "div",

      "",

      "ag-burbuja"

    );



    burbuja.append(

      elemento(

        "strong",

        m.autor || "Estudiante"

      ),

      elemento("p", m.texto || ""),

      elemento("small", m.fecha || "")

    );



    mensajes.appendChild(burbuja);

  });



  if (!g.mensajes.length) {

    mensajes.appendChild(

      elemento(

        "p",

        "Aún no hay mensajes.",

        "ag-suave"

      )

    );

  }



  caja.appendChild(mensajes);



  const formulario = elemento("form");

  const mensaje = entrada("Escribe un mensaje...");



  mensaje.maxLength = 1000;

  mensaje.required = true;



  const enviar = elemento(

    "button",

    "Enviar →",

    "ag-btn principal"

  );



  enviar.type = "submit";



  formulario.append(mensaje, enviar);



  formulario.addEventListener("submit", async e => {

    e.preventDefault();



    const texto = mensaje.value.trim();

    if (!texto) return;



    const api = firebaseAPI();



    const nuevo = {

      id: idNuevo(),

      autor: usuarioActual.nombre,

      autorUID: usuarioActual.uid,

      texto,

      fecha: new Date().toLocaleString("es-CL")

    };



    enviar.disabled = true;



    try {

      await api.updateDoc(

        api.doc(

          api.db,

          "grupos",

          String(g.id)

        ),

        {

          mensajes: api.arrayUnion(nuevo)

        }

      );



      mensaje.value = "";

    } catch (error) {

      notificar(mensajeError(error));

    } finally {

      enviar.disabled = false;

    }

  });



  caja.appendChild(formulario);

}



/* ==========================================

   INVITACIONES

========================================== */



async function crearInvitacion(g) {

  const api = firebaseAPI();

  const uid = api.auth.currentUser?.uid;



  if (g.propietarioUID !== uid) {

    notificar("Solo el creador puede invitar.");

    return;

  }



  try {

    let codigo = g.codigoInvitacion;



    if (!codigo) {

      codigo = idNuevo().replace(/-/g, "");



      await api.setDoc(

        api.doc(

          api.db,

          "invitaciones",

          codigo

        ),

        {

          grupoId: String(g.id),

          propietarioUID: uid

        }

      );



      await api.updateDoc(

        api.doc(

          api.db,

          "grupos",

          String(g.id)

        ),

        {

          codigoInvitacion: codigo

        }

      );

    }



    window.mostrarQRGrupo?.(codigo, g.nombre);

  } catch (error) {

    notificar(mensajeError(error));

  }

}



async function unirseConCodigo(codigo) {

  const api = firebaseAPI();

  const uid = api.auth.currentUser?.uid;



  if (!uid) {

    notificar("Primero inicia sesión.");

    return;

  }



  try {

    const invitacion = await api.getDoc(

      api.doc(

        api.db,

        "invitaciones",

        codigo

      )

    );



    if (!invitacion.exists()) {

      notificar("El código no existe.");

      return;

    }



    const grupoId = invitacion.data().grupoId;



    const grupoRef = api.doc(api.db, "grupos", grupoId);
    const solicitudRef = api.doc(api.db, "solicitudesIngreso", `${grupoId}_${uid}`);
    await api.setDoc(solicitudRef, {
      grupoId,
      solicitanteUID: uid,
      propietarioUID: invitacion.data().propietarioUID,
      codigoInvitacion: codigo,
      nombre: api.auth.currentUser?.displayName || api.auth.currentUser?.email || "Compañero",
      estado: "pendiente",
      creada: api.serverTimestamp()
    });
    notificar("Solicitud enviada. El creador del grupo debe aprobarla.");
    history.replaceState(null, "", location.pathname);
  } catch (error) {

    notificar(mensajeError(error));

  }

}



/* ==========================================

   AJUSTES

========================================== */



function dibujarAjustes(g, caja) {

  caja.appendChild(

    elemento("h3", "Administrar grupo")

  );



  const uid = firebaseAPI().auth.currentUser?.uid;



  if (g.propietarioUID !== uid) {

    caja.appendChild(

      elemento(

        "p",

        "Solo el creador puede cambiar estos ajustes.",

        "ag-card"

      )

    );

    return;

  }



  const tarjeta = elemento(

    "div",

    "",

    "ag-card"

  );



  const nombre = entrada("Nombre del grupo");

  nombre.value = g.nombre;



  const materia = entrada("Asignatura");

  materia.value = g.materia;



  const descripcion = elemento("textarea");

  descripcion.className = "ag-input";

  descripcion.value = g.descripcion || "";



  tarjeta.append(

    elemento("h4", "Información del grupo"),

    nombre,

    materia,

    descripcion,

    boton(

      "Guardar cambios",

      async () => {

        if (

          !nombre.value.trim() ||

          !materia.value.trim()

        ) {

          notificar("Completa nombre y asignatura.");

          return;

        }



        await modificarGrupo(

          grupo => {

            grupo.nombre = nombre.value.trim();

            grupo.materia = materia.value.trim();

            grupo.descripcion = descripcion.value.trim();

          },

          "ajustes"

        );

      },

      "ag-btn principal"

    )

  );



  tarjeta.append(

    elemento("h4", "Invitar compañeros"),

    elemento(

      "p",

      "Comparte un código para que ingresen desde su propia cuenta."

    ),

    boton(

      "Generar código",

      () => crearInvitacion(g),

      "ag-btn principal"

    )

  );



  const pendientes = elemento("div", "", "ag-solicitudes");
  tarjeta.appendChild(pendientes);
  window.cargarSolicitudesGrupo?.(g, pendientes);

  tarjeta.appendChild(

    elemento("h4", "Integrantes")

  );



  g.integrantes.forEach(persona => {

    tarjeta.appendChild(

      elemento("p", "👤 " + persona)

    );

  });



  const formulario = elemento("form");

  const nuevo = entrada("Nombre del integrante");



  nuevo.required = true;



  const agregar = elemento(

    "button",

    "＋ Agregar integrante",

    "ag-btn claro"

  );



  agregar.type = "submit";



  formulario.append(nuevo, agregar);



  formulario.addEventListener("submit", async e => {

    e.preventDefault();



    const persona = nuevo.value.trim();

    if (!persona) return;



    if (

      g.integrantes.some(

        p => normalizar(p) === normalizar(persona)

      )

    ) {

      notificar("Ese integrante ya existe.");

      return;

    }



    await modificarGrupo(

      grupo => {

        grupo.integrantes.push(persona);

      },

      "ajustes"

    );

  });



  tarjeta.appendChild(formulario);



  tarjeta.appendChild(

    elemento(

      "p",

      "Agregar un nombre permite asignar tareas. Para ingresar desde otro celular, el estudiante debe registrarse y usar la invitación.",

      "ag-suave"

    )

  );



  caja.appendChild(tarjeta);

}



/* ==========================================

   UNIRSE A GRUPOS

========================================== */



function prepararBotonUnirse() {

  const cabecera = $("cabeceraGrupos");



  if (

    !cabecera ||

    $("btnUnirseGrupo")

  ) {

    return;

  }



  const b = boton(

    "🔗 Unirme a un grupo",

    async () => {

      const codigo = prompt(

        "Ingresa el código de invitación:"

      );



      if (codigo === null) return;



      if (!codigo.trim()) {

        notificar("Escribe un código.");

        return;

      }



      await unirseConCodigo(

        codigo.trim()

      );

    },

    "ag-btn claro"

  );



  b.id = "btnUnirseGrupo";

  cabecera.appendChild(b);

}



/* ==========================================

   INICIALIZACIÓN

========================================== */



window.mostrar = mostrar;

window.cerrarSesion = cerrarSesion;

window.mostrarFormularioGrupo = mostrarFormularioGrupo;

window.ocultarFormularioGrupo = ocultarFormularioGrupo;



prepararBotonUnirse();

mostrar("bienvenida");



const api = firebaseAPI();



if (api?.onAuthStateChanged && api?.auth) {

  api.onAuthStateChanged(

    api.auth,

    user => {

      if (user) {

        establecerUsuario(user);
        window.revisarInvitacionQR?.();
        activarPermisosAlumno(user).catch(error => {
  console.error("Permisos del alumno:", error);
});
        



        if (uidActivo !== user.uid) {

          uidActivo = user.uid;

          iniciarNube(user.uid);

        }

      } else {

        ++versionSesion;



        if (escuchadorGrupos) {

          escuchadorGrupos();

          escuchadorGrupos = null;

        }



        uidActivo = null;

        usuarioActual = null;

        grupoSeleccionado = null;



        gruposNube.clear();

        nubeLista = false;



        localStorage.removeItem(CLAVE_SESION);



        // Nunca borramos los grupos locales.

        mostrar("bienvenida");

      }

    },

    error => {

      console.error(error);

      notificar(mensajeError(error));

    }

  );

} else {

  notificar("No se pudo iniciar Firebase.");

}



/* ==========================================

   FIN DE AGRUPÉMONOS

========================================== */

/* Acceso real al chat desde la navegación principal. */
function abrirChatDesdeMenu() {
  mostrar("grupos");
  const visibles = gruposVisibles();
  if (!visibles.length) {
    notificar("Primero crea un grupo para utilizar el chat.");
    return;
  }
  if (grupoSeleccionado !== null && visibles.some(g => String(g.id) === String(grupoSeleccionado))) {
    pestanaGrupo = "chat";
    dibujarDetalle();
    return;
  }
  if (visibles.length === 1) {
    abrirGrupo(visibles[0].id);
    pestanaGrupo = "chat";
    dibujarDetalle();
    return;
  }
  notificar("Selecciona un grupo y luego abre la pestaña Chat.");
}
async function activarPermisosAlumno(user) {
  if (!user) {
    throw new Error("El alumno debe iniciar sesión.");
  }

  const configuracion = window.AGRUP_SUPABASE;

  if (!configuracion?.url || !configuracion?.publishableKey) {
    throw new Error("Falta la configuración de Supabase.");
  }

  const tokenFirebase = await user.getIdToken();

  const respuesta = await fetch(
    configuracion.url + "/functions/v1/permisos-alumnos",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": configuracion.publishableKey,
        "Authorization": "Bearer " + tokenFirebase
      }
    }
  );

  if (!respuesta.ok) {
    throw new Error("No se pudieron activar los permisos del alumno.");
  }

  await user.getIdToken(true);
  return true;
}
async function recuperarContrasena() {
  const correoIngresado = document.getElementById("correoLogin")?.value.trim();

  const correo = correoIngresado || prompt(
    "Escribe tu correo electrónico para recuperar tu contraseña:"
  )?.trim();

  if (!correo) return;

  try {
    const api = firebaseAPI();

    await api.sendPasswordResetEmail(api.auth, correo);

    alert(
      "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de spam."
    );
  } catch (error) {
    console.error("Error al recuperar contraseña:", error);

    alert(
      "No pudimos enviar el correo de recuperación. Revisa la dirección e inténtalo nuevamente."
    );
  }
}