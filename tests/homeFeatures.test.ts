import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHomeFeatures } from '../src/lib/homeFeatures'
import type { HomeFeature } from '../src/lib/homeFeatures'
import type { LeaderEntry, Leaders, NewsItem, Prospect } from '../src/lib/types'

const row = (id: number, value: number, rank = 1, teamId = id, name = `Name ${id}`): LeaderEntry =>
  ({ playerId: id, name, teamId, value, rank })
const data = (batting: Leaders['batting'] = {}, pitching: Leaders['pitching'] = {}): Leaders => ({ batting, pitching })
const sim = '2027-05-20'
const story = (id: number, date = '2027-05-19', overrides: Partial<NewsItem> = {}): NewsItem => ({
  id: `news-${id}`, rank: id, kind: 'performance', date, playerId: id, teamId: id,
  headline: `Name ${id}: 3 hits, 2 HR, 4 RBI`, deck: 'Unverified winning streak and a team victory.',
  teamIds: [id], link: `/players/${id}`, ...overrides,
})
const boardProspect = (id: number, rank: number): Prospect => ({
  id, rank, name: `Prospect ${id}`, teamId: 100 + id, orgId: id, stats: null,
} as Prospect)
const features = (result: ReturnType<typeof buildHomeFeatures>) => [result.lead, ...result.stars].filter((x): x is HomeFeature => !!x)
const base = () => data({
  hr: [row(1, 25), row(2, 17, 2), row(3, 17, 2)],
  ops: [row(1, 1.2), row(2, 1.035, 2)],
  rbi: [row(1, 48)], h: [row(1, 60)],
  sb: [row(4, 24), row(5, 14, 2)],
  avg: [row(5, .342), row(2, .320, 2)],
}, {
  k: [row(6, 107), row(7, 97, 2)], era: [row(7, .76), row(6, 1.4, 2)],
  sv: [row(8, 15), row(9, 15, 1)], whip: [row(6, .77), row(7, .84, 2)],
})

function find(result: ReturnType<typeof buildHomeFeatures>, id: number): HomeFeature {
  const item = features(result).find((f) => f.playerId === id)
  assert.ok(item, `expected player ${id}`)
  return item
}

test('empty, malformed and all-zero data never manufacture players or progress', () => {
  assert.deepEqual(buildHomeFeatures(null, [], [], sim), { lead: null, stars: [] })
  assert.deepEqual(buildHomeFeatures(undefined, [], [boardProspect(100, 1)], sim), { lead: null, stars: [] })
  const incomplete = { batting: { hr: [null, { playerId: 5, teamId: 2, rank: 1, name: 'Bad', value: NaN },
    row(7, 0), row(8, -1), { ...row(9, 2), teamId: 0 }, { ...row(10, 3), name: '' }] }, pitching: {} } as unknown as Leaders
  assert.deepEqual(buildHomeFeatures(incomplete, [], [], sim), { lead: null, stars: [] })
  assert.deepEqual(buildHomeFeatures({ batting: { hr: {} } } as unknown as Leaders, [], [], sim), { lead: null, stars: [] })
})

