import {
  Activity,
  BarChart3,
  BookMarked,
  Check,
  Clock,
  Eye,
  Heart,
  Image,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
  Timer,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { projectsApi, reviewApi, type FormulaInfo, type ReviewResult } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const METRIC_KEYS: { k: string; label: string; Icon: LucideIcon; pct?: boolean; suffix?: string }[] = [
  { k: 'views', label: '总播放', Icon: Eye },
  { k: 'likes', label: '总点赞', Icon: Heart },
  { k: 'comments', label: '评论', Icon: MessageSquare },
  { k: 'shares', label: '分享', Icon: Share2 },
  { k: 'favorites', label: '收藏', Icon: BookMarked },
  { k: 'followers_gained', label: '涨粉', Icon: Users },
  { k: 'completion_rate', label: '完播率', Icon: Play, pct: true },
  { k: 'retention_5s', label: '5s留存', Icon: Clock, pct: true },
  { k: 'cover_ctr', label: '封面CTR', Icon: Image, pct: true },
  { k: 'avg_watch_seconds', label: '平均观看', Icon: Timer, suffix: 's' },
] as const

export default function Review() {
  const { data: metricsData, run: refreshMetrics } = useAsync(() => reviewApi.metrics(), [])
  const { data: formulasData, run: refreshFormulas } = useAsync(() => reviewApi.formulas('all'), [])
  const { data: projectsData } = useAsync(() => projectsApi.list(), [])
  const { data: predictionsData, run: refreshPredictions } = useAsync(() => reviewApi.predictions(), [])
  const [projectId, setProjectId] = useState<number>(0)
  const [projectMetricsData, setProjectMetricsData] = useState<{ metrics: Record<string, number | null> | null } | null>(null)

  useEffect(() => {
    if (!projectId) {
      setProjectMetricsData(null)
      return
    }
    let cancelled = false
    void reviewApi
      .projectMetrics(projectId)
      .then((d) => {
        if (!cancelled) setProjectMetricsData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [busy, setBusy] = useState<null | 'review' | 'formulas' | 'pull'>(null)
  const [notice, setNotice] = useState('')

  const metrics = metricsData?.metrics ?? []
  const formulas = formulasData?.formulas ?? []
  const candidates = formulas.filter((f) => f.status === 'candidate')
  const adopted = formulas.filter((f) => f.status === 'adopted')

  async function pullMetrics() {
    setBusy('pull')
    setNotice('正在拉取抖音真实作品指标…')
    try {
      const r = await reviewApi.pullMetrics()
      setNotice(`已拉取 ${r.pulled} 条新指标（共 ${r.total} 条作品）`)
      await refreshMetrics()
    } catch (e) {
      setNotice(`拉取失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function analyze() {
    setBusy('review')
    setNotice('AI 正在复盘（约 1 分钟）…')
    try {
      const r = await reviewApi.analyze(1)
      setReview(r.review)
      setNotice('复盘完成')
    } catch (e) {
      setNotice(`复盘失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function generateFormulas() {
    setBusy('formulas')
    setNotice('AI 正在提炼公式候选…')
    try {
      await reviewApi.generateFormulas()
      setNotice('公式候选已生成')
      await refreshFormulas()
    } catch (e) {
      setNotice(`提炼失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function decide(f: FormulaInfo, action: 'adopt' | 'reject') {
    try {
      await reviewApi.decideFormula(f.id, action)
      await refreshFormulas()
    } catch (e) {
      setNotice(`操作失败：${e instanceof Error ? e.message : e}`)
    }
  }

  async function exportReport() {
    setNotice('正在生成复盘报告…')
    try {
      const r = await reviewApi.export()
      const blob = new Blob([r.report], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CreatorOS复盘报告_${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
      setNotice('复盘报告已导出')
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : e}`)
    }
  }

  // 汇总指标
  const sum = {
    views: metrics.reduce((a, m) => a + m.views, 0),
    likes: metrics.reduce((a, m) => a + m.likes, 0),
    comments: metrics.reduce((a, m) => a + m.comments, 0),
    shares: metrics.reduce((a, m) => a + m.shares, 0),
    favorites: metrics.reduce((a, m) => a + m.favorites, 0),
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">复盘中心</h1>
        <p className="mt-1 text-[13px] text-ink-dim">预测 vs 实际 · AI 复盘归因 · 可复用公式沉淀（飞轮闭环）</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">
          {notice}
        </div>
      )}

      {/* 指标卡 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 size={15} className="text-primary-hover" />
            指标总览（抖音真实数据）
          </div>
          <button
            type="button"
            onClick={pullMetrics}
            disabled={busy === 'pull'}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy === 'pull' ? 'animate-spin' : ''} />
            {busy === 'pull' ? '拉取中…' : '拉取数据'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <MetricCard icon={<Eye size={14} />} label="总播放" value={sum.views} />
          <MetricCard icon={<Heart size={14} />} label="总点赞" value={sum.likes} />
          <MetricCard icon={<MessageSquare size={14} />} label="总评论" value={sum.comments} />
          <MetricCard icon={<Share2 size={14} />} label="总分享" value={sum.shares} />
          <MetricCard icon={<BookMarked size={14} />} label="总收藏" value={sum.favorites} />
        </div>
        <div className="mt-2 text-[12px] text-ink-faint">
          {metrics.length > 0 ? `共 ${metrics.length} 条作品指标快照` : '暂无指标，点击「拉取数据」同步抖音作品数据'}
        </div>
      </div>

      {/* 项目级指标卡 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 size={15} className="text-primary-hover" />
            项目指标卡（10 项）
          </div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(Number(e.target.value))}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] text-ink"
          >
            <option value={0}>选择项目…</option>
            {(projectsData?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        {projectId === 0 ? (
          <div className="rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
            选择项目后展示 10 项指标：播放/点赞/评论/分享/收藏/涨粉/完播率/5s留存/封面CTR/平均观看
          </div>
        ) : !projectMetricsData?.metrics ? (
          <div className="rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
            该项目暂无指标数据，先到「指标总览」拉取抖音数据
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {METRIC_KEYS.map((m) => {
              const v = projectMetricsData.metrics![m.k] as number | null | undefined
              const text =
                v == null
                  ? '—'
                  : m.pct
                    ? `${v}%`
                    : m.suffix
                      ? `${v}${m.suffix}`
                      : Number(v).toLocaleString()
              return (
                <div key={m.k} className="rounded-lg bg-bg/70 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[11px] text-ink-dim">
                    <m.Icon size={12} />
                    {m.label}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-ink">{text}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 帮我复盘 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity size={15} className="text-primary-hover" />
            帮我复盘
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportReport}
              className="rounded-lg border border-line px-3 py-2 text-[13px] text-ink-dim hover:text-ink"
            >
              导出报告
            </button>
            <button
              type="button"
              onClick={analyze}
              disabled={busy === 'review'}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy === 'review' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {busy === 'review' ? '复盘分析中…' : 'AI 复盘'}
            </button>
          </div>
        </div>
        {review ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-bg/60 p-3 text-[13px] leading-relaxed text-ink">{review.summary}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <ReviewList title="表现好的方面" items={review.strengths} tone="good" />
              <ReviewList title="表现差的方面" items={review.weaknesses} tone="bad" />
            </div>
            <ReviewList title="下一条的改进动作" items={review.actions} tone="action" />
            {review.adoptable.length > 0 && (
              <div className="rounded-lg border border-primary-soft/50 bg-primary-soft/20 p-3">
                <div className="mb-2 text-[13px] font-medium text-primary-hover">本期可采纳沉淀</div>
                <ul className="space-y-1.5 text-[13px] text-ink">
                  {review.adoptable.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-primary-hover" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line py-10 text-center text-[13px] text-ink-faint">
            点击「AI 复盘」，基于真实指标做归因分析与可采纳沉淀
          </div>
        )}
      </div>

      {/* 预测 vs 实际 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp size={15} className="text-primary-hover" />
            预测 vs 实际（校准飞轮）
          </div>
          <button
            type="button"
            onClick={refreshPredictions}
            className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-dim hover:text-ink"
          >
            刷新
          </button>
        </div>
        <PredictionVsActual predictions={predictionsData?.predictions ?? []} />
      </div>

      {/* 公式库 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Star size={15} className="text-primary-hover" />
            本账号可复用公式
          </div>
          <button
            type="button"
            onClick={generateFormulas}
            disabled={busy === 'formulas'}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {busy === 'formulas' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy === 'formulas' ? '提炼中…' : '提炼公式'}
          </button>
        </div>
        {adopted.length > 0 && (
          <div className="mb-3">
            <div className="mb-2 text-[12px] font-medium text-success">已采纳（自动注入选题会约束）</div>
            <div className="space-y-2">
              {adopted.map((f) => (
                <FormulaCard key={f.id} f={f} onDecide={decide} adopted />
              ))}
            </div>
          </div>
        )}
        <div className="text-[12px] font-medium text-ink-dim">候选（带证据）</div>
        {candidates.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
            暂无公式候选，点击「提炼公式」从真实表现数据生成
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {candidates.map((f) => (
              <FormulaCard key={f.id} f={f} onDecide={decide} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg/60 p-3">
      <div className="flex items-center gap-1.5 text-[12px] text-ink-dim">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-ink">{value.toLocaleString()}</div>
    </div>
  )
}

function ReviewList({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'bad' | 'action' }) {
  if (!items.length) return null
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-primary-hover'
  const icon = tone === 'good' ? '✓' : tone === 'bad' ? '✗' : '→'
  return (
    <div>
      <div className={`mb-1.5 text-[12px] font-medium ${color}`}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13px] text-ink-dim">
            <span className={`shrink-0 ${color}`}>{icon}</span>
            <span className="leading-relaxed">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PredictionVsActual({
  predictions,
}: {
  predictions: {
    id: number
    project_id: number | null
    predicted_views: number
    predicted_completion: number | null
    reasoning: string
    actual_views: number | null
    actual_count: number
    created_at: string | null
  }[]
}) {
  if (predictions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
        暂无发布前 AI 预测。在项目编辑器「复盘」页发起预测后，这里会展示预测与实际的校准对比。
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {predictions.map((p) => {
        const hasActual = p.actual_views != null
        const diff = hasActual && p.predicted_views > 0 ? ((p.actual_views! - p.predicted_views) / p.predicted_views) * 100 : null
        const good = diff == null || diff >= -30
        return (
          <div key={p.id} className="rounded-lg border border-line bg-bg/40 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="text-ink-dim">AI 预测播放</span>
              <span className="text-base font-semibold text-ink">{p.predicted_views.toLocaleString()}</span>
              <span className="text-ink-faint">
                完播率 {p.predicted_completion != null ? `${(p.predicted_completion * 100).toFixed(0)}%` : '—'}
              </span>
              <span className="mx-1 text-ink-faint">→</span>
              <span className="text-ink-dim">实际</span>
              {hasActual ? (
                <span className="text-base font-semibold text-ink">{p.actual_views!.toLocaleString()}</span>
              ) : (
                <span className="text-ink-faint">等待数据回流</span>
              )}
              {diff != null && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    good ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                  }`}
                >
                  {diff >= 0 ? `+${diff.toFixed(0)}%` : `${diff.toFixed(0)}%`} 于预测
                </span>
              )}
              {p.actual_count > 0 && <span className="text-[11px] text-ink-faint">基于 {p.actual_count} 条作品</span>}
            </div>
            {p.reasoning && <div className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">预测理由：{p.reasoning}</div>}
          </div>
        )
      })}
    </div>
  )
}

function FormulaCard({
  f,
  onDecide,
  adopted,
}: {
  f: FormulaInfo
  onDecide: (f: FormulaInfo, action: 'adopt' | 'reject') => void
  adopted?: boolean
}) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-medium text-ink">{f.title}</span>
        <span className="rounded bg-ink-faint/20 px-1.5 py-0.5 text-[10px] text-ink-dim">{f.dimension}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-ink-faint">
          {(f.usage_count ?? 0) > 0 && <span className="text-primary-hover">被引用 {f.usage_count} 次</span>}
          置信 {(f.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">{f.content}</p>
      {f.evidence && <div className="mt-1.5 text-[12px] text-primary-hover/80">证据：{f.evidence}</div>}
      {!adopted && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onDecide(f, 'adopt')}
            className="flex items-center gap-1 rounded-lg bg-success/15 px-2.5 py-1 text-[12px] text-success hover:bg-success/25"
          >
            <Check size={12} />
            采纳
          </button>
          <button
            type="button"
            onClick={() => onDecide(f, 'reject')}
            className="flex items-center gap-1 rounded-lg bg-danger/15 px-2.5 py-1 text-[12px] text-danger hover:bg-danger/25"
          >
            <X size={12} />
            驳回
          </button>
        </div>
      )}
      {adopted && (
        <div className="mt-2 flex items-center gap-1 text-[12px] text-success">
          <Check size={12} />
          已采纳，将影响后续选题会
        </div>
      )}
    </div>
  )
}
