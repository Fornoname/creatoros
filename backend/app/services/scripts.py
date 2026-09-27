"""项目编辑器服务：论点骨架、脚本生成。"""
from ..config import settings
from ..models import Project, Topic
from .ark import chat_json

async def build_skeleton(project: Project, materials_text: str, position_text: str, knowledge: str = "", formulas_text: str = "") -> dict:
    """生成论点骨架：核心论点 + 支撑论据 + 反驳 + 反差，并挂素材。
    knowledge：向量检索注入的相关知识（RAG，阶段 26）；formulas_text：已采纳复盘公式（阶段 29 回流）。"""
    topic = None
    if project.topic_id:
        topic = db_get_topic(project)  # 由路由传入 topic
    topic_text = ""
    if topic:
        topic_text = (
            f"选题：{topic.title}\n受众：{topic.audience or ''}\n痛点：{topic.pain_point or ''}\n"
            f"核心决定：{topic.core_decision or ''}\nHook：{topic.hook or ''}"
        )
    knowledge_block = ""
    if knowledge.strip():
        knowledge_block = f"""
知识库相关资料（写稿时可引用这些资料增强说服力）：
{knowledge}"""
    formulas_block = ""
    if formulas_text.strip():
        formulas_block = f"""
复盘沉淀公式（必须遵守，来自你账号历史爆款/表现数据）：
{formulas_text}"""

    prompt = f"""你是短视频编导。为下面的选题搭建「论点骨架」，用于后续写脚本。
骨架要求：核心论点一句话立住；支撑论据 3-4 条（可结合素材）；反驳 1-2 条（预判反对声音并回应）；反差 1-2 条（制造认知冲突）；每条可挂素材编号。
{knowledge_block}
{formulas_block}

定位约束：
{position_text}

{topic_text}

弹药素材：
{materials_text or '（暂无素材）'}

输出 JSON：
{{
  "core": "核心论点（一句话）",
  "supports": [{{"point": "支撑论据", "material": "素材引用或留空"}}],
  "rebuttals": [{{"objection": "反对声音", "response": "回应"}}],
  "contrasts": ["反差/反常识点"]
}}"""
    return await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)

async def generate_script(skeleton: dict, position_text: str, duration_hint: str = "60-90秒", knowledge: str = "", formulas_text: str = "") -> str:
    """基于论点骨架生成短视频口播脚本（Hook → 论点展开 → CTA）。
    knowledge：向量检索注入的相关知识（RAG，阶段 26）；formulas_text：已采纳复盘公式（阶段 29 回流）。"""
    import json
    skeleton_text = json.dumps(skeleton, ensure_ascii=False, indent=1)
    knowledge_block = ""
    if knowledge.strip():
        knowledge_block = f"""
知识库相关资料（写稿时可引用增强说服力）：
{knowledge}"""
    formulas_block = ""
    if formulas_text.strip():
        formulas_block = f"""
复盘沉淀公式（必须遵守，来自你账号历史爆款/表现数据）：
{formulas_text}"""
    prompt = f"""基于论点骨架生成一条 {duration_hint} 的短视频口播脚本。
要求：
- 开口 3 秒用 Hook 抓住注意力
- 按骨架论点层层递进，口语化、有画面感
- 结尾自然 CTA（关注/评论/收藏引导）
- 直接输出脚本正文，不要解释
{knowledge_block}
{formulas_block}

定位约束：
{position_text}

论点骨架：
{skeleton_text}"""
    from .ark import chat
    return await chat([{"role": "user", "content": prompt}], model=settings.ark_model_pro)

def db_get_topic(project: Project):
    from ..database import SessionLocal
    if project.topic_id:
        db = SessionLocal()
        try:
            return db.get(Topic, project.topic_id)
        finally:
            db.close()
    return None
