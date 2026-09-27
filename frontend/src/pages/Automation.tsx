import { CalendarClock, Check, Loader2, Play, Plus, Pencil, Trash2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { automationApi, type AutomationRule } from '../api/client'
import PageShell from '../components/PageShell'
import { useAsync } from '../hooks/useAsync'

function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  return iso.slice(5, 16).replace('T', ' ')
}

export default function Automation() {
  const { data, loading, run } = useAsync(() => automationApi.rules(), [])
  const [busy, setBusy] = useState<null | number>(null)
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    task_type: 'works_sync' as string,
    cron: '',
    schedule_text: '',
  })
  const [editing, setEditing] = useState<AutomationRule | null>(null)
  const [events, setEvents] = useState<{ id: number; action: string; detail: string; created_at: string }[]>([])
  const [runResult, setRunResult] = useState('')

  const taskTypes = data?.task_types ?? []
  const rules = data?.rules ?? []

  const refresh = useCallback(async () => {
    await run()
    const ev = await automationApi.events()
    setEvents(ev.events)
  }, [run])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function toggle(r: AutomationRule) {
    setBusy(r.id)
    try {
      await automationApi.update(r.id, { enabled: !r.enabled })
      setNotice('')
      await refresh()
    } catch (e) {
      setNotice(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function remove(r: AutomationRule) {
    setBusy(r.id)
    try {
      await automationApi.remove(r.id)
      await refresh()
    } catch (e) {
      setNotice(`删除失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function manualRun(r: AutomationRule) {
    setBusy(r.id)
    setRunResult('')
    try {
      const res = await automationApi.run(r.id)
      setRunResult(res.result)
      await refresh()
    } catch (e) {
      setNotice(`执行失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  function pickTaskType(t: string) {
    const cfg = taskTypes.find((x) => x.type === t)
    if (!cfg) return
    setForm({
      name: cfg.name,
      task_type: t,
      cron: cfg.cron,
      schedule_text: cfg.schedule_text,
    })
  }

  async function create() {
    if (!form.name.trim()) {
      setNotice('请填写任务名称')
      return
    }
    const cfg = taskTypes.find((x) => x.type === form.task_type)
    try {
      await automationApi.create({
        name: form.name.trim(),
        rule_type: 'schedule',
        task_type: form.task_type,
        cron: form.cron,
        schedule_text: form.schedule_text,
        action: cfg ? actionOf(form.task_type) : 'pull_metrics',
        sub_label: cfg?.sub_label ?? '',
        backfill_text: cfg?.backfill_text ?? '',
        enabled: true,
      })
      setShowForm(false)
      setForm({ name: '', task_type: 'works_sync', cron: '', schedule_text: '' })
      await refresh()
    } catch (e) {
      setNotice(`创建失败：${e instanceof Error ? e.message : e}`)
    }
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(editing.id)
    try {
      await automationApi.update(editing.id, {
        name: editing.name,
        cron: editing.cron,
        schedule_text: editing.schedule_text,
      })
      setEditing(null)
      setNotice('')
      await refresh()
    } catch (e) {
      setNotice(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageShell title="自动化" description="定时任务与触发规则：作品/流量/评论同步、雷达同步、每日选题、内容补全，支持编辑与立即运行。">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-faint">
          {rules.filter((r) => r.enabled).length} 条任务运行中 · 调度每 1 分钟检查（cron 引擎）
        </p>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover"
        >
          <Plus size={14} />
          新建任务
        </button>
      </div>

      {showForm && (
        <div className="mt-3 rounded-xl border border-primary-soft/50 bg-card p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <select
              value={form.task_type}
              onChange={(e) => pickTaskType(e.target.value)}
              className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none"
            >
              {taskTypes.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.name}（{t.sub_label}）
                </option>
              ))}
            </select>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="任务名称"
              className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-primary-soft"
            />
            <input
              value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
              placeholder="cron 表达式，如 15 */2 * * *"
              className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-primary-soft"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={form.schedule_text}
              onChange={(e) => setForm({ ...form, schedule_text: e.target.value })}
              placeholder="执行计划描述，如：每2小时·15分·北京时间"
              className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none"
            />
            <button type="button" onClick={create} className="rounded-lg bg-primary px-4 py-2 text-[13px] text-white hover:bg-primary-hover">
              创建
            </button>
          </div>
        </div>
      )}

      {runResult && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-ink">
          <Check size={14} className="mt-0.5 shrink-0 text-success" />
          {runResult}
        </div>
      )}
      {notice && <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{notice}</div>}

      {/* 任务表格（对标 CreatorOS 自动化任务列表） */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-faint">
              <th className="px-3 py-2.5 font-medium">任务</th>
              <th className="px-3 py-2.5 font-medium">执行计划</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">上次 / 下次</th>
              <th className="px-3 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rules.length && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[13px] text-ink-faint">加载中…</td>
              </tr>
            )}
            {!loading && rules.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[13px] text-ink-faint">暂无任务，点击右上角新建</td>
              </tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-bg/40">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 shrink-0 rounded-full ${r.enabled ? 'bg-success' : 'bg-ink-faint/40'}`} />
                    <span className="font-medium text-ink">{r.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                    {r.sub_label && <span className="rounded bg-primary-soft/25 px-1.5 py-0.5 text-primary-hover">{r.sub_label}</span>}
                    {r.rule_type === 'trigger' && <span className="rounded bg-primary-soft/30 px-1.5 py-0.5 text-primary-hover">触发</span>}
                    {r.action_desc && (
                      <span className="flex items-center gap-0.5">
                        <Zap size={10} />
                        {r.action_desc}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="text-ink">{r.schedule_text || (r.cron ? r.cron : `每 ${r.interval_minutes} 分钟`)}</div>
                  {r.backfill_text && <div className="mt-1 text-[11px] text-ink-faint">{r.backfill_text}</div>}
                  {r.error && <div className="mt-1 text-[11px] text-danger">错误：{r.error}</div>}
                </td>
                <td className="px-3 py-3">
                  {r.enabled ? (
                    <span className="rounded bg-success/15 px-2 py-0.5 text-[11px] text-success">已启用</span>
                  ) : (
                    <span className="rounded bg-ink-faint/15 px-2 py-0.5 text-[11px] text-ink-dim">
                      未启用{r.disabled_reason ? `：${r.disabled_reason}` : ''}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-[12px] text-ink-faint">
                  <div>上次：{fmtTime(r.last_run)}</div>
                  <div>下次：{r.enabled ? fmtTime(r.next_run) : '等待启用'}</div>
                  <div className="text-[11px]">{r.run_count} 次执行</div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      title="编辑"
                      className="rounded-lg border border-line px-2 py-1.5 text-[12px] text-ink-dim hover:text-ink"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => manualRun(r)}
                      disabled={busy === r.id}
                      title="立即运行"
                      className="rounded-lg border border-line px-2 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
                    >
                      {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(r)}
                      className={`rounded-lg px-2 py-1.5 text-[12px] ${r.enabled ? 'border border-line text-ink-dim hover:text-ink' : 'bg-primary text-white hover:bg-primary-hover'}`}
                    >
                      {r.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      title="删除"
                      className="rounded-lg border border-line px-2 py-1.5 text-[12px] text-ink-faint hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <CalendarClock size={15} className="text-primary-hover" />
                编辑任务
              </div>
              <button type="button" onClick={() => setEditing(null)} className="text-ink-faint hover:text-ink">✕</button>
            </div>
            <label className="mb-1 block text-[12px] text-ink-faint">任务名称</label>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
            <label className="mb-1 block text-[12px] text-ink-faint">cron 表达式</label>
            <input
              value={editing.cron}
              onChange={(e) => setEditing({ ...editing, cron: e.target.value })}
              placeholder="如 15 */2 * * *"
              className="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
            <label className="mb-1 block text-[12px] text-ink-faint">执行计划描述</label>
            <input
              value={editing.schedule_text}
              onChange={(e) => setEditing({ ...editing, schedule_text: e.target.value })}
              className="mb-4 w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-2 text-[13px] text-ink-dim hover:text-ink">
                取消
              </button>
              <button type="button" onClick={saveEdit} disabled={busy === editing.id} className="rounded-lg bg-primary px-4 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 执行事件 */}
      <div className="mt-6">
        <div className="mb-2 text-[13px] font-medium text-ink">执行事件</div>
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-card py-8 text-center text-[13px] text-ink-faint">
            暂无自动化事件记录
          </div>
        ) : (
          <div className="space-y-1.5">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[12px] text-ink-dim">
                <span className="shrink-0 rounded bg-primary-soft/30 px-1.5 py-0.5 text-[11px] text-primary-hover">{e.action}</span>
                <span className="flex-1">{e.detail}</span>
                <span className="shrink-0 text-ink-faint">{e.created_at.slice(5, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}

function actionOf(taskType: string): string {
  const map: Record<string, string> = {
    works_sync: 'pull_metrics',
    flow_sync: 'pull_flow',
    comments_sync: 'pull_comments',
    radar_sync: 'sync_radar_sources',
    daily_topics: 'generate_topics',
    content_backfill: 'backfill_covers',
  }
  return map[taskType] ?? 'pull_metrics'
}
