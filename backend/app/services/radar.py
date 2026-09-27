"""内容雷达服务：信源博主同步、关键词收录、AI 逐字稿、升级为项目。"""
import json
import logging
import re
import subprocess
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models import Project, RadarContent, SourceAccount, Topic
from . import accounts as accounts_svc
from . import ark as ark_svc

logger = logging.getLogger("creatoros.radar")

# 进行中防重锁：避免后台预转写与用户手动点击同时转写同一内容
_TRANSCRIBING: set = set()


def _parse_publish_time(v) -> datetime | None:
    """opencli create_time：支持 UNIX 秒与 ISO 字符串，解析为 UTC datetime。"""
    if not v:
        return None
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(int(v), tz=timezone.utc)
        except Exception:
            return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def _upsert_snapshot(db, content_id: int, pc: int, dc: int, cc: int, sc: int, colc: int) -> None:
    """把雷达内容当前计数幂等写入当日快照（同 content+date 更新）。"""
    from ..models import RadarSnapshot
    today = datetime.now().strftime("%Y-%m-%d")
    snap = (
        db.query(RadarSnapshot)
        .filter(RadarSnapshot.content_id == content_id, RadarSnapshot.date == today)
        .first()
    )
    if snap:
        snap.play_count, snap.digg_count = pc, dc
        snap.comment_count, snap.collect_count, snap.share_count = cc, colc, sc
    else:
        db.add(RadarSnapshot(
            content_id=content_id, date=today,
            play_count=pc, digg_count=dc, comment_count=cc,
            collect_count=colc, share_count=sc,
        ))


def _norm_source_url(url: str, aweme: str) -> str:
    """opencli 返回的 url 可能是 CDN 直链（签名过期 403），统一规范为抖音页面链接。"""
    u = (url or "").strip()
    if u.startswith(("http://", "https://")) and "douyinvod.com" in u and aweme:
        return f"https://www.douyin.com/video/{aweme}"
    return u


