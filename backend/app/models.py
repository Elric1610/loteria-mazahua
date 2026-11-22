"""Modelos (tablas). Deben coincidir con el SQL de arriba."""
from sqlalchemy import Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Tarjeta(Base):
    __tablename__ = "tarjetas"
    numero: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str | None] = mapped_column(String(32), unique=True)
    nombre_es: Mapped[str] = mapped_column(String(100))
    descripcion: Mapped[str | None] = mapped_column(Text)


class NombreMazahua(Base):
    __tablename__ = "nombres_mazahua"
    numero_tarjeta: Mapped[int] = mapped_column(ForeignKey("tarjetas.numero"), primary_key=True)
    nombre_maz: Mapped[str] = mapped_column(String(150))


class Imagen(Base):
    __tablename__ = "imagenes"
    numero_tarjeta: Mapped[int] = mapped_column(ForeignKey("tarjetas.numero"), primary_key=True)
    ruta: Mapped[str] = mapped_column(String(255))


class Audio(Base):
    __tablename__ = "audios"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    numero_tarjeta: Mapped[int] = mapped_column(ForeignKey("tarjetas.numero"))
    idioma: Mapped[str] = mapped_column(Enum("es", "maz", name="idioma_audio"))
    ruta: Mapped[str] = mapped_column(String(255))


class Usuario(Base):
    __tablename__ = "usuarios"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    nombre: Mapped[str] = mapped_column(String(100), default="Docente")


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    titulo: Mapped[str] = mapped_column(String(150))
    url: Mapped[str] = mapped_column(String(255))
    descripcion: Mapped[str | None] = mapped_column(Text)