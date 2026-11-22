// La interfaz y la API se sirven desde el mismo origen (FastAPI).
// Mismo origen por defecto. Para otra API define PUBLIC_API_BASE en .env
// (o window.NETFLY_API, como antes).
const API_BASE = String(import.meta.env.PUBLIC_API_BASE ?? window.NETFLY_API ?? "").replace(/\/$/, "");
async function api(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = `Error HTTP ${response.status}`;
    try { const body = await response.json(); detail = body.detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}
// Lo que sube el docente vive en la API (/api/media/...). Si la API está en otro origen, se le antepone API_BASE.
const mediaUrl = path => (path && path.startsWith("/api/media/") ? API_BASE + path : path || "");

const $ = id => document.getElementById(id);

const clientId = (() => {
  let value = localStorage.getItem("mazahua-client");
  if (!value) { value = crypto.randomUUID(); localStorage.setItem("mazahua-client", value); }
  return value;
})();
let cards = [], board = null, state = null, lastEventKey = null, loading = false, saveTimer = 0, noticeTimer = 0, demoMode = false;
let currentId = null, view = "menu";   // view: "menu" | "play"

// Muestra el menú o la partida (si aún no hay señal del ESP32, la pantalla de espera).
function showView(next) {
  view = next || view;
  const ready = !!(state?.online && board);
  document.body.classList.toggle("view-menu", view === "menu");
  $("menu").hidden = view !== "menu";
  $("wait").hidden = !(view === "play" && !ready);
  $("game").hidden = !(view === "play" && ready);
}
// cls: "online" | "offline" | ""
function setConnection(text, cls) {
  const el = $("connection");
  el.textContent = text;
  el.className = "pill" + (cls ? " " + cls : "");
}
window.startDemo = startDemo;

/* =========================================================
   AUDIO
   - Un solo <audio> reutilizado (necesario para que el
     desbloqueo por gesto funcione en celulares).
   - Cada reproducción tiene un "token": si llega una carta
     nueva, el token cambia y todo lo anterior se descarta.
   - Si la carta no tiene mp3 (o falla), se lee el nombre con
     la voz del navegador en español.
   ========================================================= */
const player = new Audio();
player.preload = "auto";
let audioUnlocked = false, playToken = 0, pendingPlay = false;
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function updateSoundButton() { $("soundBtn").hidden = audioUnlocked && !pendingPlay; }

function stopAudio() {
  playToken++;
  player.onerror = null;
  player.onended = null;
  try { player.pause(); player.currentTime = 0; } catch (_) {}
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function speak(text, token) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  // pequeña espera: Chrome a veces ignora speak() justo después de cancel()
  setTimeout(() => {
    if (token !== playToken) return;
    const voice = new SpeechSynthesisUtterance(text);
    voice.lang = "es-MX";
    voice.rate = 0.95;
    const esVoice = speechSynthesis.getVoices().find(v => (v.lang || "").toLowerCase().startsWith("es"));
    if (esVoice) voice.voice = esVoice;
    voice.onerror = event => {
      if (event.error === "not-allowed" && token === playToken) { pendingPlay = true; updateSoundButton(); }
    };
    speechSynthesis.speak(voice);
  }, 60);
}

function playFile(url, token, onFail) {
  player.onerror = () => { if (token === playToken) onFail(); };
  player.onended = () => { if (token === playToken) { player.onended = null; } };
  player.src = url;
  player.play().then(() => {
    if (token === playToken) { audioUnlocked = true; pendingPlay = false; updateSoundButton(); }
  }).catch(error => {
    if (token !== playToken) return;               // ya llegó otra carta
    if (error.name === "AbortError") return;       // lo interrumpió otra reproducción
    if (error.name === "NotAllowedError") { pendingPlay = true; updateSoundButton(); return; }
    onFail();
  });
}

// Convierte cualquier extensión a .ogg (los audios ahora son .ogg con la misma ruta y nombre).
function toOgg(path) {
  if (!path) return "";
  if (path.includes("/api/media/")) return path;   // subido por el docente: se respeta su formato (mp3, wav...)
  const slash = path.lastIndexOf("/"), dot = path.lastIndexOf(".");
  return (dot > slash ? path.slice(0, dot) : path) + ".ogg";
}
// Rutas a probar en orden: .ogg de la ruta del catálogo, la ruta original y /carpeta/NNN.ogg
function audioCandidates(card, lang) {
  const given = lang === "es" ? card.audio_es : card.audio_mazahua;
  const folder = lang === "es" ? "/audio_espanol" : "/audio_mazahua";
  const num = String(card.id).padStart(3, "0");
  return [...new Set([toOgg(given), given, folder + "/" + num + ".ogg"].filter(Boolean))];
}
function playFirst(urls, token, onAllFail) {
  const next = i => {
    if (token !== playToken) return;
    if (i >= urls.length) { onAllFail(); return; }
    playFile(urls[i], token, () => next(i + 1));
  };
  next(0);
}
let lastLang = "maz";
// lang "maz" (principal, suena solo) o "es" (opcional, con el botón). Siempre corta el audio anterior.
function playCard(card, lang) {
  stopAudio();
  if (!card) return;
  lastLang = lang;
  const token = playToken;
  playFirst(audioCandidates(card, lang), token, () => {
    if (lang === "es") speak(card.name_es, token);
    else setNotice("Esta carta aún no tiene audio en mazahua.");
  });
}

// Los navegadores bloquean el audio hasta que la persona toca la pantalla una vez.
function unlockAudio() {
  if (audioUnlocked && !pendingPlay) return;
  const wasPending = pendingPlay;
  audioUnlocked = true;
  pendingPlay = false;
  updateSoundButton();
  if (window.speechSynthesis) speechSynthesis.getVoices();
  if (wasPending) {
    playCard(cardFor(currentId), lastLang);   // reproduce la carta que se quedó sin sonar
  } else {
    player.src = SILENT_WAV;
    player.play().catch(() => { audioUnlocked = false; updateSoundButton(); });
  }
}
["pointerdown", "touchstart", "keydown", "click"].forEach(type =>
  document.addEventListener(type, unlockAudio, { capture: true, passive: true }));

/* =========================================================
   CATÁLOGO Y AVISOS
   ========================================================= */
function normalizeCard(card) {
  return {
    id: Number(card.id ?? card.numero),
    name_es: card.name_es ?? card.nombre_es ?? "Carta",
    name_mazahua: card.name_mazahua ?? card.nombre_maz ?? "",
        image: mediaUrl(card.image ?? card.imagen ?? ""),
    audio_es: mediaUrl(card.audio_es ?? ""),
    audio_mazahua: mediaUrl(card.audio_mazahua ?? card.audio_maz ?? ""),
    description: card.description ?? ""
  };
}
// Une las tablas del export de phpMyAdmin (tarjetas, imagenes, audios, nombres_mazahua) por numero_tarjeta.
// El uid de las tarjetas RFID no se copia: la página no lo necesita.
function cardsFromExport(tables) {
  const data = name => (tables.find(t => t.type === "table" && t.name === name) || {}).data || [];
  const img = new Map(data("imagenes").map(r => [Number(r.numero_tarjeta), r.ruta]));
  const nom = new Map(data("nombres_mazahua").map(r => [Number(r.numero_tarjeta), r.nombre_maz]));
  const aud = { es: new Map(), maz: new Map() };
  data("audios").forEach(r => { if (aud[r.idioma]) aud[r.idioma].set(Number(r.numero_tarjeta), r.ruta); });
  return data("tarjetas").map(t => {
    const id = Number(t.numero);
    return {
      id,
      name_es: t.nombre_es,
      name_mazahua: nom.get(id) || "",
      image: (img.get(id) || "").replace(/\.jpg$/i, ".webp"),
      audio_es: aud.es.get(id) || "",
      audio_mazahua: aud.maz.get(id) || ""
    };
  }).sort((a, b) => a.id - b.id);
}
async function loadCatalog() {
  const remote = await api("/api/netfly/catalog");
  cards = (remote || []).map(normalizeCard);
  if (!cards.length) throw new Error("La base de datos no contiene cartas. Importa el archivo SQL de database/.");
}
function cardFor(id) { return cards.find(card => card.id === Number(id)); }

// kind: "" | "warning" | "success". sticky = no se oculta solo.
function setNotice(message, kind, sticky) {
  const el = $("notice");
  clearTimeout(noticeTimer);
  el.textContent = message || "";
  el.className = message && kind ? "notice-" + kind : "";
  if (message && !sticky) noticeTimer = setTimeout(() => { el.textContent = ""; el.className = ""; }, 10000);
}
$("notice").onclick = () => setNotice("");

/* =========================================================
   MARCAS DEL TABLERO
   ========================================================= */
function setMarks(ids) {
  const unique = [...new Set((ids || []).map(Number))];
  board.marks = unique.filter(id => board.cards.includes(id));
  localStorage.setItem("marks-" + board.gameKey + "-" + board.number, JSON.stringify(board.marks));
}
async function saveMarks(claim) {
  if (demoMode) { setNotice("Modo demo: no se valida contra el servidor.", "warning"); return; }
  if (!board) return;
  const result = await api("/api/netfly/marks", {
    method: "PUT",
    body: JSON.stringify({ client_id: clientId, marks: board.marks, claim: !!claim })
  });
  if (result.marks) setMarks(result.marks);
  if (claim) {
    if (result.winner) {
      setNotice("¡LOTERÍA VALIDADA! La línea está marcada y todas sus cartas ya salieron.", "success", true);
      await loadState();
    } else {
      const fresh = await api(`/api/netfly/state?client_id=${encodeURIComponent(clientId)}`);
      state = fresh;
      const called = new Set((state?.events || []).map(event => Number(event.cardId)));
      const pending = board.marks.map(cardFor).filter(card => card && !called.has(card.id));
      if (pending.length) {
        const names = pending.map(card => card.id + " · " + card.name_es).join(", ");
        setNotice("AÚN NO PUEDES CANTAR LOTERÍA. Tienes " + pending.length + " carta" + (pending.length === 1 ? " marcada" : "s marcadas") + " que todavía no han salido: " + names + ". Desmárcalas o espera a que aparezcan.", "warning");
      } else setNotice("AÚN NO PUEDES CANTAR LOTERÍA. Falta completar una línea marcada con cartas que ya salieron.", "warning");
    }
  }
}
/* =========================================================
   PANTALLA
   ========================================================= */
function showCard(id, autoPlay) {
  const card = cardFor(id);
  if (!card) return;
  currentId = card.id;
  $("currentImage").src = card.image;
  $("currentImage").alt = card.name_es;
  $("currentName").textContent = card.name_es;
  $("currentMaz").textContent = card.name_mazahua || "Nombre en mazahua pendiente";
  $("currentNumber").textContent = String(card.id).padStart(2, "0");
  $("cardMaz").textContent = card.name_mazahua || "";
  $("cardName").textContent = card.name_es;
  if (autoPlay) playCard(card, "maz");   // corta el audio anterior; suena primero en mazahua
  else stopAudio();
}
function render() {
  if (!demoMode) setConnection("ESP32 conectado", "online");
  showView();
  $("boardTitle").textContent = "Tablero " + board.number;
  const events = state.events || [];
  $("progress").textContent = "Van " + events.length + " de " + cards.length + " cartas";
  $("progressBar").style.width = (cards.length ? Math.min(100, events.length / cards.length * 100) : 0) + "%";
  $("beanCount").textContent = String(board.marks.length);

  // Detecta carta nueva aunque los eventos no traigan "id" propio
  const latest = events[events.length - 1];
  if (!latest) lastEventKey = null;
  else {
    const key = [latest.id ?? "", events.length, latest.cardId].join("|");
    if (key !== lastEventKey) { lastEventKey = key; showCard(latest.cardId, true); }
  }

  const tiles = board.cards.map(id => {
    const card = cardFor(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile" + (board.marks.includes(Number(id)) ? " marked" : "");
    button.setAttribute("aria-pressed", String(board.marks.includes(Number(id))));
    button.append(...tileParts(card, id));
    button.onclick = () => {
      const n = Number(id);
      setMarks(board.marks.includes(n) ? board.marks.filter(x => x !== n) : [...board.marks, n]);
      render();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveMarks(false).catch(error => setNotice("No se guardó el frijolito: " + error.message, "warning")), 250);
    };
    return button;
  });
  $("board").replaceChildren(...tiles);
  $("boardStatus").textContent = board.marks.length ? board.marks.length + " frijolito" + (board.marks.length === 1 ? "" : "s") + " puesto" + (board.marks.length === 1 ? "" : "s") : "Toca una carta para poner su frijolito";
  $("history").replaceChildren(...[...events].reverse().map(event => {
    const item = document.createElement("li");
    item.textContent = cardFor(event.cardId)?.name_es || "Carta " + event.cardId;
    return item;
  }));
  if (state.player?.winner || board.winner) {
    setNotice("¡LOTERÍA VALIDADA! Este tablero completó una línea de cartas que ya salieron.", "success", true);
  }
}
// Solo la imagen de la carta (ya trae su número y nombre dibujados)
function tileParts(card, id) {
  const image = document.createElement("img");
  image.src = card?.image || "";
  image.alt = card?.name_es || "Carta " + id;
  image.draggable = false;
  return [image];
}
async function loadState() {
  const fresh = await api(`/api/netfly/state?client_id=${encodeURIComponent(clientId)}`);
  state = fresh;
  if (!state?.online) {
    setConnection("Esperando señal del ESP32");
    showView();
    return;
  }
  if (!board || board.gameKey !== state.gameId) {
    const assigned = await api(`/api/netfly/board?client_id=${encodeURIComponent(clientId)}`);
    if (assigned?.waiting) return;
    board = {
      ...assigned,
      gameKey: assigned.gameKey || state.gameId,
      cards: (assigned.cards || []).map(Number),
      marks: (assigned.marks || []).map(Number)
    };
    const stored = localStorage.getItem("marks-" + board.gameKey + "-" + board.number);
    if (!board.marks.length && stored) { try { setMarks(JSON.parse(stored)); } catch (_) {} }
  } else if (state.player) {
    board.marks = (state.player.marks || board.marks).map(Number);
    board.winner = !!state.player.winner;
  }
  render();
}
async function startDemo() {
  try {
    demoMode = true;
    if (!cards.length) await loadCatalog();
    state = { online: true, gameId: "demo", events: [{ id: 1, cardId: cards[0]?.id || 1 }], player: null };
    board = {
      gameKey: "demo",
      number: 1,
      cards: cards.slice(0, 16).map(c => c.id),
      marks: []
    };
    const stored = localStorage.getItem("marks-demo-1");
    if (stored) { try { setMarks(JSON.parse(stored)); } catch (_) {} }
    setConnection("Modo demo (sin ESP32)");
    lastEventKey = null;
    showView("play");
    render();
    const winBtn = $("win");
    if (winBtn) { winBtn.disabled = true; winBtn.title = "Deshabilitado en modo demo"; }
    setNotice("Modo demo: tablero de ejemplo. Las marcas se guardan solo en este navegador.", "success");
  } catch (e) {
    console.error(e);
    setNotice("Error en demo: " + (e && e.message ? e.message : e), "warning");
  }
}
async function load() {
  if (loading || demoMode) return;
  loading = true;
  try { if (!cards.length) await loadCatalog(); await loadState(); }
  catch (error) {
    setConnection("Sin conexión con la API", "offline");
    setNotice("Reintentando: " + (error.message || "no se pudo actualizar el juego"), "warning");
  } finally { loading = false; }
}

/* =========================================================
   BOTONES
   ========================================================= */
$("soundBtn").onclick = unlockAudio;
$("playEs").onclick = () => playCard(cardFor(currentId), "es");
$("playMaz").onclick = () => playCard(cardFor(currentId), "maz");
$("win").onclick = () => saveMarks(true).catch(error => setNotice("No se pudo comprobar la Lotería: " + error.message, "warning"));
updateSoundButton();

// Paneles: solo uno abierto a la vez; "Cerrar" y Esc los cierran
const panels = ["historyPanel", "galleryPanel", "albumPanel", "videosPanel", "rulesPanel", "settingsPanel"];
// Vaciar la lista de videos al cambiar o cerrar el panel también detiene el sonido de los <iframe> de YouTube.
function stopVideos() { $("videosList").replaceChildren(); }
function openPanel(id) { stopVideos(); panels.forEach(p => { $(p).hidden = p !== id; }); }
function closePanels() { stopVideos(); panels.forEach(p => { $(p).hidden = true; }); const pv = $("cardPreview"); if (pv) pv.hidden = true; }document.querySelectorAll(".closeBtn").forEach(btn => { btn.onclick = closePanels; });
document.addEventListener("keydown", e => { if (e.key === "Escape") closePanels(); });

// Menú principal
$("playBtn").onclick = () => { closePanels(); showView("play"); };
document.querySelectorAll(".backBtn").forEach(btn => { btn.onclick = () => { closePanels(); showView("menu"); }; });
$("demoBtn").onclick = () => startDemo();
$("demoBtn2").onclick = () => { closePanels(); startDemo(); };

$("audioBtn").onclick = () => {
  if (currentId) playCard(cardFor(currentId), "maz");
  else setNotice("Sonido activado. Cada carta sonará en mazahua al salir.", "success");
};
$("testSoundBtn").onclick = async () => {
  try { if (!cards.length) await loadCatalog(); playCard(cardFor(currentId) || cards[0], "maz"); }
  catch (e) { setNotice("No se pudo cargar el catálogo.", "warning"); }
};

const toggleHistory = () => {
  if ($("historyPanel").hidden) {
    if (!$("history").childElementCount) setNotice("Todavía no ha salido ninguna carta.");
    else openPanel("historyPanel");
  } else closePanels();
};
$("historyOpen").onclick = toggleHistory;
$("historyMenuBtn").onclick = toggleHistory;
$("rulesBtn").onclick = () => openPanel("rulesPanel");
$("settingsBtn").onclick = () => openPanel("settingsPanel");

$("shareBtn").onclick = async () => {
  const data = { title: "Lotería Mazahua", text: "¡Juega Lotería en mazahua!", url: location.origin + "/" };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); setNotice("Enlace copiado.", "success"); }
  } catch (_) { /* la persona canceló */ }
};

