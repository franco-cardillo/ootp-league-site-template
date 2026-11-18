import type { LeaderEntry, Leaders } from './types'

type Side = 'batting' | 'pitching'

type Board = { key: string; label: string; format: (value: number) => string }

// These formats are shared by the boards and the read so the two cannot disagree
// about the precision at which a leaderboard value is displayed.
export const BATTING_BOARDS: Board[] = [
  { key: 'avg', label: 'Batting Average', format: (v) => v.toFixed(3).replace(/^0/, '') },
  { key: 'hr', label: 'Home Runs', format: (v) => String(v) },
  { key: 'rbi', label: 'Runs Batted In', format: (v) => String(v) },
  { key: 'h', label: 'Hits', format: (v) => String(v) },
  { key: 'r', label: 'Runs', format: (v) => String(v) },
  { key: 'sb', label: 'Stolen Bases', format: (v) => String(v) },
  { key: 'ops', label: 'OPS', format: (v) => v.toFixed(3).replace(/^0/, '') },
  { key: 'war', label: 'WAR', format: (v) => v.toFixed(1) },
]

export const PITCHING_BOARDS: Board[] = [
  { key: 'w', label: 'Wins', format: (v) => String(v) },
  { key: 'era', label: 'ERA', format: (v) => v.toFixed(2) },
  { key: 'k', label: 'Strikeouts', format: (v) => String(v) },
  { key: 'sv', label: 'Saves', format: (v) => String(v) },
  { key: 'whip', label: 'WHIP', format: (v) => v.toFixed(2) },
  { key: 'ip', label: 'Innings Pitched', format: (v) => v.toFixed(1) },
  { key: 'war', label: 'WAR', format: (v) => v.toFixed(1) },
]

type ReadBoard = {
  side: Side
  key: string
  title: string
  name: string
  value: (display: string, raw: number) => string
}

const count = (singular: string, plural: string) => (display: string, raw: number) =>
  `${display} ${raw === 1 ? singular : plural}`

// Prefer a mix of offense and pitching; use other boards if some are missing.
// IP is intentionally omitted: the export's IP encoding is not established here,
// so the read should not invent an interpretation of partial innings.
const READ_BOARDS: ReadBoard[] = [
  { side: 'batting', key: 'hr', title: 'The power race', name: 'home-run', value: count('home run', 'home runs') },
  { side: 'batting', key: 'avg', title: 'At the plate', name: 'batting average', value: (v) => `a ${v} batting average` },
  { side: 'pitching', key: 'era', title: 'Run prevention', name: 'ERA', value: (v) => `a ${v} ERA` },
  { side: 'pitching', key: 'k', title: 'Strikeout leaders', name: 'strikeout', value: count('strikeout', 'strikeouts') },
  { side: 'batting', key: 'sb', title: 'On the bases', name: 'stolen-base', value: count('stolen base', 'stolen bases') },
  { side: 'batting', key: 'ops', title: 'On-base and power', name: 'OPS', value: (v) => `a ${v} OPS` },
  { side: 'batting', key: 'rbi', title: 'Driving runs in', name: 'RBI', value: (v) => `${v} RBI` },
  { side: 'batting', key: 'h', title: 'Collecting hits', name: 'hits', value: count('hit', 'hits') },
  { side: 'batting', key: 'r', title: 'Crossing the plate', name: 'runs', value: count('run', 'runs') },
  { side: 'batting', key: 'war', title: 'Batting WAR', name: 'batting WAR', value: (v) => `${v} batting WAR` },
  { side: 'pitching', key: 'w', title: 'Pitching wins', name: 'wins', value: count('win', 'wins') },
  { side: 'pitching', key: 'sv', title: 'Closing games', name: 'saves', value: count('save', 'saves') },
  { side: 'pitching', key: 'whip', title: 'WHIP watch', name: 'WHIP', value: (v) => `a ${v} WHIP` },
  { side: 'pitching', key: 'war', title: 'Pitching WAR', name: 'pitching WAR', value: (v) => `${v} pitching WAR` },
]

function usable(row: LeaderEntry | null | undefined): row is LeaderEntry {
  return !!row && typeof row.name === 'string' && row.name.trim().length > 0 &&
    typeof row.value === 'number' && Number.isFinite(row.value)
}

export function leaderboardRows(leaders: Leaders, side: Side, key: string): LeaderEntry[] {
  const rows = leaders?.[side]?.[key]
  return Array.isArray(rows) ? rows.filter(usable) : []
}

function names(rows: LeaderEntry[]): string {
  const shown = rows.slice(0, 3).map((row) => row.name)
  const remaining = rows.length - shown.length
  if (remaining) return `${shown.join(', ')} and ${remaining} other${remaining === 1 ? '' : 's'}`
  if (shown.length === 1) return shown[0]
  if (shown.length === 2) return shown.join(' and ')
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

export interface LeaderboardObservation {
  title: string
  body: string
}

/** Describe the entries in board order, grouping only values equal at display precision. */
export function buildLeaderboardRead(leaders: Leaders): LeaderboardObservation[] {
  const observations: LeaderboardObservation[] = []
  for (const spec of READ_BOARDS) {
    const rows = leaderboardRows(leaders, spec.side, spec.key)
    const board = (spec.side === 'batting' ? BATTING_BOARDS : PITCHING_BOARDS).find((item) => item.key === spec.key)
    const first = rows[0]
    if (!board || !usable(first)) continue

    const firstDisplay = board.format(first.value)
    const top = [first]
    let index = 1
    while (usable(rows[index]) && board.format(rows[index].value) === firstDisplay) {
      top.push(rows[index++])
    }

    let body: string
    if (top.length > 1) {
      body = `${names(top)} are shown at the top of the ${spec.name} board, each with ${spec.value(firstDisplay, first.value)}.`
    } else {
      body = `${first.name} is listed first on the ${spec.name} board with ${spec.value(firstDisplay, first.value)}.`
      const next = rows[index]
      if (usable(next)) {
        const nextDisplay = board.format(next.value)
        const runners = [next]
        index++
        while (usable(rows[index]) && board.format(rows[index].value) === nextDisplay) {
          runners.push(rows[index++])
        }
        body += ` ${names(runners)} ${runners.length === 1 ? 'follows' : 'follow'} with ${spec.value(nextDisplay, next.value)}${runners.length === 1 ? '' : ' apiece'}.`
      }
    }
    observations.push({ title: spec.title, body })
    if (observations.length === 4) break
  }
  return observations
}
