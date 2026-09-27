"""运营分析 API：作品深层指标 + 观众来源分布 + 补采。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, AudienceSource, Metric, Publication
from ..services import accounts as accounts_svc
from ..services import analytics as analytics_svc

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class AudiencePut(BaseModel):
    recommend: float = 0
    friends: float = 0
    follow: float = 0
    homepage: float = 0
    search: float = 0
    other: float = 0


def _latest_metric(db: Session, pub: Publication) -> dict | None:
    m = (
        db.query(Metric)
        .filter(Metric.item_id == pub.item_id)
        .order_by(Metric.id.desc())
        .first()
    )
    if not m:
        return None
    return {
        "views": m.views,
        "likes": m.likes,
        "comments": m.comments,
        "shares": m.shares,
        "favorites": m.favorites,
        "followers_gained": m.followers_gained,
        "deep": (m.deep or {}),
    }


@router.get("/overview")
def overview(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """运营分析总览：作品列表 + 最新指标 + 观众来源 + 采集元数据。"""
    aid = accounts_svc.resolve_account(db, account_id)
    pubs = (
        db.query(Publication)
        .filter(Publication.account_id == aid)
        .order_by(Publication.created_at.desc())
        .all()
    )
    works = []
    for pub in pubs:
        aud = (
            db.query(AudienceSource)
            .filter(AudienceSource.account_id == aid, AudienceSource.item_id == pub.item_id)
            .first()
        )
        works.append(
            {
                "id": pub.id,
                "item_id": pub.item_id,
                "title": pub.title,
                "cover_url": pub.cover_url,
                "platform": pub.platform,
                "status": pub.status,
                "created_at": pub.created_at.isoformat() if pub.created_at else None,
                "metrics": _latest_metric(db, pub),
                "audience": analytics_svc.serialize_audience(aud),
            }
        )
    total_views = sum((w["metrics"] or {}).get("views", 0) for w in works)
    total_likes = sum((w["metrics"] or {}).get("likes", 0) for w in works)
    acc = db.query(Account).filter(Account.id == aid).first()
    anomalies = []
    for w in works:
        m = w["metrics"]
        if not m:
            continue
        views = m.get("views", 0)
        likes = m.get("likes", 0)
        if views >= 500:
            anomalies.append({"item_id": w["item_id"], "title": w["title"], "type": "high_views", "views": views, "likes": likes})
        elif views >= 200 and views > 0 and likes / views < 0.02:
            anomalies.append({"item_id": w["item_id"], "title": w["title"], "type": "low_engagement", "views": views, "likes": likes})
    return {
        "works": works,
        "totals": {"views": total_views, "likes": total_likes, "works": len(works)},
        "anomalies": anomalies[:10],
        "account": {"id": aid, "name": (acc.display_name or acc.username) if acc else ""},
        "meta": {"platform": "douyin", "source": "opencli stats", "window": "最新一条快照"},
    }


@router.get("/accounts-overview")
def accounts_overview(db: Session = Depends(get_db)):
    """多账号对比：每个账号的作品数/累计播放/点赞（各账号数据各归各位）。"""
    out = []
    for acc in db.query(Account).order_by(Account.id).all():
        pubs = db.query(Publication).filter(Publication.account_id == acc.id).all()
        views = likes = 0
        for pub in pubs:
            m = _latest_metric(db, pub)
            if m:
                views += m.get("views", 0)
                likes += m.get("likes", 0)
        out.append({
            "account_id": acc.id,
            "name": acc.display_name or acc.username,
            "username": acc.username,
            "works": len(pubs),
            "views": views,
            "likes": likes,
        })
    return {"accounts": out}


@router.post("/audience/{item_id}/refresh")
def refresh(item_id: str, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        result = analytics_svc.refresh_stats(db, aid, item_id)
        return {"ok": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/audience/{item_id}")
def put_audience(item_id: str, payload: AudiencePut, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        result = analytics_svc.save_audience(
            db, aid, item_id, payload.model_dump(), source="manual"
        )
        return {"ok": True, "audience": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
