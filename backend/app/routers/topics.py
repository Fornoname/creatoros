"""选题中心 API。"""
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PositionMaster, Project, Topic
from ..schemas import AIMeetingRequest, TopicCreate
from ..services import accounts as accounts_svc
from ..services import topics as topics_svc

router = APIRouter(prefix="/api/topics", tags=["topics"])


def _serialize(t: Topic):
    _m = None
    if t.latest_metrics:
        try:
            _m = json.loads(t.latest_metrics)
        except Exception:
            _m = None
    return {
        "id": t.id,
        "title": t.title,
        "source": t.source,
        "audience": t.audience,
        "form": t.form,
        "pain_point": t.pain_point,
        "core_decision": t.core_decision,
        "hook": t.hook,
        "material_count": t.material_count,
        "difficulty": t.difficulty,
        "tag": t.tag,
        "status": t.status,
        "score": _score(t),
        "latest_metrics": _m,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


async def _inject_knowledge(db: Session, query: str) -> str:
    """RAG：向量检索知识库，返回最相关 3 条文本（无知识返回空）。"""
    from ..models import Knowledge
    from ..services import embedding as emb
    if not query.strip():
        return ""
    items = db.query(Knowledge).filter(Knowledge.embedding.isnot(None)).all()
    if not items:
        return ""
    try:
        qv = await emb.embed_text(query[:500])
    except Exception:
        return ""
    pool = [{"id": k.id, "label": k.title, "embedding": k.embedding} for k in items]
    ranked = emb.cosine_search(qv, pool, top_k=3)
    by_id = {k.id: k for k in items}
    lines = []
    for r in ranked:
        k = by_id.get(r.get("id"))
        if k:
            lines.append(f"- {k.title}：{k.content[:200]}")
    return "\n".join(lines)


def _score(t: Topic) -> int:
    """选题质量分（0-100）：Hook/痛点/受众/决策/素材/难度 加权推导。"""
    s = 40
    if t.hook and len(t.hook) >= 10:
        s += 15
    if t.pain_point:
        s += 15
    if t.audience:
        s += 10
    if t.core_decision:
        s += 10
    if (t.material_count or 0) >= 2:
        s += 5
    difficulty_bonus = {"easy": 3, "medium": 5, "hard": 7}.get(t.difficulty, 0)
    s += difficulty_bonus
    return max(0, min(100, s))


def _verified_count(verified_text: str) -> int:
    """统计已验证爆款特征条数（供前端标注「参考已验证爆款特征 N 条」）。"""
    if not verified_text:
        return 0
    n = 0
    for block in verified_text.split("\n\n"):
        if "已验证爆款" in block or "数据一般" in block:
            for line in block.splitlines():
                if line.startswith("- "):
                    n += 1
    return n


def _profile_count(profile_text: str) -> int:
    """统计画像特征条数（供前端标注「已参考该账号创作画像 N 项」）。"""
    if not profile_text:
        return 0
    n = 0
    for line in profile_text.splitlines():
        if line.startswith("- "):
            n += 1
    return n


def _active_position_text(db: Session, account_id: int | None = None) -> str:
    aid = accounts_svc.resolve_account(db, account_id)
    master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == aid).first()
    if master:
        from ..services.position import master_to_text
        return master_to_text(master)
    return "（尚未配置定位母版）"


@router.get("")
def list_topics(status: str | None = None, source: str | None = None, tag: str | None = None, search: str | None = None, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    q = db.query(Topic).filter(Topic.account_id == aid).order_by(Topic.created_at.desc())
    if status:
        q = q.filter(Topic.status == status)
    if source:
        q = q.filter(Topic.source == source)
    if tag:
        q = q.filter(Topic.tag == tag)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(Topic.title.like(like), Topic.pain_point.like(like), Topic.hook.like(like)))
    return {"topics": [_serialize(t) for t in q.all()]}


