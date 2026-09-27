"""定位中心 API。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from sqlalchemy import func
from ..models import PositionMaster, PositionRule
from ..schemas import InterviewRequest, PositionWrite, RuleWrite
from ..services import accounts as accounts_svc
from ..services import position as position_svc

router = APIRouter(prefix="/api/position", tags=["position"])


def _serialize(master: PositionMaster):
    return {
        "id": master.id,
        "version": master.version,
        "name": master.name,
        "one_line": master.one_line,
        "content_scope": master.content_scope,
        "core_mentality": master.core_mentality,
        "audience": master.audience,
        "style": master.style,
        "not_do": master.not_do,
        "taboos": master.taboos,
        "capability_boundary": master.capability_boundary,
        "core_value": master.core_value,
        "differentiation": master.differentiation,
        "capabilities": master.capabilities,
        "project_plan": master.project_plan,
        "style_rules": master.style_rules,
        "is_active": master.is_active,
        "rules": [
            {"id": r.id, "rule_type": r.rule_type, "content": r.content, "enabled": r.enabled}
            for r in master.rules
        ],
    }


@router.get("/active")
def get_active(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == aid).first()
    if not master:
        return {"master": None}
    return {"master": _serialize(master)}


@router.post("")
def upsert_position(payload: PositionWrite, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == aid).first()
    if master:
        for field in ("name", "one_line", "content_scope", "core_mentality", "audience", "style", "not_do", "taboos", "capability_boundary", "core_value", "differentiation", "capabilities", "project_plan", "style_rules"):
            value = getattr(payload, field)
            if value is not None:
                setattr(master, field, value)
    else:
        master = PositionMaster(
            account_id=aid,
            one_line=payload.one_line,
            content_scope=payload.content_scope,
            core_mentality=payload.core_mentality,
            audience=payload.audience,
            style=payload.style,
            not_do=payload.not_do,
            taboos=payload.taboos,
            capability_boundary=payload.capability_boundary,
            core_value=payload.core_value,
            differentiation=payload.differentiation,
            capabilities=payload.capabilities,
            project_plan=payload.project_plan,
            style_rules=payload.style_rules,
        )
        if payload.name:
            master.name = payload.name
        db.add(master)
    db.commit()
    db.refresh(master)
    return {"master": _serialize(master)}


@router.post("/reposition")
def reposition(payload: PositionWrite, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """重新定位：把当前 active 版本置为历史，新建 version+1 并置为当前使用。"""
    aid = accounts_svc.resolve_account(db, account_id)
    db.query(PositionMaster).filter(
        PositionMaster.is_active.is_(True), PositionMaster.account_id == aid
    ).update({"is_active": False})
    max_ver = db.query(func.max(PositionMaster.version)).filter(PositionMaster.account_id == aid).scalar() or 0
    master = PositionMaster(
        account_id=aid,
        version=max_ver + 1,
        name=payload.name or "定位母版",
        one_line=payload.one_line,
        content_scope=payload.content_scope,
        core_mentality=payload.core_mentality,
        audience=payload.audience,
        style=payload.style,
        not_do=payload.not_do,
        taboos=payload.taboos,
        capability_boundary=payload.capability_boundary,
        core_value=payload.core_value,
        differentiation=payload.differentiation,
        capabilities=payload.capabilities,
        project_plan=payload.project_plan,
        style_rules=payload.style_rules,
        is_active=True,
    )
    db.add(master)
    db.commit()
    db.refresh(master)
    return {"master": _serialize(master), "repositioned": True}


@router.post("/interview")
async def interview(payload: InterviewRequest):
    """AI 访谈式定位：根据问答生成母版字段草案。"""
    qa = [{"q": p.q, "a": p.a} for p in payload.qa_pairs]
    if not qa:
        raise HTTPException(status_code=400, detail="至少提供一条访谈问答")
    draft = await position_svc.interview_position(qa)
    return {"draft": draft}


@router.get("/versions")
def list_versions(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """定位母版版本列表（历史版本管理）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    masters = (
        db.query(PositionMaster)
        .filter(PositionMaster.account_id == aid)
        .order_by(PositionMaster.version.desc())
        .all()
    )
    return {
        "versions": [
            {
                "id": m.id,
                "version": m.version,
                "name": m.name or f"v{m.version}",
                "one_line": m.one_line,
                "is_active": m.is_active,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in masters
        ]
    }


@router.post("/{master_id}/activate")
def activate_version(master_id: int, db: Session = Depends(get_db)):
    """回滚激活指定版本（同账号其他版本取消激活）。"""
    target = db.get(PositionMaster, master_id)
    if not target:
        raise HTTPException(status_code=404, detail="定位版本不存在")
    for other in (
        db.query(PositionMaster)
        .filter(PositionMaster.account_id == target.account_id, PositionMaster.is_active.is_(True))
        .all()
    ):
        if other.id != master_id:
            other.is_active = False
    target.is_active = True
    db.commit()
    return {"ok": True, "master": _serialize(target)}


@router.post("/{master_id}/rules")
async def generate_rules(master_id: int, db: Session = Depends(get_db)):
    master = db.get(PositionMaster, master_id)
    if not master:
        raise HTTPException(status_code=404, detail="定位母版不存在")
    result = await position_svc.generate_rules(master)
    # 重新生成：先清空该版本已有规则，避免重复累积
    db.query(PositionRule).filter(PositionRule.master_id == master.id).delete()
    mapping = {
        "topic_planning": "topic_planning",
        "review": "review",
        "project": "project",
        "forbidden": "forbidden",
    }
    for key, rule_type in mapping.items():
        for content in result.get(key, []):
            db.add(PositionRule(master_id=master.id, rule_type=rule_type, content=content))
    db.commit()
    db.refresh(master)
    return {"master": _serialize(master)}


@router.patch("/rules/{rule_id}")
def update_rule(rule_id: int, payload: RuleWrite, db: Session = Depends(get_db)):
    """修改定位规则：内容 / 类型 / 启停。"""
    rule = db.get(PositionRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    if payload.content is not None:
        rule.content = payload.content
    if payload.rule_type is not None:
        rule.rule_type = payload.rule_type
    if payload.enabled is not None:
        rule.enabled = payload.enabled
    db.commit()
    db.refresh(rule)
    return {"ok": True, "rule": {"id": rule.id, "rule_type": rule.rule_type, "content": rule.content, "enabled": rule.enabled}}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    """删除定位规则。"""
    rule = db.get(PositionRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@router.post("/rules")
def add_rule(payload: RuleWrite, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """手动新增定位规则。"""
    if not payload.master_id:
        raise HTTPException(status_code=400, detail="缺少 master_id")
    master = db.get(PositionMaster, payload.master_id)
    if not master:
        raise HTTPException(status_code=404, detail="定位母版不存在")
    rule = PositionRule(
        account_id=master.account_id,
        master_id=master.id,
        rule_type=payload.rule_type or "review",
        content=payload.content or "",
        enabled=True,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"ok": True, "rule": {"id": rule.id, "rule_type": rule.rule_type, "content": rule.content, "enabled": rule.enabled}}
