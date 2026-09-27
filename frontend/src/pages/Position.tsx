import { Check, History, Loader2, MessageSquarePlus, Pencil, Plus, RefreshCw, Save, Search, Sparkles, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { positionApi, type PositionMaster, type PositionRule } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const FIELDS: { key: keyof PositionMaster; label: string; placeholder: string; rows?: number }[] = [
  { key: 'one_line', label: '一句话定位', placeholder: '用一句话说清你的账号定位', rows: 2 },
  { key: 'content_scope', label: '内容范围', placeholder: '你主要做哪几类内容', rows: 2 },
  { key: 'core_mentality', label: '核心心法', placeholder: '创作的基本原则', rows: 2 },
  { key: 'audience', label: '目标人群', placeholder: '你的内容给谁看', rows: 2 },
  { key: 'style', label: '表达风格', placeholder: '语言风格、画面风格', rows: 2 },
  { key: 'not_do', label: '不做什么', placeholder: '内容边界', rows: 2 },
  { key: 'taboos', label: '核心禁忌', placeholder: '绝对不能出现的内容', rows: 2 },
  { key: 'capability_boundary', label: '能力边界', placeholder: '当前不碰的领域', rows: 2 },
]

const EXTRA_FIELDS: { key: keyof PositionMaster; label: string; placeholder: string; rows?: number }[] = [
  { key: 'core_value', label: '核心价值（详述）', placeholder: '你持续为受众提供的核心价值是什么？', rows: 3 },
  { key: 'differentiation', label: '差异化话术', placeholder: '与同行的差异表达：不做什么、怎么做（如：不立神话、不做工具盘点）', rows: 3 },
  { key: 'capabilities', label: '能力清单（每行一项）', placeholder: '你能提供的能力，每行一条，如：\n专业知识体系与可执行步骤拆解\nAI产品从0到1真实迭代记录', rows: 4 },
  { key: 'project_plan', label: '项目规划', placeholder: '主变现路径 / 副变现路径 / 长链路 / 阶段判断', rows: 4 },
  { key: 'style_rules', label: '表达风格规则', placeholder: '语气、案例怎么讲、方法怎么给、叙事口吻（如：语气专业克制、拒绝煽情）', rows: 4 },
]

const INTERVIEW_QUESTIONS = [
  '你主要给谁做内容？他们的困惑是什么？',
  '你最擅长/最想讲的是什么？能落到什么场景？',
  '你的内容让人看完能带走什么？',
  '你的表达风格是怎样的？',
  '你绝对不做什么？有什么禁忌？',
]

function parseCapabilities(raw: string): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean)
  } catch {
    /* fallthrough */
  }
  return raw.split('\n').map((x) => x.trim()).filter(Boolean)
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{children}</div>
}

