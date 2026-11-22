"""Estado del juego en vivo: lo consultan los celulares y lo alimenta el ESP32."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..juego import nuevo_juego, obtener_o_crear_juego
from ..models import Tarjeta
from ..schemas import (
    CantarEntrada, Estado, EstadoJugador, MarcasEntrada, MarcasSalida, TableroSalida,
)
from .catalogo import cargar_catalogo

router = APIRouter(prefix="/api/netfly", tags=["Juego en vivo"])


def _ids_catalogo(db: Session) -> list[int]:
    return [c.id for c in cargar_catalogo(db)]


@router.get("/state", response_model=Estado, summary="Estado actual (lo consulta cada celular)")
def estado(client_id: str, db: Session = Depends(get_db)):
    juego = obtener_o_crear_juego(_ids_catalogo(db))
    jugador = None
    tablero = juego.tableros.get(client_id)
    if tablero is not None:
        jugador = EstadoJugador(marks=sorted(tablero.marcas), winner=tablero.ganador)
    return Estado(online=juego.online, gameId=juego.id, events=juego.eventos(), player=jugador)


@router.get("/board", response_model=TableroSalida, summary="Tablero asignado a este celular")
def tablero(client_id: str, db: Session = Depends(get_db)):
    juego = obtener_o_crear_juego(_ids_catalogo(db))
    t = juego.tablero_de(client_id)
    return TableroSalida(number=t.numero, cards=t.cartas, marks=sorted(t.marcas), gameKey=juego.id)


@router.put("/marks", response_model=MarcasSalida, summary="Guardar frijolitos marcados (y cantar Lotería si claim=true)")
def marcar(datos: MarcasEntrada, db: Session = Depends(get_db)):
    juego = obtener_o_crear_juego(_ids_catalogo(db))
    marcas, gano = juego.marcar(datos.client_id, datos.marks, datos.claim)
    return MarcasSalida(marks=marcas, winner=gano)


# ---------- Para el equipo del ESP32 / RFID (otras materias) ----------
@router.post("/latido", summary="El ESP32 avisa que sigue encendido (llamar cada pocos segundos)")
def latido(db: Session = Depends(get_db)):
    juego = obtener_o_crear_juego(_ids_catalogo(db))
    juego.latido()
    return {"ok": True, "gameId": juego.id}


@router.post("/cantar", summary="El ESP32 avisa que se leyó una tarjeta (manda uid o numero)")
def cantar(datos: CantarEntrada, db: Session = Depends(get_db)):
    if not datos.uid and not datos.numero:
        raise HTTPException(400, "Manda 'uid' (de la tarjeta RFID) o 'numero' de la carta")
    numero = datos.numero
    if numero is None:
        tarjeta = db.scalar(select(Tarjeta).where(Tarjeta.uid == datos.uid.strip().upper()))
        if tarjeta is None:
            raise HTTPException(404, "Ese UID no corresponde a ninguna carta")
        numero = tarjeta.numero
    juego = obtener_o_crear_juego(_ids_catalogo(db))
    nueva = juego.cantar(numero)
    return {"ok": True, "nueva": nueva, "cardId": numero, "gameId": juego.id}


@router.post("/juego/nuevo", summary="Reinicia la partida (nuevo gameId, tableros y cartas cantadas limpios)")
def reiniciar(db: Session = Depends(get_db)):
    juego = nuevo_juego(_ids_catalogo(db))
    return {"ok": True, "gameId": juego.id}