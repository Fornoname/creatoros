import { Archive, FolderKanban, LayoutGrid, List, Plus, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { projectsApi, type Project } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const STATUS_LABELS: Record<string, string> = {
  preparing: '备料中',
  scripting: '写稿中',
  producing: '制作中',
  published: '已发布',
  reviewing: '复盘中',
}

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部项目' },
  { key: 'doing', label: '进行中' },
  { key: 'scripting', label: '写稿中' },
  { key: 'producing', label: '制作中' },
  { key: 'published', label: '已发布' },
]

const SORTS = [
  { key: 'updated', label: '最近更新' },
  { key: 'progress', label: '进度' },
  { key: 'title', label: '标题' },
]

/** 相对时间：今天 06:46 / 昨天 HH:mm / N 天前 / YYYY-MM-DD */
function fmt(n?: number): string {
  const v = n ?? 0
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return `${v}`
}

function relTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `今天 ${hhmm}`
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days >= 1 && days < 30) return `${days} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Projects() {
  const { data, loading, run } = useAsync(() => projectsApi.list(), [])
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [showNew, setShowNew] = useState(sp.get('new') === '1')
  const [newTitle, setNewTitle] = useState('')
  const [newTitleError, setNewTitleError] = useState('')
  const { data: ovData, run: reloadOv } = useAsync(() => projectsApi.overview(), [])
  const { data: archData, run: reloadArch } = useAsync(() => projectsApi.archivedList(), [])
  const [view, setView] = useState<'card' | 'table'>('card')
  const [filter, setFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('updated')

  const counts = ovData?.counts ?? { all: 0, doing: 0, scripting: 0, producing: 0, published: 0, reviewing: 0, archived: 0 }
  const kw = search.trim().toLowerCase()
  const activeProjects = (data?.projects ?? [])
    .filter(
      (p) =>
        (filter === 'all' || (filter === 'doing' ? ['preparing', 'scripting', 'producing'].includes(p.status) : p.status === filter)) &&
        (!kw || `${p.title} ${p.progress} ${p.target_platform ?? ''} ${p.publish_schedule ?? ''}`.toLowerCase().includes(kw)),
    )
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh')
      if (sort === 'progress') return (b.progress_percent ?? 0) - (a.progress_percent ?? 0)
      return (b.updated_at ? new Date(b.updated_at).getTime() : 0) - (a.updated_at ? new Date(a.updated_at).getTime() : 0)
    })
  const archivedProjects = archData?.projects ?? []
  const shown = showArchived ? archivedProjects : activeProjects

  async function toggleArchive(p: Project) {
    const next = !p.archived
    await projectsApi.archive(p.id, next)
    await Promise.all([run(), reloadOv(), reloadArch()])
  }

  async function doCreate() {
    if (!newTitle.trim()) return
    try {
      const d = await projectsApi.create({ title: newTitle.trim() })
      setShowNew(false)
      setNewTitle('')
      nav(`/projects/${d.project.id}`)
    } catch (e) {
      setNewTitleError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-5">
      {/* 新建项目模态 */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium">新建项目</div>
            <div className="mt-1 text-[12px] text-ink-dim">从空项目开始，或先到「选题」立项已有选题</div>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => { setNewTitle(e.target.value); setNewTitleError('') }}
              onKeyDown={(e) => e.key === 'Enter' && doCreate()}
              placeholder="项目标题，如：AI 编导智能体实操第 3 期"
              className="mt-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            {newTitleError && <div className="mt-1 text-[12px] text-danger">{newTitleError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-dim hover:text-ink">
                取消
              </button>
              <button onClick={doCreate} className="rounded-lg bg-primary px-3 py-1.5 text-[13px] text-white hover:opacity-90">
                创建并编辑
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">项目</h1>
          <p className="mt-1 text-[13px] text-ink-dim">所有创作项目的管理与进度跟踪：备料 → 写稿 → 制作 → 发布 → 复盘</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line">
            <button
              onClick={() => setView('card')}
              className={`flex items-center gap-1 rounded-l-lg px-2.5 py-1.5 text-[12px] ${view === 'card' ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:text-ink'}`}
            >
              <LayoutGrid size={13} />
              卡片
            </button>
            <button
              onClick={() => setView('table')}
              className={`flex items-center gap-1 rounded-r-lg px-2.5 py-1.5 text-[12px] ${view === 'table' ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:text-ink'}`}
            >
              <List size={13} />
              表格
            </button>
          </div>
          <Link
            to="/topics"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover"
          >
            <Plus size={14} />
            从选题立项
          </Link>
        </div>
      </div>

      {/* 统计条 */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-[12px] ${filter === f.key && !showArchived ? 'border-primary-soft bg-primary-soft/40 text-primary-hover' : 'border-line text-ink-dim hover:text-ink'}`}
          >
            {f.label} {counts[f.key as keyof typeof counts] ?? 0}
          </button>
        ))}
        <button
          onClick={() => { setShowArchived((v) => !v); setFilter('all') }}
          className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] ${showArchived ? 'border-primary-soft bg-primary-soft/40 text-primary-hover' : 'border-line text-ink-dim hover:text-ink'}`}
        >
          <Archive size={12} />
          已归档 {counts.archived}
        </button>
      </div>

      {/* 搜索 + 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目…"
            className="w-full rounded-lg border border-line bg-bg py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[12px] text-ink outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              排序：{s.label}
            </option>
          ))}
        </select>
        {showArchived && <span className="text-[12px] text-ink-faint">已归档项目 {archivedProjects.length}</span>}
      </div>

      {loading && <div className="py-10 text-center text-[13px] text-ink-faint">加载中…</div>}
      {!loading && shown.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface/60 py-16 text-center">
          <FolderKanban size={20} className="text-ink-faint" />
          <div className="mt-2 text-sm text-ink-dim">{showArchived ? '暂无已归档项目' : '暂无项目'}</div>
          <div className="mt-1 text-[13px] text-ink-faint">
            {showArchived ? '项目归档后会出现在这里' : '在选题中心将选题补全并「立项」后，会出现在这里'}
          </div>
        </div>
      )}

      {view === 'card' && shown.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <div key={p.id} className="group relative rounded-xl border border-line bg-card p-4 transition-colors hover:border-primary-soft">
              <Link to={`/projects/${p.id}`} className="block">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-primary-soft px-2 py-0.5 text-[11px] text-primary-hover">
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  <span className="text-[11px] text-ink-faint">#{p.id}</span>
                  {p.target_platform && <span className="text-[11px] text-ink-faint">{p.target_platform}</span>}
                </div>
                <div className="text-sm font-medium leading-snug text-ink">{p.title}</div>
                <div className="mt-2 line-clamp-2 text-[12px] text-ink-dim">{p.progress || '—'}</div>
                {p.publish_schedule && <div className="mt-1.5 text-[12px] text-ink-faint">排期：{p.publish_schedule}</div>}
                {p.topic && <div className="mt-1 text-[12px] text-ink-faint">选题：{p.topic.title}</div>}
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-[11px] text-ink-faint">我 · 更新时间：{relTime(p.updated_at)}</span>
                  <div className="flex items-center gap-1.5">
                    {p.status === 'published' && (
                      <span className="rounded bg-ink-faint/20 px-1.5 py-0.5 text-[10px] text-ink-dim">历史作品</span>
                    )}
                    {p.latest_metrics && (
                      <span
                        className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success"
                        title={`发布表现：播放 ${p.latest_metrics.views} · 点赞 ${p.latest_metrics.likes} · 评论 ${p.latest_metrics.comments}`}
                      >
                        发布表现 · 播放 {fmt(p.latest_metrics.views ?? 0)} · 赞 {fmt(p.latest_metrics.likes ?? 0)}
                      </span>
                    )}
                    <span className="text-[11px] font-medium text-primary-hover">{p.progress_percent ?? 0}%</span>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => toggleArchive(p)}
                title={p.archived ? '取消归档' : '归档'}
                className="absolute right-3 top-3 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-bg hover:text-ink group-hover:opacity-100"
              >
                {p.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {view === 'table' && shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[12px] text-ink-dim">
                <th className="px-4 py-2.5 font-medium">项目</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">进度</th>
                <th className="px-4 py-2.5 font-medium">目标平台</th>
                <th className="px-4 py-2.5 font-medium">发布排期</th>
                <th className="px-4 py-2.5 font-medium">最近更新</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((p) => (
                <tr key={p.id} className="hover:bg-bg">
                  <td className="max-w-[240px] px-4 py-2.5">
                    <Link to={`/projects/${p.id}`} className="block truncate text-ink hover:text-primary-hover">
                      {p.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-primary-soft px-2 py-0.5 text-[11px] text-primary-hover">
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                      {p.status === 'published' && (
                        <span className="rounded bg-ink-faint/20 px-1.5 py-0.5 text-[10px] text-ink-dim">历史作品</span>
                      )}
                      {p.latest_metrics && (
                        <span
                          className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success"
                          title={`发布表现：播放 ${p.latest_metrics.views} · 点赞 ${p.latest_metrics.likes} · 评论 ${p.latest_metrics.comments}`}
                        >
                          发布表现 · 播放 {fmt(p.latest_metrics.views ?? 0)} · 赞 {fmt(p.latest_metrics.likes ?? 0)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-ink">{p.progress_percent ?? 0}%</span>
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-bg">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${p.progress_percent ?? 0}%` }} />
                      </span>
                    </div>
                    <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-ink-faint" title={p.progress}>
                      {p.progress || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-dim">{p.target_platform || 'douyin'}</td>
                  <td className="px-4 py-2.5 text-ink-dim">{p.status === 'published' ? '历史作品' : p.publish_schedule || '—'}</td>
                  <td className="px-4 py-2.5 text-ink-faint">{relTime(p.updated_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link to={`/projects/${p.id}`} className="text-[12px] text-primary-hover hover:underline">
                        打开
                      </Link>
                      <button onClick={() => toggleArchive(p)} className="text-[12px] text-ink-faint hover:text-ink">
                        {p.archived ? '恢复' : '归档'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
