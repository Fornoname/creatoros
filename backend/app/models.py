"""CreatorOS 核心数据模型：定位母版 → 选题卡 → 项目 → 论点骨架 → 发布 → 复盘全链路。"""
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- 账号体系 ----------

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), default="yueming")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Account(Base):
    """绑定的平台账号（douyin / tiktok / xiaohongshu / weibo / channels / bilibili …）"""
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    platform: Mapped[str] = mapped_column(String(32), index=True)   # douyin / xiaohongshu / ...
    display_name: Mapped[str] = mapped_column(String(128), default="")
    username: Mapped[str] = mapped_column(String(128), default="")
    uid: Mapped[str] = mapped_column(String(64), default="")        # 平台账号 id
    follower_count: Mapped[int] = mapped_column(Integer, default=0)
    video_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active / inactive
    profile_path: Mapped[str] = mapped_column(String(256), default="")      # 独立浏览器环境目录（auth/douyin/<账号>）
    profile_status: Mapped[str] = mapped_column(String(16), default="unbound")  # unbound / pending / scanning / bound / failed
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    profile: Mapped[str] = mapped_column(Text, default="")  # 动态创作画像 JSON（自动聚合+用户编辑，AI 出题注入）
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 定位中心 ----------

class PositionMaster(Base):
    """定位母版：账号人格的约束源，下游所有 AI 决策以它为强约束。"""
    __tablename__ = "position_masters"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)          # v1 / v2 …
    name: Mapped[str] = mapped_column(String(64), default="定位母版")
    one_line: Mapped[str] = mapped_column(Text, default="")           # 一句话定位
    content_scope: Mapped[str] = mapped_column(Text, default="")      # 内容范围
    core_mentality: Mapped[str] = mapped_column(Text, default="")     # 核心心法
    audience: Mapped[str] = mapped_column(Text, default="")           # 目标人群
    style: Mapped[str] = mapped_column(Text, default="")              # 表达风格
    not_do: Mapped[str] = mapped_column(Text, default="")             # 不做什么
    taboos: Mapped[str] = mapped_column(Text, default="")             # 核心禁忌
    capability_boundary: Mapped[str] = mapped_column(Text, default="")  # 能力边界
    core_value: Mapped[str] = mapped_column(Text, default="")           # 核心价值（详述）
    differentiation: Mapped[str] = mapped_column(Text, default="")      # 差异化话术
    capabilities: Mapped[str] = mapped_column(Text, default="")         # 能力清单（JSON 数组字符串）
    project_plan: Mapped[str] = mapped_column(Text, default="")         # 项目规划
    style_rules: Mapped[str] = mapped_column(Text, default="")          # 表达风格规则
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    rules: Mapped[list["PositionRule"]] = relationship(back_populates="master", cascade="all, delete-orphan")


class PositionRule(Base):
    """定位规则：选题规划 / 审稿规则 / 项目规划 / 禁止事项。"""
    __tablename__ = "position_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    master_id: Mapped[int] = mapped_column(ForeignKey("position_masters.id"))
    rule_type: Mapped[str] = mapped_column(String(32), index=True)    # topic_planning / review / project / forbidden
    content: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    master: Mapped[PositionMaster] = relationship(back_populates="rules")


# ---------- 选题中心 ----------

