"""系统告警服务：写入、查询、标记已读。"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models import Alert

def push_alert(
    db: Session,
    account_id: int | None,
    level: str,
    title: str,
    detail: str = "",
    source_type: str = "",
    source_id: int | None = None,
) -> Alert:
    """写一条告警（自动去重：同 source_type+source_id+未读 不重复堆）。"""
    if source_type and source_id is not None:
        dup = (
            db.query(Alert)
            .filter(
                Alert.source_type == source_type,
                Alert.source_id == source_id,
                Alert.read_at.is_(None),
            )
            .first()
        )
        if dup:
            dup.level = level
            dup.title = title
            dup.detail = detail
            dup.created_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(dup)
            return dup
    a = Alert(
        account_id=account_id,
        level=level,
        title=title,
        detail=detail,
        source_type=source_type,
        source_id=source_id,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a

def list_alerts(db: Session, account_id: int | None, limit: int = 20, unread_only: bool = False):
    q = db.query(Alert)
    if account_id is not None:
        q = q.filter((Alert.account_id == account_id) | (Alert.account_id.is_(None)))
    if unread_only:
        q = q.filter(Alert.read_at.is_(None))
    q = q.order_by(Alert.created_at.desc()).limit(limit)
    return q.all()

def unread_count(db: Session, account_id: int | None) -> int:
    q = db.query(Alert)
    if account_id is not None:
        q = q.filter((Alert.account_id == account_id) | (Alert.account_id.is_(None)))
    return q.filter(Alert.read_at.is_(None)).count()

def mark_read(db: Session, alert_id: int) -> Alert | None:
    a = db.get(Alert, alert_id)
    if a:
        a.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(a)
    return a
