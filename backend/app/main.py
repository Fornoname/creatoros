"""CreatorOS API 入口。"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, SessionLocal, engine
from .routers import accounts, alerts, analytics, assets, automation, conversations, dashboard, health, position, projects, publish, radar, review, topics

logging.basicConfig(level=logging.INFO)

Base.metadata.create_all(bind=engine)

# 预置默认自动化规则 + 启动后台调度
from .services.automation import ensure_next_runs, run_scheduled_tasks, seed_account_rules, seed_default_rules

db0 = SessionLocal()
seed_default_rules(db0)
# 每个已有账号补齐账号级规则（模板化全局规则，避免多账号数据串味）
from .models import Account

for acc in db0.query(Account).all():
    seed_account_rules(db0, acc.id)
ensure_next_runs(db0)
db0.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(run_scheduled_tasks())
    yield
    task.cancel()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:30001", "http://127.0.0.1:30001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 本地媒资（封面/上传素材）
media_dir = Path(__file__).resolve().parent.parent / "media"
media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=media_dir), name="media")

uploads_dir = Path(__file__).resolve().parent.parent / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

app.include_router(accounts.router)
app.include_router(dashboard.router)
app.include_router(analytics.router)
from .routers import settings as settings_router
app.include_router(settings_router.router)
app.include_router(radar.router)
app.include_router(health.router)
app.include_router(position.router)
app.include_router(topics.router)
app.include_router(projects.router)
app.include_router(conversations.router)
app.include_router(assets.router)
app.include_router(publish.router)
app.include_router(review.router)
app.include_router(automation.router)
app.include_router(alerts.router)


@app.get("/")
def root():
    return {"app": settings.app_name, "docs": "/docs", "health": "/health"}
