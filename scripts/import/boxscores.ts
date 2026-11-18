import type { BoxBat, BoxPit, BoxScore, BoxTeam, Game, Team } from '../../src/lib/types'

export interface GameBatLine {
  playerId: number
  gameId: number
  teamId: number
  pos: string
  ab: number
  r: number
  h: number
  d: number
  t: number
  hr: number
  rbi: number
  bb: number
  k: number
}

export interface GamePitLine {
  playerId: number
  gameId: number
  teamId: number
  ip: number
  h: number
  r: number
  er: number
  bb: number
  k: number
  gs: number
}

interface Input {
  games: Game[]
  batting: GameBatLine[]
  pitching: GamePitLine[]
  names: Map<number, string>
  teams: Map<number, Team>
}

const num = (v: number) => Math.round(v * 10) / 10

/**
 * A box score is assembled from the per-player game tables. OOTP's export carries team runs,
 * hits and errors but no inning-by-inning line, so the line score is the R/H/E row plus the
 * full batting and pitching lines for both clubs.
 */
export function buildBoxscores(input: Input): { index: Record<number, string>; byDate: Map<string, BoxScore[]> } {
  const { games, batting, pitching, names, teams } = input

  const batByGame = new Map<number, GameBatLine[]>()
  for (const line of batting) {
    const list = batByGame.get(line.gameId) ?? []
    list.push(line)
    batByGame.set(line.gameId, list)
  }
  const pitByGame = new Map<number, GamePitLine[]>()
  for (const line of pitching) {
    const list = pitByGame.get(line.gameId) ?? []
    list.push(line)
    pitByGame.set(line.gameId, list)
  }

  const side = (game: Game, teamId: number, runs: number, hits: number, errors: number): BoxTeam => {
    const team = teams.get(teamId)
    const bats: BoxBat[] = (batByGame.get(game.id) ?? [])
      .filter((l) => l.teamId === teamId)
      .sort((a, b) => a.ab === 0 ? 1 : b.ab === 0 ? -1 : 0)
      .map((l) => ({
        playerId: l.playerId,
        name: names.get(l.playerId) ?? `Player ${l.playerId}`,
        pos: l.pos,
        ab: l.ab,
        r: l.r,
        h: l.h,
        rbi: l.rbi,
        bb: l.bb,
        k: l.k,
        hr: l.hr,
        d: l.d,
        t: l.t,
      }))

    const pits: BoxPit[] = (pitByGame.get(game.id) ?? [])
      .filter((l) => l.teamId === teamId)
      .map((l) => ({
        playerId: l.playerId,
        name: names.get(l.playerId) ?? `Player ${l.playerId}`,
        ip: num(l.ip),
        h: l.h,
        r: l.r,
        er: l.er,
        bb: l.bb,
        k: l.k,
        gs: l.gs,
      }))

    return {
      teamId,
      abbr: team?.abbr ?? '',
      city: team?.city ?? '',
      nickname: team?.nickname ?? '',
      runs,
      hits,
      errors,
      batting: bats,
      pitching: pits,
    }
  }

  const byDate = new Map<string, BoxScore[]>()
  const index: Record<number, string> = {}

  for (const game of games) {
    if (!game.played) continue
    const score: BoxScore = {
      gameId: game.id,
      date: game.date,
      innings: game.innings,
      attendance: game.attendance,
      away: side(game, game.awayTeamId, game.awayScore, game.awayHits, game.awayErrors),
      home: side(game, game.homeTeamId, game.homeScore, game.homeHits, game.homeErrors),
    }
    const list = byDate.get(game.date) ?? []
    list.push(score)
    byDate.set(game.date, list)
    index[game.id] = game.date
  }

  return { index, byDate }
}
