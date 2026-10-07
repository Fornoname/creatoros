"""应用配置：从 .env.local / 环境变量读取。"""
import glob as _glob
import os
import shutil
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根：backend 的上级目录（creatoros/），.env.local 位于项目目录（new-chat/）
_PROJECT_ROOT = Path(__file__).resolve().parents[2]          # creatoros/
_ENV_LOCAL = _PROJECT_ROOT.parent / ".env.local"             # new-chat/.env.local


def _resolve_opencli_bin(explicit: str) -> str:
    """解析 opencli 可执行文件绝对路径。

    优先级：环境变量 OPENCLI_BIN → 显式配置 → PATH → 常见 npm 全局目录（通配符探测）。
    返回绝对路径，找不到时返回原值（由调用方给出友好错误）。
    """
    candidates: list[str] = []
    env_bin = os.environ.get("OPENCLI_BIN")
    if env_bin:
        candidates.append(env_bin)
    if explicit and explicit != "opencli":
        candidates.append(explicit)
    found = shutil.which("opencli")
    if found:
        candidates.append(found)
    # 常见 npm 全局目录（macOS/Linux）——用 glob.glob 处理通配符，不依赖进程 PATH
    home = Path.home()
    patterns = [
        str(home / "Library/Application Support/Doubao/sandbox_runtime/bases/*/bin/opencli"),
        str(home / ".npm-global/bin/opencli"),
        str(home / ".nvm/versions/node/*/bin/opencli"),
        "/usr/local/bin/opencli",
        "/opt/homebrew/bin/opencli",
        str(home / "bin/opencli"),
    ]
    for pat in patterns:
        for hit in sorted(_glob.glob(pat)):
            candidates.append(hit)
    seen: set[str] = set()
    for c in candidates:
        c = str(c)
        if c in seen:
            continue
        seen.add(c)
        try:
            p = Path(c).expanduser()
            if p.is_file() and os.access(p, os.X_OK):
                return str(p.resolve())
        except Exception:
            continue
    return explicit or "opencli"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_LOCAL) if _ENV_LOCAL.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "CreatorOS"
    app_version: str = "0.1.0"
    debug: bool = True

    # 数据库：阶段 0 默认 SQLite，后续切 PostgreSQL（修改此值即可）
    database_url: str = "sqlite:///./creatoros.db"

    # 火山引擎方舟
    ark_api_key: str = ""
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_model_pro: str = "doubao-seed-2-1-pro-260915"
    ark_model_lite: str = "doubao-seed-2-1-lite-260915"
    ark_model_embedding: str = "doubao-embedding-vision-251215"
    ark_model_image: str = "doubao-seedream-5-0-flash-260915"
    ark_model_image_fallback: list[str] = [
        "doubao-seedream-5-0-lite-260128",
        "doubao-seedream-5-0-pro-260628",
    ]
    ark_model_video: str = "doubao-seedance-2-5-260628"

    # opencli 集成（阶段 2 启用）
    opencli_bin: str = "opencli"

    def model_post_init(self, __context) -> None:
        """启动时解析 opencli 绝对路径，避免子进程 PATH 不含 npm 全局目录。"""
        self.opencli_bin = _resolve_opencli_bin(self.opencli_bin)


settings = Settings()