def _run_opencli(args: list[str], timeout: int = 120) -> list[dict] | dict:
    """调用 opencli（常驻 daemon 会复用登录态），返回 JSON。"""
    proc = subprocess.run(
        ["opencli", *args, "-f", "json"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    out = proc.stdout.strip()
    if not out:
        raise RuntimeError(f"opencli 返回为空：{proc.stderr[:300]}")
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        if '"ok": false' in out or "ok: false" in out:
            raise RuntimeError(f"opencli 执行失败：{out[:300]}")
        raise RuntimeError(f"opencli 输出无法解析：{out[:300]}")


def _extract_aweme_id(url: str) -> str:
    m = re.search(r"/video/(\d+)", url or "")
    return m.group(1) if m else ""


def _resolve_sec_uid(raw: str) -> str:
    """从输入解析抖音 sec_uid：直接传 sec_uid、完整主页 URL（/user/<sec_uid>）、或 v.douyin.com 短链。"""
    raw = (raw or "").strip()
    if not raw:
        return ""
    if re.match(r"^MS4wLjAB", raw):
        return raw
    m = re.search(r"/user/([A-Za-z0-9_\-]+)", raw)
    if m:
        return m.group(1)
    m = re.search(r"[?&]sec_uid=([A-Za-z0-9_\-]+)", raw)
    if m:
        return m.group(1)
    try:
        import urllib.request
        req = urllib.request.Request(raw, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            resolved = resp.geturl()
        m = re.search(r"/user/([A-Za-z0-9_\-]+)", resolved)
        if m:
            return m.group(1)
    except Exception:
        pass
    return ""


def sync_user_source(db: Session, account_id: int | None, source_id: int) -> dict:
    """同步博主主页作品（user-videos，含封面/下载地址/评论）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    src = db.get(SourceAccount, source_id)
    if not src or src.account_id != aid:
        raise ValueError("信源不存在")
    sec_uid = _resolve_sec_uid(src.sec_uid or "")
    if not sec_uid:
        src.sync_status = "error"
        db.commit()
        raise ValueError(
            "缺少博主主页链接：请在「抖音主页链接」填入 https://www.douyin.com/user/<sec_uid> 或分享主页短链（v.douyin.com/…）"
        )
    data = _run_opencli(["douyin", "user-videos", sec_uid, "--with_comments", "false"])
    items = data if isinstance(data, list) else data.get("videos") or data.get("data") or data.get("items") or []
    added = 0
    for it in items:
        url = it.get("url") or it.get("video_url") or it.get("play_url") or ""
        aweme = it.get("aweme_id") or _extract_aweme_id(url)
        if not aweme:
            continue
        exists = (
            db.query(RadarContent)
            .filter(RadarContent.account_id == aid, RadarContent.aweme_id == aweme)
            .first()
        )
        if exists:
            if exists.source_id is None or exists.source_id != src.id:
                exists.source_id = src.id
            if url and not exists.video_url:
                exists.video_url = url
            exists.play_count = max(exists.play_count, int(it.get("play_count") or it.get("plays") or 0))
            exists.digg_count = max(exists.digg_count, int(it.get("digg_count") or it.get("likes") or 0))
            exists.comment_count = max(exists.comment_count, int(it.get("comment_count") or it.get("comments") or 0))
            exists.collect_count = max(exists.collect_count, int(it.get("collect_count") or 0))
            exists.share_count = max(exists.share_count, int(it.get("share_count") or it.get("shares") or 0))
            if not exists.publish_time:
                exists.publish_time = _parse_publish_time(it.get("create_time"))
            _upsert_snapshot(db, exists.id, exists.play_count, exists.digg_count,
                             exists.comment_count, exists.share_count, exists.collect_count)
            continue
        c = RadarContent(
            account_id=aid,
            source_id=src.id,
            author=it.get("author") or src.name,
            aweme_id=aweme,
            title=it.get("title") or (it.get("desc") or "")[:80],
            desc=it.get("desc") or it.get("title") or "",
            cover_url=it.get("cover") or it.get("cover_url") or "",
            video_url=it.get("play_url") or it.get("video") or it.get("video_url") or "",
            source_url=_norm_source_url(url, aweme),
            play_count=int(it.get("play_count") or it.get("plays") or 0),
            digg_count=int(it.get("digg_count") or it.get("likes") or 0),
            comment_count=int(it.get("comment_count") or it.get("comments") or 0),
            share_count=int(it.get("share_count") or it.get("shares") or 0),
            collect_count=int(it.get("collect_count") or 0),
            publish_time=_parse_publish_time(it.get("create_time")),
        )
        db.add(c)
        db.flush()
        _upsert_snapshot(db, c.id, c.play_count, c.digg_count,
                         c.comment_count, c.share_count, c.collect_count)
        added += 1
    src.sync_status = "synced"
    src.sec_uid = sec_uid
    src.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    total = db.query(RadarContent).filter(RadarContent.source_id == src.id).count()
    return {"source_id": src.id, "added": added, "total": total}


def sync_search(db: Session, account_id: int | None, keyword: str, limit: int = 10) -> dict:
    """关键词搜索收录公开作品（search，字段较简）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    data = _run_opencli(["douyin", "search", keyword])
    items = data if isinstance(data, list) else data.get("videos") or data.get("data") or data.get("items") or []
    added = 0
    for it in items[:limit]:
        url = it.get("url") or ""
        aweme = _extract_aweme_id(url)
        if not aweme:
            continue
        if db.query(RadarContent).filter(RadarContent.account_id == aid, RadarContent.aweme_id == aweme).first():
            continue
        c = RadarContent(
            account_id=aid,
            source_id=None,
            author=it.get("author") or "",
            aweme_id=aweme,
            title=(it.get("desc") or "")[:80],
            desc=it.get("desc") or "",
            source_url=_norm_source_url(url, aweme),
            play_count=int(it.get("plays") or 0),
            digg_count=int(it.get("likes") or 0),
            comment_count=int(it.get("comments") or 0),
            share_count=int(it.get("shares") or 0),
        )
        db.add(c)
        added += 1
    db.commit()
    return {"keyword": keyword, "added": added}


def _asr_env() -> str:
    import os
    cands = ["/tmp/asr_env/bin/python", os.path.expanduser("~/.asr_env/bin/python")]
    for c in cands:
        if os.path.exists(c):
            return c
    return ""


async def _ark_transcribe_segment(b64: str) -> str:
    """单段音频经方舟多模态（input_audio）转写为文字。"""
    import httpx
    url = f"{ark_svc.settings.ark_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {ark_svc.settings.ark_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": ark_svc.settings.ark_model_lite,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": b64, "format": "mp3"}},
                    {"type": "text", "text": "请把这段音频完整转写为文字，保留口语原样，不要添加任何解释、不输出额外内容。"},
                ],
            }
        ],
        "max_tokens": 3000,
    }
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(url, json=payload, headers=headers)
    if r.status_code == 429:
        import asyncio
        await asyncio.sleep(3)
        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(url, json=payload, headers=headers)
        if r.status_code == 429:
            raise RuntimeError("方舟语音转写用量限额已耗尽（429），已自动降级本地转写")
    if r.status_code != 200:
        raise RuntimeError(f"方舟语音转写失败 HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"方舟语音转写返回异常: {str(data)[:200]}")


async def _transcribe_with_ark(wav: str) -> str:
    """分片（60s/64k mp3）并行调方舟转写并拼接。"""
    import asyncio
    import base64
    import glob
    import os
    import subprocess
    segdir = os.path.join(os.path.dirname(wav), "segs")
    os.makedirs(segdir, exist_ok=True)
    fp = subprocess.run(
        ["ffmpeg", "-y", "-i", wav, "-f", "segment", "-segment_time", "60", "-c:a", "libmp3lame", "-b:a", "64k", os.path.join(segdir, "seg_%03d.mp3")],
        capture_output=True, text=True, timeout=240,
    )
    if fp.returncode != 0:
        raise RuntimeError("音频分段失败：" + (fp.stderr or "")[-200:])
    segs = sorted(glob.glob(os.path.join(segdir, "seg_*.mp3")))
    if not segs:
        raise RuntimeError("音频分段为空")
    sem = asyncio.Semaphore(3)

    async def one(path: str) -> str:
        b64 = base64.b64encode(open(path, "rb").read()).decode()
        async with sem:
            return await _ark_transcribe_segment(b64)

    parts = await asyncio.gather(*(one(p) for p in segs))
    return "\n".join(part.strip() for part in parts if part.strip())


def _transcribe_with_faster_whisper(wav: str) -> str:
    """兜底：faster-whisper 本地转写。"""
    import os
    py = _asr_env()
    if not py:
        raise RuntimeError("本地转写引擎不可用")
    _env = {**os.environ, "HF_ENDPOINT": "https://hf-mirror.com"}
    local_model = "/tmp/whisper-base" if os.path.isdir("/tmp/whisper-base") else None
    _cmd = [py, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "asr_worker.py"), wav, "--model", "base"]
    if local_model:
        _cmd += ["--model-dir", local_model]
    rp = subprocess.run(_cmd, capture_output=True, text=True, timeout=1800, env=_env)
    if rp.returncode != 0:
        raise RuntimeError((rp.stderr or rp.stdout or "").strip()[-300:])
    text = rp.stdout.strip()
    if not text:
        raise RuntimeError("未识别到语音内容")
    return text


