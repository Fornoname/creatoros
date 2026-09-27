"""系统设置 API：方舟 API Key 配置面板。"""
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return f"{key[:7]}…{key[-6:]}"


@router.get("/ark-key")
def get_ark_key():
    return {
        "configured": bool(settings.ark_api_key),
        "masked": _mask(settings.ark_api_key),
        "model_pro": settings.ark_model_pro,
        "env_path": str(ENV_PATH),
    }


class ArkKeyIn(BaseModel):
    key: str


@router.put("/ark-key")
def put_ark_key(payload: ArkKeyIn):
    key = payload.key.strip()
    if not key.startswith("ark-"):
        raise HTTPException(status_code=400, detail="Key 应以 ark- 开头")
    if not ENV_PATH.exists():
        raise HTTPException(status_code=500, detail="未找到 backend/.env，无法持久化")
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    out = []
    replaced = False
    for ln in lines:
        if ln.startswith("ARK_API_KEY="):
            out.append(f"ARK_API_KEY={key}")
            replaced = True
        else:
            out.append(ln)
    if not replaced:
        out.append(f"ARK_API_KEY={key}")
    ENV_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
    settings.ark_api_key = key
    os.environ["ARK_API_KEY"] = key
    return {"ok": True, "masked": _mask(key), "configured": True}
