import type { BattingSeason, PitchingSeason, Prospect, ProspectComp, ProspectComps, Team } from '../../src/lib/types'
import { normalizeBnnName, type BnnEntry } from './bnn'

export interface RatingRow {
  playerId: number
  kind: 'bat' | 'pit'
  current: number
  potential: number
  tools: Record<string, number>
  potentialTools: Record<string, number>
}

export interface SeasonLine {
  playerId: number
  leagueAbbr: string
  g: number
  gs?: number
  /** False when the source lacked valid starts/appearances; do not infer a role. */
  usageKnown?: boolean
  avg?: number
  hr?: number
  rbi?: number
  w?: number
  l?: number
  era?: number
  ip?: number
  k?: number
}

/** Fill missing lines for verified MLB prospects from the current-season MLB stats already read.
 * Keep any existing line, and never attribute a previous club's stint to the current team. */
export function addMlbProspectLines(input: {
  lines: Map<number, SeasonLine>
  players: { id: number; teamId: number }[]
  ratings: Map<number, RatingRow>
  teams: Map<number, Team>
  bnnMatches: Map<number, BnnEntry>
  batting: Map<number, BattingSeason[]>
  pitching: Map<number, PitchingSeason[]>
  leagues: Map<number, string>
  invalidPitchingUsage?: Set<number>
}): Map<number, SeasonLine> {
  const lines = new Map(input.lines)
  for (const player of input.players) {
    const team = input.teams.get(player.teamId)
    if (!input.bnnMatches.has(player.id) || team?.level !== 1 || lines.has(player.id)) continue
    const kind = input.ratings.get(player.id)?.kind
    // A player may have multiple MLB stints; choose the latest one for his current club only.
    const currentTeam = <T extends { teamId: number; leagueId: number; stint: number }>(rows: T[]): T | undefined =>
      rows.filter((row) => row.teamId === team.id && row.leagueId === team.leagueId)
        .sort((a, b) => b.stint - a.stint)[0]
    if (kind === 'bat') {
      const line = currentTeam(input.batting.get(player.id) ?? [])
      if (line) lines.set(player.id, {
        playerId: player.id, leagueAbbr: input.leagues.get(line.leagueId) ?? '',
        g: line.g, avg: line.avg, hr: line.hr, rbi: line.rbi,
      })
    } else if (kind === 'pit') {
      const line = currentTeam(input.pitching.get(player.id) ?? [])
      if (line) lines.set(player.id, {
        playerId: player.id, leagueAbbr: input.leagues.get(line.leagueId) ?? '',
        g: line.g, gs: line.gs, w: line.w, l: line.l, era: line.era, ip: line.ip, k: line.k,
        ...(input.invalidPitchingUsage?.has(player.id) ? { usageKnown: false } : {}),
      })
    }
  }
  return lines
}

/** Exact positions for hitters, actual usage roles for established pitchers. */
export type PositionGroup = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'SP' | 'RP'
export type Handedness = 'L' | 'R' | 'S'

/** Accept only recorded hands. In particular, an unknown OOTP code must not become R. */
export function knownHand(value: unknown, allowSwitch = false): Handedness | null {
  const hand = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (hand === '1' || hand === 'R') return 'R'
  if (hand === '2' || hand === 'L') return 'L'
  if (allowSwitch && (hand === '3' || hand === 'S' || hand === 'B')) return 'S'
  return null
}

/** Require the same recorded hand, including switch vs switch. Unknown never matches. */
function compatibleHand(a: Handedness | null, b: Handedness | null): boolean {
  return !!a && !!b && a === b
}