async def extract_subtitle(db: Session, account_id: int | None, content_id: int, force: bool = False) -> RadarContent:
    """原字幕提取：下载视频 → ffmpeg 抽音频 → 方舟多模态语音转写（高效主通道，faster-whisper 兜底）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise ValueError("内容不存在")
    if c.transcript_kind == "original" and c.transcript and not force:
        return c
    if not c.video_url:
        raise RuntimeError("该内容无视频直链（play_url 未采集到），无法提取原字幕；可改用粘贴/文件导入逐字稿")
    if not force and c.id in _TRANSCRIBING:
        raise RuntimeError("该内容正在后台自动转写中，稍候刷新即可查看")
    _TRANSCRIBING.add(c.id)
    try:
        return await _extract_subtitle_inner(db, c)
    finally:
        _TRANSCRIBING.discard(c.id)


async def _extract_subtitle_inner(db: Session, c: RadarContent) -> RadarContent:
    import os
    import subprocess
    import tempfile
    import time

    def _download(url: str, dest: str, retry: int = 1) -> None:
        proc = subprocess.run(
            [
                "curl", "-sL", "--max-time", "120",
                "-A", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
                "-H", "Referer: https://www.douyin.com/",
                "-o", dest, url,
            ],
            capture_output=True,
            text=True,
            timeout=150,
        )
        if proc.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 1024:
            if retry > 0:
                time.sleep(2)
                _download(url, dest, retry - 1)
            else:
                raise RuntimeError("视频下载失败（直链可能已过期）")

    workdir = tempfile.mkdtemp(prefix="radar_asr_")
    try:
        mp4 = os.path.join(workdir, "v.mp4")
        wav = os.path.join(workdir, "a.wav")
        try:
            _download(c.video_url, mp4)
        except RuntimeError:
            src = db.get(SourceAccount, c.source_id) if c.source_id else None
            refreshed = ""
            if src and src.sec_uid:
                try:
                    data = _run_opencli(["douyin", "user-videos", src.sec_uid, "--with_comments", "false"])
                    items = data if isinstance(data, list) else data.get("videos") or data.get("data") or data.get("items") or []
                    for it in items:
                        if (it.get("aweme_id") or "").strip() == (c.aweme_id or "").strip():
                            refreshed = it.get("play_url") or it.get("video") or it.get("video_url") or it.get("url") or ""
                            break
                except Exception:
                    refreshed = ""
            if not refreshed:
                raise RuntimeError("视频下载失败：原直链已过期且刷新失败（可对信源点「同步」后重试）")
            c.video_url = refreshed
            db.commit()
            _download(refreshed, mp4)
        fp = subprocess.run(
            ["ffmpeg", "-y", "-i", mp4, "-vn", "-ac", "1", "-ar", "16000", wav],
            capture_output=True,
            text=True,
            timeout=240,
        )
        if fp.returncode != 0 or not os.path.exists(wav):
            raise RuntimeError("音频提取失败：" + (fp.stderr or "")[-200:])
        try:
            text = await _transcribe_with_ark(wav)
        except Exception as ark_e:
            try:
                text = _transcribe_with_faster_whisper(wav)
            except Exception as fw_e:
                raise RuntimeError(f"语音转写失败：方舟通道 {str(ark_e)[:150]}；本地通道 {str(fw_e)[:150]}")
        c.transcript = f"【原视频语音转写】\n{text}"
        c.transcript_kind = "original"
        c.transcript_status = "ready"
        c.transcript_ai = ""
        db.commit()
        return c
    finally:
        import shutil
        shutil.rmtree(workdir, ignore_errors=True)


async def rewrite_transcript(db: Session, account_id: int | None, content_id: int) -> RadarContent:
    """AI 改写：基于原字幕改写为更精炼的口播/文案稿。"""
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise ValueError("内容不存在")
    base = c.transcript or ""
    if not base.strip():
        raise RuntimeError("请先提取原字幕或录入逐字稿，再进行 AI 改写")
    prompt = (
        "你是一位资深编导，请把下面的视频原字幕改写成一段更精炼、口语化、有钩子的口播稿"
        "（不超过 400 字，保留原意与关键信息，结构：钩子→核心→展开→收尾引导关注）。"
        "只基于原文改写，不得新增未出现的事实。\n\n原文：\n" + base[:3000]
    )
    try:
        text = await ark_svc.chat(
            [{"role": "user", "content": prompt}],
            model=ark_svc.settings.ark_model_lite,
            temperature=0.7,
            max_tokens=1200,
        )
    except Exception as e:
        raise RuntimeError(f"AI 改写失败：{e}")
    c.transcript_ai = f"【AI 改写稿】\n{text.strip()}"
    db.commit()
    return c


async def transcribe(db: Session, account_id: int | None, content_id: int) -> RadarContent:
    """AI 转写（兜底）：无视频直链/无 ASR 时，基于公开描述生成逐字稿草稿（如实标注）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise ValueError("内容不存在")
    prompt = (
        "你是一位编导，请根据以下抖音视频的公开标题与描述，补写一份可作为创作参考的口播逐字稿草稿"
        "（不超过 400 字，口语化，先给核心结论再展开）。"
        "只基于给出的公开信息，不得编造未给出的数据/事实。\n\n"
        f"标题：{c.title}\n描述：{c.desc}"
    )
    try:
        text = await ark_svc.chat(
            [{"role": "user", "content": prompt}],
            model=ark_svc.settings.ark_model_lite,
            temperature=0.5,
            max_tokens=1200,
        )
    except Exception as e:
        raise RuntimeError(f"AI 转写失败：{e}")
    c.transcript = f"【AI 基于公开描述生成的逐字稿草稿】\n{text.strip()}"
    c.transcript_kind = "ai"
    c.transcript_status = "ready"
    db.commit()
    return c


