import assert from 'node:assert/strict'
import test from 'node:test'
import type { Division, Game, StandingRow, SubLeague, Team } from '../../src/lib/types'
import type { Row } from './csv'
import { toBattingSeason, toPitchingSeason } from './normalize'
import { buildNews, type GameBatting } from './news'

const season = 2027
const teams = new Map<number, Team>([1, 2, 3, 4].map((id) => [id, {
  id, city: `City${id}`, nickname: `Club${id}`, abbr: `T${id}`, leagueId: 203,
  subLeagueId: 0, divisionId: 0, level: 1, parentTeamId: 0,
  colors: { primary: '', secondary: '' },
}]))
const names = new Map([[1, 'Alice'], [2, 'Bea'], [3, 'Cara'], [4, 'Dee']])
const empty = (): Parameters<typeof buildNews>[0] => ({
  games: [], gameBatting: [], standings: [], divisions: [], subLeagues: [], teams, names, season,
  seasonBatting: [], seasonPitching: [],
})
const game = (overrides: Partial<Game> = {}): Game => ({
  id: 10, date: '2027-06-01', homeTeamId: 1, awayTeamId: 2,
  homeScore: 5, awayScore: 3, homeHits: 9, awayHits: 7, homeErrors: 0, awayErrors: 0,
  innings: 9, played: true, gameType: 0, attendance: 0, winningPitcher: 0,
  losingPitcher: 0, savePitcher: 0, ...overrides,
})
const batLine = (overrides: Partial<GameBatting> = {}): GameBatting => ({
  playerId: 1, gameId: 10, teamId: 1, h: 3, d: 0, t: 0, hr: 2, rbi: 4, r: 2, ...overrides,
})
const standing = (teamId: number, w: number, l: number, overrides: Partial<StandingRow> = {}): StandingRow => ({
  teamId, leagueId: 203, subLeagueId: 0, divisionId: 0, g: w + l, w, l, t: 0,
  pct: w / (w + l), gb: 0, position: 0, streak: 0, magicNumber: 0, ...overrides,
})
const division: Division = { id: 0, leagueId: 203, subLeagueId: 0, name: 'Division' }
const subLeague: SubLeague = { id: 0, leagueId: 203, name: 'League', abbr: 'L' }
const bat = (playerId: number, teamId: number, hr: number, rbi: number, overrides: Row = {}) => ({
  playerId,
  line: toBattingSeason({ year: String(season), league_id: '203', team_id: String(teamId),
    stint: '0', hr: String(hr), rbi: String(rbi), ...overrides }),
})
const pit = (playerId: number, teamId: number, k: number, overrides: Row = {}) => ({
  playerId,
  line: toPitchingSeason({ year: String(season), league_id: '203', team_id: String(teamId),
    stint: '0', g: '30', ip: '90', outs: '270', er: '30', k: String(k), ...overrides }),
})
const story = (input: Parameters<typeof buildNews>[0], kind: 'blowout' | 'performance' | 'power' | 'shutout' | 'streak' | 'race') => {
  const item = buildNews(input).find((item) => item.kind === kind)
  assert.ok(item, `expected ${kind} story`)
  return item
}

test('shutouts report the losing side’s hits, whether the home or away team wins', () => {
  const input = empty()
  input.games = [game({ homeScore: 6, awayScore: 0, homeHits: 12, awayHits: 3 })]
  let item = story(input, 'shutout')
  assert.equal(item.deck, '6-0, with 3 hits allowed.')
  assert.equal(item.teamId, 1)
  assert.equal(item.opponentTeamId, 2)
  input.games = [game({ homeScore: 0, awayScore: 4, homeHits: 2, awayHits: 11 })]
  item = story(input, 'shutout')
  assert.equal(item.deck, '4-0, with 2 hits allowed.')
  assert.equal(item.teamId, 2)
  assert.equal(item.opponentTeamId, 1)
})

test('performance results follow the actual game and team, including losses and ties', () => {
  const input = empty()
  input.games = [game()]
  input.gameBatting = [batLine({ teamId: 2 })]
  let item = story(input, 'performance')
  assert.match(item.deck, /for T2 in a 3-5 loss\./)
  input.gameBatting = [batLine({ teamId: 1 })]
  item = story(input, 'performance')
  assert.match(item.deck, /for T1 in a 5-3 win\./)
  input.games = [game({ homeScore: 4, awayScore: 4 })]
  item = story(input, 'performance')
  assert.match(item.deck, /in a 4-4 tie\./)
  // A batting line attributed to a nonparticipant cannot be assigned a game result.
  input.gameBatting = [batLine({ teamId: 3, h: 4, hr: 3 })]
  assert.deepEqual(buildNews(input), [])
})

