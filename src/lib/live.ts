import { useEffect, useState } from 'react'

export interface LiveStamp {
  generatedAt: string
  simDate: string
  season: number
}

const POLL_MS = 60_000

/**
 * Polls the bundle metadata so an open tab notices a new sim export.
 * The payload is a few hundred bytes, served with cache: no-store.
 */
export function useLiveStamp(currentGeneratedAt?: string) {
  const [latest, setLatest] = useState<LiveStamp | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const res = await fetch(`data/meta.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as LiveStamp
        if (cancelled) return
        setLatest({ generatedAt: json.generatedAt, simDate: json.simDate, season: json.season })
        setCheckedAt(new Date())
      } catch {
        // Offline or a deploy in flight: keep the page as it is.
      }
    }

    void check()
    const timer = setInterval(check, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const stale = Boolean(currentGeneratedAt && latest && latest.generatedAt !== currentGeneratedAt)
  return { latest, checkedAt, stale }
}

export function formatStamp(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
