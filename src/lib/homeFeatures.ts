import type { LeaderEntry, Leaders, NewsItem, Prospect } from './types'

export interface HomeFeature {
  playerId: number
  name: string
  teamId: number
  label: string
  headline: string
  summary: string
  stats: { label: string; value: string }[]
  href: string
  sourceLabel: string
  sourceNewsId?: string
}

export interface HomeFeatureSet {
  lead: HomeFeature | null
  stars: HomeFeature[]
}

type Side = 'batting' | 'pitching'
type Board = {
  side: Side
  key: string
  stat: string
  description: string
  title: string
  format: (value: number) => string
  rate?: boolean
}
type Fact = { board: Board; row: LeaderEntry; rank: number; tied: boolean }
type Candidate = { id: number; teamId: number; name: string; aliases: string[]; side: Side; facts: Fact[]; score: number }

const count = (value: number) => String(value)
const average = (value: number) => value.toFixed(3).replace(/^0/, '')
const decimal = (value: number) => value.toFixed(2)
const oneDecimal = (value: number) => value.toFixed(1)

// Board order is also the deterministic editorial preference, not an assertion of player fame.
const BOARDS: Board[] = [
  { side: 'batting', key: 'hr', stat: 'HR', description: 'home-run', title: 'Power at the plate', format: count },
  { side: 'batting', key: 'ops', stat: 'OPS', description: 'OPS', title: 'On-base and power', format: average, rate: true },
  { side: 'batting', key: 'rbi', stat: 'RBI', description: 'RBI', title: 'The RBI file', format: count },
  { side: 'batting', key: 'war', stat: 'Batting WAR', description: 'batting WAR', title: 'A season in focus', format: oneDecimal },
  { side: 'batting', key: 'avg', stat: 'AVG', description: 'batting-average', title: 'Contact in focus', format: average, rate: true },
  { side: 'batting', key: 'h', stat: 'H', description: 'hits', title: 'Hits in focus', format: count },
  { side: 'batting', key: 'sb', stat: 'SB', description: 'stolen-base', title: 'Speed on the bases', format: count },
  { side: 'batting', key: 'r', stat: 'R', description: 'runs', title: 'On the scorecard', format: count },
  { side: 'pitching', key: 'k', stat: 'K', description: 'pitching strikeout', title: 'Strikeout stuff', format: count },
  { side: 'pitching', key: 'era', stat: 'ERA', description: 'ERA', title: 'Run prevention in focus', format: decimal, rate: true },
  { side: 'pitching', key: 'whip', stat: 'WHIP', description: 'WHIP', title: 'Runners on the bases', format: decimal, rate: true },
  { side: 'pitching', key: 'sv', stat: 'SV', description: 'saves', title: 'Closing time', format: count },
  { side: 'pitching', key: 'war', stat: 'Pitching WAR', description: 'pitching WAR', title: 'A season on the mound', format: oneDecimal },
  { side: 'pitching', key: 'w', stat: 'W', description: 'pitching wins', title: 'The pitching ledger', format: count },
  { side: 'pitching', key: 'ip', stat: 'IP', description: 'innings-pitched', title: 'Innings on the mound', format: oneDecimal },
]

const goodId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const goodName = (value: unknown): value is string => typeof value === 'string' &&
  value.trim().length > 0 && !/^player\s+\d+$/i.test(value.trim())
const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ')
const nameKey = (value: string) => cleanName(value).toLowerCase()
const cmpText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const boardIndex = (board: Board) => BOARDS.indexOf(board)

function validValue(board: Board, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (board.key === 'war') return true
  if (value < 0) return false
  if (board.key === 'avg' && value > 1) return false
  if (board.key === 'ip') {
    // In the current, versioned exporter, .1 and .2 mean one and two outs, not tenths.
    const tenths = Math.round(value * 10)
    return Math.abs(value * 10 - tenths) < 1e-8 && tenths % 10 <= 2
  }
  return board.rate || Number.isSafeInteger(value)
}

