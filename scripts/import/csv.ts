import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'

export type Row = Record<string, string>

/**
 * Stream a CSV file row by row. Columns are trimmed, a BOM is stripped, and ragged rows are
 * tolerated because OOTP occasionally emits a trailing empty field.
 */
export async function* readCsv(path: string): AsyncGenerator<Row> {
  const parser = createReadStream(path).pipe(
    parse({
      bom: true,
      columns: (header: string[]) => header.map((c) => c.trim()),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
    }),
  )
  for await (const record of parser) {
    yield record as Row
  }
}

/** Count data rows in a file without keeping them in memory. */
export async function countRows(path: string): Promise<number> {
  let n = 0
  for await (const _ of readCsv(path)) n++
  return n
}

export const num = (v: string | undefined): number => {
  if (v === undefined || v === '' || v === 'NULL') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const int = (v: string | undefined): number => Math.trunc(num(v))

export const str = (v: string | undefined): string => (v ?? '').trim()

export const bool = (v: string | undefined): boolean => str(v) === '1' || str(v).toLowerCase() === 'true'

/** Innings pitched in OOTP is a decimal like 45.2 meaning 45 2/3 innings. */
export function ipToOuts(ip: number): number {
  const whole = Math.trunc(ip)
  const frac = Math.round((ip - whole) * 10)
  const outs = frac === 1 ? 1 : frac === 2 ? 2 : 0
  return whole * 3 + outs
}

export function outsToIp(outs: number): number {
  return Math.trunc(outs / 3) + (outs % 3) / 10
}

/** Exact outs when supported by the source. The live feed's integer ip is truncated; ipf
 * supplies its remaining outs. Some older rows contain nonstandard ipf values: do not guess. */
export function exactPitchingOuts(row: Row): number | undefined {
  const rawOuts = str(row.outs)
  if (rawOuts && rawOuts !== 'NULL') {
    if (!/^\d+$/.test(rawOuts)) return undefined
    const outs = Number(rawOuts)
    return Number.isSafeInteger(outs) ? outs : undefined
  }
  const rawIp = str(row.ip)
  const rawIpf = str(row.ipf)
  if (rawIpf && rawIpf !== 'NULL') {
    if (!/^\d+$/.test(rawIp) || !/^[012]$/.test(rawIpf)) return undefined
    const outs = Number(rawIp) * 3 + Number(rawIpf)
    return Number.isSafeInteger(outs) ? outs : undefined
  }
  // An explicitly fractional baseball-notation value is meaningful; a bare integer is not.
  if (!/^\d+\.[012]$/.test(rawIp)) return undefined
  const outs = ipToOuts(Number(rawIp))
  return Number.isSafeInteger(outs) ? outs : undefined
}

export const round = (v: number, places = 3): number => {
  const f = 10 ** places
  return Math.round(v * f) / f
}

/** OOTP dates look like 2027-9-3; normalise to 2027-09-03. */
export function isoDate(raw: string): string {
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return raw.trim()
  const [, y, mm, dd] = m
  return `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}
