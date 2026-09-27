"""仪表盘服务：每日快照写入、趋势聚合、最近发布。"""
import logging
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Account, DailySnapshot, Metric, Publication
from . import accounts as accounts_svc

logger = logging.getLogger("creatoros.dashboard")

def record_snapshot(db: Session, account_id: int | None = None) -> dict:
    """把账号当日指标聚合写入/更新 daily_snapshots（趋势图数据源）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    today = date.today().isoformat()
    metrics = (
        db.query(Metric)
        .filter(Metric.account_id == aid, Metric.captured_at.isnot(None))
        .all()
    )
    views = sum(m.views or 0 for m in metrics)
    likes = sum(m.likes or 0 for m in metrics)
    comments = sum(m.comments or 0 for m in metrics)
    shares = sum(m.shares or 0 for m in metrics)
    favorites = sum(m.favorites or 0 for m in metrics)
    works = db.query(Publication).filter(Publication.account_id == aid).count()
    account = db.get(Account, aid)
    followers = account.follower_count if account else 0

    snap = (
        db.query(DailySnapshot)
        .filter(DailySnapshot.account_id == aid, DailySnapshot.date == today)
        .first()
    )
    if snap:
        snap.views, snap.likes = views, likes
        snap.comments, snap.shares, snap.favorites = comments, shares, favorites
        snap.followers, snap.works = followers, works
    else:
        snap = DailySnapshot(
            account_id=aid,
            date=today,
            views=views,
            likes=likes,
            comments=comments,
            shares=shares,
            favorites=favorites,
            followers=followers,
            works=works,
        )
        db.add(snap)
    db.commit()
    return {"account_id": aid, "date": today, "views": views, "likes": likes, "followers": followers}

def get_trend(db: Session, account_id: int | None = None, days: int = 14) -> list[dict]:
    """最近 N 天趋势：播放/点赞/粉丝（缺失日期补零）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    snaps = (
        db.query(DailySnapshot)
        .filter(DailySnapshot.account_id == aid)
        .order_by(DailySnapshot.date)
        .all()
    )
    by_date = {s.date: s for s in snaps}
    out: list[dict] = []
    today = date.today()
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        s = by_date.get(d)
        out.append(
            {
                "date": d,
                "views": s.views if s else 0,
                "likes": s.likes if s else 0,
                "followers": s.followers if s else 0,
                "works": s.works if s else 0,
            }
        )
    return out

def recent_works(db: Session, account_id: int | None = None, limit: int = 6) -> list[dict]:
    """最近发布作品。"""
    aid = accounts_svc.resolve_account(db, account_id)
    pubs = (
        db.query(Publication)
        .filter(Publication.account_id == aid)
        .order_by(Publication.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": p.id,
            "platform": p.platform,
            "item_id": p.item_id,
            "title": p.title or "",
            "cover_url": p.cover_url or "",
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in pubs
    ]
