import assert from 'node:assert/strict'
import test from 'node:test'
import { exactPitchingOuts } from './csv'
import { toPitchingSeason, toTeamStats } from './normalize'
import { combinePitching, currentSeasonLines, ip, pitchingRate } from '../../src/lib/selectors'

const row = (values: Record<string, string> = {}) => ({
  year: '2027', league_id: '203', team_id: '1', stint: '0', g: '10', gs: '5',
  er: '20', ha: '40', bb: '10', k: '50', ...values,
})

test('player normalization prefers exact outs and retains mathematical innings', () => {
  const first = toPitchingSeason(row({ ip: '57', ipf: '1', outs: '172' }))
  const second = toPitchingSeason(row({ ip: '63', ipf: '2', outs: '191' }))
  assert.equal(first.outs, 172)
  assert.equal(first.ip, 172 / 3)
  assert.equal(ip(first.ip, first.outs), '57.1')
  assert.equal(second.outs, 191)
  assert.equal(second.ip, 191 / 3)
  assert.equal(ip(second.ip, second.outs), '63.2')
  assert.equal(first.era, Number((20 * 27 / 172).toFixed(2)))
  assert.equal(first.whip, Number((50 * 3 / 172).toFixed(2)))
  assert.equal(second.era, Number((20 * 27 / 191).toFixed(2)))
  assert.equal(second.whip, Number((50 * 3 / 191).toFixed(2)))
  assert.equal(toPitchingSeason(row({ ip: '57', ipf: '7', outs: '172' })).outs, 172)
  assert.equal(toPitchingSeason(row({ outs: '172' })).outs, 172)
})

test('team uses ipf as remaining outs and recomputes ERA and WHIP', () => {
  const team = toTeamStats({ team_id: '1' }, row({ ip: '63', ipf: '2', era: '99', whip: '99' })).pitching
  assert.equal(team.outs, 191)
  assert.equal(team.ip, 191 / 3)
  assert.equal(ip(team.ip, team.outs), '63.2')
  assert.equal(team.era, Number((20 * 27 / 191).toFixed(2)))
  assert.equal(team.whip, Number((50 * 3 / 191).toFixed(2)))
})

test('combines current stints across teams without including other years or leagues', () => {
  const a = toPitchingSeason(row({ ip: '57', outs: '172', team_id: '1' }))
  const b = toPitchingSeason(row({ ip: '63', outs: '191', team_id: '2', stint: '1' }))
  const old = toPitchingSeason(row({ ip: '100', outs: '300', year: '2026' }))
  const minors = toPitchingSeason(row({ ip: '100', outs: '300', league_id: '204' }))
  const lines = [a, b, old, minors]
  const total = combinePitching(currentSeasonLines(lines, 2027, 203))!
  assert.equal(total.outs, 363)
  assert.equal(total.ip, 121)
  assert.equal(ip(total.ip, total.outs), '121.0')
  assert.equal(total.era, Number((40 * 27 / 363).toFixed(2)))
  assert.equal(total.whip, Number((100 * 3 / 363).toFixed(2)))
  assert.deepEqual(currentSeasonLines(lines, 2027, 203, 2), [b])
  assert.equal(combinePitching([]), null)
})

test('missing and unsupported legacy rows are not claimed as exact', () => {
  const missing = toPitchingSeason(row())
  assert.equal(missing.ip, 0)
  assert.equal(missing.outs, undefined)
  assert.equal(missing.ipMissing, true)
  assert.equal(ip(missing.ip, missing.outs, missing.ipMissing), '—')
  assert.equal(pitchingRate(missing.era, missing.outs, missing.ipMissing), '—')
  const legacy = toPitchingSeason(row({ ip: '57' }))
  assert.equal(legacy.ip, 57)
  assert.equal(legacy.outs, undefined)
  assert.equal(ip(legacy.ip, legacy.outs), '~57.0')
  assert.equal(pitchingRate(legacy.era, legacy.outs), `~${legacy.era.toFixed(2)}`)
  assert.equal(exactPitchingOuts(row({ ip: '57', ipf: '7' })), undefined)
  assert.equal(exactPitchingOuts(row({ ip: '57', outs: 'bad', ipf: '1' })), undefined)
  assert.equal(exactPitchingOuts(row({ ip: '57.1' })), 172)
  assert.equal(ip(undefined), '—')
  const mixed = combinePitching([legacy, toPitchingSeason(row({ ip: '63', outs: '191' }))])!
  assert.equal(mixed.outs, undefined)
  assert.equal(ip(mixed.ip, mixed.outs), '~120.2')
  const partlyMissing = combinePitching([missing, legacy])!
  assert.equal(ip(partlyMissing.ip, partlyMissing.outs, partlyMissing.ipMissing), '—')
  const legacyTeam = toTeamStats({ team_id: '1' }, row({ ip: '57', era: '3.14', whip: '1.22' })).pitching
  assert.equal(legacyTeam.era, 3.14)
  assert.equal(legacyTeam.whip, 1.22)
})
