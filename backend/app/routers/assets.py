"""素材与知识库 API：创建自动向量化 + 语义检索。"""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import String, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Knowledge, Material
from ..schemas import KnowledgeCreate, MaterialCreate
from ..services import accounts as accounts_svc
from ..services import embedding as emb

router = APIRouter(tags=["assets"])


def _mat(m: Material):
    return {
        "id": m.id,
        "kind": m.kind,
        "title": m.title,
        "content": m.content,
        "tags": m.tags,
        "source_url": m.source_url,
        "project_id": m.project_id,
        "file_name": m.file_name,
        "file_size": m.file_size,
        "deleted": m.deleted,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "embedded": bool(m.embedding),
        "url": (f"/uploads/{Path(m.local_path).name}" if m.local_path and m.kind in ("image", "video") else None),
    }


def _kn(k: Knowledge):
    import json as _json
    try:
        tags = k.tags if isinstance(k.tags, list) else _json.loads(k.tags or "[]")
        if not isinstance(tags, list):
            tags = [str(tags)]
    except Exception:
        tags = []
    src = (k.source_url or "").strip()
    if not src and k.source and k.source.startswith("douyin:"):
        src = f"https://www.douyin.com/video/{k.source.split(':', 1)[1]}"
    return {
        "id": k.id,
        "title": k.title,
        "content": k.content,
        "source": k.source,
        "source_url": src,
        "tags": tags,
        "embedded": bool(k.embedding),
        "created_at": k.created_at.isoformat() if k.created_at else None,
    }