test('doubleheader and unplayed game batting lines use only their matching completed game', () => {
  const input = empty()
  input.games = [game({ id: 10, homeScore: 5, awayScore: 2 }),
    game({ id: 11, homeScore: 1, awayScore: 6 }), game({ id: 12, played: false })]
  input.gameBatting = [batLine({ gameId: 11 }), batLine({ gameId: 12, hr: 4, h: 4 })]
  const item = story(input, 'performance')
  assert.match(item.deck, /in a 1-6 loss\./)
  assert.equal(buildNews(input).some((s) => s.kind === 'power'), false)
})

test('a selected non-shutout blowout never claims the widest margin of all games', () => {
  const input = empty()
  input.games = [game({ homeScore: 9, awayScore: 1, homeHits: 12, awayHits: 8 }),
    game({ id: 11, homeTeamId: 3, awayTeamId: 4, homeScore: 15, awayScore: 0, homeHits: 20, awayHits: 1 })]
  const item = story(input, 'blowout')
  assert.equal(item.headline, 'City1 Club1 rout City2 Club2 9-1')
  assert.equal(item.deck, 'T1 had 12 hits; T2 had 8.')
  assert.doesNotMatch(item.deck, /widest|biggest|slate/i)
  assert.equal(story(input, 'shutout').deck, '15-0, with 1 hit allowed.')
})

test('a non-shutout away win associates each hit total with the correct club', () => {
  const input = empty()
  input.games = [game({ homeScore: 2, awayScore: 8, homeHits: 4, awayHits: 11 })]
  const item = story(input, 'blowout')
  assert.equal(item.headline, 'City2 Club2 rout City1 Club1 8-2')
  assert.equal(item.deck, 'T2 had 11 hits; T1 had 4.')
  assert.deepEqual(item.teamIds, [2, 1])
})

test('streak stories provide only the actual record and streak, including tied games', () => {
  const input = empty()
  input.standings = [standing(1, 40, 30, { g: 72, t: 2, streak: 5 }), standing(2, 30, 40, { streak: -6 })]
  input.subLeagues = [{ ...subLeague, leagueId: 999, abbr: 'WRONG' }, subLeague]
  const stories = buildNews(input).filter((s) => s.kind === 'streak')
  assert.equal(stories[0].headline, 'City2 Club2 on a 6-game losing streak')
  assert.equal(stories[0].deck, '30-40 on the season in the L. 2027 season.')
  assert.equal(stories[1].deck, '40-30-2 on the season in the L. 2027 season.')
  assert.doesNotMatch(stories.map((s) => s.deck).join(' '), /climbing|slipping|WRONG/)
})

test('division races rank by percentage, scope league IDs, and describe zero GB without claiming a lead', () => {
  const input = empty()
  input.divisions = [division, { ...division, leagueId: 999, name: 'Wrong league' }]
  // T1 leads in winning percentage despite fewer wins; the two records are equal in GB.
  input.standings = [standing(2, 31, 21), standing(3, 32, 23), standing(1, 30, 20)]
  const races = buildNews(input).filter((s) => s.kind === 'race')
  assert.equal(races.length, 1)
  assert.equal(races[0].headline, 'Division: T1 and T2 even in games behind')
  assert.equal(races[0].deck, 'T1 is 30-20; T2 is 31-21. 2027 season.')
  assert.deepEqual(races[0].teamIds, [1, 2])
  assert.doesNotMatch(races[0].headline + races[0].deck, /lead|tightest|month/i)
})

test('division-race margins are factual for fractional and negative games-behind comparisons', () => {
  const input = empty()
  input.divisions = [division]
  input.standings = [standing(1, 10, 5), standing(2, 8, 6)]
  assert.match(story(input, 'race').headline, /separated by 1\.5 games/)
  // The better percentage can have a negative GB comparison with uneven schedules.
  input.standings = [standing(1, 1, 0), standing(2, 10, 5)]
  const item = story(input, 'race')
  assert.match(item.headline, /separated by 2\.0 games/)
  assert.doesNotMatch(item.headline, /lead/)
  input.standings = [standing(1, 20, 0), standing(2, 10, 10)]
  assert.equal(buildNews(input).some((s) => s.kind === 'race'), false)
})

test('home-run and RBI leaders aggregate MLB stints and state the real runner-up totals', () => {
  const input = empty()
  input.seasonBatting = [bat(1, 1, 20, 60), bat(1, 2, 25, 55, { stint: '1' }),
    bat(2, 3, 44, 113), bat(3, 4, 99, 999, { year: '2026' }),
    bat(4, 4, 99, 999, { league_id: '204' })]
  const stories = buildNews(input).filter((s) => s.kind === 'performance')
  assert.equal(stories.length, 2)
  assert.equal(stories[0].headline, 'Alice leads MLB with 45 home runs')
  assert.equal(stories[0].deck, 'The next-highest MLB total is 44. 2027 season.')
  assert.equal(stories[1].headline, 'Alice leads MLB with 115 RBI')
  assert.equal(stories[1].deck, 'The next-highest MLB total is 113. 2027 season.')
  assert.deepEqual(stories[0].teamIds, [1, 2])
  assert.equal(stories[0].teamId, undefined)
  assert.doesNotMatch(stories.map((s) => s.headline + s.deck).join(' '), /passes|no one else/i)
})

