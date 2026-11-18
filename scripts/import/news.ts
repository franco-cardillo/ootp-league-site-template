import type {
  BattingSeason,
  Division,
  Game,
  NewsItem,
  PitchingSeason,
  StandingRow,
  SubLeague,
  Team,
} from '../../src/lib/types'
import { MLB_LEAGUE_ID } from './schema'

export interface GameBatting {
  playerId: number
  gameId: number
  teamId: number
  h: number
  d: number
  t: number
  hr: number
  rbi: number
  r: number
}

interface Input {
  games: Game[]
  gameBatting: GameBatting[]
  standings: StandingRow[]
  divisions: Division[]
  subLeagues: SubLeague[]
  teams: Map<number, Team>
  names: Map<number, string>
  season: number
  mlbLeagueId?: number
  seasonBatting: { playerId: number; line: BattingSeason }[]
  seasonPitching: { playerId: number; line: PitchingSeason }[]
}

const totalBases = (b: GameBatting) => b.h + b.d + 2 * b.t + 3 * b.hr
const record = (r: StandingRow) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`

/** News uses recorded game results, standings, and current-season MLB totals. */
export function buildNews(input: Input): NewsItem[] {
  const { games, gameBatting, standings, divisions, subLeagues, teams, names, season, mlbLeagueId = MLB_LEAGUE_ID } = input
  const { seasonBatting, seasonPitching } = input
  const items: NewsItem[] = []
  const club = (id: number) => {
    const team = teams.get(id)
    return team ? `${team.city} ${team.nickname}` : 'Unknown club'
  }
  const abbr = (id: number) => teams.get(id)?.abbr ?? '—'
  const player = (id: number) => names.get(id) ?? `Player ${id}`

  const played = games.filter((g) => g.played)
  const dates = [...new Set(played.map((g) => g.date))].sort().reverse().slice(0, 4)
  const byGame = new Map<number, GameBatting[]>()
  for (const line of gameBatting) {
    const list = byGame.get(line.gameId) ?? []
    list.push(line)
    byGame.set(line.gameId, list)
  }

  let order = 0
  const push = (item: Omit<NewsItem, 'id' | 'rank'>) => {
    items.push({ ...item, id: `n${items.length + 1}`, rank: order++ })
  }

  for (const date of dates) {
    const today = played.filter((g) => g.date === date)

    // Biggest non-shutout blowout of the day; a shutout may have a wider margin.
    const blowout = [...today]
      .filter((g) => Math.min(g.homeScore, g.awayScore) > 0)
      .sort((a, b) => Math.abs(b.homeScore - b.awayScore) - Math.abs(a.homeScore - a.awayScore))[0]
    if (blowout && Math.abs(blowout.homeScore - blowout.awayScore) >= 5) {
      const homeWon = blowout.homeScore > blowout.awayScore
      const winnerId = homeWon ? blowout.homeTeamId : blowout.awayTeamId
      const loserId = homeWon ? blowout.awayTeamId : blowout.homeTeamId
      const high = Math.max(blowout.homeScore, blowout.awayScore)
      const low = Math.min(blowout.homeScore, blowout.awayScore)
      const winnerHits = homeWon ? blowout.homeHits : blowout.awayHits
      const loserHits = homeWon ? blowout.awayHits : blowout.homeHits
      push({
        kind: 'blowout',
        date,
        headline: `${club(winnerId)} rout ${club(loserId)} ${high}-${low}`,
        deck: `${abbr(winnerId)} had ${winnerHits} hits; ${abbr(loserId)} had ${loserHits}.`,
        teamId: winnerId,
        opponentTeamId: loserId,
        link: `/scores/${blowout.id}`,
        teamIds: [winnerId, loserId],
      })
    }

    // Match each batting line to its game and a participating club before describing an outcome.
    const dayLines = today.flatMap((game) => (byGame.get(game.id) ?? [])
      .filter((line) => line.teamId === game.homeTeamId || line.teamId === game.awayTeamId)
      .map((line) => ({ line, game })))
    const best = [...dayLines].sort((a, b) => totalBases(b.line) - totalBases(a.line) || b.line.rbi - a.line.rbi)[0]
    if (best && totalBases(best.line) >= 8) {
      const { line, game } = best
      const isHome = line.teamId === game.homeTeamId
      const teamScore = isHome ? game.homeScore : game.awayScore
      const opponentScore = isHome ? game.awayScore : game.homeScore
      const result = teamScore > opponentScore ? 'win' : teamScore < opponentScore ? 'loss' : 'tie'
      push({
        kind: 'performance',
        date,
        headline: `${player(line.playerId)}: ${line.h} hits, ${line.hr} HR, ${line.rbi} RBI`,
        deck: `${totalBases(line)} total bases, ${line.h} hits and ${line.r} runs for ${abbr(line.teamId)} in a ${teamScore}-${opponentScore} ${result}.`,
        playerId: line.playerId,
        teamId: line.teamId,
        link: `/players/${line.playerId}`,
        teamIds: [line.teamId],
      })
    }

    // Multi-homer games
    const bigPower = dayLines.filter(({ line }) => line.hr >= 3).sort((a, b) => b.line.hr - a.line.hr)[0]?.line
    if (bigPower) {
      push({
        kind: 'power',
        date,
        headline: `${player(bigPower.playerId)} goes deep ${bigPower.hr} times`,
        deck: `${bigPower.rbi} runs driven in for ${abbr(bigPower.teamId)}.`,
        playerId: bigPower.playerId,
        teamId: bigPower.teamId,
        link: `/players/${bigPower.playerId}`,
        teamIds: [bigPower.teamId],
      })
    }

    // Shutouts
    const shutout = today.find((g) =>
      Math.min(g.homeScore, g.awayScore) === 0 && Math.max(g.homeScore, g.awayScore) >= 3)
    if (shutout) {
      const homeWon = shutout.homeScore > shutout.awayScore
      const winnerId = homeWon ? shutout.homeTeamId : shutout.awayTeamId
      const loserId = homeWon ? shutout.awayTeamId : shutout.homeTeamId
      const hitsAllowed = homeWon ? shutout.awayHits : shutout.homeHits
      push({
        kind: 'shutout',
        date,
        headline: `${club(winnerId)} shut out ${club(loserId)}`,
        deck: `${Math.max(shutout.homeScore, shutout.awayScore)}-0, with ${hitsAllowed} ${hitsAllowed === 1 ? 'hit' : 'hits'} allowed.`,
        teamId: winnerId,
        opponentTeamId: loserId,
        link: `/scores/${shutout.id}`,
        teamIds: [winnerId, loserId],
      })
    }
  }

  // Current streak and record do not establish movement in the standings.
  const streaking = [...standings]
    .filter((r) => Math.abs(r.streak) >= 5)
    .sort((a, b) => Math.abs(b.streak) - Math.abs(a.streak))
    .slice(0, 3)
  for (const row of streaking) {
    const winning = row.streak > 0
    const subLeague = subLeagues.find((s) => s.leagueId === row.leagueId && s.id === row.subLeagueId)
    push({
      kind: 'streak',
      date: '',
      headline: `${club(row.teamId)} on a ${Math.abs(row.streak)}-game ${winning ? 'win' : 'losing'} streak`,
      deck: `${record(row)} on the season${subLeague?.abbr ? ` in the ${subLeague.abbr}` : ''}.`,
      teamId: row.teamId,
      link: `/teams/${row.teamId}`,
      teamIds: [row.teamId],
    })
  }

  // Compare the two best records using the same percentage ordering as the standings page.
  for (const division of divisions) {
    const rows = standings
      .filter((r) => r.leagueId === division.leagueId && r.subLeagueId === division.subLeagueId && r.divisionId === division.id)
      .sort((a, b) => b.pct - a.pct || b.w - a.w)
    if (rows.length < 2) continue
    const [first, second] = rows
    const gap = Math.abs((first.w - second.w + second.l - first.l) / 2)
    if (gap <= 2) {
      const comparison = gap === 0 ? 'even in games behind' : `separated by ${gap.toFixed(1)} ${gap === 1 ? 'game' : 'games'}`
      push({
        kind: 'race',
        date: '',
        headline: `${division.name}: ${abbr(first.teamId)} and ${abbr(second.teamId)} ${comparison}`,
        deck: `${abbr(first.teamId)} is ${record(first)}; ${abbr(second.teamId)} is ${record(second)}.`,
        teamId: first.teamId,
        opponentTeamId: second.teamId,
        link: '/standings',
        teamIds: [first.teamId, second.teamId],
      })
    }
  }

  // Counting stats cover every current-season MLB stint, not other years or minor leagues.
  type Totals = { playerId: number; hr: number; rbi: number; k: number; teamIds: Set<number> }
  const battingTotals = new Map<number, Totals>()
  const pitchingTotals = new Map<number, Totals>()
  const getTotal = (map: Map<number, Totals>, playerId: number): Totals => {
    let total = map.get(playerId)
    if (!total) {
      total = { playerId, hr: 0, rbi: 0, k: 0, teamIds: new Set() }
      map.set(playerId, total)
    }
    return total
  }
  for (const { playerId, line } of seasonBatting) {
    if (line.year !== season || line.leagueId !== mlbLeagueId) continue
    const total = getTotal(battingTotals, playerId)
    total.hr += line.hr
    total.rbi += line.rbi
    total.teamIds.add(line.teamId)
  }
  for (const { playerId, line } of seasonPitching) {
    if (line.year !== season || line.leagueId !== mlbLeagueId) continue
    const total = getTotal(pitchingTotals, playerId)
    total.k += line.k
    total.teamIds.add(line.teamId)
  }

  const seasonLeader = (totals: Map<number, Totals>, stat: 'hr' | 'rbi' | 'k', threshold: number, label: string) => {
    const board = [...totals.values()].sort((a, b) => b[stat] - a[stat] || a.playerId - b.playerId)
    const leader = board[0]
    if (!leader || leader[stat] < threshold) return
    const tied = board.filter((entry) => entry[stat] === leader[stat]).length
    const headline = tied > 1
      ? `${player(leader.playerId)} is tied for the MLB lead with ${leader[stat]} ${label}`
      : `${player(leader.playerId)} leads MLB with ${leader[stat]} ${label}`
    const deck = tied > 1
      ? `${tied} players share the MLB lead.`
      : board[1] ? `The next-highest MLB total is ${board[1][stat]}.` : 'Based on the available MLB season totals.'
    // A player's latest or current club cannot be inferred from arbitrary row order. Show all
    // known MLB stint clubs, but set a single primary team only when all rows name that club.
    const stintIds = [...leader.teamIds]
    const teamIds = stintIds.filter((id) => teams.get(id)?.leagueId === mlbLeagueId).sort((a, b) => a - b)
    const teamId = stintIds.length === 1 && teamIds.length === 1 ? teamIds[0] : undefined
    push({
      kind: 'performance',
      date: '',
      headline,
      deck,
      playerId: leader.playerId,
      ...(teamId === undefined ? {} : { teamId }),
      link: `/players/${leader.playerId}`,
      teamIds,
    })
  }
  seasonLeader(battingTotals, 'hr', 35, 'home runs')
  seasonLeader(battingTotals, 'rbi', 100, 'RBI')
  // Do not report an ERA or innings without exact and complete stint-level source inputs.
  seasonLeader(pitchingTotals, 'k', 180, 'strikeouts')

  items.forEach((item) => {
    if (!item.date) item.deck = `${item.deck} ${season} season.`
  })

  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.rank - b.rank)).slice(0, 18)
}
