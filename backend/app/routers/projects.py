"""项目 API：详情、素材、论点骨架、脚本。"""
import json as _json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Material, PositionMaster, Project, Script, Topic
from ..config import settings
from ..schemas import MaterialCreate, ProjectUpdate, WorthWrite
from ..services import accounts as accounts_svc
from ..services import scripts as scripts_svc


async def _inject_knowledge(db: Session, query: str) -> str:
    """RAG：向量检索知识库 top-3 文本注入（无知识返回空）。"""
    from ..models import Knowledge
    from ..services import embedding as emb
    if not query.strip():
        return ""
    items = db.query(Knowledge).filter(Knowledge.embedding.isnot(None)).all()
    if not items:
        return ""
    try:
        qv = await emb.embed_text(query[:500])
    except Exception:
        return ""
    pool = [{"id": k.id, "label": k.title, "embedding": k.embedding} for k in items]
    ranked = emb.cosine_search(qv, pool, top_k=3)
    by_id = {k.id: k for k in items}
    lines = []
    for r in ranked:
        k = by_id.get(r.get("id"))
        if k:
            lines.append(f"- {k.title}：{k.content[:200]}")
    return "\n".join(lines)


router = APIRouter(prefix="/api/projects", tags=["projects"])


def _topic_of(db: Session, topic_id: int | None):
    return db.get(Topic, topic_id) if topic_id else None


def _parse_metrics(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        d = _json.loads(raw)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def _serialize_project(db: Session, p: Project, with_detail: bool = False):
    topic = _topic_of(db, p.topic_id)
    data = {
        "id": p.id,
        "title": p.title,
        "status": p.status,
        "progress": p.progress,
        "progress_percent": {"preparing": 20, "scripting": 50, "producing": 80, "published": 100, "reviewing": 100}.get(p.status, 0),
        "archived": p.archived,
        "target_platform": p.target_platform,
        "publish_schedule": p.publish_schedule,
        "worth_audience": p.worth_audience,
        "worth_outcome": p.worth_outcome,
        "worth_evidence": p.worth_evidence,
        "latest_metrics": _parse_metrics(p.latest_metrics),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "topic": {
            "id": topic.id,
            "title": topic.title,
            "audience": topic.audience,
            "pain_point": topic.pain_point,
            "core_decision": topic.core_decision,
            "hook": topic.hook,
        }
        if topic
        else None,
    }
    if with_detail:
        scripts = (
            db.query(Script)
            .filter(Script.project_id == p.id)
            .order_by(Script.version.desc())
            .all()
        )
        materials = (
            db.query(Material).filter(Material.project_id == p.id).order_by(Material.id.desc()).all()
        )
        data["scripts"] = [
            {
                "id": s.id,
                "version": s.version,
                "skeleton_json": s.skeleton_json,
                "script_text": s.script_text,
                "status": s.status,
            }
            for s in scripts
        ]
        data["materials"] = [
            {
                "id": m.id,
                "kind": m.kind,
                "title": m.title,
                "content": m.content,
                "tags": m.tags,
                "source_url": m.source_url,
            }
            for m in materials
        ]
    return data


def _active_position_text(db: Session, account_id: int | None = None) -> str:
    aid = accounts_svc.resolve_account(db, account_id)
    master = db.query(PositionMaster).filter(PositionMaster.is_active.is_(True), PositionMaster.account_id == aid).first()
    if master:
        from ..services.position import master_to_text
        return master_to_text(master)
    return "（尚未配置定位母版）"


class ProjectCreate(BaseModel):
    title: str
    status: str = "preparing"


@router.post("")
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """新建空项目（对标首页「+ 新建项目」）。"""
    from ..models import Project as Prj
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="项目标题不能为空")
    p = Prj(account_id=accounts_svc.resolve_account(db, account_id), title=payload.title.strip(), status=payload.status)
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"project": _serialize_project(db, p)}


