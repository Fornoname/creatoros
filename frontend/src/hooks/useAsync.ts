/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 简单异步加载 hook：loading / error / data。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // deps 由调用方动态传入，无法静态校验；依赖由调用方保证
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await fn()
      if (mounted.current) setData(d)
      return d
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, deps)

  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  return { data, loading, error, run, setData }
}
