// Enlaces de invitación y solicitudes de ingreso.
function enlacePublico(codigo = '') {
  const url = new URL('index.html', location.href);
  url.search = '';
  url.hash = '';
  if (codigo) url.searchParams.set('invitacion', codigo);
  return url.toString();
}
function abrirModalQR(titulo, descripcion, enlace) {
  document.getElementById('tituloQR').textContent = titulo;
  document.getElementById('descripcionQR').textContent = descripcion;
  document.getElementById('enlaceQR').value = enlace;
  const caja = document.getElementById('codigoQR');
  caja.replaceChildren();
  const aviso = document.getElementById('avisoQR');
  aviso.textContent = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'Para compartir con otros celulares, primero publica la aplicación y genera el QR desde la dirección pública.'
    : 'El enlace funciona mientras la aplicación siga publicada en esta dirección.';
  if (typeof QRCode === 'function') {
    new QRCode(caja, { text: enlace, width: 200, height: 200, colorDark: '#51416b', colorLight: '#ffffff' });
  } else {
    caja.textContent = 'No se pudo cargar el generador de QR. Puedes copiar el enlace.';
  }
  document.getElementById('modalQR').classList.remove('oculta');
}
function mostrarQRAplicacion() {
  abrirModalQR('Comparte Agrupémonos ☁️', 'Escanea para abrir la aplicación.', enlacePublico());
}
function mostrarQRGrupo(codigo, nombre) {
  abrirModalQR('Invita a tu grupo 💜', `Escanea para solicitar ingreso a ${nombre}. El creador debe aprobar.`, enlacePublico(codigo));
}
function cerrarModalQR() { document.getElementById('modalQR').classList.add('oculta'); }
async function copiarEnlaceQR() {
  const input = document.getElementById('enlaceQR');
  try { await navigator.clipboard.writeText(input.value); notificar('Enlace copiado.'); }
  catch { input.select(); document.execCommand('copy'); notificar('Enlace seleccionado para copiar.'); }
}
let invitacionRevisada = false;
async function revisarInvitacionQR() {
  const codigo = new URL(location.href).searchParams.get('invitacion');
  if (!codigo || invitacionRevisada || !firebaseAPI().auth.currentUser) return;
  invitacionRevisada = true;
  if (!/^[a-zA-Z0-9]{20,120}$/.test(codigo)) { notificar('Enlace de invitación inválido.'); return; }
  if (confirm('¿Quieres solicitar ingresar al grupo de esta invitación?')) {
    await unirseConCodigo(codigo);
  }
}
async function cargarSolicitudesGrupo(grupo, contenedor) {
  const api = firebaseAPI();
  if (api.auth.currentUser?.uid !== grupo.propietarioUID) return;
  contenedor.replaceChildren();
  const titulo = document.createElement('h4');
  titulo.textContent = 'Solicitudes para entrar';
  contenedor.append(titulo);
  try {
    const consulta = api.query(api.collection(api.db, 'solicitudesIngreso'), api.where('grupoId', '==', String(grupo.id)));
    const resultado = await api.getDocs(consulta);
    const pendientes = resultado.docs.filter(d => d.data().estado === 'pendiente');
    if (!pendientes.length) {
      const vacio = document.createElement('p'); vacio.textContent = 'No hay solicitudes pendientes.'; contenedor.append(vacio); return;
    }
    for (const documento of pendientes) {
      const datos = documento.data();
      const fila = document.createElement('div'); fila.className = 'ag-solicitud';
      const nombre = document.createElement('p'); nombre.textContent = datos.nombre || 'Compañero';
      const aprobar = document.createElement('button'); aprobar.type = 'button'; aprobar.className = 'ag-btn principal'; aprobar.textContent = 'Aprobar';
      const rechazar = document.createElement('button'); rechazar.type = 'button'; rechazar.className = 'ag-btn claro'; rechazar.textContent = 'Rechazar';
      aprobar.onclick = async () => {
        aprobar.disabled = rechazar.disabled = true;
        try {
          await api.updateDoc(api.doc(api.db, 'grupos', String(grupo.id)), { integrantesUID: api.arrayUnion(datos.solicitanteUID) });
          await api.updateDoc(documento.ref, { estado: 'aprobada' });
          notificar('Solicitud aprobada.');
          await cargarSolicitudesGrupo(grupo, contenedor);
        } catch (error) { notificar(mensajeError(error)); aprobar.disabled = rechazar.disabled = false; }
      };
      rechazar.onclick = async () => {
        rechazar.disabled = aprobar.disabled = true;
        try { await api.updateDoc(documento.ref, { estado: 'rechazada' }); await cargarSolicitudesGrupo(grupo, contenedor); }
        catch (error) { notificar(mensajeError(error)); rechazar.disabled = aprobar.disabled = false; }
      };
      fila.append(nombre, aprobar, rechazar); contenedor.append(fila);
    }
  } catch (error) { const aviso = document.createElement('p'); aviso.textContent = 'No se pudieron cargar las solicitudes: ' + mensajeError(error); contenedor.append(aviso); }
}
