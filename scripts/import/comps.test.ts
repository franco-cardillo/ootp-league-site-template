import assert from 'node:assert/strict'
import test from 'node:test'
import type { Team } from '../../src/lib/types'
import { baseballAge, buildComparisonPool, buildProspects, currentUsageFloors, knownHand, pitchingGroup, type HistoricalSeason, type PeerPlayer, type RatingRow, type SeasonLine } from './prospects'

const teams = new Map<number, Team>([
  [10, { id: 10, city: 'Test', nickname: 'MLB', abbr: 'MLB', leagueId: 203, subLeagueId: 1, divisionId: 1, level: 1, parentTeamId: 0, colors: { primary: '', secondary: '' } }],
  [20, { id: 20, city: 'Test', nickname: 'AAA', abbr: 'AAA', leagueId: 204, subLeagueId: 1, divisionId: 1, level: 2, parentTeamId: 10, colors: { primary: '', secondary: '' } }],
])
const batTools = { contact: 50, power: 50, gap: 50, eye: 50, avoidK: 50, speed: 50 }
const pitTools = { stuff: 50, movement: 50, control: 50, stamina: 50 }
const player = (id: number, pitcher = false, bats = 'R') => ({ id, firstName: 'Prospect', lastName: String(id),
  age: 20, position: pitcher ? 'P' : 'SS', positionCode: pitcher ? 1 : 6, teamId: 20, nation: '', bats, throws: 'R' })
const rating = (id: number, pitcher = false): RatingRow => ({ playerId: id, kind: pitcher ? 'pit' : 'bat',
  current: 50, potential: 50, tools: { ...(pitcher ? pitTools : batTools) }, potentialTools: { ...(pitcher ? pitTools : batTools) } })
const peer = (id: number, positionCode = 6, overrides: Partial<PeerPlayer> = {}): PeerPlayer => ({
  id, name: `Peer ${id}`, positionCode, tools: { ...batTools }, age: 24, bats: 'R', throws: 'R', gs: 0, g: 0, ...overrides,
})
const letters = (n: number): string => String(n).split('').map((digit) => String.fromCharCode(97 + Number(digit))).join('')
const historical = (id: number, positionCode = 6, changes: Partial<HistoricalSeason> = {}): HistoricalSeason => ({
  playerId: id, key: `${id}|2000`, name: `Historical ${letters(id)}`, year: 2000,
  positionCode, pitcher: false, hasProfile: false, source: 'lahman', age: 24, bats: 'R', throws: 'R',
  bat: { ab: 500, h: 140, d: 30, t: 5, hr: 20, bb: 60, k: 100, sb: 10, pa: 570, g: 140, positionGames: 125 }, ...changes,
})
const history = (count = 160, positionCode = 6) => Array.from({ length: count }, (_, i) => historical(1000 + i, positionCode))
function board(players: Parameters<typeof buildProspects>[0]['players'], peers: PeerPlayer[] = [], historicalRows: HistoricalSeason[] = [], lines = new Map<number, SeasonLine>(), ratings?: Map<number, RatingRow>) {
  return buildProspects({ players, ratings: ratings ?? new Map(players.map((p) => [p.id, rating(p.id, p.positionCode === 1)])),
    teams, orgOf: () => 10, lines, leagues: new Map(), mlbGames: new Map(), peers, externalHistory: historicalRows, season: 2027 })
}

test('shortstops match exact position and known hand, never themselves or an old player', () => {
  const peers = [peer(1), peer(2, 3), peer(3, 4), peer(4, 6, { bats: 'L' }), peer(5, 6, { bats: null }),
    peer(6, 6, { age: 32 }), peer(7, 6, { bats: 'S' }), peer(8)]
  const result = board([player(1)], peers)[0]
  assert.equal(result.comps.current?.playerId, 8)
  assert.equal(board([player(1)], peers.slice(0, -1))[0].comps.current, null)
  assert.equal(board([player(1, false, 'S')], [peer(8, 6, { bats: 'L' })])[0].comps.current, null)
  assert.equal(board([player(1, false, 'S')], [peer(8, 6, { bats: 'S' })])[0].comps.current?.playerId, 8)
  assert.equal(board([{ ...player(1), compBats: null }], [peer(8)])[0].comps.current, null)
  assert.equal(knownHand('', true), null)
  assert.equal(knownHand('B', true), 'S')
  assert.equal(knownHand('3'), null)
})