test('season lead and stars are unique, balanced, dynamically selected, and additive', () => {
  const input = base()
  const before = JSON.stringify(input)
  const p = boardProspect(99, 4)
  const result = buildHomeFeatures(input, [], [p], sim)
  assert.equal(result.lead?.playerId, 1)
  assert.equal(result.lead?.href, '/players/1')
  assert.equal(result.lead?.sourceLabel, 'MLB season leaderboards')
  assert.equal(result.lead?.sourceNewsId, undefined)
  assert.equal(result.stars.length, 5)
  assert.equal(result.stars.filter((f) => f.label === 'Prospect watch').length, 1)
  assert.equal(result.stars.at(-1)?.href, '/prospects/99')
  assert.equal(result.stars.at(-1)?.teamId, p.teamId)
  assert.equal(result.stars.at(-1)?.summary, 'No. 4 on the published prospect board.')
  assert.ok(result.stars.every((f) => f.sourceNewsId === undefined))
  assert.equal(result.stars.filter((f) => f.label === 'Hitter spotlight').length, 2)
  assert.equal(result.stars.filter((f) => f.label === 'Pitcher spotlight').length, 2)
  assert.equal(new Set(features(result).map((f) => f.playerId)).size, 6)
  assert.equal(JSON.stringify(input), before)
  assert.doesNotMatch(JSON.stringify(result), /\bAI\b|winning streak|team victory/i)
  const changed = data({ hr: [row(42, 44)] }, { k: [row(43, 220)] })
  const next = buildHomeFeatures(changed, [], [], sim)
  assert.deepEqual(new Set(features(next).map((x) => x.playerId)), new Set([42, 43]))
  assert.ok(!JSON.stringify(next).includes('Name 1'))
})

test('prospect never replaces an MLB standout, and duplicate and invalid board entries are ignored', () => {
  const invalid = { ...boardProspect(90, 1), teamId: 0 }
  const sameAsLeader = boardProspect(1, 2)
  const a = boardProspect(91, 3)
  const b = boardProspect(92, 4)
  const result = buildHomeFeatures(base(), [], [b, sameAsLeader, invalid, a], sim)
  assert.equal(result.stars.at(-1)?.playerId, 91)
  assert.equal(buildHomeFeatures(data({ hr: [row(1, 3)] }), [], [a], sim).stars.length, 0)
})

test('a prospect with conflicting current teams is not promoted, regardless of input order', () => {
  const ambiguous = boardProspect(80, 1)
  const conflicting = { ...ambiguous, teamId: ambiguous.teamId + 1 }
  const valid = boardProspect(81, 2)
  const list = [ambiguous, valid, conflicting]
  const result = buildHomeFeatures(base(), [], list, sim)
  assert.equal(result.stars.at(-1)?.playerId, 81)
  assert.deepEqual(buildHomeFeatures(base(), [], [...list].reverse(), sim), result)
})

test('missing pitchers and missing hitters fall back without fabricated positional cards', () => {
  const hitters = buildHomeFeatures(data({ hr: [row(1, 20), row(2, 15, 2)], sb: [row(3, 10)] }), [], [], sim)
  assert.equal(features(hitters).length, 3)
  assert.ok(features(hitters).every((f) => f.label === 'Hitter spotlight'))
  const pitchers = buildHomeFeatures(data({}, { k: [row(6, 90), row(7, 80, 2)], sv: [row(8, 13)] }), [], [], sim)
  assert.equal(features(pitchers).length, 3)
  assert.ok(features(pitchers).every((f) => f.label === 'Pitcher spotlight'))
})

test('season summaries identify a sole leader and the next published position', () => {
  const result = buildHomeFeatures(data({ hr: [row(1, 25), row(2, 17, 2)] }), [], [], sim)
  assert.equal(find(result, 1).summary, 'No. 1 on the MLB home-run leaderboard with 25 HR.')
  assert.equal(find(result, 2).summary, 'No. 2 on the MLB home-run leaderboard with 17 HR.')
})

test('old sequential ranks produce tied leader and tied runner-up summaries', () => {
  const tiedLeaders = { ...data({ hr: [row(1, 25, 1), row(2, 25, 2), row(3, 17, 3)] }), meta: { generated: 'old' } }
  const leaders = buildHomeFeatures(tiedLeaders, [], [], sim)
  for (const id of [1, 2]) {
    assert.equal(find(leaders, id).summary, 'Tied for No. 1 on the MLB home-run leaderboard with 25 HR.')
  }
  assert.equal(find(leaders, 3).summary, 'No. 3 on the MLB home-run leaderboard with 17 HR.')

  const tiedRunnersUp = data({ hr: [row(1, 25, 1), row(2, 17, 2), row(3, 17, 3), row(4, 14, 4)] })
  const runnersUp = buildHomeFeatures(tiedRunnersUp, [], [], sim)
  assert.equal(find(runnersUp, 1).summary, 'No. 1 on the MLB home-run leaderboard with 25 HR.')
  for (const id of [2, 3]) {
    assert.equal(find(runnersUp, id).summary, 'Tied for No. 2 on the MLB home-run leaderboard with 17 HR.')
  }
  assert.equal(find(runnersUp, 4).summary, 'No. 4 on the MLB home-run leaderboard with 14 HR.')
  assert.deepEqual(buildHomeFeatures(data({ hr: [...tiedRunnersUp.batting.hr].reverse() }), [], [], sim), runnersUp)
})