class Topic(Base):
    """选题卡：信号 → 补全 → 立项。状态机：candidate → pending_review → approved(projected) / discarded。"""
    __tablename__ = "topics"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    latest_metrics: Mapped[str] = mapped_column(Text, default="")  # 发布后真实指标快照 JSON（回填）
    title: Mapped[str] = mapped_column(String(256), index=True)       # 选题标题/观点
    source: Mapped[str] = mapped_column(String(32), default="manual") # comment / consultation / knowledge / viral / hotspot / review / manual
    audience: Mapped[str] = mapped_column(Text, default="")           # 目标受众
    form: Mapped[str] = mapped_column(String(128), default="")        # 内容形式（口播/图文/混剪…）
    pain_point: Mapped[str] = mapped_column(Text, default="")         # 观点痛点
    core_decision: Mapped[str] = mapped_column(Text, default="")      # 核心决定
    hook: Mapped[str] = mapped_column(Text, default="")               # 推荐 Hook
    material_count: Mapped[int] = mapped_column(Integer, default=0)
    difficulty: Mapped[str] = mapped_column(String(16), default="low")  # low / medium / high
    tag: Mapped[str] = mapped_column(String(64), default="", index=True)  # 标签（对标/候选池/…）
    status: Mapped[str] = mapped_column(String(24), default="candidate", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ---------- 项目与脚本 ----------

class Project(Base):
    """立项后的创作项目，关联选题。"""
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    latest_metrics: Mapped[str] = mapped_column(Text, default="")  # 发布后真实指标快照 JSON（回填）
    topic_id: Mapped[int | None] = mapped_column(ForeignKey("topics.id"))
    title: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(24), default="preparing", index=True)  # preparing / scripting / producing / published / reviewing
    progress: Mapped[str] = mapped_column(String(256), default="选题已定，准备备料")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    target_platform: Mapped[str] = mapped_column(String(64), default="douyin")
    publish_schedule: Mapped[str] = mapped_column(String(128), default="")
    worth_audience: Mapped[str] = mapped_column(Text, default="")    # 「这条为什么值得做」给谁看
    worth_outcome: Mapped[str] = mapped_column(Text, default="")     # 希望带来什么
    worth_evidence: Mapped[str] = mapped_column(Text, default="")    # 依据与缺口
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    scripts: Mapped[list["Script"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Script(Base):
    """论点骨架 + 脚本稿。skeleton_json: {core, supports[], rebuttals[], contrasts[], materials[]}"""
    __tablename__ = "scripts"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    skeleton_json: Mapped[dict] = mapped_column(JSON, default=dict)
    script_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="skeleton")  # skeleton / script / done
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="scripts")


# ---------- 素材与知识库 ----------

class Material(Base):
    """素材：截图/视频/文档/链接。向量字段预留（阶段 2 启用多模态向量）。"""
    __tablename__ = "materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String(24), default="image")     # image / video / document / link / quote
    title: Mapped[str] = mapped_column(String(256), default="")
    content: Mapped[str] = mapped_column(Text, default="")             # 文字内容 / 摘录
    tags: Mapped[list] = mapped_column(JSON, default=list)
    source_url: Mapped[str] = mapped_column(Text, default="")
    local_path: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(String(256), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Knowledge(Base):
    """知识库条目：长期内容资产，向量检索。"""
    __tablename__ = "knowledge"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(256))
    content: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(32), default="manual")  # manual / web / video / comment
    source_url: Mapped[str] = mapped_column(String(1024), default="")  # 来源链接（溯源）
    tags: Mapped[list] = mapped_column(JSON, default=list)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 发布与数据 ----------

