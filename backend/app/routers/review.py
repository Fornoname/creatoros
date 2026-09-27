"""复盘中心 API：预测、AI 复盘、公式库、指标回填、导出报告。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Formula, Metric, PositionMaster, Prediction, Project, Script, Topic
from ..services import accounts as accounts_svc
from ..services import position as position_svc
from ..services import publish as publish_svc
from ..services import review as review_svc

router = APIRouter(prefix="/api/review", tags=["review"])


class PredictRequest(BaseModel):
    project_id: int


class AnalyzeRequest(BaseModel):
    project_id: int


class FormulaDecisionRequest(BaseModel):
    action: str  # adopt / reject


def _position_text(db: Session, account_id: int | None = None) -> str:
    aid = accounts_svc.resolve_account(db, account_id)
    master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == aid).first()
    return position_svc.master_to_text(master) if master else "（尚未配置定位母版）"


def _metrics_of(db: Session, project_id: int | None = None, account_id: int | None = None):
    q = db.query(Metric).order_by(Metric.captured_at.desc())
    if account_id:
        q = q.filter(Metric.account_id == account_id)
    if project_id:
        q = q.filter(Metric.project_id == project_id)
    return q.all()


def _metric_texts(metrics: list[Metric]) -> str:
    lines = []
    for m in metrics:
        parts = [f"播放{m.views:.0f}", f"点赞{m.likes:.0f}", f"评论{m.comments:.0f}", f"分享{m.shares:.0f}"]
        if m.completion_rate is not None:
            parts.append(f"完播{m.completion_rate:.0%}")
        if m.retention_5s is not None:
            parts.append(f"5秒留存{m.retention_5s:.0%}")
        if m.avg_watch_seconds is not None:
            parts.append(f"平均时长{m.avg_watch_seconds:.0f}s")
        lines.append(f"[{m.platform}] " + " / ".join(parts))
    return "\n".join(lines) or "（无指标）"


@router.post("/predict")
async def predict(payload: PredictRequest, db: Session = Depends(get_db)):
    """发布前预测：创建 Prediction 记录。"""
    project = db.get(Project, payload.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    script = (
        db.query(Script).filter(Script.project_id == project.id).order_by(Script.id.desc()).first()
    )
    try:
        result = await review_svc.predict_performance(project, _position_text(db, project.account_id), script.script_text if script else "")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"预测失败：{e}")
    pred = Prediction(
        project_id=project.id,
        predicted_views=float(result.get("predicted_views", 0)),
        predicted_completion=float(result.get("predicted_completion", 0)),
        reasoning=result.get("reasoning", ""),
    )
    db.add(pred)
    db.commit()
    db.refresh(pred)
    return {
        "prediction": {
            "id": pred.id,
            "predicted_views": pred.predicted_views,
            "predicted_completion": pred.predicted_completion,
            "reasoning": pred.reasoning,
            "created_at": pred.created_at.isoformat() if pred.created_at else None,
        }
    }


@router.post("/analyze")
async def analyze(payload: AnalyzeRequest, db: Session = Depends(get_db)):
    """AI 复盘：综合指标（+最新评论）做归因与沉淀。"""
    project = db.get(Project, payload.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    metrics = _metrics_of(db, project.id, project.account_id)
    try:
        result = await review_svc.review_project(
            project, _metric_texts(metrics), "", _position_text(db, project.account_id)
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"复盘失败：{e}")
    return {"review": result}


@router.post("/formulas/generate")
async def generate_formulas(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """从近期表现数据提炼公式候选（带证据，状态 candidate）。"""
    videos = await publish_svc.list_videos("douyin", limit=5)
    top = "\n".join(
        f"- {v.get('title', '')}（播放{v.get('play_count', 0)}）" for v in videos[:5]
    ) or "（暂无可分析作品）"
    try:
        candidates = await review_svc.generate_formula_candidates("", top, _position_text(db, accounts_svc.resolve_account(db, account_id)))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"公式提炼失败：{e}")
    created = []
    for c in candidates:
        f = Formula(
            account_id=accounts_svc.resolve_account(db, account_id),
            title=c.get("title", "未命名公式"),
            content=c.get("content", ""),
            dimension=c.get("dimension", "hook"),
            evidence=c.get("evidence", ""),
            confidence=float(c.get("confidence", 0.5)),
            status="candidate",
        )
        db.add(f)
        created.append({"id": f.id, "title": f.title, "dimension": f.dimension, "confidence": f.confidence})
    db.commit()
    return {"formulas": created}


@router.get("/formulas")
def list_formulas(status: str = "candidate", db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    q = db.query(Formula).filter(Formula.account_id == aid).order_by(Formula.confidence.desc())
    if status != "all":
        q = q.filter(Formula.status == status)
    return {
        "formulas": [
            {
                "id": f.id,
                "title": f.title,
                "content": f.content,
                "dimension": f.dimension,
                "evidence": f.evidence,
                "confidence": f.confidence,
                "usage_count": f.usage_count,
                "status": f.status,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in q.all()
        ]
    }


@router.post("/formulas/{fid}/decision")
def decide_formula(fid: int, payload: FormulaDecisionRequest, db: Session = Depends(get_db)):
    f = db.get(Formula, fid)
    if not f:
        raise HTTPException(status_code=404, detail="公式不存在")
    if payload.action not in ("adopt", "reject"):
        raise HTTPException(status_code=400, detail="action 需为 adopt 或 reject")
    f.status = "adopted" if payload.action == "adopt" else "rejected"
    db.commit()
    return {"formula": {"id": f.id, "status": f.status}}


@router.post("/metrics/pull")
async def pull_metrics(project_id: int | None = None, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """从抖音拉取真实作品指标，写入 Metric 快照。"""
    videos = await publish_svc.list_videos("douyin", limit=10)
    saved = 0
    for v in videos:
        item_id = str(v.get("aweme_id", ""))
        if not item_id:
            continue
        exists = db.query(Metric).filter(Metric.item_id == item_id, Metric.account_id == accounts_svc.resolve_account(db, account_id)).first()
        if exists:
            continue
        m = Metric(
            account_id=accounts_svc.resolve_account(db, account_id),
            project_id=project_id,
            platform="douyin",
            item_id=item_id,
            views=float(v.get("play_count", 0) or 0),
            likes=float(v.get("digg_count", 0) or 0),
            comments=float(v.get("comment_count", 0) or 0),
            shares=float(v.get("share_count", 0) or 0),
            favorites=float(v.get("collect_count", 0) or 0),
            raw=v,
        )
        db.add(m)
        saved += 1
    db.commit()
    from ..services import dashboard as dashboard_svc
    try:
        dashboard_svc.record_snapshot(db, accounts_svc.resolve_account(db, account_id))
    except Exception:
        pass
    return {"pulled": saved, "total": len(videos)}


@router.get("/metrics")
def list_metrics(project_id: int | None = None, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    metrics = _metrics_of(db, project_id, account_id)
    return {
        "metrics": [
            {
                "id": m.id,
                "platform": m.platform,
                "item_id": m.item_id,
                "views": m.views,
                "likes": m.likes,
                "comments": m.comments,
                "shares": m.shares,
                "favorites": m.favorites,
                "completion_rate": m.completion_rate,
                "retention_5s": m.retention_5s,
                "cover_ctr": m.cover_ctr,
                "avg_watch_seconds": m.avg_watch_seconds,
                "captured_at": m.captured_at.isoformat() if m.captured_at else None,
            }
            for m in metrics
        ]
    }


@router.get("/project-metrics")
def project_metrics(project_id: int, db: Session = Depends(get_db)):
    """项目级指标聚合：10 项指标卡。"""
    ms = (
        db.query(Metric)
        .filter(Metric.project_id == project_id)
        .order_by(Metric.captured_at.desc())
        .all()
    )
    if not ms:
        return {"project_id": project_id, "metrics": None}
    # 取最新一次采集（按 item 去重后取最新），再聚合
    latest_by_item: dict = {}
    for m in ms:
        if m.item_id not in latest_by_item:
            latest_by_item[m.item_id] = m
    agg = latest_by_item.values()
    views = sum(m.views or 0 for m in agg)
    likes = sum(m.likes or 0 for m in agg)
    comments = sum(m.comments or 0 for m in agg)
    shares = sum(m.shares or 0 for m in agg)
    favorites = sum(m.favorites or 0 for m in agg)
    followers_gained = sum(m.followers_gained or 0 for m in agg)
    completion = sum((m.completion_rate or 0) for m in agg) / len(agg) if agg else 0
    retention5 = sum((m.retention_5s or 0) for m in agg) / len(agg) if agg else 0
    ctr = sum((m.cover_ctr or 0) for m in agg) / len(agg) if agg else 0
    avg_watch = sum((m.avg_watch_seconds or 0) for m in agg) / len(agg) if agg else 0
    return {
        "project_id": project_id,
        "metrics": {
            "views": views,
            "likes": likes,
            "comments": comments,
            "shares": shares,
            "favorites": favorites,
            "followers_gained": followers_gained,
            "completion_rate": round(completion, 2),
            "retention_5s": round(retention5, 2),
            "cover_ctr": round(ctr, 2),
            "avg_watch_seconds": round(avg_watch, 1),
            "like_rate": round(likes / views * 100, 2) if views else 0,
            "comment_rate": round(comments / views * 100, 2) if views else 0,
            "share_rate": round(shares / views * 100, 2) if views else 0,
            "favorite_rate": round(favorites / views * 100, 2) if views else 0,
            "items": len(agg),
        },
    }


@router.get("/export")
def export_report(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """导出复盘报告（Markdown）：指标汇总 + 预测 vs 实际 + 公式 + 复盘摘要。"""
    metrics = _metrics_of(db, None, accounts_svc.resolve_account(db, account_id))
    formulas = db.query(Formula).filter(Formula.status == "adopted", Formula.account_id == accounts_svc.resolve_account(db, account_id)).all()
    predictions = db.query(Prediction).filter(Prediction.account_id == accounts_svc.resolve_account(db, account_id)).order_by(Prediction.created_at.desc()).first()
    lines = ["# CreatorOS 复盘报告", ""]
    lines.append(f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    lines.append("## 指标总览（抖音真实数据）")
    if metrics:
        tv = sum(m.views for m in metrics)
        tl = sum(m.likes for m in metrics)
        tc = sum(m.comments for m in metrics)
        lines.append(f"- 作品数：{len(metrics)}")
        lines.append(f"- 总播放：{tv:,.0f} / 总点赞：{tl:,.0f} / 总评论：{tc:,.0f}")
        best = max(metrics, key=lambda m: m.views)
        lines.append(f"- 最高播放作品：{best.item_id}（{best.views:,.0f} 播放）")
    else:
        lines.append("- （暂无指标，先拉取平台数据）")
    lines.append("")
    lines.append("## 预测 vs 实际")
    if predictions:
        lines.append(f"- AI 预测播放：{predictions.predicted_views:,.0f} / 预测完播：{predictions.predicted_completion:.0%}")
        lines.append(f"- 预测理由：{predictions.reasoning}")
    else:
        lines.append("- （暂无预测记录）")
    lines.append("")
    lines.append("## 已采纳公式")
    if formulas:
        for f in formulas:
            lines.append(f"- **{f.title}**（{f.dimension}，置信 {f.confidence:.0%}）")
            lines.append(f"  - {f.content}")
    else:
        lines.append("- （暂无）")
    lines.append("")
    lines.append("> 由 CreatorOS 自动生成")
    return {"report": "\n".join(lines)}


@router.get("/predictions")
def list_predictions(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """发布前 AI 预测 vs 实际表现（校准飞轮数据）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    preds = (
        db.query(Prediction)
        .filter(Prediction.account_id == aid)
        .order_by(Prediction.created_at.desc())
        .limit(10)
        .all()
    )
    out = []
    for p in preds:
        actual_views = None
        actual_count = 0
        q = db.query(Metric)
        if p.publication_id:
            q = q.filter(Metric.publication_id == p.publication_id)
        elif p.project_id:
            q = q.filter(Metric.project_id == p.project_id)
        ms = q.all()
        if ms:
            actual_views = sum((m.views or 0) for m in ms)
            actual_count = len(ms)
        out.append(
            {
                "id": p.id,
                "project_id": p.project_id,
                "publication_id": p.publication_id,
                "predicted_views": p.predicted_views,
                "predicted_completion": p.predicted_completion,
                "reasoning": p.reasoning,
                "actual_views": round(actual_views) if actual_views is not None else None,
                "actual_count": actual_count,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
        )
    return {"predictions": out}
