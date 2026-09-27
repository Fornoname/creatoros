import type { ReactNode } from 'react'

/** 阶段 0 通用页面壳：标题 + 描述 + 内容区。 */
export default function PageShell({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-[13px] text-ink-dim">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}

/** 空态占位。 */
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface/60 py-14 text-center">
      <div className="text-sm font-medium text-ink-dim">{title}</div>
      <div className="mt-1 max-w-sm text-[13px] text-ink-faint">{hint}</div>
    </div>
  )
}
