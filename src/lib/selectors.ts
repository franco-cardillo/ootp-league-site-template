import type {
  BattingSeason,
  Division,
  Game,
  PitchingSeason,
  PlayerBio,
  PlayerDetail,
  StandingRow,
  SubLeague,
  Team,
} from './types'

export const teamMap = (teams: Team[]): Map<number, Team> => new Map(teams.map((t) => [t.id, t]))

export const teamLabel = (team: Team | undefined): string =>
  team ? `${team.city} ${team.nickname}` : 'Unknown club'

export const pct = (value: number): string => value.toFixed(3).replace(/^0/, '')

export const record = (w: number, l: number, t = 0): string => (t ? `${w}-${l}-${t}` : `${w}-${l}`)

/** Numeric IP is mathematical innings, never baseball notation. Legacy rows lack provenance;
 * show their best estimate with ~ instead of claiming their fractional outs are exact. */
export function ip(value: number | undefined, outs?: number, missing = false): string {
  if (missing || value === undefined || !Number.isFinite(value) || value < 0) return '—'
  const exact = outs !== undefined && Number.isSafeInteger(outs) && outs >= 0
  const count = exact ? outs : Math.round(value * 3)
  return `${exact ? '' : '~'}${Math.floor(count / 3)}.${count % 3}`
}

export function pitchingRate(value: number | undefined, outs?: number, missing = false): string {
  if (missing || value === undefined || !Number.isFinite(value)) return '—'
  const exact = outs !== undefined && Number.isSafeInteger(outs) && outs >= 0
  return `${exact ? '' : '~'}${value.toFixed(2)}`
}

/** Select only this season and league, optionally restricted to a particular club. */
export function currentSeasonLines<T extends { year: number; leagueId: number; teamId: number }>(
  lines: T[], year: number, leagueId: number, teamId?: number,
): T[] {
  return lines.filter((line) => line.year === year && line.leagueId === leagueId &&
    (teamId === undefined || line.teamId === teamId))
}

/** Standings rows for one division, best record first. */
export function divisionRows(
  standings: StandingRow[],
  subLeagueId: number,
  divisionId: number,
): StandingRow[] {
  return standings
    .filter((r) => r.subLeagueId === subLeagueId && r.divisionId === divisionId)
    .sort((a, b) => b.pct - a.pct || b.w - a.w)
}

/** Division winners hold the top seed; everyone else competes for wild cards. */
export function wildCardRows(
  standings: StandingRow[],
  subLeagueId: number,
  divisionCount: number,
): StandingRow[] {
  const winners = new Set<number>()
  for (let d = 0; d < divisionCount; d++) {
    const rows = divisionRows(standings, subLeagueId, d)
    if (rows[0]) winners.add(rows[0].teamId)
  }
  return standings
    .filter((r) => r.subLeagueId === subLeagueId && !winners.has(r.teamId))
    .sort((a, b) => b.pct - a.pct || b.w - a.w)
}

export function divisionsFor(divisions: Division[], leagueId: number, subLeagueId: number): Division[] {
  return divisions
    .filter((d) => d.leagueId === leagueId && d.subLeagueId === subLeagueId)
    .sort((a, b) => a.id - b.id)
}

export function subLeaguesIn(subLeagues: SubLeague[], leagueId: number): SubLeague[] {
  return subLeagues.filter((s) => s.leagueId === leagueId).sort((a, b) => a.id - b.id)
}

/** Most recent date that has at least one completed game. */
export function latestPlayedDate(games: Game[]): string | null {
  let latest: string | null = null
  for (const g of games) {
    if (!g.played) continue
    if (!latest || g.date > latest) latest = g.date
  }
  return latest
}

export function gamesOnDate(games: Game[], date: string): Game[] {
  return games.filter((g) => g.date === date).sort((a, b) => a.id - b.id)
}

export function playedDates(games: Game[]): string[] {
  const dates = new Set<string>()
  for (const g of games) if (g.played) dates.add(g.date)
  return [...dates].sort()
}

export function streakLabel(streak: number): string {
  if (streak === 0) return '—'
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** A missing or impossible BNN date cannot be displayed as a real report date. */
export function reportDateLabel(date: string | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'date unavailable'
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return 'date unavailable'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed)
}