@router.get("/api/materials")
def list_materials(project_id: int | None = None, trash: bool = False, q: str | None = None, kind: str | None = None, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    search_kw = (q or '').strip()
    aid = accounts_svc.resolve_account(db, account_id)
    qq = db.query(Material).filter(Material.account_id == aid, Material.deleted.is_(trash)).order_by(Material.id.desc())
    if project_id:
        qq = qq.filter(Material.project_id == project_id)
    if search_kw:
        like = f"%{search_kw}%"
        qq = qq.filter(Material.title.like(like) | Material.content.like(like) | Material.tags.cast(String).like(like))
    if kind:
        qq = qq.filter(Material.kind == kind)
    return {"materials": [_mat(m) for m in qq.all()]}


@router.get("/api/materials/stats")
def material_stats(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """素材类型统计 + 存储大小 + 项目分布（对标：图片/视频/音频/文档/字幕 + 存储空间）。"""
    aid = accounts_svc.resolve_account(db, account_id)
    from sqlalchemy import func
    rows = (
        db.query(Material.kind, func.count(Material.id), func.coalesce(func.sum(Material.file_size), 0))
        .filter(Material.account_id == aid, Material.deleted.is_(False))
        .group_by(Material.kind)
        .all()
    )
    counts = {k: {"count": c, "size": int(s)} for k, c, s in rows}
    by_project = (
        db.query(Material.project_id, func.count(Material.id))
        .filter(Material.account_id == aid, Material.deleted.is_(False), Material.project_id.isnot(None))
        .group_by(Material.project_id)
        .all()
    )
    total_count = sum(v["count"] for v in counts.values())
    total_size = sum(v["size"] for v in counts.values())
    return {
        "counts": counts,
        "total": {"count": total_count, "size": total_size},
        "by_project": {str(pid): c for pid, c in by_project},
    }


@router.patch("/api/materials/{material_id}/trash")
def trash_material(material_id: int, body: dict, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    m = db.get(Material, material_id)
    if not m or m.account_id != aid:
        raise HTTPException(status_code=404, detail="素材不存在")
    m.deleted = bool(body.get("deleted", True))
    db.commit()
    return {"ok": True, "deleted": m.deleted}


@router.delete("/api/materials/{material_id}")
def delete_material(material_id: int, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    m = db.get(Material, material_id)
    if not m or m.account_id != aid:
        raise HTTPException(status_code=404, detail="素材不存在")
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.post("/api/materials")
async def create_material(payload: MaterialCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    m = Material(account_id=accounts_svc.resolve_account(db, account_id),**payload.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    # 异步向量化（失败不影响创建）
    try:
        text = f"{m.title}\n{m.content}"
        m.embedding = await emb.embed_text(text)
        db.commit()
    except (emb.EmbeddingError, Exception):
        pass
    return {"material": _mat(m)}


EXT_TO_KIND = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".bmp": "image", ".heic": "image",
    ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video", ".webm": "video",
    ".mp3": "audio", ".wav": "audio", ".aac": "audio", ".m4a": "audio", ".flac": "audio",
    ".pdf": "document", ".doc": "document", ".docx": "document", ".xls": "document", ".xlsx": "document", ".ppt": "document", ".pptx": "document", ".txt": "document", ".md": "document",
    ".srt": "subtitle", ".ass": "subtitle", ".vtt": "subtitle",
    ".html": "link", ".htm": "link",
}
TEXT_LIKE = {".txt", ".md", ".srt", ".ass", ".vtt", ".html", ".htm", ".docx", ".pdf"}


@router.post("/api/materials/upload")
async def upload_material(file: UploadFile = File(...), db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """素材文件上传：按扩展名分类入库，存本地 uploads 目录；文本类自动向量化。"""
    aid = accounts_svc.resolve_account(db, account_id)
    name = file.filename or "untitled"
    ext = Path(name).suffix.lower()
    kind = EXT_TO_KIND.get(ext, "document")
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    upload_dir = Path(__file__).resolve().parents[2] / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in Path(name).name if c.isalnum() or c in "._- ").strip() or "file"
    target = upload_dir / f"{aid}_{int(__import__('time').time() * 1000)}_{safe}"

    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)
        out.flush()
    size = target.stat().st_size if target.exists() else (file.size or 0)

    content = ""
    if ext in TEXT_LIKE:
        try:
            content = target.read_text(encoding="utf-8", errors="ignore")[:4000]
        except Exception:
            content = ""

    m = Material(
        account_id=aid,
        kind=kind,
        title=Path(name).stem,
        content=content,
        tags=["upload"],
        file_name=name,
        file_size=size,
        local_path=str(target),
    )
    db.add(m)
    db.commit()
    db.refresh(m)

    if ext in TEXT_LIKE and content:
        try:
            m.embedding = await emb.embed_text(f"{m.title}\n{content}")
            db.commit()
        except Exception:
            pass
    return {"material": _mat(m)}


@router.get("/api/knowledge")
def list_knowledge(source: str | None = None, q: str | None = None, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    query = db.query(Knowledge).filter(Knowledge.account_id == aid)
    if source:
        query = query.filter(Knowledge.source == source)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Knowledge.title.like(like), Knowledge.content.like(like)))
    items = query.order_by(Knowledge.id.desc()).all()
    return {"knowledge": [_kn(k) for k in items]}


@router.get("/api/knowledge/search")
async def knowledge_search(q: str, source: str | None = None, top_k: int = 8, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """知识库专用语义搜索：本地余弦计算，返回知识条目详情。"""
    if not q.strip():
        return {"results": []}
    aid = accounts_svc.resolve_account(db, account_id)
    qq = db.query(Knowledge).filter(Knowledge.account_id == aid, Knowledge.embedding.isnot(None))
    if source:
        qq = qq.filter(Knowledge.source == source)
    items = []
    for k in qq.all():
        items.append({"id": k.id, "label": f"知识：{k.title}", "embedding": k.embedding, "kind": "knowledge", "payload": k})
    if not items:
        return {"results": []}
    try:
        query_vec = await emb.embed_text(q)
    except Exception:
        return {"results": []}
    ranked = emb.cosine_search(query_vec, items, top_k=top_k)
    ids = [r.get("id") for r in ranked if r.get("id")]
    results = []
    by_id = {k.id: k for k in db.query(Knowledge).filter(Knowledge.id.in_(ids)).all()} if ids else {}
    for r in ranked:
        k = by_id.get(r.get("id"))
        if not k:
            continue
        _src = (k.source_url or "").strip()
        if not _src and k.source and k.source.startswith("douyin:"):
            _src = f"https://www.douyin.com/video/{k.source.split(':', 1)[1]}"
        results.append({
            "id": k.id,
            "title": k.title,
            "content": k.content[:300],
            "source": k.source,
            "source_url": _src,
            "tags": k.tags,
            "score": r.get("score", 0),
        })
    return {"results": results}


@router.post("/api/knowledge")
async def create_knowledge(payload: KnowledgeCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    k = Knowledge(account_id=accounts_svc.resolve_account(db, account_id),**payload.model_dump())
    db.add(k)
    db.commit()
    db.refresh(k)
    try:
        text = f"{k.title}\n{k.content}"
        k.embedding = await emb.embed_text(text)
        db.commit()
    except (emb.EmbeddingError, Exception):
        pass
    return {"knowledge": _kn(k)}


@router.post("/api/reindex")
async def reindex(db: Session = Depends(get_db)):
    """为未向量化的素材与知识补充向量。"""
    done, failed = 0, 0
    for m in db.query(Material).filter(Material.embedding.is_(None)).all():
        try:
            m.embedding = await emb.embed_text(f"{m.title}\n{m.content}")
            done += 1
        except Exception:
            failed += 1
    for k in db.query(Knowledge).filter(Knowledge.embedding.is_(None)).all():
        try:
            k.embedding = await emb.embed_text(f"{k.title}\n{k.content}")
            done += 1
        except Exception:
            failed += 1
    db.commit()
    return {"reindexed": done, "failed": failed}


@router.get("/api/search")
async def semantic_search(
    q: str,
    types: str = "materials,knowledge",
    top_k: int = 5,
    db: Session = Depends(get_db),
):
    """语义检索素材与知识库。本地余弦计算（向量为建库时生成）。"""
    if not q.strip():
        return {"results": []}
    want = types.split(",")
    items = []
    if "materials" in want:
        for m in db.query(Material).filter(Material.embedding.isnot(None)).all():
            items.append({"id": m.id, "label": f"素材：{m.title}", "embedding": m.embedding})
    if "knowledge" in want:
        for k in db.query(Knowledge).filter(Knowledge.embedding.isnot(None)).all():
            items.append({"id": k.id, "label": f"知识：{k.title}", "embedding": k.embedding})
    if not items:
        return {"results": []}
    try:
        query_vec = await emb.embed_text(q)
    except Exception:
        return {"results": []}
    results = emb.cosine_search(query_vec, items, top_k=top_k)
    return {"results": results}
