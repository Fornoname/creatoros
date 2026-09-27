import {
  BarChart3,
  Bell,
  BookOpen,
  CheckCheck,
  CalendarClock,
  Compass,
  FolderKanban,
  Home,
  Image,
  PieChart,
  Radar,
  Send,
  Settings as SettingsIcon,
  TrendingUp,
  X,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import AssistantPanel from '../AssistantPanel'
import {
  accountApi,
  alertsApi,
  getCurrentAccount,
  setCurrentAccount,
  type AccountInfo,
  type AlertItem,
} from '../../api/client'

const NAV_ITEMS = [
  { to: '/', label: '首页', icon: Home },
  { to: '/position', label: '定位', icon: Compass },
  { to: '/radar', label: '内容雷达', icon: Radar },
  { to: '/topics', label: '选题', icon: BarChart3 },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/knowledge', label: '知识库', icon: BookOpen },
  { to: '/materials', label: '素材中心', icon: Image },
  { to: '/publish', label: '发布中心', icon: Send },
  { to: '/analytics', label: '运营分析', icon: PieChart },
  { to: '/review', label: '复盘', icon: TrendingUp },
  { to: '/automation', label: '自动化', icon: CalendarClock },
  { to: '/settings', label: '设置', icon: SettingsIcon },
]

const PAGE_TITLES: Record<string, string> = {
  '/': '首页',
  '/position': '定位中心',
  '/radar': '内容雷达',
  '/topics': '选题中心',
  '/projects': '项目',
  '/knowledge': '知识库',
  '/materials': '素材中心',
  '/publish': '发布中心',
  '/analytics': '运营分析',
  '/review': '复盘中心',
  '/automation': '自动化',
  '/settings': '设置',
}

function titleFor(pathname: string): string {
  if (pathname.startsWith('/projects/')) return '项目编辑器'
  return PAGE_TITLES[pathname] ?? 'CreatorOS'
}

export default function AppLayout() {
  const location = useLocation()
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [currentId, setCurrentId] = useState<number | null>(getCurrentAccount())
  const [accountLoading, setAccountLoading] = useState(true)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [unread, setUnread] = useState(0)
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  const loadAlerts = () => {
    alertsApi
      .list({ limit: 15 })
      .then((d) => {
        setAlerts(d.alerts)
        setUnread(d.unread)
      })
      .catch(() => {})
  }

  useEffect(() => {
    loadAlerts()
    const timer = setInterval(loadAlerts, 45_000)
    const onDocClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [])

  const markRead = (id: number) => {
    alertsApi.markRead(id).then(() => loadAlerts())
  }

  useEffect(() => {
    let alive = true
    accountApi
      .list()
      .then((d) => {
        if (!alive) return
        setAccounts(d.accounts)
        setCurrentId(getCurrentAccount() ?? d.current)
        if (getCurrentAccount() == null && d.current != null) setCurrentAccount(d.current)
      })
      .catch(() => {})
      .finally(() => alive && setAccountLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const switchAccount = (id: number) => {
    if (id === getCurrentAccount()) return
    setCurrentAccount(id)
    window.location.reload()
  }

  return (
    <div className="flex h-full bg-bg text-ink">
      {/* 左侧导航 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            C
          </div>
          <div className="text-[15px] font-semibold">CreatorOS</div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary-soft text-primary-hover'
                    : 'text-ink-dim hover:bg-card hover:text-ink'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line px-5 py-3 text-xs text-ink-faint">
          编导智能体系统 v0.1
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
          <div className="text-[15px] font-medium">{titleFor(location.pathname)}</div>
          <div className="flex items-center gap-3">
            {!accountLoading && accounts.length > 0 && (
              <select
                value={currentId ?? ''}
                onChange={(e) => switchAccount(Number(e.target.value))}
                className="h-8 max-w-[180px] rounded-lg border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-primary"
                title="切换账号：各页面数据按账号各归各位"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name || a.username || `账号${a.id}`}
                    {a.is_default ? '（默认）' : ''}
                  </option>
                ))}
              </select>
            )}
            <Link
              to="/projects?new=1"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:opacity-90"
              title="新建项目"
            >
              + 新建项目
            </Link>
            <div ref={bellRef} className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((v) => !v)}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:border-primary-soft hover:text-ink"
                title="系统告警"
              >
                <Bell size={15} />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-10 z-50 w-[360px] overflow-hidden rounded-xl border border-line bg-card shadow-xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                    <div className="text-[13px] font-medium">系统告警</div>
                    <div className="flex items-center gap-2">
                      {unread > 0 && (
                        <button
                          onClick={() => {
                            alerts.forEach((a) => {
                              if (!a.read) markRead(a.id)
                            })
                          }}
                          className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink"
                        >
                          <CheckCheck size={12} />
                          全部已读
                        </button>
                      )}
                      <button onClick={() => setBellOpen(false)} className="text-ink-faint hover:text-ink">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto">
                    {alerts.length === 0 && (
                      <div className="px-4 py-8 text-center text-[12px] text-ink-faint">
                        暂无告警，一切正常
                      </div>
                    )}
                    {alerts.map((a) => (
                      <div
                        key={a.id}
                        className={`border-b border-line/60 px-4 py-2.5 ${a.read ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  a.level === 'error' ? 'bg-red-500' : a.level === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                              />
                              <span className="truncate text-[12px] font-medium text-ink">{a.title}</span>
                            </div>
                            {a.detail && <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-dim">{a.detail}</div>}
                            <div className="mt-1 text-[10px] text-ink-faint">
                              {a.created_at ? new Date(a.created_at).toLocaleString('zh-CN') : ''}
                            </div>
                          </div>
                          {!a.read && (
                            <button
                              onClick={() => markRead(a.id)}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-primary-hover hover:bg-primary-soft/40"
                            >
                              已读
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAssistantOpen((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                assistantOpen
                  ? 'bg-primary text-white'
                  : 'border border-line text-ink-dim hover:text-ink'
              }`}
            >
              编导对话
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary-hover">
              Y
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* 全局编导对话 */}
      <AssistantPanel open={assistantOpen} />
    </div>
  )
}
