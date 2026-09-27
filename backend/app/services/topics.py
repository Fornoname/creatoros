"""选题中心服务：AI 选题会、选题卡补全。"""
import json
from ..config import settings
from ..models import PositionMaster, Project, Topic
from .ark import chat_json

SIGNAL_LABELS = {
    "comment": "评论问题",
    "consultation": "客户咨询",
    "knowledge": "知识库资料",
    "viral": "历史爆款",
    "hotspot": "行业热点",
    "review": "项目复盘",
    "manual": "手动灵感",
}

MEETING_MODES = {
    "position": "基于定位出路",
    "comment": "基于评论问题",
    "knowledge": "基于知识库出路",
    "hotspot": "基于热点出路",
    "manual": "手动论智",
}

def _position_text_of(db, master_id: int | None) -> str:
    from .position import master_to_text
    if master_id:
        master = db.get(PositionMaster, master_id)  # type: ignore
        if master:
            return master_to_text(master)
    return "（尚未配置定位母版，按通用短视频内容创作者处理）"

def build_verified_signals(db, account_id: int, min_views: float = 10000, min_likes: float = 500) -> str:
    """反馈闭环：从已发布且有真实指标的项目聚合「已验证爆款特征」。

    判定：播放≥min_views 或 点赞≥min_likes 记为已验证爆款；有数据但未达标记为验证中。
    输出注入提示词的文本；无可用数据返回空串。
    """
    from ..models import Project

    projects = db.query(Project).filter(Project.account_id == account_id).all()
    viral, learning = [], []
    for p in projects:
        if not p.latest_metrics:
            continue
        try:
            m = json.loads(p.latest_metrics)
        except Exception:
            continue
        views = float(m.get("views") or m.get("play_count") or 0)
        likes = float(m.get("likes") or m.get("digg_count") or 0)
        if views <= 0 and likes <= 0:
            continue
        t = db.get(Topic, p.topic_id) if p.topic_id else None
        parts = [f"《{p.title[:36]}》播放 {views:.0f} / 赞 {likes:.0f}"]
        if t:
            if t.tag:
                parts.append(f"方向:{t.tag}")
            if t.form:
                parts.append(f"形式:{t.form}")
            if t.audience:
                parts.append(f"受众:{t.audience}")
            if t.hook:
                parts.append(f"Hook:{t.hook[:36]}")
            if t.core_decision:
                parts.append(f"主张:{t.core_decision[:30]}")
        line = "｜".join(parts)
        (viral if (views >= min_views or likes >= min_likes) else learning).append(line)
    blocks = []
    if viral:
        blocks.append("本账号已验证爆款作品特征（数据证明有效，新选题应优先延续这些方向/Hook/句式）：\n" + "\n".join(f"- {x}" for x in viral))
    if learning:
        blocks.append("本账号已发布但数据一般的作品（避免重蹈覆辙）：\n" + "\n".join(f"- {x}" for x in learning))
    return "\n\n".join(blocks)

async def ai_meeting(mode: str, signals: str, position_text: str, formulas: str = "", knowledge: str = "", verified: str = "", profile: str = "") -> list[dict]:
    """AI 选题会：按出路类型生成选题卡（含受众/形式/痛点/决定/Hook/难度）。
    formulas：已采纳的可复用公式（阶段 3 沉淀反哺）。
    knowledge：向量检索注入的相关知识条目（RAG，阶段 26）。
    verified：反馈闭环注入——本账号已验证爆款/一般作品特征（越用越懂账号）。
    profile：账号创作画像注入——本账号历史创作风格指纹（越用越懂账号）。"""
    formula_block = ""
    if formulas:
        formula_block = f"""
本账号已沉淀的可复用公式（选题必须体现这些公式）：
{formulas}"""
    knowledge_block = ""
    if knowledge.strip():
        knowledge_block = f"""
知识库相关资料（选题应尽量呼应/引用这些资料）：
{knowledge}"""
    verified_block = ""
    if verified.strip():
        verified_block = f"""
{verified}"""
    profile_block = ""
    if profile.strip():
        profile_block = f"""
{profile}"""
    prompt = f"""你是短视频编导，正在开选题会。依据以下约束与信号，产出 {MEETING_MODES.get(mode, '手动论智')} 方向的选题卡。
要求：选题要有观点、有反差或新角度，不写空泛话题；每个选题独立成卡。
{profile_block}
{formula_block}
{knowledge_block}
{verified_block}

定位约束：
{position_text}

信号素材：
{signals or '（无）'}

输出 JSON：{{"topics": [
  {{"title": "选题标题（含鲜明观点）", "audience": "目标受众", "form": "内容形式", "pain_point": "观点痛点", "core_decision": "核心决定/主张", "hook": "推荐Hook（前3秒钩子）", "material_count": 0, "difficulty": "low|medium|high"}}
]}} 最多 3 个，只给最有价值的。"""
    return (await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_lite, max_tokens=2048)).get("topics", [])

async def complete_topic(topic: Topic, position_text: str) -> dict:
    """AI 补全选题卡：完善受众/痛点/决定/Hook/形式/难度，并优化标题。"""
    prompt = f"""补全以下选题卡，使其达到可直接立项的完整度。
要求：观点明确、痛点真实、Hook 有悬念或反常识；难度按制作工作量判断。

定位约束：
{position_text}

当前选题卡：
{{
  "title": "{topic.title}",
  "source": "{SIGNAL_LABELS.get(topic.source, topic.source)}",
  "audience": "{topic.audience or ''}",
  "pain_point": "{topic.pain_point or ''}",
  "core_decision": "{topic.core_decision or ''}"
}}

输出 JSON（补齐所有字段，title 可优化）：
{{
  "title": "优化后的标题",
  "audience": "目标受众",
  "form": "内容形式",
  "pain_point": "观点痛点",
  "core_decision": "核心决定/主张",
  "hook": "推荐Hook",
  "difficulty": "low|medium|high"
}}"""
    return await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)
