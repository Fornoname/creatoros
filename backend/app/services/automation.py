"""自动化服务：定时任务引擎（对标 CreatorOS 自动化任务）+ 条件触发规则。

任务 = 类型(task_type) + 账号(account_id) + 执行计划(cron) + 状态(含原因)。
- cron 用 croniter 解析；next_run 由调度器回写
- 分级回补策略（backfill_text）：近7天每2小时 / 7-30天每6小时 / 30天以上每天
"""
import asyncio
import logging
from datetime import datetime, timedelta

from croniter import croniter
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import AutomationRule, Metric, Project, Topic
from . import publish as publish_svc

logger = logging.getLogger("creatoros.automation")

# 预设动作描述
ACTION_DESCRIPTIONS = {
    "pull_metrics": "拉取平台最新作品指标（作品数据同步）",
    "pull_flow": "同步作品与流量来源数据（近7天2h / 7-30天6h / 30天+每天）",
    "pull_comments": "同步作品评论统计（仅统计，不采集正文）",
    "generate_topics": "AI 生成一批选题进候选池（每日自动供给）",
    "review_reminder": "为久未复盘的项目生成复盘提醒",
    "mark_viral": "标记高播放作品为爆款",
    "sync_radar_sources": "自动同步对标博主内容并拆解（内容雷达自动同步）",
    "backfill_covers": "内容补全：为缺封面的项目批量生成封面",
}

# 任务类型注册表（对标 6 任务）：类型 → 默认配置
TASK_TYPES = {
    "works_sync": {
        "name": "作品数据同步",
        "sub_label": "作品数据",
        "action": "pull_metrics",
        "cron": "0 */2 * * *",
        "schedule_text": "每2小时·00分·北京时间",
        "backfill_text": "作品优先；成功同步后，近7天每2小时更新、7-30天每6小时、30天以上每天更新",
        "needs_ai": False,
    },
    "flow_sync": {
        "name": "作品流量来源同步",
        "sub_label": "流量来源",
        "action": "pull_flow",
        "cron": "15 */2 * * *",
        "schedule_text": "每2小时·15分·北京时间",
        "backfill_text": "流量其次；成功同步后，近7天每2小时更新、7-30天每6小时、30天以上每天更新",
        "needs_ai": False,
    },
    "comments_sync": {
        "name": "作品评论同步",
        "sub_label": "评论",
        "action": "pull_comments",
        "cron": "30 */2 * * *",
        "schedule_text": "每2小时·30分·北京时间",
        "backfill_text": "评论后台；成功同步后，近7天每2小时更新、7-30天每6小时、30天以上每天更新",
        "needs_ai": False,
    },
    "radar_sync": {
        "name": "内容雷达自动同步",
        "sub_label": "内容雷达",
        "action": "sync_radar_sources",
        "cron": "0 9 * * *",
        "schedule_text": "每天 09:00",
        "backfill_text": "",
        "needs_ai": False,
    },
    "daily_topics": {
        "name": "每日自动生成选题",
        "sub_label": "每日选题",
        "action": "generate_topics",
        "cron": "32 10 * * *",
        "schedule_text": "每天 10:32",
        "backfill_text": "",
        "needs_ai": True,
    },
    "content_backfill": {
        "name": "内容补全",
        "sub_label": "补全",
        "action": "backfill_covers",
        "cron": "0 */1 * * *",
        "schedule_text": "每1小时·00分·北京时间",
        "backfill_text": "批处理：为缺封面项目批量生成封面",
        "needs_ai": True,
    },
}


