"""账号创作画像服务（越用越懂我 · 第②步）。

画像 = 静态（定位母版）+ 动态（本账号历史创作数据的聚合指纹）+ 用户偏好（手动编辑）。
动态画像每次实时聚合，无需单独落库；用户编辑的偏好合并写入 accounts.profile（JSON）。
"""
from __future__ import annotations

import json

from ..models import Account, Project, Topic


def _top(items: list[str], n: int = 5) -> list[tuple[str, int]]:
    """频次统计 top-n。"""
    from collections import Counter

    cnt = Counter(x for x in items if x)
    return cnt.most_common(n)


def build_account_profile(db, account_id: int) -> str:
    """聚合该账号全部选题/项目的创作特征，输出注入提示词的画像文本。

    无任何创作数据时返回空串（保持静默，不干扰通用创作）。
    """
    from .topics import build_verified_signals

    topics = db.query(Topic).filter(Topic.account_id == account_id).all()
    projects = db.query(Project).filter(Project.account_id == account_id).all()
    if not topics and not projects:
        return ""

    tags, forms, audiences, hooks, decisions = [], [], [], [], []
    adopted, discarded, pending = 0, 0, 0
    for t in topics:
        if t.tag:
            tags.append(t.tag)
        if t.form:
            forms.append(t.form)
        if t.audience:
            audiences.append(t.audience)
        if t.hook:
            hooks.append(t.hook)
        if t.core_decision:
            decisions.append(t.core_decision)
        if t.status == "approved":
            adopted += 1
        elif t.status == "discarded":
            discarded += 1
        elif t.status in ("candidate", "pending_review"):
            pending += 1

    lines = [f"本账号创作画像（基于 {len(topics)} 个选题、{len(projects)} 个项目自动积累）："]
    t5 = _top(tags)
    if t5:
        lines.append("- 常做方向: " + "、".join(f"{k}({v}次)" for k, v in t5))
    f5 = _top(forms)
    if f5:
        lines.append("- 内容形式偏好: " + "、".join(f"{k}({v}次)" for k, v in f5))
    a3 = _top(audiences, 3)
    if a3:
        lines.append("- 目标受众: " + "、".join(f"{k}({v}次)" for k, v in a3))
    if adopted or discarded:
        lines.append(f"- 创作节奏: 已立项 {adopted} / 丢弃 {discarded} / 待审 {pending}，新选题应贴合常被立项的偏好方向")
    if hooks:
        lines.append("- 惯用Hook句式（可延续风格）: " + " / ".join(h[:28] for h in hooks[:3]))
    if decisions:
        lines.append("- 惯用主张句式: " + " / ".join(d[:24] for d in decisions[:3]))

    verified = build_verified_signals(db, account_id)
    if verified:
        lines.append(verified)
    return "\n".join(lines)


def get_profile_text(db, account_id: int) -> str:
    """合并动态画像 + 用户编辑偏好，返回最终注入文本。"""
    dynamic = build_account_profile(db, account_id)
    account = db.get(Account, account_id)
    extra = ""
    if account and account.profile:
        try:
            data = json.loads(account.profile)
        except Exception:
            data = {}
        notes = data.get("notes", "") if isinstance(data, dict) else ""
        if notes:
            extra = f"用户补充偏好（最高优先级，必须遵守）：\n{notes}"
    parts = [p for p in (dynamic, extra) if p]
    return "\n\n".join(parts)


def save_profile_notes(db, account_id: int, notes: str) -> dict:
    """保存用户编辑的画像偏好（写入 accounts.profile JSON 的 notes 字段）。"""
    account = db.get(Account, account_id)
    if not account:
        raise ValueError("账号不存在")
    try:
        data = json.loads(account.profile) if account.profile else {}
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data["notes"] = notes
    account.profile = json.dumps(data, ensure_ascii=False)
    db.commit()
    return {"saved": True, "notes": notes}
