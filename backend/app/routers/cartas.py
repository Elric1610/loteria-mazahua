"""CRUD de cartas (vocabulario). Consultar es público; crear, modificar y borrar exige login de docente."""
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..archivos import borrar_subida, guardar_subida
from ..database import get_db
from ..juego import sincronizar_catalogo
from ..models import Audio, Imagen, NombreMazahua, Tarjeta, Usuario
from ..schemas import CartaActualizar, CartaCatalogo, CartaDetalle, CartaEntrada
from ..seguridad import docente_actual
from .catalogo import armar_carta, cargar_catalogo

router = APIRouter(prefix="/api/cartas", tags=["Cartas (CRUD)"])


# ---------- utilidades ----------
def _obtener(db: Session, numero: int) -> Tarjeta:
    tarjeta = db.get(Tarjeta, numero)
    if tarjeta is None:
        raise HTTPException(404, f"No existe la carta {numero}")
    return tarjeta


def _detalle(db: Session, tarjeta: Tarjeta) -> CartaDetalle:
    return CartaDetalle(**armar_carta(db, tarjeta).model_dump(), uid=tarjeta.uid)


def _validar_uid(db: Session, uid: str | None, numero_actual: int | None = None) -> None:
    if uid is None:
        return
    otra = db.scalar(select(Tarjeta).where(Tarjeta.uid == uid))
    if otra is not None and otra.numero != numero_actual:
        raise HTTPException(409, f"El UID {uid} ya está asignado a la carta {otra.numero}")


def _sincronizar_juego(db: Session, eliminada: int | None = None) -> None:
    """La partida en curso guarda la lista de cartas; hay que avisarle cuando cambia el catálogo."""
    ids = list(db.scalars(select(Tarjeta.numero).order_by(Tarjeta.numero)))
    sincronizar_catalogo(ids, eliminada)


# ---------- consultar (público) ----------
@router.get("", response_model=list[CartaCatalogo], summary="Listar todas las cartas")
def listar(db: Session = Depends(get_db)):
    return cargar_catalogo(db)


@router.get("/{numero}", response_model=CartaCatalogo, summary="Consultar una carta")
def consultar(numero: int, db: Session = Depends(get_db)):
    return armar_carta(db, _obtener(db, numero))

@router.get("/{numero}/detalle", response_model=CartaDetalle, summary="Consultar una carta con su UID (docente)")
def consultar_detalle(numero: int, db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    return _detalle(db, _obtener(db, numero))

# ---------- crear / modificar / eliminar (docente) ----------
@router.post("", response_model=CartaDetalle, status_code=201, summary="Crear carta (docente)")
def crear(datos: CartaEntrada, db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    numero = datos.numero or ((db.scalar(select(func.max(Tarjeta.numero))) or 0) + 1)
    if db.get(Tarjeta, numero) is not None:
        raise HTTPException(409, f"Ya existe la carta {numero}")
    _validar_uid(db, datos.uid)
    db.add(Tarjeta(numero=numero, uid=datos.uid, nombre_es=datos.nombre_es, descripcion=datos.descripcion))
    db.flush()  # la tarjeta debe existir antes de insertar su nombre en mazahua (llave foránea)
    db.add(NombreMazahua(numero_tarjeta=numero, nombre_maz=datos.nombre_mazahua))
    db.commit()
    _sincronizar_juego(db)
    return _detalle(db, db.get(Tarjeta, numero))


@router.put("/{numero}", response_model=CartaDetalle, summary="Modificar carta (docente). Solo se cambian los campos enviados")
def modificar(numero: int, datos: CartaActualizar, db: Session = Depends(get_db),
              docente: Usuario = Depends(docente_actual)):
    tarjeta = _obtener(db, numero)
    cambios = datos.model_dump(exclude_unset=True)
    if cambios.get("nombre_es") is not None:
        tarjeta.nombre_es = cambios["nombre_es"]
    if "descripcion" in cambios:
        tarjeta.descripcion = cambios["descripcion"]
    if "uid" in cambios:
        _validar_uid(db, cambios["uid"], numero)
        tarjeta.uid = cambios["uid"]
    if cambios.get("nombre_mazahua") is not None:
        fila = db.get(NombreMazahua, numero)
        if fila is None:
            db.add(NombreMazahua(numero_tarjeta=numero, nombre_maz=cambios["nombre_mazahua"]))
        else:
            fila.nombre_maz = cambios["nombre_mazahua"]
    db.commit()
    return _detalle(db, tarjeta)


@router.delete("/{numero}", status_code=204, summary="Eliminar carta (docente). Reinicia la partida en curso")
def eliminar(numero: int, db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    tarjeta = _obtener(db, numero)
    imagen = db.get(Imagen, numero)
    nombre = db.get(NombreMazahua, numero)
    audios = db.scalars(select(Audio).where(Audio.numero_tarjeta == numero)).all()
    archivos = ([imagen.ruta] if imagen else []) + [a.ruta for a in audios]
    for fila in [*audios, nombre, imagen]:      # primero los registros hijos...
        if fila is not None:
            db.delete(fila)
    db.flush()
    db.delete(tarjeta)                          # ...y al final la tarjeta
    db.commit()
    for ruta in archivos:
        borrar_subida(ruta)                     # solo borra lo subido por la API, no lo de public/
    _sincronizar_juego(db, eliminada=numero)
    return Response(status_code=204)


# ---------- imagen y audio (docente) ----------
@router.put("/{numero}/imagen", response_model=CartaDetalle, summary="Subir o reemplazar la imagen (docente)")
def subir_imagen(numero: int, archivo: UploadFile = File(..., description="webp, png o jpg (máx. 5 MB)"),
                 db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    tarjeta = _obtener(db, numero)
    ruta = guardar_subida(archivo, "imagenes", f"carta{numero:03d}")
    fila = db.get(Imagen, numero)
    anterior = fila.ruta if fila else None
    try:
        if fila is None:
            db.add(Imagen(numero_tarjeta=numero, ruta=ruta))
        else:
            fila.ruta = ruta
        db.commit()
    except Exception:
        db.rollback()
        borrar_subida(ruta)
        raise
    borrar_subida(anterior)
    return _detalle(db, tarjeta)


@router.put("/{numero}/audio/{idioma}", response_model=CartaDetalle,
            summary="Subir o reemplazar el audio: idioma 'maz' (mazahua) o 'es' (español) (docente)")
def subir_audio(numero: int, idioma: Literal["es", "maz"],
                archivo: UploadFile = File(..., description="ogg, mp3, wav o m4a (máx. 10 MB)"),
                db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    tarjeta = _obtener(db, numero)
    ruta = guardar_subida(archivo, "audios", f"{idioma}_{numero:03d}")
    fila = db.scalar(select(Audio).where(Audio.numero_tarjeta == numero, Audio.idioma == idioma))
    anterior = fila.ruta if fila else None
    try:
        if fila is None:
            db.add(Audio(numero_tarjeta=numero, idioma=idioma, ruta=ruta))
        else:
            fila.ruta = ruta
        db.commit()
    except Exception:
        db.rollback()
        borrar_subida(ruta)
        raise
    borrar_subida(anterior)
    return _detalle(db, tarjeta)