async def execute_action(db: Session, action: str, account_id: int | None = None) -> str:
    """执行单个动作，返回结果描述。"""
    if action == "pull_metrics":
        try:
            videos = await publish_svc.list_videos("douyin", limit=10, account_id=account_id)
            saved = 0
            for v in videos:
                item_id = str(v.get("aweme_id", ""))
                if not item_id:
                    continue
                if db.query(Metric).filter(Metric.item_id == item_id, Metric.account_id == account_id).first():
                    continue
                db.add(
                    Metric(
                        platform="douyin",
                        account_id=account_id,
                        item_id=item_id,
                        views=float(v.get("play_count", 0) or 0),
                        likes=float(v.get("digg_count", 0) or 0),
                        comments=float(v.get("comment_count", 0) or 0),
                        shares=float(v.get("share_count", 0) or 0),
                        favorites=float(v.get("collect_count", 0) or 0),
                        raw=v,
                    )
                )
                saved += 1
            db.commit()
            return f"拉取 {len(videos)} 条作品，新增 {saved} 条指标"
        except Exception as e:
            return f"拉取失败：{e}"

    if action == "pull_flow":
        # 作品 + 流量来源：以作品数据为基础聚合（创作者中心流量来源明细待后续对接）
        try:
            videos = await publish_svc.list_videos("douyin", limit=10, account_id=account_id)
            saved = 0
            for v in videos:
                item_id = str(v.get("aweme_id", ""))
                if not item_id:
                    continue
                row = db.query(Metric).filter(Metric.item_id == item_id, Metric.account_id == account_id).first()
                data = dict(
                    platform="douyin",
                    account_id=account_id,
                    views=float(v.get("play_count", 0) or 0),
                    likes=float(v.get("digg_count", 0) or 0),
                    comments=float(v.get("comment_count", 0) or 0),
                    shares=float(v.get("share_count", 0) or 0),
                    favorites=float(v.get("collect_count", 0) or 0),
                    raw=v,
                )
                if row:
                    for k_, v_ in data.items():
                        setattr(row, k_, v_)
                else:
                    db.add(Metric(item_id=item_id, **data))
                saved += 1
            db.commit()
            return f"流量来源同步：拉取 {len(videos)} 条作品，更新 {saved} 条指标（流量来源明细随作品数据）"
        except Exception as e:
            return f"流量来源同步失败：{e}"

    if action == "pull_comments":
        # 评论统计同步（仅统计，不采集正文）
        try:
            videos = await publish_svc.list_videos("douyin", limit=10, account_id=account_id)
            updated = 0
            for v in videos:
                item_id = str(v.get("aweme_id", ""))
                if not item_id:
                    continue
                row = db.query(Metric).filter(Metric.item_id == item_id, Metric.account_id == account_id).first()
                cnt = float(v.get("comment_count", 0) or 0)
                if row:
                    row.comments = cnt
                    updated += 1
                else:
                    db.add(Metric(platform="douyin", item_id=item_id, comments=cnt, views=float(v.get("play_count", 0) or 0), likes=float(v.get("digg_count", 0) or 0), shares=float(v.get("share_count", 0) or 0), favorites=float(v.get("collect_count", 0) or 0), raw=v))
                    updated += 1
            db.commit()
            return f"评论统计同步：更新 {updated} 条作品评论数（仅统计）"
        except Exception as e:
            return f"评论统计同步失败：{e}"

    if action == "backfill_covers":
        # 内容补全：为缺封面项目批量生成封面（批处理，带进度）
        from ..services import cover as cover_svc

        pending = (
            db.query(Project)
            .filter((Project.cover.is_(None)) | (Project.cover == ""))
            .filter(Project.account_id == account_id)
            .order_by(Project.created_at.desc())
            .limit(5)
            .all()
        )
        done, failed = 0, 0
        for prj in pending:
            prompt = f"短视频封面：{prj.title or '创作者作品'}，竖版 9:16，简洁醒目"
            try:
                url = await cover_svc.generate_cover(prompt, size="768x1344")
                prj.cover = url
                done += 1
            except Exception as e:
                failed += 1
                logger.error("补全封面失败 project[%s]：%s", prj.id, e)
        db.commit()
        remain = len(pending) - done
        if remain:
            return f"已保存本批封面，剩余 {remain} 条等待"
        return f"内容补全完成：生成 {done} 张封面（失败 {failed}）"

    if action == "review_reminder":
        # 发布超过 2 天且未进入复盘的项目 → 生成提醒（写入待办：通过 AuditLog）
        from ..models import AuditLog

        remind = 0
        cutoff = datetime.utcnow() - timedelta(days=2)
        projects = db.query(Project).filter(Project.status.in_(["published", "reviewing"]), Project.account_id == account_id).all()
        for p in projects:
            exists = (
                db.query(AuditLog)
                .filter(AuditLog.target_type == "project", AuditLog.target_id == p.id, AuditLog.action == "review_reminder")
                .first()
            )
            if not exists:
                db.add(
                    AuditLog(
                        target_type="project",
                        target_id=p.id,
                        action="review_reminder",
                        rule_type="auto",
                        passed=True,
                        detail="已发布，建议尽快复盘并沉淀公式",
                    )
                )
                remind += 1
        db.commit()
        return f"生成 {remind} 条复盘提醒"

    if action == "generate_topics":
        # 每日自动供给：从对标雷达最近内容提取真实信号 → 选题会 → 候选池（tag=自动供给）
        from ..services.topics import ai_meeting

        master_text = "（默认定位）"
        from ..models import PositionMaster

        master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == account_id).first()
        if master:
            from ..services.position import master_to_text

            master_text = master_to_text(master)
        formulas_text = ""
        from ..models import Formula

        fs = db.query(Formula).filter(Formula.status == "adopted", Formula.account_id == account_id).all()
        if fs:
            formulas_text = "\n".join(f"- {f.title}：{f.content}" for f in fs)
        # 真实信号：最近同步的对标内容标题
        from ..models import RadarContent

        recent = (
            db.query(RadarContent)
            .filter(RadarContent.title.isnot(None), RadarContent.account_id == account_id)
            .order_by(RadarContent.collected_at.desc())
            .limit(5)
            .all()
        )
        signals = "；".join(r.title for r in recent if r.title) if recent else "（无同步对标内容，按通用创作者出题）"
        cards = await ai_meeting("comment", f"以下是对标账号最近内容标题，从中提炼创作信号：{signals}", master_text, formulas_text)
        created = 0
        for c in cards:
            t = Topic(
                title=c.get("title", ""),
                source="ai_meeting",
                account_id=account_id,
                audience=c.get("audience", ""),
                form=c.get("form", ""),
                pain_point=c.get("pain_point", ""),
                core_decision=c.get("core_decision", ""),
                hook=c.get("hook", ""),
                material_count=c.get("material_count", 0),
                difficulty=c.get("difficulty", "low"),
                tag="自动供给",
                status="candidate",
            )
            db.add(t)
            created += 1
        db.commit()
        return f"生成 {created} 个选题候选（自动供给）"

    if action == "mark_viral":
        # 条件触发：播放 > 500 且未标记 → 标记爆款（写入 AuditLog）
        from ..models import AuditLog

        marked = 0
        for m in db.query(Metric).filter(Metric.views >= 500, Metric.account_id == account_id).all():
            exists = (
                db.query(AuditLog)
                .filter(AuditLog.target_type == "metric", AuditLog.target_id == m.id, AuditLog.action == "mark_viral")
                .first()
            )
            if not exists:
                db.add(
                    AuditLog(
                        target_type="metric",
                        target_id=m.id,
                        action="mark_viral",
                        rule_type="trigger",
                        passed=True,
                        detail=f"播放 {m.views:.0f}，标记为爆款候选",
                    )
                )
                marked += 1
        db.commit()
        return f"标记 {marked} 条爆款候选"

    if action == "sync_radar_sources":
        # 对标博主自动同步：遍历开启自动同步的信源 → 拉新内容 → 自动拆解（AI 逐字稿草稿）
        from ..models import SourceAccount
        from . import radar as radar_svc

        results = []
        sources = db.query(SourceAccount).filter(SourceAccount.auto_sync.is_(True)).all()
        for src in sources:
            try:
                r = radar_svc.sync_user_source(db, src.account_id, src.id)
                results.append(f"{src.name}：新增 {r['added']}（共 {r['total']}）")
            except Exception as e:
                results.append(f"{src.name}：{str(e)[:50]}")
                from ..services import alerts as alerts_svc

                alerts_svc.push_alert(
                    db,
                    src.account_id,
                    "warning",
                    f"自动同步失败：信源博主「{src.name}」",
                    str(e),
                    source_type="auto_radar_sync",
                    source_id=src.id,
                )
        try:
            done = await radar_svc.auto_breakdown(db, real_limit=2, draft_limit=3)
            results.append(f"自动拆解：原字幕 {done['real']} + 草稿 {done['draft']}")
        except Exception as e:
            results.append(f"拆解失败：{str(e)[:50]}")
        return "雷达同步：" + "；".join(results) if results else "雷达同步：无可同步信源"

    return f"未知动作：{action}"


