"""健康检查与系统状态。"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db

router = APIRouter(tags=["system"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "database": "ok" if db_ok else "error",
        "ark_configured": bool(settings.ark_api_key),
        "opencli": settings.opencli_bin,
    }
