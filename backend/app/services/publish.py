"""opencli 平台适配器：抖音发布 / 草稿 / 数据拉取 / 账号状态。"""
import asyncio
import json
import subprocess

SUPPORTED_PLATFORMS = {
    "douyin": "抖音",
    "xiaohongshu": "小红书",
    "weibo": "微博",
    "wechat-channels": "视频号",
    "tiktok": "TikTok",
    "bilibili": "B站",
}


class PublishError(Exception):
    pass

def _run(cmd: list[str], timeout: int = 120, account_id: int | None = None, headless: bool = False, goto_creator: bool = True) -> str:
    try:
        if account_id:
            # 多账号发布：用该账号独立 profile 定向执行（身份=该账号）
            from . import profiles as profiles_svc

            return profiles_svc.run_with_profile(account_id, cmd, timeout=timeout, headless=headless, goto_creator=goto_creator)
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        if proc.returncode != 0:
            raise PublishError(f"opencli 执行失败（{cmd[1]}）：{out[:300]}")
        return out
    except subprocess.TimeoutExpired:
        raise PublishError("opencli 命令超时")
    except FileNotFoundError:
        raise PublishError("未安装 opencli，请先执行 npm install -g @jackwener/opencli")

async def platform_status() -> list[dict]:
    """各平台登录与能力状态。opencli 冷启动较慢，主平台（douyin）给足超时。"""
    result = []
    for platform, label in SUPPORTED_PLATFORMS.items():
        try:
            # opencli 首次调用需 daemon 握手（30-60s），主平台给 90s，其余 20s
            timeout = 90 if platform == "douyin" else 20
            out = await asyncio.to_thread(_run, ["opencli", platform, "whoami"], timeout)
            logged_in = '"logged_in": true' in out or "logged_in: true" in out
            username = ""
            for line in out.splitlines():
                if line.startswith("username"):
                    username = line.split(":", 1)[1].strip()
            result.append({"platform": platform, "label": label, "logged_in": logged_in, "username": username})
        except PublishError:
            result.append({"platform": platform, "label": label, "logged_in": False, "username": ""})
    return result

def _parse_yaml_list(out: str) -> list[dict]:
    """解析 opencli 的 YAML 风格块列表（`- key: value` + 缩进字段）。"""
    items: list[dict] = []
    cur: dict | None = None
    for line in out.splitlines():
        line = line.rstrip()
        if line.startswith("- "):
            if cur:
                items.append(cur)
            cur = {}
            k, _, v = line[2:].partition(":")
            cur[k.strip()] = v.strip().strip("'\"")
        elif line[:2] in ("  ", "\t") and ":" in line and cur is not None:
            k, _, v = line.strip().partition(":")
            cur[k.strip()] = v.strip().strip("'\"")
    if cur:
        items.append(cur)
    return items

async def list_videos(platform: str = "douyin", limit: int = 10, account_id: int | None = None) -> list[dict]:
    """拉取最近作品列表。抖音用 videos，其余平台用 user-videos。
    account_id 指定时走该账号独立 profile（多账号数据各归各位）。"""
    if platform not in ("douyin", "xiaohongshu", "weibo", "bilibili", "tiktok"):
        raise PublishError(f"平台 {platform} 暂不支持数据拉取")
    cmd = ["opencli", platform, "videos", "--limit", str(limit)] if platform == "douyin" else ["opencli", platform, "user-videos", "--limit", str(limit)]
    out = await asyncio.to_thread(_run, cmd, 120, account_id=account_id)
    try:
        data = json.loads(out)
        if isinstance(data, list):
            return data
        for key in ("videos", "items", "data", "list"):
            if isinstance(data.get(key), list):
                return data[key]
    except json.JSONDecodeError:
        pass
    return _parse_yaml_list(out)

async def account_stats(platform: str = "douyin") -> dict:
    """拉取账号整体数据（抖音用 profile 资料，其余平台用 whoami + videos 组合探测）。"""
    if platform != "douyin":
        result: dict = {}
        try:
            out = await asyncio.to_thread(_run, ["opencli", platform, "whoami"], 30)
            for line in out.splitlines():
                k, _, v = line.partition(":")
                if k.strip().lstrip("-").strip() in ("username", "nickname"):
                    result[k.strip().lstrip("-").strip()] = v.strip().strip("'\"")
        except PublishError:
            pass
        try:
            videos = await list_videos(platform, limit=10)
            result["video_count"] = str(len(videos))
        except PublishError:
            pass
        return result or {"raw": "未登录或平台不支持"}
    cmd = ["opencli", platform, "profile"]
    out = await asyncio.to_thread(_run, cmd, 120)
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        pass
    # 解析 YAML 风格 key: value
    stats: dict = {}
    for line in out.splitlines():
        line = line.strip()
        if ":" in line:
            k, _, v = line.partition(":")
            k = k.strip().lstrip("-").strip()
            v = v.strip().strip("'\"")
            if k:
                stats[k] = v
    return stats or {"raw": out}

async def create_draft(
    platform: str,
    title: str,
    description: str = "",
    video_path: str = "",
    images: list[str] | None = None,
    account_id: int | None = None,
) -> dict:
    """创建平台草稿（不直接发布，用户确认后再发布）。
    douyin 用 draft（video+title 必填）；xiaohongshu 用 publish --draft；weibo 不支持草稿。"""
    if platform == "douyin":
        if not video_path:
            raise PublishError("创建抖音草稿需要视频文件路径（video_path）")
        cmd = ["opencli", "douyin", "draft", "--video", video_path, "--title", title]
        if description:
            cmd += ["--caption", description]
    elif platform == "xiaohongshu":
        cmd = ["opencli", "xiaohongshu", "publish", "--content", description or title, "--title", title, "--draft"]
    elif platform == "weibo":
        raise PublishError("微博不支持草稿，请使用立即发布模式")
    else:
        raise PublishError(f"平台 {platform} 暂不支持草稿")
    out = await asyncio.to_thread(_run, cmd, 180, account_id=account_id)
    return {"raw": out, "platform": platform}

async def publish_now(
    platform: str,
    title: str,
    description: str = "",
    video_path: str = "",
    images: list[str] | None = None,
    account_id: int | None = None,
    schedule_at: str = "",
) -> dict:
    """发布。douyin publish 需 video+schedule；account_id 指定后走该账号独立 profile；
    schedule_at 提供时走平台「定时发布」（2h~14 天内）。"""
    if platform == "douyin":
        if not video_path:
            raise PublishError("抖音发布需要视频文件路径（video_path）")
        sched = schedule_at or "now"
        cmd = ["opencli", "douyin", "publish", "--video", video_path, "--title", title, "--schedule", sched]
        if description:
            cmd += ["--caption", description]
    elif platform == "xiaohongshu":
        cmd = ["opencli", "xiaohongshu", "publish", "--content", description or title, "--title", title]
    elif platform == "weibo":
        cmd = ["opencli", "weibo", "publish", "--text", description or title]
    else:
        raise PublishError(f"平台 {platform} 暂不支持立即发布")
    out = await asyncio.to_thread(_run, cmd, 300, account_id=account_id)
    return {"raw": out, "platform": platform}
