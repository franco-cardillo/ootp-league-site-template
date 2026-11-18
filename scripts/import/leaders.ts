import type { BattingSeason, LeaderEntry, PitchingSeason } from '../../src/lib/types'
import { ipToOuts, outsToIp, str, type Row } from './csv'
import { BATTING_LEADERS, MLB_LEAGUE_ID, PITCHING_LEADERS } from './schema'
import type { BattingRecord, PitchingRecord } from './validate'

export type BattingLeaderRecord = BattingRecord & {
  paKnown: boolean
  rawWar: number | null
  rateKnown: { avg: boolean; ops: boolean }
}
export type PitchingLeaderRecord = PitchingRecord & {
  outs: number | null
  rawWar: number | null
  rateKnown: { era: boolean; whip: boolean }
}

// Season normalization converts missing/malformed values to zero and rounds WAR. Keep the
// source validity separately so an incomplete stint cannot fabricate a qualifying rate or WAR.
const countsKnown = (row: Row, fields: string[]): boolean => fields.every((field) => {
  const value = str(row[field])
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
})

export function leaderRawWar(row: Row): number | null {
  const value = str(row.war)
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function battingRateKnown(row: Row): BattingLeaderRecord['rateKnown'] {
  return {
    avg: countsKnown(row, ['ab', 'h']),
    ops: countsKnown(row, ['ab', 'h', 'bb', 'hp', 'sf', 'd', 't', 'hr']),
  }
}

export function pitchingRateKnown(row: Row): PitchingLeaderRecord['rateKnown'] {
  return { era: countsKnown(row, ['er']), whip: countsKnown(row, ['ha', 'bb']) }
}

/** Recorded PA must cover AB and every other PA component that is actually known. */
export function battingPaKnown(row: Row): boolean {
  if (!countsKnown(row, ['pa', 'ab'])) return false
  // Unknown optional components are not treated as zero for any rate. They cannot disprove
  // independently recorded PA; known components still provide a check against corrupt PA.
  const components = ['ab', 'bb', 'hp', 'sf', 'sh'].filter((field) => countsKnown(row, [field]))
  return Number(row.pa) >= components.reduce((sum, field) => sum + Number(row[field]), 0)
}

/**
 * The live feed's integer ip column is truncated (e.g. ip=46, outs=139). Prefer outs;
 * explicitly fractional baseball notation can also be read when outs is absent. An integer
 * without outs is ambiguous in this export, so don't invent its missing fractional innings.
 */
export function pitchingOuts(row: Row): number | null {
  const ip = str(row.ip)
  const match = /^(\d+)(?:\.([012]))?$/.exec(ip)
  if (!match) return null
  const whole = Number(match[1])
  if (!Number.isSafeInteger(whole)) return null
  const outs = str(row.outs)
  if (outs !== '') {
    if (!/^\d+$/.test(outs)) return null
    const n = Number(outs)
    if (!Number.isSafeInteger(n)) return null
    // An integer ip may be truncated; a fractional ip must agree exactly with outs.
    return match[2] === undefined ? (Math.floor(n / 3) === whole ? n : null)
      : (n === ipToOuts(Number(ip)) ? n : null)
  }
  return match[2] === undefined ? null : ipToOuts(Number(ip))
}

/** Only a unique, internally consistent current standings row can supply games played. */
export function teamGamesFromRecords(rows: Row[], mlbTeamIds: Set<number>): Map<number, number> {
  const result = new Map<number, number>()
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const row of rows) {
    if (!/^\d+$/.test(str(row.team_id))) continue
    const id = Number(row.team_id)
    if (!mlbTeamIds.has(id)) continue
    if (seen.has(id)) { duplicates.add(id); result.delete(id); continue }
    seen.add(id)
    const fields = [row.g, row.w, row.l, row.t].map(str)
    if (!fields.every((v) => /^\d+$/.test(v))) continue
    const [g, w, l, t] = fields.map(Number)
    if ([g, w, l, t].every(Number.isSafeInteger) && g > 0 && w + l + t === g) result.set(id, g)
  }
  for (const id of duplicates) result.delete(id)
  return result
}

