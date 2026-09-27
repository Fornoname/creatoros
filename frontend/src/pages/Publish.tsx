import { BarChart3, RefreshCw, Send, Video } from 'lucide-react'
import { useState } from 'react'
import { accountApi, projectsApi, publishApi, type PlatformStatus, type PublicationRecord } from '../api/client'
import { useAsync } from '../hooks/useAsync'

interface Overview {
  accounts: Record<string, { ok: boolean; stats?: Record<string, string>; error?: string }>
  local: Record<string, { videos: number; views: number; likes: number }>
}

export default function Publish() {
  const { data, loading, run } = useAsync(() => publishApi.platforms(), [])
  const { data: recordsData, run: refreshRecords } = useAsync(() => publishApi.records(), [])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<null | 'platforms' | 'publish' | 'stats' | 'sync'>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  // 发布表单
  const [platform, setPlatform] = useState('douyin')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [videoPath, setVideoPath] = useState('')
  const [mode, setMode] = useState<'draft' | 'publish'>('draft')
  const [accountId, setAccountId] = useState<number | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [projectId, setProjectId] = useState<number | null>(null)
  const { data: accountsData } = useAsync(() => accountApi.list(), [])
  const { data: projectsData } = useAsync(() => projectsApi.list(), [])

  const platforms = data?.platforms ?? []
  const records = recordsData?.records ?? []
  const boundAccounts = (accountsData?.accounts ?? []).filter((a) => a.stats.profile_status === 'bound')

  async function refreshPlatforms() {
    setBusy('platforms')
    setNotice('正在探测平台登录状态（opencli 冷启动约 1 分钟）…')
    try {
      await run()
      setNotice('平台状态已更新')
    } catch (e) {
      setNotice(`探测失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function submit() {
    if (!title.trim()) {
      setNotice('请填写标题')
      return
    }
    setBusy('publish')
    setNotice(mode === 'draft' ? '正在创建平台草稿…' : '正在发布…')
    try {
      const r = await publishApi.submit({
        platform,
        title: title.trim(),
        description: description.trim(),
        video_path: videoPath.trim(),
        mode,
        account_id: accountId ?? undefined,
        project_id: projectId ?? undefined,
        schedule_at: scheduleAt,
      })
      setNotice(`已完成：${r.publication.status}（${r.raw ? 'opencli 已执行' : '已记录'}'）`)
      await refreshRecords()
    } catch (e) {
      setNotice(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function pullStats() {
    setBusy('stats')
    setNotice('正在拉取账号数据（opencli 冷启动约 1 分钟）…')
    try {
      const r = await publishApi.stats(platform)
      setNotice(`账号数据已更新：${JSON.stringify(r.stats).slice(0, 200)}`)
    } catch (e) {
      setNotice(`拉取失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function pullOverview() {
    setBusy('stats')
    setNotice('正在拉取跨平台数据（并发探测，约 1 分钟）…')
    try {
      const r = await publishApi.overview()
      setOverview(r)
      setNotice('跨平台数据已更新')
    } catch (e) {
      setNotice(`拉取失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">发布中心</h1>
        <p className="mt-1 text-[13px] text-ink-dim">多平台发布与数据拉取（opencli 适配器：抖音已登录）</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">
          {notice}
        </div>
      )}

      {/* 跨平台数据对比 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 size={15} className="text-primary-hover" />
            跨平台数据对比
          </div>
          <button
            type="button"
            onClick={pullOverview}
            disabled={busy === 'stats'}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={12} className={busy === 'stats' ? 'animate-spin' : ''} />
            拉取对比
          </button>
        </div>
        {!overview ? (
          <div className="rounded-lg border border-dashed border-line py-5 text-center text-[13px] text-ink-faint">
            点击「拉取对比」并发探测各平台账号资料，并聚合本地作品指标
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {Object.entries(overview.accounts).map(([pl, a]) => {
              const local = overview.local[pl]
              const fans = a.ok ? (a.stats?.['follower_count'] || a.stats?.['fans'] || a.stats?.['followerCount'] || a.stats?.username || a.stats?.nickname || '—') : '未登录/超时'
              const works = a.ok ? (a.stats?.['video_count'] || a.stats?.['works_count'] || a.stats?.['aweme_count'] || (local?.videos ?? '—')) : '—'
              return (
                <div key={pl} className="rounded-lg bg-bg/60 p-3">
                  <div className="flex items-center justify-between text-[13px] font-medium text-ink">
                    <span className="capitalize">{pl}</span>
                    <span className={`text-[11px] ${a.ok ? 'text-success' : 'text-ink-faint'}`}>{a.ok ? '已连接' : '不可用'}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                    <div>
                      <div className="text-[11px] text-ink-faint">粉丝</div>
                      <div className="mt-0.5 text-[15px] font-semibold text-ink">{fans}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-ink-faint">作品</div>
                      <div className="mt-0.5 text-[15px] font-semibold text-ink">{works}</div>
                    </div>
                  </div>
                  {local && (
                    <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-ink-faint">
                      本地记录：{local.videos} 条 · 播放 {Math.round(local.views).toLocaleString()} · 点赞 {Math.round(local.likes).toLocaleString()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 平台状态 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">平台账号</div>
          <button
            type="button"
            onClick={refreshPlatforms}
            disabled={busy === 'platforms'}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy === 'platforms' ? 'animate-spin' : ''} />
            刷新状态
          </button>
        </div>
        {loading ? (
          <div className="py-6 text-center text-[13px] text-ink-faint">探测中…</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {platforms.map((p) => (
              <PlatformCard key={p.platform} p={p} />
            ))}
          </div>
        )}
      </div>

      {/* 发布表单 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Send size={15} className="text-primary-hover" />
          发布 / 草稿
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none"
          >
            {platforms.map((p) => (
              <option key={p.platform} value={p.platform}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none"
          >
            <option value="">当前登录账号（默认）</option>
            {boundAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name || a.username}（独立环境·已绑定）
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none"
          >
            <option value="">不关联项目</option>
            {(projectsData?.projects ?? []).map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.title}（#{pr.id}）
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="作品标题"
            className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            placeholder="定时发布时间（可选，2h~14 天内）"
            className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="作品描述（话题/标签）"
          className="mt-2 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
            <Video size={14} className="shrink-0 text-ink-faint" />
            <input
              value={videoPath}
              onChange={(e) => setVideoPath(e.target.value)}
              placeholder="视频文件绝对路径（如 /Users/you/Desktop/video.mp4）"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <button
            type="button"
            onClick={() => setMode(mode === 'draft' ? 'publish' : 'draft')}
            className={`rounded-lg border px-3 py-2 text-[13px] ${mode === 'publish' ? 'border-success/40 bg-success/15 text-success' : 'border-line text-ink-dim'}`}
          >
            {mode === 'publish' ? '立即发布' : '存为草稿'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy !== null}
            className="rounded-lg bg-primary px-4 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {busy === 'publish' ? '执行中…' : mode === 'publish' ? '发布' : '创建草稿'}
          </button>
        </div>
        {mode === 'publish' && (
          <div className="mt-2 text-[12px] text-warning">
            {scheduleAt ? '将使用平台原生「定时发布」排期（2h~14 天内），非立即发送。' : '立即发布将真实发送到平台，请确认标题与视频文件无误'}
          </div>
        )}
      </div>

      {/* 数据拉取 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">账号数据</div>
          <button
            type="button"
            onClick={pullStats}
            disabled={busy === 'stats'}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy === 'stats' ? 'animate-spin' : ''} />
            拉取数据
          </button>
        </div>
        <div className="py-4 text-center text-[13px] text-ink-faint">
          拉取平台账号整体数据（粉丝 / 获赞 / 作品数），并沉淀为指标快照
        </div>
      </div>

      {/* 发布记录 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">发布记录</div>
          <button
            type="button"
            onClick={async () => {
              setBusy('sync')
              try {
                const r = await publishApi.syncRecords()
                setNotice(`状态回流完成：检查 ${r.checked} 条平台作品，对账 ${r.matched} 条记录，更新 ${r.updated} 条`)
                await refreshRecords()
              } catch (e) {
                setNotice(`回流失败：${e instanceof Error ? e.message : e}`)
              } finally {
                setBusy(null)
              }
            }}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy === 'sync' ? 'animate-spin' : ''} />
            同步平台状态
          </button>
        </div>
        {records.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-ink-faint">暂无发布记录</div>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <RecordRow key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PlatformCard({ p }: { p: PlatformStatus }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-bg/60 p-3">
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${p.logged_in ? 'bg-success' : 'bg-ink-faint'}`}
      />
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{p.label}</div>
        <div className="truncate text-[12px] text-ink-dim">
          {p.logged_in ? `已登录：${p.username || '—'}` : '未登录'}
        </div>
      </div>
    </div>
  )
}

function RecordRow({ r }: { r: PublicationRecord }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-bg/60 px-3 py-2 text-[13px]">
      <span className="w-20 truncate text-ink-dim">{r.account || r.platform}</span>
      <span className="w-14 text-ink-faint">{r.platform}</span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
          r.status === 'published'
            ? 'bg-success/15 text-success'
            : r.status === 'failed'
              ? 'bg-danger/15 text-danger'
              : 'bg-ink-faint/20 text-ink-dim'
        }`}
      >
        {r.status}
      </span>
      <span className="min-w-0 flex-[2] truncate text-ink">{r.title || '（无标题）'}</span>
      {r.project_id ? (
        <span className="shrink-0 rounded bg-primary-soft/25 px-1.5 py-0.5 text-[11px] text-primary-hover">项目 #{r.project_id}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-ink-faint">
        {r.url || r.error || `#${r.id}`}
      </span>
      <span className="shrink-0 text-[12px] text-ink-faint">{r.created_at?.slice(0, 16) ?? ''}</span>
    </div>
  )
}
