import assert from 'node:assert/strict'
import test from 'node:test'
import { battingPaKnown, battingRateKnown, buildLeaders, leaderRawWar, pitchingOuts, pitchingRateKnown, teamGamesFromRecords, type BattingLeaderRecord, type PitchingLeaderRecord } from './leaders'
import { toBattingSeason, toPitchingSeason } from './normalize'
import type { Row } from './csv'

function batting(id: number, team: number, pa: number, overrides: Row = {}): BattingLeaderRecord {
  const row: Row = { player_id: String(id), year: '2027', league_id: '203', team_id: String(team), stint: '0',
    pa: String(pa), ab: String(pa), h: String(Math.floor(pa * 0.3)), g: '20', d: '0', t: '0', hr: '2',
    bb: '0', hp: '0', sf: '0', sh: '0', war: '0', ...overrides }
  return { playerId: id, line: toBattingSeason(row), paKnown: battingPaKnown(row),
    rawWar: leaderRawWar(row), rateKnown: battingRateKnown(row) }
}
function pitching(id: number, team: number, outs: number, overrides: Row = {}): PitchingLeaderRecord {
  const row: Row = { player_id: String(id), year: '2027', league_id: '203', team_id: String(team), stint: '0',
    ip: String(Math.floor(outs / 3)), outs: String(outs), er: '5', ha: '24', bb: '10', g: '8', k: '20', war: '0', ...overrides }
  return { playerId: id, line: toPitchingSeason(row), outs: pitchingOuts(row),
    rawWar: leaderRawWar(row), rateKnown: pitchingRateKnown(row) }
}
function leaders(bat: BattingLeaderRecord[] = [], pit: PitchingLeaderRecord[] = [],
  teamGames = new Map([[1, 42], [2, 44]]), rosterTeams = new Map<number, number>()) {
  return buildLeaders({ batting: bat, pitching: pit, names: new Map(), season: 2027, teamGames, rosterTeams })
}

test('uses valid unique standings records only, never zero, corrupt, duplicate or non-MLB clubs', () => {
  const rows: Row[] = [
    { team_id: '1', g: '44', w: '25', l: '19', t: '0' },
    { team_id: '2', g: '42', w: '20', l: '22', t: '0' },
    { team_id: '2', g: '42', w: '20', l: '22', t: '0' },
    { team_id: '3', g: '', w: '0', l: '0', t: '0' },
    { team_id: '4', g: '43', w: '20', l: '22', t: '0' },
    { team_id: '5', g: '0', w: '0', l: '0', t: '0' },
    { team_id: '6', g: '45', w: '25', l: '20', t: '0' },
  ]
  assert.deepEqual([...teamGamesFromRecords(rows, new Set([1, 2, 3, 4, 5]))], [[1, 44]])
})

test('PA must be recorded, valid, and at least the sum of known plate-appearance components', () => {
  const row = { pa: '12', ab: '10', bb: '1', hp: '0', sf: '0', sh: '1' }
  assert.equal(battingPaKnown(row), true)
  assert.equal(battingPaKnown({ ...row, pa: '' }), false)
  assert.equal(battingPaKnown({ ...row, pa: '11' }), false)
  assert.equal(battingPaKnown({ ...row, ab: '' }), false)
  assert.equal(battingPaKnown({ ...row, hp: '' }), true) // PA is independently recorded
  assert.equal(battingPaKnown({ ...row, hp: 'bad', pa: '10' }), false) // known components exceed PA
})

