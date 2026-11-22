"""Catálogo de cartas: lo consume el frontend y también arma el motor del juego."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Audio, Imagen, NombreMazahua, Tarjeta
from ..schemas import CartaCatalogo

router = APIRouter(prefix="/api/netfly", tags=["Catálogo"])


def cargar_catalogo(db: Session) -> list[CartaCatalogo]:
    nombres_maz = dict(db.execute(select(NombreMazahua.numero_tarjeta, NombreMazahua.nombre_maz)).all())
    imagenes = dict(db.execute(select(Imagen.numero_tarjeta, Imagen.ruta)).all())
    audios_es = dict(db.execute(select(Audio.numero_tarjeta, Audio.ruta).where(Audio.idioma == "es")).all())
    audios_maz = dict(db.execute(select(Audio.numero_tarjeta, Audio.ruta).where(Audio.idioma == "maz")).all())
    tarjetas = db.scalars(select(Tarjeta).order_by(Tarjeta.numero)).all()
    return [
        CartaCatalogo(
            id=t.numero,
            name_es=t.nombre_es,
            name_mazahua=nombres_maz.get(t.numero, ""),
            image=imagenes.get(t.numero, ""),
            audio_es=audios_es.get(t.numero, ""),
            audio_mazahua=audios_maz.get(t.numero, ""),
            description=t.descripcion or "",
        )
        for t in tarjetas
    ]


def armar_carta(db: Session, t: Tarjeta) -> CartaCatalogo:
    """Una sola carta (la usa el CRUD para devolver el resultado de cada operación)."""
    nombre = db.get(NombreMazahua, t.numero)
    imagen = db.get(Imagen, t.numero)
    audios = {a.idioma: a.ruta for a in db.scalars(select(Audio).where(Audio.numero_tarjeta == t.numero))}
    return CartaCatalogo(
        id=t.numero,
        name_es=t.nombre_es,
        name_mazahua=nombre.nombre_maz if nombre else "",
        image=imagen.ruta if imagen else "",
        audio_es=audios.get("es", ""),
        audio_mazahua=audios.get("maz", ""),
        description=t.descripcion or "",
    )


@router.get("/catalog", response_model=list[CartaCatalogo], summary="Catálogo completo de las cartas")
def catalogo(db: Session = Depends(get_db)):
    return cargar_catalogo(db)