def _to_cn(now: datetime) -> datetime:
    """把 naive UTC 时间转成规则时区（默认 Asia/Shanghai）的 aware 时间。"""
    try:
        from zoneinfo import ZoneInfo

        return now.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("Asia/Shanghai"))
    except Exception:
        return now


def _from_cn(cn_dt: datetime) -> datetime:
    """把 aware 时间转回 naive UTC 存储。"""
    try:
        from zoneinfo import ZoneInfo

        return cn_dt.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
    except Exception:
        return cn_dt.replace(tzinfo=None)


def _compute_next_run(rule: AutomationRule, now: datetime) -> datetime | None:
    """按 cron（Asia/Shanghai）计算下次执行；无 cron 时回退 interval_minutes。"""
    if rule.cron:
        try:
            nxt = croniter(rule.cron, _to_cn(now)).get_next(datetime)
            return _from_cn(nxt)
        except Exception:
            pass
    if rule.interval_minutes and rule.interval_minutes > 0:
        return now + timedelta(minutes=rule.interval_minutes)
    return None


def _due(rule: AutomationRule, now: datetime) -> bool:
    """到期判定：cron（Asia/Shanghai）语义（当前分钟命中）或 interval 到期。"""
    if rule.cron:
        try:
            it = croniter(rule.cron, _to_cn(now) - timedelta(minutes=1))
            return _from_cn(it.get_next(datetime)) <= now
        except Exception:
            return False
    if rule.last_run is None:
        return True
    last = rule.last_run.replace(tzinfo=None) if rule.last_run.tzinfo else rule.last_run
    return (now - last) >= timedelta(minutes=rule.interval_minutes)