$("clearBtn").onclick = () => {
  if (!board || !board.marks.length) { setNotice("No tienes frijolitos puestos."); return; }
  if (!confirm("¿Quitar todos tus frijolitos del tablero?")) return;
  setMarks([]);
  render();
  saveMarks(false).catch(error => setNotice("No se guardó el cambio: " + error.message, "warning"));
};

// Galería de tableros (imágenes PNG)
$("galleryBtn").onclick = () => {
  const grid = $("galleryGrid");
  if (!grid.childElementCount) {
    for (let i = 1; i <= 30; i++) {
      const img = document.createElement("img");
      img.src = "/tableros/" + String(i).padStart(2, "0") + ".png";
      img.alt = "Tablero " + i;
      img.loading = "lazy";
      const link = document.createElement("a");   // toca un tablero para abrirlo en grande
      link.href = img.src; link.target = "_blank"; link.rel = "noopener"; link.title = "Abrir en grande";
      link.append(img);
      grid.append(link);
    }
  }
  openPanel("galleryPanel");
};

// Vista grande de una carta: así las palabras en mazahua de la imagen se leen bien
function showPreview(card) {
  let box = $("cardPreview");
  if (!box) {
    box = document.createElement("div");
    box.id = "cardPreview";
    box.innerHTML = "<img alt=''>";
    box.onclick = () => { box.hidden = true; };
    document.body.append(box);
  }
    box.firstChild.src = card.image;
  box.firstChild.alt = card.name_es;
  let caption = box.querySelector("p");           // descripción de la carta (campo "descripcion" de la API)
  if (!caption) { caption = document.createElement("p"); box.append(caption); }
  caption.textContent = card.description || "";
  caption.hidden = !card.description;
  box.hidden = false;
}

