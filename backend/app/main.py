"""Punto de entrada de la API de la Lotería Interactiva Mazahua."""
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import CORS_REGEX, MEDIA_DIR, MEDIA_URL
from .database import SessionLocal, get_db
from .routers import auth, cartas, catalogo, netfly, videos
from .seguridad import crear_docente_inicial

MEDIA_DIR.mkdir(parents=True, exist_ok=True)   # carpeta de imágenes y audios subidos


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Primer arranque: crea el docente inicial si la tabla usuarios está vacía
    try:
        with SessionLocal() as db:
            crear_docente_inicial(db)
    except Exception as error:   # p. ej. MySQL apagado: la API arranca y /api/salud lo avisa
        print(f"[aviso] No se pudo preparar el usuario docente: {error}")
    yield


app = FastAPI(
    title="API · Lotería Interactiva Mazahua",
    version="1.1.0",
    description="Consulta pública del vocabulario y la partida; administración (CRUD) con login de docente. "
                "Para probar los endpoints protegidos pulsa **Authorize** e ingresa usuario y contraseña.",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origin_regex=CORS_REGEX, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth.router)
app.include_router(catalogo.router)
app.include_router(cartas.router)
app.include_router(videos.router)
app.include_router(netfly.router)
# Imágenes y audios subidos por el docente: /api/media/imagenes/..., /api/media/audios/...
app.mount(MEDIA_URL, StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/api/salud", tags=["Sistema"], summary="Estado de la API y de la base de datos")
def salud(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "No hay conexión con MySQL. ¿Está encendido el módulo MySQL en XAMPP?")
    return {"estado": "ok", "base_de_datos": "conectada"}