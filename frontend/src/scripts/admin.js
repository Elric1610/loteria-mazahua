// Panel del docente: cartas, videos, partida y contraseña con formularios (en vez de Swagger).
const API_BASE = String(import.meta.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");
const $ = id => document.getElementById(id);
const TOKEN_KEY = "mazahua-admin-token";
let token = sessionStorage.getItem(TOKEN_KEY) || "";
let cartas = [], videos = [], cartaActual = null, uidSabido = false, uidOriginal = "", videoActual = null, timerPartida = 0, avisoT = 0;

const CAMPOS = { numero: "Número", nombre_es: "Nombre en español", nombre_mazahua: "Nombre en mazahua", descripcion: "Descripción", uid: "UID", titulo: "Título", url: "Enlace", nueva: "Contraseña nueva", actual: "Contraseña actual" };
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const media = p => (p && p.startsWith("/api/media/") ? API_BASE + p : p || "");

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}
function msg(el, texto, tipo = "") { el.textContent = texto || ""; el.dataset.tipo = tipo; el.hidden = !texto; }
function avisar(texto, tipo = "ok") { msg($("aviso"), texto, tipo); clearTimeout(avisoT); avisoT = setTimeout(() => msg($("aviso"), ""), 4500); }
async function ocupado(btn, fn) { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } }

function mensajeError(body, status) {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map(e => {
      const campo = CAMPOS[e.loc?.[e.loc.length - 1]];
      return (campo ? campo + ": " : "") + String(e.msg).replace(/^Value error, /, "");
    }).join(" · ");
  }
  return `Error HTTP ${status}`;
}
// json: cuerpo JSON · form: FormData o URLSearchParams · auth:false para rutas públicas
async function api(path, { method = "GET", json, form, auth = true } = {}) {
  const headers = {};
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) body = form;
  if (auth && token) headers.Authorization = "Bearer " + token;
  let res;
  try { res = await fetch(API_BASE + path, { method, headers, body }); }
  catch { throw new Error("No hay conexión con la API. Revisa que el servidor esté encendido."); }
  if (res.status === 401 && auth) { cerrarSesion("Tu sesión venció. Inicia sesión de nuevo."); throw new Error("Sesión vencida"); }
  if (!res.ok) { let b = null; try { b = await res.json(); } catch (_) {} throw new Error(mensajeError(b, res.status)); }
  return res.status === 204 ? null : res.json();
}

/* ---------- Sesión ---------- */
function mostrarLogin(texto) {
  $("panel").hidden = true; $("login").hidden = false;
  msg($("lMsg"), texto, "error");
}
function cerrarSesion(texto) {
  token = ""; sessionStorage.removeItem(TOKEN_KEY);
  clearInterval(timerPartida);
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  mostrarLogin(texto);
}
function entrar(nombre) {
  $("login").hidden = true; $("panel").hidden = false;
  $("quien").textContent = nombre || "";
  salud(); irA("cartas");
}
async function salud() {
  const p = $("dbPill");
  try { await api("/api/salud", { auth: false }); p.textContent = "Base de datos conectada"; p.className = "pill online"; }
  catch (_) { p.textContent = "Sin conexión con la base de datos"; p.className = "pill offline"; }
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const usuario = $("lUser").value.trim(), clave = $("lPass").value;
  if (!usuario || !clave) return msg($("lMsg"), "Escribe tu usuario y tu contraseña.", "error");
  await ocupado($("lBtn"), async () => {
    try {
      const r = await api("/api/auth/login", { method: "POST", form: new URLSearchParams({ username: usuario, password: clave }), auth: false });
      token = r.access_token; sessionStorage.setItem(TOKEN_KEY, token);
      $("lPass").value = ""; msg($("lMsg"), "");
      entrar(r.nombre);
    } catch (err) { msg($("lMsg"), err.message, "error"); }
  });
});
$("salirBtn").onclick = () => cerrarSesion();

/* ---------- Pestañas ---------- */
const secciones = { cartas: cargarCartas, videos: cargarVideos, partida: iniciarPartida, cuenta: () => {} };
function irA(nombre) {
  clearInterval(timerPartida);
  document.querySelectorAll(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === nombre)));
  for (const n of Object.keys(secciones)) $("tab-" + n).hidden = n !== nombre;
  secciones[nombre]();
}
document.querySelectorAll(".tabs [data-tab]").forEach(b => (b.onclick = () => irA(b.dataset.tab)));
document.querySelectorAll("dialog [data-cerrar]").forEach(b => (b.onclick = () => b.closest("dialog").close()));

