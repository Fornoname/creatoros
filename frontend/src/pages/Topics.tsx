import { BarChart3, Check, CircleX, Play, Plus, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { topicsApi, type Topic } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  candidate: { label: '候选', cls: 'bg-ink-faint/20 text-ink-dim' },
  pending_review: { label: '待审', cls: 'bg-warning/15 text-warning' },
  approved: { label: '已立项', cls: 'bg-success/15 text-success' },
  discarded: { label: '已丢弃', cls: 'bg-danger/15 text-danger' },
}

const SOURCE_META: { value: string; label: string; hint?: string }[] = [
  { value: 'comment', label: '评论问题', hint: '仅统计' },
  { value: 'consultation', label: '客户咨询', hint: '仅统计' },
  { value: 'knowledge', label: '知识' },
  { value: 'viral', label: '历史爆款', hint: '仅统计' },
  { value: 'hotspot', label: '行业热点' },
  { value: 'manual', label: '手动灵感' },
  { value: 'ai_meeting', label: 'AI选题会' },
]

const MEETING_ENTRIES = [
  { mode: 'manual', label: '手动加餐', desc: '说一句你想做的选题，编导补全成整张卡', icon: Plus },
  { mode: 'position', label: '基于定位出题', desc: '依据当前定位母版自动出题', icon: Sparkles },
  { mode: 'comment', label: '基于评论问题', desc: '从对标账号评论问题中出题', icon: BarChart3 },
]

const DRAFT_FIELDS: { key: string; label: string }[] = [
  { key: 'audience', label: '目标受众' },
  { key: 'pain_point', label: '观点痛点' },
  { key: 'core_decision', label: '核心决定' },
  { key: 'hook', label: '推荐 Hook' },
  { key: 'form', label: '内容形式' },
]

