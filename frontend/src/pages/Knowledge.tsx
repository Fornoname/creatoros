import { BookOpen, Database, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { assetsApi, type KnowledgeSearchHit } from '../api/client'
import PageShell from '../components/PageShell'
import { useAsync } from '../hooks/useAsync'

const SOURCE_TABS = [
  { value: '', label: '全部' },
  { value: 'manual', label: '手动' },
  { value: 'video', label: '视频' },
  { value: 'web', label: '网页' },
  { value: 'comment', label: '评论' },
]

export default function Knowledge() {
  const [source, setSource] = useState('')
  const { data, loading, run } = useAsync(() => assetsApi.knowledge({ source: source || undefined }), [source])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sourceType, setSourceType] = useState('manual')
  const [sourceUrl, setSourceUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<KnowledgeSearchHit[]>([])
  const [reindexing, setReindexing] = useState(false)

  const items = data?.knowledge ?? []

  useEffect(() => {
    setResults([])
  }, [source])

  const refresh = useCallback(async () => {
    await run()
  }, [run])

  async function add() {
    if (!title.trim() || !content.trim()) return
    try {
      await assetsApi.addKnowledge({
        title: title.trim(),
        content: content.trim(),
        source: sourceType,
        source_url: sourceUrl.trim(),
        tags: [],
      })
      setTitle('')
      setContent('')
      setSourceUrl('')
      setNotice('知识已录入，正在向量化…')
      await refresh()
    } catch (e) {
      setNotice(`录入失败：${e instanceof Error ? e.message : e}`)
    }
  }

  async function search() {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const r = await assetsApi.knowledgeSearch(query.trim(), source || undefined)
      setResults(r.results)
    } catch (e) {
      setNotice(`检索失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSearching(false)
    }
  }

  async function reindex() {
    setReindexing(true)
    try {
      const r = await assetsApi.reindex()
      setNotice(`向量补齐完成：成功 ${r.reindexed} 条${r.failed ? `，失败 ${r.failed} 条` : ''}`)
      await refresh()
    } catch (e) {
      setNotice(`补齐失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setReindexing(false)
    }
  }

  return (
    <PageShell
      title="知识库"
      description="长期内容资产：手动/视频/网页/评论来源沉淀，向量化语义检索，选题与脚本自动引用。"
    >
      {notice && (
        <div className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-2 text-[13px] text-primary-hover">
          {notice}
        </div>
      )}

      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <BookOpen size={15} className="text-primary-hover" />
          录入知识
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="知识标题（如：口播 Hook 的 5 种开头模式）"
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="知识正文：方法、案例、结论…"
          className="mt-2 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
        />
        <div className="mt-2 flex gap-2">
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="rounded-lg border border-line bg-bg px-2 py-2 text-[13px] text-ink outline-none"
          >
            <option value="manual">手动</option>
            <option value="web">网页</option>
            <option value="video">视频</option>
            <option value="comment">评论</option>
          </select>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="来源链接（可选，用于溯源）"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
          <button type="button" onClick={add} className="rounded-lg bg-primary px-4 py-2 text-[13px] text-white hover:bg-primary-hover">
            录入
          </button>
        </div>
      </div>

      {/* 来源筛选 + 语义检索 */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Search size={15} className="text-primary-hover" />
            知识检索
          </div>
          <div className="ml-auto flex gap-1 rounded-lg bg-bg p-0.5">
            {SOURCE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setSource(t.value)}
                className={`rounded-md px-2.5 py-1 text-[12px] ${source === t.value ? 'bg-card text-primary-hover shadow-sm' : 'text-ink-faint hover:text-ink'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reindex}
            disabled={reindexing}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={12} className={reindexing ? 'animate-spin' : ''} />
            补齐向量
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="语义检索知识库：如「新手怎么克服镜头恐惧」"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] text-white hover:bg-primary-hover disabled:opacity-50"
          >
            <Sparkles size={14} />
            {searching ? '检索中…' : '检索'}
          </button>
        </div>
        {results.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {results.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg bg-bg/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">{r.title}</div>
                  <div className="line-clamp-2 text-[12px] text-ink-dim">{r.content}</div>
                </div>
                <span className="shrink-0 text-[12px] text-primary-hover">{(r.score * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-faint">
          <Database size={12} className="mr-1 inline" />
          {items.length} 条知识
        </p>
        <p className="text-[12px] text-ink-faint">{items.filter((k) => k.embedded).length} 条已向量化（可被选题/脚本检索引用）</p>
      </div>

      {loading ? (
        <div className="py-8 text-center text-[13px] text-ink-faint">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 py-12 text-center text-[13px] text-ink-faint">
          {source ? `「${SOURCE_TABS.find((t) => t.value === source)?.label}」来源暂无知识` : '知识库还是空的，录入第一条行业知识'}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((k) => (
            <div key={k.id} className="rounded-xl border border-line bg-card p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink">{k.title}</span>
                <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ${k.embedded ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                  {k.embedded ? '已向量化' : '向量化中'}
                </span>
              </div>
              <div className="line-clamp-3 text-[12px] leading-relaxed text-ink-dim">{k.content}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                <span className="rounded bg-primary-soft/25 px-1.5 py-0.5 text-primary-hover">
                  {SOURCE_TABS.find((t) => t.value === k.source)?.label ?? k.source}
                </span>
                {(k.tags ?? []).map((t) => (
                  <span key={t} className="rounded bg-bg px-1.5 py-0.5">
                    #{t}
                  </span>
                ))}
                {k.source_url && /^https?:\/\//.test(k.source_url) && (
                  <a href={k.source_url} target="_blank" rel="noreferrer" className="ml-auto truncate text-primary-hover underline-offset-2 hover:underline">
                    来源链接
                  </a>
                )}
                {k.created_at && <span className="ml-auto">{k.created_at.slice(5, 16).replace('T', ' ')}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