/** Baseball age is age on June 30; no month/day means no reliable historical age. */
export function baseballAge(year: number, birthYear: number, month: number, day: number): number | null {
  if (![year, birthYear, month, day].every(Number.isInteger) || birthYear < 1800 || birthYear > year ||
      month < 1 || month > 12 || day < 1 || day > 31) return null
  const birth = new Date(Date.UTC(birthYear, month - 1, day))
  if (birth.getUTCFullYear() !== birthYear || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return null
  return year - birthYear - (month > 6 ? 1 : 0)
}

/** Compare a projected future major-league season within the broad age-20–29 career window,
 * not a prospect's current age to a veteran. Unknown or implausible ages cannot match. */
function plausibleAge(prospectAge: number, candidateAge: number | null): boolean {
  if (!Number.isFinite(prospectAge) || prospectAge < 16 || prospectAge > 40 ||
      candidateAge === null || !Number.isFinite(candidateAge)) return false
  return candidateAge >= 20 && candidateAge <= 29
}

// Full-season floors use plate appearances, not an extra AB requirement that penalizes walks.
export const MIN_BATTER_PA = 450
export const MIN_POSITION_GAMES = 80
export const MIN_POSITION_SHARE = 0.6
export const MIN_STARTER_IP = 100
export const MIN_RELIEF_IP = 40
export const MIN_RELIEF_G = 25

/** Partial-season floors scale with team games so a 60-PA bench stint in September is not treated
 * like an everyday player. Return null rather than guess when the team's schedule is unknown. */
export function currentUsageFloors(teamGames: number): { pa: number; positionGames: number; starterIp: number; relieverIp: number } | null {
  if (!Number.isFinite(teamGames) || teamGames <= 0) return null
  return {
    pa: Math.max(60, Math.ceil(teamGames * 2)),
    positionGames: Math.max(10, Math.ceil(teamGames * 0.35)),
    starterIp: Math.max(20, teamGames * 0.75),
    relieverIp: Math.max(8, teamGames * 0.3),
  }
}

/** A current major leaguer, carrying the same 20–80 tool grades the prospects are rated on. */
export interface PeerPlayer {
  id: number
  name: string
  positionCode: number
  tools: Record<string, number>
  age: number | null
  bats: Handedness | null
  throws: Handedness | null
  /** Games started and games pitched this season, used to tell starters from relievers. */
  gs: number
  g: number
}

/** One past MLB season: the raw counting stats are enough to describe the shape of the year. */
export interface HistoricalSeason {
  playerId: number
  /** Stable identity of the player-season. OOTP seasons use `${playerId}|${year}`, Lahman
   *  seasons `${playerID}|${yearID}` prefixed by their source, so the two can never collide. */
  key: string
  name: string
  year: number
  positionCode: number
  pitcher: boolean
  hasProfile: boolean
  /** Age on June 30 of that season, not the player's present age. */
  age: number | null
  bats: Handedness | null
  throws: Handedness | null
  /** Where the season came from. The save's own history always wins a tie against Lahman. */
  source: 'save' | 'lahman'
  bat?: { ab: number; h: number; d: number; t: number; hr: number; bb: number; k: number; sb: number; pa: number; g: number; positionGames: number }
  pit?: { ip: number; bf: number; bb: number; k: number; hr: number; gs: number; g: number }
}

interface Input {
  players: {
    id: number
    firstName: string
    lastName: string
    age: number
    position: string
    positionCode: number
    teamId: number
    nation: string
    bats: string
    throws: string
    /** Raw-feed validated hands; explicitly null means unknown (do not use displayed defaults). */
    compBats?: Handedness | null
    compThrows?: Handedness | null
  }[]
  ratings: Map<number, RatingRow>
  teams: Map<number, Team>
  orgOf: (teamId: number) => number
  lines: Map<number, SeasonLine>
  leagues: Map<number, string>
  mlbGames: Map<number, number>
  /** Current major leaguers, the pool the single current comp is drawn from. */
  peers?: PeerPlayer[]
  /** Every qualifying MLB season in the save's history, for the historical comp. */
  historical?: HistoricalSeason[]
  /** Seasons from outside the save (the Lahman database), widening the same historical pool. */
  externalHistory?: HistoricalSeason[]
  season?: number
  gameRatings?: Record<string, [number, number]>
  /** Already name/age/role-verified matches, never raw report IDs. */
  bnnMatches?: Map<number, BnnEntry>
  limit?: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Official order first, then the same computed-grade fallback, deterministically. */
export function compareProspects(a: Prospect, b: Prospect): number {
  return (a.bnnRank ?? Infinity) - (b.bnnRank ?? Infinity) ||
    b.score - a.score || a.name.localeCompare(b.name) || a.id - b.id
}

// ---------------------------------------------------------------- similarity engine

/**
 * One axis of a player's profile. The same dimension describes a tool grade and the rate stat a
 * historical season produced, which is what lets a 2027 prospect and a 1998 season share a space.
 */
interface Dimension {
  key: string
  /** How a positive difference reads in the comp's reason line. */
  above: string
  /** How a negative difference reads. */
  below: string
  weight: number
  /** The historical rate statistic this dimension is measured by. */
  metric: string
  /** Lower is better: strikeouts, walks, home runs allowed. */
  invert?: boolean
  /** Percentile this dimension inside its position group instead of the whole league. */
  groupCohort?: boolean
}

const BATTING_DIMENSIONS: Dimension[] = [
  { key: 'contact', above: 'more contact', below: 'less contact', weight: 0.2, metric: 'avg' },
  { key: 'power', above: 'more power', below: 'less power', weight: 0.22, metric: 'iso' },
  { key: 'gap', above: 'more gap power', below: 'less gap power', weight: 0.08, metric: 'gapRate' },
  { key: 'eye', above: 'more patience', below: 'less patience', weight: 0.15, metric: 'bbRate' },
  { key: 'avoidK', above: 'fewer strikeouts', below: 'more strikeouts', weight: 0.09, metric: 'kRate', invert: true },
  { key: 'speed', above: 'more speed', below: 'less speed', weight: 0.13, metric: 'sbRate' },
  { key: 'defense', above: 'a better glove', below: 'a lesser glove', weight: 0.13, metric: 'defense' },
]

const PITCHING_DIMENSIONS: Dimension[] = [
  { key: 'stuff', above: 'more stuff', below: 'less stuff', weight: 0.34, metric: 'kRate' },
  { key: 'movement', above: 'more movement', below: 'flatter stuff', weight: 0.26, metric: 'hrRate', invert: true },
  { key: 'control', above: 'better command', below: 'worse command', weight: 0.28, metric: 'bbRate', invert: true },
  { key: 'stamina', above: 'more stamina', below: 'less stamina', weight: 0.12, metric: 'workload', groupCohort: true },
]

const dimsFor = (pitcher: boolean): Dimension[] => (pitcher ? PITCHING_DIMENSIONS : BATTING_DIMENSIONS)

/** Similarity drops one point per 0.87 percentile point of weighted distance. */
const DISTANCE_FALLOFF = 1.15
/** Below this a "comp" is noise rather than a comparison. */
const MIN_CURRENT_SIMILARITY = 60
const MIN_HISTORICAL_SIMILARITY = 78
/** A difference smaller than this is not worth putting in a sentence. */
const REASON_THRESHOLD = 5

/**
 * Scouting grades run 20–80 around a 50 average. Mapping a grade onto the 0–100 percentile space
 * the historical seasons are ranked in keeps both kinds of comp on one scale: 1.5 percentile
 * points per grade point, clamped.
 */
const gradeToPercentile = (grade: number): number => Math.max(0, Math.min(100, 5 + (grade - 20) * 1.5))

/** OOTP position codes → exact comparison position; PH/PR and unknown are not DH. */
export function positionGroupOf(positionCode: number): PositionGroup | null {
  return ({ 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' } as Record<number, PositionGroup>)[positionCode] ?? null
}

/** Established usage only: mixed swingmen and insufficient or invalid samples are unknown. */
export function pitchingGroup(gs: number, g: number): PositionGroup | null {
  if (!Number.isFinite(g) || !Number.isFinite(gs) || g < 5 || gs < 0 || gs > g) return null
  if (gs / g >= 0.6) return 'SP'
  if (gs / g <= 0.15) return 'RP'
  return null
}

/** Prospect role uses actual usage if established; only unestablished prospects use stamina. */
export function groupFor(positionCode: number, pitcher: boolean, stamina: number, gs?: number, g?: number): PositionGroup | null {
  if (!pitcher) return positionGroupOf(positionCode)
  if (g !== undefined && (!Number.isFinite(g) || g < 0 || (g >= 5 && gs === undefined))) return null
  if ((g ?? 0) >= 5) return pitchingGroup(gs!, g!)
  if (!Number.isFinite(stamina) || stamina <= 0 || stamina > 80) return null
  return stamina >= 45 ? 'SP' : 'RP'
}

interface Candidate {
  id: number
  /** Unique within its own pool (a player-season in history, a player in current). */
  key: string
  name: string
  year?: number
  hasProfile: boolean
  age: number | null
  hand: Handedness | null
  /** 0 for anything the save produced (a current major leaguer, a season of its own history),
   *  1 for an imported Lahman season. Breaks similarity ties in the save's favour. */
  sourceRank: number
  vector: Record<string, number>
}

/** A candidate and how closely he matches the prospect doing the looking. */
interface CandidateScore {
  candidate: Candidate
  similarity: number
}

/** One prospect's candidates, ordered best first. Built for everyone, then claimed globally. */
interface CompLadder {
  prospectId: number
  rows: CandidateScore[]
}

/** Percentile lookup for one metric inside one season (or season + role) cohort. */
function percentileOf(values: number[]): (value: number) => number {
  const sorted = [...values].sort((a, b) => a - b)
  return (value: number) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < value) lo = mid + 1
      else hi = mid
    }
    let end = lo
    while (end < sorted.length && sorted[end] === value) end++
    return (100 * (lo + (end - lo) / 2)) / sorted.length
  }
}

/** Rate stats that describe what kind of season a player had, independent of era and park. */
function seasonMetrics(season: HistoricalSeason): Record<string, number> {
  if (season.pit) {
    const p = season.pit
    const bf = p.bf
    return {
      ...(bf > 0 ? { kRate: p.k / bf, bbRate: p.bb / bf, hrRate: p.hr / bf } : {}),
      // Stamina is how much of a game he was asked to pitch: share of starts (what separates a
      // rotation arm from a bullpen arm) plus innings per appearance against a nine-inning game
      // (what separates a workhorse from a five-and-dive starter). Both parts are scale-free, so
      // an OOTP season and a Lahman season sit on the same axis.
      workload: p.g ? 0.5 * (p.gs / p.g) + 0.5 * Math.min(1, p.ip / p.g / 9) : 0,
    }
  }
  const b = season.bat
  if (!b) return {}
  return {
    avg: b.ab ? b.h / b.ab : 0,
    // SLG − AVG, the extra bases a hit is worth beyond a single.
    iso: b.ab ? (b.d + 2 * b.t + 3 * b.hr) / b.ab : 0,
    // Gap power is the doubles-and-triples rate on its own: a line-drive hitter's signature.
    gapRate: b.ab ? (b.d + b.t) / b.ab : 0,
    bbRate: b.pa ? b.bb / b.pa : 0,
    kRate: b.pa ? b.k / b.pa : 0,
    sbRate: b.pa ? b.sb / b.pa : 0,
  }
}

/** Qualify sources uniformly before pooling: no bench player or unproven position/role. */
function historicalGroup(season: HistoricalSeason): PositionGroup | null {
  if (season.pitcher) {
    const p = season.pit
    if (!p || ![p.ip, p.bf, p.bb, p.k, p.hr, p.gs, p.g].every((n) => Number.isFinite(n) && n >= 0) || p.bf <= 0) return null
    const role = pitchingGroup(p.gs, p.g)
    if (role === 'SP' && p.ip >= MIN_STARTER_IP) return role
    if (role === 'RP' && p.ip >= MIN_RELIEF_IP && p.g >= MIN_RELIEF_G) return role
    return null
  }
  const b = season.bat
  const group = positionGroupOf(season.positionCode)
  if (!b || !group || ![b.ab, b.h, b.d, b.t, b.hr, b.bb, b.k, b.sb, b.pa, b.g, b.positionGames]
    .every((n) => Number.isFinite(n) && n >= 0)) return null
  if (b.ab <= 0 || b.pa < MIN_BATTER_PA || b.g <= 0 || b.positionGames > b.g ||
      b.positionGames < MIN_POSITION_GAMES || b.positionGames / b.g < MIN_POSITION_SHARE) return null
  return group
}

/** Rank qualified seasons against their own year to compare rate shapes across eras. */
function historicalCandidates(seasons: HistoricalSeason[], pitcher: boolean): Map<PositionGroup, Candidate[]> {
  const dims = dimsFor(pitcher)
  const rows = seasons
    .filter((s) => s.pitcher === pitcher)
    .map((s) => ({ season: s, group: historicalGroup(s), metrics: seasonMetrics(s) }))
    .filter((row): row is typeof row & { group: PositionGroup } => row.group !== null && Object.keys(row.metrics).length > 0)

  // cohort key → metric → fine-grained percentile lookup
  const cohorts = new Map<string, Map<string, (value: number) => number>>()
  for (const dim of dims) {
    const buckets = new Map<string, number[]>()
    for (const row of rows) {
      const value = row.metrics[dim.metric]
      if (value === undefined) continue
      const key = dim.groupCohort ? `${row.season.year}|${row.group}` : String(row.season.year)
      const list = buckets.get(key) ?? []
      list.push(value)
      buckets.set(key, list)
    }
    const lookup = new Map<string, (value: number) => number>()
    for (const [key, values] of buckets) if (values.length >= 10) lookup.set(key, percentileOf(values))
    cohorts.set(dim.key, lookup)
  }

  const byGroup = new Map<PositionGroup, Candidate[]>()
  for (const row of rows) {
    const group = row.group
    const vector: Record<string, number> = {}
    for (const dim of dims) {
      const lookup = cohorts.get(dim.key)?.get(dim.groupCohort ? `${row.season.year}|${group}` : String(row.season.year))
      const value = row.metrics[dim.metric]
      if (!lookup || value === undefined) continue
      const pct = lookup(value)
      vector[dim.key] = dim.invert ? 100 - pct : pct
    }
    if (Object.keys(vector).length < 3) continue
    const list = byGroup.get(group) ?? []
    list.push({
      id: row.season.playerId,
      key: row.season.source === 'lahman' ? `lahman:${row.season.key}` : row.season.key,
      name: row.season.name,
      year: row.season.year,
      hasProfile: row.season.hasProfile,
      age: row.season.age,
      hand: pitcher ? knownHand(row.season.throws) : knownHand(row.season.bats, true),
      sourceRank: row.season.source === 'lahman' ? 1 : 0,
      vector,
    })
    byGroup.set(group, list)
  }
  return byGroup
}

/** Current major leaguers, converted from tool grades into the same percentile space. */
function peerCandidates(peers: PeerPlayer[]): Map<PositionGroup, Candidate[]> {
  const byGroup = new Map<PositionGroup, Candidate[]>()
  for (const peer of peers) {
    const pitcher = peer.positionCode === 1
    const dims = dimsFor(pitcher)
    const group = pitcher ? pitchingGroup(peer.gs, peer.g) : positionGroupOf(peer.positionCode)
    if (!group) continue
    const vector: Record<string, number> = {}
    for (const dim of dims) {
      const grade = peer.tools[dim.key]
      if (!Number.isFinite(grade) || grade < 20 || grade > 100) continue
      vector[dim.key] = gradeToPercentile(grade)
    }
    if (Object.keys(vector).length < 3) continue
    const list = byGroup.get(group) ?? []
    list.push({ id: peer.id, key: `${peer.id}|0`, name: peer.name, hasProfile: true, age: peer.age,
      hand: pitcher ? knownHand(peer.throws) : knownHand(peer.bats, true), sourceRank: 0, vector })
    byGroup.set(group, list)
  }
  return byGroup
}

/** The prospect's own profile: potential tools, which is the player he is projected to become. */
function prospectVector(pitcher: boolean, tools: Record<string, number>): Record<string, number> {
  const vector: Record<string, number> = {}
  for (const dim of dimsFor(pitcher)) {
    const grade = tools[dim.key]
    if (!Number.isFinite(grade) || grade < 20 || grade > 100) continue
    vector[dim.key] = gradeToPercentile(grade)
  }
  return vector
}

/** Weighted Euclidean distance over the shared dimensions, expressed as 0–100 similarity. */
function similarity(a: Record<string, number>, b: Record<string, number>, dims: Dimension[]): number {
  // A close result on only secondary tools is not enough to describe a player.
  const core = dims === BATTING_DIMENSIONS ? ['contact', 'power', 'eye'] : ['stuff', 'movement', 'control']
  if (!core.every((key) => a[key] !== undefined && b[key] !== undefined)) return 0
  let sum = 0
  let weight = 0
  let shared = 0
  for (const dim of dims) {
    const av = a[dim.key]
    const bv = b[dim.key]
    if (av === undefined || bv === undefined) continue
    sum += dim.weight * (av - bv) ** 2
    weight += dim.weight
    shared++
  }
  if (!weight || shared < (dims === BATTING_DIMENSIONS ? 4 : 3)) return 0
  const distance = Math.sqrt(sum / weight)
  return Math.max(0, Math.min(100, Math.round(100 - distance * DISTANCE_FALLOFF)))
}

/**
 * The reason line is the two widest gaps in the profile, in scouting language:
 * "more power, less contact". Two equal profiles get a plain statement instead.
 */
function reasonFor(a: Record<string, number>, b: Record<string, number>, dims: Dimension[]): string {
  const gaps: { dim: Dimension; gap: number }[] = []
  for (const dim of dims) {
    const av = a[dim.key]
    const bv = b[dim.key]
    if (av === undefined || bv === undefined) continue
    gaps.push({ dim, gap: av - bv })
  }
  gaps.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))
  const picked = gaps.filter((g) => Math.abs(g.gap) >= REASON_THRESHOLD).slice(0, 2)
  if (!picked.length) return 'similar shape across available measures'
  return picked.map((g) => (g.gap > 0 ? g.dim.above : g.dim.below)).join(', ')
}