class Publication(Base):
    """发布记录：平台/链接/定时状态。"""
    __tablename__ = "publications"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    platform: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(256), default="")         # 作品标题
    cover_url: Mapped[str] = mapped_column(Text, default="")            # 作品封面
    item_id: Mapped[str] = mapped_column(String(128), default="")       # 平台作品 ID
    url: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[dict] = mapped_column(JSON, default=dict)                # 平台原始数据
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)  # draft / scheduled / published / failed
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Metric(Base):
    """指标快照：播放/点赞/评论/分享/收藏/涨粉/完播/留存/封面点击。"""
    __tablename__ = "metrics"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    publication_id: Mapped[int | None] = mapped_column(ForeignKey("publications.id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    platform: Mapped[str] = mapped_column(String(32))
    item_id: Mapped[str] = mapped_column(String(128), default="")
    views: Mapped[float] = mapped_column(Float, default=0)
    likes: Mapped[float] = mapped_column(Float, default=0)
    comments: Mapped[float] = mapped_column(Float, default=0)
    shares: Mapped[float] = mapped_column(Float, default=0)
    favorites: Mapped[float] = mapped_column(Float, default=0)
    followers_gained: Mapped[float] = mapped_column(Float, default=0)
    deep: Mapped[dict] = mapped_column(JSON, default=dict)
    completion_rate: Mapped[float | None] = mapped_column(Float, nullable=True)   # 完播率 %
    retention_5s: Mapped[float | None] = mapped_column(Float, nullable=True)      # 5秒留存 %
    cover_ctr: Mapped[float | None] = mapped_column(Float, nullable=True)         # 封面点击率 %
    avg_watch_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Prediction(Base):
    """发布前预测：与真实指标对照，构成校准飞轮。"""
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    publication_id: Mapped[int | None] = mapped_column(ForeignKey("publications.id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    predicted_views: Mapped[float] = mapped_column(Float, default=0)
    predicted_completion: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Formula(Base):
    """可复用公式：复盘正向归因沉淀，反向约束选题/脚本。"""
    __tablename__ = "formulas"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(256))
    content: Mapped[str] = mapped_column(Text)                        # 公式描述
    dimension: Mapped[str] = mapped_column(String(24), default="hook")  # hook / structure / cta / topic …
    evidence: Mapped[str] = mapped_column(Text, default="")           # 证据（关联的作品/指标）
    confidence: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(16), default="candidate", index=True)  # candidate / adopted / rejected
    usage_count: Mapped[int] = mapped_column(Integer, default=0)  # 被选题/脚本生成引用次数（引用追踪）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 编导对话 ----------

class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(256), default="新对话")
    context_type: Mapped[str] = mapped_column(String(24), default="global")  # global / topic / project / review
    context_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    role: Mapped[str] = mapped_column(String(16))                      # user / assistant / tool
    content: Mapped[str] = mapped_column(Text)
    tool_calls: Mapped[list] = mapped_column(JSON, default=list)       # 工具调用轨迹
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


# ---------- 审计（审稿/打标/扣分） ----------

class AuditLog(Base):
    """审稿、打标、Capital 扣分记录。"""
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    target_type: Mapped[str] = mapped_column(String(24))               # topic / script / project
    target_id: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(24), default="review")  # review / label / capital_deduction
    rule_type: Mapped[str] = mapped_column(String(32), default="")
    passed: Mapped[bool] = mapped_column(Boolean, default=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    capital: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 自动化（阶段 4） ----------

class AutomationRule(Base):
    """自动化规则：定时任务 + 条件触发（条件→动作）。

    对标 CreatorOS 自动化任务：任务 = 类型 + 账号 + 执行计划（cron）+ 状态(含原因)。
    - task_type: works_sync / flow_sync / comments_sync / radar_sync / daily_topics / content_backfill
    - cron: 标准 5 段 cron 表达式；schedule_text 人类可读（"每2小时·15分·北京时间"）
    - backfill_text: 数据时效分级回补说明（近7天2h / 7-30天6h / 30天+每天）
    - disabled_reason: 未启用原因（如"先去设置配对文本模型"）
    """
    __tablename__ = "automation_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    rule_type: Mapped[str] = mapped_column(String(24), default="schedule")  # schedule / trigger
    schedule: Mapped[str] = mapped_column(String(64), default="daily")      # daily / hourly / interval
    interval_minutes: Mapped[int] = mapped_column(Integer, default=1440)
    cron: Mapped[str] = mapped_column(String(64), default="")               # cron 表达式（如 "15 */2 * * *"）
    schedule_text: Mapped[str] = mapped_column(String(128), default="")     # 人类可读执行计划
    timezone: Mapped[str] = mapped_column(String(32), default="Asia/Shanghai")
    task_type: Mapped[str] = mapped_column(String(32), default="")          # works/flow/comments/radar/topics/backfill
    sub_label: Mapped[str] = mapped_column(String(64), default="")          # 子类目（流量来源/作品数据/…）
    backfill_text: Mapped[str] = mapped_column(String(255), default="")     # 分级回补说明
    disabled_reason: Mapped[str] = mapped_column(String(255), default="")   # 未启用原因
    condition: Mapped[str] = mapped_column(Text, default="")                # 触发条件描述（trigger）
    action: Mapped[str] = mapped_column(String(64), default="")             # pull_metrics / generate_topics / …
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 时序快照（阶段 6 趋势图） ----------

class DailySnapshot(Base):
    """账号每日数据快照：趋势图数据源，同步/拉取时写入当日聚合。"""
    __tablename__ = "daily_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    views: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    shares: Mapped[int] = mapped_column(Integer, default=0)
    favorites: Mapped[int] = mapped_column(Integer, default=0)
    followers: Mapped[int] = mapped_column(Integer, default=0)
    works: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 内容雷达（阶段 8：真实信源工作台） ----------

class RadarCategory(Base):
    """内容雷达自定义分类：独立登记分类名（来源按名称归类），对标「新建分类」。"""
    __tablename__ = "radar_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SourceAccount(Base):
    """内容雷达信源博主：订阅外部博主，同步其公开作品。"""
    __tablename__ = "radar_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    sec_uid: Mapped[str] = mapped_column(String(64), default="")
    avatar: Mapped[str] = mapped_column(String(512), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(64), default="")
    sync_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending / synced / error
    auto_sync: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RadarContent(Base):
    """内容雷达采集内容：外部博主公开作品，可转逐字稿、升级为项目。"""
    __tablename__ = "radar_contents"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    author: Mapped[str] = mapped_column(String(128), default="")
    aweme_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    title: Mapped[str] = mapped_column(String(512), default="")
    desc: Mapped[str] = mapped_column(Text, default="")
    cover_url: Mapped[str] = mapped_column(String(1024), default="")
    video_url: Mapped[str] = mapped_column(String(1024), default="")
    source_url: Mapped[str] = mapped_column(String(1024), default="")
    play_count: Mapped[int] = mapped_column(Integer, default=0)
    digg_count: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    share_count: Mapped[int] = mapped_column(Integer, default=0)
    collect_count: Mapped[int] = mapped_column(Integer, default=0)
    transcript: Mapped[str] = mapped_column(Text, default="")
    transcript_ai: Mapped[str] = mapped_column(Text, default="")  # AI 改写稿（基于原字幕）
    transcript_kind: Mapped[str] = mapped_column(String(16), default="ai")  # ai=AI草稿 original=原字幕提取
    transcript_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending / ready / empty
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    knowledge_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 已入库知识库条目
    status: Mapped[str] = mapped_column(String(16), default="collected")  # collected / upgraded
    publish_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 作品发布时间（opencli create_time）
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RadarSnapshot(Base):
    """雷达内容每日数据快照：单条对标作品的历史指标趋势，同步时幂等写入当日。"""
    __tablename__ = "radar_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    content_id: Mapped[int] = mapped_column(Integer, index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    play_count: Mapped[int] = mapped_column(Integer, default=0)
    digg_count: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    collect_count: Mapped[int] = mapped_column(Integer, default=0)
    share_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 运营分析（阶段 9：观众来源 + 深层指标） ----------

class AudienceSource(Base):
    """作品观众来源分布（推荐/朋友/关注/主页/搜索/其他，百分比）。"""
    __tablename__ = "audience_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    publication_id: Mapped[int | None] = mapped_column(ForeignKey("publications.id"))
    item_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    recommend: Mapped[float] = mapped_column(Float, default=0)
    friends: Mapped[float] = mapped_column(Float, default=0)
    follow: Mapped[float] = mapped_column(Float, default=0)
    homepage: Mapped[float] = mapped_column(Float, default=0)
    search: Mapped[float] = mapped_column(Float, default=0)
    other: Mapped[float] = mapped_column(Float, default=0)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual / stats
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- 系统告警（阶段：同步失败通知） ----------

class Alert(Base):
    """系统告警：同步失败、任务异常等，前端铃铛展示。"""
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(16), default="warning")  # info / warning / error
    title: Mapped[str] = mapped_column(String(256), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(32), default="")  # radar_sync / auto_task / publish ...
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