test('duplicate rows for one player never manufacture a tie', () => {
  const result = buildHomeFeatures(data({ hr: [row(1, 25, 1), row(1, 25, 2, 1, 'Another Alias'),
    row(2, 17, 2), row(2, 17, 3)] }), [], [], sim)
  assert.equal(find(result, 1).summary, 'No. 1 on the MLB home-run leaderboard with 25 HR.')
  assert.equal(find(result, 2).summary, 'No. 2 on the MLB home-run leaderboard with 17 HR.')
  assert.equal(features(result).length, 2)

  const actualTie = buildHomeFeatures(data({ hr: [row(1, 25), row(1, 25), row(2, 25, 2)] }), [], [], sim)
  assert.equal(find(actualTie, 1).summary, 'Tied for No. 1 on the MLB home-run leaderboard with 25 HR.')
  assert.equal(find(actualTie, 2).summary, 'Tied for No. 1 on the MLB home-run leaderboard with 25 HR.')
})

test('ties use the featured board and its formatted values, not equal ranks or other boards', () => {
  const rounded = buildHomeFeatures(data({ avg: [row(1, .3248, 1), row(2, .3247, 2)] },
    { era: [row(3, .3248, 1), row(4, .3247, 2)] }), [], [], sim)
  for (const id of [1, 2]) {
    assert.equal(find(rounded, id).summary, 'Tied for No. 1 on the MLB batting-average leaderboard with .325 AVG.')
  }
  for (const id of [3, 4]) {
    assert.equal(find(rounded, id).summary, 'Tied for No. 1 on the MLB ERA leaderboard with 0.32 ERA.')
  }

  const distinct = buildHomeFeatures(data({ hr: [row(5, 25, 1), row(6, 24, 1)], rbi: [row(7, 25, 1)] }), [], [], sim)
  assert.equal(find(distinct, 5).summary, 'No. 1 on the MLB home-run leaderboard with 25 HR.')
  assert.equal(find(distinct, 6).summary, 'No. 1 on the MLB home-run leaderboard with 24 HR.')
  assert.equal(find(distinct, 7).summary, 'No. 1 on the MLB RBI leaderboard with 25 RBI.')
})

test('valid same-board identities provide ties despite cross-board club conflicts, but conflicting values do not', () => {
  const leaders = data({
    hr: [row(1, 25, 3), row(2, 25, 2), row(3, 25, 1), row(4, 25, 1), row(4, 26, 2),
      row(5, 25, 1, 5, ''), row(0, 25, 1)],
    rbi: [row(3, 40, 1, 30)],
  })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.equal(find(result, 1).summary, 'Tied for No. 1 on the MLB home-run leaderboard with 25 HR.')
  assert.equal(find(result, 2).summary, 'Tied for No. 1 on the MLB home-run leaderboard with 25 HR.')
  assert.deepEqual(new Set(features(result).map((feature) => feature.playerId)), new Set([1, 2]))

  const sole = buildHomeFeatures(data({ hr: [row(1, 25, 2), row(2, 25, 1), row(2, 24, 2)] }), [], [], sim)
  assert.equal(find(sole, 1).summary, 'No. 2 on the MLB home-run leaderboard with 25 HR.')
})

