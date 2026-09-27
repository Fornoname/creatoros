import { Bot, SendHorizonal, Sparkles } from 'lucide-react'

const QUICK: string[] = [
  '帮我梳理定位一句话',
  '给 5 个爆款选题方向',
  '分析下最近作品的完播率',
  '写一个 3 分钟口播脚本框架',
  '把复盘结论沉淀成公式',
  '检查脚本是否符合定位',
]
import { useEffect, useRef, useState } from 'react'
import { conversationsApi, type ChatMessage } from '../api/client'

/** 全局编导对话：真实接入后端方舟 LLM（阶段 1）。 */
export default function AssistantPanel({ open }: { open: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const [convId, setConvId] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await conversationsApi.create('global', null)
        if (cancelled) return
        setConvId(list.conversation.id)
        const detail = await conversationsApi.get(list.conversation.id)
        if (cancelled) return
        setMessages(detail.messages)
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(`连接后端失败：${e instanceof Error ? e.message : e}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  async function sendWith(text?: string) {
    const content = (text ?? draft).trim()
    if (!content) return
    setDraft('')
    setMessages((prev) => [...prev, { id: -Date.now(), role: 'user', content, created_at: new Date().toISOString() }])
    setThinking(true)
    try {
      const { reply } = await conversationsApi.send(convId!, content)
      setMessages((prev) => [...prev, { id: -Date.now() + 1, role: 'assistant', content: reply, created_at: new Date().toISOString() }])
    } catch (e) {
      setMessages((prev) => [...prev, { id: -Date.now() + 2, role: 'assistant', content: `调用失败：${e instanceof Error ? e.message : e}`, created_at: new Date().toISOString() }])
    } finally {
      setThinking(false)
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || thinking || !convId) return
    setDraft('')
    setMessages((m) => [...m, { id: Date.now(), role: 'user', content: text }])
    setThinking(true)
    setError('')
    try {
      const { reply } = await conversationsApi.send(convId, text)
      setMessages((m) => [...m, { id: Date.now(), role: 'assistant', content: reply }])
    } catch (e) {
      setError(`调用失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setThinking(false)
    }
  }

  if (!open) return null

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot size={16} className="text-primary-hover" />
          编导对话
        </div>
        <Sparkles size={14} className="text-ink-faint" />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!ready && !error && (
          <div className="rounded-xl bg-card p-3 text-[13px] text-ink-dim">正在连接…</div>
        )}
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">
            {error}
          </div>
        )}
        {messages.length === 0 && ready && (
          <div className="rounded-xl bg-card p-3 text-[13px] leading-relaxed text-ink-dim">
            我是你的编导智能体，已注入你的账号定位约束。示例：
            <div className="mt-2 space-y-1 text-primary-hover">
              <div>· 基于最近评论生成 5 个选题</div>
              <div>· 帮我生成这条内容的论点骨架</div>
              <div>· 分析这个作品的发布数据</div>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[90%] rounded-xl p-3 text-[13px] leading-relaxed ${
              m.role === 'user'
                ? 'ml-auto bg-primary text-white'
                : 'bg-card text-ink'
            }`}
          >
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {thinking && (
          <div className="rounded-xl bg-card p-3 text-[13px] text-ink-faint">
            <Sparkles size={12} className="mr-1 inline animate-pulse" />
            AI 思考中…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setDraft(q)
                void sendWith(q)
              }}
              disabled={thinking}
              className="rounded-full border border-primary-soft bg-primary-soft/30 px-2.5 py-1 text-[11px] text-primary-hover transition-colors hover:bg-primary-soft/60 disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="问问编导智能体…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={send}
            disabled={thinking || !draft.trim()}
            aria-label="发送"
            className="text-primary-hover transition-colors hover:text-primary disabled:opacity-40"
          >
            <SendHorizonal size={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}
