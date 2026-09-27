"""应用配置：从 .env.local / 环境变量读取。"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根：backend 的上级目录（creatoros/），.env.local 位于项目目录（new-chat/）
_PROJECT_ROOT = Path(__file__).resolve().parents[2]          # creatoros/
_ENV_LOCAL = _PROJECT_ROOT.parent / ".env.local"             # new-chat/.env.local


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


settings = Settings()