test('a tied player with a conflicting club on another board still establishes the tie without being featured', () => {
  const leaders = data({
    hr: [row(1, 10, 1, 1), row(2, 10, 1, 2), row(2, 10, 1, 2)],
    rbi: [row(2, 30, 1, 99)],
  })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.equal(result.lead?.playerId, 1)
  assert.equal(result.lead?.summary, 'Tied for No. 1 on the MLB home-run leaderboard with 10 HR.')
  assert.deepEqual(features(result).map((feature) => feature.playerId), [1])
  const reversed = data({ hr: [...leaders.batting.hr].reverse(), rbi: [...leaders.batting.rbi].reverse() })
  assert.deepEqual(buildHomeFeatures(reversed, [], [], sim), result)
})

test('a conflicting lower-ranked same-board value cannot be used to manufacture a tie', () => {
  const leaders = data({
    hr: [row(1, 10, 1, 1), row(2, 10, 1, 2), row(2, 9, 11, 2)],
    rbi: [row(2, 30, 1, 99)],
  })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.equal(result.lead?.summary, 'No. 1 on the MLB home-run leaderboard with 10 HR.')
  assert.deepEqual(features(result).map((feature) => feature.playerId), [1])
})

test('club-ambiguous competitors also establish ties for season star cards', () => {
  const leaders = data({
    hr: [row(1, 20), row(2, 10, 2), row(3, 10, 2)],
    rbi: [row(1, 50), row(3, 30, 2, 99)],
  })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.equal(result.lead?.playerId, 1)
  assert.equal(result.stars[0]?.playerId, 2)
  assert.equal(result.stars[0]?.summary, 'Tied for No. 2 on the MLB home-run leaderboard with 10 HR.')
  assert.ok(!features(result).some((feature) => feature.playerId === 3))
})

test('an old rank-11 row tied on displayed value with rank 10 is included, but other lower ranks are not', () => {
  const result = buildHomeFeatures(data({ hr: [row(1, 10, 10), row(2, 10, 11), row(3, 9, 12)] }), [], [], sim)
  for (const id of [1, 2]) {
    assert.equal(find(result, id).summary, 'Tied for No. 10 on the MLB home-run leaderboard with 10 HR.')
  }
  assert.ok(!features(result).some((feature) => feature.playerId === 3))
  const unrelated = buildHomeFeatures(data({ hr: [row(1, 25)], rbi: [row(2, 40), row(1, 10, 11, 9)] }), [], [], sim)
  assert.equal(find(unrelated, 1).summary, 'No. 1 on the MLB home-run leaderboard with 25 HR.')
})

test('displayed-value ties, ranks, same-ID aliases and reordered input are handled deterministically', () => {
  const leaders = data({
    avg: [row(12, .3248, 1, 4, 'Z Alias'), row(11, .3247, 2, 5, 'Tied Player')],
    hr: [row(12, 10, 2, 4, 'A Alias'), row(12, 10, 2, 4, 'Z Alias'), row(11, 10, 1, 5, 'Tied Player')],
  }, { sv: [row(50, 5)] })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.equal(result.lead?.playerId, 11, 'both players receive the same displayed-value tie score; ID breaks the tie')
  assert.equal(features(result).filter((f) => f.playerId === 12).length, 1)
  assert.ok(find(result, 12).name === 'A Alias' || find(result, 12).name === 'Z Alias')
  assert.doesNotMatch(features(result).map((f) => `${f.headline} ${f.summary}`).join(' '), /\bleads?\b|\bfirst\b|\brank(?:ed)?\b/i)
  const reordered = data(Object.fromEntries(Object.entries(leaders.batting).reverse().map(([key, rows]) => [key, [...rows].reverse()])),
    Object.fromEntries(Object.entries(leaders.pitching).reverse().map(([key, rows]) => [key, [...rows].reverse()])))
  assert.deepEqual(buildHomeFeatures(reordered, [], [], sim), result)
})

