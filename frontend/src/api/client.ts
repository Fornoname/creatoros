/** CreatorOS 后端 API 客户端。 */
const BASE = 'http://127.0.0.1:8000'

// ---------- 全局当前账号（多账号各归各位，localStorage 持久化） ----------
const ACCOUNT_KEY = 'creatoros_current_account'
let currentAccountId: number | null = (() => {
  try {
    const v = localStorage.getItem(ACCOUNT_KEY)
    return v && v !== 'null' ? Number(v) : null
  } catch {
    return null
  }
})()
export function setCurrentAccount(id: number | null) {
  currentAccountId = id
  try {
    if (id == null) localStorage.removeItem(ACCOUNT_KEY)
    else localStorage.setItem(ACCOUNT_KEY, String(id))
  } catch {}
}
export function getCurrentAccount(): number | null {
  return currentAccountId
}

function withAccount(path: string): string {
  if (currentAccountId == null) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}account_id=${currentAccountId}`
}

async function request<T>(path: string, options: RequestInit = {}, skipAccount = false): Promise<T> {
  const isForm = options.body instanceof FormData
  const full = skipAccount ? path : withAccount(path)
  const res = await fetch(`${BASE}${full}`, {
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, opts?: { all?: boolean }) => request<T>(path, undefined, opts?.all),
  post: <T>(path: string, body?: unknown, opts?: { all?: boolean }) =>
    request<T>(
      path,
      {
        method: 'POST',
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      },
      opts?.all,
    ),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// ---------- 类型 ----------

export interface PositionRule {
  id: number
  rule_type: string
  content: string
  enabled: boolean
}

export interface PositionMaster {
  id: number
  version: number
  name: string
  one_line: string
  content_scope: string
  core_mentality: string
  audience: string
  style: string
  not_do: string
  taboos: string
  capability_boundary: string
  core_value: string
  differentiation: string
  capabilities: string
  project_plan: string
  style_rules: string
  is_active: boolean
  rules: PositionRule[]
}

export interface Topic {
  id: number
  title: string
  score: number
  source: string
  audience: string
  form: string
  pain_point: string
  core_decision: string
  hook: string
  material_count: number
  difficulty: string
  status: string
  tag: string
  created_at?: string
}

export interface ProjectTopicRef {
  id: number
  title: string
  audience: string
  pain_point: string
  core_decision: string
  hook: string
}

export interface SkeletonPoint {
  point?: string
  material?: string
  objection?: string
  response?: string
}

export interface Skeleton {
  core?: string
  supports?: SkeletonPoint[]
  rebuttals?: SkeletonPoint[]
  contrasts?: string[]
}

export interface ScriptItem {
  id: number
  version: number
  skeleton_json: Record<string, unknown> | null
  script_text: string | null
  status: string
}

export interface MaterialItem {
  id: number
  kind: string
  title: string
  content: string
  tags: string[]
  source_url: string
}

export interface Project {
  id: number
  title: string
  status: string
  progress: string
  progress_percent: number
  worth_audience: string
  worth_outcome: string
  worth_evidence: string
  latest_metrics: { views?: number; likes?: number; comments?: number; shares?: number; favorites?: number; captured_at?: string } | null
  archived: boolean
  target_platform: string
  publish_schedule: string
  updated_at: string | null
  topic: ProjectTopicRef | null
  scripts?: ScriptItem[]
  materials?: MaterialItem[]
}

export interface ConversationInfo {
  id: number
  title: string
  context_type: string
  context_id: number | null
}

export interface ChatMessage {
  id: number
  role: string
  content: string
  created_at?: string
}

// ---------- API 封装 ----------

export const positionApi = {
  active: () => api.get<{ master: PositionMaster | null }>('/api/position/active'),
  save: (body: Record<string, string>) => api.post<{ master: PositionMaster }>('/api/position', body),
  interview: (qa_pairs: { q: string; a: string }[]) =>
    api.post<{ draft: Record<string, string> }>('/api/position/interview', { qa_pairs }),
  generateRules: (masterId: number) =>
    api.post<{ master: PositionMaster }>(`/api/position/${masterId}/rules`),
  versions: () => api.get<{ versions: { id: number; version: number; name: string; one_line: string; is_active: boolean; created_at: string | null }[] }>('/api/position/versions'),
  activate: (masterId: number) => api.post<{ ok: boolean; master: PositionMaster }>(`/api/position/${masterId}/activate`),
  reposition: (body: Record<string, string>) => api.post<{ master: PositionMaster; repositioned: boolean }>('/api/position/reposition', body),
  updateRule: (ruleId: number, body: { content?: string; rule_type?: string; enabled?: boolean }) =>
    api.patch<{ ok: boolean; rule: PositionRule }>(`/api/position/rules/${ruleId}`, body),
  deleteRule: (ruleId: number) => api.delete<{ ok: boolean }>(`/api/position/rules/${ruleId}`),
  addRule: (body: { master_id: number; rule_type: string; content: string }) =>
    api.post<{ ok: boolean; rule: PositionRule }>('/api/position/rules', body),
}

export const topicsApi = {
  list: (status?: string, source?: string, tag?: string, search?: string) => {
    const q: string[] = []
    if (status) q.push(`status=${status}`)
    if (source) q.push(`source=${source}`)
    if (tag) q.push(`tag=${encodeURIComponent(tag)}`)
    if (search) q.push(`search=${encodeURIComponent(search)}`)
    return api.get<{ topics: Topic[] }>(`/api/topics${q.length ? `?${q.join('&')}` : ''}`)
  },
  sourceCounts: () => api.get<{ counts: Record<string, number>; total: number }>('/api/topics/source-counts'),
  funnel: () => api.get<{ funnel: Record<string, number>; total: number }>('/api/topics/funnel'),
  create: (body: Record<string, unknown>) => api.post<{ topic: Topic }>('/api/topics', body),
  aiMeeting: (mode: string, signals: string, draft = false) =>
    api.post<{ topics?: Topic[]; drafts?: Record<string, unknown>[]; mode?: string; verified_count?: number; profile_count?: number }>('/api/topics/ai-meeting', { mode, signals, draft }),
  adopt: (body: Record<string, unknown>) => api.post<{ topic: Topic }>('/api/topics/adopt', body),
  complete: (id: number) => api.post<{ topic: Topic }>(`/api/topics/${id}/complete`),
  projectize: (id: number) => api.post<{ project: { id: number; title: string; status: string } }>(`/api/topics/${id}/project`),
  discard: (id: number) => api.post<{ ok: boolean }>(`/api/topics/${id}/discard`),
}

export const projectsApi = {
  updateWorth: (id: number, d: { audience?: string; outcome?: string; evidence?: string }) =>
    api.patch<{ ok: boolean; project: Project }>(`/api/projects/${id}/worth`, { json: d }),
  fillWorth: (id: number) => api.post<{ ok: boolean; project: Project }>(`/api/projects/${id}/worth/fill`),
  list: () => api.get<{ projects: Project[] }>('/api/projects'),
  get: (id: number) => api.get<{ project: Project }>(`/api/projects/${id}`),
  addMaterial: (id: number, body: Record<string, unknown>) =>
    api.post<{ material: MaterialItem }>(`/api/projects/${id}/materials`, body),
  overview: () => api.get<{ counts: { all: number; doing: number; scripting: number; producing: number; published: number; reviewing: number; archived: number } }>('/api/projects/overview'),
  archive: (id: number, archived = true) => api.patch<{ ok: boolean; archived: boolean }>(`/api/projects/${id}/archive`, { archived }),
  archivedList: () => api.get<{ projects: Project[] }>('/api/projects/archived'),
  create: (body: { title: string; status?: string }) =>
    api.post<{ project: Project }>('/api/projects', body),
  skeleton: (id: number) => api.post<{ script: ScriptItem }>(`/api/projects/${id}/skeleton`),
  script: (id: number) => api.post<{ script: ScriptItem }>(`/api/projects/${id}/script`),
  export: async (id: number) => {
    const res = await fetch(`${BASE}${withAccount(`/api/projects/${id}/export`)}`)
    if (!res.ok) throw new Error(`${res.status}`)
    return res.blob()
  },
}

export const conversationsApi = {
  create: (context_type: string, context_id?: number | null) =>
    api.post<{ conversation: ConversationInfo }>('/api/conversations', {
      context_type,
      context_id: context_id ?? null,
    }),
  get: (id: number) => api.get<{ conversation: ConversationInfo; messages: ChatMessage[] }>(`/api/conversations/${id}`),
  send: (id: number, content: string) => api.post<{ reply: string }>(`/api/conversations/${id}/messages`, { content }),
}

// ---------- 素材 / 知识库 ----------

export interface MaterialFull {
  id: number
  kind: string
  title: string
  content: string
  tags: string[]
  source_url: string
  project_id: number | null
  file_name: string
  file_size: number
  deleted: boolean
  created_at: string | null
  embedded: boolean
  url: string | null
}

export interface KnowledgeItem {
  id: number
  title: string
  content: string
  source: string
  source_url: string
  tags: string[]
  embedded: boolean
  created_at?: string | null
}

export interface KnowledgeSearchHit {
  id: number
  title: string
  content: string
  source: string
  source_url: string
  tags: string[]
  score: number
}

export interface SearchResult {
  id: number
  label: string
  score: number
}

export const assetsApi = {
  materials: (params?: { projectId?: number; trash?: boolean; kind?: string }) => {
    let p = '/api/materials'
    const qs: string[] = []
    if (params?.projectId) qs.push(`project_id=${params.projectId}`)
    if (params?.trash) qs.push('trash=true')
    if (params?.kind) qs.push(`kind=${params.kind}`)
    if (qs.length) p += `?${qs.join('&')}`
    return api.get<{ materials: MaterialFull[] }>(p)
  },
  stats: () =>
    api.get<{
      counts: Record<string, { count: number; size: number }>
      total: { count: number; size: number }
      by_project: Record<string, number>
    }>('/api/materials/stats'),
  trash: (id: number, deleted = true) =>
    api.patch<{ ok: boolean; deleted: boolean }>(`/api/materials/${id}/trash`, { deleted }),
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/materials/${id}`),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ material: MaterialFull }>('/api/materials/upload', fd)
  },
  addMaterial: (body: Record<string, unknown>) => api.post<{ material: MaterialFull }>('/api/materials', body),
  knowledge: (params?: { source?: string; q?: string }) => {
    const qs: string[] = []
    if (params?.source) qs.push(`source=${encodeURIComponent(params.source)}`)
    if (params?.q) qs.push(`q=${encodeURIComponent(params.q)}`)
    return api.get<{ knowledge: KnowledgeItem[] }>(`/api/knowledge${qs.length ? '?' + qs.join('&') : ''}`)
  },
  addKnowledge: (body: Record<string, unknown>) => api.post<{ knowledge: KnowledgeItem }>('/api/knowledge', body),
  knowledgeSearch: (q: string, source?: string) => {
    const qs = `q=${encodeURIComponent(q)}${source ? `&source=${encodeURIComponent(source)}` : ''}`
    return api.get<{ results: KnowledgeSearchHit[] }>(`/api/knowledge/search?${qs}`)
  },
  reindex: () => api.post<{ reindexed: number; failed: number }>('/api/reindex'),
  search: (q: string, types = 'materials,knowledge') =>
    api.get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}&types=${types}`),
}

export const settingsApi = {
  arkKey: () => api.get<{ configured: boolean; masked: string; model_pro: string; env_path: string }>('/api/settings/ark-key'),
  updateArkKey: (key: string) =>
    api.put<{ ok: boolean; masked: string; configured: boolean }>('/api/settings/ark-key', { key }),
}

// ---------- 发布 / 封面 ----------

export interface PlatformStatus {
  platform: string
  label: string
  logged_in: boolean
  username: string
  bound: boolean
}

export interface PublicationRecord {
  id: number
  account: string
  platform: string
  status: string
  title: string
  item_id: string
  url: string
  project_id: number | null
  error: string
  created_at?: string
}

export const publishApi = {
  platforms: () => api.get<{ platforms: PlatformStatus[] }>('/api/publish/platforms'),
  records: () => api.get<{ records: PublicationRecord[] }>('/api/publish/records'),
  syncRecords: () => api.post<{ checked: number; matched: number; updated: number }>('/api/publish/records/sync'),
  submit: (body: Record<string, unknown>) =>
    api.post<{ publication: { id: number; platform: string; status: string }; raw: string }>('/api/publish', body),
  videos: (platform = 'douyin', limit = 5) =>
    api.get<{ videos: unknown[] }>(`/api/publish/videos?platform=${platform}&limit=${limit}`),
  stats: (platform = 'douyin') => api.get<{ stats: Record<string, unknown> }>(`/api/publish/stats?platform=${platform}`),
  overview: () =>
    api.get<{
      accounts: Record<string, { ok: boolean; stats?: Record<string, string>; error?: string }>
      local: Record<string, { videos: number; views: number; likes: number }>
    }>('/api/publish/overview'),
  cover: (project_id: number, prompt: string) =>
    api.post<{ cover_url: string; project_id: number; fallback?: boolean }>('/api/publish/cover', { project_id, prompt }),
}

// ---------- 复盘 / 公式库 ----------

export interface PredictionInfo {
  id: number
  predicted_views: number
  predicted_completion: number
  reasoning: string
  created_at?: string
}

export interface ReviewResult {
  summary: string
  strengths: string[]
  weaknesses: string[]
  actions: string[]
  adoptable: string[]
}

export interface MetricInfo {
  id: number
  platform: string
  item_id: string
  views: number
  likes: number
  comments: number
  shares: number
  favorites: number
  completion_rate?: number | null
  retention_5s?: number | null
  cover_ctr?: number | null
  avg_watch_seconds?: number | null
  captured_at?: string
}

export interface FormulaInfo {
  id: number
  title: string
  content: string
  dimension: string
  evidence: string
  confidence: number
  usage_count?: number
  status: string
  created_at?: string
}

export interface AutomationRule {
  id: number
  name: string
  rule_type: string
  schedule: string
  interval_minutes: number
  cron: string
  schedule_text: string
  timezone: string
  task_type: string
  sub_label: string
  backfill_text: string
  disabled_reason: string
  condition: string
  action: string
  action_desc: string
  enabled: boolean
  last_run: string | null
  next_run: string | null
  run_count: number
  error: string
}

export interface AutomationTaskType {
  type: string
  name: string
  sub_label: string
  cron: string
  schedule_text: string
  backfill_text: string
}

export interface AutomationEvent {
  id: number
  target_type: string
  target_id: number
  action: string
  detail: string
  created_at: string
}

export const automationApi = {
  rules: () => api.get<{ rules: AutomationRule[]; task_types: AutomationTaskType[] }>('/api/automation/rules'),
  create: (body: Record<string, unknown>) => api.post<{ rule: AutomationRule }>('/api/automation/rules', body),
  update: (id: number, body: Record<string, unknown>) => api.patch<{ rule: AutomationRule }>(`/api/automation/rules/${id}`, body),
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/automation/rules/${id}`),
  run: (id: number) => api.post<{ rule: AutomationRule; result: string }>(`/api/automation/rules/${id}/run`),
  events: () => api.get<{ events: AutomationEvent[] }>('/api/automation/events'),
}