export function monthKey(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
}

export const isPitcher = (player: PlayerBio): boolean => player.positionCode === 1

export function ageAt(player: PlayerBio): number {
  return player.age
}

/** Sum a player's season lines when they were traded mid-year. */
export function combineBatting(lines: BattingSeason[]): BattingSeason | null {
  if (!lines.length) return null
  if (lines.length === 1) return lines[0]
  const total = lines.reduce(
    (acc, l) => ({
      ...acc,
      g: acc.g + l.g,
      ab: acc.ab + l.ab,
      r: acc.r + l.r,
      h: acc.h + l.h,
      d: acc.d + l.d,
      t: acc.t + l.t,
      hr: acc.hr + l.hr,
      rbi: acc.rbi + l.rbi,
      bb: acc.bb + l.bb,
      ibb: acc.ibb + l.ibb,
      k: acc.k + l.k,
      sb: acc.sb + l.sb,
      cs: acc.cs + l.cs,
      hp: acc.hp + l.hp,
      sh: acc.sh + l.sh,
      sf: acc.sf + l.sf,
      gdp: acc.gdp + l.gdp,
      pa: acc.pa + l.pa,
      war: acc.war + l.war,
    }),
    { ...lines[0], g: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, ibb: 0, k: 0, sb: 0, cs: 0, hp: 0, sh: 0, sf: 0, gdp: 0, pa: 0, war: 0 },
  )
  total.avg = total.ab ? Number((total.h / total.ab).toFixed(3)) : 0
  const den = total.ab + total.bb + total.hp + total.sf
  total.obp = den ? Number(((total.h + total.bb + total.hp) / den).toFixed(3)) : 0
  const tb = total.h + total.d + 2 * total.t + 3 * total.hr
  total.slg = total.ab ? Number((tb / total.ab).toFixed(3)) : 0
  total.ops = Number((total.obp + total.slg).toFixed(3))
  return total
}

export function combinePitching(lines: PitchingSeason[]): PitchingSeason | null {
  if (!lines.length) return null
  if (lines.length === 1) return lines[0]
  const total = lines.reduce(
    (acc, l) => ({
      ...acc,
      g: acc.g + l.g,
      gs: acc.gs + l.gs,
      w: acc.w + l.w,
      l: acc.l + l.l,
      sv: acc.sv + l.sv,
      ip: acc.ip + l.ip,
      h: acc.h + l.h,
      r: acc.r + l.r,
      er: acc.er + l.er,
      bb: acc.bb + l.bb,
      k: acc.k + l.k,
      hr: acc.hr + l.hr,
      bf: acc.bf + l.bf,
      war: acc.war + l.war,
    }),
    { ...lines[0], g: 0, gs: 0, w: 0, l: 0, sv: 0, ip: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, bf: 0, war: 0 },
  )
  const exact = lines.every((line) => line.outs !== undefined && Number.isSafeInteger(line.outs) && line.outs >= 0 && !line.ipMissing)
  if (exact) {
    total.outs = lines.reduce((sum, line) => sum + line.outs!, 0)
    total.ip = total.outs / 3
  } else {
    delete total.outs
  }
  if (lines.some((line) => line.ipMissing)) total.ipMissing = true
  else delete total.ipMissing
  total.era = total.ip ? Number(((total.er * 9) / total.ip).toFixed(2)) : 0
  total.whip = total.ip ? Number(((total.h + total.bb) / total.ip).toFixed(2)) : 0
  total.k9 = total.ip ? Number(((total.k * 9) / total.ip).toFixed(1)) : 0
  return total
}

/** Pass meta.mlbLeagueId from the loaded bundle; never consult server environment in the browser. */
export function pitcherLine(player: PlayerDetail, leagueId: number): PitchingSeason | null {
  return combinePitching(player.pitching.filter((l) => l.leagueId === leagueId))
}

export function batterLine(player: PlayerDetail, leagueId: number): BattingSeason | null {
  return combineBatting(player.batting.filter((l) => l.leagueId === leagueId))
}

export function initials(team: Team): string {
  return team.abbr.slice(0, 3).toUpperCase()
}

/** Contrast-safe text color for a team's background swatch. */
export function readableOn(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0f1b2a' : '#ffffff'
}
