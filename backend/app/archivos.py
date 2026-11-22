"""Guardado seguro de las imágenes y audios que sube el docente."""
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import MAX_AUDIO_MB, MAX_IMAGEN_MB, MEDIA_DIR, MEDIA_URL

EXTENSIONES = {
    "imagenes": {".webp", ".png", ".jpg", ".jpeg"},
    "audios": {".ogg", ".mp3", ".wav", ".m4a"},
}
LIMITE_MB = {"imagenes": MAX_IMAGEN_MB, "audios": MAX_AUDIO_MB}


def guardar_subida(archivo: UploadFile, carpeta: str, prefijo: str) -> str:
    """Valida y guarda el archivo en media/<carpeta>/ con nombre propio (no el del cliente).
    Devuelve la ruta pública que se guarda en la base de datos: /api/media/<carpeta>/<nombre>."""
    extension = Path(archivo.filename or "").suffix.lower()
    if extension not in EXTENSIONES[carpeta]:
        raise HTTPException(415, "Formato no permitido. Usa: " + ", ".join(sorted(EXTENSIONES[carpeta])))
    carpeta_destino = MEDIA_DIR / carpeta
    carpeta_destino.mkdir(parents=True, exist_ok=True)
    nombre = f"{prefijo}_{uuid.uuid4().hex[:8]}{extension}"
    destino = carpeta_destino / nombre
    limite = LIMITE_MB[carpeta] * 1024 * 1024
    total = 0
    try:
        with destino.open("wb") as salida:
            while bloque := archivo.file.read(256 * 1024):
                total += len(bloque)
                if total > limite:
                    raise HTTPException(413, f"El archivo supera el límite de {LIMITE_MB[carpeta]} MB")
                salida.write(bloque)
        if total == 0:
            raise HTTPException(400, "El archivo está vacío")
    except Exception:
        destino.unlink(missing_ok=True)
        raise
    return f"{MEDIA_URL}/{carpeta}/{nombre}"


def borrar_subida(ruta: str | None) -> None:
    """Borra el archivo solo si lo subió la API (vive en media/). Nunca toca los de public/ de Astro."""
    if not ruta or not ruta.startswith(MEDIA_URL + "/"):
        return
    objetivo = (MEDIA_DIR / ruta[len(MEDIA_URL) + 1:]).resolve()
    if MEDIA_DIR.resolve() in objetivo.parents and objetivo.is_file():
        objetivo.unlink()