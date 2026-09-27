import { ArrowRight, Clock, Eye, FileText, Heart, ListTodo, Sparkles, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { dashboardApi, projectsApi, reviewApi, topicsApi } from '../api/client'

function TrendChart({ trend }: { trend: { date: string; views: number; likes: number }[] }) {
  const W = 520
  const H = 140
  const P = { l: 34, r: 10, t: 12, b: 22 }
  const maxV = Math.max(1, ...trend.map((t) => t.views))
  const maxL = Math.max(1, ...trend.map((t) => t.likes))
  const max = Math.max(maxV, maxL * 8)
  const n = trend.length
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, n - 1)
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b)
  const path = (key: 'views' | 'likes') =>
    trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(t[key]).toFixed(1)}`).join(' ')
  const last = trend[n - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="播放/点赞趋势">
      {[0.25, 0.5, 0.75].map((r) => (
        <line key={r} x1={P.l} x2={W - P.r} y1={P.t + (H - P.t - P.b) * r} y2={P.t + (H - P.t - P.b) * r} stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
      ))}
      <polyline points={path('views')} fill="none" stroke="#7c3aed" strokeWidth={2} strokeLinejoin="round" />
      <polyline points={path('likes')} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
      {trend.map((t, i) => (
        <circle key={i} cx={x(i)} cy={y(t.views)} r={i === n - 1 ? 3.5 : 2} fill="#7c3aed" />
      ))}
      {trend.filter((_, i) => i % Math.max(1, Math.floor(n / 6)) === 0 || i === n - 1).map((t) => {
        const idx = trend.indexOf(t)
        return (
          <text key={idx} x={x(idx)} y={H - 6} textAnchor={idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle'} fontSize={9} fill="currentColor" fillOpacity={0.55}>
            {t.date.slice(5)}
          </text>
        )
      })}
      {last && (
        <text x={x(n - 1) - 6} y={Math.max(10, y(last.views) - 8)} textAnchor="end" fontSize={10} fill="#7c3aed" fontWeight={600}>
          {last.views.toLocaleString()}
        </text>
      )}
      <text x={P.l} y={14} fontSize={10} fill="currentColor" fillOpacity={0.5}>播放</text>
      <text x={W - P.r - 34} y={14} fontSize={10} fill="currentColor" fillOpacity={0.5}>-- 点赞</text>
    </svg>
  )
}

export default function Dashboard() {
  const { data: metricsData } = useAsync(() => reviewApi.metrics(), [])
  const { data: topicsData } = useAsync(() => topicsApi.list('approved'), [])
  const { data: projectsData } = useAsync(() => projectsApi.list(), [])
  const { data: formulasData } = useAsync(() => reviewApi.formulas('adopted'), [])
  const { data: overviewData } = useAsync(() => dashboardApi.overview(), [])

  const metrics = metricsData?.metrics ?? []
  const overview = overviewData
  const recentWorks = overview?.works ?? []
  const trend = overview?.trend ?? []
  const projects = projectsData?.projects ?? []
  const activeTopics = topicsData?.topics ?? []
  const formulas = formulasData?.formulas ?? []

  const totalViews = metrics.reduce((a, m) => a + m.views, 0)
  const totalLikes = metrics.reduce((a, m) => a + m.likes, 0)
  const totalShares = metrics.reduce((a, m) => a + m.shares, 0)
  const bestVideo = [...metrics].sort((a, b) => b.views - a.views)[0]

  // 待办：进行中的项目 + 未立项候选 + 发布排期逾期
  const ongoing = projects.filter((p) => p.status !== 'published' && p.status !== 'reviewing')
  const pendingTopics = (topicsData?.topics ?? []).filter((t) => t.status === 'pending_review')
  const overdue = overview?.overdue_projects ?? []

  const followers = overview?.account.follower_count ?? 0
  const completionAvg = overview?.completion_rate_avg

  const METRICS_CARDS = [
    { label: '总播放', value: totalViews, icon: Eye },
    { label: '总点赞', value: totalLikes, icon: Heart },
    { label: '总粉丝', value: followers, icon: Sparkles },
    {
      label: '平均完播率',
      value: completionAvg != null ? `${completionAvg}%` : '—',
      icon: TrendingUp,
    },
    { label: '总分享', value: totalShares, icon: TrendingUp },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">下午好，编导</h1>
        <p className="mt-1 text-[13px] text-ink-dim">
          {bestVideo
            ? `最高播放作品 #${bestVideo.item_id.slice(-6)} 播放 ${bestVideo.views.toLocaleString()}，继续保持产出`
            : '先同步一次发布数据，系统就能开始帮你复盘与沉淀'}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-faint">
          今天有 {overview?.todo_count ?? 0} 项待办、{(overview?.suggestions ?? []).length} 条创作建议待处理
        </p>
      </div>

      {/* 指标卡 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {METRICS_CARDS.map((m) => (
          <div key={m.label} className="rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs text-ink-dim">
              <m.icon size={13} />
              {m.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-ink">{m.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* 本周趋势 + 最近发布 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-card p-4 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <TrendingUp size={15} className="text-primary-hover" />
            本周趋势
          </div>
          {trend.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-ink-faint">暂无趋势数据，同步作品后自动积累</div>
          ) : (
            <>
              <TrendChart trend={trend} />
              <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-ink-dim">
                <span>最近发布 {overview?.account.works ?? 0} 条</span>
                <span>粉丝 {overview?.account.follower_count ?? 0}</span>
                <span>累计播放 {overview?.account.total_views ?? 0}</span>
              </div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Clock size={15} className="text-primary-hover" />
            最近发布
          </div>
          {recentWorks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
              暂无已发布作品，去设置页「一键导入历史作品」
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentWorks.map((w) => (
                <div key={w.item_id} className="flex items-center gap-2 rounded-lg bg-bg/60 px-2.5 py-2">
                  {w.cover_url && <img src={w.cover_url} alt="" className="h-9 w-14 shrink-0 rounded object-cover" loading="lazy" />}
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-[12px] text-ink">{w.title || w.item_id}</div>
                    <div className="text-[10px] text-ink-faint">
                      {w.platform} · {w.created_at ? new Date(w.created_at).toLocaleDateString('zh-CN') : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 继续创作 */}
        <div className="rounded-xl border border-line bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <FileText size={15} className="text-primary-hover" />
            继续创作
          </div>
          {ongoing.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
              暂无进行中的项目，从选题中心立项一个项目开始创作
            </div>
          ) : (
            <div className="space-y-2">
              {ongoing.slice(0, 5).map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="flex items-center gap-3 rounded-lg bg-bg/60 px-3 py-2.5 transition-colors hover:bg-primary-soft/20"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.title}</span>
                  <span className="rounded bg-ink-faint/20 px-1.5 py-0.5 text-[11px] text-ink-dim">{p.status}</span>
                  <ArrowRight size={13} className="shrink-0 text-ink-faint" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* 待办 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ListTodo size={15} className="text-primary-hover" />
              待办
            </div>
            {pendingTopics.length === 0 && ongoing.length === 0 && overdue.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
                暂无待办
              </div>
            ) : (
              <div className="space-y-1.5">
                {overdue.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger hover:bg-danger/15">
                    <Clock size={13} className="shrink-0" />
                    <span className="min-w-0 truncate">发布排期逾期：{p.title}</span>
                  </Link>
                ))}
                {pendingTopics.slice(0, 3).map((t) => (
                  <Link key={t.id} to="/topics" className="flex items-center gap-2 rounded-lg bg-bg/60 px-3 py-2 text-[13px] text-ink hover:bg-primary-soft/20">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    <span className="min-w-0 truncate">{t.title}</span>
                  </Link>
                ))}
                {ongoing.slice(0, 2).map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-2 rounded-lg bg-bg/60 px-3 py-2 text-[13px] text-ink hover:bg-primary-soft/20">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 truncate">{p.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 热门选题热词 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Sparkles size={15} className="text-primary-hover" />
              热门选题热词
            </div>
            {(overview?.hot_topics ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-5 text-center text-[13px] text-ink-faint">
                暂无热词（选题标题含 #话题 时自动聚合）
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(overview?.hot_topics ?? []).slice(0, 10).map((h, i) => (
                  <span
                    key={h.tag}
                    className={`rounded-full px-2.5 py-1 text-[12px] ${i < 3 ? 'bg-primary-soft text-primary-hover' : 'bg-bg text-ink-dim'}`}
                  >
                    #{h.tag} <span className="opacity-70">{h.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 热门选题 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles size={15} className="text-primary-hover" />
                热门选题
              </div>
              <Link to="/topics" className="flex items-center gap-1 text-[12px] text-primary-hover hover:underline">
                去选选题 <ArrowRight size={12} />
              </Link>
            </div>
            {activeTopics.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
                暂无已立项选题
              </div>
            ) : (
              <div className="space-y-1.5">
                {activeTopics.slice(0, 3).map((t) => (
                  <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg bg-bg/60 px-3 py-2 text-[13px] text-ink">
                    <span className="min-w-0 truncate">{t.title}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">热度 {Math.round((t.score ?? 0) * 100)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 创作建议 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles size={15} className="text-primary-hover" />
          创作建议
        </div>
        {(overview?.suggestions ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
            当前进度顺畅，无待处理建议
          </div>
        ) : (
          <div className="space-y-1.5">
            {(overview?.suggestions ?? []).slice(0, 3).map((s, i) => (
              <Link
                key={i}
                to={s.to}
                className="group flex items-center justify-between gap-3 rounded-lg bg-bg/60 px-3 py-2.5 text-[13px] text-ink hover:bg-primary-soft/20"
              >
                <span className="min-w-0">{s.title}</span>
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-primary-hover">
                  立即创作
                  <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        )}
        {formulas.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-2 text-[12px] font-medium text-ink-dim">可复用公式（复盘沉淀）</div>
            <div className="grid gap-2 md:grid-cols-2">
              {formulas.slice(0, 2).map((f) => (
                <div key={f.id} className="rounded-lg bg-bg/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{f.title}</span>
                    <span className="ml-auto rounded bg-primary-soft px-1.5 py-0.5 text-[10px] text-primary-hover">
                      {f.dimension}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-ink-dim">{f.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
