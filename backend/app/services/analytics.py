"""运营分析服务：作品深层指标补采（opencli stats）+ 观众来源分布。"""
import json
import logging
import subprocess
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models import AudienceSource, Metric, Project, Publication, Topic
from . import accounts as accounts_svc

logger = logging.getLogger("creatoros.analytics")

_STATS_MAP = {
    "view_count": "views",
    "like_count": "likes",
    "comment_count": "comments",
    "share_count": "shares",
    "favorite_count": "favorites",
}

def _run_stats(item_id: str) -> list[dict]:
    proc = subprocess.run(
        ["opencli", "douyin", "stats", item_id, "-f", "json"],
        capture_output=True,
        text=True,
        timeout=150,
    )
    out = proc.stdout.strip()
    if not out:
        raise RuntimeError(f"opencli stats 返回为空：{proc.stderr[:300]}")
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        raise RuntimeError(f"opencli stats 输出无法解析：{out[:200]}")
    if isinstance(data, dict) and data.get("ok") is False:
        raise RuntimeError(f"stats 不可用（可能非本账号作品）：{str(data.get('error'))[:150]}")
    return data

def refresh_stats(db: Session, account_id: int | None, item_id: str) -> dict:
    """补采单个作品创作者中心深层指标，写入 Metric 快照。"""
    aid = accounts_svc.resolve_account(db, account_id)
    pub = db.query(Publication).filter(Publication.account_id == aid, Publication.item_id == item_id).first()
    if not pub:
        raise ValueError("作品不存在于当前账号")
    rows = _run_stats(item_id)
    kv = {r.get("metric"): float(r.get("value") or 0) for r in rows if isinstance(r, dict)}
    m = Metric(
        account_id=aid,
        publication_id=pub.id,
        project_id=pub.project_id,
        platform=pub.platform,
        item_id=item_id,
        views=kv.get("view_count", 0),
        likes=kv.get("like_count", 0),
        comments=kv.get("comment_count", 0),
        shares=kv.get("share_count", 0),
        favorites=kv.get("favorite_count", 0),
        followers_gained=kv.get("subscribe_count", 0),
        deep={
            "avg_view_second": kv.get("avg_view_second", 0),
            "avg_view_proportion": kv.get("avg_view_proportion", 0),
            "completion_rate": kv.get("completion_rate", 0),
            "completion_rate_5s": kv.get("completion_rate_5s", 0),
            "bounce_rate_2s": kv.get("bounce_rate_2s", 0),
            "fan_view_proportion": kv.get("fan_view_proportion", 0),
            "like_rate": kv.get("like_rate", 0),
            "comment_rate": kv.get("comment_rate", 0),
        },
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    # 回填：发布后真实指标写回来源项目与选题（闭环）
    if pub.project_id:
        proj = db.get(Project, pub.project_id)
        if proj:
            proj.latest_metrics = json.dumps(
                {"views": m.views, "likes": m.likes, "comments": m.comments,
                 "shares": m.shares, "favorites": m.favorites,
                 "captured_at": m.captured_at.isoformat() if m.captured_at else None},
                ensure_ascii=False,
            )
            if proj.topic_id:
                topic = db.get(Topic, proj.topic_id)
                if topic:
                    topic.latest_metrics = proj.latest_metrics
            db.commit()
    return {
        "metric_id": m.id,
        "views": m.views,
        "likes": m.likes,
        "comments": m.comments,
        "shares": m.shares,
        "favorites": m.favorites,
        "deep": {
            "avg_view_second": kv.get("avg_view_second", 0),
            "avg_view_proportion": kv.get("avg_view_proportion", 0),
            "completion_rate": kv.get("completion_rate", 0),
            "completion_rate_5s": kv.get("completion_rate_5s", 0),
            "bounce_rate_2s": kv.get("bounce_rate_2s", 0),
            "fan_view_proportion": kv.get("fan_view_proportion", 0),
            "like_rate": kv.get("like_rate", 0),
            "comment_rate": kv.get("comment_rate", 0),
        },
    }

def save_audience(
    db: Session,
    account_id: int | None,
    item_id: str,
    values: dict,
    source: str = "manual",
) -> dict:
    """保存/更新作品观众来源分布（百分比，和≈100）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    pub = db.query(Publication).filter(Publication.account_id == aid, Publication.item_id == item_id).first()
    pub_id = pub.id if pub else None
    row = (
        db.query(AudienceSource)
        .filter(AudienceSource.account_id == aid, AudienceSource.item_id == item_id)
        .first()
    )
    if not row:
        row = AudienceSource(account_id=aid, publication_id=pub_id, item_id=item_id)
        db.add(row)
    row.recommend = float(values.get("recommend", 0) or 0)
    row.friends = float(values.get("friends", 0) or 0)
    row.follow = float(values.get("follow", 0) or 0)
    row.homepage = float(values.get("homepage", 0) or 0)
    row.search = float(values.get("search", 0) or 0)
    row.other = float(values.get("other", 0) or 0)
    row.source = source
    row.collected_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return {
        "item_id": item_id,
        "recommend": row.recommend,
        "friends": row.friends,
        "follow": row.follow,
        "homepage": row.homepage,
        "search": row.search,
        "other": row.other,
        "source": row.source,
    }

def serialize_audience(row: AudienceSource | None):
    if not row:
        return None
    return {
        "item_id": row.item_id,
        "recommend": row.recommend,
        "friends": row.friends,
        "follow": row.follow,
        "homepage": row.homepage,
        "search": row.search,
        "other": row.other,
        "source": row.source,
        "collected_at": row.collected_at.isoformat() if row.collected_at else None,
    }
