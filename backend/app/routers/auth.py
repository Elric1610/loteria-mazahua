"""Login del docente (JWT)."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Usuario
from ..schemas import CambioPassword, TokenSalida, UsuarioSalida
from ..seguridad import crear_token, docente_actual, hashear, verificar

router = APIRouter(prefix="/api/auth", tags=["Autenticación"])


@router.post("/login", response_model=TokenSalida, summary="Iniciar sesión (devuelve el token JWT)")
def login(formulario: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    usuario = db.scalar(select(Usuario).where(Usuario.username == formulario.username))
    if usuario is None or not verificar(formulario.password, usuario.password_hash):
        raise HTTPException(401, "Usuario o contraseña incorrectos", headers={"WWW-Authenticate": "Bearer"})
    return TokenSalida(access_token=crear_token(usuario.username), nombre=usuario.nombre)


@router.get("/me", response_model=UsuarioSalida, summary="Quién soy (comprueba que el token sirve)")
def yo(docente: Usuario = Depends(docente_actual)):
    return UsuarioSalida(username=docente.username, nombre=docente.nombre)


@router.put("/password", summary="Cambiar mi contraseña")
def cambiar_password(datos: CambioPassword, docente: Usuario = Depends(docente_actual), db: Session = Depends(get_db)):
    if not verificar(datos.actual, docente.password_hash):
        raise HTTPException(400, "La contraseña actual no es correcta")
    docente.password_hash = hashear(datos.nueva)
    db.commit()
    return {"ok": True}