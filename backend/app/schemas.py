"""Esquemas Pydantic: coinciden con lo que ya lee src/scripts/app.js (+ CRUD, login y videos)."""
import re
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, Field, field_validator


# ---------- Catálogo ----------
class CartaCatalogo(BaseModel):
    id: int
    name_es: str
    name_mazahua: str
    image: str
    audio_es: str = ""
    audio_mazahua: str = ""
    description: str = ""


class CartaDetalle(CartaCatalogo):
    """Lo que ve el docente al crear o modificar: además incluye el UID de la tarjeta RFID."""
    uid: str | None = None


# ---------- Juego en vivo (sin cambios) ----------
class Evento(BaseModel):
    id: int
    cardId: int


class EstadoJugador(BaseModel):
    marks: list[int]
    winner: bool


class Estado(BaseModel):
    online: bool
    gameId: str
    events: list[Evento]
    player: EstadoJugador | None = None


class TableroSalida(BaseModel):
    number: int
    cards: list[int]
    marks: list[int]
    gameKey: str


class MarcasEntrada(BaseModel):
    client_id: str
    marks: list[int]
    claim: bool = False


class MarcasSalida(BaseModel):
    marks: list[int]
    winner: bool


class CantarEntrada(BaseModel):
    uid: str | None = None
    numero: int | None = None


# ---------- Login ----------
class TokenSalida(BaseModel):
    access_token: str
    token_type: str = "bearer"
    nombre: str


class UsuarioSalida(BaseModel):
    username: str
    nombre: str


class CambioPassword(BaseModel):
    actual: str
    nueva: str = Field(min_length=8, max_length=100)


# ---------- CRUD de cartas ----------
def _recortar(valor):
    return valor.strip() if isinstance(valor, str) else valor


class _LimpiaCarta(BaseModel):
    @field_validator("nombre_es", "nombre_mazahua", "descripcion", mode="before", check_fields=False)
    @classmethod
    def limpiar(cls, v):
        return _recortar(v)

    @field_validator("uid", mode="before", check_fields=False)
    @classmethod
    def normalizar_uid(cls, v):
        # igual que /cantar: el UID se guarda en mayúsculas y sin espacios; vacío = sin UID
        return (v.strip().upper() or None) if isinstance(v, str) else v


class CartaEntrada(_LimpiaCarta):
    numero: int | None = Field(None, ge=1, description="Opcional. Si se omite se usa el siguiente número libre")
    nombre_es: str = Field(min_length=1, max_length=100, examples=["El gallo"])
    nombre_mazahua: str = Field(min_length=1, max_length=150, examples=["Ne chare"])
    descripcion: str | None = Field(None, description="Texto libre")
    uid: str | None = Field(None, max_length=32, description="UID de la tarjeta RFID (opcional)")


class CartaActualizar(_LimpiaCarta):
    nombre_es: str | None = Field(None, min_length=1, max_length=100)
    nombre_mazahua: str | None = Field(None, min_length=1, max_length=150)
    descripcion: str | None = None
    uid: str | None = Field(None, max_length=32)


# ---------- Videos ----------
_ID_YOUTUBE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extraer_id_youtube(url: str) -> str | None:
    """Devuelve el ID de 11 caracteres de un enlace de YouTube (watch, youtu.be, embed, shorts) o None."""
    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    if u.scheme not in ("http", "https"):
        return None
    host = (u.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    partes = [p for p in u.path.split("/") if p]
    candidato = None
    if host == "youtu.be" and partes:
        candidato = partes[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if u.path == "/watch":
            candidato = (parse_qs(u.query).get("v") or [None])[0]
        elif len(partes) >= 2 and partes[0] in ("embed", "shorts", "live", "v"):
            candidato = partes[1]
    return candidato if candidato and _ID_YOUTUBE.match(candidato) else None


class _ValidaVideo(BaseModel):
    @field_validator("titulo", "url", "descripcion", mode="before", check_fields=False)
    @classmethod
    def limpiar(cls, v):
        return _recortar(v)

    @field_validator("url", check_fields=False)
    @classmethod
    def solo_youtube(cls, v):
        if v is not None and extraer_id_youtube(v) is None:
            raise ValueError("Debe ser un enlace válido de YouTube (youtube.com/watch?v=..., youtu.be/..., /embed/ o /shorts/)")
        return v


class VideoEntrada(_ValidaVideo):
    titulo: str = Field(min_length=1, max_length=150)
    url: str = Field(max_length=255, description="Enlace de YouTube, por ejemplo https://www.youtube.com/watch?v=<ID>")
    descripcion: str | None = None


class VideoActualizar(_ValidaVideo):
    titulo: str | None = Field(None, min_length=1, max_length=150)
    url: str | None = Field(None, max_length=255)
    descripcion: str | None = None


class VideoSalida(BaseModel):
    id: int
    titulo: str
    url: str
    descripcion: str = ""
    youtube_id: str
    embed_url: str      # listo para un <iframe src="...">
    thumbnail: str      # miniatura del video