export default function Position() {
  const { data, loading, run, setData } = useAsync(() => positionApi.active(), [])
  const { data: versionsData, run: refreshVersions } = useAsync(() => positionApi.versions(), [])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  // 版本搜索
  const [verQuery, setVerQuery] = useState('')
  // AI 访谈
  const [qa, setQa] = useState<{ q: string; a: string }[]>([])
  const [currentQ, setCurrentQ] = useState(INTERVIEW_QUESTIONS[0])
  const [answer, setAnswer] = useState('')
  const [interviewing, setInterviewing] = useState(false)
  const [interviewOpen, setInterviewOpen] = useState(false)
  const [repositionMode, setRepositionMode] = useState(false)
  const [ruleGenerating, setRuleGenerating] = useState(false)
  // 规则编辑
  const [ruleEditing, setRuleEditing] = useState(false)
  const [rulesDraft, setRulesDraft] = useState<PositionRule[] | null>(null)
  const [newRuleType, setNewRuleType] = useState('review')
  const [newRuleContent, setNewRuleContent] = useState('')

  const master = data?.master ?? null
  const capabilities = useMemo(() => parseCapabilities(master?.capabilities ?? ''), [master?.capabilities])

  const versions = useMemo(() => {
    const list = versionsData?.versions ?? []
    if (!verQuery.trim()) return list
    const q = verQuery.trim().toLowerCase()
    return list.filter((v) => `${v.version} ${v.one_line || ''} ${v.name || ''}`.toLowerCase().includes(q))
  }, [versionsData, verQuery])

  function fillForm(m: PositionMaster | null) {
    if (!m) {
      setForm({})
      return
    }
    setForm({
      one_line: m.one_line,
      content_scope: m.content_scope,
      core_mentality: m.core_mentality,
      audience: m.audience,
      style: m.style,
      not_do: m.not_do,
      taboos: m.taboos,
      capability_boundary: m.capability_boundary,
      core_value: m.core_value,
      differentiation: m.differentiation,
      capabilities: m.capabilities,
      project_plan: m.project_plan,
      style_rules: m.style_rules,
    })
  }

  function openEdit() {
    fillForm(master)
    setEditing(true)
    setRepositionMode(false)
    setNotice('')
  }

  async function save() {
    setSaving(true)
    setNotice('')
    try {
      if (repositionMode) {
        await positionApi.reposition(form)
        setNotice('已生成新版本定位，历史版本保留')
      } else {
        await positionApi.save(form)
        setNotice('定位母版已保存')
      }
      setEditing(false)
      setInterviewOpen(false)
      setRepositionMode(false)
      await Promise.all([run(), refreshVersions()])
    } catch (e) {
      setNotice(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  function nextQuestion() {
    const idx = INTERVIEW_QUESTIONS.indexOf(currentQ)
    if (idx < INTERVIEW_QUESTIONS.length - 1) setCurrentQ(INTERVIEW_QUESTIONS[idx + 1])
  }

  async function startInterview() {
    if (!answer.trim()) return
    const pairs = [...qa, { q: currentQ, a: answer.trim() }]
    setQa(pairs)
    setAnswer('')
    setInterviewing(true)
    setNotice('')
    try {
      const { draft } = await positionApi.interview(pairs)
      const merged = { ...form }
      const allKeys = [...FIELDS, ...EXTRA_FIELDS].map((f) => f.key)
      for (const [k, v] of Object.entries(draft)) {
        if (allKeys.includes(k as keyof PositionMaster)) merged[k] = v
      }
      setForm(merged)
      setEditing(true)
      setNotice('AI 已生成定位草案，请确认后保存（可继续补充访谈）')
    } catch (e) {
      setNotice(`访谈失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setInterviewing(false)
    }
  }

  async function generateRules() {
    if (!master) {
      setNotice('请先保存定位母版')
      return
    }
    if (ruleGenerating) return
    setRuleGenerating(true)
    setNotice('正在根据定位生成规则…（约 1 分钟）')
    try {
      const { master: m } = await positionApi.generateRules(master.id)
      setData({ master: m })
      setNotice('定位规则已生成')
    } catch (e) {
      setNotice(`规则生成失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setRuleGenerating(false)
    }
  }

  async function saveRules() {
    if (!master || !rulesDraft) return
    setSaving(true)
    setNotice('')
    try {
      const originals = master.rules
      const draftMap = new Map(rulesDraft.filter((r) => r.id).map((r) => [r.id, r]))
      // 删除被移除的
      for (const r of originals) {
        if (!draftMap.has(r.id)) await positionApi.deleteRule(r.id)
      }
      // 新增 + 修改
      for (const r of rulesDraft) {
        if (r.id) {
          const orig = originals.find((o) => o.id === r.id)
          if (orig && (orig.content !== r.content || orig.enabled !== r.enabled || orig.rule_type !== r.rule_type)) {
            await positionApi.updateRule(r.id, { content: r.content, enabled: r.enabled, rule_type: r.rule_type })
          }
        } else {
          await positionApi.addRule({ master_id: master.id, rule_type: r.rule_type, content: r.content })
        }
      }
      setRuleEditing(false)
      setRulesDraft(null)
      setNotice('定位规则已保存')
      await run()
    } catch (e) {
      setNotice(`规则保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  function beginRuleEdit() {
    setRulesDraft((master?.rules ?? []).map((r) => ({ ...r })))
    setNewRuleType('review')
    setNewRuleContent('')
    setRuleEditing(true)
    setNotice('')
  }

  function cancelRuleEdit() {
    setRuleEditing(false)
    setRulesDraft(null)
    setNotice('')
  }

  async function activateVersion(v: { id: number; version: number }) {
    await positionApi.activate(v.id)
    setNotice(`已恢复 v${v.version}，历史版本保留`)
    await Promise.all([run(), refreshVersions()])
  }

  // ---------- 编辑态 ----------
  if (editing) {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">定位中心</h1>
            <p className="mt-1 text-[13px] text-ink-dim">账号的定位母版——下游的选题、评分、素材匹配与发布都以它为约束源</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? '保存中…' : repositionMode ? '另存为新版本' : '保存定位'}
            </button>
          </div>
        </div>

        {notice && (
          <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">{notice}</div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-line bg-card p-4">
            <div className="text-sm font-medium">定位母版</div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-[12px] text-ink-dim">{f.label}</label>
                <textarea
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  rows={f.rows ?? 2}
                  className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
                />
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-xl border border-line bg-card p-4">
            <div className="text-sm font-medium">核心价值 / 话术 / 规划 / 规则</div>
            {EXTRA_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-[12px] text-ink-dim">{f.label}</label>
                <textarea
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  rows={f.rows ?? 3}
                  className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ---------- 展示态（对标布局） ----------
  return (
    <div className="space-y-5">
      {/* 顶部 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">定位中心</h1>
          <p className="mt-1 text-[13px] text-ink-dim">账号的定位母版——下游的选题、评分、素材匹配与发布都以它为约束源</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={verQuery}
              onChange={(e) => setVerQuery(e.target.value)}
              placeholder="搜索版本…"
              className="w-44 rounded-lg border border-line bg-bg py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setRepositionMode(true)
              setInterviewOpen(true)
              setQa([])
              setCurrentQ(INTERVIEW_QUESTIONS[0])
              setAnswer('')
            }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover"
          >
            <Sparkles size={14} />
            重新定位
          </button>
          <button
            type="button"
            onClick={openEdit}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
          >
            <Pencil size={14} />
            编辑
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">{notice}</div>
      )}

      {/* AI 访谈面板（重新定位时展开） */}
      {interviewOpen && (
        <div className="rounded-xl border border-primary-soft bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquarePlus size={15} className="text-primary-hover" />
              AI 访谈定位
            </div>
            <button type="button" onClick={() => setInterviewOpen(false)} className="text-[12px] text-ink-faint hover:text-ink">
              收起
            </button>
          </div>
          <div className="space-y-2">
            {qa.map((p, i) => (
              <div key={i} className="rounded-lg bg-bg/60 p-2.5 text-[13px]">
                <div className="text-ink-dim">问：{p.q}</div>
                <div className="mt-1 text-ink">答：{p.a}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-line bg-bg p-3 text-[13px] text-ink">{currentQ}</div>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              placeholder="输入你的回答…"
              className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startInterview}
                disabled={interviewing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {interviewing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {interviewing ? 'AI 思考中…' : '提交并生成草案'}
              </button>
              {qa.length > 0 && (
                <button
                  type="button"
                  onClick={nextQuestion}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
                >
                  下一问
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 主体三栏 */}
      {loading ? (
        <div className="py-10 text-center text-[13px] text-ink-faint">加载中…</div>
      ) : !master ? (
        <div className="rounded-xl border border-line bg-card py-12 text-center">
          <div className="text-[15px] font-medium text-ink">还没有定位母版</div>
          <div className="mt-2 text-[13px] text-ink-faint">点击「重新定位」，通过 AI 访谈生成你的第一版定位</div>
          <button
            type="button"
            onClick={openEdit}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-hover"
          >
            直接填写
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 左 2/3 */}
          <div className="space-y-4 lg:col-span-2">
            {/* 核心价值 */}
            <div className="rounded-xl border border-line bg-card p-4">
              <SectionTitle>核心价值</SectionTitle>
              <div className="text-[17px] font-semibold text-ink">{master.one_line || master.name}</div>
              <div className="mt-1.5 text-[12.5px] font-medium text-amber-300">
                服务于：{master.audience || '未填写受众画像（可在「重新定位」访谈中补充）'}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{master.core_value || '（未填写核心价值详述）'}</p>
              {capabilities.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {capabilities.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-ink-dim">
                      <span className="text-primary-hover">·</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 差异化话术 */}
            <div className="rounded-xl border border-line bg-card p-4">
              <SectionTitle>差异化话术</SectionTitle>
              <p className="text-[13px] leading-relaxed text-ink-dim">{master.differentiation || master.style || '（未填写差异化话术）'}</p>
            </div>

            {/* 版本历史 */}
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="mb-1 flex items-center gap-2">
                <History size={14} className="text-primary-hover" />
                <SectionTitle>版本历史</SectionTitle>
              </div>
              <p className="mb-3 text-[11px] text-ink-faint">恢复会切换到所选版本，不新增重复定位。历史版本保留。</p>
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                      v.is_active ? 'border-primary bg-primary-soft/40' : 'border-line bg-bg/60'
                    }`}
                  >
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${v.is_active ? 'bg-primary text-white' : 'bg-ink-faint/20 text-ink-dim'}`}>
                      v{v.version}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{v.one_line || v.name}</div>
                      <div className="text-[10px] text-ink-faint">
                        {v.created_at ? new Date(v.created_at).toLocaleString('zh-CN') : ''}
                      </div>
                    </div>
                    {v.is_active ? (
                      <span className="shrink-0 rounded bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">当前使用</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => activateVersion(v)}
                        className="shrink-0 rounded border border-line px-2.5 py-1 text-[11px] text-ink-dim hover:text-ink"
                      >
                        恢复此版本
                      </button>
                    )}
                  </div>
                ))}
                {!versions.length && <div className="text-[13px] text-ink-faint">暂无版本</div>}
              </div>
            </div>
          </div>

          {/* 右 1/3 */}
          <div className="space-y-4">
            {/* 项目规划 */}
            <div className="rounded-xl border border-line bg-card p-4">
              <SectionTitle>项目规划</SectionTitle>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-dim">
                {master.project_plan || '（未填写项目规划）'}
              </div>
            </div>

            {/* 禁止事项 */}
            <div className="rounded-xl border border-line bg-card p-4">
              <SectionTitle>禁止事项</SectionTitle>
              <div className="space-y-1.5">
                {[
                  ...(master.not_do ? master.not_do.split('\n').map((x) => x.trim()).filter(Boolean) : []),
                  ...(master.taboos ? master.taboos.split('\n').map((x) => x.trim()).filter(Boolean) : []),
                ].map((x, i) => (
                  <div key={i} className="flex gap-2 text-[13px] text-ink-dim">
                    <span className="text-danger">·</span>
                    <span>{x}</span>
                  </div>
                ))}
                {!master.not_do && !master.taboos && <div className="text-[13px] text-ink-faint">（未填写禁止事项）</div>}
              </div>
            </div>

            {/* 表达风格规则 */}
            <div className="rounded-xl border border-line bg-card p-4">
              <SectionTitle>表达风格规则</SectionTitle>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-dim">
                {master.style_rules || master.style || '（未填写表达风格规则）'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 定位规则（下游强约束） */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">定位规则（下游强约束）</div>
          <div className="flex gap-2">
            {!ruleEditing && (
              <>
                <button
                  type="button"
                  onClick={generateRules}
                  disabled={ruleGenerating}
                  className="flex items-center gap-1.5 rounded-lg border border-primary-soft px-3 py-1.5 text-sm text-primary-hover transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ruleGenerating && <Loader2 size={14} className="animate-spin" />}
                  {ruleGenerating ? '生成中…' : 'AI 生成'}
                </button>
                {master?.rules?.length ? (
                  <button
                    type="button"
                    onClick={beginRuleEdit}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
                  >
                    <Pencil size={13} className="mr-1 inline" />
                    编辑规则
                  </button>
                ) : null}
              </>
            )}
            {ruleEditing && (
              <>
                <button
                  type="button"
                  onClick={cancelRuleEdit}
                  className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
                >
                  <X size={13} /> 取消
                </button>
                <button
                  type="button"
                  onClick={saveRules}
                  disabled={saving}
                  className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  <Check size={13} /> {saving ? '保存中…' : '保存规则'}
                </button>
              </>
            )}
          </div>
        </div>
        {!master?.rules?.length && !ruleEditing ? (
          <div className="py-6 text-center text-[13px] text-ink-faint">
            保存定位母版后，点击「AI 生成」，自动产出选题规划 / 审稿 / 项目规划 / 禁止事项；也可点「编辑规则」手动添加
          </div>
        ) : ruleEditing && rulesDraft ? (
          <div className="space-y-2">
            {rulesDraft.map((r, idx) => (
              <div key={r.id ?? `new-${idx}`} className="flex items-start gap-2 rounded-lg border border-line bg-bg/60 p-2.5">
                <select
                  value={r.rule_type}
                  onChange={(e) => {
                    const next = [...rulesDraft]
                    next[idx] = { ...next[idx], rule_type: e.target.value }
                    setRulesDraft(next)
                  }}
                  className="w-24 shrink-0 rounded border border-line bg-bg px-1.5 py-1 text-[11px] outline-none"
                >
                  <option value="topic_planning">选题规划</option>
                  <option value="review">审稿规则</option>
                  <option value="project">项目规划</option>
                  <option value="forbidden">禁止事项</option>
                </select>
                <textarea
                  value={r.content}
                  onChange={(e) => {
                    const next = [...rulesDraft]
                    next[idx] = { ...next[idx], content: e.target.value }
                    setRulesDraft(next)
                  }}
                  rows={2}
                  className="min-w-0 flex-1 resize-none rounded border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-primary"
                />
                <label className="flex shrink-0 flex-col items-center gap-0.5 text-[10px] text-ink-faint">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => {
                      const next = [...rulesDraft]
                      next[idx] = { ...next[idx], enabled: e.target.checked }
                      setRulesDraft(next)
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={() => setRulesDraft(rulesDraft.filter((_, i) => i !== idx))}
                  className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {/* 添加规则 */}
            <div className="flex items-start gap-2 rounded-lg border border-dashed border-line p-2.5">
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value)}
                className="w-24 shrink-0 rounded border border-line bg-bg px-1.5 py-1 text-[11px] outline-none"
              >
                <option value="topic_planning">选题规划</option>
                <option value="review">审稿规则</option>
                <option value="project">项目规划</option>
                <option value="forbidden">禁止事项</option>
              </select>
              <input
                value={newRuleContent}
                onChange={(e) => setNewRuleContent(e.target.value)}
                placeholder="输入新规则内容…"
                className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[12px] outline-none placeholder:text-ink-faint focus:border-primary"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newRuleContent.trim()) return
                  setRulesDraft([...rulesDraft, { id: 0, rule_type: newRuleType, content: newRuleContent.trim(), enabled: true }])
                  setNewRuleContent('')
                }}
                className="flex shrink-0 items-center gap-1 rounded border border-primary-soft px-2.5 py-1 text-[12px] text-primary-hover hover:bg-primary-soft"
              >
                <Plus size={13} /> 添加
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(['topic_planning', 'review', 'project', 'forbidden'] as const).map((type) => {
              const rules = (master?.rules ?? []).filter((r) => r.rule_type === type && r.enabled)
              if (!rules.length) return null
              return (
                <div key={type} className="rounded-lg bg-bg/60 p-3">
                  <div className="mb-2 text-[12px] font-medium text-primary-hover">
                    {type === 'topic_planning' ? '选题规划' : type === 'review' ? '审稿规则' : type === 'project' ? '项目规划' : '禁止事项'}
                  </div>
                  <ul className="space-y-1.5 text-[13px] text-ink-dim">
                    {rules.map((r) => (
                      <li key={r.id} className="leading-relaxed">· {r.content}</li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