/* ---------- Cartas ---------- */
function imagen(src, alt) {
  const i = h("img", { src: media(src), alt, loading: "lazy" });
  i.onerror = () => { if (!i.dataset.r && /\.jpe?g$/i.test(i.src)) { i.dataset.r = 1; i.src = i.src.replace(/\.jpe?g$/i, ".webp"); } };
  return i;
}
function audioSrc(ruta) { return ruta.includes("/api/media/") ? media(ruta) : ruta.replace(/\.[^./]+$/, "") + ".ogg"; }
function reproductor(ruta) {
  const a = h("audio", { controls: true, preload: "none", src: audioSrc(ruta) });
  a.onerror = () => { if (a.getAttribute("src") !== media(ruta)) a.src = media(ruta); };
  return a;
}
async function cargarCartas() {
  try { cartas = await api("/api/cartas"); pintarCartas(); }
  catch (e) { if (token) avisar(e.message, "error"); }
}
function pintarCartas() {
  const q = norm($("buscar").value.trim());
  const lista = cartas.filter(c => !q || String(c.id) === q || norm(c.name_es).includes(q) || norm(c.name_mazahua).includes(q));
  $("cuentaCartas").textContent = `${lista.length} de ${cartas.length} cartas. Toca una para modificarla.`;
  $("cartaGrid").replaceChildren(...lista.map(c => {
    const faltan = [!c.audio_mazahua && "audio mazahua", !c.audio_es && "audio español"].filter(Boolean);
    return h("button", { type: "button", class: "cartaItem", onclick: () => editarCarta(c) },
      h("span", { class: "cartaImg" }, c.image ? imagen(c.image, c.name_es) : h("span", { class: "sinImg" }, "Sin imagen")),
      h("strong", {}, `${c.id}. ${c.name_es}`),
      h("span", { class: "maz" }, c.name_mazahua || "Sin nombre en mazahua"),
      faltan.length ? h("span", { class: "faltan" }, "Falta: " + faltan.join(", ")) : null);
  }));
}
$("buscar").addEventListener("input", pintarCartas);
$("nuevaCarta").onclick = () => mostrarCarta(null, false);

