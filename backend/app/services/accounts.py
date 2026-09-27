"""多账号服务：账号解析、作品导入（opencli → 作品/指标/知识资产）、账号级聚合。"""
import asyncio
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from ..models import Account, Formula, Knowledge, Material, Metric, PositionMaster, Project, Publication, Topic
from . import dashboard as dashboard_svc
from . import embedding as embed_svc
from . import publish as publish_svc

logger = logging.getLogger("creatoros.accounts")


def resolve_account(db: Session, account_id: int | None = None) -> int:
    """返回指定账号或默认账号 id。"""
    if account_id:
        return account_id
    default = db.query(Account).filter(Account.is_default.is_(True)).first()
    if default:
        return default.id
    first = db.query(Account).order_by(Account.id).first()
    return first.id if first else 1


def account_stats(db: Session, account_id: int | None = None) -> dict:
    """单个账号聚合：作品/指标/项目/选题/公式/知识/素材。"""
    aid = resolve_account(db, account_id)
    a = db.get(Account, aid)
    works = db.query(Publication).filter(Publication.account_id == aid).count()
    metrics = db.query(Metric).filter(Metric.account_id == aid, Metric.item_id != "account").all()
    views = sum(m.views or 0 for m in metrics)
    likes = sum(m.likes or 0 for m in metrics)
    return {
        "account_id": aid,
        "display_name": a.display_name if a else "",
        "platform": a.platform if a else "",
        "username": a.username if a else "",
        "uid": a.uid if a else "",
        "follower_count": a.follower_count if a else 0,
        "video_count": a.video_count if a else 0,
        "last_synced_at": a.last_synced_at.isoformat() if a and a.last_synced_at else None,
        "profile_path": a.profile_path if a else "",
        "profile_status": a.profile_status if a else "unbound",
        "works": works,
        "metrics_count": len(metrics),
        "total_views": round(views),
        "total_likes": round(likes),
        "projects": db.query(Project).filter(Project.account_id == aid).count(),
        "topics": db.query(Topic).filter(Topic.account_id == aid).count(),
        "formulas": db.query(Formula).filter(Formula.account_id == aid).count(),
        "knowledge": db.query(Knowledge).filter(Knowledge.account_id == aid).count(),
        "materials": db.query(Material).filter(Material.account_id == aid).count(),
    }


async def import_douyin_works(db: Session, account_id: int | None = None, limit: int = 10) -> dict:
    """导入账号历史作品：opencli douyin videos → Publication/Metric/Knowledge 资产化。"""
    aid = resolve_account(db, account_id)
    account = db.get(Account, aid)
    if not account:
        raise ValueError("账号不存在")

    try:
        videos = await publish_svc.list_videos("douyin", limit=limit)
    except publish_svc.PublishError as e:
        raise ValueError(f"拉取作品失败：{e}")

    # 拉账号资料更新粉丝数
    try:
        stats = await publish_svc.account_stats("douyin")
        account.follower_count = int(stats.get("follower_count") or account.follower_count or 0)
        account.uid = stats.get("uid") or account.uid or ""
    except publish_svc.PublishError:
        pass

    created_pub = created_metric = created_knowledge = 0
    for v in videos:
        item_id = str(v.get("aweme_id", ""))
        if not item_id:
            continue
        title = v.get("title") or v.get("desc") or ""
        desc = v.get("desc") or title
        cover = v.get("cover") or v.get("cover_url") or ""
        view = float(v.get("play_count") or v.get("views") or 0)
        like = float(v.get("digg_count") or v.get("likes") or 0)
        comment = float(v.get("comment_count") or v.get("comments") or 0)
        share = float(v.get("share_count") or v.get("shares") or 0)
        collect = float(v.get("collect_count") or v.get("favorites") or 0)
        raw = v

        pub = db.query(Publication).filter(
            Publication.account_id == aid, Publication.item_id == item_id
        ).first()
        if not pub:
            pub = Publication(
                account_id=aid,
                platform="douyin",
                item_id=item_id,
                title=title,
                cover_url=cover,
                status="published",
                raw=raw,
            )
            db.add(pub)
            created_pub += 1

        met = db.query(Metric).filter(Metric.account_id == aid, Metric.item_id == item_id).first()
        if not met:
            db.add(
                Metric(
                    account_id=aid,
                    platform="douyin",
                    item_id=item_id,
                    views=view,
                    likes=like,
                    comments=comment,
                    shares=share,
                    favorites=collect,
                    raw=raw,
                )
            )
            created_metric += 1

        # 文案 → 知识资产（去重，仅当该作品文案未入库）
        if desc:
            dup = (
                db.query(Knowledge)
                .filter(Knowledge.account_id == aid, Knowledge.title == title[:80])
                .first()
            )
            if not dup:
                db.add(
                    Knowledge(
                        account_id=aid,
                        title=title[:80] or f"作品 {item_id}",
                        content=desc,
                        source=f"douyin:{item_id}",
                        tags="历史作品",
                    )
                )
                created_knowledge += 1

    account.video_count = db.query(Publication).filter(Publication.account_id == aid).count()
    account.last_synced_at = datetime.utcnow()
    db.commit()

    # 写入当日数据快照（趋势图数据源）
    try:
        dashboard_svc.record_snapshot(db, aid)
    except Exception:
        pass

    # 账号知识向量化（沉淀为编导智能体可检索的全局上下文）
    embedded = 0
    pending = db.query(Knowledge).filter(Knowledge.account_id == aid, Knowledge.embedding.is_(None)).all()
    for k in pending:
        try:
            k.embedding = await embed_svc.embed_text(f"{k.title}\n{k.content}")
            embedded += 1
        except Exception:
            pass
    if embedded:
        db.commit()

    return {
        "account_id": aid,
        "pulled": len(videos),
        "new_publications": created_pub,
        "new_metrics": created_metric,
        "new_knowledge": created_knowledge,
        "embedded": embedded,
    }