@router.get("/source-counts")
def topic_source_counts(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """选题来源计数（对标：评论问题 356 / 客户咨询 / 知识 / 历史爆款 / 手动灵感）。"""
    from sqlalchemy import func
    aid = accounts_svc.resolve_account(db, account_id)
    rows = (
        db.query(Topic.source, func.count(Topic.id))
        .filter(Topic.account_id == aid)
        .group_by(Topic.source)
        .all()
    )
    return {"counts": {k: c for k, c in rows}, "total": sum(c for _, c in rows)}


@router.get("/funnel")
def topic_funnel(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """选题漏斗：各状态计数（候选/已立项/合计）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    from sqlalchemy import func

    rows = (
        db.query(Topic.status, func.count(Topic.id))
        .filter(Topic.account_id == aid)
        .group_by(Topic.status)
        .all()
    )
    counts = {"candidate": 0, "approved": 0, "pending_review": 0, "discarded": 0}
    for st, n in rows:
        if st in counts:
            counts[st] = n
    return {"funnel": counts, "total": sum(counts.values())}


@router.post("")
def create_topic(payload: TopicCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    t = Topic(account_id=accounts_svc.resolve_account(db, account_id), **payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"topic": _serialize(t)}


@router.post("/ai-meeting")
async def ai_meeting(payload: AIMeetingRequest, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """AI 选题会：生成候选选题并入库（注入已采纳公式，阶段 3 沉淀反哺）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    position_text = _active_position_text(db, aid)
    from ..models import Formula

    adopted = db.query(Formula).filter(Formula.status == "adopted", Formula.account_id == aid).all()
    formulas_text = "\n".join(f"- {f.title}：{f.content}" for f in adopted) if adopted else ""
    if adopted and not payload.draft:
        for f in adopted:
            f.usage_count = (f.usage_count or 0) + 1
        db.commit()
    knowledge_text = await _inject_knowledge(db, f"{payload.mode} {payload.signals or ''}")
    verified_text = topics_svc.build_verified_signals(db, aid)
    from ..services.account_profile import get_profile_text
    profile_text = get_profile_text(db, aid)
    cards = await topics_svc.ai_meeting(payload.mode, payload.signals, position_text, formulas_text, knowledge_text, verified_text, profile_text)
    if payload.draft:
        # 预览模式：不落库，返回候选草稿供逐条采纳
        return {"drafts": cards, "mode": payload.mode, "verified_count": _verified_count(verified_text), "profile_count": _profile_count(profile_text)}
    created = []
    for c in cards:
        t = Topic(
            account_id=aid,
            title=c.get("title", ""),
            source="ai_meeting",
            audience=c.get("audience", ""),
            form=c.get("form", ""),
            pain_point=c.get("pain_point", ""),
            core_decision=c.get("core_decision", ""),
            hook=c.get("hook", ""),
            material_count=c.get("material_count", 0),
            difficulty=c.get("difficulty", "low"),
            status="candidate",
        )
        db.add(t)
        created.append(t)
    db.commit()
    for t in created:
        db.refresh(t)
    return {"topics": [_serialize(t) for t in created]}


@router.post("/adopt")
def adopt_topic(payload: dict, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """逐条采纳选题会草稿：整卡落库为候选。"""
    aid = accounts_svc.resolve_account(db, account_id)
    t = Topic(
        account_id=aid,
        title=payload.get("title", ""),
        source=payload.get("source", "ai_meeting"),
        audience=payload.get("audience", ""),
        form=payload.get("form", ""),
        pain_point=payload.get("pain_point", ""),
        core_decision=payload.get("core_decision", ""),
        hook=payload.get("hook", ""),
        material_count=int(payload.get("material_count", 0) or 0),
        difficulty=payload.get("difficulty", "low"),
        tag=payload.get("tag", "候选池"),
        status="candidate",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"topic": _serialize(t)}


@router.post("/{topic_id}/complete")
async def complete_topic(topic_id: int, db: Session = Depends(get_db)):
    """AI 补全选题卡。"""
    t = db.get(Topic, topic_id)
    if not t:
        raise HTTPException(status_code=404, detail="选题不存在")
    position_text = _active_position_text(db)
    filled = await topics_svc.complete_topic(t, position_text)
    t.title = filled.get("title", t.title)
    t.audience = filled.get("audience", t.audience)
    t.form = filled.get("form", t.form)
    t.pain_point = filled.get("pain_point", t.pain_point)
    t.core_decision = filled.get("core_decision", t.core_decision)
    t.hook = filled.get("hook", t.hook)
    t.difficulty = filled.get("difficulty", t.difficulty)
    t.status = "pending_review"
    db.commit()
    db.refresh(t)
    return {"topic": _serialize(t)}


@router.post("/{topic_id}/project")
def projectize(topic_id: int, db: Session = Depends(get_db)):
    """立项为项目。"""
    t = db.get(Topic, topic_id)
    if not t:
        raise HTTPException(status_code=404, detail="选题不存在")
    if t.status != "pending_review":
        raise HTTPException(status_code=400, detail="选题需先补全（pending_review）才能立项")
    p = Project(account_id=t.account_id, topic_id=t.id, title=t.title, status="preparing", progress="选题已定，准备备料")
    t.status = "approved"
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"project": {"id": p.id, "title": p.title, "status": p.status}}


@router.post("/{topic_id}/discard")
def discard(topic_id: int, db: Session = Depends(get_db)):
    t = db.get(Topic, topic_id)
    if not t:
        raise HTTPException(status_code=404, detail="选题不存在")
    t.status = "discarded"
    db.commit()
    return {"ok": True}