async def draft_topic(db: Session, account_id: int | None, content_id: int) -> dict:
    """生成选题候选（不写库，确认后才写入）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise ValueError("内容不存在")
    from . import assistant as assistant_svc
    position = assistant_svc.load_position_text(db, aid)
    from ..models import Formula
    fs = db.query(Formula).filter(Formula.account_id == aid, Formula.status == "adopted").order_by(Formula.confidence.desc()).limit(5).all()
    formulas = "\n".join(f"- {f.title}：{f.content}" for f in fs)
    prompt = (
        "你是编导，请基于下面雷达内容与账号定位，生成一条可直接立项的选题候选。"
        "输出 JSON，字段含 title(标题不超过40字), audience(目标人群), pain_point(痛点), "
        "core_decision(核心决策), hook(开头钩子), form(内容形式), difficulty(难度 简单/中等/困难)。"
        "只基于给出信息，不编造数据。\n\n"
        f"内容标题：{c.title}\n内容描述：{c.desc}\n"
        f"账号定位：{position or '（未设置）'}\n复盘公式：{formulas or '（无）'}"
    )
    try:
        text = await ark_svc.chat(
            [{"role": "user", "content": prompt}],
            model=ark_svc.settings.ark_model_lite,
            temperature=0.6,
            max_tokens=800,
        )
    except Exception as e:
        raise RuntimeError(f"AI 生成选题候选失败：{e}")
    try:
        draft = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
    except Exception:
        draft = {"title": (c.title or c.desc)[:40]}
    draft.setdefault("title", (c.title or c.desc)[:40])
    draft.setdefault("audience", "")
    draft.setdefault("pain_point", "")
    draft.setdefault("core_decision", "")
    draft.setdefault("hook", (c.title or c.desc)[:80])
    draft.setdefault("form", "口播")
    draft.setdefault("difficulty", "medium")
    return {"draft": draft}


def adopt_topic(db: Session, account_id: int | None, content_id: int, draft: dict) -> dict:
    """确认写入选题（对标「转为我的选题」确认步骤）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise ValueError("内容不存在")
    if c.status == "upgraded":
        raise ValueError("该内容已升级为项目")
    t = Topic(
        account_id=aid,
        title=(draft.get("title") or c.title or (c.desc[:80] if c.desc else "雷达内容"))[:256],
        source="radar",
        audience=draft.get("audience", ""),
        pain_point=draft.get("pain_point", ""),
        core_decision=draft.get("core_decision", ""),
        hook=(draft.get("hook") or (c.title or c.desc))[:200],
        form=draft.get("form", ""),
        difficulty=draft.get("difficulty", "medium"),
        material_count=1,
        status="pending_review",
    )
    db.add(t)
    c.status = "topicized"
    db.commit()
    db.refresh(t)
    return {"topic": {"id": t.id, "title": t.title, "status": t.status}}


