"""多账号独立浏览器环境（profile 目录）服务。

对标 CreatorOS：一个账号 = 一份独立浏览器环境（Cookie + localStorage + 缓存 + 扩展）。
- 绑新号：临时空目录扫码登录 → 读回身份 → 挪到正式目录（fail-closed，绝不挂旧号）
- 采集：加载该账号正式 profile → 创作者中心 → 拦 XHR + DOM 抽取 → 按作品 ID 对齐落库
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from datetime import datetime

from ..models import Account, Metric, Publication, Knowledge  # noqa: F401
from . import accounts as accounts_svc


def auth_root() -> Path:
    base = Path(os.environ.get("CREATOROS_AUTH_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "auth")))
    d = base / "douyin"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_name(name: str) -> str:
    name = re.sub(r"[^\w\u4e00-\u9fa5-]", "_", name.strip())[:48] or "account"
    return name

def profile_dir(account: Account) -> Path:
    return auth_root() / _safe_name(account.display_name or account.username or f"account_{account.id}")

def staging_dir() -> Path:
    return auth_root() / f"_staging_{uuid.uuid4().hex[:10]}"


# ---------------- 绑新号 ----------------

def _grab_identity(page) -> tuple[str, str, str]:
    """从创作者中心页面读回身份：昵称 / 抖音号 / uid（尽力而为）。"""
    nickname, douyin_id, uid = "", "", ""
    # 路1：页面右上角昵称
    try:
        txt = page.locator("body").inner_text(timeout=3000)
        m = re.search(r"(@[\w.]+)", txt)
        if m:
            douyin_id = m.group(1)
    except Exception:
        pass
    # 路2：创作者中心接口数据
    try:
        data = page.evaluate(
            """() => {
                const s = document.querySelector('#RENDER_DATA')?.textContent;
                if (s) { try { return JSON.parse(decodeURIComponent(s)); } catch(e) { return null; } }
                return null;
            }"""
        )
        if data:
            s = json_path(data, "user.nickname") or json_path(data, "app.nickname") or ""
            u = json_path(data, "user.secUid") or json_path(data, "app.secUid") or ""
            if s:
                nickname = s
            if u:
                uid = u
    except Exception:
        pass
    return nickname, douyin_id, uid

def json_path(o, path: str):
    cur = o
    for k in path.split("."):
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            return None
    return cur if isinstance(cur, (str, int, float)) else None

def _wait_logged_in(page, timeout_s: int = 300) -> bool:
    """等待扫码登录完成：登录后创作者中心 URL 稳定且不再跳登录页。"""
    start = time.time()
    last_url = ""
    stable = 0
    while time.time() - start < timeout_s:
        try:
            url = page.url
        except Exception:
            url = last_url
        if url != last_url:
            last_url = url
            stable = 0
        else:
            stable += 1
        # 创作者中心且非 passport 登录路径
        if url.startswith("https://creator.douyin.com") and "/passport" not in url and stable >= 3:
            # 进一步确认：出现创作者中心特征元素
            try:
                page.wait_for_selector("text=/内容管理|作品管理|数据概览/", timeout=4000)
                return True
            except Exception:
                pass
        time.sleep(1)
    return False

def bind_profile_sync(db_session, aid: int) -> dict:
    """绑新号（阻塞）：临时目录扫码 → 读身份 → 挪正式目录。"""
    from playwright.sync_api import sync_playwright

    account = db_session.get(Account, aid)
    if not account:
        raise ValueError("账号不存在")
    account.profile_status = "scanning"
    db_session.commit()

    staging = staging_dir()
    final = profile_dir(account)
    result = {"status": "bound"}
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(staging),
                channel="chrome",
                headless=False,
                viewport={"width": 1280, "height": 800},
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto("https://creator.douyin.com/creator-micro/content/manage", wait_until="domcontentloaded", timeout=60000)
            ok = _wait_logged_in(page, timeout_s=300)
            if not ok:
                ctx.close()
                raise ValueError("等待扫码超时（5 分钟），请重试")
            nickname, douyin_id, uid = _grab_identity(page)
            ctx.close()

        # 挪正式目录（先清旧目录残留，再搬）
        if final.exists():
            shutil.rmtree(final, ignore_errors=True)
        shutil.move(str(staging), str(final))

        if nickname:
            account.display_name = nickname
        if douyin_id:
            account.username = douyin_id.lstrip("@")
        if uid:
            account.uid = uid
        account.profile_path = str(final.relative_to(auth_root().parent))
        account.profile_status = "bound"
        db_session.commit()
        result.update({"profile_path": account.profile_path, "nickname": nickname, "douyin_id": douyin_id})
        return result
    except Exception as e:
        # fail-closed：丢弃临时目录，绝不挂旧号
        shutil.rmtree(staging, ignore_errors=True)
        account.profile_status = "failed"
        db_session.commit()
        raise

def start_bind(db_session, aid: int) -> dict:
    """异步启动绑新号。"""
    account = db_session.get(Account, aid)
    if not account:
        raise ValueError("账号不存在")
    account.profile_status = "pending"
    db_session.commit()
    t = threading.Thread(target=_bind_worker, args=(aid,), daemon=True)
    t.start()
    return {"status": "pending"}

def _bind_worker(aid: int):
    from ..database import SessionLocal  # 线程内独立会话

    with SessionLocal() as s:
        try:
            bind_profile_sync(s, aid)
        except Exception as e:
            acc = s.get(Account, aid)
            if acc:
                acc.profile_status = "failed"
                s.commit()


# ---------------- 采集 ----------------

def run_with_profile(aid: int, cmd: list[str], timeout: int = 300, headless: bool = False, goto_creator: bool = True) -> str:
    """以指定账号的独立 profile 执行 opencli 命令（身份=该账号）。

    - 启动该账号 profile 的 Chrome（带 CDP 调试端口）
    - 注入 OPENCLI_CDP_ENDPOINT，opencli 命令定向到该 profile 执行
    - 结束后关闭 Chrome，返回命令 stdout
    headless=False：真实窗口（发布/上传等需要页面交互的操作）；
    headless=True：静默（只读采集类）。
    """
    from playwright.sync_api import sync_playwright

    from ..database import SessionLocal

    with SessionLocal() as db_session:
        account = db_session.get(Account, aid)
        if not account or account.profile_status != "bound" or not account.profile_path:
            raise ValueError("该账号尚未绑定浏览器身份，请先「绑定浏览器身份」")
        profile = auth_root().parent / account.profile_path
        if not profile.is_dir():
            raise ValueError(f"profile 目录缺失：{account.profile_path}，请重新绑定")

    port = _profile_port(aid)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(profile), channel="chrome", headless=headless,
            viewport={"width": 1280, "height": 800},
            args=[f"--remote-debugging-port={port}"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        if goto_creator:
            try:
                page.goto("https://creator.douyin.com/creator-micro/content/manage", wait_until="domcontentloaded", timeout=60000)
            except Exception:
                pass
            try:
                page.wait_for_selector("text=/内容管理|作品管理|数据概览|登录/", timeout=25000)
            except Exception:
                pass
        time.sleep(2)
        env = dict(os.environ)
        env["OPENCLI_CDP_ENDPOINT"] = f"http://127.0.0.1:{port}"
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout)
        ctx.close()
    if proc.returncode != 0:
        raise RuntimeError(f"opencli 执行失败（{' '.join(cmd[:3])}）：{proc.stderr[:300] or proc.stdout[:300]}")
    return proc.stdout

def _profile_port(aid: int) -> int:
    """每账号固定调试端口，避免冲突（10000 + aid）。"""
    return 10000 + (aid % 5000)

def collect_profile_sync(db_session, aid: int, limit: int = 20) -> dict:
    """加载账号独立 profile（带 CDP 调试端口）→ opencli douyin 以该账号身份采集 → 按作品 ID 对齐落库。"""
    from playwright.sync_api import sync_playwright

    account = db_session.get(Account, aid)
    if not account:
        raise ValueError("账号不存在")
    if account.profile_status != "bound" or not account.profile_path:
        raise ValueError("该账号尚未绑定浏览器身份，请先「绑定浏览器身份」")
    profile = auth_root().parent / account.profile_path
    if not profile.is_dir():
        raise ValueError(f"profile 目录缺失：{account.profile_path}，请重新绑定")

    port = _profile_port(aid)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(profile), channel="chrome", headless=True,
            viewport={"width": 1280, "height": 800},
            args=[f"--remote-debugging-port={port}"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://creator.douyin.com/creator-micro/content/manage", wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_selector("text=/内容管理|作品管理|数据概览|登录/", timeout=25000)
        except Exception:
            pass
        # 等待 CDP 就绪，然后 opencli 以该账号身份采集
        time.sleep(2)
        env = dict(os.environ)
        env["OPENCLI_CDP_ENDPOINT"] = f"http://127.0.0.1:{port}"
        proc = subprocess.run(
            ["opencli", "douyin", "videos", "-f", "json"],
            capture_output=True, text=True, env=env, timeout=240,
        )
        ctx.close()

    works = _parse_opencli_videos(proc.stdout, limit)
    created, merged = persist_works(db_session, account, works)
    return {"pulled": len(works), "created": created, "merged": merged}

def _parse_opencli_videos(stdout: str, limit: int) -> list[dict]:
    """解析 opencli douyin videos 输出（兼容 list / {videos:[]} / {items:[]}）。"""
    import json as _json

    try:
        d = _json.loads(stdout)
    except Exception:
        return []
    items = d if isinstance(d, list) else d.get("videos", d.get("items", []))
    out: dict[str, dict] = {}
    for v in items:
        item_id = str(v.get("aweme_id") or v.get("id") or "")
        if not item_id:
            continue
        out[item_id] = {
            "item_id": item_id,
            "title": v.get("title") or v.get("desc") or "",
            "cover": v.get("cover") or v.get("cover_url") or "",
            "view": _num(v.get("play_count") or v.get("views") or v.get("play") or 0),
            "like": _num(v.get("digg_count") or v.get("likes") or 0),
            "comment": _num(v.get("comment_count") or v.get("comments") or 0),
            "share": _num(v.get("share_count") or v.get("shares") or 0),
            "collect": _num(v.get("collect_count") or v.get("favorites") or 0),
        }
    return list(out.values())[:limit]

def _extract_dom_items(page) -> list[dict]:
    """DOM 兜底：作品管理列表卡片行（封面标题/播放/点赞/评论）。"""
    items = []
    try:
        rows = page.locator("div[class*=card], tr[class*=row], [class*=works] a").all()
        # 保守：抓页面文本找数字模式；主通道仍以 XHR 为准
        txt = page.locator("body").inner_text(timeout=3000)
        for m in re.finditer(r"([^\n]{4,60})\n([\d.万]+)[^0-9]*([\d.万]+)", txt):
            pass
    except Exception:
        pass
    return items

def _normalize_works(xhr_batches: list, dom_items: list, limit: int) -> list[dict]:
    """从 XHR 载荷里挖作品列表（兼容多种返回结构），按作品 ID 去重对齐。"""
    out: dict[str, dict] = {}
    for batch in xhr_batches:
        for node in _walk(batch):
            if isinstance(node, dict) and node.get("aweme_id") and isinstance(node.get("aweme_id"), str):
                v = node
                out[v["aweme_id"]] = {
                    "item_id": v["aweme_id"],
                    "title": v.get("desc") or v.get("title") or "",
                    "cover": (v.get("video") or {}).get("cover", {}).get("url_list", [""])[0] if isinstance(v.get("video"), dict) else "",
                    "view": _num(v.get("statistics", {}).get("play_count")) if isinstance(v.get("statistics"), dict) else 0,
                    "like": _num(v.get("statistics", {}).get("digg_count")) if isinstance(v.get("statistics"), dict) else 0,
                    "comment": _num(v.get("statistics", {}).get("comment_count")) if isinstance(v.get("statistics"), dict) else 0,
                    "share": _num(v.get("statistics", {}).get("share_count")) if isinstance(v.get("statistics"), dict) else 0,
                    "collect": _num(v.get("statistics", {}).get("collect_count")) if isinstance(v.get("statistics"), dict) else 0,
                }
    # DOM 兜底合并（有 item_id 才认）
    for it in dom_items:
        if it.get("item_id") and it["item_id"] not in out:
            out[it["item_id"]] = it
    return list(out.values())[:limit]

def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)

def _num(x) -> float:
    try:
        return float(x)
    except Exception:
        return 0.0

def persist_works(db_session, account: Account, works: list[dict]) -> tuple[int, int]:
    """按作品 ID 幂等落库：已存在 → 合并（补真实数据，不覆盖手写内容）；不存在 → 新建 imported。"""
    created = merged = 0
    for w in works:
        item_id = str(w.get("item_id", ""))
        if not item_id:
            continue
        pub = db_session.query(Publication).filter(Publication.account_id == account.id, Publication.item_id == item_id).first()
        if pub:
            # 合并：只补缺失字段
            if not pub.title and w.get("title"):
                pub.title = str(w["title"])[:256]
            if not pub.cover_url and w.get("cover"):
                pub.cover_url = str(w["cover"])
            merged += 1
        else:
            pub = Publication(
                account_id=account.id,
                platform="douyin",
                title=str(w.get("title", ""))[:256],
                cover_url=str(w.get("cover", "")),
                item_id=item_id,
            )
            db_session.add(pub)
            created += 1
        db_session.flush()
        # 指标快照
        db_session.add(Metric(
            account_id=account.id,
            publication_id=pub.id,
            platform="douyin",
            item_id=item_id,
            views=float(w.get("view", 0)),
            likes=float(w.get("like", 0)),
            comments=float(w.get("comment", 0)),
            shares=float(w.get("share", 0)),
            favorites=float(w.get("collect", 0)),
        ))
    db_session.commit()
    account.last_synced_at = datetime.now()
    return created, merged

def start_collect(db_session, aid: int, limit: int = 20) -> dict:
    """异步启动采集。"""
    account = db_session.get(Account, aid)
    if not account:
        raise ValueError("账号不存在")
    if account.profile_status != "bound" or not account.profile_path:
        raise ValueError("该账号尚未绑定浏览器身份，请先「绑定浏览器身份」")
    t = threading.Thread(target=_collect_worker, args=(aid, limit), daemon=True)
    t.start()
    return {"status": "collecting"}

def _collect_worker(aid: int, limit: int):
    from ..database import SessionLocal

    with SessionLocal() as s:
        try:
            collect_profile_sync(s, aid, limit=limit)
        except Exception as e:
            acc = s.get(Account, aid)
            if acc:
                acc.profile_status = "failed"
                s.commit()