/**
 * Precomputed comparison pools. Built once per import so the board can ship finished comps:
 * the browser never runs a distance calculation of its own.
 */
export interface ComparisonPool {
  peers: Map<PositionGroup, Candidate[]>
  history: Map<PositionGroup, Candidate[]>
}

/**
 * The merged pool. The save's own history comes first: when Lahman describes the same player in
 * the same year (the save is a replay of the same careers), the in-universe season is the one the
 * board shows, so the imported duplicate is dropped before anything is ranked. That also keeps a
 * claim key honest — two rows with one name and year would read as a duplicate comp.
 */
export function buildComparisonPool(input: {
  peers: PeerPlayer[]
  historical: HistoricalSeason[]
  external?: HistoricalSeason[]
}): ComparisonPool {
  const norm = (name: string): string => name.toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '')
  // An unusable save row must not hide a useful Lahman player-season.
  const qualifiedSave = input.historical.filter((season) => historicalGroup(season) && season.age !== null && Number.isFinite(season.age) &&
    knownHand(season.pitcher ? season.throws : season.bats, !season.pitcher) !== null)
  const seen = new Set(qualifiedSave.map((season) => `${norm(season.name)}|${season.year}`))
  const external = (input.external ?? []).filter((season) => {
    const key = `${norm(season.name)}|${season.year}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const merged = [...qualifiedSave, ...external]
  const battingHistory = historicalCandidates(merged, false)
  const pitchingHistory = historicalCandidates(merged, true)
  const history = new Map<PositionGroup, Candidate[]>()
  for (const [group, list] of battingHistory) history.set(group, list)
  for (const [group, list] of pitchingHistory) history.set(group, list)
  return { peers: peerCandidates(input.peers), history }
}

/**
 * Every candidate this prospect could be compared to, best first. Similarity ties break on name,
 * then id, so two imports of the same export always produce the same board.
 */
function rankCandidates(
  vector: Record<string, number>,
  candidates: Candidate[],
  dims: Dimension[],
  floor: number,
): CandidateScore[] {
  const rows: CandidateScore[] = []
  for (const candidate of candidates) {
    const score = similarity(vector, candidate.vector, dims)
    if (score >= floor) rows.push({ candidate, similarity: score })
  }
  return rows.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      a.candidate.sourceRank - b.candidate.sourceRank ||
      a.candidate.name.localeCompare(b.candidate.name) ||
      a.candidate.id - b.candidate.id ||
      (a.candidate.year ?? 0) - (b.candidate.year ?? 0),
  )
}

/**
 * One comp per prospect, and one prospect per comp.
 *
 * Ladders are claimed in a single global pass, strongest match first: the prospect whose best
 * candidate fits him most closely picks first, and whatever he takes is gone for good. That
 * ordering is the whole point — the board's best prospects get their true closest match, and a
 * distinctive player is never recycled as the comp for a dozen similar farmhands. A prospect
 * whose whole ladder is already spoken for simply goes without a comp rather than borrowing one.
 */
function claimUnique(
  ladders: CompLadder[],
  keyOf: (candidate: Candidate) => string,
): Map<number, CandidateScore> {
  const claimed = new Set<string>()
  const assigned = new Map<number, CandidateScore>()
  const order = ladders
    .filter((ladder) => ladder.rows.length > 0)
    .sort((a, b) => b.rows[0].similarity - a.rows[0].similarity || a.prospectId - b.prospectId)
  for (const ladder of order) {
    for (const row of ladder.rows) {
      const key = keyOf(row.candidate)
      if (claimed.has(key)) continue
      claimed.add(key)
      assigned.set(ladder.prospectId, row)
      break
    }
  }
  return assigned
}

/** The payload shape of one claimed comp, with the reason line derived from it. */
function toComp(
  row: CandidateScore,
  kind: 'current' | 'historical',
  vector: Record<string, number>,
  dims: Dimension[],
): ProspectComp {
  return {
    playerId: row.candidate.id,
    playerName: row.candidate.name,
    similarity: row.similarity,
    kind,
    ...(kind === 'historical' ? { year: row.candidate.year } : {}),
    reason: reasonFor(vector, row.candidate.vector, dims) +
      (kind === 'historical' && dims === BATTING_DIMENSIONS ? '; batting rates only, defense not measured' : '') +
      '; heuristic shape index, not a forecast',
    hasProfile: row.candidate.hasProfile,
  }
}

/**
 * Prospect ranking is an explicit, documented formula rather than an opaque number: weighted
 * potential tools, with a small age bonus for young players at higher levels.
 */
export function buildProspects(input: Input): Prospect[] {
  const {
    players,
    ratings,
    teams,
    orgOf,
    lines,
    leagues,
    mlbGames,
    peers = [],
    historical = [],
    externalHistory = [],
    season = 0,
    gameRatings = {},
    bnnMatches = new Map(),
    limit = 400,
  } = input

  const rows: Prospect[] = []
  // The profile behind each row: the position group he is compared inside of and his vector in
  // that group's space. Kept beside the payload so the comp pass never re-derives it.
  const profiles = new Map<number, { group: PositionGroup | null; dims: Dimension[]; vector: Record<string, number>; hand: Handedness | null }>()
  for (const player of players) {
    const bnn = bnnMatches.get(player.id)
    const rating = ratings.get(player.id)
    if (!rating) continue
    const team = teams.get(player.teamId)
    if (!team || (!bnn && team.level <= 1)) continue
    // Verified BNN entries use the report's eligibility, including those already in MLB. This is
    // a dated snapshot, not a claim that the player is still rookie-eligible at the CSV date.
    // 100 career MLB games is well past rookie eligibility: that is a veteran on assignment.
    if (!bnn && (mlbGames.get(player.id) ?? 0) >= 100) continue
    if (!bnn && player.age > 27) continue

    // Keep complete rows' ranking unchanged, but never produce NaN from missing/bad attributes.
    const tools = Object.fromEntries(Object.entries(rating.potentialTools ?? {}).filter(([, value]) =>
      Number.isFinite(value) && value >= 0))
    const weights = rating.kind === 'bat'
      ? { contact: 0.32, power: 0.3, eye: 0.22, gap: 0.16 }
      : { stuff: 0.45, movement: 0.3, control: 0.25 }
    const grade = Object.entries(weights).reduce((sum, [key, weight]) => sum + (tools[key] ?? 0) * (weight ?? 0), 0)

    const ageBonus = player.age >= 16 && player.age <= 20 ? 4 : player.age <= 22 && player.age >= 16 ? 2.5 :
      player.age <= 24 && player.age >= 16 ? 1 : 0
    // OOTP uses 1 for MLB, 2 for Triple-A and 6 for rookie ball: smaller numbers are higher.
    // Reward readiness at higher levels rather than giving rookie ball the largest bonus.
    const levelBonus = Math.min(5, Math.max(0, (6 - team.level) * 0.9))
    const score = grade + ageBonus + levelBonus * 0.4

    const orgId = orgOf(player.teamId)
    const org = teams.get(orgId)
    // Only affiliated minor leaguers: a college or independent club has no MLB parent, which
    // would otherwise rank 19-year-old NCAA hitters against Triple-A call-ups.
    if (!org || org.level !== 1) continue
    const line = lines.get(player.id)
    const pitcher = rating.kind === 'pit'
    const stamina = tools.stamina || rating.tools?.stamina || 0
    profiles.set(player.id, {
      group: pitcher && line?.usageKnown === false ? null : groupFor(player.positionCode, pitcher, stamina, line?.gs, line?.g),
      dims: dimsFor(pitcher),
      vector: prospectVector(pitcher, tools),
      hand: pitcher
        ? knownHand(player.compThrows === undefined ? player.throws : player.compThrows)
        : knownHand(player.compBats === undefined ? player.bats : player.compBats, true),
    })

    rows.push({
      rank: 0,
      bnnRank: bnn?.rank ?? null,
      bnnPosition: bnn?.position ?? null,
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
      age: player.age,
      position: player.position,
      role: rating.kind === 'bat' ? 'Position player' : 'Pitcher',
      bats: player.bats,
      throws: player.throws,
      nation: player.nation,
      teamId: player.teamId,
      teamAbbr: team.abbr,
      leagueAbbr: leagues.get(team.leagueId) ?? '',
      level: team.level,
      orgId,
      orgAbbr: org?.abbr ?? '—',
      orgName: org ? `${org.city} ${org.nickname}` : 'Unaffiliated',
      current: gameRatings[String(player.id)]?.[0] ?? rating.current,
      potential: gameRatings[String(player.id)]?.[1] ?? rating.potential,
      score: round1(score),
      tools: rating.tools,
      potentialTools: tools,
      comps: { current: null, historical: null },
      stats: line
        ? {
            league: line.leagueAbbr,
            g: line.g,
            gs: line.gs,
            avg: line.avg,
            hr: line.hr,
            rbi: line.rbi,
            w: line.w,
            l: line.l,
            era: line.era,
            ip: line.ip,
            k: line.k,
          }
        : null,
    })
  }

  const ranked = rows
    // The official entries lead in their exact source order. All other prospects use the weighted
    // computed grade (score); no official rank is invented for the fallback.
    .sort(compareProspects)
    // Never lose a verified, otherwise eligible official entry to a smaller grade-based cutoff.
    .slice(0, Math.max(0, limit, rows.filter((row) => row.bnnRank != null).length))
    .map((row, i) => ({ ...row, rank: i + 1 }))

  // Comps are computed for the published board only, not for the thousands of players who
  // never make it into the payload — and each comp is handed out exactly once across the board.
  const pool = buildComparisonPool({ peers, historical, external: externalHistory })
  const currentLadders: CompLadder[] = []
  const historicalLadders: CompLadder[] = []
  for (const row of ranked) {
    const profile = profiles.get(row.id)
    if (!profile?.group || !profile.hand) continue
    // Save IDs and historical database IDs are from different namespaces. Conservatively
    // reject an exact normalized full-name match as well as an identical ID in either pool.
    const isDifferentPlayer = (candidate: Candidate) => candidate.id !== row.id &&
      normalizeBnnName(candidate.name) !== normalizeBnnName(row.name)
    currentLadders.push({
      prospectId: row.id,
      rows: rankCandidates(profile.vector, (pool.peers.get(profile.group) ?? []).filter((candidate) =>
        isDifferentPlayer(candidate) && compatibleHand(profile.hand, candidate.hand) && plausibleAge(row.age, candidate.age)),
        profile.dims, MIN_CURRENT_SIMILARITY),
    })
    // Candidate eligibility is separate from the per-year statistical-cohort minimum: a rare
    // switch-hitting shortstop can still match one qualified switch-hitting shortstop season.
    const seasons = (pool.history.get(profile.group) ?? []).filter((candidate) =>
      (candidate.year ?? 0) >= 1970 && (candidate.year ?? 0) < season &&
      isDifferentPlayer(candidate) && compatibleHand(profile.hand, candidate.hand) && plausibleAge(row.age, candidate.age))
    historicalLadders.push({
      prospectId: row.id,
      rows: rankCandidates(profile.vector, seasons, profile.dims, MIN_HISTORICAL_SIMILARITY),
    })
  }

  // Claims are independent: a prospect can receive one current and one historical comp.
  const currentClaims = claimUnique(currentLadders, (candidate) => candidate.key)
  const historicalClaims = claimUnique(historicalLadders, (candidate) => candidate.key)
  return ranked.map((row) => {
    const profile = profiles.get(row.id)
    if (!profile) return row
    const current = currentClaims.get(row.id)
    const historical = historicalClaims.get(row.id)
    const comps: ProspectComps = {
      modelVersion: 2,
      current: current ? toComp(current, 'current', profile.vector, profile.dims) : null,
      historical: historical ? toComp(historical, 'historical', profile.vector, profile.dims) : null,
    }
    return { ...row, comps }
  })
}
