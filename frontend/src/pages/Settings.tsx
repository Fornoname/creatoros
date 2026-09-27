import { Database, FileCode2, KeyRound, Moon, Palette, Server, SlidersHorizontal, Sun, User, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import {
  accountApi,
  assetsApi,
  getCurrentAccount,
  setCurrentAccount,
  settingsApi,
  type AccountInfo,
} from '../api/client'

const SECTIONS = [
  { key: 'account', label: '账户', icon: User },
  { key: 'preferences', label: '偏好', icon: SlidersHorizontal },
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'model', label: '模型配置', icon: KeyRound },
  { key: 'data', label: '数据服务', icon: Server },
  { key: 'skills', label: '技能', icon: Wand2 },
  { key: 'storage', label: '存储', icon: Database },
] as const

const SKILLS = [
  '定位中心 · 账号定位与创作规则（版本化，可恢复）',
  '内容雷达 · 对标博主监控 / 视频逐字稿提取与 AI 改写',
  '选题中心 · AI 选题会（手动/基于定位/基于评论）+ 自动供给',
  '项目工作台 · 值得做三卡 / 素材备料 / 论点骨架 / 脚本生成',
  '素材中心 · 自动向量化 + 语义检索（Doubao Embedding Vision）',
  '发布中心 · 封面生成（Seedream）/ 发布预测 / 发布排期',
  '复盘中心 · AI 复盘 → 可采纳沉淀回流定位规则',
  '自动化 · 每日选题供给 / 对标内容定时刷新（每 2 小时）',
  '多账号 · 数据各归各位，按账号隔离定位/选题/项目/素材/复盘',
]

const STORE_QUOTA = 494.4 * 1024 * 1024 * 1024

