"""系统告警 API。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Alert
from ..services import accounts as accounts_svc
from ..services import alerts as alerts_svc

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _ser(a: Alert):
    return {
        "id": a.id,
        "level": a.level,
        "title": a.title,
        "detail": a.detail,
        "source_type": a.source_type,
        "source_id": a.source_id,
        "read": a.read_at is not None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("")
def get_alerts(
    db: Session = Depends(get_db),
    account_id: int | None = Query(None),
    limit: int = Query(20),
    unread_only: bool = Query(False),
):
    aid = accounts_svc.resolve_account(db, account_id)
    items = alerts_svc.list_alerts(db, aid, limit=limit, unread_only=unread_only)
    return {
        "alerts": [_ser(a) for a in items],
        "unread": alerts_svc.unread_count(db, aid),
    }


@router.post("/{alert_id}/read")
def read_alert(alert_id: int, db: Session = Depends(get_db)):
    a = alerts_svc.mark_read(db, alert_id)
    if not a:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="告警不存在")
    return {"ok": True, "alert": _ser(a)}