test('home-run and RBI ties are acknowledged rather than presenting a sole leader', () => {
  const input = empty()
  input.seasonBatting = [bat(2, 2, 40, 100), bat(1, 1, 40, 100), bat(3, 3, 39, 99)]
  const stories = buildNews(input).filter((s) => s.kind === 'performance')
  assert.deepEqual(stories.map((s) => s.headline), [
    'Alice is tied for the MLB lead with 40 home runs',
    'Alice is tied for the MLB lead with 100 RBI',
  ])
  assert.ok(stories.every((s) => s.deck === '2 players share the MLB lead. 2027 season.'))
  assert.ok(stories.every((s) => s.teamId === 1))
})

test('strikeout leader aggregates all MLB stints, respects season and ties, and avoids partial ERA/IP', () => {
  const input = empty()
  input.seasonPitching = [pit(1, 1, 100, { er: '9', outs: '271' }), pit(1, 2, 110, { er: '30', stint: '1' }),
    pit(2, 3, 205), pit(3, 4, 999, { year: '2026' }), pit(4, 4, 999, { league_id: '204' })]
  let item = story(input, 'performance')
  assert.equal(item.headline, 'Alice leads MLB with 210 strikeouts')
  assert.equal(item.deck, 'The next-highest MLB total is 205. 2027 season.')
  assert.equal(item.teamId, undefined)
  assert.deepEqual(item.teamIds, [1, 2])
  assert.doesNotMatch(item.deck, /ERA|innings/)
  input.seasonPitching.push(pit(2, 3, 5, { stint: '1' }))
  item = story(input, 'performance')
  assert.equal(item.headline, 'Alice is tied for the MLB lead with 210 strikeouts')
  assert.equal(item.deck, '2 players share the MLB lead. 2027 season.')
})

test('season team metadata does not infer an unknown or arbitrary traded-player club', () => {
  const input = empty()
  input.seasonBatting = [bat(1, 1, 20, 0, { stint: '5' }), bat(1, 2, 20, 0, { stint: '0' })]
  let item = story(input, 'performance')
  assert.equal(item.teamId, undefined)
  assert.deepEqual(item.teamIds, [1, 2])
  input.seasonBatting.reverse()
  item = story(input, 'performance')
  assert.equal(item.teamId, undefined)
  assert.deepEqual(item.teamIds, [1, 2])
  input.seasonBatting = [bat(1, 1, 20, 0), bat(1, 9999, 20, 0)]
  item = story(input, 'performance')
  assert.equal(item.teamId, undefined)
  assert.deepEqual(item.teamIds, [1])
  input.seasonBatting = [bat(1, 1, 20, 0), bat(1, 1, 20, 0)]
  assert.equal(story(input, 'performance').teamId, 1)
})

test('single-player totals make no unsupported runner-up claim and thresholds remain unchanged', () => {
  const input = empty()
  input.seasonBatting = [bat(1, 1, 35, 99)]
  input.seasonPitching = [pit(2, 2, 179)]
  let stories = buildNews(input)
  assert.equal(stories.length, 1)
  assert.equal(stories[0].deck, 'Based on the available MLB season totals. 2027 season.')
  assert.equal(stories[0].teamId, 1)
  input.seasonBatting = [bat(1, 1, 34, 99)]
  assert.deepEqual(buildNews(input), [])
  input.seasonBatting = [bat(1, 1, 35, 100)]
  input.seasonPitching = [pit(2, 2, 180)]
  stories = buildNews(input)
  assert.equal(stories.length, 3)
  assert.deepEqual(stories.map((s) => s.id), ['n1', 'n2', 'n3'])
  assert.deepEqual(stories.map((s) => s.rank), [0, 1, 2])
})

test('news leaders use the configured league and exclude an unrelated league', () => {
  const input = empty()
  input.mlbLeagueId = 777
  input.teams = new Map([[1, { ...teams.get(1)!, leagueId: 777 }]])
  input.seasonBatting = [bat(1, 1, 40, 0, { league_id: '777' }), bat(2, 2, 90, 0)]
  const item = story(input, 'performance')
  assert.equal(item.headline, 'Alice leads MLB with 40 home runs')
  assert.deepEqual(item.teamIds, [1])
})