async def run_scheduled_tasks() -> None:
    """后台调度循环：每 1 分钟检查一次到期规则（cron 精度到分钟）。"""
    logger.info("自动化调度已启动（cron 引擎）")
    while True:
        try:
            db: Session = SessionLocal()
            try:
                now = datetime.utcnow()
                rules = db.query(AutomationRule).filter(AutomationRule.enabled.is_(True)).all()
                for rule in rules:
                    if not _due(rule, now):
                        continue
                    try:
                        result = await execute_action(db, rule.action, rule.account_id)
                        rule.last_run = now
                        rule.run_count += 1
                        rule.error = ""
                        rule.next_run = _compute_next_run(rule, now)
                        db.commit()
                        logger.info("规则[%s] %s 执行：%s", rule.id, rule.name, result)
                    except Exception as e:
                        rule.error = str(e)[:200]
                        db.commit()
                        logger.error("规则[%s] 执行失败：%s", rule.id, e)
            finally:
                db.close()
        except Exception as e:
            logger.error("调度循环错误：%s", e)
        await asyncio.sleep(60)

def seed_default_rules(db: Session) -> None:
    """预置对标 6 任务（幂等：已存在同名任务则跳过；旧规则按 task_type 迁移）。"""
    # 旧规则 → 新任务类型映射
    legacy_map = {
        "每日数据拉取": "works_sync",
        "对标博主自动同步": "radar_sync",
        "选题自动供给": "daily_topics",
        "复盘提醒": "review_reminder",
        "爆款标记": "mark_viral",
    }
    for old_name, ttype in legacy_map.items():
        old_rule = db.query(AutomationRule).filter(AutomationRule.name == old_name).first()
        if old_rule and ttype in TASK_TYPES:
            cfg = TASK_TYPES[ttype]
            old_rule.name = cfg["name"]
            old_rule.task_type = ttype
            old_rule.sub_label = cfg["sub_label"]
            old_rule.action = cfg["action"]
            old_rule.cron = cfg["cron"]
            old_rule.schedule_text = cfg["schedule_text"]
            old_rule.backfill_text = cfg["backfill_text"]
            if cfg["needs_ai"] and not _has_ai_key():
                old_rule.enabled = False
                old_rule.disabled_reason = "先去设置配对文本模型（ARK_API_KEY）"
            db.commit()

    for ttype, cfg in TASK_TYPES.items():
        exists = db.query(AutomationRule).filter(AutomationRule.task_type == ttype).first()
        if exists:
            continue
        disabled = cfg["needs_ai"] and not _has_ai_key()
        db.add(
            AutomationRule(
                name=cfg["name"],
                task_type=ttype,
                sub_label=cfg["sub_label"],
                action=cfg["action"],
                cron=cfg["cron"],
                schedule_text=cfg["schedule_text"],
                timezone="Asia/Shanghai",
                backfill_text=cfg["backfill_text"],
                rule_type="schedule",
                enabled=not disabled,
                disabled_reason=("先去设置配对文本模型（ARK_API_KEY）" if disabled else ""),
            )
        )
    db.commit()

