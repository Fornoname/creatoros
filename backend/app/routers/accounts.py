"""多账号 API：账号管理、作品导入、账号级聚合。"""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, Publication
from ..services import accounts as accounts_svc
from ..services import profiles as profiles_svc

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class AccountCreate(BaseModel):
    platform: str = "douyin"
    display_name: str = ""
    username: str = ""
    uid: str = ""
    is_default: bool = False


class AccountUpdate(BaseModel):
    display_name: str | None = None
    status: str | None = None
    is_default: bool | None = None


def _serialize(db: Session, a: Account) -> dict:
    stats = accounts_svc.account_stats(db, a.id)
    return {
        "id": a.id,
        "platform": a.platform,
        "display_name": a.display_name,
        "username": a.username,
        "uid": a.uid,
        "status": a.status,
        "is_default": a.is_default,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "stats": stats,
    }


@router.get("")
def list_accounts(db: Session = Depends(get_db)):
    accounts = db.query(Account).order_by(Account.is_default.desc(), Account.id).all()
    return {"accounts": [_serialize(db, a) for a in accounts], "current": accounts_svc.resolve_account(db)}


@router.post("")
def create_account(payload: AccountCreate, db: Session = Depends(get_db)):
    a = Account(
        user_id=1,
        platform=payload.platform,
        display_name=payload.display_name,
        username=payload.username,
        uid=payload.uid,
        is_default=payload.is_default,
        status="active",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    # 新账号自动补齐一套账号级自动化规则（数据各归各位）
    from ..services import automation as automation_svc

    automation_svc.seed_account_rules(db, a.id)
    return {"account": _serialize(db, a)}


@router.patch("/{aid}")
def update_account(aid: int, payload: AccountUpdate, db: Session = Depends(get_db)):
    a = db.get(Account, aid)
    if not a:
        raise HTTPException(status_code=404, detail="账号不存在")
    if payload.is_default:
        # 先取消其他默认
        for other in db.query(Account).filter(Account.is_default.is_(True), Account.id != aid).all():
            other.is_default = False
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return {"account": _serialize(db, a)}


@router.delete("/{aid}")
def delete_account(aid: int, db: Session = Depends(get_db)):
    a = db.get(Account, aid)
    if not a:
        raise HTTPException(status_code=404, detail="账号不存在")
    if a.is_default:
        raise HTTPException(status_code=400, detail="不能删除默认账号")
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.post("/{aid}/sync")
async def sync_account(aid: int, limit: int = 10, db: Session = Depends(get_db)):
    """导入账号历史作品（opencli douyin videos → 作品/指标/知识资产）。"""
    try:
        result = await accounts_svc.import_douyin_works(db, aid, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.post("/{aid}/bind-profile")
def bind_profile(aid: int, db: Session = Depends(get_db)):
    """绑新号：创建临时空 profile → 弹出浏览器扫码 → 读完身份挪正式目录。"""
    return profiles_svc.start_bind(db, aid)


@router.post("/{aid}/collect-profile")
def collect_profile(aid: int, limit: int = 20, db: Session = Depends(get_db)):
    """用该账号独立 profile 采集创作者中心作品 → 按作品 ID 对齐落库。"""
    return profiles_svc.start_collect(db, aid, limit=limit)


@router.get("/{aid}/works")
def list_works(aid: int, db: Session = Depends(get_db)):
    pubs = (
        db.query(Publication)
        .filter(Publication.account_id == aid)
        .order_by(Publication.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "works": [
            {
                "id": p.id,
                "platform": p.platform,
                "item_id": p.item_id,
                "title": p.title or "",
                "cover_url": p.cover_url or "",
                "status": p.status,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in pubs
        ]
    }


@router.get("/{aid}/profile")
def get_profile(aid: int, db: Session = Depends(get_db)):
    """账号创作画像：动态聚合 + 用户编辑偏好，返回可读文本。"""
    a = db.get(Account, aid)
    if not a:
        raise HTTPException(status_code=404, detail="账号不存在")
    from ..services.account_profile import build_account_profile, get_profile_text
    return {
        "dynamic": build_account_profile(db, aid),
        "profile": get_profile_text(db, aid),
        "notes": (json.loads(a.profile).get("notes", "") if a.profile else ""),
    }


@router.put("/{aid}/profile")
def put_profile(aid: int, payload: dict, db: Session = Depends(get_db)):
    """保存用户编辑的画像偏好（notes 为自由文本，注入出题时最高优先级）。"""
    from ..services.account_profile import save_profile_notes
    return save_profile_notes(db, aid, str(payload.get("notes", "")))