/**
 * A traded player's numerators cover all MLB stints. For the denominator, use his current MLB
 * roster club when known; otherwise use a uniquely latest stint. Pitching stint
 * numbers are sometimes all zero, so an unresolved trade has no qualifying denominator.
 * This is a current-club approximation: CSV stint rows do not say which team games occurred
 * while the player was on each club. Never substitute a league average or last season's games.
 */
function teamForPlayer<T extends { teamId: number; stint: number }>(lines: T[], rosterTeam?: number): number | null {
  if (rosterTeam) return rosterTeam
  if (lines.some((line) => line.teamId <= 0)) return null
  const ids = new Set(lines.map((l) => l.teamId).filter((id) => id > 0))
  if (ids.size === 1) return [...ids][0]
  const latest = Math.max(...lines.map((l) => l.stint))
  const latestIds = new Set(lines.filter((l) => l.stint === latest).map((l) => l.teamId))
  return latestIds.size === 1 && [...latestIds][0] > 0 ? [...latestIds][0] : null
}

const group = <T extends { playerId: number }>(records: T[]): Map<number, T[]> => {
  const byPlayer = new Map<number, T[]>()
  for (const record of records) {
    const list = byPlayer.get(record.playerId) ?? []
    list.push(record)
    byPlayer.set(record.playerId, list)
  }
  return byPlayer
}

// Competition ranking (1, 1, 3), with ties based on the page's displayed precision.
// Include everyone tied at the tenth rank, sorting those ties by player ID for stability.
function rank(rows: { playerId: number; teamId: number; value: number }[], names: Map<number, string>, ascending: boolean, places: number): LeaderEntry[] {
  const displayed = rows.map((row) => ({ ...row, value: Number(row.value.toFixed(places)) }))
  displayed.sort((a, b) => (ascending ? a.value - b.value : b.value - a.value) || a.playerId - b.playerId)
  let previous: number | undefined
  let currentRank = 0
  return displayed.flatMap((row, index) => {
    if (previous === undefined || row.value !== previous) currentRank = index + 1
    previous = row.value
    return currentRank <= 10 ? [{ ...row, rank: currentRank, name: names.get(row.playerId) ?? `Player ${row.playerId}` }] : []
  })
}

