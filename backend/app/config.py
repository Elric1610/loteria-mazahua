"""Configuración del backend. Todo se puede ajustar con variables de entorno."""
import os
from urllib.parse import quote_plus
from pathlib import Path

# Valores por defecto de XAMPP: usuario root, sin contraseña, puerto 3306
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "loteria_mazahuaa")

DATABASE_URL = (
    f"mysql+pymysql://{DB_USER}:{quote_plus(DB_PASSWORD)}"
    f"@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"
)

# Para que el frontend (Astro, otro puerto) y cualquier equipo de la red del salón puedan llamar la API
CORS_REGEX = (
    r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+"
    r"|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?"
)

# Si el ESP32 no avisa en este tiempo, el juego se muestra "sin conexión"
SEGUNDOS_SIN_SENAL = 20
# ---------- Login de docente (JWT) ----------
# En producción define SECRET_KEY como variable de entorno (cualquier texto largo y aleatorio).
SECRET_KEY = os.getenv("SECRET_KEY", "cambia-esta-clave-secreta-antes-de-entregar")
JWT_ALGORITHM = "HS256"
TOKEN_MINUTOS = int(os.getenv("TOKEN_MINUTOS", "480"))  # la sesión dura 8 horas
# Docente inicial: se crea solo la primera vez que arranca la API (si la tabla usuarios está vacía)
ADMIN_USER = os.getenv("ADMIN_USER", "docente")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "mazahua2026")

# ---------- Archivos que sube el docente (imágenes y audios) ----------
BASE_DIR = Path(__file__).resolve().parent.parent
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", BASE_DIR / "media"))
MEDIA_URL = "/api/media"      # misma raíz /api que ya reenvía el proxy de Astro
MAX_IMAGEN_MB = 5
MAX_AUDIO_MB = 10