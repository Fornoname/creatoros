import {
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Star,
  Upload,
  Wand2,
BookOpen,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { radarApi, type RadarContentItem, type RadarSource } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const SYNC_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '待同步', cls: 'bg-warning/15 text-warning' },
  synced: { label: '同步完成', cls: 'bg-success/15 text-success' },
  error: { label: '同步失败', cls: 'bg-danger/15 text-danger' },
}

// 轻量 SVG 双线折线：播放（主）/ 点赞（辅）历史趋势
function TrendSpark({ data }: { data: { date: string; play_count: number; digg_count: number }[] }) {
  const W = 320
  const H = 72
  const PAD = 4
  const max = Math.max(1, ...data.map((d) => d.play_count), ...data.map((d) => d.digg_count))
  const step = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0
  const pts = (key: 'play_count' | 'digg_count') =>
    data.map((d, i) => `${(PAD + i * step).toFixed(1)},${(H - PAD - (d[key] / max) * (H - PAD * 2)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="stroke-line" strokeWidth={1} />
      <polyline points={pts('play_count')} fill="none" stroke="#6366f1" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts('digg_count')} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 3" />
      <g className="text-[9px] text-ink-faint" fill="currentColor">
        <rect x={W - 96} y={2} width={44} height={12} rx={3} fill="rgba(99,102,241,.12)" />
        <text x={W - 90} y={11}>播放</text>
        <rect x={W - 48} y={2} width={44} height={12} rx={3} fill="rgba(245,158,11,.12)" />
        <text x={W - 42} y={11}>点赞</text>
      </g>
    </svg>
  )
}

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 0 || diff < 3600e3) return '刚刚'
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}小时前`
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}天前`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Radar() {
  const { data: statsData, run: reloadStats } = useAsync(() => radarApi.stats(), [])
  const { data: sourcesData, run: reloadSources } = useAsync(() => radarApi.sources(), [])
  const { data: catsData, run: reloadCats } = useAsync(() => radarApi.categories(), [])
  const [filter, setFilter] = useState('all')
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [sourceQ, setSourceQ] = useState('')
  const [topPanel, setTopPanel] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [q, setQ] = useState('')
  const [ts, setTs] = useState('all')
  const [topic, setTopic] = useState('all')
  const [sort, setSort] = useState('latest')
  const { data: listData, loading, run: reloadContents } = useAsync(
    () => radarApi.contents(filter, sourceId ?? undefined, q, ts, topic, sort, category ?? undefined),
    [filter, sourceId, q, ts, topic, sort, category],
  )

  // 筛选/排序/搜索状态变化时重新拉取列表（useAsync 仅挂载时自动执行）
  useEffect(() => {
    reloadContents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sourceId, q, ts, topic, sort, category])

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pasteTranscript, setPasteTranscript] = useState('')
  // 指标趋势（历史快照）
  const [metrics, setMetrics] = useState<{ date: string; play_count: number; digg_count: number }[] | null>(null)

  // 添加来源
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addCat, setAddCat] = useState('')
  const [addNewCatName, setAddNewCatName] = useState('')
  // 关键词收录 / 粘贴分享链接
  const [keyword, setKeyword] = useState('')
  const [pasteLink, setPasteLink] = useState('')
  // 新建分类
  // 选题候选
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  // 逐字稿显示切换：false=原字幕 true=AI改写稿
  const [showAiTranscript, setShowAiTranscript] = useState(false)
  // 缺主页链接来源的补填输入
  const [linkPatch, setLinkPatch] = useState<Record<number, string>>({})

  const stats = statsData ?? { total: 0, favorites: 0, pending_transcripts: 0, sources: 0 }
  const sources = sourcesData?.sources ?? []
  const categories = catsData?.categories ?? []
  const contents = listData?.contents ?? []
  const selected = contents.find((c) => c.id === selectedId) ?? null

  // 选中内容变化时拉取历史指标趋势
  useEffect(() => {
    if (!selectedId) {
      setMetrics(null)
      return
    }
    let alive = true
    radarApi
      .contentMetrics(selectedId)
      .then((r) => {
        if (alive) setMetrics(r.history.length ? r.history : null)
      })
      .catch(() => {
        if (alive) setMetrics(null)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  const filteredSources = sources.filter(
    (s) =>
      s.name.toLowerCase().includes(sourceQ.toLowerCase()) ||
      (s.category || '').toLowerCase().includes(sourceQ.toLowerCase()),
  )

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 4000)
  }

  async function runAction<T>(key: string, fn: () => Promise<T>, onOk?: (d: T) => void) {
    setBusyId(String(key))
    try {
      const d = await fn()
      onOk?.(d)
      await Promise.all([reloadStats(), reloadSources(), reloadCats(), reloadContents()])
    } catch (e) {
      flash(`操作失败：${(e as Error).message.slice(0, 120)}`)
    } finally {
      setBusyId(null)
    }
  }

  function addSource() {
    const secUid = addUrl.trim()
    if (!addName.trim()) return flash('请填写博主名称')
    runAction('add-source', () => radarApi.addSource({ name: addName.trim(), sec_uid: secUid, description: '', auto_sync: true }), (d) => {
      if (addCat) {
        setTimeout(() => {
          radarApi.sources().then((sd) => {
            const created = sd.sources.find((x) => x.name === addName.trim())
            if (created) setSourceCategory(created, addCat)
          })
        }, 300)
      }
      setAddName('')
      setAddUrl('')
      setAddCat('')
      flash(d.sync?.error ? `已添加来源，但同步失败：${d.sync.error.slice(0, 100)}` : `来源已添加，收录 ${d.sync?.added ?? 0} 条`)
    })
  }

  function collectSearch() {
    if (!keyword.trim()) return flash('请输入关键词')
    runAction('collect', () => radarApi.searchCollect(keyword.trim(), 10), (d) => {
      flash(`按「${d.keyword}」收录 ${d.added} 条`)
      setKeyword('')
    })
  }

  function doPasteLink() {
    if (!pasteLink.trim()) return flash('请粘贴分享链接')
    runAction('paste', () => radarApi.pasteLink(pasteLink.trim()), (d) => {
      flash(d.added ? `已收录「${d.content.title.slice(0, 20)}」` : '该作品已在雷达中')
      setPasteLink('')
    })
  }


  function createAddCat() {
    const name = addNewCatName.trim()
    if (!name) return flash('请输入分类名')
    runAction('cat-add', () => radarApi.createCategory(name), () => {
      setAddNewCatName('')
      setAddCat(name)
      reloadCats()
      flash(`已新建分类「${name}」并选中`)
    })
  }

  function saveSourceLink(s: RadarSource) {
    const link = (linkPatch[s.id] ?? '').trim()
    if (!link) return flash('请填写抖音主页链接')
    runAction(`link-${s.id}`, () => radarApi.patchSource(s.id, { sec_uid: link }), () => {
      flash('已保存主页链接，正在同步…')
      runAction(`sync-${s.id}`, () => radarApi.syncSource(s.id), (d) => flash(`同步完成，新增 ${d.added} 条（共 ${d.total}）`))
    })
  }

  function setSourceCategory(s: RadarSource, cat: string) {
    runAction(`cat-${s.id}`, () => radarApi.patchSource(s.id, { category: cat }))
  }

  function generateDraft() {
    if (!selected) return
    setDraft(null)
    setBusyId(`draft-${selected.id}`)
    radarApi
      .draftTopic(selected.id)
      .then((d) => setDraft(d.draft))
      .catch((e) => flash(`生成候选失败：${(e as Error).message.slice(0, 120)}`))
      .finally(() => setBusyId(null))
  }

  function adoptDraft() {
    if (!selected || !draft) return
    runAction(`adopt-${selected.id}`, () => radarApi.adoptTopic(selected.id, draft), (d) => {
      flash(`已转为选题「${d.topic.title.slice(0, 20)}」（待评审）`)
      setDraft(null)
      setSelectedId(null)
    })
  }

  function uploadTranscript(file: File | null) {
    if (!selected || !file) return
    runAction(`tf-${selected.id}`, () => radarApi.uploadTranscriptFile(selected.id, file), (d) => {
      flash(`文件导入成功，写入 ${d.chars} 字`)
    })
  }

  return (
    <div className="space-y-5">
      {/* 顶部：标题 + 副标题 + 右上操作组 */}
      {notice && (
        <div className="mb-3 rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">{notice}</div>
      )}

      {/* 顶部：真实信源工作台（对标） */}
      <div className="mb-3 rounded-xl border border-line bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold">真实信源工作台</div>
            <div className="text-[11px] text-ink-faint">只收公开作品与公开计数、评论正文不采集·逐字稿可粘贴、导入或转写</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setFilter('pending'); setSourceId(null); setCategory(null) }}
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink"
            >
              <span className="rounded bg-warning/15 px-1.5 text-[11px] font-semibold text-warning">{stats.pending_transcripts}</span>
              待处理
            </button>
            <button
              onClick={() => setTopPanel(topPanel === 'cat' ? null : 'cat')}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink"
            >
              <Plus size={13} />
              新建分类
            </button>
            <button
              onClick={() => setTopPanel(topPanel === 'paste' ? null : 'paste')}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink"
            >
              <ClipboardPaste size={13} />
              粘贴分享链接
            </button>
            <button
              onClick={() => setTopPanel(topPanel === 'add' ? null : 'add')}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] text-white hover:opacity-90"
            >
              <Plus size={13} />
              添加来源
            </button>
          </div>
        </div>
        {topPanel === 'cat' && (
          <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
            <input
              value={addNewCatName}
              onChange={(e) => setAddNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createAddCat()}
              placeholder="新分类名（如：商业财经）"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <button
              onClick={createAddCat}
              disabled={busyId === 'cat-add'}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busyId === 'cat-add' ? '创建中…' : '创建'}
            </button>
          </div>
        )}
        {topPanel === 'paste' && (
          <>
          <div className="mt-2 flex gap-2 border-t border-line pt-2">
            <input
              id="radar-paste-link"
              value={pasteLink}
              onChange={(e) => setPasteLink(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doPasteLink()}
              placeholder="粘贴抖音分享链接（v.douyin.com/…），回车收录"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <button
              disabled={busyId === 'paste'}
              onClick={doPasteLink}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-dim hover:text-ink"
            >
              {busyId === 'paste' ? <Loader2 size={14} className="animate-spin" /> : <ClipboardPaste size={14} />}
              收录
            </button>
          </div>
          <div className="mt-2 flex gap-2 border-t border-line/60 pt-2">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && collectSearch()}
              placeholder="或按关键词搜索抖音收录，回车执行"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <button
              disabled={busyId === 'collect'}
              onClick={collectSearch}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-dim hover:text-ink"
            >
              {busyId === 'collect' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              搜索收录
            </button>
          </div>
          </>
        )}
        {topPanel === 'add' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <input
              id="radar-add-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="博主名称（如：Geo逸哥）"
              className="w-44 rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <input
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="抖音主页链接 / sec_uid（可留空）"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <select
              value={addCat}
              onChange={(e) => setAddCat(e.target.value)}
              className="w-32 rounded-lg border border-line bg-bg px-2 py-2 text-[13px] outline-none"
            >
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <button
              disabled={busyId === 'add-source'}
              onClick={addSource}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busyId === 'add-source' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              添加并同步
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* 左栏：信源博主 */}
        <div className="order-2 space-y-4 lg:order-1">
          <div className="rounded-xl border border-line bg-card p-3">
            <div className="mb-2 text-[13px] font-medium">分类与来源</div>
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={sourceQ}
                onChange={(e) => setSourceQ(e.target.value)}
                placeholder="筛选名称、类型或状态"
                className="w-full rounded-lg border border-line bg-bg py-1.5 pl-8 pr-2.5 text-[12px] outline-none placeholder:text-ink-faint focus:border-primary"
              />
            </div>
            <div className="relative mb-2">
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <select
                value={category ? `cat:${category}` : filter}
                onChange={(e) => {
                  const v = e.target.value
                  if (v.startsWith('cat:')) {
                    setSourceId(null)
                    setFilter('all')
                    setCategory(v.slice(4))
                  } else {
                    setFilter(v)
                    setSourceId(null)
                    setCategory(null)
                  }
                }}
                className="w-full appearance-none rounded-lg border border-line bg-bg py-1.5 pl-2.5 pr-7 text-[13px] outline-none"
              >
                <option value="all">全部内容（{stats.total}）</option>
                <option value="favorites">我的收藏（{stats.favorites}）</option>
                <option value="pending">待转写（{stats.pending_transcripts}）</option>
                {categories.map((c) => (
                  <option key={c.name} value={`cat:${c.name}`}>
                    {c.name}（{c.source_count}）
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-1 mt-2 border-t border-line pt-2 text-[12px] text-ink-faint">信源博主（{sources.length}）</div>
              {filteredSources.length === 0 && <div className="text-[12px] text-ink-faint">还没有订阅博主，上方添加来源</div>}
              {filteredSources.map((s: RadarSource) => (
                <div key={s.id} className={`mb-1 rounded-lg border px-2 py-1.5 ${sourceId === s.id ? 'border-primary-soft bg-primary-soft/30' : 'border-line'}`}>
                  <div className="flex items-center justify-between">
                    <button className="min-w-0 flex-1 truncate text-left text-[13px] text-ink" onClick={() => { setSourceId(sourceId === s.id ? null : s.id); setFilter('all'); setCategory(null) }}>
                      {s.name}
                    </button>
                    <span className="ml-2 shrink-0 text-[12px] text-ink-faint">{s.content_count}</span>
                    <button
                      title="移除来源（内容保留）"
                      onClick={() => runAction(`rm-${s.id}`, () => radarApi.removeSource(s.id))}
                      className="ml-1.5 shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-danger"
                    >
                      移除
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                    <span className="flex items-center gap-2">
                      <span className={`${SYNC_STATUS[s.sync_status]?.cls ?? ''}`}>
                        {SYNC_STATUS[s.sync_status]?.label ?? s.sync_status}
                      </span>
                      {s.category ? <span className="rounded bg-primary-soft/40 px-1 py-0.5 text-[10px] text-primary-hover">{s.category}</span> : null}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <button
                        title="立即同步"
                        disabled={busyId === String(s.id)}
                        onClick={() => runAction(`sync-${s.id}`, () => radarApi.syncSource(s.id), (d) => flash(`同步完成，新增 ${d.added} 条（共 ${d.total}）`))}
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim hover:text-ink"
                      >
                        {busyId === String(s.id) ? <Loader2 size={11} className="animate-spin" /> : '同步'}
                      </button>
                      <button
                        title={s.auto_sync ? '自动同步（每 2 小时）已开启，点击关闭' : '开启自动同步（每 2 小时拉取博主新内容并拆解）'}
                        onClick={() => runAction(`auto-${s.id}`, () => radarApi.patchSource(s.id, { auto_sync: !s.auto_sync }))}
                        className={s.auto_sync ? 'text-primary-hover' : 'text-ink-faint'}
                      >
                        <RefreshCw size={12} />
                      </button>
                      {s.sec_uid && (
                        <a href={`https://www.douyin.com/user/${s.sec_uid}`} target="_blank" rel="noreferrer" className="hover:text-primary-hover" title="博主主页">
                          主页
                        </a>
                      )}
                    </span>
                  </div>
                  {s.sync_status === 'error' && !s.sec_uid && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="shrink-0 text-[10px] text-danger">缺主页链接</span>
                      <input
                        value={linkPatch[s.id] ?? ''}
                        onChange={(e) => setLinkPatch((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && saveSourceLink(s)}
                        placeholder="填 https://www.douyin.com/user/… 或 v.douyin.com 短链"
                        className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-1 text-[11px] outline-none placeholder:text-ink-faint focus:border-primary"
                      />
                      <button
                        disabled={busyId === `link-${s.id}`}
                        onClick={() => saveSourceLink(s)}
                        className="shrink-0 rounded border border-line px-1.5 py-1 text-[11px] text-ink-dim hover:text-ink"
                      >
                        {busyId === `link-${s.id}` ? <Loader2 size={11} className="animate-spin" /> : '保存并同步'}
                      </button>
                    </div>
                  )}
                  {/* 来源归类 */}
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="text-[10px] text-ink-faint">归类</span>
                    <select
                      value={s.category || ''}
                      onChange={(e) => setSourceCategory(s, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-[11px] outline-none"
                    >
                      <option value="">未分类</option>
                      {categories.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* 中栏：筛选 + 排序 + 两列卡片网格 */}
        <div className="order-1 min-w-0 rounded-xl border border-line bg-card lg:order-2">
          {/* 双维筛选 tabs */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2.5 text-[13px]">
            <div className="flex items-center gap-1">
              <span className="text-[12px] text-ink-faint">逐字稿</span>
              {[
                { k: 'all', label: '全部' },
                { k: 'pending', label: '未转写' },
                { k: 'ready', label: '已转写' },
              ].map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTs(t.k)}
                  className={`rounded px-2 py-1 text-[12px] ${ts === t.k ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:bg-bg'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[12px] text-ink-faint">选题</span>
              {[
                { k: 'all', label: '全部' },
                { k: 'undone', label: '未升级' },
                { k: 'done', label: '已升级' },
              ].map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTopic(t.k)}
                  className={`rounded px-2 py-1 text-[12px] ${topic === t.k ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:bg-bg'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="appearance-none rounded border border-line bg-surface py-1 pl-2 pr-7 text-[12px] outline-none"
                >
                  <option value="latest">排序 最新发布</option>
                  <option value="hot">排序 最多点赞</option>
                </select>
              </div>
            </div>
          </div>
          {/* 搜索 + 内容条数（对标：一行） */}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={14} className="shrink-0 text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题、作者或摘要"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
            />
            <span className="shrink-0 text-[12px] text-ink-faint">{contents.length}条真实内容</span>
          </div>
          {/* 两列卡片网格 */}
          <div className="max-h-[640px] overflow-y-auto p-3">
            {loading && <div className="p-8 text-center text-[13px] text-ink-dim">加载中…</div>}
            {!loading && contents.length === 0 && (
              <div className="p-10 text-center text-[13px] text-ink-faint">暂无内容，添加信源或关键词收录</div>
            )}
            <div className="grid gap-2 md:grid-cols-2">
              {contents.map((c: RadarContentItem) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`group cursor-pointer rounded-xl border bg-card p-3.5 transition-all ${
                    selectedId === c.id
                      ? 'border-primary/60 ring-1 ring-primary/30'
                      : 'border-line hover:border-primary-soft hover:bg-card/80'
                  }`}
                >
                  {/* 标题（中栏只展示标题 + 数据 + 升级，不展示账号/标签） */}
                  <div className="min-w-0 line-clamp-2 text-[13.5px] font-medium leading-relaxed text-ink">{c.title || '（无标题）'}</div>

                  {/* 作品发布时间（opencli create_time，缺失时不显示） */}
                  {c.publish_time && (
                    <div className="mt-1 text-[11px] text-ink-faint">发布于 {timeLabel(c.publish_time)}</div>
                  )}

                  {/* 数据四格 */}
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {[
                      { label: '点赞', value: c.digg_count, hot: true },
                      { label: '评论', value: c.comment_count, hot: false },
                      { label: '收藏', value: c.collect_count, hot: false },
                      { label: '分享', value: c.share_count, hot: false },
                    ].map((d) => (
                      <div
                        key={d.label}
                        className={`rounded-lg px-1 py-2 text-center ${d.hot && d.value > 0 ? 'bg-primary-soft/25' : 'bg-bg/70'}`}
                      >
                        <div className={`text-[13px] font-semibold ${d.hot && d.value > 0 ? 'text-primary-hover' : 'text-ink'}`}>
                          {fmt(d.value)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-ink-faint">{d.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* 操作行 */}
                  <div className="mt-3 flex items-center gap-2 border-t border-line/70 pt-2.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedId(c.id)
                        if (c.status === 'upgraded') return
                        runAction(`up-${c.id}`, () => radarApi.upgrade(c.id), (d) => {
                          flash(`已升级为项目「${d.project_title.slice(0, 20)}」`)
                          setSelectedId(null)
                        })
                      }}
                      disabled={busyId === `up-${c.id}` || c.status === 'upgraded'}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                        c.status === 'upgraded'
                          ? 'bg-success/15 text-success'
                          : 'border border-line text-ink-dim hover:border-primary-soft hover:text-ink'
                      } disabled:opacity-50`}
                    >
                      {busyId === `up-${c.id}` ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                      {c.status === 'upgraded' ? '已升级' : '升级为项目'}
                    </button>
                    {c.status === 'upgraded' && (
                      <Link to="/projects" onClick={(e) => e.stopPropagation()} className="text-[12px] text-primary-hover underline underline-offset-2">
                        查看项目 →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右栏：详情面板（对标：数据四格 + 转为我的选题 + 逐字稿 + 来源证据） */}
        <div className="order-3 space-y-4">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-line bg-surface/60 p-8 text-center text-[13px] text-ink-faint">
              选中左侧内容查看详情、生成选题候选、提取原字幕或升级为项目
            </div>
          ) : (
            <>
              {/* 头部：作者 + 收藏 + 标签 + 数据四格 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{selected.author || '未知博主'}</div>
                    {selected.collected_at && (
                      <div className="mt-0.5 text-[11px] text-ink-faint">采集于 {timeLabel(selected.collected_at)}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selected.aweme_id && (
                      <a
                        href={`https://www.douyin.com/video/${selected.aweme_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-danger/50 px-2 py-1 text-[11px] text-danger hover:bg-danger/10"
                      >
                        原链接
                      </a>
                    )}
                    <button
                      onClick={() => runAction(`fav-${selected.id}`, () => radarApi.patchContent(selected.id, { favorite: !selected.favorite }))}
                      className={selected.favorite ? 'text-warning' : 'text-ink-faint hover:text-ink-dim'}
                    >
                      <Star size={16} className={selected.favorite ? 'fill-warning' : ''} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[13px] font-medium text-ink">{selected.title || '（无标题）'}</div>
                {selected.hashtags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {selected.hashtags.map((h) => (
                      <span key={h} className="rounded-full bg-primary-soft/40 px-2 py-0.5 text-[11px] text-primary-hover">#{h}</span>
                    ))}
                  </div>
                )}
                {/* 数据四格：点赞 / 评论 / 收藏 / 分享 */}
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { label: '点赞', value: selected.digg_count },
                    { label: '评论', value: selected.comment_count },
                    { label: '收藏', value: selected.collect_count },
                    { label: '分享', value: selected.share_count },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg bg-bg/70 p-2 text-center">
                      <div className="text-sm font-semibold text-ink">{fmt(m.value)}</div>
                      <div className="text-[10px] text-ink-faint">{m.label}</div>
                    </div>
                  ))}
                </div>
                {metrics && metrics.length >= 1 && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-ink-faint">指标趋势（每日快照）</span>
                      <span className="text-[10px] text-ink-faint">{metrics[0].date} → {metrics[metrics.length - 1].date}</span>
                    </div>
                    <TrendSpark data={metrics} />
                  </div>
                )}
              </div>

              {/* 转为我的选题 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="mb-2 flex items-center justify-between text-[13px] font-medium">
                  <span>转为我的选题</span>
                  {selected.status === 'topicized' && <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success">已转选题</span>}
                  {selected.status === 'upgraded' && <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success">已升级项目</span>}
                </div>
                <div className="text-[12px] leading-relaxed text-ink-dim">
                  结合当前账号定位生成可编辑模板。生成阶段不会写选题，只有确认后才写入。
                </div>
                {!draft ? (
                  <button
                    disabled={busyId === `draft-${selected.id}` || selected.status === 'topicized' || selected.status === 'upgraded'}
                    onClick={generateDraft}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover hover:bg-primary-soft/60 disabled:opacity-50"
                  >
                    {busyId === `draft-${selected.id}` ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    生成选题候选
                  </button>
                ) : (
                  <div className="mt-3 space-y-1.5 rounded-lg bg-bg/70 p-3">
                    {(['title', 'audience', 'pain_point', 'core_decision', 'hook', 'form', 'difficulty'] as const).map((k) => (
                      <div key={k} className="flex items-start gap-2">
                        <span className="w-20 shrink-0 text-[11px] text-ink-faint">
                          {k === 'title' ? '标题' : k === 'audience' ? '人群' : k === 'pain_point' ? '痛点' : k === 'core_decision' ? '核心决策' : k === 'hook' ? '钩子' : k === 'form' ? '形式' : '难度'}
                        </span>
                        <input
                          value={draft[k] ?? ''}
                          onChange={(e) => setDraft((prev) => ({ ...(prev ?? {}), [k]: e.target.value }))}
                          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[12px] outline-none focus:border-primary"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={adoptDraft}
                        disabled={busyId === `adopt-${selected.id}`}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === `adopt-${selected.id}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        确认写入选题
                      </button>
                      <button onClick={() => setDraft(null)} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim hover:text-ink">
                        放弃
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 逐字稿：原字幕提取 + AI 改写 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="mb-2 flex items-center justify-between text-[13px] font-medium">
                  <span>逐字稿</span>
                  {selected.transcript_status === 'ready' ? (
                    <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success">
                      {selected.transcript_kind === 'original' ? '原字幕已提取' : '已就绪'}
                    </span>
                  ) : (
                    <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">尚未转写</span>
                  )}
                </div>
                <div className="text-[12px] leading-relaxed text-ink-dim">提取视频原字幕（语音转写），再在其基础上 AI 改写；也可粘贴正文或从文件导入。</div>
                {selected.transcript_status === 'ready' && (selected.transcript || selected.transcript_ai) ? (
                  <>
                    {selected.transcript && selected.transcript_ai && (
                      <div className="mt-2 flex gap-1">
                        <button
                          onClick={() => setShowAiTranscript(false)}
                          className={`rounded px-2 py-1 text-[11px] ${!showAiTranscript ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:bg-bg'}`}
                        >
                          原字幕
                        </button>
                        <button
                          onClick={() => setShowAiTranscript(true)}
                          className={`rounded px-2 py-1 text-[11px] ${showAiTranscript ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:bg-bg'}`}
                        >
                          AI 改写稿
                        </button>
                      </div>
                    )}
                    <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-ink-dim">
                      {showAiTranscript ? (selected.transcript_ai || selected.transcript) : (selected.transcript || selected.transcript_ai)}
                    </div>
                  </>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busyId === `tr-${selected.id}`}
                    onClick={() => { flash('正在下载视频并语音转写，约需 20-60 秒，请稍候…'); runAction(`tr-${selected.id}`, () => radarApi.extractSubtitle(selected.id), (d) => flash(d.skipped ? '该内容已提取过原字幕' : '原字幕提取完成')) }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
                    title="下载视频并语音转写，提取口播原字幕"
                  >
                    {busyId === `tr-${selected.id}` ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    提取原字幕
                  </button>
                  <button
                    disabled={busyId === `rw-${selected.id}` || !selected.transcript}
                    onClick={() => runAction(`rw-${selected.id}`, () => radarApi.rewriteTranscript(selected.id), () => { flash('AI 改写完成'); setShowAiTranscript(true) })}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover hover:bg-primary-soft/60 disabled:opacity-40"
                    title="在原字幕基础上 AI 改写为精炼口播稿"
                  >
                    {busyId === `rw-${selected.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    AI 改写
                  </button>
                  <label
                    className={`flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-dim hover:text-ink ${busyId === `tf-${selected.id}` ? 'pointer-events-none opacity-50' : ''} cursor-pointer`}
                  >
                    {busyId === `tf-${selected.id}` ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    从文件导入
                    <input
                      type="file"
                      accept=".txt,.md,.srt,.ass,.vtt"
                      className="hidden"
                      onChange={(e) => uploadTranscript(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <textarea
                  value={pasteTranscript}
                  onChange={(e) => setPasteTranscript(e.target.value)}
                  placeholder="或粘贴正文（原文）保存为逐字稿…"
                  className="mt-2 h-20 w-full resize-none rounded-lg border border-line bg-bg px-2.5 py-2 text-[12px] outline-none placeholder:text-ink-faint focus:border-primary"
                />
                <button
                  disabled={!pasteTranscript.trim()}
                  onClick={() =>
                    runAction(`save-tr-${selected.id}`, () =>
                      radarApi.patchContent(selected.id, { transcript: `【人工导入】\n${pasteTranscript.trim()}`, transcript_status: 'ready' }),
                    ).then(() => setPasteTranscript(''))
                  }
                  className="mt-2 w-full rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-40"
                >
                  添加逐字稿（粘贴保存）
                </button>
              </div>

              {/* 存入知识库 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="mb-2 flex items-center justify-between text-[13px] font-medium">
                  <span>存入知识库</span>
                  {selected.in_knowledge && <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success">已入库</span>}
                </div>
                <div className="text-[12px] leading-relaxed text-ink-dim">
                  将本条作品的描述与逐字稿沉淀为知识库条目（来源=视频，自动向量化，供选题/脚本检索引用）。
                </div>
                <button
                  disabled={busyId === `tok-${selected.id}` || selected.in_knowledge}
                  onClick={() =>
                    runAction(`tok-${selected.id}`, () => radarApi.toKnowledge(selected.id), (d) => {
                      flash(d.duplicated ? '该作品已在知识库中' : `已存入知识库：${d.knowledge.title}`)
                    })
                  }
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover hover:bg-primary-soft/60 disabled:opacity-40"
                >
                  {busyId === `tok-${selected.id}` ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
                  {selected.in_knowledge ? '已存入知识库' : '存入知识库'}
                </button>
              </div>

              {/* 来源证据 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="mb-2 text-[13px] font-medium">来源证据</div>
                <div className="line-clamp-3 text-[12px] leading-relaxed text-ink-dim">{selected.desc || '（无公开描述）'}</div>
                <div className="mt-2 text-[11px] text-ink-faint">
                  最近采集 {selected.collected_at ? timeLabel(selected.collected_at) : '-'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