test('historical age is exact on June 30 and broad career window excludes age 30', () => {
  assert.equal(baseballAge(2000, 1970, 6, 30), 30)
  assert.equal(baseballAge(2000, 1970, 7, 1), 29)
  assert.equal(baseballAge(2000, 1970, 0, 0), null)
  assert.equal(baseballAge(2000, 1970, 2, 30), null)
  assert.equal(board([player(1)], [peer(10, 6, { age: 29 })])[0].comps.current?.playerId, 10)
  assert.equal(board([player(1)], [peer(10, 6, { age: 30 })])[0].comps.current, null)
})

test('current-player playing-time floors scale with the team season', () => {
  assert.deepEqual(currentUsageFloors(26), { pa: 60, positionGames: 10, starterIp: 20, relieverIp: 8 })
  assert.deepEqual(currentUsageFloors(120), { pa: 240, positionGames: 42, starterIp: 90, relieverIp: 36 })
  assert.equal(currentUsageFloors(0), null)
  assert.equal(currentUsageFloors(NaN), null)
})

test('a prospect cannot match his own history even across different ID namespaces', () => {
  const sameId = historical(1, 6, { name: 'A Different Name', source: 'save' })
  const sameName = historical(9001, 6, { name: 'Prospect 1', source: 'lahman' })
  // Wrong-handed filler seasons supply a valid percentile cohort, not eligible matches.
  const filler = history(10).map((season) => ({ ...season, bats: 'L' as const }))
  const result = board([player(1)], [], [sameId, sameName, ...filler])[0]
  assert.equal(result.comps.historical, null)
  assert.equal(result.comps.modelVersion, 2)
})

test('actual pitching usage overrides stamina for prospects and peers; swingmen abstain', () => {
  const players = [player(1, true), player(2, true), player(3, true)]
  const lines = new Map<number, SeasonLine>([
    [1, { playerId: 1, leagueAbbr: 'AAA', g: 20, gs: 0 }],
    [2, { playerId: 2, leagueAbbr: 'AAA', g: 20, gs: 20 }],
    [3, { playerId: 3, leagueAbbr: 'AAA', g: 20, gs: 8 }],
  ])
  const peers = [peer(11, 1, { tools: pitTools, gs: 0, g: 40 }), peer(12, 1, { tools: { ...pitTools, stamina: 20 }, gs: 20, g: 20 }),
    peer(13, 1, { tools: pitTools, gs: 8, g: 20 })]
  const result = board(players, peers, [], lines)
  assert.equal(result.find((p) => p.id === 1)?.comps.current?.playerId, 11)
  assert.equal(result.find((p) => p.id === 2)?.comps.current?.playerId, 12)
  assert.equal(result.find((p) => p.id === 3)?.comps.current, null)
  assert.equal(pitchingGroup(0, 4), null)
  assert.equal(pitchingGroup(0, 30), 'RP')
  assert.equal(pitchingGroup(20, 30), 'SP')
  assert.equal(pitchingGroup(10, 30), null)
  const incomplete = new Map<number, SeasonLine>([[1, { playerId: 1, leagueAbbr: 'AAA', g: 20, gs: 0, usageKnown: false }]])
  assert.equal(board([player(1, true)], peers, [], incomplete)[0].comps.current, null)
})

test('current and historical claims are independent and unique within each pool', () => {
  const result = board([player(1), player(2), player(3)], [peer(10), peer(11)], history())
  assert.equal(result[0].comps.current?.playerId, 10)
  assert.ok(result[0].comps.historical)
  assert.ok(result[1].comps.current)
  assert.ok(result[1].comps.historical)
  assert.equal(result[2].comps.current, null)
  assert.ok(result[2].comps.historical)
  const current = result.flatMap((p) => p.comps.current ? [p.comps.current.playerId] : [])
  const past = result.flatMap((p) => p.comps.historical ? [`${p.comps.historical.playerId}|${p.comps.historical.year}`] : [])
  assert.equal(new Set(current).size, current.length)
  assert.equal(new Set(past).size, past.length)
  assert.match(result[0].comps.historical!.reason, /batting rates only, defense not measured/)
})