test('PA qualifying uses each club’s games, all MLB stints, and excludes missing PA or team games', () => {
  const bat = [batting(1, 1, 130), batting(2, 1, 131), batting(3, 2, 136), batting(4, 2, 137),
    batting(5, 1, 55), batting(5, 2, 82, { stint: '1' }),
    batting(6, 1, 55), batting(6, 2, 81, { stint: '1' }),
    batting(7, 1, 600, { year: '2026', hr: '99' }), batting(8, 1, 600, { league_id: '204', hr: '99' }),
    batting(9, 9, 180, { hr: '45' }), { ...batting(10, 1, 180), paKnown: false }]
  const out = leaders(bat, [], new Map([[1, 42], [2, 44]]), new Map([[5, 2], [6, 2]]))
  assert.deepEqual(out.batting.avg.map((e) => e.playerId).sort((a, b) => a - b), [2, 4, 5])
  assert.deepEqual(out.batting.ops.map((e) => e.playerId).sort((a, b) => a - b), [2, 4, 5])
  assert.equal(out.batting.hr[0].playerId, 9) // counting boards do not require team games
  assert.equal(out.batting.hr[0].value, 45)
  assert.ok(out.batting.hr.find((e) => e.playerId === 5 && e.value === 4)) // both stints
  assert.ok(!out.batting.hr.some((e) => e.playerId === 7 || e.playerId === 8))
})

test('fractional 3.1-PA cutoffs round up naturally at 43 and 45 team games', () => {
  const rows = [batting(1, 1, 133), batting(2, 1, 134), batting(3, 2, 139), batting(4, 2, 140)]
  const out = leaders(rows, [], new Map([[1, 43], [2, 45]]))
  assert.deepEqual(out.batting.avg.map((r) => r.playerId).sort((a, b) => a - b), [2, 4])
})

test('outs prefer the export’s exact outs, validate consistency, and interpret baseball fractions', () => {
  assert.equal(pitchingOuts({ ip: '43', outs: '131' }), 131)
  assert.equal(pitchingOuts({ ip: '44', outs: '132' }), 132)
  assert.equal(pitchingOuts({ ip: '44', outs: '133' }), 133)
  assert.equal(pitchingOuts({ ip: '43.2' }), 131)
  assert.equal(pitchingOuts({ ip: '44.1', outs: '133' }), 133)
  assert.equal(pitchingOuts({ ip: '44.1', outs: '134' }), null)
  assert.equal(pitchingOuts({ ip: '44.3' }), null)
  assert.equal(pitchingOuts({ ip: '44', outs: '' }), null) // integer might be truncated
})

test('pitcher eligibility compares exact combined outs at the boundary and rates use those outs', () => {
  const pit = [pitching(1, 2, 131), pitching(2, 2, 132, { er: '10', ha: '30', bb: '14' }),
    pitching(3, 2, 133), pitching(4, 1, 58), pitching(4, 2, 74),
    pitching(5, 2, 150, { outs: 'bad' }), pitching(6, 9, 160, { k: '100' })]
  const out = leaders([], pit, new Map([[1, 42], [2, 44]]), new Map([[4, 2]]))
  assert.deepEqual(out.pitching.era.map((e) => e.playerId).sort((a, b) => a - b), [2, 3, 4])
  assert.equal(out.pitching.era.find((e) => e.playerId === 2)?.value, 2.05)
  assert.equal(out.pitching.whip.find((e) => e.playerId === 2)?.value, 1)
  assert.equal(out.pitching.era.find((e) => e.playerId === 4)?.value, 2.05)
  assert.equal(out.pitching.ip.find((e) => e.playerId === 3)?.value, 44.1)
  assert.equal(out.pitching.ip.find((e) => e.playerId === 4)?.value, 44)
  assert.equal(out.pitching.ip.some((e) => e.playerId === 5), false)
  assert.equal(out.pitching.k[0].playerId, 6)
  assert.equal(out.pitching.k.find((e) => e.playerId === 4)?.value, 40)
})

test('an ambiguous traded pitcher or absent current-club games never gets a guessed qualifier', () => {
  const twoStints = [pitching(1, 1, 70), pitching(1, 2, 70)] // both stint 0
  assert.deepEqual(leaders([], twoStints).pitching.era, [])
  assert.equal(leaders([], twoStints, new Map([[1, 42], [2, 44]]), new Map([[1, 2]])).pitching.era.length, 1)
  assert.deepEqual(leaders([], twoStints, new Map([[1, 42]]), new Map([[1, 2]])).pitching.era, [])
  assert.ok(leaders([], twoStints).pitching.k.length > 0)
})