test('conflicting values, invalid values and conflicting club IDs are not merged', () => {
  const leaders = data({
    hr: [row(1, 20, 1, 1), row(1, 19, 2, 1), row(2, 15, 3, 2), row(3, 0, 4, 3)],
    avg: [row(1, .3, 2, 1), row(2, .32, 1, 9), row(4, 1.2, 1, 4)],
  })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.equal(result.lead?.playerId, 1)
  assert.deepEqual(result.lead?.stats, [{ label: 'AVG', value: '.300' }])
  assert.ok(!features(result).some((f) => [2, 3, 4].includes(f.playerId)))
})

test('correct formats and units come only from the matching player and same-side board', () => {
  const leaders = data({ hr: [row(10, 1, 1, 7)], avg: [row(10, .305, 1, 7)], ops: [row(10, 1.002, 1, 7)] },
    { era: [row(20, 1.5, 1, 8)], k: [row(20, 75, 1, 8)], whip: [row(20, .89, 1, 8)] })
  const result = buildHomeFeatures(leaders, [], [], sim)
  assert.deepEqual(new Map(find(result, 10).stats.map((s) => [s.label, s.value])), new Map([['HR', '1'], ['OPS', '1.002'], ['AVG', '.305']]))
  assert.deepEqual(new Map(find(result, 20).stats.map((s) => [s.label, s.value])), new Map([['K', '75'], ['ERA', '1.50'], ['WHIP', '0.89']]))
  assert.match(find(result, 10).summary, /1 HR/)
  const verifiedZero = buildHomeFeatures(data({}, { era: [row(21, 0)], k: [row(21, 7)] }), [], [], sim)
  assert.ok(find(verifiedZero, 21).stats.some((s) => s.label === 'ERA' && s.value === '0.00'))
})

test('old explicit metadata excludes unqualified rates; versioned IP uses baseball notation', () => {
  const old = { ...data({ avg: [row(1, .5)], hr: [row(2, 8)] }, { era: [row(3, 1.4)] }), meta: { generated: 'old' } }
  const oldResult = buildHomeFeatures(old, [], [], sim)
  assert.deepEqual(features(oldResult).map((x) => x.playerId), [2])
  const current = { ...data({}, { ip: [row(4, 63.2), row(5, 61.3, 2)] }), meta: { qualificationVersion: 1 } }
  const result = buildHomeFeatures(current, [], [], sim)
  assert.deepEqual(result.lead?.stats, [{ label: 'IP', value: '63.2' }])
  assert.equal(result.stars.length, 0)
  assert.equal(buildHomeFeatures(data({}, { ip: [row(4, 63.2)] }), [], [], sim).lead, null)
})

test('timely top-board game story wins the lead, matches its player, and uses only headline facts', () => {
  const news = [story(2), story(1, '2027-05-19', { id: 'selected-story', headline: 'Name 1: 4 hits, 1 HR, 3 RBI' })]
  const result = buildHomeFeatures(base(), news, [], sim)
  assert.equal(result.lead?.playerId, 1)
  assert.equal(result.lead?.headline, 'Name 1: 4 hits, 1 HR, 3 RBI')
  assert.equal(result.lead?.sourceLabel, 'Game performance · 2027-05-19')
  assert.equal(result.lead?.sourceNewsId, 'selected-story')
  assert.equal(result.lead?.summary, "Name 1's game line from 2027-05-19.")
  assert.deepEqual(result.lead?.stats, [{ label: 'H (game)', value: '4' }, { label: 'HR (game)', value: '1' }, { label: 'RBI (game)', value: '3' }])
  assert.doesNotMatch(JSON.stringify(result), /unverified|winning|victory|streak/i)
  assert.notEqual(result.stars[0]?.playerId, 1)
  assert.deepEqual(buildHomeFeatures(base(), [...news].reverse(), [], sim), result)
})

