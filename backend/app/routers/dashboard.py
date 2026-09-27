"""仪表盘 API：首页趋势 + 最近发布 + 账号卡。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import accounts as accounts_svc
from ..services import dashboard as dashboard_svc

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _ongoing_count(db: Session, aid: int) -> int:
    from ..models import Project
    return db.query(Project).filter(
        Project.account_id == aid,
        Project.archived.is_(False),
        Project.status.notin_(["published", "reviewing"]),
    ).count()


@router.get("/overview")
def overview(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    from datetime import datetime
    from ..models import Metric, Project, Topic

    aid = accounts_svc.resolve_account(db, account_id)
    stats = accounts_svc.account_stats(db, aid)

    # 平均完播率：所有含 deep.completion_rate 的作品求均值
    rows = db.query(Metric).filter(Metric.account_id == aid).all()
    rates = [
        (m.deep or {}).get("completion_rate")
        for m in rows
        if m.deep and (m.deep or {}).get("completion_rate")
    ]
    # deep.completion_rate 为小数比例（0.0485 = 4.85%），统一乘 100 输出百分数
    completion_rate_avg = round(sum(rates) / len(rates) * 100, 2) if rates else None

    # 发布排期逾期：publish_schedule 早于现在且未发布/复盘
    now = datetime.utcnow()
    overdue_projects = []
    for p in db.query(Project).filter(Project.account_id == aid).all():
        if not p.publish_schedule or p.status in ("published", "reviewing", "archived"):
            continue
        try:
            if isinstance(p.publish_schedule, datetime):
                sched = p.publish_schedule
            else:
                sched = datetime.fromisoformat(str(p.publish_schedule))
            if sched < now:
                overdue_projects.append(
                    {"id": p.id, "title": p.title, "status": p.status,
                     "publish_schedule": p.publish_schedule.isoformat() if isinstance(p.publish_schedule, datetime) else str(p.publish_schedule)}
                )
        except ValueError:
            continue

    # 热门选题热词：从选题标题提取 #话题 聚合排行
    import re
    counter: dict[str, int] = {}
    for t in db.query(Topic).filter(Topic.account_id == aid).all():
        for m in re.findall(r"#([\u4e00-\u9fa5A-Za-z0-9_\-]+)", t.title or ""):
            counter[m] = counter.get(m, 0) + 1
    hot_topics = [{"tag": k, "count": v} for k, v in sorted(counter.items(), key=lambda x: -x[1])[:12]]

    # 创作建议（确定性规则聚合，对标首页「创作建议：基于当前进度的下一步行动」）
    suggestions = []
    if overdue_projects:
        suggestions.append(
            {"title": f"发布排期已逾期 {len(overdue_projects)} 项，尽快确认成片并排期发布",
             "to": "/projects"}
        )
    pending_review_count = (
        db.query(Topic).filter(Topic.account_id == aid, Topic.status == "pending_review").count()
    )
    if pending_review_count:
        suggestions.append(
            {"title": f"有 {pending_review_count} 条选题待评审，进入选题会筛选立项",
             "to": "/topics"}
        )
    from ..models import RadarContent
    pending_transcribe = (
        db.query(RadarContent)
        .filter(RadarContent.account_id == aid, RadarContent.transcript_status.in_(["pending", "failed"]))
        .count()
    )
    if pending_transcribe:
        suggestions.append(
            {"title": f"内容雷达有 {pending_transcribe} 条待转写，转录逐字稿沉淀素材库",
             "to": "/radar"}
        )
    if completion_rate_avg is not None and completion_rate_avg < 5:
        suggestions.append(
            {"title": f"平均完播率 {completion_rate_avg}%，建议优化开头 3 秒钩子与节奏",
             "to": "/analytics"}
        )
    if not suggestions:
        suggestions.append(
            {"title": "当前进度顺畅：继续推进最近项目，保持稳定产出",
             "to": "/projects"}
        )

    return {
        "account": stats,
        "trend": dashboard_svc.get_trend(db, aid, days=14),
        "works": dashboard_svc.recent_works(db, aid, limit=6),
        "completion_rate_avg": completion_rate_avg,
        "overdue_projects": overdue_projects,
        "hot_topics": hot_topics,
        "suggestions": suggestions[:3],
        "todo_count": len(overdue_projects) + pending_review_count + _ongoing_count(db, aid),
    }
