"""内容雷达 API：信源来源管理 + 内容库 + 转写 + 升级。"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Knowledge, RadarContent, SourceAccount, RadarSnapshot
from ..services import accounts as accounts_svc
from ..services import radar as radar_svc

router = APIRouter(prefix="/api/radar", tags=["radar"])


class SourceCreate(BaseModel):
    name: str
    sec_uid: str = ""
    description: str = ""
    auto_sync: bool = True


class ContentPatch(BaseModel):
    favorite: bool | None = None
    transcript: str | None = None
    transcript_status: str | None = None


class SearchCollect(BaseModel):
    keyword: str
    limit: int = 10


def _serialize_source(s: SourceAccount):
    return {
        "id": s.id,
        "name": s.name,
        "sec_uid": s.sec_uid,
        "description": s.description,
        "category": s.category,
        "sync_status": s.sync_status,
        "auto_sync": s.auto_sync,
        "last_synced_at": s.last_synced_at.isoformat() if s.last_synced_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _serialize_content(c: RadarContent):
    return {
        "id": c.id,
        "source_id": c.source_id,
        "author": c.author,
        "aweme_id": c.aweme_id,
        "title": c.title,
        "desc": c.desc,
        "cover_url": c.cover_url,
        "video_url": c.video_url,
        "source_url": c.source_url,
        "play_count": c.play_count,
        "digg_count": c.digg_count,
        "comment_count": c.comment_count,
        "share_count": c.share_count,
        "collect_count": c.collect_count,
        "transcript": c.transcript,
        "transcript_ai": c.transcript_ai or "",
        "transcript_kind": c.transcript_kind or "ai",
        "transcript_status": c.transcript_status,
        "favorite": c.favorite,
        "status": c.status,
        "in_knowledge": bool(c.knowledge_id),
        "hashtags": list(dict.fromkeys(re.findall(r"#([\w\u4e00-\u9fa5]+)", f"{c.title} {c.desc}")))[:5],
        "publish_time": c.publish_time.isoformat() if c.publish_time else None,
        "collected_at": c.collected_at.isoformat() if c.collected_at else None,
    }


@router.get("/stats")
def stats(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    total = db.query(RadarContent).filter(RadarContent.account_id == aid).count()
    favorites = db.query(RadarContent).filter(RadarContent.account_id == aid, RadarContent.favorite.is_(True)).count()
    pending = db.query(RadarContent).filter(RadarContent.account_id == aid, RadarContent.transcript_status == "pending").count()
    sources = db.query(SourceAccount).filter(SourceAccount.account_id == aid).count()
    return {"total": total, "favorites": favorites, "pending_transcripts": pending, "sources": sources}


@router.get("/sources")
def list_sources(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    sources = db.query(SourceAccount).filter(SourceAccount.account_id == aid).order_by(SourceAccount.id).all()
    counts = {}
    for s in sources:
        counts[s.id] = db.query(RadarContent).filter(RadarContent.source_id == s.id).count()
    return {
        "sources": [
            {**_serialize_source(s), "content_count": counts.get(s.id, 0)}
            for s in sources
        ]
    }


@router.post("/sources")
def add_source(payload: SourceCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    s = SourceAccount(
        account_id=aid,
        name=payload.name,
        sec_uid=payload.sec_uid,
        description=payload.description,
        auto_sync=payload.auto_sync,
        sync_status="pending",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    result = None
    if payload.sec_uid:
        try:
            result = radar_svc.sync_user_source(db, aid, s.id)
        except Exception as e:
            s.sync_status = "error"
            db.commit()
            from ..services import alerts as alerts_svc
            alerts_svc.push_alert(
                db, aid, "error", f"信源博主「{s.name}」同步失败", str(e), source_type="radar_sync", source_id=s.id,
            )
            result = {"error": str(e)}
    return {"source": _serialize_source(s), "sync": result}


@router.patch("/sources/{source_id}")
def patch_source(source_id: int, body: dict, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    s = db.get(SourceAccount, source_id)
    if not s or s.account_id != aid:
        raise HTTPException(status_code=404, detail="信源不存在")
    if "auto_sync" in body:
        s.auto_sync = bool(body["auto_sync"])
    if "name" in body:
        s.name = str(body["name"])
    if "category" in body:
        s.category = str(body["category"])
    db.commit()
    return {"source": _serialize_source(s)}


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    s = db.get(SourceAccount, source_id)
    if not s or s.account_id != aid:
        raise HTTPException(status_code=404, detail="信源不存在")
    # 级联删除该信源的雷达内容与指标快照（删除博主即清理其内容）
    from ..models import RadarSnapshot

    cids = [cid for (cid,) in db.query(RadarContent.id).filter(RadarContent.source_id == s.id).all()]
    if cids:
        db.query(RadarSnapshot).filter(RadarSnapshot.content_id.in_(cids)).delete(synchronize_session=False)
        db.query(RadarContent).filter(RadarContent.source_id == s.id).delete(synchronize_session=False)
    db.delete(s)
    db.commit()
    return {"ok": True, "removed_contents": len(cids)}


@router.post("/sources/{source_id}/sync")
def sync_source(source_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    s = db.get(SourceAccount, source_id)
    try:
        result = radar_svc.sync_user_source(db, aid, source_id)
        return result
    except Exception as e:
        s = db.get(SourceAccount, source_id)
        if s:
            s.sync_status = "error"
            db.commit()
            from ..services import alerts as alerts_svc
            alerts_svc.push_alert(
                db, aid, "error", f"信源博主「{s.name}」同步失败", str(e), source_type="radar_sync", source_id=s.id,
            )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
def search_and_collect(payload: SearchCollect, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        return radar_svc.sync_search(db, aid, payload.keyword, payload.limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/contents")
def list_contents(
    filter: str = Query("all"),  # all / favorites / pending（左栏快捷筛选）
    source_id: int | None = Query(None),
    category: str | None = Query(None),  # 自定义分类（按来源分类筛选）
    q: str = "",
    ts: str = Query("all"),  # 逐字稿维度：all / ready / pending
    topic: str = Query("all"),  # 选题维度：all / done(已转选题或项目) / undone
    sort: str = Query("latest"),  # latest / hot
    db: Session = Depends(get_db),
    account_id: int | None = Query(None),
):
    aid = accounts_svc.resolve_account(db, account_id)
    query = db.query(RadarContent).filter(RadarContent.account_id == aid)
    if filter == "favorites":
        query = query.filter(RadarContent.favorite.is_(True))
    elif filter == "pending":
        query = query.filter(RadarContent.transcript_status == "pending")
    if source_id:
        query = query.filter(RadarContent.source_id == source_id)
    if category:
        sub = db.query(SourceAccount.id).filter(
            SourceAccount.account_id == aid, SourceAccount.category == category
        )
        query = query.filter(RadarContent.source_id.in_(sub))
    if ts == "ready":
        query = query.filter(RadarContent.transcript_status == "ready")
    elif ts == "pending":
        query = query.filter(RadarContent.transcript_status == "pending")
    if topic == "done":
        query = query.filter(RadarContent.status.in_(["topicized", "upgraded"]))
    elif topic == "undone":
        query = query.filter(RadarContent.status.notin_(["topicized", "upgraded"]))
    if q:
        like = f"%{q}%"
        query = query.filter(
            (RadarContent.title.like(like)) | (RadarContent.desc.like(like)) | (RadarContent.author.like(like))
        )
    from sqlalchemy import case, func
    if sort == "hot":
        rows = query.order_by(RadarContent.digg_count.desc(), RadarContent.collected_at.desc()).all()
    else:
        # 「最新发布」按作品发布时间排（存量缺失时回退采集时间）
        rows = (
            query.order_by(
                case((RadarContent.publish_time.is_(None), 0), else_=1).desc(),
                func.coalesce(RadarContent.publish_time, RadarContent.collected_at).desc(),
            )
            .all()
        )
    return {"contents": [_serialize_content(c) for c in rows]}


@router.get("/contents/{content_id}/metrics")
def content_metrics(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """单条雷达内容的历史指标快照（趋势数据源）。"""
    c = db.get(RadarContent, content_id)
    if not c:
        raise HTTPException(status_code=404, detail="内容不存在")
    snaps = (
        db.query(RadarSnapshot)
        .filter(RadarSnapshot.content_id == content_id)
        .order_by(RadarSnapshot.date)
        .all()
    )
    return {
        "content_id": content_id,
        "current": {
            "play": c.play_count, "digg": c.digg_count,
            "comment": c.comment_count, "collect": c.collect_count, "share": c.share_count,
        },
        "history": [
            {"date": x.date, "play_count": x.play_count, "digg_count": x.digg_count,
             "comment_count": x.comment_count, "collect_count": x.collect_count, "share_count": x.share_count}
            for x in snaps
        ],
    }


@router.patch("/contents/{content_id}")
def patch_content(content_id: int, payload: ContentPatch, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise HTTPException(status_code=404, detail="内容不存在")
    if payload.favorite is not None:
        c.favorite = payload.favorite
    if payload.transcript is not None:
        c.transcript = payload.transcript
    if payload.transcript_status is not None:
        c.transcript_status = payload.transcript_status
    db.commit()
    return {"content": _serialize_content(c)}


@router.post("/contents/{content_id}/to-knowledge")
async def content_to_knowledge(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """雷达作品一键入库知识库：source=video，带来源链接，正文=描述+逐字稿。"""
    c = db.get(RadarContent, content_id)  # type: ignore
    if not c:
        raise HTTPException(status_code=404, detail="内容不存在")
    aid = accounts_svc.resolve_account(db, account_id)
    exists = db.query(Knowledge).filter(
        Knowledge.account_id == aid, Knowledge.source_url == c.source_url, Knowledge.source == "video"
    ).first()
    if exists:
        return {"ok": True, "knowledge": {"id": exists.id, "title": exists.title}, "duplicated": True}
    body = (c.desc or "").strip()
    if (c.transcript_ai or "").strip():
        body += f"\n【逐字稿】\n{c.transcript_ai}"
    elif (c.transcript or "").strip():
        body += f"\n【逐字稿】\n{c.transcript}"
    title = (c.title or "").strip() or f"{c.author} 作品拆解"
    _src = (c.source_url or "").strip()
    if _src.startswith(("http://", "https://")) and "douyinvod.com" in _src and c.aweme_id:
        _src = f"https://www.douyin.com/video/{c.aweme_id}"
    k = Knowledge(
        account_id=aid,
        title=title[:250],
        content=body[:6000] or title,
        source="video",
        source_url=_src,
        tags=["雷达", c.author or "对标博主"],
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    from ..services import embedding as emb
    try:
        k.embedding = await emb.embed_text(f"{k.title}\n{k.content}")
        db.commit()
    except Exception:
        pass
    c.knowledge_id = k.id
    db.commit()
    return {"ok": True, "knowledge": {"id": k.id, "title": k.title}, "duplicated": False}


@router.post("/contents/{content_id}/extract-subtitle")
async def extract_subtitle(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        c0 = db.get(RadarContent, content_id)
        skipped = c0 is not None and c0.transcript_kind == "original" and bool(c0.transcript)
        c = await radar_svc.extract_subtitle(db, aid, content_id)
        return {"skipped": skipped, "content": _serialize_content(c)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/contents/{content_id}/rewrite-transcript")
async def rewrite_transcript(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        c = await radar_svc.rewrite_transcript(db, aid, content_id)
        return {"content": _serialize_content(c)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/contents/{content_id}/transcribe")
async def transcribe(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        c = await radar_svc.transcribe(db, aid, content_id)
        return {"content": _serialize_content(c)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/contents/{content_id}/upgrade")
def upgrade(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        return radar_svc.upgrade(db, aid, content_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 分类（对标「新建分类」） ----------

def _category_rows(db: Session, aid: int):
    """合并两类分类：来源上已归类的 + 独立登记的分类表。返回 (name, source_count)。"""
    from app.models import RadarCategory
    counts = dict(
        db.query(SourceAccount.category, func.count(SourceAccount.id))
        .filter(SourceAccount.account_id == aid, SourceAccount.category != "")
        .group_by(SourceAccount.category)
        .all()
    )
    names = [r[0] for r in db.query(RadarCategory.name).filter(RadarCategory.account_id == aid).distinct().all()]
    for n in list(counts):
        if n not in names:
            names.append(n)
    return [{"name": n, "source_count": counts.get(n, 0)} for n in names]


@router.get("/categories")
def list_categories(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    return {"categories": _category_rows(db, aid)}


class CategoryCreate(BaseModel):
    name: str


@router.post("/categories")
def create_category(payload: CategoryCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名不能为空")
    from app.models import RadarCategory
    exists = db.query(RadarCategory.id).filter(RadarCategory.account_id == aid, RadarCategory.name == name).first()
    if not exists:
        db.add(RadarCategory(account_id=aid, name=name))
        db.commit()
    return {"categories": _category_rows(db, aid)}


# ---------- 粘贴分享链接收录（对标「粘贴分享链接」） ----------

class PasteLink(BaseModel):
    url: str


@router.post("/paste-link")
def paste_link(payload: PasteLink, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        return radar_svc.parse_share_link(db, aid, payload.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 选题候选（对标「转为我的选题 / 生成选题候选」） ----------

@router.post("/contents/{content_id}/draft-topic")
async def draft_topic(content_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        return await radar_svc.draft_topic(db, aid, content_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AdoptTopic(BaseModel):
    draft: dict


@router.post("/contents/{content_id}/adopt-topic")
def adopt_topic(content_id: int, payload: AdoptTopic, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    try:
        return radar_svc.adopt_topic(db, aid, content_id, payload.draft)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 从文件导入逐字稿（对标「添加逐字稿 … 或从文件导入」） ----------

@router.post("/contents/{content_id}/transcript-file")
async def upload_transcript_file(
    content_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    account_id: int | None = Query(None),
):
    aid = accounts_svc.resolve_account(db, account_id)
    c = db.get(RadarContent, content_id)
    if not c or c.account_id != aid:
        raise HTTPException(status_code=404, detail="内容不存在")
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    if not text.strip():
        raise HTTPException(status_code=400, detail="文件内容为空")
    c.transcript = f"【文件导入 {file.filename}】\n{text.strip()[:50000]}"
    c.transcript_status = "ready"
    db.commit()
    return {"content": _serialize_content(c), "chars": len(text.strip())}
