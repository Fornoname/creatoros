import { Activity, ArrowLeft, Check, Download, FileText, Film, Globe, Link2, Loader2, Paperclip, RefreshCw, Search, Sparkles, TrendingUp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { projectsApi, publishApi, reviewApi, type PredictionInfo, type ReviewResult, type Skeleton } from '../api/client'
import { useAsync } from '../hooks/useAsync'

const WORTH_PLACEHOLDER: Record<string, string> = {
  audience: '尚未明确具体观众和处境，可让编导结合已有资料判断',
  outcome: '尚未明确主要目的',
  evidence: '选题卡尚未记录可核对来源；不代表账号法，需结合素材确认',
}

export default function ProjectEditor() {
  const { id } = useParams()
  const pid = Number(id)
  const nav = useNavigate()
  const { data, loading, run, setData } = useAsync(() => projectsApi.get(pid), [pid])
  const [tab, setTab] = useState<'script' | 'produce' | 'review'>('script')
  const [busy, setBusy] = useState<null | 'worth' | 'skeleton' | 'script' | 'predict' | 'analyze' | 'export'>(null)
  const [searchKw, setSearchKw] = useState('')
  const [worthEdit, setWorthEdit] = useState<null | 'audience' | 'outcome' | 'evidence'>(null)
  const [worthDraft, setWorthDraft] = useState('')
  const skeletonRef = useRef<HTMLDivElement | null>(null)

  async function exportPackage() {
    setBusy('export')
    try {
      const blob = await projectsApi.export(pid)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `项目-${project?.title ?? pid}-素材包.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setNotice('素材包已导出（zip：README/论点骨架/脚本/素材清单）')
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }
  const [notice, setNotice] = useState('')
  // 素材录入
  const [matTitle, setMatTitle] = useState('')
  const [matContent, setMatContent] = useState('')
  const [matUrl, setMatUrl] = useState('')
  // 封面生成
  const [coverPrompt, setCoverPrompt] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverUrl, setCoverUrl] = useState('')
  // 复盘
  const [prediction, setPrediction] = useState<PredictionInfo | null>(null)
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)

  const project = data?.project
  const materials = project?.materials ?? []
  const scripts = project?.scripts ?? []
  const latest = scripts[0]
  const skeleton = (latest?.skeleton_json ?? null) as Skeleton | null
  const scriptText = latest?.script_text ?? null

  async function addMaterial() {
    if (!matTitle.trim() && !matContent.trim()) return
    try {
      await projectsApi.addMaterial(pid, {
        kind: matUrl ? 'link' : 'text',
        title: matTitle.trim() || matContent.trim().slice(0, 30),
        content: matContent.trim(),
        source_url: matUrl.trim(),
        tags: [],
      })
      setMatTitle('')
      setMatContent('')
      setMatUrl('')
      await refresh()
    } catch (e) {
      setNotice(`添加失败：${e instanceof Error ? e.message : e}`)
    }
  }

  async function refresh() {
    const r = await run()
    if (r) setData(r)
  }

  async function fillWorth() {
    setBusy('worth')
    setNotice('编导正在帮你梳理「这条为什么值得做」（约 1 分钟）…')
    try {
      await projectsApi.fillWorth(pid)
      await refresh()
      setWorthEdit(null)
      setNotice('已根据选题与素材补全三卡，可继续微调')
    } catch (e) {
      setNotice(`补全失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function saveWorth() {
    if (!worthEdit) return
    try {
      await projectsApi.updateWorth(pid, { [worthEdit]: worthDraft })
      await refresh()
      setWorthEdit(null)
    } catch (e) {
      setNotice(`保存失败：${e instanceof Error ? e.message : e}`)
    }
  }

  function onSearch() {
    const kw = searchKw.trim()
    nav(kw ? `/materials?q=${encodeURIComponent(kw)}` : '/materials')
  }

  async function buildSkeleton() {
    setBusy('skeleton')
    setNotice('AI 正在搭建论点骨架（约 1 分钟）…')
    try {
      await projectsApi.skeleton(pid)
      await refresh()
      setNotice('论点骨架已生成')
    } catch (e) {
      setNotice(`骨架生成失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function genScript() {
    setBusy('script')
    setNotice('AI 正在生成脚本（约 1 分钟）…')
    try {
      await projectsApi.script(pid)
      await refresh()
      setNotice('脚本已生成')
    } catch (e) {
      setNotice(`脚本生成失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function genCover() {
    if (!coverPrompt.trim()) {
      setNotice('请描述封面画面')
      return
    }
    setCoverBusy(true)
    setNotice('AI 正在生成封面（Seedream 控速，约 1 分钟）…')
    try {
      const r = await publishApi.cover(pid, coverPrompt.trim())
      setCoverUrl(r.cover_url)
      setNotice('封面已生成，可保存到本地使用')
    } catch (e) {
      setNotice(`封面生成失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setCoverBusy(false)
    }
  }

  async function predict() {
    setBusy('predict')
    setNotice('AI 正在预测表现（约 1 分钟）…')
    try {
      const r = await reviewApi.predict(pid)
      setPrediction(r.prediction)
      setNotice('预测完成，发布后可在复盘中心对照')
    } catch (e) {
      setNotice(`预测失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  async function analyze() {
    setBusy('analyze')
    setNotice('AI 正在复盘（约 1 分钟）…')
    try {
      const r = await reviewApi.analyze(pid)
      setReviewResult(r.review)
      setNotice('复盘完成')
    } catch (e) {
      setNotice(`复盘失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-[13px] text-ink-faint">加载项目…</div>
  }
  if (!project) {
    return <div className="py-16 text-center text-[13px] text-ink-faint">项目不存在</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/projects" className="text-ink-faint transition-colors hover:text-ink">
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-xl font-semibold">{project.title}</h1>
            <span className="rounded bg-primary-soft px-2 py-0.5 text-[11px] text-primary-hover">
              {project.status}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-ink-dim">{project.progress || '—'}</p>
        </div>
        <div className="relative w-56 shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={searchKw}
            onChange={(e) => setSearchKw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="搜索你感兴趣的内容"
            className="w-full rounded-lg border border-line bg-bg py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">
          {notice}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 text-[13px]">
        {(
          [
            { key: 'script', label: '脚本', icon: FileText },
            { key: 'produce', label: '制作视频', icon: Film },
            { key: 'review', label: '复盘', icon: RefreshCw },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
              tab === t.key ? 'bg-primary-soft text-primary-hover' : 'border border-line text-ink-dim hover:text-ink'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'script' && (
        <>
          {/* 这条为什么值得做 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">这条为什么值得做</div>
              <button
                type="button"
                onClick={fillWorth}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg border border-primary px-2.5 py-1.5 text-[12px] text-primary-hover hover:bg-primary-soft/40 disabled:opacity-50"
              >
                {busy === 'worth' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {busy === 'worth' ? '编导填卡中…' : '让编导帮你填 →'}
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {(
                [
                  { key: 'audience', label: '给谁看', value: project.worth_audience },
                  { key: 'outcome', label: '希望带来什么', value: project.worth_outcome },
                  { key: 'evidence', label: '依据与缺口', value: project.worth_evidence },
                ] as const
              ).map((card) => (
                <div key={card.key} className="rounded-lg bg-bg/60 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] text-ink-faint">{card.label}</div>
                    {worthEdit !== card.key ? (
                      <button
                        type="button"
                        onClick={() => {
                          setWorthEdit(card.key)
                          setWorthDraft(card.value)
                        }}
                        className="text-[11px] text-ink-faint hover:text-primary-hover"
                      >
                        编辑
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={saveWorth} className="text-[11px] text-primary-hover">
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setWorthEdit(null)}
                          className="text-[11px] text-ink-faint hover:text-ink"
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                  {worthEdit === card.key ? (
                    <textarea
                      autoFocus
                      value={worthDraft}
                      onChange={(e) => setWorthDraft(e.target.value)}
                      rows={3}
                      className="mt-1.5 w-full resize-none rounded-lg border border-primary-soft bg-bg px-2.5 py-2 text-[13px] text-ink outline-none"
                    />
                  ) : (
                    <div className={`mt-1.5 text-[13px] leading-relaxed ${card.value ? 'text-ink' : 'text-ink-faint italic'}`}>
                      {card.value || WORTH_PLACEHOLDER[card.key]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 选题已定 */}
          {project.topic && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="mb-2 text-sm font-medium">选题已定</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Info label="目标受众" value={project.topic.audience} />
                <Info label="观点痛点" value={project.topic.pain_point} />
                <Info label="核心决定" value={project.topic.core_decision} />
                <Info label="推荐 Hook" value={project.topic.hook} />
              </div>
            </div>
          )}

          {/* 先准备创作素材 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">先准备创作素材</div>
              <span className="text-[12px] text-ink-faint">复杂观点可先梳理；已有完整逐字稿或简单短口播可直接写</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => nav('/materials')}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] text-ink hover:border-primary-soft hover:text-primary-hover"
              >
                <Upload size={14} className="text-primary-hover" />
                上传 / 管理素材
              </button>
              <button
                type="button"
                onClick={() =>
                  window.open(
                    `https://www.bing.com/search?q=${encodeURIComponent(project.topic?.title || project.title)}`,
                    '_blank',
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] text-ink hover:border-primary-soft hover:text-primary-hover"
              >
                <Globe size={14} className="text-primary-hover" />
                联网找资料
              </button>
              <button
                type="button"
                onClick={() => skeletonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] text-ink hover:border-primary-soft hover:text-primary-hover"
              >
                <Sparkles size={14} className="text-primary-hover" />
                先梳理观点（可选）
              </button>
            </div>
            <div className="mt-3 rounded-lg bg-primary-soft/10 px-3 py-2 text-[12px] text-ink-dim">
              你上传的文件和制作中产生的截图、录屏，都统一保存在素材中心，整个创作周期都能继续使用。
            </div>
          </div>

          {/* 备料区 */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-line bg-card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Paperclip size={15} className="text-primary-hover" />
                备料区（素材 / 链接）
              </div>
              <div className="mb-3 space-y-2">
                <input
                  value={matTitle}
                  onChange={(e) => setMatTitle(e.target.value)}
                  placeholder="素材标题（如：评论截图/数据/案例）"
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
                />
                <textarea
                  value={matContent}
                  onChange={(e) => setMatContent(e.target.value)}
                  rows={2}
                  placeholder="素材内容：原文、要点、数据…"
                  className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
                />
                <div className="flex gap-2">
                  <input
                    value={matUrl}
                    onChange={(e) => setMatUrl(e.target.value)}
                    placeholder="来源链接（可选）"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={addMaterial}
                    className="rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover"
                  >
                    添加素材
                  </button>
                </div>
              </div>

              {materials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
                  还没有素材，先添加「这条内容的弹药」
                </div>
              ) : (
                <div className="space-y-2">
                  {materials.map((m) => (
                    <div key={m.id} className="flex items-start gap-3 rounded-lg bg-bg/60 p-3">
                      {m.kind === 'link' ? (
                        <Link2 size={15} className="mt-0.5 shrink-0 text-primary-hover" />
                      ) : (
                        <Paperclip size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{m.title}</div>
                        {m.content && <div className="mt-0.5 text-[12px] text-ink-dim">{m.content}</div>}
                        {m.source_url && (
                          <a
                            href={m.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block truncate text-[12px] text-primary-hover hover:underline"
                          >
                            {m.source_url}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 论点骨架 */}
            <div ref={skeletonRef} className="flex scroll-mt-24 flex-col rounded-xl border border-line bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium">论点骨架</div>
                {!skeleton && (
                  <button
                    type="button"
                    onClick={buildSkeleton}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[12px] text-white hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy === 'skeleton' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {busy === 'skeleton' ? '生成中…' : '生成骨架'}
                  </button>
                )}
              </div>

              {!skeleton ? (
                <div className="flex-1 rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
                  基于选题与素材，AI 生成：<br />
                  核心论点 + 支撑 / 反驳 / 反差
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg bg-primary-soft/40 p-3">
                    <div className="text-[12px] text-primary-hover">核心论点</div>
                    <div className="mt-1 text-[13px] font-medium text-ink">{String(skeleton.core ?? '')}</div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[12px] text-ink-dim">支撑论据</div>
                    <ul className="space-y-1.5">
                      {(skeleton.supports ?? []).map((s, i) => (
                        <li key={i} className="rounded-lg bg-bg/60 p-2.5 text-[13px]">
                          {String(s.point ?? '')}
                          {s.material ? <span className="text-[12px] text-ink-faint">（素材：{String(s.material)}）</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[12px] text-ink-dim">预判反驳</div>
                    <ul className="space-y-1.5">
                      {(skeleton.rebuttals ?? []).map((r, i) => (
                        <li key={i} className="rounded-lg bg-bg/60 p-2.5 text-[13px]">
                          <span className="text-danger">{String(r.objection ?? '')}</span>
                          <span className="text-ink"> → {String(r.response ?? '')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[12px] text-ink-dim">反差 / 反常识</div>
                    <ul className="space-y-1.5">
                      {(skeleton.contrasts ?? []).map((c, i) => (
                        <li key={i} className="rounded-lg bg-bg/60 p-2.5 text-[13px]">· {String(c)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 脚本 */}
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">口播脚本</div>
              {skeleton && !scriptText && (
                <button
                  type="button"
                  onClick={genScript}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy === 'script' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {busy === 'script' ? '生成中…' : '生成脚本'}
                </button>
              )}
            </div>
            {!scriptText ? (
              <div className="rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
                {skeleton ? '论点骨架已就绪，点击「生成脚本」' : '先在上方生成论点骨架'}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg bg-bg/60 p-4 font-sans text-[13px] leading-relaxed text-ink">
                {scriptText}
              </pre>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={exportPackage}
                disabled={busy === 'export'}
                className="flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-[12px] text-primary-hover hover:bg-primary-soft/40 disabled:opacity-50"
              >
                <Download size={13} />
                {busy === 'export' ? '打包中…' : '导出素材包'}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'produce' && (
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Film size={15} className="text-primary-hover" />
            AI 封面生成（Seedream 5.0 Flash）
          </div>
          <div className="flex gap-2">
            <input
              value={coverPrompt}
              onChange={(e) => setCoverPrompt(e.target.value)}
              placeholder="描述封面画面：如「竖版封面，大标题『新号别上来就硬凹垂直』，深色背景紫色点缀，口播博主风格」"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
            />
            <button
              type="button"
              onClick={genCover}
              disabled={coverBusy}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {coverBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {coverBusy ? '生成中…' : '生成封面'}
            </button>
          </div>
          {coverUrl ? (
            <div className="mt-3">
              <img
                src={`http://127.0.0.1:8000${coverUrl}`}
                alt="生成封面"
                className="max-h-80 rounded-lg border border-line"
              />
              <div className="mt-2 text-[12px] text-ink-faint">
                已保存到后端 media/covers/，可下载使用
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-line py-8 text-center text-[13px] text-ink-faint">
              输入画面描述，生成竖版封面图
            </div>
          )}
        </div>
      )}

      {tab === 'review' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <TrendingUp size={15} className="text-primary-hover" />
                发布前预测（校准飞轮）
              </div>
              <button
                type="button"
                onClick={predict}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {busy === 'predict' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {busy === 'predict' ? '预测中…' : 'AI 预测'}
              </button>
            </div>
            {prediction ? (
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-lg bg-bg/60 p-3">
                  <div className="text-[12px] text-ink-faint">预测播放</div>
                  <div className="mt-1 text-xl font-semibold text-ink">
                    {Math.round(prediction.predicted_views).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg bg-bg/60 p-3">
                  <div className="text-[12px] text-ink-faint">预测完播率</div>
                  <div className="mt-1 text-xl font-semibold text-ink">
                    {(prediction.predicted_completion * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-lg bg-primary-soft/20 p-3">
                  <div className="text-[12px] text-primary-hover">预测理由</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink">{prediction.reasoning}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
                发布前让 AI 预测表现，发布后与真实指标对照，校准判断
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Activity size={15} className="text-primary-hover" />
                AI 复盘
              </div>
              <button
                type="button"
                onClick={analyze}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {busy === 'analyze' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {busy === 'analyze' ? '复盘分析中…' : '开始复盘'}
              </button>
            </div>
            {reviewResult ? (
              <div className="space-y-3">
                <p className="rounded-lg bg-bg/60 p-3 text-[13px] leading-relaxed text-ink">{reviewResult.summary}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <ReviewBlock title="做得好的" items={reviewResult.strengths} tone="good" />
                  <ReviewBlock title="要改进的" items={reviewResult.weaknesses} tone="bad" />
                </div>
                <ReviewBlock title="下一条的改进动作" items={reviewResult.actions} tone="action" />
                {reviewResult.adoptable.length > 0 && (
                  <div className="rounded-lg border border-primary-soft/50 bg-primary-soft/20 p-3">
                    <div className="mb-2 text-[13px] font-medium text-primary-hover">本期可采纳沉淀</div>
                    <ul className="space-y-1.5 text-[13px] text-ink">
                      {reviewResult.adoptable.map((a, i) => (
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
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-faint">
                发布后运行复盘，沉淀可复用公式
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewBlock({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'bad' | 'action' }) {
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg/60 p-3">
      <div className="text-[12px] text-ink-faint">{label}</div>
      <div className="mt-1 text-[13px] text-ink">{value || '—'}</div>
    </div>
  )
}