export const reviewApi = {
  predict: (project_id: number) => api.post<{ prediction: PredictionInfo }>('/api/review/predict', { project_id }),
  analyze: (project_id: number) => api.post<{ review: ReviewResult }>('/api/review/analyze', { project_id }),
  formulas: (status = 'all') => api.get<{ formulas: FormulaInfo[] }>(`/api/review/formulas?status=${status}`),
  generateFormulas: () => api.post<{ formulas: { id: number; title: string }[] }>('/api/review/formulas/generate'),
  decideFormula: (id: number, action: 'adopt' | 'reject') =>
    api.post<{ formula: { id: number; status: string } }>(`/api/review/formulas/${id}/decision`, { action }),
  pullMetrics: (project_id?: number) =>
    api.post<{ pulled: number; total: number }>(`/api/review/metrics/pull${project_id ? `?project_id=${project_id}` : ''}`),
  metrics: (project_id?: number) =>
    api.get<{ metrics: MetricInfo[] }>(`/api/review/metrics${project_id ? `?project_id=${project_id}` : ''}`),
  export: () => api.get<{ report: string }>('/api/review/export'),
  projectMetrics: (project_id: number) =>
    api.get<{ project_id: number; metrics: Record<string, number | null> | null }>(`/api/review/project-metrics?project_id=${project_id}`),
  predictions: () =>
    api.get<{
      predictions: {
        id: number
        project_id: number | null
        publication_id: number | null
        predicted_views: number
        predicted_completion: number | null
        reasoning: string
        actual_views: number | null
        actual_count: number
        created_at: string | null
      }[]
    }>('/api/review/predictions'),
  overview: () => api.get<{ accounts: Record<string, { ok: boolean; stats?: Record<string, string>; error?: string }>; local: Record<string, { videos: number; views: number; likes: number }> }>('/api/publish/overview'),

}

