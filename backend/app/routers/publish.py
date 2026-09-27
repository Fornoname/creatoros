"""发布中心 API：平台状态、发布/草稿、数据拉取、封面生成。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, Metric, Project, Publication
from ..services import cover as cover_svc
from ..services import publish as publish_svc

router = APIRouter(prefix="/api/publish", tags=["publish"])


class PublishRequest(BaseModel):
    platform: str = "douyin"
    title: str
    description: str = ""
    video_path: str = ""
    mode: str = "draft"   # draft / publish
    account_id: int | None = None          # 指定账号发布（走该账号独立 profile）
    project_id: int | None = None          # 关联项目（从项目一键发布/挂回项目）
    schedule_at: str = ""                  # 定时发布时间（平台原生定时发布，2h~14 天内）


class CoverRequest(BaseModel):
    project_id: int
    prompt: str


@router.get("/platforms")
async def platforms(db: Session = Depends(get_db)):
    status = await publish_svc.platform_status()
    # 合并本地账号记录
    for s in status:
        acc = db.query(Account).filter(Account.platform == s["platform"]).first()
        s["bound"] = acc is not None
    return {"platforms": status}


@router.post("")
async def submit_publish(payload: PublishRequest, db: Session = Depends(get_db)):
    """创建发布/草稿。草稿模式调用 opencli draft，发布模式调用 opencli publish。"""
    try:
        if payload.mode == "publish":
            result = await publish_svc.publish_now(
                payload.platform, payload.title, payload.description, payload.video_path,
                account_id=payload.account_id, schedule_at=payload.schedule_at,
            )
            status = "scheduled" if payload.schedule_at else "published"
        else:
            result = await publish_svc.create_draft(
                payload.platform, payload.title, payload.description, payload.video_path,
                account_id=payload.account_id,
            )
            status = "draft"
    except (publish_svc.PublishError, ValueError) as e:
        status_code = 400 if isinstance(e, ValueError) else 502
        raise HTTPException(status_code=status_code, detail=str(e))

    raw = result.get("raw", "")
    item_id = ""
    url = ""
    cover = ""
    published_at = None
    if isinstance(raw, dict):
        item_id = str(raw.get("aweme_id") or raw.get("item_id") or "")
        url = str(raw.get("url") or "")
        cover = str(raw.get("cover_url") or "")
        if status == "published" and not payload.schedule_at:
            from datetime import datetime, timezone
            published_at = datetime.now(timezone.utc)
    elif isinstance(raw, str) and not item_id:
        import re as _re
        m = _re.search(r"(\d{15,20})", raw)
        if m:
            item_id = m.group(1)
    pub = Publication(
        account_id=payload.account_id,
        project_id=payload.project_id,
        platform=payload.platform,
        title=payload.title,
        cover_url=cover,
        item_id=item_id,
        url=url,
        raw={"raw": raw[:2000]} if not isinstance(raw, dict) else raw,
        status=status,
        error="",
        published_at=published_at,
    )
    db.add(pub)
    db.commit()
    db.refresh(pub)
    return {
        "publication": {
            "id": pub.id,
            "platform": pub.platform,
            "status": pub.status,
            "title": pub.title,
            "item_id": pub.item_id,
        },
        "raw": raw if isinstance(raw, str) else "",
    }


@router.get("/records")
def list_records(db: Session = Depends(get_db)):
    items = db.query(Publication).order_by(Publication.created_at.desc()).limit(50).all()
    account_names = {
        a.id: a.display_name or a.username
        for a in db.query(Account).all()
    }
    return {
        "records": [
            {
                "id": p.id,
                "account": account_names.get(p.account_id, ""),
                "platform": p.platform,
                "status": p.status,
                "title": p.title,
                "item_id": p.item_id,
                "url": p.url,
                "project_id": p.project_id,
                "error": p.error,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in items
        ]
    }


@router.post("/records/sync")
async def sync_records(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """发布状态回流：拉平台最近作品（默认账号身份），按 item_id 对账本地发布记录，更新状态/链接。"""
    try:
        videos = await publish_svc.list_videos("douyin", limit=50)
    except publish_svc.PublishError as e:
        raise HTTPException(status_code=502, detail=str(e))
    updated, matched, total = 0, 0, len(videos)
    for v in videos:
        vid = str(v.get("aweme_id") or v.get("item_id") or "")
        if not vid:
            continue
        pub = db.query(Publication).filter(Publication.item_id == vid).first()
        if not pub:
            continue
        matched += 1
        changed = False
        plat_status = str(v.get("status") or "published")
        if plat_status in ("published", "scheduled", "draft") and pub.status != plat_status:
            pub.status = plat_status
            changed = True
        if v.get("title") and pub.title != v["title"]:
            pub.title = v["title"]
            changed = True
        if v.get("cover_url") and pub.cover_url != v["cover_url"]:
            pub.cover_url = v["cover_url"]
            changed = True
        if pub.status == "published" and not pub.published_at:
            from datetime import datetime, timezone
            pub.published_at = datetime.now(timezone.utc)
            changed = True
        if changed:
            updated += 1
    db.commit()
    return {"checked": total, "matched": matched, "updated": updated}


@router.get("/videos")
async def list_videos(platform: str = "douyin", limit: int = 5):
    try:
        videos = await publish_svc.list_videos(platform, limit)
    except publish_svc.PublishError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"videos": videos}


@router.get("/stats")
async def account_stats(platform: str = "douyin", db: Session = Depends(get_db)):
    try:
        stats = await publish_svc.account_stats(platform)
    except publish_svc.PublishError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # 记录账号指标快照
    m = Metric(
        platform=platform,
        item_id="account",
        raw=stats,
    )
    db.add(m)
    db.commit()
    return {"stats": stats}


@router.get("/overview")
async def platform_overview(db: Session = Depends(get_db)):
    """跨平台数据对比：并发拉取各平台账号资料 + 本地指标聚合。"""
    import asyncio as _asyncio

    platforms = ["douyin", "xiaohongshu", "bilibili"]
    results = {}

    async def _one(pl: str):
        try:
            st = await publish_svc.account_stats(pl)
            results[pl] = {"ok": True, "stats": st}
        except Exception as e:
            results[pl] = {"ok": False, "error": str(e)}

    await _asyncio.gather(*(_one(p) for p in platforms))

    # 本地指标聚合（排除 account 快照）
    agg = {}
    for m in db.query(Metric).filter(Metric.item_id != "account").all():
        agg.setdefault(m.platform, {"videos": 0, "views": 0.0, "likes": 0.0})
        agg[m.platform]["videos"] += 1
        agg[m.platform]["views"] += m.views or 0
        agg[m.platform]["likes"] += m.likes or 0

    return {"accounts": results, "local": agg}


@router.post("/cover")
async def generate_cover(payload: CoverRequest, db: Session = Depends(get_db)):
    """生成项目封面。优先 AI（Seedream，模型回退链），全部失败自动降级为程序化模板封面。"""
    project = db.get(Project, payload.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    ai_failed = False
    try:
        url = await cover_svc.generate_cover(payload.prompt)
    except cover_svc.CoverError:
        ai_failed = True
        url = cover_svc.generate_template_cover(payload.prompt)
    return {"cover_url": url, "project_id": project.id, "fallback": ai_failed}
