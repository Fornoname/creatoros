"""编导对话 API：会话管理 + LLM 对话（定位约束注入 + 上下文）。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Conversation, Knowledge, Message, Project, Topic
from ..schemas import ConversationCreate, MessageSend
from ..services import accounts as accounts_svc
from ..services import assistant as assistant_svc
from ..services.ark import ArkError

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _context_info(db: Session, context_type: str, context_id: int | None) -> str:
    if context_type == "project" and context_id:
        p = db.get(Project, context_id)
        if p:
            topic = db.get(Topic, p.topic_id) if p.topic_id else None
            t = f"（选题：{topic.title}；受众：{topic.audience or '—'}；痛点：{topic.pain_point or '—'}）" if topic else ""
            return f"当前项目：{p.title}（状态 {p.status}）{t}"
    if context_type == "topic" and context_id:
        t = db.get(Topic, context_id)
        if t:
            return f"当前选题：{t.title}（受众：{t.audience or '—'}；核心决定：{t.core_decision or '—'}；Hook：{t.hook or '—'}）"
    return ""


@router.post("")
def create_conversation(payload: ConversationCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    c = Conversation(
        account_id=accounts_svc.resolve_account(db, account_id),
        context_type=payload.context_type,
        context_id=payload.context_id,
        title=payload.title or "新对话",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"conversation": {"id": c.id, "title": c.title, "context_type": c.context_type}}


@router.get("")
def list_conversations(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    items = db.query(Conversation).filter(Conversation.account_id == aid).order_by(Conversation.created_at.desc()).limit(20).all()
    return {
        "conversations": [
            {"id": c.id, "title": c.title, "context_type": c.context_type, "context_id": c.context_id}
            for c in items
        ]
    }


@router.get("/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    c = db.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(status_code=404, detail="会话不存在")
    msgs = db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.id).all()
    return {
        "conversation": {
            "id": c.id,
            "title": c.title,
            "context_type": c.context_type,
            "context_id": c.context_id,
        },
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat() if m.created_at else None}
            for m in msgs
        ],
    }


@router.post("/{conversation_id}/messages")
async def send_message(conversation_id: int, payload: MessageSend, db: Session = Depends(get_db)):
    c = db.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(status_code=404, detail="会话不存在")
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    db.add(Message(conversation_id=conversation_id, role="user", content=payload.content))
    db.commit()

    position_text = assistant_svc.load_position_text(db, c.account_id)
    context_info = _context_info(db, c.context_type, c.context_id)
    # 注入账号专属上下文：历史作品（知识资产）与近期作品标题
    aid = c.account_id or accounts_svc.resolve_account(db)
    kn = (
        db.query(Knowledge)
        .filter(Knowledge.account_id == aid)
        .order_by(Knowledge.id.desc())
        .limit(6)
        .all()
    )
    if kn:
        account_knowledge = "\n".join(
            f"- {k.title}：{(k.content or '')[:80]}" for k in kn if k.title
        )
        context_info = (context_info or "") + "\n\n=== 账号历史作品与沉淀知识（创作参考） ===\n" + account_knowledge
    from ..models import Metric
    recent_metrics = (
        db.query(Metric)
        .filter(Metric.account_id == aid)
        .order_by(Metric.created_at.desc())
        .limit(5)
        .all()
    )
    if recent_metrics:
        lines = []
        for m in recent_metrics:
            item = m.raw or {}
            title = (item.get("title") or item.get("desc") or "")[:40]
            lines.append(
                f"- {title or ('作品 ' + str(m.item_id))}：播放 {m.views:.0f} / 点赞 {m.likes:.0f} / 评论 {m.comments:.0f} / 分享 {m.shares:.0f}"
            )
        context_info = (context_info or "") + "\n\n=== 账号近期作品指标（真实，供参考，勿编造未拉取数据） ===\n" + "\n".join(lines)
    history = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.role != "tool")
        .order_by(Message.id)
        .all()
    )
    # 保留最近 12 条作为上下文
    recent = history[-12:]
    messages = [{"role": "system", "content": assistant_svc.build_system_prompt(position_text, context_info)}]
    messages += [{"role": m.role, "content": m.content} for m in recent]

    try:
        reply = await assistant_svc.chat(messages, model=settings.ark_model_pro)
    except ArkError as e:
        db.add(Message(conversation_id=conversation_id, role="assistant", content=f"（调用失败：{e}）"))
        db.commit()
        raise HTTPException(status_code=502, detail=str(e))

    db.add(Message(conversation_id=conversation_id, role="assistant", content=reply))
    db.commit()
    return {"reply": reply}
