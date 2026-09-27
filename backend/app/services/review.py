"""复盘飞轮服务：发布前预测、发布后 AI 复盘、可复用公式提炼。"""
from ..config import settings
from ..models import Project
from .ark import chat_json

async def predict_performance(project: Project, position_text: str, script_text: str = "") -> dict:
    """发布前预测：预估播放量级、完播率与理由，构成校准飞轮。"""
    prompt = f"""你是短视频数据顾问。基于选题与脚本，预测这条内容发布后的表现。
要求：结合同类账号经验给出合理区间；理由要具体（Hook/结构/选题角度）。

定位约束：
{position_text}

选题：{project.title}
脚本：
{script_text or '（尚未生成脚本，按选题判断）'}

输出 JSON：
{{
  "predicted_views": 8000,
  "predicted_completion": 0.35,
  "reasoning": "预测理由（100字内，说明 Hook 吸引力、选题普适性、结构节奏）"
}}
播放量给出期望值（非区间数字），完播率为 0-1 小数。"""
    return await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)

async def review_project(project: Project, metrics_text: str, comments_text: str, position_text: str) -> dict:
    """AI 复盘：综合指标与评论做归因，产出可采纳沉淀。"""
    prompt = f"""你是短视频复盘教练。基于以下数据为作品做深度复盘，输出可直接执行的改进与可复用沉淀。

定位约束：
{position_text}

作品：{project.title}

指标数据：
{metrics_text or '（暂无指标，按缺失说明）'}

评论区反馈：
{comments_text or '（暂无评论样本）'}

输出 JSON：
{{
  "summary": "整体复盘结论（150字内）",
  "strengths": ["表现好的方面及原因"],
  "weaknesses": ["表现差的方面及原因"],
  "actions": ["下一条内容的具体改进动作"],
  "adoptable": ["本期可采纳沉淀为公式的要点（每条一句话，可执行）"]
}}"""
    return await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)

async def generate_formula_candidates(reviews_summary: str, top_videos: str, position_text: str) -> list[dict]:
    """从复盘结论与爆款数据提炼「可复用公式」候选（带证据）。"""
    prompt = f"""你是内容方法论研究员。从以下复盘与表现数据中提炼可复用的爆款公式候选。
每条公式必须：可执行、有证据支撑、能反哺选题/脚本决策。

定位约束：
{position_text}

复盘结论：
{reviews_summary or '（暂无）'}

近期表现较好的作品：
{top_videos or '（暂无）'}

输出 JSON：{{"formulas": [
  {{"title": "公式名（如：痛点前置+反差收尾）", "content": "公式说明与执行要点", "dimension": "hook|structure|cta|topic|format", "evidence": "证据（关联作品标题/指标）", "confidence": 0.85}}
]}} 最多 4 条，只提炼证据充分的。"""
    result = await chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)
    return result.get("formulas", [])
