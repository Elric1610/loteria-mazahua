"""Videos de muestra del proyecto (enlaces de YouTube). Consultar es público; el resto exige docente."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Usuario, Video
from ..schemas import VideoActualizar, VideoEntrada, VideoSalida, extraer_id_youtube
from ..seguridad import docente_actual

router = APIRouter(prefix="/api/videos", tags=["Videos"])


def _salida(video: Video) -> VideoSalida:
    yt = extraer_id_youtube(video.url) or ""
    return VideoSalida(
        id=video.id,
        titulo=video.titulo,
        url=video.url,
        descripcion=video.descripcion or "",
        youtube_id=yt,
        embed_url=f"https://www.youtube-nocookie.com/embed/{yt}" if yt else "",
        thumbnail=f"https://img.youtube.com/vi/{yt}/hqdefault.jpg" if yt else "",
    )


def _obtener(db: Session, video_id: int) -> Video:
    video = db.get(Video, video_id)
    if video is None:
        raise HTTPException(404, f"No existe el video {video_id}")
    return video


@router.get("", response_model=list[VideoSalida], summary="Listar videos")
def listar(db: Session = Depends(get_db)):
    return [_salida(v) for v in db.scalars(select(Video).order_by(Video.id))]


@router.get("/{video_id}", response_model=VideoSalida, summary="Consultar un video")
def consultar(video_id: int, db: Session = Depends(get_db)):
    return _salida(_obtener(db, video_id))


@router.post("", response_model=VideoSalida, status_code=201, summary="Registrar video (docente)")
def crear(datos: VideoEntrada, db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    video = Video(titulo=datos.titulo, url=datos.url, descripcion=datos.descripcion)
    db.add(video)
    db.commit()
    db.refresh(video)
    return _salida(video)


@router.put("/{video_id}", response_model=VideoSalida, summary="Modificar video (docente). Solo se cambian los campos enviados")
def modificar(video_id: int, datos: VideoActualizar, db: Session = Depends(get_db),
              docente: Usuario = Depends(docente_actual)):
    video = _obtener(db, video_id)
    cambios = datos.model_dump(exclude_unset=True)
    if cambios.get("titulo") is not None:
        video.titulo = cambios["titulo"]
    if cambios.get("url") is not None:
        video.url = cambios["url"]
    if "descripcion" in cambios:
        video.descripcion = cambios["descripcion"]
    db.commit()
    db.refresh(video)
    return _salida(video)


@router.delete("/{video_id}", status_code=204, summary="Eliminar video (docente)")
def eliminar(video_id: int, db: Session = Depends(get_db), docente: Usuario = Depends(docente_actual)):
    db.delete(_obtener(db, video_id))
    db.commit()
    return Response(status_code=204)