"""API 请求/响应 Schema。"""
from pydantic import BaseModel, Field


# ---------- 定位 ----------

class InterviewQA(BaseModel):
    q: str
    a: str


class InterviewRequest(BaseModel):
    qa_pairs: list[InterviewQA]


class RuleWrite(BaseModel):
    master_id: int | None = None
    rule_type: str | None = None
    content: str | None = None
    enabled: bool | None = None


class PositionWrite(BaseModel):
    name: str | None = None
    one_line: str = ""
    content_scope: str = ""
    core_mentality: str = ""
    audience: str = ""
    style: str = ""
    not_do: str = ""
    taboos: str = ""
    capability_boundary: str = ""
    core_value: str = ""
    differentiation: str = ""
    capabilities: str = ""
    project_plan: str = ""
    style_rules: str = ""


# ---------- 选题 ----------

class TopicCreate(BaseModel):
    title: str
    source: str = "manual"
    audience: str = ""
    pain_point: str = ""
    core_decision: str = ""
    hook: str = ""
    form: str = ""
    material_count: int = 0
    difficulty: str = "low"


class AIMeetingRequest(BaseModel):
    mode: str = "manual"          # position / comment / knowledge / hotspot / manual
    draft: bool = False            # True=预览不落库（逐条采纳用）
    signals: str = ""


# ---------- 项目 ----------

class ProjectUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    progress: str | None = None


class MaterialCreate(BaseModel):
    kind: str = "text"
    title: str = ""
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    source_url: str = ""


# ---------- 对话 ----------

class ConversationCreate(BaseModel):
    context_type: str = "global"   # global / topic / project / review
    context_id: int | None = None
    title: str | None = None


class MessageSend(BaseModel):
    content: str


# ---------- 知识库 ----------

class KnowledgeCreate(BaseModel):
    title: str
    content: str
    source: str = "manual"
    source_url: str = ""
    tags: list[str] = Field(default_factory=list)

class WorthWrite(BaseModel):
    """「这条为什么值得做」三卡更新。"""
    audience: str | None = None
    outcome: str | None = None
    evidence: str | None = None
