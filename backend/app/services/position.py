"""定位中心服务：AI 访谈式定位、规则生成。"""
from ..config import settings
from ..models import PositionMaster, PositionRule
from .ark import chat_json


def master_to_text(m: PositionMaster) -> str:
    """把定位母版转成注入下游的约束文本。"""
    parts = [
        f"一句话定位：{m.one_line or '（未填）'}",
        f"内容范围：{m.content_scope or '（未填）'}",
        f"核心心法：{m.core_mentality or '（未填）'}",
        f"目标人群：{m.audience or '（未填）'}",
        f"表达风格：{m.style or '（未填）'}",
        f"不做什么：{m.not_do or '（未填）'}",
        f"核心禁忌：{m.taboos or '（未填）'}",
        f"能力边界：{m.capability_boundary or '（未填）'}",
        f"核心价值：{m.core_value or '（未填）'}",
        f"差异化话术：{m.differentiation or '（未填）'}",
        f"能力清单：{m.capabilities or '（未填）'}",
        f"项目规划：{m.project_plan or '（未填）'}",
        f"表达风格规则：{m.style_rules or '（未填）'}",
    ]
    rules = [r.content for r in m.rules if r.enabled]
    if rules:
        parts.append("定位规则：" + "；".join(rules))
    return "\n".join(parts)


async def interview_position(qa_pairs: list[dict]) -> dict:
    """基于访谈问答生成定位母版字段草案。qa_pairs: [{q, a}]"""
    conv = "\n".join(f"问：{p['q']}\n答：{p['a']}" for p in qa_pairs)
    prompt = f"""你是账号定位专家。根据以下 AI 访谈问答，为内容创作者提炼「定位母版」草案。
要求：具体、可执行、不空泛；语言精炼。

访谈记录：
{conv}

输出 JSON（只输出 JSON）：
{{
  "one_line": "一句话定位（10-20字，可执行）",
  "content_scope": "内容范围",
  "core_mentality": "核心心法（创作原则）",
  "audience": "目标人群画像",
  "style": "表达风格",
  "not_do": "不做什么（边界）",
  "taboos": "核心禁忌（绝对不能做）",
  "capability_boundary": "能力边界（当前不碰的领域）"
}}"""
    return await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)


async def generate_rules(master: PositionMaster) -> list[dict]:
    """从定位母版生成四类定位规则（选题规划/审稿规则/项目规划/禁止事项）。"""
    text = master_to_text(master)
    prompt = f"""根据定位母版，为 AI 编导系统生成「定位规则」，作为下游所有 AI 决策的强约束。
每条规则：具体、可判断（能据此打分/拦截）、一句一条。

定位母版：
{text}

输出 JSON：
{{
  "topic_planning": ["选题规划规则，3-5条"],
  "review": ["审稿规则，3-5条"],
  "project": ["项目规划规则，2-4条"],
  "forbidden": ["禁止事项，2-4条"]
}}"""
    return await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)
