"""自动化 API：规则 CRUD、手动触发、运行状态。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AutomationRule, AuditLog
from ..services import accounts as accounts_svc
from ..services import automation as auto_svc

router = APIRouter(prefix="/api/automation", tags=["automation"])


class RuleCreate(BaseModel):
    name: str
    rule_type: str = "schedule"   # schedule / trigger
    schedule: str = "daily"       # daily / hourly / interval
    interval_minutes: int = 1440
    cron: str = ""
    schedule_text: str = ""
    task_type: str = ""
    sub_label: str = ""
    backfill_text: str = ""
    condition: str = ""
    action: str = "pull_metrics"
    enabled: bool = True


class RuleUpdate(BaseModel):
    enabled: bool | None = None
    name: str | None = None
    interval_minutes: int | None = None
    cron: str | None = None
    schedule_text: str | None = None
    action: str | None = None


def _serialize(r: AutomationRule):
    return {
        "id": r.id,
        "account_id": r.account_id,
        "name": r.name,
        "rule_type": r.rule_type,
        "schedule": r.schedule,
        "interval_minutes": r.interval_minutes,
        "cron": r.cron,
        "schedule_text": r.schedule_text,
        "timezone": r.timezone,
        "task_type": r.task_type,
        "sub_label": r.sub_label,
        "backfill_text": r.backfill_text,
        "disabled_reason": r.disabled_reason,
        "condition": r.condition,
        "action": r.action,
        "action_desc": auto_svc.ACTION_DESCRIPTIONS.get(r.action, r.action),
        "enabled": r.enabled,
        "last_run": r.last_run.isoformat() if r.last_run else None,
        "next_run": r.next_run.isoformat() if r.next_run else None,
        "run_count": r.run_count,
        "error": r.error,
    }


@router.get("/rules")
def list_rules(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    from sqlalchemy import or_

    aid = accounts_svc.resolve_account(db, account_id)
    # 显示该账号规则 + 全局任务（account_id 为空 = 对所有账号生效）
    rules = (
        db.query(AutomationRule)
        .filter(or_(AutomationRule.account_id == aid, AutomationRule.account_id.is_(None)))
        .order_by(AutomationRule.id)
        .all()
    )
    return {
        "rules": [_serialize(r) for r in rules],
        "task_types": [
            {"type": t, "name": cfg["name"], "sub_label": cfg["sub_label"], "cron": cfg["cron"], "schedule_text": cfg["schedule_text"], "backfill_text": cfg["backfill_text"]}
            for t, cfg in auto_svc.TASK_TYPES.items()
        ],
    }


@router.post("/rules")
def create_rule(payload: RuleCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    r = AutomationRule(account_id=accounts_svc.resolve_account(db, account_id), **payload.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"rule": _serialize(r)}


@router.patch("/rules/{rid}")
def update_rule(rid: int, payload: RuleUpdate, db: Session = Depends(get_db)):
    r = db.get(AutomationRule, rid)
    if not r:
        raise HTTPException(status_code=404, detail="规则不存在")
    # 启用校验：AI 依赖任务需已配对文本模型
    if payload.enabled is True and r.task_type in ("daily_topics", "content_backfill"):
        from ..settings import settings

        if not settings.ark_api_key:
            raise HTTPException(status_code=400, detail="未配置文本模型（ARK_API_KEY），请先在设置中配对")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(r, k, v)
    if r.enabled:
        r.disabled_reason = ""
        r.next_run = auto_svc._compute_next_run(r, __import__("datetime").datetime.utcnow())
    else:
        r.next_run = None
    db.commit()
    db.refresh(r)
    return {"rule": _serialize(r)}


@router.delete("/rules/{rid}")
def delete_rule(rid: int, db: Session = Depends(get_db)):
    r = db.get(AutomationRule, rid)
    if not r:
        raise HTTPException(status_code=404, detail="规则不存在")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/rules/{rid}/run")
async def run_rule(rid: int, db: Session = Depends(get_db)):
    """手动触发一条规则立即执行（不等待调度）。"""
    r = db.get(AutomationRule, rid)
    if not r:
        raise HTTPException(status_code=404, detail="规则不存在")
    result = await auto_svc.execute_action(db, r.action)
    from datetime import datetime

    now = datetime.utcnow()
    r.last_run = now
    r.run_count += 1
    r.error = ""
    r.next_run = auto_svc._compute_next_run(r, now)
    db.commit()
    return {"rule": _serialize(r), "result": result}


@router.get("/events")
def list_events(db: Session = Depends(get_db)):
    """自动化事件日志（AuditLog 中由自动化产生的记录）。"""
    items = (
        db.query(AuditLog)
        .filter(AuditLog.rule_type.in_(["auto", "trigger"]))
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "events": [
            {
                "id": e.id,
                "target_type": e.target_type,
                "target_id": e.target_id,
                "action": e.action,
                "detail": e.detail,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in items
        ]
    }