async function editarCarta(c) {
  let det = c, sabido = false;
  try { det = await api(`/api/cartas/${c.id}/detalle`); sabido = true; } catch (_) { /* backend sin /detalle: no se conoce el UID actual */ }
  if (token) mostrarCarta(det, sabido);
}
function mostrarCarta(c, sabido) {
  cartaActual = c; uidSabido = sabido; uidOriginal = sabido ? c?.uid || "" : "";
  $("cartaTitulo").textContent = c ? `Carta ${c.id}` : "Nueva carta";
  $("cNumero").value = c ? c.id : ""; $("cNumero").disabled = !!c;
  $("cNumeroAyuda").hidden = !!c;
  $("cEs").value = c?.name_es ?? ""; $("cMaz").value = c?.name_mazahua ?? ""; $("cDesc").value = c?.description ?? "";
  $("cUid").value = uidOriginal;
  $("cUidAyuda").textContent = c && !sabido
    ? "No se pudo leer el UID actual. Si lo dejas vacío no cambia."
    : "Opcional. Se guarda en mayúsculas." + (c ? " Vacío = quitar el UID." : "");
  $("cEliminar").hidden = !c;
  $("cArchivos").hidden = !c;
  if (c) pintarArchivos(c);
  msg($("cMsg"), "");
  if (!$("cartaDlg").open) $("cartaDlg").showModal();
  $(c ? "cEs" : "cNumero").focus();
}
function pintarArchivos(c) {
  const bloque = (titulo, accept, ruta, url, vista) => {
    const estado = h("small", { class: "estado" }, ruta ? "" : "Aún no tiene archivo.");
    const input = h("input", { type: "file", accept, class: "sr-only" });
    input.addEventListener("change", async () => {
      const f = input.files[0]; if (!f) return;
      estado.textContent = "Subiendo…";
      const fd = new FormData(); fd.append("archivo", f);
      try { await alGuardar(await api(url, { method: "PUT", form: fd })); msg($("cMsg"), `${titulo}: archivo guardado.`, "ok"); }
      catch (e) { estado.textContent = e.message; estado.dataset.tipo = "error"; }
    });
    return h("div", { class: "archivo" }, h("strong", {}, titulo), ruta ? vista(ruta) : null, estado,
      h("label", { class: "wood gold btnArchivo" }, ruta ? "Reemplazar" : "Subir", input));
  };
  $("cArchivos").replaceChildren(
    h("h4", {}, "Imagen y audios"),
    bloque("Imagen", "image/*", c.image, `/api/cartas/${c.id}/imagen`, r => h("span", { class: "vista" }, imagen(r, c.name_es))),
    bloque("Audio en mazahua", "audio/*", c.audio_mazahua, `/api/cartas/${c.id}/audio/maz`, reproductor),
    bloque("Audio en español", "audio/*", c.audio_es, `/api/cartas/${c.id}/audio/es`, reproductor));
}
// Actualiza lista y formulario con la carta que devolvió la API (incluye su UID)
async function alGuardar(c) {
  const i = cartas.findIndex(x => x.id === c.id);
  if (i >= 0) cartas[i] = c; else cartas.push(c);
  cartas.sort((a, b) => a.id - b.id);
  pintarCartas(); mostrarCarta(c, true);
}
$("cartaForm").addEventListener("submit", async e => {
  e.preventDefault();
  const es = $("cEs").value.trim(), maz = $("cMaz").value.trim(), uid = $("cUid").value.trim();
  if (!es || !maz) return msg($("cMsg"), "Escribe el nombre en español y en mazahua.", "error");
  const datos = { nombre_es: es, nombre_mazahua: maz, descripcion: $("cDesc").value.trim() };
  await ocupado($("cGuardar"), async () => {
    try {
      let c;
      if (!cartaActual) {
        const n = $("cNumero").value.trim();
        if (n) datos.numero = Number(n);
        if (uid) datos.uid = uid;
        c = await api("/api/cartas", { method: "POST", json: datos });
      } else {
        if (uid.toUpperCase() !== uidOriginal) datos.uid = uid;   // "" quita el UID
        c = await api(`/api/cartas/${cartaActual.id}`, { method: "PUT", json: datos });
      }
      const nueva = !cartaActual;
      await alGuardar(c);
      msg($("cMsg"), nueva ? "Carta creada. Ahora puedes subir su imagen y sus audios." : "Cambios guardados.", "ok");
    } catch (err) { msg($("cMsg"), err.message, "error"); }
  });
});
$("cEliminar").onclick = async () => {
  const c = cartaActual;
  if (!c || !confirm(`¿Eliminar la carta ${c.id} (${c.name_es})?\nSe borran también su imagen y audios subidos, y se reinicia la partida en curso.`)) return;
  await ocupado($("cEliminar"), async () => {
    try {
      await api(`/api/cartas/${c.id}`, { method: "DELETE" });
      $("cartaDlg").close();
      cartas = cartas.filter(x => x.id !== c.id); pintarCartas();
      avisar(`Carta ${c.id} eliminada.`);
    } catch (err) { msg($("cMsg"), err.message, "error"); }
  });
};

/* ---------- Videos ---------- */
async function cargarVideos() {
  try { videos = await api("/api/videos"); pintarVideos(); }
  catch (e) { if (token) avisar(e.message, "error"); }
}
function pintarVideos() {
  if (!videos.length) return $("videoLista").replaceChildren(h("p", { class: "hint" }, "Aún no hay videos. Registra el primero con «Nuevo video»."));
  $("videoLista").replaceChildren(...videos.map(v => h("article", { class: "videoItem" },
    h("img", { src: v.thumbnail, alt: "", loading: "lazy" }),
    h("div", { class: "videoTexto" },
      h("strong", {}, v.titulo),
      v.descripcion ? h("p", {}, v.descripcion) : null,
      h("a", { href: v.url, target: "_blank", rel: "noopener" }, "Ver en YouTube")),
    h("div", { class: "filaBtns" },
      h("button", { type: "button", class: "wood gold", onclick: () => mostrarVideo(v) }, "Modificar"),
      h("button", { type: "button", class: "wood brown", onclick: () => borrarVideo(v) }, "Eliminar")))));
}
function mostrarVideo(v) {
  videoActual = v;
  $("videoTitulo").textContent = v ? "Modificar video" : "Nuevo video";
  $("vTitulo").value = v?.titulo ?? ""; $("vUrl").value = v?.url ?? ""; $("vDesc").value = v?.descripcion ?? "";
  msg($("vMsg"), "");
  $("videoDlg").showModal(); $("vTitulo").focus();
}
$("nuevoVideo").onclick = () => mostrarVideo(null);
$("videoForm").addEventListener("submit", async e => {
  e.preventDefault();
  const datos = { titulo: $("vTitulo").value.trim(), url: $("vUrl").value.trim(), descripcion: $("vDesc").value.trim() };
  if (!datos.titulo || !datos.url) return msg($("vMsg"), "Escribe el título y el enlace de YouTube.", "error");
  await ocupado($("vGuardar"), async () => {
    try {
      await api(videoActual ? `/api/videos/${videoActual.id}` : "/api/videos", { method: videoActual ? "PUT" : "POST", json: datos });
      $("videoDlg").close();
      await cargarVideos();
      avisar(videoActual ? "Video actualizado." : "Video registrado.");
    } catch (err) { msg($("vMsg"), err.message, "error"); }
  });
});
async function borrarVideo(v) {
  if (!confirm(`¿Eliminar el video «${v.titulo}»?`)) return;
  try { await api(`/api/videos/${v.id}`, { method: "DELETE" }); await cargarVideos(); avisar("Video eliminado."); }
  catch (e) { if (token) avisar(e.message, "error"); }
}

