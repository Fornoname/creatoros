import { Database, FileText, Image, Link2, Paperclip, RefreshCw, Search, Trash2, Undo2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { assetsApi, type MaterialFull } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const KIND_META: Record<string, { label: string; icon: typeof FileText }> = {
  image: { label: '图片', icon: Image },
  video: { label: '视频', icon: Paperclip },
  audio: { label: '音频', icon: Paperclip },
  document: { label: '文档', icon: FileText },
  subtitle: { label: '字幕', icon: FileText },
  link: { label: '链接', icon: Link2 },
  quote: { label: '摘录', icon: FileText },
  text: { label: '文本', icon: FileText },
}

/** 对标素材类型固定六类（无数据也显示 0） */
const TYPE_ORDER = ['image', 'video', 'audio', 'document', 'subtitle'] as const

/** 本地素材库总容量（对标 494.4GB 配额） */
const STORE_QUOTA = 494.4 * 1024 * 1024 * 1024

function fmtSize(n: number): string {
  if (n <= 0) return '—'
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${n}B`
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Materials() {
  const [tab, setTab] = useState<'all' | 'trash'>('all')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [showProjectPick, setShowProjectPick] = useState(false)
  const { data, loading, run } = useAsync(() => assetsApi.materials(tab === 'trash' ? { trash: true } : { projectId: projectId ?? undefined, kind: kind ?? undefined }), [tab, projectId, kind])
  const { data: statsData, run: reloadStats } = useAsync(() => assetsApi.stats(), [])

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [notice, setNotice] = useState('')
  const [sp] = useSearchParams()
  const [query, setQuery] = useState(sp.get('q') ?? '')
  const [didAutoSearch, setDidAutoSearch] = useState(false)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<{ label: string; score: number }[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [addHint, setAddHint] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const materials = data?.materials ?? []
  const stats = statsData ?? { counts: {}, total: { count: 0, size: 0 }, by_project: {} }

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 4000)
  }

  async function add() {
    if (!title.trim() && !content.trim()) {
      setAddHint('请填写标题或内容后再添加')
      return
    }
    setAddHint('')
    try {
      await assetsApi.addMaterial({
        kind: url.trim() ? 'link' : 'text',
        title: title.trim() || content.trim().slice(0, 30),
        content: content.trim(),
        source_url: url.trim(),
        tags: tagsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      })
      setTitle('')
      setContent('')
      setUrl('')
      setTagsText('')
      flash('素材已添加，正在向量化…（向量化完成后可被语义检索）')
      await Promise.all([run(), reloadStats()])
    } catch (e) {
      flash(`添加失败：${e instanceof Error ? e.message : e}`)
    }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    try {
      const d = await assetsApi.upload(f)
      flash(`已上传「${d.material.file_name}」（${d.material.kind}），${d.material.embedded ? '已向量化' : '文本类已向量化/媒体类暂不向量化'}，大小 ${fmtSize(d.material.file_size)}`)
      await Promise.all([run(), reloadStats()])
    } catch (err) {
      flash(`上传失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  useEffect(() => {
    const initQ = sp.get('q')
    if (initQ && !didAutoSearch) {
      setDidAutoSearch(true)
      setSearching(true)
      assetsApi
        .search(initQ)
        .then((r) => setResults(r.results))
        .catch((e) => flash(`检索失败：${e instanceof Error ? e.message : e}`))
        .finally(() => setSearching(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function search() {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const r = await assetsApi.search(query)
      setResults(r.results)
    } catch (e) {
      flash(`检索失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSearching(false)
    }
  }

  async function toggleTrash(m: MaterialFull) {
    setBusy(m.id)
    try {
      await assetsApi.trash(m.id, !m.deleted)
      await Promise.all([run(), reloadStats()])
    } catch (e) {
      flash(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function remove(m: MaterialFull) {
    setBusy(m.id)
    try {
      await assetsApi.remove(m.id)
      await Promise.all([run(), reloadStats()])
      flash('素材已彻底删除')
    } catch (e) {
      flash(`删除失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  const projectOptions = Object.entries(stats.by_project)
  const countsMap: Record<string, { count: number; size: number }> = stats.counts ?? {}
  const used = stats.total.size ?? 0
  const usedPct = Math.min(100, (used / STORE_QUOTA) * 100)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">素材中心</h1>
        <p className="mt-1 text-[13px] text-ink-dim">内容弹药库：自动向量化，支持语义检索（Doubao Embedding Vision）</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">{notice}</div>
      )}

      {/* 顶部搜索 */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="搜索素材名称、标签、描述..."
            className="w-full rounded-xl border border-line bg-card py-2.5 pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
        </div>
        <button
          onClick={search}
          disabled={searching}
          className="shrink-0 rounded-xl bg-primary px-4 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {searching ? <RefreshCw size={14} className="animate-spin" /> : '搜索'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* 左栏：素材类型 + 存储空间 */}
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 text-[13px] font-medium">素材类型</div>
            <button
              onClick={() => { setKind(null); setTab('all') }}
              className={`mb-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ${kind == null ? 'bg-primary-soft/40' : 'bg-bg/60 hover:bg-bg'}`}
            >
              <span className={`text-[12px] ${kind == null ? 'text-primary-hover' : 'text-ink-dim'}`}>全部素材</span>
              <span className={`text-lg font-semibold ${kind == null ? 'text-primary-hover' : 'text-ink'}`}>{stats.total.count}</span>
            </button>
            <div className="space-y-1.5">
              {TYPE_ORDER.map((k) => {
                const meta = KIND_META[k] ?? { label: k, icon: FileText }
                const v = countsMap[k] ?? { count: 0, size: 0 }
                const active = kind === k
                return (
                  <button
                    key={k}
                    onClick={() => { setKind(active ? null : k); setTab('all') }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left ${active ? 'bg-primary-soft/40' : 'bg-bg/40 hover:bg-bg'}`}
                  >
                    <span className={`flex items-center gap-2 text-[12px] ${active ? 'text-primary-hover' : 'text-ink-dim'}`}>
                      <meta.icon size={13} className={active ? 'text-primary-hover' : ''} />
                      {meta.label}
                    </span>
                    <span className={`text-[13px] font-medium ${active ? 'text-primary-hover' : 'text-ink'}`}>{v.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card p-4">
            <div className="text-[13px] font-medium">存储空间</div>
            <div className="mt-1 text-[12px] text-ink-dim">本地素材库使用情况</div>
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
              </div>
              <div className="mt-2 text-[12px] text-ink">
                已使用 <span className="font-semibold text-ink">{fmtSize(used)}</span> / {fmtSize(STORE_QUOTA)}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary-soft/10 px-2.5 py-2 text-[12px] text-ink-dim">
              <Database size={13} className="text-primary-hover" />
              个人本地素材库
            </div>
          </div>
        </div>

        {/* 右栏：计数 + 标签 + 素材列表 */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-dim">
              共 <span className="font-semibold text-ink">{materials.length}</span> 个素材
              {projectId != null ? `（项目 #${projectId}）` : ''}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => { setTab('all'); setProjectId(null); setShowProjectPick(false) }}
                className={`rounded-full border px-3 py-1 text-[12px] ${tab === 'all' && projectId == null ? 'border-primary-soft bg-primary-soft/40 text-primary-hover' : 'border-line text-ink-dim hover:text-ink'}`}
              >
                全部
              </button>
              <div className="relative">
                <button
                  onClick={() => { setTab('all'); setShowProjectPick((v) => !v) }}
                  className={`rounded-full border px-3 py-1 text-[12px] ${projectId != null ? 'border-primary-soft bg-primary-soft/40 text-primary-hover' : 'border-line text-ink-dim hover:text-ink'}`}
                >
                  按项目 {projectId != null ? `#${projectId}` : ''}
                </button>
                {showProjectPick && (
                  <div className="absolute right-0 z-20 mt-1 max-h-56 w-44 overflow-auto rounded-lg border border-line bg-card p-1 shadow-lg">
                    {projectOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-[12px] text-ink-faint">暂无项目素材</div>
                    ) : (
                      projectOptions.map(([pid, c]) => (
                        <button
                          key={pid}
                          onClick={() => { setProjectId(Number(pid)); setShowProjectPick(false) }}
                          className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-dim hover:bg-bg hover:text-ink"
                        >
                          项目 #{pid}（{c}）
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => { setTab('trash'); setProjectId(null); setShowProjectPick(false) }}
                className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] ${tab === 'trash' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line text-ink-dim hover:text-ink'}`}
              >
                <Trash2 size={12} />
                回收站
              </button>
            </div>
          </div>

          {/* 语义检索结果 */}
          {results.length > 0 && (
            <div className="rounded-xl border border-primary-soft/50 bg-primary-soft/10 p-3">
              <div className="mb-1.5 text-[12px] font-medium text-primary-hover">语义检索结果</div>
              <div className="space-y-1">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-[13px]">
                    <span className="truncate text-ink-dim">{r.label}</span>
                    <span className="ml-3 shrink-0 text-[12px] text-ink-faint">{(r.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 素材网格 */}
          {loading ? (
            <div className="py-10 text-center text-[13px] text-ink-dim">加载中…</div>
          ) : materials.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface/60 py-14 text-center text-[13px] text-ink-faint">
              {tab === 'trash' ? '回收站为空' : '暂无素材，先添加一条'}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {materials.map((m) => {
                const meta = KIND_META[m.kind] ?? { label: m.kind, icon: FileText }
                const thumb = m.url ? `http://127.0.0.1:8000${m.url}` : null
                return (
                  <div key={m.id} className="overflow-hidden rounded-xl border border-line bg-card transition-colors hover:border-primary-soft">
                    {thumb && m.kind === 'video' ? (
                      <div className="relative aspect-video bg-black">
                        <video
                          src={thumb}
                          controls
                          preload="metadata"
                          playsInline
                          className="h-full w-full"
                        />
                        <span className="absolute left-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                          视频
                        </span>
                      </div>
                    ) : thumb && m.kind === 'image' ? (
                      <div className="relative aspect-video bg-bg">
                        <img src={thumb} alt={m.file_name || m.title} className="h-full w-full object-cover" />
                        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                          {meta.label}
                        </span>
                      </div>
                    ) : thumb && m.kind === 'audio' ? (
                      <div className="relative bg-bg p-3">
                        <audio src={thumb} controls preload="metadata" className="w-full" />
                        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                          音频
                        </span>
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-bg/60">
                        <meta.icon size={26} className="text-ink-faint" />
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-ink">{m.file_name || m.title || '（无标题）'}</div>
                          {!m.file_name && m.content && (
                            <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-dim">{m.content}</div>
                          )}
                        </div>
                        {tab === 'trash' ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button title="恢复" disabled={busy === m.id} onClick={() => toggleTrash(m)} className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40">
                              <Undo2 size={14} />
                            </button>
                            <button title="彻底删除" disabled={busy === m.id} onClick={() => remove(m)} className="rounded p-1 text-ink-faint hover:text-danger disabled:opacity-40">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : (
                          <button title="移到回收站" disabled={busy === m.id} onClick={() => toggleTrash(m)} className="shrink-0 rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                        <span>{fmtDate(m.created_at)}</span>
                        <span>{meta.label}</span>
                        <span>{m.file_name && m.file_size > 0 ? fmtSize(m.file_size) : m.source_url ? '链接' : '文本'}</span>
                        {m.embedded && <span className="text-success">已向量化</span>}
                        {m.project_id && <span>项目 #{m.project_id}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 添加素材 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 text-sm font-medium">添加素材</div>
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="标题"
                className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="链接（填入则作为链接素材）"
                className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
              />
              <button onClick={add} className="rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:opacity-90">
                添加素材
              </button>
            </div>
            {addHint && <div className="mt-2 text-[12px] font-medium text-danger">{addHint}</div>}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="内容 / 摘录…"
              className="mt-2 h-20 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="标签，用逗号分隔"
              className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[12px] font-medium text-ink-dim">或上传本地文件（图片/视频/音频/文档/字幕，自动分类入库，文本类自动向量化）</div>
              <label
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-primary-soft bg-primary-soft/10 px-3 py-3 text-[13px] text-primary-hover hover:bg-primary-soft/20"
                onClick={(e) => {
                  e.preventDefault()
                  fileRef.current?.click()
                }}
              >
                <Upload size={14} />
                {uploading ? '上传中…' : '选择文件上传'}
              </label>
              <input ref={fileRef} type="file" className="hidden" onChange={uploadFile} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