function candidatesFrom(leaders: Leaders | null | undefined): Candidate[] {
  if (!leaders || typeof leaders !== 'object') return []
  const meta = (leaders as Leaders & { meta?: { qualificationVersion?: number } }).meta
  const hasOldMeta = meta != null && meta.qualificationVersion !== 1
  const versioned = meta?.qualificationVersion === 1
  const factsById = new Map<number, Fact[]>()
  const teamsById = new Map<number, Set<number>>()
  const valuesByBoard = new Map<Board, Map<number, Set<string>>>()

  for (const board of BOARDS) {
    // Old published exports explicitly predate rate qualification. Do not promote their rates.
    // With no metadata, the caller supplies the Leaders contract and its board qualification.
    if ((board.rate && hasOldMeta) || (board.key === 'ip' && !versioned)) continue
    const rows: unknown = leaders[board.side]?.[board.key]
    if (!Array.isArray(rows)) continue
    const usable: LeaderEntry[] = rows.filter((row: LeaderEntry | null) => !!row &&
      goodId(row.playerId) && goodId(row.teamId) && goodName(row.name) &&
      Number.isSafeInteger(row.rank) && row.rank > 0 && validValue(board, row.value))
    const valuesById = new Map<number, Set<string>>()
    for (const row of usable) {
      const values = valuesById.get(row.playerId) ?? new Set<string>()
      values.add(board.format(row.value))
      valuesById.set(row.playerId, values)
    }
    valuesByBoard.set(board, valuesById)
    // Older feeds can place a member of a tenth-place tie beyond rank 10. Unrelated lower
    // rows are not candidates and must not change the identity checks for top-ten players.
    const topValues = new Set(usable.filter((row) => row.rank <= 10).map((row) => board.format(row.value)))
    for (const row of usable.filter((item) => topValues.has(board.format(item.value)))) {
      const teams = teamsById.get(row.playerId) ?? new Set<number>()
      teams.add(row.teamId)
      teamsById.set(row.playerId, teams)
      const facts = factsById.get(row.playerId) ?? []
      facts.push({ board, row, rank: row.rank, tied: false })
      factsById.set(row.playerId, facts)
    }
  }

  const verified = new Map<number, { aliases: string[]; facts: Fact[] }>()
  for (const [id, allFacts] of factsById) {
    const aliases = [...new Set(allFacts.map((fact) => cleanName(fact.row.name)))].sort(cmpText)
    const unique: Fact[] = []
    for (const board of BOARDS) {
      const duplicates = allFacts.filter((fact) => fact.board === board)
      // Conflicting values for one player on one board are not a verifiable stat, even when
      // a conflicting row falls outside the top-ten or its displayed-value ties.
      if (!duplicates.length || valuesByBoard.get(board)?.get(id)?.size !== 1) continue
      const first = duplicates.sort((a, b) => a.rank - b.rank || cmpText(cleanName(a.row.name), cleanName(b.row.name)))[0]
      if (first) unique.push(first)
    }
    verified.set(id, { aliases, facts: unique })
  }

  for (const board of BOARDS) {
    // Some older feeds assigned different ranks to equal displayed values. Normalize to the
    // best published rank in that value group, counting each same-board-verified player once.
    // A conflicting club on another board does not invalidate this board's published value.
    const groups = new Map<string, { rank: number; ids: Set<number>; facts: Fact[] }>()
    for (const [id, player] of verified) {
      for (const fact of player.facts.filter((item) => item.board === board)) {
        const value = board.format(fact.row.value)
        const group = groups.get(value) ?? { rank: fact.rank, ids: new Set<number>(), facts: [] }
        group.rank = Math.min(group.rank, fact.rank)
        group.ids.add(id)
        group.facts.push(fact)
        groups.set(value, group)
      }
    }
    for (const group of groups.values()) {
      for (const fact of group.facts) {
        fact.rank = group.rank
        fact.tied = group.ids.size > 1
      }
    }
  }

  const result: Candidate[] = []
  for (const [id, player] of verified) {
    // Multiple clubs make the current identity/stint ambiguous: such a player may establish a
    // tie on a board but must not be featured or have potentially mismatched totals combined.
    if (teamsById.get(id)?.size !== 1) continue
    for (const side of ['batting', 'pitching'] as const) {
      // Retain the top-ten policy after normalization so an old rank-11 row tied with rank 10
      // is not lost merely because the older feed broke ties by row order.
      const unique = player.facts.filter((fact) => fact.board.side === side && fact.rank <= 10)
      // An all-zero board is common before play; don't turn it into a star or fake progress.
      if (!unique.some((fact) => fact.row.value > 0)) continue
      const canonical = [...unique].sort((a, b) => a.rank - b.rank || boardIndex(a.board) - boardIndex(b.board) ||
        cmpText(cleanName(a.row.name), cleanName(b.row.name)))[0]
      result.push({ id, teamId: canonical.row.teamId, name: cleanName(canonical.row.name), aliases: player.aliases,
        side, facts: unique, score: unique.reduce((sum, fact) => sum + Math.max(0, 11 - fact.rank), 0) })
    }
  }
  return result.sort((a, b) => b.score - a.score || a.id - b.id || cmpText(a.side, b.side))
}

