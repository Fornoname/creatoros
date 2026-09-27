import { AlertTriangle, BarChart3, Eye, Heart, Layers, RefreshCw, Save, Users } from 'lucide-react'
import { useState } from 'react'
import { accountApi, analyticsApi, reviewApi, type AnalyticsAccountBrief, type AnalyticsWork } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const AUDIENCE_FIELDS: { key: string; label: string; color: string }[] = [
  { key: 'recommend', label: '推荐页', color: '#7c3aed' },
  { key: 'friends', label: '朋友页', color: '#a78bfa' },
  { key: 'follow', label: '关注页', color: '#8b5cf6' },
  { key: 'homepage', label: '个人主页', color: '#c4b5fd' },
  { key: 'search', label: '搜索', color: '#e879f9' },
  { key: 'other', label: '其他', color: '#94a3b8' },
]

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export default function Analytics() {
  // null=全部账号（豁免全局注入，显示多账号聚合）｜数字=单账号维度
  const [accountId, setAccountId] = useState<'all' | number>('all')
  const { data, loading, run } = useAsync(
    () => analyticsApi.overview(typeof accountId === 'number' ? accountId : undefined, accountId === 'all'),
    [accountId],
  )
  const { data: accountsData } = useAsync(() => accountApi.list(), [])
  const { data: compData } = useAsync(() => analyticsApi.accountsOverview(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})

  const works = data?.works ?? []
  const totals = data?.totals ?? { views: 0, likes: 0, works: 0 }

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 4000)
  }

  function startEdit(w: AnalyticsWork) {
    const a = w.audience
    setForm({
      recommend: a ? String(a.recommend) : '',
      friends: a ? String(a.friends) : '',
      follow: a ? String(a.follow) : '',
      homepage: a ? String(a.homepage) : '',
      search: a ? String(a.search) : '',
      other: a ? String(a.other) : '',
    })
    setEditing(w.item_id)
  }

  async function saveAudience(itemId: string) {
    const values: Record<string, number> = {}
    for (const f of AUDIENCE_FIELDS) values[f.key] = Number(form[f.key] || 0)
    setBusy(`save-${itemId}`)
    try {
      await analyticsApi.saveAudience(itemId, values)
      await run()
      setEditing(null)
      flash('观众来源已保存')
    } catch (e) {
      flash(`保存失败：${(e as Error).message.slice(0, 100)}`)
    } finally {
      setBusy(null)
    }
  }

  async function refresh(itemId: string) {
    setBusy(`ref-${itemId}`)
    try {
      const d = await analyticsApi.refresh(itemId)
      await run()
      flash(`补采完成：播放 ${d.views} · 点赞 ${d.likes} · 完播率 ${pct(d.deep?.completion_rate ?? 0)}`)
    } catch (e) {
      flash(`补采失败：${(e as Error).message.slice(0, 120)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">运营分析</h1>
          <p className="mt-1 text-[13px] text-ink-dim">作品深层指标（创作者中心） + 观众来源分布 + 采集元数据</p>
        </div>
        {notice && (
          <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">{notice}</div>
        )}
      </div>

      {/* 账号筛选 + 多账号对比 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Layers size={15} className="text-primary-hover" />
            账号维度
          </div>
          <select
            value={typeof accountId === 'number' ? String(accountId) : 'all'}
            onChange={(e) => setAccountId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="ml-auto rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] text-ink outline-none"
          >
            <option value="all">全部账号（聚合对比）</option>
            {(accountsData?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name || a.username || `账号 #${a.id}`}
              </option>
            ))}
          </select>
        </div>
        {(compData?.accounts ?? []).length > 1 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(compData?.accounts ?? []).map((a) => (
              <AccountCompare key={a.account_id} a={a} active={typeof accountId === 'number' && accountId === a.account_id} onPick={() => setAccountId(a.account_id)} />
            ))}
          </div>
        )}
      </div>

      {/* 异常识别（联动复盘） */}
      <div className={`rounded-xl border p-4 ${(data?.anomalies ?? []).length > 0 ? 'border-warning/40 bg-warning/5' : 'border-line bg-card'}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
          <AlertTriangle size={15} className="text-warning" />
          异常识别
          <button
            type="button"
            disabled={busy === 'formulas'}
            onClick={async () => {
              setBusy('formulas')
              try {
                const r = await reviewApi.generateFormulas()
                flash(`已生成 ${r.formulas.length} 条公式候选，可在「复盘」页查看采纳`)
              } catch (e) {
                flash(`生成失败：${(e as Error).message.slice(0, 100)}`)
              } finally {
                setBusy(null)
              }
            }}
            className="ml-auto rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            {busy === 'formulas' ? '生成中…' : '生成公式候选（联动复盘）'}
          </button>
        </div>
        {(data?.anomalies ?? []).length === 0 && (
          <div className="text-[12px] text-ink-faint">暂无异常作品（播放≥500 为高播放候选；播放≥200 且互动率&lt;2% 为低互动候选）。</div>
        )}
        {(data?.anomalies ?? []).length > 0 && (
          <div className="space-y-1.5">
            {(data?.anomalies ?? []).map((an) => (
              <div key={an.item_id} className="flex items-center gap-2 rounded-lg bg-bg/60 px-3 py-2 text-[12px]">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${an.type === 'high_views' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                  {an.type === 'high_views' ? '高播放' : '低互动'}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{an.title}</span>
                <span className="shrink-0 text-ink-faint">▶ {fmt(an.views)} · 👍 {fmt(an.likes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 汇总与采集元数据 */}
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: '累计播放', value: fmt(totals.views), icon: Eye },
          { label: '累计点赞', value: fmt(totals.likes), icon: Heart },
          { label: '作品数', value: totals.works, icon: BarChart3 },
          { label: '数据源', value: data?.meta.source ?? '-', icon: RefreshCw },
        ].map((it) => (
          <div key={it.label} className="rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-2 text-[12px] text-ink-dim">
              <it.icon size={14} className="text-primary-hover" />
              {it.label}
            </div>
            <div className="mt-2 text-2xl font-semibold">{it.value}</div>
          </div>
        ))}
      </div>

      {/* 作品列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[13px] text-ink-dim">
            平台：{data?.meta.platform ?? '-'} · 统计窗口：{data?.meta.window ?? '-'} · 采集时间：作品最近一次补采
          </div>
        </div>
        {loading && <div className="py-8 text-center text-[13px] text-ink-dim">加载中…</div>}
        {!loading && works.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-surface/60 py-14 text-center text-[13px] text-ink-faint">
            暂无已发布作品，先在发布中心导入账号作品
          </div>
        )}
        {works.map((w) => {
          const m = w.metrics
          const deep = m?.deep ?? {}
          const a = w.audience
          return (
            <div key={w.item_id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md border border-line bg-bg">
                  {w.cover_url ? (
                    <img src={w.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-faint">—</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{w.title || '（无标题）'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-dim">
                    <span>▶ {fmt(m?.views ?? 0)}</span>
                    <span>👍 {fmt(m?.likes ?? 0)}</span>
                    <span>💬 {fmt(m?.comments ?? 0)}</span>
                    <span>↗ {fmt(m?.shares ?? 0)}</span>
                    {deep.completion_rate != null && (
                      <>
                        <span className="text-success">完播率 {pct(deep.completion_rate)}</span>
                        <span>均看 {Number(deep.avg_view_second ?? 0).toFixed(1)}s</span>
                        <span>2s跳出 {pct(deep.bounce_rate_2s ?? 0)}</span>
                        <span>粉丝观看 {pct(deep.fan_view_proportion ?? 0)}</span>
                      </>
                    )}
                    <span className="text-[11px] text-ink-faint">
                      {w.created_at ? new Date(w.created_at).toLocaleDateString('zh-CN') : ''}
                    </span>
                  </div>
                  {m == null && <div className="mt-1 text-[11px] text-ink-faint">尚未采集指标，可点击补采</div>}
                </div>
                <button
                  disabled={busy === `ref-${w.item_id}`}
                  onClick={() => refresh(w.item_id)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
                >
                  {busy === `ref-${w.item_id}` ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  补采
                </button>
              </div>

              {/* 观众来源 */}
              <div className="mt-3 border-t border-line pt-3">
                {a ? (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[12px]">
                      <span className="font-medium text-ink-dim">观众来源分布</span>
                      <span className="text-[11px] text-ink-faint">
                        {a.source === 'manual' ? '手动录入' : '采集'} ·{' '}
                        {a.collected_at ? new Date(a.collected_at).toLocaleString('zh-CN') : '-'}
                      </span>
                    </div>
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg">
                      {AUDIENCE_FIELDS.map((f) => (
                        <div
                          key={f.key}
                          style={{ width: `${a[f.key as keyof typeof a] as number}%`, background: f.color }}
                          title={`${f.label} ${a[f.key as keyof typeof a]}%`}
                        />
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      {AUDIENCE_FIELDS.map((f) => (
                        <span key={f.key} className="flex items-center gap-1.5 text-ink-dim">
                          <span className="h-2 w-2 rounded-sm" style={{ background: f.color }} />
                          {f.label} {a[f.key as keyof typeof a]}%
                        </span>
                      ))}
                    </div>
                  </div>
                ) : editing === w.item_id ? (
                  <div>
                    <div className="mb-2 text-[12px] font-medium text-ink-dim">手动填写观众来源（%，和≈100）</div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {AUDIENCE_FIELDS.map((f) => (
                        <label key={f.key} className="block">
                          <span className="text-[11px] text-ink-faint">{f.label}</span>
                          <input
                            value={form[f.key] ?? ''}
                            onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                            className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                            placeholder="%"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={busy === `save-${w.item_id}`}
                        onClick={() => saveAudience(w.item_id)}
                        className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] text-white hover:opacity-90 disabled:opacity-50"
                      >
                        <Save size={13} />
                        保存
                      </button>
                      <button onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim hover:text-ink">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] text-ink-faint">
                      观众来源未采集——该数据仅存于抖音创作者后台，opencli 未开放此接口；可手动录入（参考后台「作品分析 → 观众来源」）。
                    </div>
                    <button onClick={() => startEdit(w)} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink">
                      手动填写
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AccountCompare({ a, active, onPick }: { a: AnalyticsAccountBrief; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded-xl border p-3 text-left ${active ? 'border-primary bg-primary-soft/20' : 'border-line bg-bg/40 hover:bg-bg/70'}`}
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Users size={14} className="text-primary-hover" />
        <span className="truncate">{a.name || '未命名账号'}</span>
      </div>
      <div className="mt-2 flex gap-4 text-[12px] text-ink-dim">
        <span>作品 {a.works}</span>
        <span>播放 {fmt(a.views)}</span>
        <span>点赞 {fmt(a.likes)}</span>
      </div>
    </button>
  )
}