/* ---------- Partida ---------- */
async function pintarPartida() {
  const dato = (etiqueta, valor, clase = "") => h("div", { class: "dato" }, h("span", {}, etiqueta), h("strong", { class: clase }, valor));
  try {
    const s = await api("/api/netfly/state?client_id=admin-panel", { auth: false });
    const ultima = s.events[s.events.length - 1];
    const nombre = ultima ? cartas.find(c => c.id === ultima.cardId)?.name_es ?? `Carta ${ultima.cardId}` : "Ninguna todavía";
    $("estadoPartida").replaceChildren(
      dato("Lector ESP32", s.online ? "En línea" : "Sin señal", s.online ? "ok" : "mal"),
      dato("Partida", s.gameId),
      dato("Cartas cantadas", `${s.events.length}${cartas.length ? " de " + cartas.length : ""}`),
      dato("Última carta", nombre));
  } catch (e) { $("estadoPartida").replaceChildren(h("p", { class: "hint" }, e.message)); }
}
async function iniciarPartida() {
  if (!cartas.length) await cargarCartas();
  $("cantarSel").replaceChildren(...cartas.map(c => h("option", { value: c.id }, `${c.id}. ${c.name_es}`)));
  pintarPartida();
  timerPartida = setInterval(() => { if (!document.hidden) pintarPartida(); }, 4000);
}
$("reiniciarBtn").onclick = async () => {
  if (!confirm("¿Reiniciar la partida?\nSe borran las cartas cantadas y todos los tableros asignados.")) return;
  await ocupado($("reiniciarBtn"), async () => {
    try { await api("/api/netfly/juego/nuevo", { method: "POST", auth: false }); avisar("Partida reiniciada."); pintarPartida(); }
    catch (e) { avisar(e.message, "error"); }
  });
};
$("cantarBtn").onclick = async () => {
  const numero = Number($("cantarSel").value);
  if (!numero) return;
  await ocupado($("cantarBtn"), async () => {
    try {
      const r = await api("/api/netfly/cantar", { method: "POST", json: { numero }, auth: false });
      avisar(r.nueva ? `Se cantó la carta ${numero}.` : `La carta ${numero} ya había salido.`);
      pintarPartida();
    } catch (e) { avisar(e.message, "error"); }
  });
};

/* ---------- Mi cuenta ---------- */
$("passForm").addEventListener("submit", async e => {
  e.preventDefault();
  const actual = $("pActual").value, nueva = $("pNueva").value, repite = $("pRepite").value;
  if (!actual) return msg($("pMsg"), "Escribe tu contraseña actual.", "error");
  if (nueva.length < 8) return msg($("pMsg"), "La contraseña nueva debe tener al menos 8 caracteres.", "error");
  if (nueva !== repite) return msg($("pMsg"), "Las contraseñas nuevas no coinciden.", "error");
  await ocupado($("pBtn"), async () => {
    try {
      await api("/api/auth/password", { method: "PUT", json: { actual, nueva } });
      $("passForm").reset(); msg($("pMsg"), "Contraseña actualizada.", "ok");
    } catch (err) { msg($("pMsg"), err.message, "error"); }
  });
});

/* ---------- Inicio ---------- */
(async () => {
  if (!token) return mostrarLogin();
  try { const yo = await api("/api/auth/me"); entrar(yo.nombre || yo.username); }
  catch (e) { if (token) mostrarLogin(e.message); }
})();