// Álbum: las 54 cartas; al tocar una suena en mazahua y se ve en grande
$("albumBtn").onclick = async () => {
  try { if (!cards.length) await loadCatalog(); }
  catch (e) { setNotice("No se pudo cargar el catálogo.", "warning"); return; }
  const grid = $("albumGrid");
  if (!grid.childElementCount) {
    grid.append(...cards.map(card => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      button.setAttribute("aria-label", card.name_es + (card.name_mazahua ? ", " + card.name_mazahua : ""));
      button.append(...tileParts(card, card.id));
      button.onclick = () => { playCard(card, "maz"); showPreview(card); };
      return button;
    }));
  }
  openPanel("albumPanel");
};
// Videos de muestra: los registra el docente en la API (/api/videos) y aquí se incrustan desde YouTube.
function videoCard(video) {
  const card = document.createElement("article");
  card.className = "videoCard";
  const frame = document.createElement("iframe");
  frame.src = video.embed_url;
  frame.title = video.titulo;
  frame.loading = "lazy";
  frame.allow = "autoplay; encrypted-media; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  const title = document.createElement("h4");
  title.textContent = video.titulo;
  const link = document.createElement("a");
  link.href = "https://www.youtube.com/watch?v=" + video.youtube_id;
  link.target = "_blank"; link.rel = "noopener"; link.textContent = "Abrir en YouTube";
  card.append(frame, title);
  if (video.descripcion) {
    const text = document.createElement("p");
    text.textContent = video.descripcion;
    card.append(text);
  }
  card.append(link);
  return card;
}
$("videosBtn").onclick = async () => {
  let videos;
  try { videos = await api("/api/videos"); }
  catch (e) { setNotice("No se pudieron cargar los videos: " + e.message, "warning"); return; }
  openPanel("videosPanel");
  if (!videos.length) {
    const empty = document.createElement("p");
    empty.className = "sheetHint";
    empty.textContent = "Aún no hay videos registrados.";
    $("videosList").append(empty);
  } else $("videosList").append(...videos.map(videoCard));
};
if (new URLSearchParams(location.search).has("demo")) startDemo(); else load();
let fallbackTimer = 0;
function setFallbackRefresh(ms) {
  clearInterval(fallbackTimer);
  fallbackTimer = setInterval(load, ms);
}
setFallbackRefresh(1500);
// La API se consulta periódicamente; no requiere Supabase Realtime.