async def auto_breakdown(db: Session, real_limit: int = 2, draft_limit: int = 3) -> dict:
    """自动拆解：最新未转写内容优先真实原字幕转写，失败/无直链回退 AI 草稿。"""
    real_done = draft_done = 0
    pending = (
        db.query(RadarContent)
        .filter(RadarContent.transcript_status != "ready")
        .order_by(RadarContent.collected_at.desc())
        .limit(real_limit + draft_limit)
        .all()
    )
    for c in pending[:real_limit]:
        if c.transcript_status == "ready" or not c.video_url:
            continue
        if c.id in _TRANSCRIBING:
            continue
        try:
            await extract_subtitle(db, c.account_id, c.id)
            real_done += 1
        except Exception as e:
            logger.warning("预转写失败 content_id=%s: %s", c.id, str(e)[:200])
            db.rollback()
            continue
    for c in pending:
        if c.transcript_status == "ready":
            continue
        try:
            prompt = (
                "你是一位编导，请根据以下抖音视频的公开标题与描述，补写一份可作为创作参考的口播逐字稿草稿"
                "（不超过 300 字，口语化，先给核心结论再展开）。"
                "只基于给出的公开信息，不得编造未给出的数据/事实。\n\n"
                f"标题：{c.title}\n描述：{c.desc}"
            )
            text = await ark_svc.chat(
                [{"role": "user", "content": prompt}],
                model=ark_svc.settings.ark_model_lite,
                temperature=0.5,
                max_tokens=1000,
            )
            c.transcript = f"【AI 基于公开描述生成的逐字稿草稿】\n{text.strip()}"
            c.transcript_status = "ready"
            draft_done += 1
        except Exception:
            continue
    db.commit()
    return {"real": real_done, "draft": draft_done}