test('competition ranks use displayed precision and include all ties at the tenth slot', () => {
  const bat = [batting(1, 1, 150, { hr: '11', h: '45', war: '1.03' }),
    ...Array.from({ length: 11 }, (_, i) => batting(i + 2, 1, 150, { hr: '10', h: '45', war: '1.04' }))]
  const pit = [pitching(20, 2, 132), pitching(21, 2, 133)] // both display 1.02 ERA
  const out = leaders(bat, pit)
  assert.deepEqual(out.batting.hr.map((e) => e.rank), [1, ...Array(11).fill(2)])
  assert.ok(out.batting.avg.every((e) => e.rank === 1 && e.value === 0.3))
  assert.ok(out.batting.war.every((e) => e.rank === 1 && e.value === 1))
  assert.deepEqual(out.pitching.era.map((e) => [e.rank, e.value]), [[1, 1.02], [1, 1.02]])
})

test('batting rates require their own complete raw inputs in every MLB stint', () => {
  assert.equal(battingRateKnown({ ab: '150' }).avg, false) // absent h column
  assert.equal(battingRateKnown({ ab: '150', h: '45' }).ops, false) // absent OPS columns
  for (const invalid of ['', 'bad', '-1', '1.5', '9007199254740992']) {
    const noHits = leaders([batting(1, 1, 150, { h: invalid })])
    assert.equal(noHits.batting.avg.length, 0, `AVG with h=${invalid}`)
    assert.equal(noHits.batting.ops.length, 0, `OPS with h=${invalid}`)
    assert.equal(noHits.batting.hr[0].value, 2)
    assert.equal(noHits.batting.war[0].value, 0)
    for (const field of ['d', 't', 'hr', 'bb', 'hp', 'sf']) {
      const out = leaders([batting(1, 1, 150, { [field]: invalid })])
      assert.equal(out.batting.avg.length, 1, `AVG should not depend on ${field}=${invalid}`)
      assert.equal(out.batting.ops.length, 0, `OPS with ${field}=${invalid}`)
      assert.equal(out.batting.war[0].value, 0)
    }
  }
  const incompleteStint = leaders([batting(1, 1, 70), batting(1, 2, 80, { stint: '1', d: '' })])
  assert.equal(incompleteStint.batting.avg.length, 1)
  assert.equal(incompleteStint.batting.ops.length, 0)
  assert.equal(incompleteStint.batting.hr[0].value, 4)
  const zero = leaders([batting(2, 1, 150, { h: '0', d: '0', t: '0', hr: '0' })])
  assert.equal(zero.batting.avg[0].value, 0)
  assert.equal(zero.batting.ops[0].value, 0)
  assert.deepEqual(leaders([batting(3, 1, 150, { pa: '' })]).batting.avg, [])
  assert.deepEqual(leaders([batting(3, 1, 150, { ab: '' })]).batting.avg, [])
})

