import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { FILES, parseLeagueId } from './schema'
import { batterLine, pitcherLine, reportDateLabel } from '../../src/lib/selectors'
import type { PlayerDetail } from '../../src/lib/types'
import { toBattingSeason, toPitchingSeason } from './normalize'

const project = process.cwd()
const importer = resolve(project, 'scripts/import/run.ts')
const python = resolve(project, 'scripts/import/extract-bnn.py')
const tempDir = () => mkdtempSync(join(project, '.template-test-'))
const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'))

function fixture(root: string) {
  const input = join(root, 'csv')
  mkdirSync(input, { recursive: true })
  for (const file of Object.values(FILES)) writeFileSync(join(input, file), 'placeholder\n')
  const csv = (file: string, columns: string[], rows: (string | number)[][]) =>
    writeFileSync(join(input, file), [columns.join(','), ...rows.map((row) => row.join(','))].join('\n') + '\n')
  csv(FILES.leagues, ['league_id', 'name', 'abbr', 'league_level', 'current_date'], [
    [203, 'Legacy League', 'OLD', 1, '2032-06-01'], [777, 'Fiction League', 'FIC', 1, '2032-06-01'],
    [778, 'Fiction Minor', 'MIN', 2, '2032-06-01'], [204, 'Legacy Minor', 'MIN', 2, '2032-06-01'],
  ])
  csv(FILES.teams, ['team_id', 'name', 'nickname', 'abbr', 'league_id', 'level', 'parent_team_id'], [
    [1, 'Oldvale', 'Owls', 'OLD', 203, 1, 0], [2, 'Mockton', 'Moths', 'MOC', 777, 1, 0],
    [3, 'Mockton', 'Minors', 'MMI', 778, 2, 2], [4, 'Oldvale', 'Minors', 'OMI', 204, 2, 1],
  ])
  csv(FILES.teamRecord, ['team_id', 'g', 'w', 'l', 't', 'pct'], [[1, 20, 10, 10, 0, '.500'], [2, 20, 11, 9, 0, '.550']])
  csv(FILES.rosterStatus, ['player_id', 'team_id', 'is_active', 'position'], [[101, 2, 1, 6], [102, 1, 1, 6], [103, 3, 1, 6], [104, 4, 1, 6]])
  csv(FILES.players, ['player_id', 'first_name', 'last_name', 'age', 'position', 'team_id', 'league_id', 'bats', 'throws'], [
    [101, 'Fable', 'Hero', 25, 6, 2, 777, 1, 1], [102, 'Old', 'Hero', 25, 6, 1, 203, 1, 1],
    [103, 'Nora', 'Fiction', 20, 6, 3, 778, 1, 1], [104, 'Legacy', 'Fiction', 20, 6, 4, 204, 1, 1],
  ])
  const ratings = ['player_id', ...['contact', 'gap', 'power', 'eye'].flatMap((k) => [`batting_ratings_overall_${k}`, `batting_ratings_talent_${k}`])]
  csv(FILES.playerBattingRatings, ratings, [101, 102, 103, 104].map((id) => [id, ...Array(8).fill(60)]))
  csv(FILES.careerBatting, ['player_id', 'year', 'league_id', 'team_id', 'split_id', 'stint', 'g', 'ab', 'pa', 'h', 'd', 't', 'hr', 'rbi', 'bb', 'hp', 'sf', 'sh', 'war'], [
    [101, 2032, 777, 2, 1, 0, 20, 100, 100, 45, 0, 0, 40, 100, 0, 0, 0, 0, 2],
    [101, 2031, 777, 2, 1, 0, 10, 30, 30, 10, 0, 0, 3, 5, 0, 0, 0, 0, 1],
    [101, 2030, 778, 3, 1, 0, 10, 100, 100, 40, 0, 0, 30, 35, 0, 0, 0, 0, 1],
    [102, 2032, 203, 1, 1, 0, 20, 100, 100, 45, 0, 0, 35, 100, 0, 0, 0, 0, 2],
  ])
  return input
}

function report(leagueId = 777) {
  return { schemaVersion: 1, reportDate: '2032-06-01', leagueId, source: 'Invented report', sourceSha256: 'a'.repeat(64), note: 'Synthetic fixture',
    entries: Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, name: i === 0 ? 'Nora Fiction' : `Fictional Player${i + 1}`,
      reportPlayerId: i + 1, organizationId: 2, organization: 'Mockton', age: 20, position: 'SS', level: 'AAA' })) }
}

function run(root: string, input: string, out: string, extra: string[] = [], league?: string) {
  const env = { ...process.env }
  if (league === undefined) delete env.OOTP_LEAGUE_ID
  else env.OOTP_LEAGUE_ID = league
  return spawnSync(process.execPath, ['--import', 'tsx', importer, '--in', input, '--out', out, ...extra], { cwd: root, env, encoding: 'utf8' })
}

test('league ID parsing accepts only positive safe integers, with historical default', () => {
  assert.equal(parseLeagueId(undefined), 203)
  assert.equal(parseLeagueId('777'), 777)
  for (const bad of ['', '0', '-1', '1.5', '1e3', ' 777', 'x', '9007199254740992']) assert.throws(() => parseLeagueId(bad), /positive safe integer/)
})

