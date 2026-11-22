"""Estado del juego en memoria (no son tablas: es la partida en vivo)."""
import random
import time
import uuid

from .config import SEGUNDOS_SIN_SENAL

CARTAS_POR_TABLERO = 16
COLUMNAS = 4
# las 10 líneas posibles de un tablero 4x4: 4 filas, 4 columnas y 2 diagonales
LINEAS = (
    [list(range(f * COLUMNAS, f * COLUMNAS + COLUMNAS)) for f in range(COLUMNAS)]
    + [list(range(c, CARTAS_POR_TABLERO, COLUMNAS)) for c in range(COLUMNAS)]
    + [[0, 5, 10, 15], [3, 6, 9, 12]]
)


class Tablero:
    def __init__(self, numero: int, cartas: list[int]):
        self.numero = numero
        self.cartas = cartas          # 16 ids, en el orden que se dibujan en la cuadrícula
        self.marcas: set[int] = set()
        self.ganador = False


class Juego:
    def __init__(self, catalogo_ids: list[int]):
        self.id = uuid.uuid4().hex[:8]
        self.catalogo_ids = catalogo_ids
        self.cantadas: list[int] = []           # ids ya cantados, en orden
        self.tableros: dict[str, Tablero] = {}  # client_id -> Tablero
        self._siguiente_numero = 1
        self.ultima_senal: float | None = None  # None = el ESP32 nunca ha avisado

    @property
    def online(self) -> bool:
        return self.ultima_senal is not None and time.time() - self.ultima_senal < SEGUNDOS_SIN_SENAL

    def latido(self) -> None:
        self.ultima_senal = time.time()

    def cantar(self, numero: int) -> bool:
        """Registra una carta cantada. Devuelve True si era nueva."""
        self.latido()
        if numero not in self.catalogo_ids or numero in self.cantadas:
            return False
        self.cantadas.append(numero)
        return True

    def eventos(self) -> list[dict]:
        return [{"id": i + 1, "cardId": c} for i, c in enumerate(self.cantadas)]

    def tablero_de(self, client_id: str) -> Tablero:
        tablero = self.tableros.get(client_id)
        if tablero is None:
            cantidad = min(CARTAS_POR_TABLERO, len(self.catalogo_ids))
            elegidas = random.sample(self.catalogo_ids, cantidad)
            tablero = Tablero(self._siguiente_numero, elegidas)
            self._siguiente_numero += 1
            self.tableros[client_id] = tablero
        return tablero

    def marcar(self, client_id: str, marcas: list[int], reclamar: bool) -> tuple[list[int], bool]:
        tablero = self.tablero_de(client_id)
        validas = {m for m in marcas if m in tablero.cartas}
        tablero.marcas = validas
        if reclamar:
            cantadas = set(self.cantadas)
            tablero.ganador = any(
                all(tablero.cartas[i] in validas and tablero.cartas[i] in cantadas for i in linea)
                for linea in LINEAS
            )
        return sorted(validas), tablero.ganador


juego_actual: Juego | None = None


def obtener_o_crear_juego(catalogo_ids: list[int]) -> Juego:
    global juego_actual
    if juego_actual is None:
        juego_actual = Juego(catalogo_ids)
    return juego_actual


def nuevo_juego(catalogo_ids: list[int]) -> Juego:
    global juego_actual
    juego_actual = Juego(catalogo_ids)
    return juego_actual

def sincronizar_catalogo(catalogo_ids: list[int], carta_eliminada: int | None = None) -> bool:
    """Mantiene la partida en curso alineada con el catálogo después de un alta o una baja.
    Alta: solo se actualiza la lista de cartas que se pueden cantar.
    Baja: se reinicia la partida (algún tablero podría tener la carta borrada), conservando la
    señal del ESP32 para que no aparezca 'sin conexión'. Devuelve True si se reinició."""
    global juego_actual
    if juego_actual is None:
        return False
    if carta_eliminada is None:
        juego_actual.catalogo_ids = catalogo_ids
        return False
    senal = juego_actual.ultima_senal
    juego_actual = Juego(catalogo_ids)
    juego_actual.ultima_senal = senal
    return True