def parse_share_link(db: Session, account_id: int | None, url: str) -> dict:
    """粘贴分享链接收录。"""
    aid = accounts_svc.resolve_account(db, account_id)
    if not url.strip():
        raise ValueError("链接不能为空")
    resolved = url.strip()
    try:
        import urllib.request
        req = urllib.request.Request(resolved, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            resolved = resp.geturl()
    except Exception:
        pass
    aweme = _extract_aweme_id(resolved)
    if not aweme:
        raise ValueError("未能从链接解析出作品 ID，请直接粘贴含 /video/ 的链接或使用关键词收录")
    exists = db.query(RadarContent).filter(RadarContent.account_id == aid, RadarContent.aweme_id == aweme).first()
    if exists:
        return {"content": {"id": exists.id, "aweme_id": aweme, "title": exists.title}, "added": False}
    try:
        data = _run_opencli(["douyin", "stats", aweme], timeout=60)
        item = data if isinstance(data, dict) else (data[0] if data else {})
    except Exception as e:
        raise RuntimeError(f"已解析作品 ID {aweme}，但拉取公开数据失败：{e}")
    c = RadarContent(
        account_id=aid,
        author=str(item.get("author") or item.get("nickname") or "未知博主"),
        aweme_id=aweme,
        title=str(item.get("title") or (item.get("desc") or "")[:80] or f"抖音作品 {aweme}"),
        desc=str(item.get("desc") or item.get("title") or ""),
        cover_url=str(item.get("cover") or item.get("cover_url") or ""),
        video_url=str(item.get("video") or item.get("video_url") or ""),
        source_url=_norm_source_url(resolved, aweme),
        play_count=int(item.get("play_count") or item.get("plays") or 0),
        digg_count=int(item.get("digg_count") or item.get("likes") or 0),
        comment_count=int(item.get("comment_count") or item.get("comments") or 0),
        share_count=int(item.get("share_count") or item.get("shares") or 0),
        collect_count=int(item.get("collect_count") or 0),
        publish_time=_parse_publish_time(item.get("create_time")),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"content": {"id": c.id, "aweme_id": aweme, "title": c.title}, "added": True}


def upgrade(db: Session, account_id: int | None, content_id: int) -> dict:
    """升级为项目：建已立项选题 + 项目草稿（preparing）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise ValueError("内容不存在")
    if c.status == "upgraded":
        raise ValueError("该内容已升级为项目")
    t = Topic(
        account_id=aid,
        title=c.title or (c.desc[:80] if c.desc else "雷达内容"),
        source="radar",
        audience="",
        pain_point="",
        core_decision="",
        hook=(c.title or c.desc)[:80] if (c.title or c.desc) else "",
        material_count=1,
        difficulty="medium",
        status="approved",
    )
    db.add(t)
    db.flush()
    p = Project(
        account_id=aid,
        topic_id=t.id,
        title=t.title,
        status="preparing",
        progress="由内容雷达升级，选题已定，准备备料",
    )
    db.add(p)
    c.status = "upgraded"
    db.commit()
    db.refresh(t)
    db.refresh(p)
    return {"topic": {"id": t.id, "title": t.title, "status": t.status}, "project_id": p.id, "project_title": p.title}