function fmtSize(n: number): string {
  if (n <= 0) return '—'
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${n}B`
}

export default function Settings() {
  const [section, setSection] = useState<string>('account')
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [form, setForm] = useState({ platform: 'douyin', display_name: '', username: '', uid: '' })
  const [arkKey, setArkKey] = useState<{ configured: boolean; masked: string; model_pro: string } | null>(null)
  const [newKey, setNewKey] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const [worksOf, setWorksOf] = useState<AccountInfo | null>(null)
  const [works, setWorks] = useState<{ id: number; platform: string; item_id: string; title: string; cover_url: string; status: string; created_at: string | null }[]>([])
  const [profileBusy, setProfileBusy] = useState<number | null>(null)
  // 账号创作画像
  const [profileOf, setProfileOf] = useState<number | null>(null)
  const [profileDynamic, setProfileDynamic] = useState('')
  const [profileNotes, setProfileNotes] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  // 昵称编辑
  const [nick, setNick] = useState('')
  const [nickMsg, setNickMsg] = useState('')
  // 偏好 / 外观
  const [defaultPlatform, setDefaultPlatform] = useState(() => localStorage.getItem('creatoros_default_platform') ?? 'douyin')
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => (localStorage.getItem('creatoros_theme') as 'dark' | 'light' | 'system') ?? 'dark')
  // CLI 开关
  const [cliEnabled, setCliEnabled] = useState(() => localStorage.getItem('creatoros_cli_enabled') !== 'false')

  const { data: storeStats } = useStoreStats()

  const current = getCurrentAccount()
  const defaultAccount = accounts.find((a) => a.is_default) ?? accounts[0]

  const load = useCallback(async () => {
    try {
      const d = await accountApi.list()
      setAccounts(d.accounts)
      const def = d.accounts.find((a) => a.is_default) ?? d.accounts[0]
      if (def) setNick(def.display_name || def.username || '')
      try {
        setArkKey(await settingsApi.arkKey())
      } catch {
        /* 非关键 */
      }
    } catch (e) {
      setMsg(`加载账号失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 外观生效
  useEffect(() => {
    const t = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('creatoros_theme', theme)
  }, [theme])

  const saveNick = async () => {
    if (!defaultAccount) return
    if (!nick.trim()) {
      setNickMsg('昵称不能为空')
      return
    }
    setBusy(true)
    try {
      await accountApi.update(defaultAccount.id, { display_name: nick.trim() })
      setNickMsg('昵称已保存，立即生效')
      await load()
    } catch (e) {
      setNickMsg(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const addAccount = async () => {
    if (!form.display_name.trim() && !form.username.trim()) {
      setMsg('请填写账号名称或用户名')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const d = await accountApi.create({
        platform: form.platform,
        display_name: form.display_name.trim(),
        username: form.username.trim(),
        uid: form.uid.trim(),
      })
      setMsg(`账号「${d.account.display_name}」已添加`)
      setForm({ platform: 'douyin', display_name: '', username: '', uid: '' })
      await load()
    } catch (e) {
      setMsg(`添加失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const setDefault = async (id: number) => {
    setBusy(true)
    try {
      await accountApi.update(id, { is_default: true })
      setMsg('默认账号已切换')
      setCurrentAccount(id)
      await load()
    } catch (e) {
      setMsg(`操作失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const removeAccount = async (id: number) => {
    if (!window.confirm('确认删除该账号？其数据将一并移除（默认账号不可删）。')) return
    setBusy(true)
    try {
      await accountApi.remove(id)
      setMsg('账号已删除')
      await load()
    } catch (e) {
      setMsg(`删除失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const syncWorks = async (id: number) => {
    setSyncingId(id)
    setMsg('')
    try {
      const d = await accountApi.sync(id, 10)
      setMsg(`导入完成：拉取 ${d.pulled} 条作品，新增作品 ${d.new_publications}、指标 ${d.new_metrics}、知识 ${d.new_knowledge}`)
      await load()
    } catch (e) {
      setMsg(`导入失败：${(e as Error).message}`)
    } finally {
      setSyncingId(null)
    }
  }

  const bindProfile = async (id: number) => {
    setProfileBusy(id)
    setMsg('')
    try {
      await accountApi.bindProfile(id)
      setMsg('已启动绑定：将弹出独立浏览器窗口，请用该账号扫码登录；扫码后自动读取身份并搬入专属环境')
      await load()
      window.setTimeout(() => { load() }, 3000)
    } catch (e) {
      setMsg(`绑定启动失败：${(e as Error).message}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const collectProfile = async (id: number) => {
    setProfileBusy(id)
    setMsg('')
    try {
      await accountApi.collectProfile(id)
      setMsg('已启动采集：用该账号独立环境访问创作者中心，作品按 ID 对齐归入该账号')
      await load()
      window.setTimeout(() => { load() }, 4000)
    } catch (e) {
      setMsg(`采集启动失败：${(e as Error).message}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const loadProfile = async (id: number) => {
    setProfileBusy(id)
    setProfileMsg('')
    try {
      const d = await accountApi.profile(id)
      setProfileOf(id)
      setProfileDynamic(d.dynamic)
      setProfileNotes(d.notes)
    } catch (e) {
      setProfileMsg(`画像加载失败：${(e as Error).message}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const saveProfile = async (id: number) => {
    setProfileBusy(id)
    setProfileMsg('')
    try {
      await accountApi.saveProfile(id, profileNotes)
      setProfileMsg('画像偏好已保存：AI 出题/写稿时将作为最高优先级约束')
    } catch (e) {
      setProfileMsg(`保存失败：${(e as Error).message}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const showWorks = async (a: AccountInfo) => {
    setWorksOf(a)
    setWorks([])
    try {
      const d = await accountApi.works(a.id)
      setWorks(d.works)
    } catch (e) {
      setMsg(`加载作品失败：${(e as Error).message}`)
    }
  }

  const saveArkKey = async () => {
    if (!newKey.trim()) return
    setKeyMsg('')
    try {
      const d = await settingsApi.updateArkKey(newKey.trim())
      setArkKey({ configured: d.configured, masked: d.masked, model_pro: arkKey?.model_pro ?? '' })
      setNewKey('')
      setKeyMsg('已保存并写入 backend/.env（重启后同样生效）')
    } catch (e) {
      setKeyMsg(`保存失败：${e instanceof Error ? e.message : e}`)
    }
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Shanghai'
  const credentialExpiry = new Date(Date.now() + 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19)
  const used = storeStats?.total.size ?? 0
  const usedPct = Math.min(100, (used / STORE_QUOTA) * 100)

  return (
    <PageShell title="设置" description="账号、偏好与系统">
      <div className="flex gap-5">
        {/* 左栏分类导航 */}
        <div className="w-44 shrink-0 space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${section === s.key ? 'bg-primary-soft text-primary-hover' : 'text-ink-dim hover:bg-bg hover:text-ink'}`}
            >
              <s.icon size={15} />
              {s.label}
            </button>
          ))}
        </div>

        {/* 右栏内容 */}
        <div className="min-w-0 flex-1 space-y-4">
          {msg && <div className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary-hover">{msg}</div>}

          {/* ===== 账户 ===== */}
          {section === 'account' && (
            <>
              {/* 账户信息 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">账户信息</div>
                  <span className="rounded bg-success/15 px-2 py-0.5 text-[11px] text-success">已验证</span>
                </div>
                <div className="mt-1 text-[12px] text-ink-faint">账号基本信息与登录状态</div>
                {loading ? (
                  <div className="mt-3 text-[12px] text-ink-faint">加载中…</div>
                ) : !defaultAccount ? (
                  <div className="mt-3 text-[12px] text-ink-faint">暂无账号，请先在下方添加。</div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
                    <span className="font-medium text-ink">{defaultAccount.display_name || defaultAccount.username}</span>
                    <span className="text-ink-dim">计划：个人版</span>
                    <span className="text-ink-dim">时区：{timezone}</span>
                    <span className="text-ink-dim">语言：zh-CN</span>
                    <span className="text-ink-dim">平台：{defaultAccount.platform}</span>
                  </div>
                )}
              </div>

              {/* 昵称 */}
              {defaultAccount && (
                <div className="rounded-xl border border-line bg-card p-4">
                  <div className="text-sm font-medium">昵称</div>
                  <div className="mt-1 text-[12px] text-ink-faint">显示名称，保存后立即生效。</div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={nick}
                      onChange={(e) => { setNick(e.target.value); setNickMsg('') }}
                      className="h-9 w-64 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={saveNick}
                      disabled={busy}
                      className="h-9 rounded-lg bg-primary px-4 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                      保存
                    </button>
                  </div>
                  {nickMsg && <div className="mt-2 text-[12px] text-primary-hover">{nickMsg}</div>}
                </div>
              )}

              {/* 多账号管理 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">多账号管理</div>
                  <div className="text-xs text-ink-faint">切换顶栏账号后，定位/选题/项目/素材/知识/复盘均按账号展示</div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
                  >
                    <option value="douyin">抖音</option>
                    <option value="xhs">小红书</option>
                    <option value="bilibili">B站</option>
                    <option value="weibo">微博</option>
                  </select>
                  <input
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    placeholder="账号名称（如：亮Liang）"
                    className="h-9 w-44 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                  />
                  <input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="用户名"
                    className="h-9 w-40 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                  />
                  <input
                    value={form.uid}
                    onChange={(e) => setForm({ ...form, uid: e.target.value })}
                    placeholder="UID（可选）"
                    className="h-9 w-40 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={addAccount}
                    disabled={busy}
                    className="h-9 rounded-lg bg-primary px-4 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy ? '处理中…' : '添加账号'}
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  {loading && <div className="text-xs text-ink-faint">加载中…</div>}
                  {!loading && accounts.length === 0 && <div className="text-xs text-ink-faint">暂无账号，请先添加。</div>}
                  {accounts.map((a) => (
                    <div key={a.id} className="rounded-lg border border-line bg-surface p-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="text-sm font-medium">
                          {a.display_name || a.username}
                          {a.is_default && <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary-hover">默认</span>}
                          {a.id === current && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[11px] text-white">当前</span>}
                        </div>
                        <div className="text-xs text-ink-dim">平台：{a.platform}</div>
                        {a.uid && <div className="text-xs text-ink-dim">UID：{a.uid}</div>}
                        <div className="text-xs text-ink-dim">粉丝 {a.stats.follower_count}</div>
                        <div className="text-xs text-ink-dim">作品 {a.stats.works}</div>
                        <div className="text-xs text-ink-dim">选题 {a.stats.topics}</div>
                        <div className="text-xs text-ink-dim">项目 {a.stats.projects}</div>
                        <div className="text-xs text-ink-dim">累计播放 {a.stats.total_views}</div>
                        <div className="text-xs text-ink-dim">
                          上次同步：{a.stats.last_synced_at ? new Date(a.stats.last_synced_at).toLocaleString('zh-CN') : '从未'}
                        </div>
                        <div className="text-xs text-ink-dim">
                          浏览器环境：
                          {a.stats.profile_status === 'bound' ? (
                            <span className="text-success">已绑定</span>
                          ) : a.stats.profile_status === 'scanning' || a.stats.profile_status === 'pending' ? (
                            <span className="text-warning">扫码中…</span>
                          ) : a.stats.profile_status === 'failed' ? (
                            <span className="text-error">绑定失败</span>
                          ) : (
                            <span className="text-ink-faint">未绑定</span>
                          )}
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => bindProfile(a.id)}
                            disabled={profileBusy === a.id || busy}
                            className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs text-primary-hover hover:bg-primary-soft disabled:opacity-50"
                          >
                            {profileBusy === a.id ? '启动中…' : '绑定浏览器身份'}
                          </button>
                          {a.stats.profile_status === 'bound' && (
                            <button
                              type="button"
                              onClick={() => collectProfile(a.id)}
                              disabled={profileBusy === a.id || busy}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                            >
                              {profileBusy === a.id ? '启动中…' : '采集作品'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => syncWorks(a.id)}
                            disabled={syncingId === a.id || busy}
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                          >
                            {syncingId === a.id ? '导入中…' : '一键导入历史作品'}
                          </button>
                          <button type="button" onClick={() => showWorks(a)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-card">
                            查看作品
                          </button>
                          {!a.is_default && (
                            <button type="button" onClick={() => setDefault(a.id)} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-card disabled:opacity-50">
                              设为默认
                            </button>
                          )}
                          {!a.is_default && (
                            <button type="button" onClick={() => removeAccount(a.id)} disabled={busy} className="rounded-lg border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10 disabled:opacity-50">
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                      {worksOf?.id === a.id && works.length > 0 && (
                        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
                          {works.map((w) => (
                            <div key={w.item_id} className="flex gap-2 rounded-lg border border-line bg-card p-2">
                              {w.cover_url && <img src={w.cover_url} alt="" className="h-14 w-20 rounded object-cover" loading="lazy" />}
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-xs">{w.title || w.item_id}</div>
                                <div className="mt-1 text-[11px] text-ink-faint">{w.platform}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {worksOf?.id === a.id && works.length === 0 && (
                        <div className="mt-3 border-t border-line pt-3 text-xs text-ink-faint">暂无已导入作品，点「一键导入历史作品」同步。</div>
                      )}
                      <div className="mt-3 border-t border-line pt-3">
                        <button type="button" onClick={() => (profileOf === a.id ? setProfileOf(null) : loadProfile(a.id))} className="text-xs font-medium text-primary-hover hover:underline">
                          {profileOf === a.id ? '收起创作画像' : '创作画像（AI 出题自动参考）'}
                        </button>
                        {profileOf === a.id && (
                          <div className="mt-2 rounded-lg bg-bg/60 p-3">
                            {profileDynamic ? (
                              <div className="whitespace-pre-line text-[12px] leading-relaxed text-ink-dim">{profileDynamic}</div>
                            ) : (
                              <div className="text-[12px] text-ink-faint">该账号暂无创作数据，积累选题/项目后画像自动生成。</div>
                            )}
                            <div className="mt-3">
                              <div className="text-[12px] font-medium text-ink">我的偏好（最高优先级，出题时 AI 必须遵守）</div>
                              <textarea
                                value={profileNotes}
                                onChange={(e) => setProfileNotes(e.target.value)}
                                rows={3}
                                placeholder="例如：我是编导，主做 AI 工具实操向口播，语气直接、少废话，多用第一人称经验分享…"
                                className="mt-1.5 w-full rounded-lg border border-line bg-surface p-2 text-[12px] outline-none focus:border-primary"
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <button type="button" onClick={() => saveProfile(a.id)} disabled={profileBusy === a.id} className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-50">
                                  {profileBusy === a.id ? '保存中…' : '保存偏好'}
                                </button>
                                {profileMsg && <span className="text-[12px] text-ink-dim">{profileMsg}</span>}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Codex 与 CLI 完整访问 */}
              <div className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileCode2 size={15} className="text-primary-hover" />
                    Codex 与 CLI 完整访问
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-ink-dim">{cliEnabled ? '已开启·启动时自动开启' : '已关闭'}</span>
                    <button
                      type="button"
                      onClick={() => setCliEnabled((v) => !v)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${cliEnabled ? 'bg-primary' : 'bg-line'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${cliEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[13px] text-ink-dim">
                  让 Codex 通过 CreatorOS 的正式能力读取和操作你的定位、选题、项目、稿件、素材、作品数据与抖音账号。
                </div>
                <div className="mt-3 rounded-lg bg-bg/60 p-3 text-[12px] leading-relaxed text-ink-dim">
                  <div>· 命令行随桌面版安装：CLI 默认随应用启动开启；关闭后会记住你的选择，每次启动重新签发访问凭据，退出时清理凭据。不会暴露模型密钥、登录 Cookie 或内部数据库。</div>
                  <div className="mt-1.5">
                    · 本次访问凭据于 <span className="text-ink">{credentialExpiry}</span> 到期，重启时自动更新
                  </div>
                  <div className="mt-1.5">· 安装路径：<span className="font-mono text-ink">/usr/local/bin/creatoros</span></div>
                  <div className="mt-1.5">· Codex 并行操作多个账号时，每条命令都会显式指定真实账号；保存的默认账号只用于人工连续操作，不会改变桌面端当前账号。</div>
                  <div className="mt-1.5 flex gap-6">
                    <span>近 5 分钟连接：<span className="text-ink">0</span></span>
                    <span>上次调用：<span className="text-ink">暂无调用</span></span>
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded bg-success/15 px-2 py-1 text-[11px] text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    CreatorOS 已接受当前 OS 用户发起的完整读写调用
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCliEnabled(false)}
                    className="rounded-lg border border-error/40 px-3 py-1.5 text-[12px] text-error hover:bg-error/10"
                  >
                    关闭并记住
                  </button>
                  <div className="min-w-[220px] flex-1 rounded-lg bg-bg/60 p-3">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      <KeyRound size={14} className="text-primary-hover" />
                      方舟 API Key（AI 凭据签发）
                    </div>
                    <div className="mt-1 text-[11px] text-ink-faint">
                      {arkKey?.configured ? `已配置：${arkKey.masked}` : '未配置'} · 模型 {arkKey?.model_pro ?? '—'} · 仅本地存储于 backend/.env
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="粘贴新的 ark- 开头 Key 以替换…"
                        className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[12px] outline-none placeholder:text-ink-faint focus:border-primary"
                      />
                      <button onClick={saveArkKey} className="h-8 shrink-0 rounded-lg bg-primary px-3 text-[12px] text-white hover:opacity-90">
                        保存
                      </button>
                    </div>
                    {keyMsg && <div className="mt-1.5 text-[11px] text-primary-hover">{keyMsg}</div>}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== 偏好 ===== */}
          {section === 'preferences' && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="text-sm font-medium">偏好</div>
              <div className="mt-1 text-[12px] text-ink-faint">账号、内容与创作流程的默认偏好</div>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] text-ink">默认目标平台</div>
                    <div className="mt-0.5 text-[12px] text-ink-faint">新建项目与发布排期的默认平台</div>
                  </div>
                  <select
                    value={defaultPlatform}
                    onChange={(e) => { setDefaultPlatform(e.target.value); localStorage.setItem('creatoros_default_platform', e.target.value) }}
                    className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary"
                  >
                    <option value="douyin">抖音</option>
                    <option value="xhs">小红书</option>
                    <option value="bilibili">B站</option>
                    <option value="weibo">微博</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] text-ink">语言</div>
                    <div className="mt-0.5 text-[12px] text-ink-faint">界面语言</div>
                  </div>
                  <span className="text-[13px] text-ink-dim">zh-CN（简体中文）</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] text-ink">时区</div>
                    <div className="mt-0.5 text-[12px] text-ink-faint">创作排期与自动化按此时区执行</div>
                  </div>
                  <span className="text-[13px] text-ink-dim">{timezone}</span>
                </div>
              </div>
            </div>
          )}

          {/* ===== 外观 ===== */}
          {section === 'appearance' && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="text-sm font-medium">外观</div>
              <div className="mt-1 text-[12px] text-ink-faint">界面主题，即时生效并记住选择</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    { key: 'dark', label: '深色', icon: Moon },
                    { key: 'light', label: '浅色', icon: Sun },
                    { key: 'system', label: '跟随系统', icon: Palette },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTheme(t.key)}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 ${theme === t.key ? 'border-primary bg-primary-soft/40' : 'border-line hover:border-primary-soft'}`}
                  >
                    <t.icon size={20} className={theme === t.key ? 'text-primary-hover' : 'text-ink-dim'} />
                    <span className={`text-[13px] ${theme === t.key ? 'text-primary-hover' : 'text-ink'}`}>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ===== 模型配置 ===== */}
          {section === 'model' && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="text-sm font-medium">模型配置</div>
              <div className="mt-1 text-[12px] text-ink-faint">AI 能力所依赖的模型与额度策略</div>
              <div className="mt-3 space-y-2 text-[13px] text-ink-dim">
                <div>· 对话（编导大脑）：方舟 Doubao Seed 2.1 Pro</div>
                <div>· 轻量任务（选题批量/日常）：Doubao Seed 2.1 Lite</div>
                <div>· 向量：Doubao Embedding Vision（知识/素材语义检索）</div>
                <div>· 封面：Seedream 生图，Pillow 模板兜底（额度受限时自动降级）</div>
              </div>
              <div className="mt-4 rounded-lg bg-bg/60 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <KeyRound size={14} className="text-primary-hover" />
                  方舟 API Key
                </div>
                <div className="mt-1 text-[11px] text-ink-faint">
                  {arkKey?.configured ? `已配置：${arkKey.masked}` : '未配置'} · 仅本地存储于 backend/.env
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="粘贴新的 ark- 开头 Key 以替换…"
                    className="h-9 min-w-[280px] flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none placeholder:text-ink-faint focus:border-primary"
                  />
                  <button onClick={saveArkKey} className="h-9 rounded-lg bg-primary px-4 text-[13px] text-white hover:opacity-90">
                    保存
                  </button>
                </div>
                {keyMsg && <div className="mt-2 text-[12px] text-primary-hover">{keyMsg}</div>}
              </div>
            </div>
          )}

          {/* ===== 数据服务 ===== */}
          {section === 'data' && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="text-sm font-medium">数据服务</div>
              <div className="mt-1 text-[12px] text-ink-faint">数据存储、隔离与外部数据通道</div>
              <div className="mt-3 space-y-2 text-[13px] text-ink-dim">
                <div>· 业务数据按账号隔离存储（account_id），切换账号即切换整套工作台数据。</div>
                <div>· 历史作品导入：opencli 同步抖音作品 → 作品/指标/知识资产，沉淀为账号专属上下文。</div>
                <div>· 内容雷达逐字稿：方舟多模态语音转写（doubao-seed-2-1-lite input_audio），60s 分片并发。</div>
                <div>· 数据落盘：SQLite（业务）+ 本地 media/（上传素材）+ backend/.env（API Key）。</div>
              </div>
            </div>
          )}

          {/* ===== 技能 ===== */}
          {section === 'skills' && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="text-sm font-medium">技能</div>
              <div className="mt-1 text-[12px] text-ink-faint">当前系统已启用的编导能力清单</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SKILLS.map((s) => (
                  <div key={s} className="flex items-start gap-2 rounded-lg bg-bg/60 p-3 text-[13px] text-ink-dim">
                    <Wand2 size={14} className="mt-0.5 shrink-0 text-primary-hover" />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== 存储 ===== */}
          {section === 'storage' && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="text-sm font-medium">存储</div>
              <div className="mt-1 text-[12px] text-ink-faint">本地素材库使用情况</div>
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
                </div>
                <div className="mt-2 text-[13px] text-ink">
                  已使用 <span className="font-semibold">{fmtSize(used)}</span> / {fmtSize(STORE_QUOTA)}
                  <span className="ml-2 text-[12px] text-ink-faint">素材 {storeStats?.total.count ?? 0} 条</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary-soft/10 px-2.5 py-2 text-[12px] text-ink-dim">
                <Database size={13} className="text-primary-hover" />
                个人本地素材库
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}

function useStoreStats() {
  const [data, setData] = useState<{ total: { count: number; size: number } } | null>(null)
  useEffect(() => {
    assetsApi
      .stats()
      .then((d) => setData(d as { total: { count: number; size: number } }))
      .catch(() => setData(null))
  }, [])
  return { data }
}
