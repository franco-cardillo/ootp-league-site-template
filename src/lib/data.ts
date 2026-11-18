import { useEffect, useState } from 'react'

const cache = new Map<string, Promise<unknown>>()

const base = (): string => `${import.meta.env.BASE_URL}data/`

export function load<T>(path: string): Promise<T> {
  const url = `${base()}${path}`
  let pending = cache.get(url)
  if (!pending) {
    pending = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
      return res.json()
    })
    cache.set(url, pending)
  }
  return pending as Promise<T>
}

export interface Resource<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** Fetch a data file once per session and expose its state to a component. */
export function useData<T>(path: string): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let live = true
    setState({ data: null, error: null, loading: true })
    load<T>(path)
      .then((data) => {
        if (live) setState({ data, error: null, loading: false })
      })
      .catch((err: Error) => {
        if (live) setState({ data: null, error: err.message, loading: false })
      })
    return () => {
      live = false
    }
  }, [path])

  return state
}

/** Combine several resources into one, failing only if every source failed. */
export function useAll<T extends Record<string, string>>(
  sources: T,
): { data: { [K in keyof T]: unknown } | null; loading: boolean; error: string | null } {
  return useCombine(sources) as never
}

function useCombine(sources: Record<string, string>) {
  const keys = Object.keys(sources)
  const [state, setState] = useState<{ data: Record<string, unknown> | null; loading: boolean; error: string | null }>(
    { data: null, loading: true, error: null },
  )
  const signature = keys.map((k) => sources[k]).join('|')

  useEffect(() => {
    let live = true
    setState({ data: null, loading: true, error: null })
    const entries = Object.entries(sources)
    Promise.all(entries.map(([key, path]) => load(path).then((value) => [key, value] as const)))
      .then((pairs) => {
        if (live) setState({ data: Object.fromEntries(pairs), loading: false, error: null })
      })
      .catch((err: Error) => {
        if (live) setState({ data: null, loading: false, error: err.message })
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return state
}