def seed_account_rules(db: Session, account_id: int | None) -> None:
    """为指定账号补齐一套默认规则（幂等：该账号已有某 task_type 则跳过）。

    全局规则（account_id=None）对所有账号生效；账号级规则（account_id=某账号）
    只对该账号生效。新账号注册后调用，实现"每个账号各自一套自动化"。
    """
    if account_id is None:
        return
    for ttype, cfg in TASK_TYPES.items():
        exists = (
            db.query(AutomationRule)
            .filter(AutomationRule.task_type == ttype, AutomationRule.account_id == account_id)
            .first()
        )
        # 账号已有该类型账号级规则 → 把同类型全局规则降级为模板（避免双跑）
        glb = (
            db.query(AutomationRule)
            .filter(AutomationRule.task_type == ttype, AutomationRule.account_id.is_(None))
            .first()
        )
        if exists:
            if glb and glb.enabled:
                glb.enabled = False
                glb.disabled_reason = "已按账号拆分为账号级规则（模板）"
            continue
        if glb and glb.enabled:
            glb.enabled = False
            glb.disabled_reason = "已按账号拆分为账号级规则（模板）"
        disabled = cfg["needs_ai"] and not _has_ai_key()
        db.add(
            AutomationRule(
                account_id=account_id,
                name=cfg["name"],
                task_type=ttype,
                sub_label=cfg["sub_label"],
                action=cfg["action"],
                cron=cfg["cron"],
                schedule_text=cfg["schedule_text"],
                timezone="Asia/Shanghai",
                backfill_text=cfg["backfill_text"],
                rule_type="schedule",
                enabled=not disabled,
                disabled_reason=("先去设置配对文本模型（ARK_API_KEY）" if disabled else ""),
            )
        )
    db.commit()

def _has_ai_key() -> bool:
    from ..config import settings

    return bool(settings.ark_api_key)

def ensure_next_runs(db: Session) -> None:
    """启动时补齐 next_run（未启用的任务下次标为等待启用）。"""
    now = datetime.utcnow()
    for r in db.query(AutomationRule).all():
        if r.enabled and r.next_run is None:
            r.next_run = _compute_next_run(r, now)
        elif not r.enabled:
            r.next_run = None
    db.commit()