function seasonFeature(candidate: Candidate, featured: Fact): HomeFeature {
  const facts = [featured, ...candidate.facts.filter((fact) => fact !== featured)
    .sort((a, b) => a.rank - b.rank || boardIndex(a.board) - boardIndex(b.board))].slice(0, 3)
  const value = featured.board.format(featured.row.value)
  return {
    playerId: candidate.id, name: candidate.name, teamId: candidate.teamId,
    label: candidate.side === 'batting' ? 'Hitter spotlight' : 'Pitcher spotlight',
    headline: `${candidate.name}: ${featured.board.title}`,
    summary: `${featured.tied ? 'Tied for No.' : 'No.'} ${featured.rank} on the MLB ${featured.board.description} leaderboard with ${value} ${featured.board.stat}.`,
    stats: facts.map((fact) => ({ label: fact.board.stat, value: fact.board.format(fact.row.value) })),
    href: `/players/${candidate.id}`, sourceLabel: 'MLB season leaderboards',
  }
}

function bestFact(candidate: Candidate): Fact {
  return [...candidate.facts].sort((a, b) => a.rank - b.rank || boardIndex(a.board) - boardIndex(b.board))[0]
}

// Parse dates as UTC calendar days and reject impossible dates, timestamps and future dates.
function day(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / 86400000 : null
}

type GameStory = { item: NewsItem; name: string; stats: { label: string; value: string }[]; headline: string }
function gameStory(item: NewsItem): GameStory | null {
  if (!item || !goodId(item.playerId) || !goodId(item.teamId) || item.link !== `/players/${item.playerId}` ||
      typeof item.headline !== 'string') return null
  // These two exact headline forms are produced from individual game lines. Do not use the
  // deck or undated season 'performance' headlines; those can contain unsupported claims.
  const performance = item.kind === 'performance' && /^(.+): (\d+) hits, (\d+) HR, (\d+) RBI$/.exec(item.headline)
  const power = item.kind === 'power' && /^(.+) goes deep (\d+) times$/.exec(item.headline)
  if (performance) {
    const [, rawName, hits, hr, rbi] = performance
    if (!goodName(rawName) || ![hits, hr, rbi].every((n) => Number.isSafeInteger(Number(n))) ||
        Number(hr) > Number(hits) || Number(hits) === 0) return null
    const name = cleanName(rawName)
    return { item, name, headline: `${name}: ${hits} ${Number(hits) === 1 ? 'hit' : 'hits'}, ${hr} HR, ${rbi} RBI`,
      stats: [{ label: 'H (game)', value: String(Number(hits)) }, { label: 'HR (game)', value: String(Number(hr)) },
        { label: 'RBI (game)', value: String(Number(rbi)) }] }
  }
  if (power) {
    const [, rawName, hr] = power
    if (!goodName(rawName) || !Number.isSafeInteger(Number(hr)) || Number(hr) <= 0) return null
    const name = cleanName(rawName)
    return { item, name, headline: `${name}: ${hr} ${Number(hr) === 1 ? 'home run' : 'home runs'} in a game`,
      stats: [{ label: 'HR (game)', value: String(Number(hr)) }] }
  }
  return null
}

function selectGameLead(news: NewsItem[], simDate: string, candidates: Candidate[]): HomeFeature | null {
  const today = day(simDate)
  if (today === null || !Array.isArray(news)) return null
  const dated = news.filter((item) => item && day(item.date) !== null && day(item.date)! <= today)
  const latest = Math.max(...dated.map((item) => day(item.date)!))
  // In this export simDate is normally the day after the most recent played games. A story
  // from earlier than yesterday, even if the newest one in the feed, is not a timely lead.
  if (!Number.isFinite(latest) || today - latest > 1) return null
  const stories = dated.filter((item) => day(item.date) === latest).map(gameStory)
    .filter((story): story is GameStory => story !== null)
    .map((story) => {
      const matching = candidates.find((c) => c.side === 'batting' && c.id === story.item.playerId &&
        c.teamId === story.item.teamId && c.aliases.some((alias) => nameKey(alias) === nameKey(story.name)))
      return { story, matching }
    })
    // With league leaders available, a recent story must actually involve a top-five board
    // player. Otherwise use a season leader instead of an unrelated daily box-score standout.
    // If the leader feed is absent, a strictly parsed player-linked game story stands alone.
    .filter(({ matching }) => candidates.length ? !!matching && matching.facts.some((fact) => fact.rank <= 5 && fact.row.value > 0) : true)
    .sort((a, b) => (b.matching?.score ?? 0) - (a.matching?.score ?? 0) ||
      a.story.item.playerId! - b.story.item.playerId! || cmpText(a.story.headline, b.story.headline))
  const chosen = stories[0]
  if (!chosen) return null
  const { story, matching } = chosen
  const name = matching?.name ?? story.name
  const headline = matching ? story.headline.replace(`${story.name}:`, `${name}:`) : story.headline
  return { playerId: story.item.playerId!, name, teamId: story.item.teamId!, label: 'Game spotlight', headline,
    summary: `${name}'s game line from ${story.item.date}.`, stats: story.stats,
    href: `/players/${story.item.playerId}`, sourceLabel: `Game performance · ${story.item.date}`, sourceNewsId: story.item.id }
}