export function buildLeaders(input: {
  batting: BattingLeaderRecord[]
  pitching: PitchingLeaderRecord[]
  names: Map<number, string>
  season: number
  mlbLeagueId?: number
  teamGames: Map<number, number>
  rosterTeams: Map<number, number>
}): { batting: Record<string, LeaderEntry[]>; pitching: Record<string, LeaderEntry[]>; meta: Record<string, unknown> } {
  const { names, season, teamGames, rosterTeams, mlbLeagueId = MLB_LEAGUE_ID } = input
  const current = <T extends { line: { year: number; leagueId: number } }>(r: T) =>
    r.line.year === season && r.line.leagueId === mlbLeagueId
  const batGroups = group(input.batting.filter(current))
  const pitGroups = group(input.pitching.filter(current))
  const team = <T extends { teamId: number; stint: number }>(id: number, lines: T[]) => teamForPlayer(lines, rosterTeams.get(id))
  const battingLeaders: Record<string, LeaderEntry[]> = {}
  const pitchingLeaders: Record<string, LeaderEntry[]> = {}

  for (const def of BATTING_LEADERS) {
    const candidates: { playerId: number; teamId: number; value: number }[] = []
    for (const [playerId, records] of batGroups) {
      const lines = records.map((r) => r.line)
      const club = team(playerId, lines)
      const games = club === null ? undefined : teamGames.get(club)
      const total = (key: keyof BattingSeason) => lines.reduce((sum, line) => sum + Number(line[key]), 0)
      if (def.min === 'pa' && (games === undefined || !records.every((r) => r.paKnown) || total('pa') * 10 < games * 31 || total('ab') <= 0)) continue
      if (def.key === 'avg' && !records.every((r) => r.rateKnown.avg)) continue
      if (def.key === 'ops' && !records.every((r) => r.rateKnown.ops)) continue
      if (def.key === 'war' && !records.every((r) => typeof r.rawWar === 'number' && Number.isFinite(r.rawWar))) continue
      const ab = total('ab'), h = total('h'), bb = total('bb'), hp = total('hp'), sf = total('sf')
      const obp = ab + bb + hp + sf ? (h + bb + hp) / (ab + bb + hp + sf) : 0
      const slg = ab ? (h + total('d') + 2 * total('t') + 3 * total('hr')) / ab : 0
      const value = def.key === 'avg' ? h / ab : def.key === 'ops' ? obp + slg
        : def.key === 'war' ? records.reduce((sum, r) => sum + r.rawWar!, 0) : total(def.key)
      if (!Number.isFinite(value)) continue
      candidates.push({ playerId, teamId: club ?? lines[lines.length - 1].teamId, value })
    }
    battingLeaders[def.key] = rank(candidates, names, false, def.key === 'war' ? 1 : ['avg', 'ops'].includes(def.key) ? 3 : 0)
  }

  for (const def of PITCHING_LEADERS) {
    const candidates: { playerId: number; teamId: number; value: number }[] = []
    for (const [playerId, records] of pitGroups) {
      const lines = records.map((r) => r.line)
      const club = team(playerId, lines)
      const games = club === null ? undefined : teamGames.get(club)
      const total = (key: keyof PitchingSeason) => lines.reduce((sum, line) => sum + Number(line[key]), 0)
      const outs = records.every((r) => r.outs !== null) ? records.reduce((sum, r) => sum + r.outs!, 0) : null
      if (def.min === 'ip' && (games === undefined || outs === null || outs < games * 3 || outs <= 0)) continue
      if (def.min === null && total('g') <= 0) continue
      // A truncated innings column cannot safely supply an exact IP leaderboard entry.
      if (def.key === 'ip' && outs === null) continue
      if (def.key === 'era' && !records.every((r) => r.rateKnown.era)) continue
      if (def.key === 'whip' && !records.every((r) => r.rateKnown.whip)) continue
      if (def.key === 'war' && !records.every((r) => typeof r.rawWar === 'number' && Number.isFinite(r.rawWar))) continue
      // The existing Stats page prints one digit for IP. Baseball notation .1/.2 denotes
      // one/two outs, so use it here (it also preserves the exact ordering by outs).
      const value = def.key === 'era' ? total('er') * 27 / outs! : def.key === 'whip' ? (total('h') + total('bb')) * 3 / outs!
        : def.key === 'ip' && outs !== null ? outsToIp(outs)
          : def.key === 'war' ? records.reduce((sum, r) => sum + r.rawWar!, 0) : total(def.key)
      if (!Number.isFinite(value)) continue
      candidates.push({ playerId, teamId: club ?? lines[lines.length - 1].teamId, value })
    }
    const precision = def.key === 'era' || def.key === 'whip' ? 2 : def.key === 'ip' || def.key === 'war' ? 1 : 0
    pitchingLeaders[def.key] = rank(candidates, names, 'ascending' in def && Boolean(def.ascending), precision)
  }

  return { batting: battingLeaders, pitching: pitchingLeaders,
    meta: { generated: new Date().toISOString(), playersRanked: batGroups.size + pitGroups.size,
      qualificationVersion: 1,
      qualification: '3.1 PA and 1 IP per team game; traded players use all MLB stints and current/latest stint team games as an approximation; missing or ambiguous games/outs are excluded' } }
}