test('history requires exact SS and excludes bench, mixed-position usage, wrong hand, and old ages', () => {
  const invalid = [
    historical(1, 3), historical(2, 4),
    historical(3, 6, { age: 32 }), historical(4, 6, { bats: 'L' }), historical(5, 6, { bats: null }),
    historical(6, 6, { bat: { ...historical(6).bat!, ab: 250, pa: 312 } }),
    historical(7, 6, { bat: { ...historical(7).bat!, positionGames: 55 } }),
    historical(8, 0),
  ]
  const result = board([player(1)], [], [...invalid, ...history()])[0]
  assert.ok(result.comps.historical)
  assert.ok(result.comps.historical!.playerId >= 1000)
  assert.equal(board([player(1)], [], [...history(160, 3), ...history(160, 4).map((s) => ({ ...s, playerId: s.playerId + 1000, key: `${s.key}-2b` }))])[0].comps.historical, null)
  assert.ok(board([player(1)], [], [...invalid, ...history(149)])[0].comps.historical)
})

test('a high-walk qualified hitter needs 450 PA, not 400 AB; cohort size is not candidate count', () => {
  const highWalk = historical(99, 6, { bat: { ...historical(99).bat!, ab: 350, pa: 470 } })
  const tooFew = historical(98, 6, { bat: { ...historical(98).bat!, pa: 449 } })
  const pool = buildComparisonPool({ peers: [], historical: [], external: [...history(10), highWalk, tooFew] })
  assert.ok(pool.history.get('SS')?.some((s) => s.id === 99))
  assert.equal(pool.history.get('SS')?.some((s) => s.id === 98), false)
  const oneEligible = [historical(99), ...Array.from({ length: 10 }, (_, i) => historical(2000 + i, 3))]
  assert.equal(board([player(1)], [], oneEligible)[0].comps.historical?.playerId, 99)
})

test('historical pitcher requires same observed role, real workload, and enough qualified seasons', () => {
  const makePit = (id: number, gs: number, g: number, ip: number): HistoricalSeason => ({
    playerId: id, key: `${id}|2000`, name: `Pitcher ${letters(id)}`, year: 2000, positionCode: 1, pitcher: true,
    hasProfile: false, source: 'lahman', age: 24, bats: 'R', throws: 'R',
    pit: { ip, bf: 600, bb: 50, k: 150, hr: 15, gs, g },
  })
  const starters = Array.from({ length: 160 }, (_, i) => makePit(1000 + i, 30, 30, 180))
  const relievers = Array.from({ length: 160 }, (_, i) => makePit(2000 + i, 0, 60, 60))
  const notQualified = Array.from({ length: 160 }, (_, i) => makePit(3000 + i, 0, 10, 10))
  const lines = new Map<number, SeasonLine>([[1, { playerId: 1, leagueAbbr: 'AAA', g: 20, gs: 0 }], [2, { playerId: 2, leagueAbbr: 'AAA', g: 20, gs: 20 }]])
  const rows = board([player(1, true), player(2, true)], [], [...starters, ...relievers, ...notQualified], lines)
  assert.ok((rows.find((p) => p.id === 1)?.comps.historical?.playerId ?? 0) >= 2000)
  assert.ok((rows.find((p) => p.id === 2)?.comps.historical?.playerId ?? 0) >= 1000)
  assert.ok((rows.find((p) => p.id === 2)?.comps.historical?.playerId ?? 0) < 2000)
  assert.equal(board([player(1, true)], [], [...starters, ...notQualified], lines)[0].comps.historical, null)
})

test('incomplete tools do not create NaN scores or false comparisons', () => {
  const r = rating(1)
  r.potentialTools = { contact: 50, power: NaN }
  const result = board([player(1)], [peer(10)], history(), new Map(), new Map([[1, r]]))[0]
  assert.ok(Number.isFinite(result.score))
  assert.deepEqual(result.potentialTools, { contact: 50 })
  assert.equal(result.comps.current, null)
  assert.equal(result.comps.historical, null)
  const secondaryOnly = rating(1)
  secondaryOnly.potentialTools = { gap: 50, speed: 50, avoidK: 50, defense: 50 }
  const noCore = board([player(1)], [peer(10)], history(), new Map(), new Map([[1, secondaryOnly]]))[0]
  assert.equal(noCore.comps.current, null)
  assert.equal(noCore.comps.historical, null)
})
