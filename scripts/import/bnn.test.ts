import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { loadBnnSnapshot, matchBnn, normalizeBnnName, type BnnCandidate, type BnnEntry, type BnnSnapshot } from './bnn'
import { buildProspects, compareProspects, type RatingRow } from './prospects'
import type { Prospect, Team } from '../../src/lib/types'

const entry = (rank: number, name: string, overrides: Partial<BnnEntry> = {}): BnnEntry => ({
  rank, name, reportPlayerId: rank, organizationId: 1, organization: 'Mockton',
  age: 20, position: 'SS', level: 'AAA', ...overrides,
})
const snapshot = (entries: BnnEntry[]): BnnSnapshot => ({
  schemaVersion: 1, reportDate: '2027-05-19', source: 'test', sourceSha256: '0'.repeat(64), note: 'test', entries,
})
const candidate = (id: number, name: string, overrides: Partial<BnnCandidate> = {}): BnnCandidate => ({
  id, name, age: 20, position: 'SS', orgId: 1, orgCity: 'Mockton', ...overrides,
})

const fabricatedReport = (): BnnSnapshot => snapshot(Array.from({ length: 100 }, (_, i) => entry(i + 1, `Fictional Player${i + 1}`)))

test('a synthetic report has exactly the 1–100 global ranks', () => {
  const dir = mkdtempSync(join(process.cwd(), '.bnn-test-'))
  try {
    const file = join(dir, 'snapshot.json')
    writeFileSync(file, JSON.stringify(fabricatedReport()))
    const source = loadBnnSnapshot(file)
    assert.match(source.reportDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.deepEqual(source.entries.map((row) => row.rank), Array.from({ length: 100 }, (_, i) => i + 1))
    assert.ok(source.entries.every((row) => row.name.trim() && row.position.trim()))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a missing, incomplete or duplicate-rank snapshot fails closed', () => {
  const source = fabricatedReport()
  const dir = mkdtempSync(join(process.cwd(), '.bnn-test-'))
  const file = join(dir, 'snapshot.json')
  try {
    assert.throws(() => loadBnnSnapshot(file))
    writeFileSync(file, JSON.stringify({ ...source, entries: source.entries.slice(0, 99) }))
    assert.throws(() => loadBnnSnapshot(file), /exactly 100/)
    const entries = source.entries.map((e) => ({ ...e }))
    entries[99].rank = 1
    writeFileSync(file, JSON.stringify({ ...source, entries }))
    assert.throws(() => loadBnnSnapshot(file), /Invalid or duplicate/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('case, accents and punctuation normalize but suffixes are preserved', () => {
  assert.equal(normalizeBnnName('José O’Neil Jr.'), normalizeBnnName('Jose ONeil Jr'))
  assert.notEqual(normalizeBnnName('Eric Booth Jr.'), normalizeBnnName('Eric Booth'))
})

test('report IDs alone cannot match, and different IDs match only with compatible identity', () => {
  const list = [entry(1, 'Alex Smith', { reportPlayerId: 10 }), entry(2, 'Mílo Thistlebop', { reportPlayerId: 99 })]
  const result = matchBnn(snapshot(list), [candidate(10, 'Wrong Person'), candidate(22, 'Milo Thistlebop')], '2027-04-30')
  assert.equal(result.unmatched.length, 1)
  assert.equal(result.unmatched[0].entry.name, 'Alex Smith')
  assert.equal(result.byPlayerId.get(22)?.rank, 2)
  assert.equal(result.byPlayerId.has(10), false)
})

test('age and pitcher/batter category guard a name match', () => {
  const e = entry(1, 'Alex Smith', { position: 'SP', age: 20 })
  const no = matchBnn(snapshot([e]), [candidate(1, 'Alex Smith', { position: 'P', age: 25 }), candidate(2, 'Alex Smith')], '2027-04-30')
  assert.equal(no.byPlayerId.size, 0)
  assert.equal(no.unmatched.length, 1)
  const yes = matchBnn(snapshot([e]), [candidate(1, 'Alex Smith', { position: 'P', age: 19 })], '2027-04-30')
  assert.equal(yes.byPlayerId.get(1)?.rank, 1)
  const reversed = matchBnn(snapshot([e]), [candidate(1, 'Alex Smith', { position: 'P', age: 21 })], '2027-04-30')
  assert.equal(reversed.byPlayerId.size, 0)
  assert.throws(() => matchBnn(snapshot([e]), [], 'unknown'), /valid snapshot and CSV dates/)
})

test('duplicate names require a unique age/role or matching organization and city, never player ID alone', () => {
  const e = entry(1, 'Luis Hernandez', { reportPlayerId: 1 })
  const unresolved = matchBnn(snapshot([e]), [candidate(1, e.name, { orgId: 2 }), candidate(2, e.name, { orgId: 3 })], '2027-04-30')
  assert.equal(unresolved.byPlayerId.size, 0)
  assert.equal(unresolved.ambiguous.length, 1)
  const resolved = matchBnn(snapshot([e]), [candidate(1, e.name, { orgId: 2 }), candidate(2, e.name)], '2027-04-30')
  assert.equal(resolved.byPlayerId.get(2)?.rank, 1)
  const wrongCity = matchBnn(snapshot([e]), [candidate(1, e.name, { orgCity: 'New York' }), candidate(2, e.name, { orgId: 3 })], '2027-04-30')
  assert.equal(wrongCity.ambiguous.length, 1)
})

test('two report entries claiming the same candidate are both rejected', () => {
  const rows = [entry(1, 'Alex Smith'), entry(2, 'Alex Smith')]
  const result = matchBnn(snapshot(rows), [candidate(33, 'Alex Smith')], '2027-04-30')
  assert.equal(result.byPlayerId.size, 0)
  assert.equal(result.ambiguous.length, 2)
})

test('fallback ties break by name, matching the board display', () => {
  const a = { id: 1, name: 'Zed', score: 60, bnnRank: null } as Prospect
  const b = { id: 2, name: 'Amy', score: 60, bnnRank: null } as Prospect
  assert.deepEqual([a, b].sort(compareProspects).map((p) => p.name), ['Amy', 'Zed'])
})

const team = (id: number, level: number, parentTeamId: number): Team => ({
  id, city: 'Mockton', nickname: 'Test', abbr: 'TST', leagueId: 203, subLeagueId: 1, divisionId: 1,
  level, parentTeamId, colors: { primary: '#000', secondary: '#fff' },
})
const rating = (id: number, grade: number): RatingRow => ({
  playerId: id, kind: 'bat', current: grade, potential: grade,
  tools: { contact: grade, power: grade, eye: grade, gap: grade },
  potentialTools: { contact: grade, power: grade, eye: grade, gap: grade },
})

test('verified BNN players precede higher grades, include MLB, and survive a small limit', () => {
  const players = [
    { id: 1, firstName: 'High', lastName: 'Grade', age: 20, position: 'SS', positionCode: 6, teamId: 2, nation: '', bats: 'R', throws: 'R' },
    { id: 2, firstName: 'Official', lastName: 'Two', age: 20, position: 'SS', positionCode: 6, teamId: 2, nation: '', bats: 'R', throws: 'R' },
    { id: 3, firstName: 'Official', lastName: 'One', age: 31, position: 'SS', positionCode: 6, teamId: 1, nation: '', bats: 'R', throws: 'R' },
    { id: 4, firstName: 'Lower', lastName: 'Grade', age: 20, position: 'SS', positionCode: 6, teamId: 2, nation: '', bats: 'R', throws: 'R' },
    { id: 5, firstName: 'Veteran', lastName: 'NotOfficial', age: 30, position: 'SS', positionCode: 6, teamId: 1, nation: '', bats: 'R', throws: 'R' },
  ]
  const input = {
    players, ratings: new Map(players.map((p) => [p.id, rating(p.id, p.id === 1 ? 80 : p.id === 4 ? 60 : 25)])),
    teams: new Map([[1, team(1, 1, 0)], [2, team(2, 2, 1)]]),
    orgOf: () => 1, lines: new Map(), leagues: new Map(), mlbGames: new Map([[3, 500]]),
    bnnMatches: new Map([[2, entry(2, 'Official Two')], [3, entry(1, 'Official One', { position: '3B' })]]),
  }
  const all = buildProspects({ ...input, limit: 10 })
  assert.deepEqual(all.map((p) => p.id), [3, 2, 1, 4])
  assert.deepEqual(all.map((p) => p.rank), [1, 2, 3, 4])
  assert.deepEqual(all.map((p) => p.bnnRank), [1, 2, null, null])
  assert.equal(all[0].bnnPosition, '3B')
  assert.deepEqual(buildProspects({ ...input, limit: 1 }).map((p) => p.id), [3, 2])
  const missingRating = buildProspects({ ...input, ratings: new Map([[2, rating(2, 25)]]), limit: 10 })
  assert.deepEqual(missingRating.map((p) => p.id), [2])
})
