import assert from 'node:assert/strict'
import test from 'node:test'
import type { Team } from '../../src/lib/types'
import type { BnnEntry } from './bnn'
import { toBattingSeason, toPitchingSeason } from './normalize'
import { addMlbProspectLines, buildProspects, type RatingRow, type SeasonLine } from './prospects'

const team = (id: number, level: number, leagueId = 203): Team => ({
  id, city: 'Test', nickname: 'Club', abbr: `T${id}`, leagueId, subLeagueId: 1,
  divisionId: 1, level, parentTeamId: level === 1 ? 0 : 10,
  colors: { primary: '#000', secondary: '#fff' },
})
const player = (id: number, teamId: number, pitcher = false) => ({
  id, firstName: `Player${id}`, lastName: 'Test', age: 20,
  position: pitcher ? 'P' : 'SS', positionCode: pitcher ? 1 : 6,
  teamId, nation: '', bats: 'R', throws: 'R',
})
const rating = (id: number, pitcher = false): RatingRow => ({
  playerId: id, kind: pitcher ? 'pit' : 'bat', current: 50, potential: 50,
  tools: pitcher ? { stuff: 50, movement: 50, control: 50, stamina: 50 } : { contact: 50, power: 50, eye: 50, gap: 50 },
  potentialTools: pitcher ? { stuff: 50, movement: 50, control: 50, stamina: 50 } : { contact: 50, power: 50, eye: 50, gap: 50 },
})
const entry = (id: number): BnnEntry => ({
  rank: id, name: `Player${id} Test`, reportPlayerId: id, organizationId: 10,
  organization: 'Test', age: 20, position: 'SS', level: 'MLB',
})
const bat = (teamId: number, stint: number, g: number, h: number) => toBattingSeason({
  year: '2027', league_id: '203', team_id: String(teamId), stint: String(stint),
  g: String(g), ab: '20', h: String(h), hr: '2', rbi: '6',
})
const pit = (teamId: number, g: number, gs: number) => toPitchingSeason({
  year: '2027', league_id: '203', team_id: String(teamId), stint: '0',
  g: String(g), gs: String(gs), ip: '25', er: '10', w: '2', l: '1', k: '27',
})

test('MLB BNN fallback selects only current-team, role-appropriate season lines and preserves existing lines', () => {
  const players = [player(1, 10), player(2, 10, true), player(3, 10), player(4, 10),
    player(5, 10), player(6, 20), player(7, 10), player(8, 10, true)]
  const ratings = new Map(players.filter((p) => p.id !== 7).map((p) => [p.id, rating(p.id, p.positionCode === 1)]))
  const existing: SeasonLine = { playerId: 4, leagueAbbr: 'AAA', g: 17, avg: 0.4, hr: 1, rbi: 4 }
  const lines = new Map([[4, existing]])
  const bnnMatches = new Map(players.filter((p) => p.id !== 5).map((p) => [p.id, entry(p.id)]))
  const teams = new Map([[10, team(10, 1)], [11, team(11, 1)], [20, team(20, 2, 204)]])
  const result = addMlbProspectLines({
    lines, players, ratings, teams, bnnMatches, leagues: new Map([[203, 'MLB'], [204, 'AAA']]),
    batting: new Map([
      // The old team's later stint must not win; use the latest current-team stint.
      [1, [bat(11, 9, 50, 5), bat(10, 1, 5, 4), bat(10, 2, 12, 6)]],
      [2, [bat(10, 0, 3, 1)]], [3, [bat(11, 0, 8, 3)]], [4, [bat(10, 0, 4, 1)]],
      [5, [bat(10, 0, 4, 1)]], [6, [bat(10, 0, 4, 1)]], [7, [bat(10, 0, 4, 1)]],
    ]),
    pitching: new Map([[2, [pit(10, 5, 5)]], [8, [pit(10, 7, 0)]]]),
  })
  assert.deepEqual(result.get(1), { playerId: 1, leagueAbbr: 'MLB', g: 12, avg: 0.3, hr: 2, rbi: 6 })
  assert.deepEqual(result.get(2), { playerId: 2, leagueAbbr: 'MLB', g: 5, gs: 5, w: 2, l: 1, era: 3.6, ip: 25, k: 27 })
  assert.equal(result.get(8)?.gs, 0)
  assert.equal(result.has(3), false) // no line for the current club
  assert.strictEqual(result.get(4), existing)
  assert.equal(result.has(5), false) // not matched
  assert.equal(result.has(6), false) // currently assigned to the minors
  assert.equal(result.has(7), false) // unknown role; do not guess
  assert.deepEqual([...lines.keys()], [4]) // does not mutate the existing lines

  const published = buildProspects({ players, ratings, teams, orgOf: () => 10, lines: result,
    leagues: new Map([[203, 'MLB'], [204, 'AAA']]), mlbGames: new Map(), bnnMatches })
  assert.equal(published.find((p) => p.id === 2)?.stats?.gs, 5)
  assert.equal(published.find((p) => p.id === 8)?.stats?.gs, 0)
  assert.equal(published.find((p) => p.id === 3)?.stats, null)
  assert.equal('gs' in JSON.parse(JSON.stringify(published.find((p) => p.id === 1)?.stats)), false)
})

test('minor-league pitcher lines also propagate starts, including zero', () => {
  const players = [player(1, 20, true), player(2, 20, true)]
  const lines: Map<number, SeasonLine> = new Map([
    [1, { playerId: 1, leagueAbbr: 'AAA', g: 12, gs: 12, w: 2, l: 1, era: 3.25, ip: 50, k: 55 }],
    [2, { playerId: 2, leagueAbbr: 'AAA', g: 15, gs: 0, w: 1, l: 0, era: 2.5, ip: 20, k: 22 }],
  ])
  const published = buildProspects({ players, ratings: new Map(players.map((p) => [p.id, rating(p.id, true)])),
    teams: new Map([[10, team(10, 1)], [20, team(20, 2, 204)]]), orgOf: () => 10,
    lines, leagues: new Map([[204, 'AAA']]), mlbGames: new Map() })
  assert.equal(published.find((p) => p.id === 1)?.stats?.gs, 12)
  assert.equal(published.find((p) => p.id === 2)?.stats?.gs, 0)
})

test('equal-age, equal-tool fallback prospects gain readiness score at each higher level', () => {
  const teams = new Map([[10, team(10, 1)], ...[2, 3, 4, 5, 6].map((level) => [level, team(level, level)] as const)])
  // Reverse input order to ensure sorting, rather than insertion order, drives the result.
  const players = [6, 5, 4, 3, 2].map((level) => player(level, level))
  const published = buildProspects({ players, ratings: new Map(players.map((p) => [p.id, rating(p.id)])),
    teams, orgOf: () => 10, lines: new Map(), leagues: new Map(), mlbGames: new Map() })
  assert.deepEqual(published.map((p) => p.level), [2, 3, 4, 5, 6])
  assert.deepEqual(published.map((p) => p.score), [55.4, 55.1, 54.7, 54.4, 54])
})