test('pitching rates require their own raw numerator inputs in every MLB stint', () => {
  assert.deepEqual(pitchingRateKnown({}), { era: false, whip: false })
  for (const invalid of ['', 'bad', '-1', '1.5', '9007199254740992']) {
    const noEr = leaders([], [pitching(1, 1, 126, { er: invalid })])
    assert.equal(noEr.pitching.era.length, 0, `ERA with er=${invalid}`)
    assert.equal(noEr.pitching.whip.length, 1)
    assert.equal(noEr.pitching.k[0].value, 20)
    for (const field of ['ha', 'bb']) {
      const out = leaders([], [pitching(1, 1, 126, { [field]: invalid })])
      assert.equal(out.pitching.era.length, 1, `ERA should not depend on ${field}=${invalid}`)
      assert.equal(out.pitching.whip.length, 0, `WHIP with ${field}=${invalid}`)
      assert.equal(out.pitching.k[0].value, 20)
    }
  }
  const incompleteStint = leaders([], [pitching(1, 1, 60), pitching(1, 2, 72, { ha: '' })],
    new Map([[1, 42], [2, 44]]), new Map([[1, 2]]))
  assert.equal(incompleteStint.pitching.era.length, 1)
  assert.equal(incompleteStint.pitching.whip.length, 0)
  assert.equal(incompleteStint.pitching.k[0].value, 40)
  const zero = leaders([], [pitching(2, 1, 126, { er: '0', ha: '0', bb: '0' })])
  assert.equal(zero.pitching.era[0].value, 0)
  assert.equal(zero.pitching.whip[0].value, 0)
})

test('WAR sums unrounded source values across traded stints before display ranking', () => {
  const bat = [batting(1, 1, 70, { war: '0.6746' }), batting(1, 2, 80, { stint: '1', war: '1.7523' }),
    batting(2, 1, 150, { war: '2.45' }), batting(3, 1, 150, { war: '-0.1234' })]
  const pit = [pitching(4, 1, 60, { war: '0.6746' }), pitching(4, 2, 72, { war: '1.7523' }),
    pitching(5, 1, 126, { war: '2.45' }), pitching(6, 1, 126, { war: '-0.1234' })]
  const out = leaders(bat, pit, undefined, new Map([[1, 2], [4, 2]]))
  assert.deepEqual(out.batting.war.map((r) => [r.playerId, r.value, r.rank]), [[2, 2.5, 1], [1, 2.4, 2], [3, -0.1, 3]])
  assert.deepEqual(out.pitching.war.map((r) => [r.playerId, r.value, r.rank]), [[5, 2.5, 1], [4, 2.4, 2], [6, -0.1, 3]])
  assert.equal(out.batting.avg.find((r) => r.playerId === 1)?.teamId, 2)
  assert.equal(out.pitching.era.find((r) => r.playerId === 4)?.teamId, 2)
})

test('missing, malformed, or nonfinite raw WAR is excluded only from that board', () => {
  for (const invalid of ['', ' ', 'NULL', 'bad', '0x10', '1.2.3', 'Infinity', '1e999']) {
    assert.equal(leaderRawWar({ war: invalid }), null)
    const bat = [batting(1, 1, 70, { war: '0.5' }), batting(1, 2, 80, { stint: '1', war: invalid })]
    const pit = [pitching(2, 1, 60, { war: '0.5' }), pitching(2, 2, 72, { war: invalid })]
    const out = leaders(bat, pit, undefined, new Map([[1, 2], [2, 2]]))
    assert.deepEqual(out.batting.war, [], `batting WAR with ${invalid}`)
    assert.deepEqual(out.pitching.war, [], `pitching WAR with ${invalid}`)
    assert.equal(out.batting.avg.length, 1)
    assert.equal(out.batting.hr[0].value, 4)
    assert.equal(out.pitching.era.length, 1)
    assert.equal(out.pitching.k[0].value, 40)
  }
  assert.equal(leaderRawWar({}), null)
  assert.equal(leaderRawWar({ war: '0' }), 0)
  assert.equal(leaderRawWar({ war: ' -0.1234 ' }), -0.1234)
})

test('metadata exposes the qualification contract and missing team games exclude rate qualifiers', () => {
  const out = leaders([batting(1, 9, 180)], [pitching(2, 9, 150)])
  assert.equal(out.meta.qualificationVersion, 1)
  assert.deepEqual(out.batting.avg, [])
  assert.deepEqual(out.batting.ops, [])
  assert.deepEqual(out.pitching.era, [])
  assert.deepEqual(out.pitching.whip, [])
  assert.equal(out.batting.hr.length, 1)
  assert.equal(out.pitching.k.length, 1)
})
