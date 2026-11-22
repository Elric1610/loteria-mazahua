"""Login de docente: contraseñas con PBKDF2 (biblioteca estándar) y tokens JWT."""
import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import ADMIN_PASSWORD, ADMIN_USER, JWT_ALGORITHM, SECRET_KEY, TOKEN_MINUTOS
from .database import get_db
from .models import Usuario

ITERACIONES = 390_000
# tokenUrl hace que el botón "Authorize" de Swagger UI pida usuario/contraseña y guarde el token
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hashear(password: str) -> str:
    sal = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), sal, ITERACIONES)
    return f"pbkdf2_sha256${ITERACIONES}${base64.b64encode(sal).decode()}${base64.b64encode(digest).decode()}"


def verificar(password: str, guardado: str) -> bool:
    try:
        _, iteraciones, sal, digest = guardado.split("$")
        calculado = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(sal), int(iteraciones))
        return hmac.compare_digest(calculado, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def crear_token(username: str) -> str:
    vence = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_MINUTOS)
    return jwt.encode({"sub": username, "exp": vence}, SECRET_KEY, algorithm=JWT_ALGORITHM)


def docente_actual(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> Usuario:
    """Dependencia: úsala en cualquier endpoint que solo pueda tocar el docente."""
    invalido = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Sesión inválida o vencida. Inicia sesión de nuevo.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        datos = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise invalido
    usuario = db.scalar(select(Usuario).where(Usuario.username == datos.get("sub")))
    if usuario is None:
        raise invalido
    return usuario


def crear_docente_inicial(db: Session) -> None:
    """Si todavía no hay usuarios, crea el docente de ADMIN_USER / ADMIN_PASSWORD."""
    if db.scalar(select(Usuario.id).limit(1)) is None:
        db.add(Usuario(username=ADMIN_USER, password_hash=hashear(ADMIN_PASSWORD), nombre="Docente"))
        db.commit()