@router.get("")
def list_projects(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    projects = db.query(Project).filter(Project.account_id == aid, Project.archived.is_(False)).order_by(Project.updated_at.desc()).all()
    return {"projects": [_serialize_project(db, p) for p in projects]}


@router.get("/overview")
def projects_overview(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    """项目分类计数：全部/进行中/写稿中/制作中/已发布/复盘/已归档。"""
    from sqlalchemy import func
    aid = accounts_svc.resolve_account(db, account_id)
    q = db.query(Project).filter(Project.account_id == aid, Project.archived.is_(False))
    all_count = q.count()
    doing = q.filter(Project.status.in_(["preparing", "scripting", "producing"])).count()
    scripting = q.filter(Project.status == "scripting").count()
    producing = q.filter(Project.status == "producing").count()
    published = q.filter(Project.status == "published").count()
    reviewing = q.filter(Project.status == "reviewing").count()
    archived = db.query(Project).filter(Project.account_id == aid, Project.archived.is_(True)).count()
    return {
        "counts": {
            "all": all_count,
            "doing": doing,
            "scripting": scripting,
            "producing": producing,
            "published": published,
            "reviewing": reviewing,
            "archived": archived,
        }
    }


@router.patch("/{project_id}/archive")
def archive_project(project_id: int, body: dict, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    p.archived = bool(body.get("archived", True))
    db.commit()
    return {"ok": True, "archived": p.archived}


@router.get("/archived")
def list_archived(db: Session = Depends(get_db), account_id: int | None = Query(None)):
    aid = accounts_svc.resolve_account(db, account_id)
    projects = db.query(Project).filter(Project.account_id == aid, Project.archived.is_(True)).order_by(Project.updated_at.desc()).all()
    return {"projects": [_serialize_project(db, p) for p in projects]}


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"project": _serialize_project(db, p, with_detail=True)}


@router.patch("/{project_id}")
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    return {"project": _serialize_project(db, p)}


@router.post("/{project_id}/materials")
def add_material(project_id: int, payload: MaterialCreate, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    m = Material(project_id=project_id, **payload.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"material": {"id": m.id, "kind": m.kind, "title": m.title, "content": m.content, "tags": m.tags, "source_url": m.source_url}}


@router.get("/{project_id}/export")
def export_project(project_id: int, db: Session = Depends(get_db)):
    """导出素材包：论点骨架/脚本/素材清单/项目说明（zip）。"""
    import io
    import json
    import zipfile

    from fastapi.responses import StreamingResponse

    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    scripts = (
        db.query(Script)
        .filter(Script.project_id == project_id)
        .order_by(Script.version.desc())
        .all()
    )
    materials = db.query(Material).filter(Material.project_id == project_id).order_by(Material.id).all()
    topic = _topic_of(db, p.topic_id)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", f"# {p.title}\n\n状态：{p.status}\n进度：{p.progress or ''}\n\n选题：{topic.title if topic else ''}\n")
        if scripts:
            latest = scripts[0]
            zf.writestr(
                "论点骨架.json",
                json.dumps(
                    latest.skeleton_json if isinstance(latest.skeleton_json, dict) else (json.loads(latest.skeleton_json) if latest.skeleton_json else {}),
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            zf.writestr("脚本.txt", latest.script_text or "")
        mats = []
        for m in materials:
            mats.append(f"- [{m.kind}] {m.title or ''}\n  {m.content or ''}\n  {m.source_url or ''}")
        zf.writestr("素材清单.txt", "\n".join(mats) if mats else "（暂无素材）\n")
    buf.seek(0)
    filename = f"project_{project_id}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.patch("/{project_id}/worth")
def update_worth(project_id: int, payload: WorthWrite, db: Session = Depends(get_db)):
    """更新「这条为什么值得做」三卡（给谁看/希望带来什么/依据与缺口）。"""
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    if payload.audience is not None:
        p.worth_audience = payload.audience.strip()
    if payload.outcome is not None:
        p.worth_outcome = payload.outcome.strip()
    if payload.evidence is not None:
        p.worth_evidence = payload.evidence.strip()
    db.commit()
    db.refresh(p)
    return {"ok": True, "project": _serialize_project(db, p)}


@router.post("/{project_id}/worth/fill")
async def fill_worth(project_id: int, db: Session = Depends(get_db)):
    """「让编导帮你填」：基于选题卡+素材，AI 补全三卡内容。"""
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    topic = _topic_of(db, p.topic_id)
    materials = db.query(Material).filter(Material.project_id == project_id).order_by(Material.id).all()
    materials_text = "\n".join(
        f"- {m.title}（{m.kind}）{('：' + m.content[:120]) if m.content else ''}"
        for m in materials[:12]
    ) or "（暂无素材）"
    prompt = (
        "你是一名短视频编导，正在帮创作者完成选题立项后的「这条为什么值得做」说明。"
        "基于下面的选题信息与已备素材，输出三卡内容。\n"
        f"选题标题：{topic.title if topic else p.title}\n"
        f"目标受众：{topic.audience if topic else ''}\n"
        f"观点痛点：{topic.pain_point if topic else ''}\n"
        f"核心决定：{topic.core_decision if topic else ''}\n"
        f"推荐Hook：{topic.hook if topic else ''}\n"
        f"已备素材：\n{materials_text}\n\n"
        "要求：\n"
        "1. audience：给谁看——具体说明目标观众及其处境，若素材/选题信息不足则说明缺口；\n"
        "2. outcome：希望带来什么——这条内容期望达成的目的（涨粉/认知/转化等）；\n"
        "3. evidence：依据与缺口——可核对的来源与数据支撑，以及尚缺、需结合素材确认的部分。\n"
        "每条 1-3 句，务实具体，不要空话。只返回 JSON：{\"audience\": \"...\", \"outcome\": \"...\", \"evidence\": \"...\"}"
    )
    result = await scripts_svc.chat_json([{"role": "user", "content": prompt}], model=settings.ark_model_pro)
    p.worth_audience = (result.get("audience") or "").strip()
    p.worth_outcome = (result.get("outcome") or "").strip()
    p.worth_evidence = (result.get("evidence") or "").strip()
    db.commit()
    db.refresh(p)
    return {"ok": True, "project": _serialize_project(db, p)}


@router.post("/{project_id}/skeleton")
async def build_skeleton(project_id: int, db: Session = Depends(get_db)):
    """生成论点骨架。"""
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    aid = p.account_id
    topic = _topic_of(db, p.topic_id)
    materials = db.query(Material).filter(Material.project_id == project_id).all()
    materials_text = "\n".join(
        f"- {m.title or m.content[:60]}" + (f"（{m.source_url}）" if m.source_url else "")
        for m in materials
    )
    from ..models import Formula as _F
    adopted = db.query(_F).filter(_F.status == "adopted", _F.account_id == aid).all()
    formulas_text = "\n".join(f"- {f.title}：{f.content}" for f in adopted) if adopted else ""
    position_text = _active_position_text(db, aid)
    knowledge = await _inject_knowledge(db, f"{p.title or ''} {position_text}")
    skeleton = await scripts_svc.build_skeleton(p, materials_text, position_text, knowledge, formulas_text=formulas_text)
    if adopted:
        for f in adopted:
            f.usage_count = (f.usage_count or 0) + 1
        db.commit()
    script = Script(project_id=project_id, version=1, skeleton_json=skeleton, status="skeleton")
    db.add(script)
    p.status = "scripting"
    p.progress = "论点骨架已生成，可生成脚本"
    db.commit()
    db.refresh(script)
    return {"script": {"id": script.id, "skeleton_json": script.skeleton_json, "status": script.status}}


@router.post("/{project_id}/script")
async def generate_script(project_id: int, db: Session = Depends(get_db)):
    """基于最新骨架生成脚本。"""
    p0 = db.get(Project, project_id)
    aid = p0.account_id if p0 else accounts_svc.resolve_account(db)
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    latest = (
        db.query(Script)
        .filter(Script.project_id == project_id)
        .order_by(Script.version.desc())
        .first()
    )
    if not latest or not latest.skeleton_json:
        raise HTTPException(status_code=400, detail="请先生成论点骨架")
    from ..models import Formula as _F2
    adopted = db.query(_F2).filter(_F2.status == "adopted", _F2.account_id == aid).all()
    formulas_text = "\n".join(f"- {f.title}：{f.content}" for f in adopted) if adopted else ""
    position_text = _active_position_text(db)
    knowledge = await _inject_knowledge(db, f"{p.title or ''} {position_text}")
    text = await scripts_svc.generate_script(latest.skeleton_json, position_text, knowledge=knowledge, formulas_text=formulas_text)
    if adopted:
        for f in adopted:
            f.usage_count = (f.usage_count or 0) + 1
        db.commit()
    new_script = Script(
        project_id=project_id,
        version=(latest.version or 1) + 1,
        skeleton_json=latest.skeleton_json,
        script_text=text,
        status="script",
    )
    db.add(new_script)
    p.status = "scripting"
    p.progress = "脚本已生成"
    db.commit()
    db.refresh(new_script)
    return {"script": {"id": new_script.id, "version": new_script.version, "script_text": new_script.script_text, "status": new_script.status}}
