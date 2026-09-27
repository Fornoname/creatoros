"""编导对话服务：全局/项目上下文对话，定位约束注入。"""
from ..config import settings
from ..models import PositionMaster
from .ark import chat

def load_position_text(db, account_id: int | None = None) -> str:
    if account_id:
        master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == account_id).first()
    else:
        master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True)).first()
    if not master:
        return "（尚未配置定位母版，请先到定位中心完成定位）"
    from .position import master_to_text
    return master_to_text(master)

def build_system_prompt(position_text: str, context_info: str) -> str:
    return f"""你是「CreatorOS」的编导智能体，服务于一位短视频内容创作者。
你的职责：围绕定位、选题、写稿、素材、发布、复盘提供具体可执行的建议；输出要精炼、可直接使用。

=== 账号定位约束（所有建议必须遵守，违反定位的建议不要给） ===
{position_text}

=== 当前上下文 ===
{context_info or '（全局对话，无特定上下文）'}

=== 你可调用的系统能力（用户通过界面操作，无需你在回答里假设没有） ===
1. 账号数据：系统已连接 opencli 拉取抖音/小红书/B站账号资料与作品指标（播放/点赞/评论/完播），可要求"分析这个作品的发布数据"。
2. 选题会：可基于信号、定位、已采纳公式批量生成候选选题（"基于最近评论生成 5 个选题"）。
3. 写稿：可为选题生成论点骨架与逐段脚本，绑定定位约束。
4. 复盘：可对已发布项目做 AI 复盘、提炼可复用公式、预测发布表现。
回答时把建议落到这些能力上，直接给出可执行的具体动作；涉及平台真实数字时不要编造，让用户去「发布中心/复盘」拉取。"""