test('frontend career selectors accept the bundle league rather than assuming 203', () => {
  const player = { batting: [toBattingSeason({ league_id: '203', hr: '90' }), toBattingSeason({ league_id: '777', hr: '4' })],
    pitching: [toPitchingSeason({ league_id: '203', k: '99' }), toPitchingSeason({ league_id: '777', k: '7' })] } as PlayerDetail
  assert.equal(batterLine(player, 777)?.hr, 4)
  assert.equal(pitcherLine(player, 777)?.k, 7)
  assert.equal(batterLine(player, 203)?.hr, 90)
  assert.equal(pitcherLine(player, 404), null)
})

test('frontend report dates never fabricate a date when missing or invalid', () => {
  assert.equal(reportDateLabel(undefined), 'date unavailable')
  assert.equal(reportDateLabel('2032-02-30'), 'date unavailable')
  assert.equal(reportDateLabel('2032-06-01'), 'June 1, 2032')
})

test('whole importer handles default and configured leagues, report opt-in, strict errors and fresh outputs', () => {
  const root = tempDir()
  try {
    const input = fixture(root), reportFile = join(root, 'bnn.json')
    let sequence = 0
    const nextOut = () => join(root, `out-${++sequence}`)
    let out = nextOut()
    let result = run(root, input, out)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read(out, 'meta.json').mlbLeagueId, 203)
    assert.deepEqual(read(out, 'prospects.json').map((p: { name: string }) => p.name), ['Legacy Fiction'])
    assert.equal(existsSync(join(out, 'bnn-rank.json')), false)

    out = nextOut()
    result = run(root, input, out, [], '777')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read(out, 'meta.json').mlbLeagueId, 777)
    assert.deepEqual(read(out, 'mlb/standings.json').map((r: { teamId: number }) => r.teamId), [2])
    const board = read(out, 'prospects.json')
    assert.deepEqual(board.map((p: { name: string }) => p.name), ['Nora Fiction'])
    assert.equal(board[0].bnnRank, null)
    assert.equal(read(out, 'mlb/leaders.json').batting.hr[0].value, 40)
    assert.match(read(out, 'news.json').find((n: { kind: string }) => n.kind === 'performance').headline, /40 home runs/)
    const player = read(out, 'mlb/players/5.json').find((p: { id: number }) => p.id === 101)
    assert.equal(player.careerBatting.hr, 43)
    assert.ok(read(out, 'mlb/history/5.json')['101'].batting.some((line: { leagueId: number }) => line.leagueId === 778))

    writeFileSync(reportFile, JSON.stringify(report()))
    out = nextOut()
    result = run(root, input, out, ['--bnn', reportFile], '777')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read(out, 'prospects.json')[0].bnnRank, 1)
    assert.equal(read(out, 'bnn-rank.json').leagueId, 777)
    const withBnn = out
    out = nextOut()
    result = run(root, input, out, [], '777')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read(out, 'prospects.json')[0].bnnRank, null)
    assert.equal(existsSync(join(out, 'bnn-rank.json')), false)
    assert.equal(read(withBnn, 'bnn-rank.json').leagueId, 777)

    out = nextOut()
    result = run(root, input, out, ['--league-id', '203'], '777')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read(out, 'meta.json').mlbLeagueId, 203)
    assert.notEqual(run(root, input, nextOut(), [], '0').status, 0)
    assert.notEqual(run(root, input, nextOut(), ['--league-id'], '777').status, 0)
    assert.notEqual(run(root, input, nextOut(), ['--bnn', join(root, 'missing.json')], '777').status, 0)
    writeFileSync(reportFile, '{"schemaVersion":1}')
    assert.notEqual(run(root, input, nextOut(), ['--bnn', reportFile], '777').status, 0)
    writeFileSync(reportFile, JSON.stringify(report(203)))
    const wrongLeague = run(root, input, nextOut(), ['--bnn', reportFile], '777')
    assert.notEqual(wrongLeague.status, 0)
    assert.match(wrongLeague.stderr, /does not match primary league/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('extractor records configured league and rejects invalid IDs', () => {
  const root = tempDir()
  try {
    const html = join(root, 'report.html'), output = join(root, 'report.json')
    const rows = Array.from({ length: 100 }, (_, i) => `<tr><td>${i + 1}</td><td><a href="/players/player_${i + 1}.html">Fiction ${i + 1}</a></td><td><a href="/teams/team_2.html">Mockton</a></td><td>20</td><td>SS</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>AAA</td></tr>`).join('\n')
    writeFileSync(html, `<div>ANNUAL TOP 100 PROSPECTS</div><div>06/01/2032</div><table>${rows}</table>`)
    const extract = (args: string[], value: string) => spawnSync('python3', [python, html, output, ...args], { cwd: root, env: { ...process.env, OOTP_LEAGUE_ID: value }, encoding: 'utf8' })
    assert.equal(extract([], '777').status, 0)
    assert.equal(read(root, 'report.json').leagueId, 777)
    assert.match(read(root, 'report.json').source, /777/)
    assert.equal(extract(['--league-id', '203'], '777').status, 0)
    assert.equal(read(root, 'report.json').leagueId, 203)
    assert.notEqual(extract([], '0').status, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