function pickForSlot(candidates: Candidate[], side: Side, keys: string[], used: Set<number>): { candidate: Candidate; fact: Fact } | null {
  for (const key of keys) {
    const options = candidates.filter((candidate) => candidate.side === side && !used.has(candidate.id))
      .flatMap((candidate) => candidate.facts.filter((fact) => fact.board.key === key && fact.row.value > 0)
        .map((fact) => ({ candidate, fact })))
      .sort((a, b) => a.fact.rank - b.fact.rank || b.candidate.score - a.candidate.score || a.candidate.id - b.candidate.id)
    if (options.length) return options[0]
  }
  return null
}

/** Select an additive player lead and a mixed, data-backed set of league standouts. */
export function buildHomeFeatures(leaders: Leaders | null | undefined, news: NewsItem[], prospects: Prospect[], simDate: string): HomeFeatureSet {
  const candidates = candidatesFrom(leaders)
  const lead = selectGameLead(news, simDate, candidates) ?? (candidates[0] ? seasonFeature(candidates[0], bestFact(candidates[0])) : null)
  const used = new Set<number>(lead ? [lead.playerId] : [])
  const stars: HomeFeature[] = []
  const slots: { side: Side; keys: string[] }[] = [
    { side: 'batting', keys: ['hr', 'ops', 'rbi', 'war', 'avg', 'h', 'sb', 'r'] },
    { side: 'pitching', keys: ['k', 'era', 'whip', 'w', 'sv', 'war', 'ip'] },
    { side: 'batting', keys: ['sb', 'avg', 'h', 'ops', 'war', 'rbi', 'r', 'hr'] },
    { side: 'pitching', keys: ['sv', 'era', 'whip', 'war', 'k', 'w', 'ip'] },
  ]
  for (const slot of slots) {
    const pick = pickForSlot(candidates, slot.side, slot.keys, used)
    if (!pick) continue
    used.add(pick.candidate.id)
    stars.push(seasonFeature(pick.candidate, pick.fact))
  }
  // Fill vacant slots from either side when the feed is sparse.
  for (const candidate of candidates) {
    if (stars.length >= 4) break
    if (used.has(candidate.id)) continue
    used.add(candidate.id)
    stars.push(seasonFeature(candidate, bestFact(candidate)))
  }

  // A prospect is strictly additive: never replace any of the four major-league cards. The
  // board's published placement, not the separately dated BNN rank, is the only rank claimed.
  if (stars.length === 4 && Array.isArray(prospects)) {
    const eligible = prospects.filter((p) => p && goodId(p.id) && goodId(p.teamId) && goodName(p.name) &&
      Number.isSafeInteger(p.rank) && p.rank > 0 && !used.has(p.id) && !candidates.some((c) => c.id === p.id))
    // Conflicting teams for the same prospect do not establish a current club.
    const prospect = eligible.filter((p) => eligible.every((other) => other.id !== p.id || other.teamId === p.teamId))
      .sort((a, b) => a.rank - b.rank || a.id - b.id || cmpText(cleanName(a.name), cleanName(b.name)) || a.teamId - b.teamId)[0]
    if (prospect) {
      const name = cleanName(prospect.name)
      stars.push({ playerId: prospect.id, name, teamId: prospect.teamId, label: 'Prospect watch',
        headline: `${name}: Prospect watch`, summary: `No. ${prospect.rank} on the published prospect board.`,
        stats: [{ label: 'Board rank', value: `#${prospect.rank}` }], href: `/prospects/${prospect.id}`,
        sourceLabel: 'Prospect board' })
    }
  }
  return { lead, stars }
}
