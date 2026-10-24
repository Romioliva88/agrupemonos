"use strict";
/* Extensión sin alterar las funciones existentes de grupos. */
(() => {
  const TIPOS = {
    clases: { titulo: "Clases", singular: "material", icono: "📚" },
    ideas: { titulo: "Ideas", singular: "idea", icono: "💡" },
    eventos: { titulo: "Eventos", singular: "evento", icono: "📅" }
  };
  const subs = new Map();
  let sesionUID = null;
  const $ = id => document.getElementById(id);
  const api = () => window.firebaseServicios;
  const nodo = (tag, texto = "", clase = "") => {
    const el = document.createElement(tag); el.textContent = texto; el.className = clase; return el;
  };
  const boton = (texto, fn, clase = "ag-btn") => {
    const el = nodo("button", texto, clase); el.type = "button"; el.addEventListener("click", fn); return el;
  };
  const aviso = mensaje => { if (typeof window.notificar === "function") window.notificar(mensaje); else alert(mensaje); };
  const error = e => {
    console.error("Agrupémonos: error al guardar o cargar", e);
    const code = e?.code || "";
    if (code.includes("storage/unauthorized")) aviso("No se pudo subir: Firebase Storage rechazó el acceso. Revisa sus reglas.");
    else if (code.includes("storage/unknown") || code.includes("storage/bucket-not-found")) aviso("No se pudo subir: comprueba que Firebase Storage esté activado y configurado.");
    else if (code.includes("permission-denied")) aviso("No se pudo guardar: revisa los permisos de Firestore.");
    else aviso("No se pudo guardar: " + (e?.message || "revisa la consola del navegador."));
  };
  const actual = () => api()?.auth?.currentUser;
  // A pending Firestore write can wait indefinitely when offline. A timeout is
  // only a UI diagnostic: it does not cancel the underlying write.
  const esperarConfirmacion = (promesa, ms = 15000) => new Promise((resolve, reject) => {
    const reloj = setTimeout(() => reject(Object.assign(
      new Error("Firebase no confirmó el guardado en 15 segundos. Comprueba tu conexión y revisa si el material aparece antes de volver a intentarlo."),
      { code: "app/confirmacion-pendiente" }
    )), ms);
    Promise.resolve(promesa).then(
      valor => { clearTimeout(reloj); resolve(valor); },
      fallo => { clearTimeout(reloj); reject(fallo); }
    );
  });
  const campo = (form, nombre, tipo, requerido = false) => {
    const etiqueta = nodo("label", nombre);
    const el = tipo === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (tipo !== "textarea") el.type = tipo;
    el.name = nombre; el.required = requerido; el.maxLength = tipo === "textarea" ? 3000 : 160;
    form.append(etiqueta, el); return el;
  };
  const obtenerGrupos = async () => {
    const a = api(), uid = actual()?.uid;
    if (!a || !uid) return [];
    const q = a.query(a.collection(a.db, "grupos"), a.where("integrantesUID", "array-contains", uid));
    const snap = await a.getDocs(q);
    return snap.docs.map(d => ({ id:d.id, ...d.data() }));
  };
  function selectGrupo(form, grupos, selected = "") {
    const etiqueta = nodo("label", "Visibilidad");
    const select = document.createElement("select");
    const priv = document.createElement("option"); priv.value = ""; priv.textContent = "🔒 Solo yo"; select.append(priv);
    for (const g of grupos) { const o = document.createElement("option"); o.value = g.id; o.textContent = "👥 " + g.nombre; select.append(o); }
    select.value = selected;
    form.append(etiqueta,select);
    return select;
  }
  function enlaceSeguro(url) {
    try { const u = new URL(url); return ["http:","https:"].includes(u.protocol) ? u.href : ""; } catch { return ""; }
  }
  // Supabase Storage privado: autenticación con el ID token de Firebase.
  const supabaseCfg = () => window.AGRUP_SUPABASE || {};
  function validarSupabase() {
    const cfg = supabaseCfg();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url || "") ||
        !cfg.publishableKey || cfg.publishableKey.includes("REEMPLAZAR")) {
      throw new Error("Falta configurar supabase-config.js con Project URL y publishable key. Revisa INSTRUCCIONES_V5.txt.");
    }
    return cfg;
  }
  async function solicitudStorage(ruta, opciones = {}) {
    const cfg = validarSupabase();
    const usuario = actual();
    if (!usuario) throw new Error("Inicia sesión antes de subir archivos.");
    await activarPermisosAlumno(usuario);
const token = await usuario.getIdToken(true);
    const res = await fetch(cfg.url + "/storage/v1" + ruta, {
      ...opciones,
      headers: { apikey: cfg.publishableKey, Authorization: "Bearer " + token, ...(opciones.headers || {}) }
    });
    if (!res.ok) {
      const mensaje = await res.text();
      throw new Error("Supabase (" + res.status + "): " + mensaje.slice(0, 350) + ". Comprueba la política y la autenticación de Firebase.");
    }
    return res;
  }
  async function subirArchivo(file, id) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera el máximo de 10 MB.");
    const permitidos = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "image/png", "image/jpeg", "image/webp"];
    if (!permitidos.includes(file.type)) throw new Error("Formato no permitido. Usa PDF, Word, PowerPoint o imágenes.");
    const uid = actual()?.uid;
    const path = `${uid}/${id}/${crypto.randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    await solicitudStorage("/object/agrupemonos-archivos/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "POST", headers: {"Content-Type": file.type, "x-upsert": "false"}, body: file
    });
    return { nombre: file.name, path, tipo: file.type, proveedor: "supabase" };
  }
  async function eliminarArchivo(archivo) {
    if (!archivo?.path || archivo.proveedor !== "supabase") return;
    await solicitudStorage("/object/agrupemonos-archivos/" + archivo.path.split("/").map(encodeURIComponent).join("/"), {method:"DELETE"});
  }
  async function abrirArchivo(item) {
    if (!item.archivo?.path) return;
    if (item.archivo.proveedor !== "supabase") { aviso("Este archivo es de una versión anterior que usaba Firebase Storage."); return; }
    if (item.creadorUID !== actual()?.uid) { aviso("Los archivos privados solo los puede abrir quien los subió. Para compartir con el grupo utiliza un enlace de Drive mientras se configura el acceso de grupos."); return; }
    try {
      const r = await solicitudStorage("/object/authenticated/agrupemonos-archivos/" + item.archivo.path.split("/").map(encodeURIComponent).join("/"));
      const blob = await r.blob(), url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=item.archivo.nombre; document.body.append(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    } catch(e) { error(e); }
  }
  async function iniciar(tipo) {
    const cont = $("mod-"+tipo), a=api(), uid=actual()?.uid;
    if (!cont || !a || !uid) return;
    cont.replaceChildren(nodo("p","Cargando...","mod-meta"));
    if (subs.has(tipo)) { subs.get(tipo)(); subs.delete(tipo); }
    try {
      const grupos = await obtenerGrupos();
      if (uid !== actual()?.uid) return;
      const form = nodo("form","","mod-form");
      form.append(nodo("h3", "＋ Nuevo " + TIPOS[tipo].singular));
      const titulo = campo(form,"Título","text",true);
      const contenido = campo(form,"Descripción / apuntes","textarea");
      let asignatura=null, fecha=null, url=null, archivoInput=null;
      if (tipo === "clases") asignatura=campo(form,"Asignatura","text",true);
      if (tipo === "eventos") { fecha=campo(form,"Fecha y hora","datetime-local",true); fecha.removeAttribute("maxlength"); }
      const zona=nodo("div","","ag-upload ag-upload-simple");
      zona.append(nodo("label","📎 Adjuntar archivo"));
      archivoInput=document.createElement("input");
      archivoInput.type="file";
      archivoInput.accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp";
      archivoInput.className="ag-file";
      archivoInput.setAttribute("aria-label","Seleccionar archivo para adjuntar");
      zona.append(archivoInput,nodo("p","PDF, Word, PowerPoint o imagen · Máx. 10 MB","ag-upload-hint"));
      form.append(zona);
      url=campo(form,"Enlace opcional","url");
      url.removeAttribute("maxlength");
      url.placeholder="https://...";
      const visibilidad=selectGrupo(form,grupos);
      const guardar=nodo("button","Guardar","principal"); guardar.type="submit"; form.append(guardar);
      const buscar=campo(nodo("div"),"Buscar","search"); buscar.placeholder="Buscar por título o contenido";
      const lista=nodo("div");
      const busqueda=nodo("div","","mod-busqueda"); busqueda.append(buscar);
      const calendario = tipo === "eventos" ? nodo("section", "", "ag-calendar") : null;
      let mesVisible = new Date(); mesVisible.setDate(1);
      let diaElegido = "";
      const fechaLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const pintarCalendario = items => {
        if (!calendario) return;
        calendario.replaceChildren();
        const cabecera = nodo("div", "", "ag-calendar-head");
        const tituloMes = nodo("h3", mesVisible.toLocaleDateString("es-CL", {month:"long",year:"numeric"}));
        cabecera.append(boton("‹", () => {mesVisible.setMonth(mesVisible.getMonth()-1); dibujar();}, "ag-cal-arrow"), tituloMes,
          boton("›", () => {mesVisible.setMonth(mesVisible.getMonth()+1); dibujar();}, "ag-cal-arrow"));
        calendario.append(cabecera);
        const leyenda = nodo("p", "Los puntos indican días con eventos. Toca una fecha para verlos.", "ag-calendar-hint");
        calendario.append(leyenda);
        const grilla = nodo("div", "", "ag-calendar-grid");
        for (const dia of ["L","M","M","J","V","S","D"]) grilla.append(nodo("span", dia, "ag-calendar-weekday"));
        const inicio = (mesVisible.getDay()+6)%7;
        const total = new Date(mesVisible.getFullYear(),mesVisible.getMonth()+1,0).getDate();
        for(let i=0;i<inicio;i++) grilla.append(nodo("span", "", "ag-calendar-empty"));
        const hoy=fechaLocal(new Date());
        for(let dia=1;dia<=total;dia++){
          const clave=fechaLocal(new Date(mesVisible.getFullYear(),mesVisible.getMonth(),dia));
          const cuenta=items.filter(item=>typeof item.fecha==="string"&&item.fecha.startsWith(clave)).length;
          const b=boton(String(dia),()=>{diaElegido=diaElegido===clave?"":clave;dibujar();},"ag-calendar-day");
          if(cuenta) {b.classList.add("has-events");b.append(nodo("i","","ag-calendar-dot"));}
          if(clave===hoy)b.classList.add("is-today");
          if(clave===diaElegido)b.classList.add("is-selected");
          b.setAttribute("aria-label",`${dia} de ${tituloMes.textContent}${cuenta?`, ${cuenta} eventos`:""}`);
          grilla.append(b);
        }
        calendario.append(grilla);
        const pie=nodo("div","","ag-calendar-foot");
        pie.append(nodo("span",diaElegido?`Eventos del ${diaElegido.split("-").reverse().join("/")}`:"Todos los eventos"));
        if(diaElegido)pie.append(boton("Ver todos",()=>{diaElegido="";dibujar();},"ag-calendar-clear"));
        calendario.append(pie);
      };
      cont.replaceChildren(...(calendario?[calendario]:[]),form,busqueda,lista);
      form.addEventListener("submit",async e => {
        e.preventDefault(); guardar.disabled=true; guardar.textContent="Guardando…";
        const id=crypto.randomUUID(), grupoId=visibilidad.value;
        let archivoSubido=null;
        try {
          if (archivoInput?.files?.length && grupoId) throw new Error("Por seguridad, los archivos adjuntos directos son privados. Selecciona 'Solo yo' o comparte un enlace con el grupo.");
          if (archivoInput?.files?.length) { guardar.textContent="Subiendo archivo…"; archivoSubido=await subirArchivo(archivoInput.files[0],id); guardar.textContent="Guardando…"; }
          const data={titulo:titulo.value.trim(),contenido:contenido.value.trim(),creadorUID:uid,grupoId,creadoEn:a.serverTimestamp(),actualizadoEn:a.serverTimestamp()};
          if (archivoSubido) data.archivo=archivoSubido;
          if (asignatura) data.asignatura=asignatura.value.trim();
          if (fecha) data.fecha=fecha.value;
          if (url) {
            const textoUrl=url.value.trim();
            if (textoUrl && !enlaceSeguro(textoUrl)) throw new Error("El enlace debe comenzar con https:// o http://.");
            data.url=enlaceSeguro(textoUrl);
          }
          if (tipo==="ideas") {data.votos=[];data.comentarios=[];}
          await esperarConfirmacion(a.setDoc(a.doc(a.db,tipo,id),data));
          form.reset(); aviso("Guardado correctamente.");
        } catch(err) {
          if (err?.code === "app/confirmacion-pendiente") {
            console.warn("Agrupémonos: guardado sin confirmación", {tipo,id,uid,grupoId});
            aviso("Firebase aún no confirma el guardado. Comprueba tu conexión y si aparece el material antes de intentarlo de nuevo.");
          } else { error(err); if (archivoSubido) { try { await eliminarArchivo(archivoSubido); } catch(e) { console.warn("No se pudo limpiar el archivo tras el error",e); } } }
        } finally { guardar.disabled=false; guardar.textContent="Guardar"; }
      });
      const q=a.query(a.collection(a.db,tipo),a.where("creadorUID","==",uid));
      const qGrupos=grupos.map(g=>a.query(a.collection(a.db,tipo),a.where("grupoId","==",g.id)));
      const datasets=new Map();
      const dibujar=()=>{
        const items=new Map(); for (const ds of datasets.values()) for(const x of ds) items.set(x.id,x);
        const termino=buscar.value.toLocaleLowerCase(); lista.replaceChildren();
        if(calendario)pintarCalendario([...items.values()]);
        const orden=[...items.values()].filter(x=>(x.titulo+" "+x.contenido+" "+(x.asignatura||"")).toLocaleLowerCase().includes(termino) && (!calendario || !diaElegido || (typeof x.fecha==="string" && x.fecha.startsWith(diaElegido))))
          .sort((x,y)=>(y.fecha||y.creadoEn?.seconds||0)>(x.fecha||x.creadoEn?.seconds||0)?1:-1);
        if(!orden.length) lista.append(nodo("p","No hay elementos para mostrar.","vacio"));
        for(const item of orden) {
          const esCreador=item.creadorUID===uid;
          const tarjeta=nodo("article","","mod-tarjeta");
          tarjeta.append(nodo("h3",item.titulo),nodo("p",item.contenido),nodo("p",item.grupoId?"👥 Compartido con un grupo":"🔒 Privado","mod-meta"));
          if(item.asignatura) tarjeta.append(nodo("p","📖 "+item.asignatura,"mod-meta"));
          if(item.fecha) tarjeta.append(nodo("p","📅 "+item.fecha.replace("T"," "),"mod-meta"));
          if(item.url && enlaceSeguro(item.url)) {const link=nodo("a",tipo==="clases"?"📎 Abrir material compartido":"🔗 Abrir enlace");link.href=enlaceSeguro(item.url);link.target="_blank";link.rel="noopener noreferrer";tarjeta.append(link);}
          if(item.archivo) tarjeta.append(boton("📎 "+item.archivo.nombre,()=>abrirArchivo(item),"ag-btn claro"));
          const acciones=nodo("div","","mod-fila");
          if(tipo==="ideas") {
            const votos=Array.isArray(item.votos)?item.votos:[];
            acciones.append(boton(`👍 ${votos.length}`,async()=>{
              try {await a.runTransaction(a.db,async tx=>{const r=a.doc(a.db,tipo,item.id),s=await tx.get(r);if(!s.exists())return;const actualVotos=Array.isArray(s.data().votos)?s.data().votos:[];tx.update(r,{votos:actualVotos.includes(uid)?actualVotos.filter(x=>x!==uid):[...actualVotos,uid]});});}catch(err){error(err);}
            },"mod-voto"));
            const comentarios=Array.isArray(item.comentarios)?item.comentarios:[];
            for(const c of comentarios) tarjeta.append(nodo("p",`${c.autor||"Estudiante"}: ${c.texto}`,"mod-comentario"));
            acciones.append(boton("💬 Comentar",async()=>{
              const texto=prompt("Escribe tu comentario:"); if(!texto?.trim())return;
              try {await a.updateDoc(a.doc(a.db,tipo,item.id),{comentarios:a.arrayUnion({id:crypto.randomUUID(),autorUID:uid,autor:actual().displayName||"Estudiante",texto:texto.trim().slice(0,500)})});}catch(err){error(err);}
            }));
            if(item.grupoId) acciones.append(boton("→ Crear tarea",async()=>{
              const nombre=prompt("Nombre de la tarea:",item.titulo);if(!nombre?.trim())return;
              if(!confirm("¿Crear una tarea pendiente sin asignar en el grupo?"))return;
              try {await a.runTransaction(a.db,async tx=>{const ref=a.doc(a.db,"grupos",item.grupoId),snap=await tx.get(ref);if(!snap.exists()||!snap.data().integrantesUID.includes(uid))throw new Error("Ya no perteneces al grupo.");tx.update(ref,{tareas:[...(snap.data().tareas||[]),{id:crypto.randomUUID(),nombre:nombre.trim(),descripcion:item.contenido||"",fecha:"",esfuerzo:3,responsable:"",estado:"Pendiente"}]});});aviso("Tarea creada en el grupo.");}catch(err){error(err);}
            }));
          }
          if(esCreador) {
            acciones.append(boton("✏️ Editar",async()=>{
              const titulo=prompt("Nuevo título:",item.titulo);if(titulo===null)return;
              if(!titulo.trim()){aviso("El título es obligatorio.");return;}
              const contenido=prompt("Descripción:",item.contenido||"");if(contenido===null)return;
              try {await a.updateDoc(a.doc(a.db,tipo,item.id),{titulo:titulo.trim().slice(0,160),contenido:contenido.trim().slice(0,3000),actualizadoEn:a.serverTimestamp()});}catch(err){error(err);}
            }));
            acciones.append(boton("🗑️ Eliminar",async()=>{
              if(!confirm("¿Eliminar definitivamente este elemento?"))return;
              try {await a.deleteDoc(a.doc(a.db,tipo,item.id));aviso("Eliminado.");}catch(err){error(err);}
            },"ag-btn peligro"));
          }
          tarjeta.append(acciones);lista.append(tarjeta);
        }
      };
      buscar.addEventListener("input",dibujar);
      const unsub=[];
      [q,...qGrupos].forEach((consulta,i)=>unsub.push(a.onSnapshot(consulta,s=>{
        datasets.set(i,s.docs.map(d=>({id:d.id,...d.data()})));dibujar();
      },error)));
      subs.set(tipo,()=>unsub.forEach(fn=>fn()));
    } catch(err) {cont.replaceChildren(nodo("p","No fue posible cargar esta sección."));error(err);}
  }
  // La función global mostrar() ya controla la navegación; la envolvemos sin cambiarla.
  const original=window.mostrar;
  if(typeof original==="function") window.mostrar=function(pantalla){original(pantalla);if(TIPOS[pantalla]) iniciar(pantalla);};
  const a=api();
  if(a?.onAuthStateChanged) a.onAuthStateChanged(a.auth,user=>{
    if(sesionUID!==user?.uid){for(const fn of subs.values())fn();subs.clear();sesionUID=user?.uid||null;}
  });
})();