// ---------- 多账号 ----------

export interface AccountStats {
  account_id: number
  display_name: string
  platform: string
  username: string
  uid: string
  follower_count: number
  video_count: number
  last_synced_at: string | null
  profile_path: string
  profile_status: string
  works: number
  metrics_count: number
  total_views: number
  total_likes: number
  projects: number
  topics: number
  formulas: number
  knowledge: number
  materials: number
}

export interface AccountInfo {
  id: number
  platform: string
  display_name: string
  username: string
  uid: string
  status: string
  is_default: boolean
  created_at: string | null
  stats: AccountStats
}

export interface DashboardOverview {
  account: AccountStats
  trend: { date: string; views: number; likes: number; followers: number; works: number }[]
  works: { id: number; platform: string; item_id: string; title: string; cover_url: string; status: string; created_at: string | null }[]
  completion_rate_avg: number | null
  overdue_projects: { id: number; title: string; status: string; publish_schedule: string }[]
  hot_topics: { tag: string; count: number }[]
  suggestions: { title: string; to: string }[]
  todo_count: number
}

export const dashboardApi = {
  overview: () => api.get<DashboardOverview>('/api/dashboard/overview'),
}

export const accountApi = {
  list: () => api.get<{ accounts: AccountInfo[]; current: number }>('/api/accounts'),
  create: (body: { platform: string; display_name: string; username: string; uid?: string }) =>
    api.post<{ account: AccountInfo }>('/api/accounts', body),
  update: (id: number, body: { display_name?: string; status?: string; is_default?: boolean }) =>
    api.patch<{ account: AccountInfo }>(`/api/accounts/${id}`, body),
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/accounts/${id}`),
  sync: (id: number, limit = 10) =>
    api.post<{ account_id: number; pulled: number; new_publications: number; new_metrics: number; new_knowledge: number }>(
      `/api/accounts/${id}/sync?limit=${limit}`,
    ),
  works: (id: number) => api.get<{ works: { id: number; platform: string; item_id: string; title: string; cover_url: string; status: string; created_at: string | null }[] }>(`/api/accounts/${id}/works`),
  bindProfile: (id: number) => api.post<{ status: string }>(`/api/accounts/${id}/bind-profile`),
  profile: (id: number) => api.get<{ dynamic: string; profile: string; notes: string }>(`/api/accounts/${id}/profile`),
  saveProfile: (id: number, notes: string) => api.put<{ saved: boolean; notes: string }>(`/api/accounts/${id}/profile`, { notes }),
  collectProfile: (id: number, limit = 20) => api.post<{ status: string }>(`/api/accounts/${id}/collect-profile?limit=${limit}`),
}

// ---------- 内容雷达 ----------
export interface RadarSource {
  id: number
  name: string
  sec_uid: string
  description: string
  category: string
  sync_status: string
  auto_sync: boolean
  last_synced_at: string | null
  content_count: number
}

export interface RadarContentItem {
  id: number
  source_id: number | null
  author: string
  aweme_id: string
  title: string
  desc: string
  cover_url: string
  video_url: string
  source_url: string
  play_count: number
  digg_count: number
  comment_count: number
  share_count: number
  collect_count: number
  transcript: string
  transcript_status: string
  transcript_ai?: string
  transcript_kind?: string
  favorite: boolean
  status: string
  in_knowledge?: boolean
  hashtags: string[]
  publish_time: string | null
  collected_at: string | null
}

export const radarApi = {
  stats: () => api.get<{ total: number; favorites: number; pending_transcripts: number; sources: number }>('/api/radar/stats'),
  sources: () => api.get<{ sources: RadarSource[] }>('/api/radar/sources'),
  addSource: (body: { name: string; sec_uid: string; description: string; auto_sync: boolean }) =>
    api.post<{ source: RadarSource; sync: { added?: number; total?: number; error?: string } | null }>('/api/radar/sources', body),
  patchSource: (id: number, body: { auto_sync?: boolean; name?: string; category?: string; sec_uid?: string }) =>
    api.patch<{ source: RadarSource }>(`/api/radar/sources/${id}`, body),
  removeSource: (id: number) => api.delete<{ ok: boolean }>(`/api/radar/sources/${id}`),
  syncSource: (id: number) =>
    api.post<{ source_id: number; added: number; total: number }>(`/api/radar/sources/${id}/sync`),
  searchCollect: (keyword: string, limit = 10) =>
    api.post<{ keyword: string; added: number }>('/api/radar/search', { keyword, limit }),
  toKnowledge: (id: number) =>
    api.post<{ ok: boolean; knowledge: { id: number; title: string }; duplicated: boolean }>(`/api/radar/contents/${id}/to-knowledge`),
  contents: (filter = 'all', sourceId?: number, q = '', ts = 'all', topic = 'all', sort = 'latest', category?: string) => {
    let p = `/api/radar/contents?filter=${filter}&ts=${ts}&topic=${topic}&sort=${sort}`
    if (sourceId) p += `&source_id=${sourceId}`
    if (category) p += `&category=${encodeURIComponent(category)}`
    if (q) p += `&q=${encodeURIComponent(q)}`
    return api.get<{ contents: RadarContentItem[] }>(p)
  },
  categories: () => api.get<{ categories: { name: string; source_count: number }[] }>('/api/radar/categories'),
  createCategory: (name: string) => api.post<{ categories: { name: string; source_count: number }[] }>('/api/radar/categories', { name }),
  pasteLink: (url: string) =>
    api.post<{ content: { id: number; aweme_id: string; title: string }; added: boolean }>('/api/radar/paste-link', { url }),
  draftTopic: (id: number) =>
    api.post<{ draft: { title: string; audience: string; pain_point: string; core_decision: string; hook: string; form: string; difficulty: string } }>(`/api/radar/contents/${id}/draft-topic`),
  adoptTopic: (id: number, draft: Record<string, string>) =>
    api.post<{ topic: { id: number; title: string; status: string } }>(`/api/radar/contents/${id}/adopt-topic`, { draft }),
  uploadTranscriptFile: (id: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ content: RadarContentItem; chars: number }>(`/api/radar/contents/${id}/transcript-file`, fd)
  },
  patchContent: (id: number, body: { favorite?: boolean; transcript?: string; transcript_status?: string }) =>
    api.patch<{ content: RadarContentItem }>(`/api/radar/contents/${id}`, body),
  contentMetrics: (id: number) =>
    api.get<{ content_id: number; current: Record<string, number>; history: { date: string; play_count: number; digg_count: number; comment_count: number; collect_count: number; share_count: number }[] }>(
      `/api/radar/contents/${id}/metrics`
    ),
  extractSubtitle: (id: number) =>
    api.post<{ skipped: boolean; content: RadarContentItem }>(`/api/radar/contents/${id}/extract-subtitle`),
  rewriteTranscript: (id: number) =>
    request(`/api/radar/contents/${id}/rewrite-transcript`, { method: 'POST' }),
  transcribe: (id: number) =>
    api.post<{ content: RadarContentItem }>(`/api/radar/contents/${id}/transcribe`),
  upgrade: (id: number) =>
    api.post<{ topic: { id: number; title: string; status: string }; project_id: number; project_title: string }>(
      `/api/radar/contents/${id}/upgrade`,
    ),
}

// ---------- 运营分析 ----------
export interface AudienceInfo {
  item_id: string
  recommend: number
  friends: number
  follow: number
  homepage: number
  search: number
  other: number
  source: string
  collected_at: string | null
}

export interface AnalyticsWork {
  id: number
  item_id: string
  title: string
  cover_url: string
  platform: string
  status: string
  created_at: string | null
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    favorites: number
    followers_gained: number
    deep?: Record<string, number>
  } | null
  audience: AudienceInfo | null
}

export interface AnalyticsAnomaly {
  item_id: string
  title: string
  type: 'high_views' | 'low_engagement'
  views: number
  likes: number
}

export interface AnalyticsAccountBrief {
  account_id: number
  name: string
  username: string
  works: number
  views: number
  likes: number
}

export interface AlertItem {
  id: number
  level: string
  title: string
  detail: string
  source_type: string
  source_id: number | null
  read: boolean
  created_at: string | null
}

export const alertsApi = {
  list: (opts?: { unread_only?: boolean; limit?: number }) =>
    api.get<{ alerts: AlertItem[]; unread: number }>(
      `/api/alerts?limit=${opts?.limit ?? 20}${opts?.unread_only ? '&unread_only=1' : ''}`,
    ),
  markRead: (id: number) => api.post<{ ok: boolean; alert: AlertItem }>(`/api/alerts/${id}/read`),
}

export const analyticsApi = {
  overview: (accountId?: number, all = false) =>
    api.get<{
      works: AnalyticsWork[]
      totals: { views: number; likes: number; works: number }
      anomalies: AnalyticsAnomaly[]
      account: { id: number; name: string }
      meta: { platform: string; source: string; window: string }
    }>(
      `/api/analytics/overview${accountId ? `?account_id=${accountId}` : ''}`,
      { all },
    ),
  accountsOverview: () =>
    api.get<{ accounts: AnalyticsAccountBrief[] }>('/api/analytics/accounts-overview', { all: true }),
  refresh: (itemId: string) =>
    api.post<{ ok: boolean; views: number; likes: number; deep: Record<string, number> }>(
      `/api/analytics/audience/${itemId}/refresh`,
    ),
  saveAudience: (itemId: string, values: Record<string, number>) =>
    api.put<{ ok: boolean; audience: AudienceInfo }>(`/api/analytics/audience/${itemId}`, values),
}
