import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildLeaderboardRead, leaderboardRows } from '../src/lib/leaderboardRead'
import type { LeaderEntry, Leaders } from '../src/lib/types'

const row = (name: string, value: number, rank = 1, playerId = rank): LeaderEntry => ({
  name, value, rank, playerId, teamId: 1,
})
const data = (batting: Leaders['batting'] = {}, pitching: Leaders['pitching'] = {}): Leaders => ({ batting, pitching })

function body(leaders: Leaders, title: string): string {
  return buildLeaderboardRead(leaders).find((item) => item.title === title)?.body ?? ''
}

test('the read changes with the board, not a stale saved narrative or cached result', () => {
  const leaders = data({ hr: [row('Jamie Brooks', 43)] })
  assert.match(body(leaders, 'The power race'), /Jamie Brooks.*43 home runs/)

  leaders.batting.hr = [row('Casey Wheeler', 25), row('Chaser', 24, 2)]
  const before = JSON.stringify(leaders)
  const result = buildLeaderboardRead(leaders)
  assert.match(result[0].body, /Casey Wheeler.*25 home runs/)
  assert.match(result[0].body, /Chaser follows with 24 home runs/)
  assert.doesNotMatch(JSON.stringify(result), /Jamie Brooks|43/)
  assert.deepEqual(buildLeaderboardRead(leaders), result)
  assert.equal(JSON.stringify(leaders), before, 'the input is not modified')
})

test('groups top and runner-up ties by displayed value rather than rank', () => {
  const leaders = data({
    hr: [row('A', 25), row('B', 25, 2), row('C', 24, 3)],
    avg: [row('D', 0.3248), row('E', 0.3247, 2), row('F', 0.320, 3)],
    sb: [row('G', 12), row('H', 9, 2), row('I', 9, 3)],
  }, {
    era: [row('J', 2.131), row('K', 2.134, 2)],
  })
  assert.equal(body(leaders, 'The power race'), 'A and B are shown at the top of the home-run board, each with 25 home runs.')
  assert.equal(body(leaders, 'At the plate'), 'D and E are shown at the top of the batting average board, each with a .325 batting average.')
  assert.equal(body(leaders, 'Run prevention'), 'J and K are shown at the top of the ERA board, each with a 2.13 ERA.')
  assert.equal(body(leaders, 'On the bases'), 'G is listed first on the stolen-base board with 12 stolen bases. H and I follow with 9 stolen bases apiece.')
})

test('long ties refer only to the other listed players', () => {
  const leaders = data({ hr: ['A', 'B', 'C', 'D', 'E'].map((name, i) => row(name, 1, i + 1)) })
  assert.equal(body(leaders, 'The power race'), 'A, B, C and 2 others are shown at the top of the home-run board, each with 1 home run.')
})

test('uses correct category units and formatting, including zero and singular counts', () => {
  const leaders = data({ hr: [row('A', 1), row('B', 0, 2)], avg: [row('C', 0)], ops: [row('D', 1.002)] }, {
    era: [row('E', 1.5)], k: [row('F', 1), row('G', 0, 2)],
  })
  assert.match(body(leaders, 'The power race'), /1 home run\. B follows with 0 home runs/)
  assert.match(body(leaders, 'At the plate'), /a \.000 batting average/)
  assert.match(body(leaders, 'Run prevention'), /a 1\.50 ERA/)
  assert.match(body(leaders, 'Strikeout leaders'), /1 strikeout\. G follows with 0 strikeouts/)
  // OPS becomes available as a fallback if earlier categories are missing.
  assert.match(body(data({ ops: [row('D', 1.002)] }), 'On-base and power'), /a 1\.002 OPS/)
  assert.match(body(data({ rbi: [row('H', 1)] }), 'Driving runs in'), /1 RBI/)
  assert.match(body(data({}, { war: [row('I', 2.35)] }), 'Pitching WAR'), /2\.4 pitching WAR/)
})

test('handles missing sides, empty boards and incomplete rows without inventing entries', () => {
  const partial = { batting: { hr: [null, row('Bad', NaN), { name: 'Missing value' }, row('Listed', 8, 3)] } } as unknown as Leaders
  assert.deepEqual(leaderboardRows(partial, 'batting', 'hr').map((entry) => entry.name), ['Listed'])
  assert.equal(body(partial, 'The power race'), 'Listed is listed first on the home-run board with 8 home runs.')
  assert.deepEqual(buildLeaderboardRead(data()), [])
  assert.deepEqual(buildLeaderboardRead({} as Leaders), [])
  assert.deepEqual(buildLeaderboardRead({ batting: { hr: {} }, pitching: {} } as unknown as Leaders), [])
  assert.deepEqual(buildLeaderboardRead(data({}, { ip: [row('Innings Only', 4.2)] })), [])
})

test('falls back to available boards and returns at most four observations', () => {
  const leaders = data({ sb: [row('A', 7)], ops: [row('B', 0.9)], rbi: [row('C', 4)], h: [row('D', 5)], r: [row('E', 6)] })
  assert.deepEqual(buildLeaderboardRead(leaders).map((item) => item.title), ['On the bases', 'On-base and power', 'Driving runs in', 'Collecting hits'])
})

test('the page uses the leaderboard as the source for its observations', () => {
  const page = readFileSync('src/pages/Statistics.tsx', 'utf8')
  assert.match(page, /buildLeaderboardRead\(leaders\.data\)/)
  assert.match(page, /leaderboardRows\(leaders\.data!/)
  assert.doesNotMatch(page, /insights\.json|StatInsights/)
})
