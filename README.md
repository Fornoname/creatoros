# CreatorOS · 编导智能体系统

面向自媒体多账号运营的 AI 编导工作台：内容雷达 → 选题 → 定位 → 项目 → 脚本 → 素材 → 发布 → 运营分析 → 复盘 → 自动化，全流程闭环。

## 功能模块

| 模块 | 说明 |
|---|---|
| 内容雷达 | 对标博主内容自动同步（每 2 小时）、AI 拆解、原字幕提取（方舟语音转写 / 本地 faster-whisper 兜底）、选题识别 |
| 选题 | AI 选题推荐（注入账号画像与爆款特征反馈）、热度热词 |
| 定位 | 账号定位规则（可 AI 生成、可修改）、账号画像 |
| 项目 | 选题升级项目、脚本、素材挂载 |
| 脚本 | 口播稿生成（注入逐字稿、选题、素材） |
| 素材中心 | 素材添加/上传/分类/类型筛选 |
| 知识库 | 来源内容沉淀、向量检索（Doubao Embedding） |
| 发布中心 | 发布计划与内容分发 |
| 运营分析 | 播放/点赞/粉丝/完播率等指标趋势 |
| 复盘 | 内容效果复盘 |
| 自动化 | 雷达同步、预转写等定时任务 |
| 设置 | 多账号绑定与数据隔离（各账号数据互不串味） |

## 技术栈

- **前端**：React 18 + Vite + Tailwind CSS 4
- **后端**：Python FastAPI + SQLite（可切 PostgreSQL，见 docker-compose.yml）
- **AI**：火山方舟（Doubao 模型：对话/视觉/语音转写/Embedding）、本地 faster-whisper 兜底
- **数据抓取**：opencli（抖音账号内容同步）

## 快速启动

### 后端（端口 8000）

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 填入方舟 API Key
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 前端（端口 30001）

```bash
cd frontend
npm install
npm run dev -- --port 30001
```

打开 http://localhost:30001

## 环境变量（backend/.env）

| 变量 | 说明 |
|---|---|
| `ARK_API_KEY` | 火山方舟 API Key（Doubao 对话/视觉/Embedding/语音转写） |
| `DATABASE_URL` | 数据库连接（默认 sqlite） |

## 目录结构

```
creatoros/
├── backend/
│   ├── app/            # FastAPI 应用（routers / services / models）
│   ├── scripts/        # asr_worker.py 本地语音转写
│   └── requirements.txt
├── frontend/
│   ├── src/            # React 源码（pages / api / components）
│   └── package.json
└── docker-compose.yml  # PostgreSQL + Redis（可选）
```

## 说明

- 本仓库**不包含**：数据库文件、浏览器登录态（抖音 Cookie）、用户素材、API Key。
- 首次使用需按上方说明配置 `backend/.env`。