test('same-day and yesterday are current; stale, future, impossible and not-latest stories fall back', () => {
  const lead = (news: NewsItem[], date = sim) => buildHomeFeatures(base(), news, [], date).lead!
  assert.equal(lead([story(2, '2027-05-20')]).playerId, 2)
  assert.equal(lead([story(2, '2027-05-19')]).playerId, 2)
  for (const date of ['2027-05-18', '2027-05-21', '', '2027-02-30', '2027-05-19T00:00:00Z']) {
    assert.equal(lead([story(2, date)]).playerId, 1, date)
    assert.equal(lead([story(2, date)]).sourceLabel, 'MLB season leaderboards')
  }
  assert.equal(lead([story(2)], 'bad-date').sourceLabel, 'MLB season leaderboards')
  const latestOther = story(80, '2027-05-20', { kind: 'blowout', playerId: undefined })
  assert.equal(lead([story(2, '2027-05-19'), latestOther]).sourceLabel, 'MLB season leaderboards')
  // An upcoming item cannot make yesterday's real, played story stale.
  assert.equal(lead([story(2, '2027-05-19'), story(3, '2027-05-21')]).playerId, 2)
})

test('news cannot borrow another player, team, link, deck, unsupported headline or older rank', () => {
  const variants: Partial<NewsItem>[] = [
    { playerId: undefined }, { playerId: 0 }, { teamId: 9 }, { link: '/scores/1' },
    { headline: 'Other Player: 3 hits, 2 HR, 4 RBI' }, { headline: 'Name 2 hit a historic milestone' },
    { headline: 'Name 2: 1 hits, 2 HR, 4 RBI' }, { kind: 'race' },
  ]
  for (const variant of variants) {
    const result = buildHomeFeatures(base(), [story(2, sim, variant)], [], sim)
    assert.equal(result.lead?.sourceLabel, 'MLB season leaderboards', JSON.stringify(variant))
  }
  const distantRank = data({ hr: [row(1, 25), row(2, 5, 9)] })
  assert.equal(buildHomeFeatures(distantRank, [story(2, sim)], [], sim).lead?.playerId, 1)
  const unmatched = buildHomeFeatures(base(), [story(100, sim)], [], sim)
  assert.equal(unmatched.lead?.playerId, 1)
})

test('a valid current player-linked game story can stand alone without leaderboards', () => {
  const result = buildHomeFeatures(null, [story(23, sim)], [], sim)
  assert.equal(result.lead?.playerId, 23)
  assert.equal(result.lead?.href, '/players/23')
  assert.equal(result.lead?.teamId, 23)
  assert.equal(result.lead?.sourceNewsId, 'news-23')
  assert.equal(result.stars.length, 0)
  const power = story(23, sim, { id: 'power-story', kind: 'power', headline: 'Name 23 goes deep 3 times' })
  const lead = buildHomeFeatures(null, [power], [], sim).lead!
  assert.equal(lead.headline, 'Name 23: 3 home runs in a game')
  assert.equal(lead.sourceNewsId, 'power-story')
  assert.deepEqual(lead.stats, [{ label: 'HR (game)', value: '3' }])
})

test('a game story may match a same-ID alias but not a top-five zero-only position', () => {
  const leaders = data({ hr: [row(1, 25, 1, 1, 'Preferred Name'), row(2, 0, 1, 2)],
    ops: [row(1, 1.1, 1, 1, 'Another Alias')], h: [row(2, 1, 9, 2)] })
  const matchingAlias = story(1, sim, { headline: 'Another Alias: 3 hits, 2 HR, 4 RBI' })
  const matched = buildHomeFeatures(leaders, [matchingAlias], [], sim)
  assert.equal(matched.lead?.playerId, 1)
  assert.equal(matched.lead?.sourceLabel, `Game performance · ${sim}`)
  assert.match(matched.lead!.headline, /^Preferred Name:/)
  const zero = buildHomeFeatures(leaders, [story(2, sim)], [], sim)
  assert.equal(zero.lead?.playerId, 1)
  assert.equal(zero.lead?.sourceLabel, 'MLB season leaderboards')
})