export default function Topics() {
  const { data, loading, run } = useAsync(() => topicsApi.list(), [])
  const { data: funnelData } = useAsync(() => topicsApi.funnel(), [])
  const [selected, setSelected] = useState<Topic | null>(null)
  const [activeStatus, setActiveStatus] = useState<string>('')
  const [activeSource, setActiveSource] = useState<string>('')
  const [activeTag, setActiveTag] = useState<string>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // 手动录入
  const [manualTitle, setManualTitle] = useState('')
  // AI 选题会（三入口 + 逐条采纳）
  const [meetingMode, setMeetingMode] = useState('manual')
  const [meetingSignals, setMeetingSignals] = useState('')
  const [meeting, setMeeting] = useState(false)
  const [drafts, setDrafts] = useState<{ mode: string; cards: Record<string, unknown>[]; verified_count?: number; profile_count?: number } | null>(null)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [todayOnly, setTodayOnly] = useState(false)
  const detailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selected) {
      // 点击任一选题卡后，滚动到右列详情面板，确保点击即见
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    }
  }, [selected])

  const topics = data?.topics ?? []
  const today = new Date().toDateString()
  const filtered = topics.filter(
    (t) =>
      (!activeStatus || t.status === activeStatus) &&
      (!activeSource || t.source === activeSource) &&
      (!activeTag || t.tag === activeTag) &&
      (!todayOnly || (t.created_at && new Date(t.created_at).toDateString() === today)) &&
      (!debouncedSearch ||
        (t.title + ' ' + (t.pain_point || '') + ' ' + (t.hook || '')).toLowerCase().includes(debouncedSearch.toLowerCase())),
  )
  const todayCount = topics.filter((t) => t.created_at && new Date(t.created_at).toDateString() === today).length
  const funnel = funnelData?.funnel ?? {}
  const sourceCounts = topics.reduce<Record<string, number>>((acc, t) => {
    acc[t.source] = (acc[t.source] ?? 0) + 1
    return acc
  }, {})
  const tags = [...new Set(topics.map((t) => t.tag).filter(Boolean))].sort()

  async function refresh() {
    const r = await run()
    if (r) {
      const list = (r as { topics: Topic[] }).topics
      setSelected((cur) => (cur ? list.find((t) => t.id === cur.id) ?? null : null))
    }
  }

  function doSearch() {
    setDebouncedSearch(search.trim())
  }

  async function addManual() {
    if (!manualTitle.trim()) return
    try {
      await topicsApi.create({ title: manualTitle.trim(), source: 'manual' })
      setManualTitle('')
      await refresh()
    } catch (e) {
      setNotice(`录入失败：${e instanceof Error ? e.message : e}`)
    }
  }

  async function startMeeting() {
    setMeeting(true)
    setNotice('AI 选题会进行中（约 1-2 分钟）…')
    try {
      const r = await topicsApi.aiMeeting(meetingMode, meetingSignals, true)
      if (r.drafts?.length) {
        setDrafts({ mode: meetingMode, cards: r.drafts, verified_count: r.verified_count ?? 0, profile_count: r.profile_count ?? 0 })
        setNotice(`选题会完成，产出 ${r.drafts.length} 张草稿，逐条采纳进候选池`)
      } else {
        setNotice('选题会完成，但未产出草稿，可换一种依据重试')
      }
    } catch (e) {
      setNotice(`选题会失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setMeeting(false)
    }
  }

  async function adoptCard(card: Record<string, unknown>) {
    try {
      await topicsApi.adopt({ ...card, source: 'ai_meeting', tag: drafts?.mode === 'position' ? '基于定位出题' : '候选池' })
      setDrafts((d) => (d ? { ...d, cards: d.cards.filter((c) => c !== card) } : d))
      setNotice(`已采纳：${String(card.title).slice(0, 30)}…`)
      await refresh()
    } catch (e) {
      setNotice(`采纳失败：${e instanceof Error ? e.message : e}`)
    }
  }

  function skipCard(card: Record<string, unknown>) {
    setDrafts((d) => (d ? { ...d, cards: d.cards.filter((c) => c !== card) } : d))
  }

  async function act(id: number, kind: 'complete' | 'project' | 'discard') {
    setBusyId(id)
    try {
      if (kind === 'complete') {
        setNotice('AI 补全中…')
        const r = await topicsApi.complete(id)
        setSelected(r.topic)
      } else if (kind === 'project') {
        await topicsApi.projectize(id)
        setNotice('已立项，可在「项目」中查看')
      } else {
        await topicsApi.discard(id)
      }
      await refresh()
    } catch (e) {
      setNotice(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">选题中心</h1>
          <p className="mt-1 text-[13px] text-ink-dim">从真实信号出题、补全选题卡、择优立项——一条选题从灵感到立项的全流程</p>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">{notice}</div>
      )}

      {/* 左窄右宽：左=今日新选题/AI选题会/选题来源；右=选题候选池 */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* ── 左列 ── */}
        <div className="space-y-4 lg:col-span-2">
          {/* 今日新选题 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[12px] font-semibold text-primary-hover">
                今日新选题 {todayCount}
              </span>
              <span className="text-[11px] text-ink-faint">系统昨夜~今晨自动供给的候选</span>
              <button
                type="button"
                onClick={() => setTodayOnly((v) => !v)}
                className={`ml-auto rounded-full border px-2.5 py-1 text-[11px] ${todayOnly ? 'border-primary-soft bg-primary-soft/40 text-primary-hover' : 'border-line text-ink-faint hover:text-ink'}`}
              >
                {todayOnly ? '只看今日' : '查看全部'}
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {topics
                .filter((t) => t.created_at && new Date(t.created_at).toDateString() === today)
                .slice(0, 4)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t)}
                    className={`w-full rounded-lg bg-bg/60 px-3 py-2 text-left ${selected?.id === t.id ? 'ring-1 ring-primary-soft' : ''}`}
                  >
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STATUS_META[t.status]?.cls ?? ''}`}>
                        {STATUS_META[t.status]?.label ?? t.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{t.title}</span>
                      {t.tag && <span className="shrink-0 text-[10px] text-primary-hover">{t.tag}</span>}
                    </div>
                    {(t.hook || t.pain_point) && (
                      <div className="mt-1 line-clamp-1 text-[11px] text-ink-faint">
                        {t.hook ? `Hook：${t.hook}` : t.pain_point}
                      </div>
                    )}
                  </button>
                ))}
              {!topics.some((t) => t.created_at && new Date(t.created_at).toDateString() === today) && (
                <div className="rounded-lg bg-bg/40 px-3 py-2 text-[12px] text-ink-faint">
                  今日暂无新选题。可手动录入灵感，或发起一次 AI 选题会。
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManual()}
                placeholder="手动记录一条灵感…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
              />
              <button
                type="button"
                onClick={addManual}
                className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink"
              >
                <Plus size={13} />
                添加
              </button>
            </div>
          </div>

          {/* AI 选题会 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles size={15} className="text-primary-hover" />
              AI 选题会
              <span className="text-[11px] font-normal text-ink-faint">挑一种依据开聊，逐条采纳进候选池</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {MEETING_ENTRIES.map((e) => {
                const Icon = e.icon
                const active = meetingMode === e.mode
                return (
                  <button
                    key={e.mode}
                    type="button"
                    onClick={() => setMeetingMode(e.mode)}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active ? 'border-primary bg-primary-soft/40' : 'border-line bg-bg/40 hover:border-primary-soft'
                    }`}
                  >
                    <Icon size={15} className={active ? 'shrink-0 text-primary-hover' : 'shrink-0 text-ink-dim'} />
                    <div className="min-w-0">
                      <div className={`text-[13px] font-medium ${active ? 'text-primary-hover' : 'text-ink'}`}>{e.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-ink-faint">{e.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={meetingSignals}
                onChange={(e) => setMeetingSignals(e.target.value)}
                placeholder="信号素材：评论问题 / 热点 / 一句话想法…（可留空）"
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
              />
              <button
                type="button"
                onClick={startMeeting}
                disabled={meeting}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {meeting ? '思考中…' : '开始选题会'}
              </button>
            </div>

            {/* 草稿列表（逐条采纳） */}
            {drafts && drafts.cards.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-medium text-ink-dim">候选草稿（{drafts.cards.length}）— 逐条采纳</div>
                  {drafts.verified_count ? (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600">
                      已参考该账号历史爆款特征（{drafts.verified_count} 条已验证）
                    </div>
                  ) : null}
                  {drafts.profile_count ? (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-600">
                      已参考该账号创作画像（{drafts.profile_count} 项风格指纹）
                    </div>
                  ) : null}
                  <button type="button" onClick={() => setDrafts(null)} className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink">
                    <X size={12} /> 收起
                  </button>
                </div>
                {drafts.cards.map((c, i) => (
                  <div key={i} className="rounded-lg border border-primary-soft/50 bg-bg/50 p-3">
                    <div className="text-[13px] font-medium text-ink">{String(c.title)}</div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                      {DRAFT_FIELDS.map((f) => (
                        <div key={f.key} className="min-w-0">
                          <div className="text-[10px] text-ink-faint">{f.label}</div>
                          <div className="truncate text-[11px] text-ink-dim">{String(c[f.key] || '—')}</div>
                        </div>
                      ))}
                      <div className="min-w-0">
                        <div className="text-[10px] text-ink-faint">难度</div>
                        <div className="text-[11px] text-ink-dim">{String(c.difficulty || 'low')}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => adoptCard(c)}
                        className="flex items-center gap-1 rounded-lg bg-success/20 px-2.5 py-1 text-[12px] text-success hover:bg-success/30"
                      >
                        <Check size={12} /> 采纳进候选池
                      </button>
                      <button
                        type="button"
                        onClick={() => skipCard(c)}
                        className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-faint hover:text-ink"
                      >
                        跳过
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 选题来源 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-2 text-[13px] font-medium">选题来源</div>
            <div className="space-y-1.5">
              {SOURCE_META.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setActiveSource(activeSource === s.value ? '' : s.value)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] transition-colors ${
                    activeSource === s.value ? 'bg-primary-soft/50 text-primary-hover' : 'text-ink-dim hover:bg-bg/60'
                  }`}
                >
                  <span className="flex-1 text-left">{s.label}</span>
                  <span className="text-[13px] font-semibold text-ink">{sourceCounts[s.value] ?? 0}</span>
                  {s.hint && <span className="text-[10px] text-ink-faint">{s.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 右列：选题候选池 ── */}
        <div className="lg:col-span-3">
          {/* 选题卡详情（置顶，点击任一选题卡后自动滚动定位） */}
          {selected && (
            <div ref={detailRef} className="rounded-xl border border-line bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium">选题卡详情</div>
                {selected.status === 'approved' && (
                  <Link to="/projects" className="text-[13px] text-primary-hover hover:underline">
                    查看项目 →
                  </Link>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Detail label="目标受众" value={selected.audience} />
                <Detail label="观点痛点" value={selected.pain_point} />
                <Detail label="核心决定" value={selected.core_decision} />
                <Detail label="推荐 Hook" value={selected.hook} />
                <Detail label="内容形式" value={selected.form} />
                <Detail label="制作难度" value={selected.difficulty} />
              </div>
              {selected.status === 'pending_review' && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => act(selected.id, 'project')}
                    className="flex items-center gap-1.5 rounded-lg bg-success/20 px-3 py-1.5 text-sm text-success hover:bg-success/30"
                  >
                    <Check size={14} />
                    立项为项目
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 rounded-xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <div className="text-sm font-medium">选题候选池</div>
                <div className="mt-0.5 text-[11px] text-ink-faint">说一句你想做的选题，编导补全成整张卡</div>
              </div>
              <div className="relative ml-auto w-52">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                  placeholder="搜索选题…"
                  className="w-full rounded-lg border border-line bg-bg py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveStatus('')}
                className={`rounded-lg px-3 py-1.5 text-[13px] ${activeStatus === '' ? 'bg-primary-soft text-primary-hover' : 'border border-line text-ink-dim'}`}
              >
                全部
              </button>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveStatus(k)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] ${activeStatus === k ? 'bg-primary-soft text-primary-hover' : 'border border-line text-ink-dim'}`}
                >
                  {v.label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-line" />
              {tags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTag('')}
                  className={`rounded-lg px-2.5 py-1.5 text-[12px] ${activeTag === '' ? 'bg-primary-soft text-primary-hover' : 'border border-line text-ink-dim'}`}
                >
                  全部标签
                </button>
              )}
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveTag(activeTag === t ? '' : t)}
                  className={`rounded-lg px-2.5 py-1.5 text-[12px] ${activeTag === t ? 'bg-primary-soft text-primary-hover' : 'border border-line text-ink-dim'}`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-faint">
              <span>候选 {funnel.candidate ?? 0} · 待审 {funnel.pending_review ?? 0} · 已立项 {funnel.approved ?? 0} · 已丢弃 {funnel.discarded ?? 0} · 共 {funnelData?.total ?? 0}</span>
            </div>

            {loading ? (
              <div className="py-8 text-center text-[13px] text-ink-faint">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface/60 py-12 text-center">
                <BarChart3 size={20} className="text-ink-faint" />
                <div className="mt-2 text-sm text-ink-dim">暂无选题</div>
                <div className="mt-1 text-[13px] text-ink-faint">手动录入灵感，或发起一次 AI 选题会生成候选选题</div>
              </div>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {filtered.map((t) => {
                  const meta = STATUS_META[t.status] ?? STATUS_META.candidate
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected(t)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        selected?.id === t.id ? 'border-primary bg-primary-soft/50' : 'border-line bg-card hover:border-primary-soft'
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] ${meta.cls}`}>{meta.label}</span>
                        <span className="text-[11px] text-ink-faint">
                          {SOURCE_META.find((s) => s.value === t.source)?.label ?? t.source}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-primary-hover">{t.score ?? 0}</span>
                          <span className="h-1 w-10 overflow-hidden rounded-full bg-bg">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${t.score ?? 0}%` }} />
                          </span>
                        </span>
                        {t.difficulty === 'high' && <span className="text-[11px] text-danger">高难度</span>}
                      </div>
                      <div className="text-sm font-medium leading-snug text-ink">{t.title}</div>
                      {(t.hook || t.pain_point) && (
                        <div className="mt-2 line-clamp-2 text-[12px] text-ink-dim">
                          {t.hook ? `Hook：${t.hook}` : t.pain_point}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.status === 'candidate' && (
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              act(t.id, 'complete')
                            }}
                            className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[12px] text-white hover:bg-primary-hover"
                          >
                            <Sparkles size={12} />
                            {busyId === t.id ? '补全中…' : 'AI 补全'}
                          </span>
                        )}
                        {t.status === 'pending_review' && (
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              act(t.id, 'project')
                            }}
                            className="flex items-center gap-1 rounded-lg bg-success/20 px-2 py-1 text-[12px] text-success hover:bg-success/30"
                          >
                            <Play size={12} />
                            立项
                          </span>
                        )}
                        {['candidate', 'pending_review'].includes(t.status) && (
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              act(t.id, 'discard')
                            }}
                            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] text-ink-faint hover:text-danger"
                          >
                            <CircleX size={12} />
                            丢弃
                          </span>
                        )}
                        {t.tag && (
                          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-primary-soft/30 px-2 py-1 text-[10px] text-primary-hover">
                            <span className="h-1 w-1 rounded-full bg-primary-hover" />
                            {t.tag}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg/60 p-3">
      <div className="text-[12px] text-ink-faint">{label}</div>
      <div className="mt-1 text-[13px] text-ink">{value || '—'}</div>
    </div>
  )
}
