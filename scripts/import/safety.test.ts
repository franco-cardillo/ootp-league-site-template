import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { FILES } from './schema'
import { loadExplicitGameRatings, reserveOutputDirectory, writeImportReport } from './safety'

const project = process.cwd()
const importer = resolve(project, 'scripts/import/run.ts')
const tempDir = () => mkdtempSync(join(project, '.import-safety-test-'))
const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'))

function fixture(root: string) {
  const input = join(root, 'csv')
  mkdirSync(input, { recursive: true })
  for (const file of Object.values(FILES)) writeFileSync(join(input, file), 'placeholder\n')
  const csv = (file: string, columns: string[], rows: (string | number)[][]) =>
    writeFileSync(join(input, file), [columns.join(','), ...rows.map((row) => row.join(','))].join('\n') + '\n')
  csv(FILES.leagues, ['league_id', 'name', 'abbr', 'league_level', 'current_date'], [
    [203, 'Made-up League', 'ML', 1, '2032-06-01'], [204, 'Made-up Minor', 'MIN', 2, '2032-06-01'],
  ])
  csv(FILES.teams, ['team_id', 'name', 'nickname', 'abbr', 'league_id', 'level', 'parent_team_id'], [
    [1, 'Myth City', 'Birds', 'MCB', 203, 1, 0], [2, 'Myth City', 'Young Birds', 'MCY', 204, 2, 1],
  ])
  csv(FILES.teamRecord, ['team_id', 'g', 'w', 'l', 't', 'pct'], [[1, 10, 5, 5, 0, '.500']])
  csv(FILES.rosterStatus, ['player_id', 'team_id', 'is_active', 'position'], [[42, 2, 1, 6]])
  csv(FILES.players, ['player_id', 'first_name', 'last_name', 'age', 'position', 'team_id', 'league_id', 'bats', 'throws'], [
    [42, 'Fictional', 'Player', 20, 6, 2, 204, 1, 1],
  ])
  const ratings = ['player_id', ...['contact', 'gap', 'power', 'eye'].flatMap((k) => [`batting_ratings_overall_${k}`, `batting_ratings_talent_${k}`])]
  csv(FILES.playerBattingRatings, ratings, [[42, ...Array(8).fill(60)]])
  return input
}

function run(root: string, input: string, out: string, extra: string[] = []) {
  const env = { ...process.env }
  delete env.OOTP_LEAGUE_ID
  return spawnSync(process.execPath, ['--import', 'tsx', importer, '--in', input, '--out', out, ...extra], { cwd: root, env, encoding: 'utf8' })
}

test('output reservation never deletes or overwrites an existing tree; empty output cannot be reserved twice', () => {
  const root = tempDir()
  try {
    const source = join(root, 'input'), output = join(root, 'output')
    mkdirSync(source); mkdirSync(output)
    writeFileSync(join(output, 'keep.txt'), 'prior save')
    assert.throws(() => reserveOutputDirectory(output, [source]), /new or empty/)
    assert.equal(readFileSync(join(output, 'keep.txt'), 'utf8'), 'prior save')
    const fresh = join(root, 'fresh')
    reserveOutputDirectory(fresh, [source])
    assert.deepEqual(readdirSync(fresh), ['.ootp-import-reserved'])
    assert.throws(() => reserveOutputDirectory(fresh, [source]), /new or empty/)
    const empty = join(root, 'empty')
    mkdirSync(empty)
    reserveOutputDirectory(empty, [source])
    assert.deepEqual(readdirSync(empty), ['.ootp-import-reserved'])
    assert.throws(() => reserveOutputDirectory(join(source, 'child'), [source]), /overlap an input/)
    assert.equal(existsSync(join(source, 'child')), false)
    const live = join(root, 'public/data')
    assert.throws(() => reserveOutputDirectory(live, [source], [live]), /protected live bundle/)
    assert.throws(() => reserveOutputDirectory(join(live, 'child'), [source], [live]), /protected live bundle/)
    assert.equal(existsSync(live), false)
    symlinkSync(source, join(root, 'link'), 'dir')
    assert.throws(() => reserveOutputDirectory(join(root, 'link', 'child'), []), /symlink/)
    assert.equal(existsSync(join(source, 'child')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('ratings opt-in validates malformed snapshots instead of silently loading or ignoring them', () => {
  const root = tempDir()
  try {
    assert.deepEqual(loadExplicitGameRatings(undefined), {})
    const path = join(root, 'ratings.json')
    for (const value of [null, [], { '42': [20] }, { '42': [20, '80'] }, { x: [20, 80] }]) {
      writeFileSync(path, JSON.stringify(value))
      assert.throws(() => loadExplicitGameRatings(path), /--ratings/)
    }
    writeFileSync(path, '{')
    assert.throws(() => loadExplicitGameRatings(path), /--ratings/)
    assert.throws(() => loadExplicitGameRatings(join(root, 'missing')), /--ratings/)
    writeFileSync(path, JSON.stringify({ '42': [40, 70] }))
    assert.deepEqual(loadExplicitGameRatings(path), { '42': [40, 70] })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('report creation is exclusive, private, and refuses existing files and symlinks', () => {
  const root = tempDir()
  try {
    const stage = join(root, 'stage'), report = join(stage, 'import-report.json')
    mkdirSync(stage)
    writeImportReport(stage, { ok: true })
    assert.equal(read(stage, 'import-report.json').ok, true)
    if (process.platform !== 'win32') assert.equal(statSync(report).mode & 0o777, 0o600)
    assert.throws(() => writeImportReport(stage, { ok: false }), /EEXIST/)
    assert.equal(read(stage, 'import-report.json').ok, true)

    const target = join(root, 'unrelated.txt')
    writeFileSync(target, 'preserve me')
    rmSync(report)
    symlinkSync(target, report)
    assert.throws(() => writeImportReport(stage, { ok: false }), /EEXIST/)
    assert.equal(readFileSync(target, 'utf8'), 'preserve me')
    assert.equal(lstatSync(report).isSymbolicLink(), true)

    rmSync(report)
    const missing = join(root, 'not-created.txt')
    symlinkSync(missing, report)
    assert.throws(() => writeImportReport(stage, { ok: true }), /EEXIST/)
    assert.equal(existsSync(missing), false)
    assert.equal(lstatSync(report).isSymbolicLink(), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('success and validation failure write fresh stage reports without touching cwd reports', () => {
  const root = tempDir()
  try {
    const input = fixture(root), victim = join(root, 'unrelated.txt'), cwdReport = join(root, 'import-report.json')
    writeFileSync(victim, 'unrelated content')
    symlinkSync(victim, cwdReport)
    const success = join(root, 'successful-stage')
    const first = run(root, input, success)
    assert.equal(first.status, 0, first.stderr)
    assert.equal(read(success, 'import-report.json').ok, true)
    assert.equal(readFileSync(victim, 'utf8'), 'unrelated content')
    assert.equal(lstatSync(cwdReport).isSymbolicLink(), true)

    writeFileSync(join(input, FILES.teamRecord), 'team_id,g,w,l,t,pct\n1,10,9,9,0,.500\n')
    const failure = join(root, 'failed-stage')
    const second = run(root, input, failure)
    assert.notEqual(second.status, 0)
    assert.equal(read(failure, 'import-report.json').ok, false)
    assert.equal(read(success, 'import-report.json').ok, true)
    assert.equal(readFileSync(victim, 'utf8'), 'unrelated content')
    assert.equal(lstatSync(cwdReport).isSymbolicLink(), true)

    rmSync(cwdReport)
    writeFileSync(cwdReport, 'existing cwd report')
    const early = join(root, 'early-failure')
    const third = run(root, input, early, ['--ratings', join(root, 'missing-ratings.json')])
    assert.notEqual(third.status, 0)
    assert.equal(existsSync(join(early, 'import-report.json')), false)
    assert.equal(readFileSync(cwdReport, 'utf8'), 'existing cwd report')
    writeFileSync(join(input, FILES.teamRecord), 'team_id,g,w,l,t,pct\n1,10,5,5,0,.500\n')
    const retry = join(root, 'fresh-retry')
    const fourth = run(root, input, retry)
    assert.equal(fourth.status, 0, fourth.stderr)
    assert.equal(read(retry, 'import-report.json').ok, true)
    assert.equal(read(failure, 'import-report.json').ok, false)
    assert.equal(readFileSync(cwdReport, 'utf8'), 'existing cwd report')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a report inserted after reservation makes either report branch fail without overwriting it', () => {
  const root = tempDir()
  try {
    const input = fixture(root), victim = join(root, 'victim.txt'), preload = join(root, 'collision.cjs')
    writeFileSync(victim, 'unrelated content')
    // Model an attacker adding a file immediately before report creation, after reservation passed.
    writeFileSync(preload, `
const fs = require('node:fs');
const original = fs.writeFileSync;
fs.writeFileSync = function(path, ...args) {
  if (path === process.env.INJECT_REPORT) {
    if (process.env.INJECT_KIND === 'symlink') fs.symlinkSync(process.env.INJECT_TARGET, path);
    else original(path, 'pre-existing report');
  }
  return original.call(this, path, ...args);
};
require('node:module').syncBuiltinESMExports();
`)
    for (const invalid of [false, true]) {
      writeFileSync(join(input, FILES.teamRecord), invalid
        ? 'team_id,g,w,l,t,pct\n1,10,9,9,0,.500\n'
        : 'team_id,g,w,l,t,pct\n1,10,5,5,0,.500\n')
      for (const kind of ['file', 'symlink']) {
        const out = join(root, `collision-${invalid}-${kind}`), report = join(out, 'import-report.json')
        const env = { ...process.env, INJECT_REPORT: report, INJECT_KIND: kind, INJECT_TARGET: victim }
        delete env.OOTP_LEAGUE_ID
        const result = spawnSync(process.execPath, ['--require', preload, '--import', 'tsx', importer, '--in', input, '--out', out], { cwd: root, env, encoding: 'utf8' })
        assert.notEqual(result.status, 0, `${invalid}/${kind}: ${result.stdout}`)
        assert.match(result.stderr, /EEXIST/)
        assert.equal(readFileSync(victim, 'utf8'), 'unrelated content')
        if (kind === 'symlink') assert.equal(lstatSync(report).isSymbolicLink(), true)
        else assert.equal(readFileSync(report, 'utf8'), 'pre-existing report')
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('whole importer never reads old public ratings unless an explicit snapshot is supplied', () => {
  const root = tempDir()
  try {
    const input = fixture(root), legacy = join(root, 'public/data/mlb')
    mkdirSync(legacy, { recursive: true })
    const old = join(legacy, 'ratings.json')
    writeFileSync(old, JSON.stringify({ '42': [20, 80] }))
    const normal = join(root, 'normal')
    mkdirSync(normal) // An already-created, truly empty directory is also acceptable.
    const first = run(root, input, normal)
    assert.equal(first.status, 0, first.stderr)
    assert.equal(read(normal, 'prospects.json')[0].current, 60)
    assert.equal(read(normal, 'prospects.json')[0].potential, 60)
    assert.equal(readFileSync(old, 'utf8'), '{"42":[20,80]}')
    const priorBoard = readFileSync(join(normal, 'prospects.json'), 'utf8')
    assert.notEqual(run(root, input, normal).status, 0)
    assert.equal(readFileSync(join(normal, 'prospects.json'), 'utf8'), priorBoard)
    const explicit = join(root, 'selected-ratings.json')
    writeFileSync(explicit, JSON.stringify({ '42': [40, 70] }))
    const selected = join(root, 'selected')
    const second = run(root, input, selected, ['--ratings', explicit])
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stderr, /verify.*same|verify.*exact save/i)
    assert.equal(read(selected, 'prospects.json')[0].current, 40)
    assert.equal(read(selected, 'prospects.json')[0].potential, 70)
    assert.notEqual(run(root, input, join(root, 'missing'), ['--ratings', join(root, 'absent')]).status, 0)
    assert.notEqual(run(root, input, join(root, 'bare-flag'), ['--ratings']).status, 0)
    writeFileSync(explicit, '{"42":[40,"bad"]}')
    const invalid = run(root, input, join(root, 'invalid-ratings'), ['--ratings', explicit])
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /invalid --ratings entry/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('nonempty output is rejected before touching an existing demo or previous bundle', () => {
  const root = tempDir()
  try {
    const input = fixture(root), out = join(root, 'public/data')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'keep.json'), 'demo stays')
    const result = run(root, input, out)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /new or empty/)
    assert.deepEqual(readdirSync(out), ['keep.json'])
    assert.equal(readFileSync(join(out, 'keep.json'), 'utf8'), 'demo stays')
    const env = { ...process.env }
    delete env.OOTP_LEAGUE_ID
    const defaultOut = spawnSync(process.execPath, ['--import', 'tsx', importer, '--in', input], { cwd: root, env, encoding: 'utf8' })
    assert.notEqual(defaultOut.status, 0)
    assert.match(defaultOut.stderr, /--out is required/)
    assert.equal(readFileSync(join(out, 'keep.json'), 'utf8'), 'demo stays')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('hostile existing destinations fail before touching reports or symlink targets', () => {
  const root = tempDir()
  try {
    const input = fixture(root), victim = join(root, 'victim.txt'), cwdReport = join(root, 'import-report.json')
    writeFileSync(victim, 'untouched')
    symlinkSync(victim, cwdReport)
    const existing = join(root, 'existing')
    mkdirSync(existing)
    writeFileSync(join(existing, 'import-report.json'), '{"ok":true,"stale":true}')
    const rejected = run(root, input, existing)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /new or empty/)
    assert.equal(readFileSync(join(existing, 'import-report.json'), 'utf8'), '{"ok":true,"stale":true}')
    assert.equal(readFileSync(victim, 'utf8'), 'untouched')

    const reportLinkStage = join(root, 'report-link-stage')
    mkdirSync(reportLinkStage)
    symlinkSync(victim, join(reportLinkStage, 'import-report.json'))
    assert.notEqual(run(root, input, reportLinkStage).status, 0)
    assert.equal(lstatSync(join(reportLinkStage, 'import-report.json')).isSymbolicLink(), true)
    assert.equal(readFileSync(victim, 'utf8'), 'untouched')

    const targetDir = join(root, 'redirect-target'), linkedOut = join(root, 'linked-stage')
    mkdirSync(targetDir)
    symlinkSync(targetDir, linkedOut, 'dir')
    const linked = run(root, input, linkedOut)
    assert.notEqual(linked.status, 0)
    assert.match(linked.stderr, /symlink/)
    assert.deepEqual(readdirSync(targetDir), [])
    assert.equal(lstatSync(cwdReport).isSymbolicLink(), true)
    assert.equal(readFileSync(victim, 'utf8'), 'untouched')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('CLI rejects missing values, unknown flags, duplicate options, and overlapping sources', () => {
  const root = tempDir()
  try {
    const input = fixture(root)
    const env = { ...process.env }
    delete env.OOTP_LEAGUE_ID
    const cli = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', importer, ...args], { cwd: root, env, encoding: 'utf8' })
    for (const args of [
      ['--in', '--out', join(root, 'missing-in')],
      ['--in', input, '--out'],
      ['--in', input, '--out', join(root, 'unknown'), '--rating', 'file.json'],
      ['--in', input, '--out', join(root, 'duplicate'), '--out', join(root, 'other')],
      ['--in', input, '--out', join(root, 'missing-lahman'), '--lahman'],
    ]) {
      const result = cli(args)
      assert.notEqual(result.status, 0, args.join(' '))
      assert.match(result.stderr, /requires a value|unknown argument|only be supplied once/)
    }
    const nested = join(input, 'nested-output')
    const overlap = run(root, input, nested)
    assert.notEqual(overlap.status, 0)
    assert.match(overlap.stderr, /overlap an input/)
    assert.equal(existsSync(nested), false)
    assert.equal(existsSync(join(input, FILES.leagues)), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('invalid standings fail the process and report validation failure before any bundle files are written', () => {
  const root = tempDir()
  try {
    const input = fixture(root), out = join(root, 'out')
    writeFileSync(join(input, FILES.teamRecord), 'team_id,g,w,l,t,pct\n1,10,9,9,0,.500\n')
    const result = run(root, input, out)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /standings.record_fits_games/)
    const report = read(out, 'import-report.json')
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((failure: { check: string }) => failure.check === 'standings.record_fits_games'))
    assert.deepEqual(readdirSync(out).sort(), ['.ootp-import-reserved', 'import-report.json'])
    assert.notEqual(run(root, input, out).status, 0) // failed destination cannot be reused
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('invalid batting and pitching records also fail before bundle output', () => {
  const root = tempDir()
  try {
    const input = fixture(root)
    const cases = [
      { file: FILES.careerBatting, data: 'player_id,year,league_id,team_id,split_id,g,ab,h,d,t,hr\n42,2032,203,1,1,1,5,6,0,0,0\n', check: 'batting.h_le_ab' },
      { file: FILES.careerPitching, data: 'player_id,year,league_id,team_id,split_id,g,gs,ip,w,l,r,er\n42,2032,203,1,1,1,0,1,0,0,0,3\n', check: 'pitching.er_le_runs' },
    ]
    for (const [index, entry] of cases.entries()) {
      const out = join(root, `invalid-${index}`)
      writeFileSync(join(input, entry.file), entry.data)
      const result = run(root, input, out)
      assert.notEqual(result.status, 0, result.stderr)
      const report = read(out, 'import-report.json')
      assert.equal(report.ok, false)
      assert.ok(report.failures.some((failure: { check: string }) => failure.check === entry.check))
      assert.deepEqual(readdirSync(out).sort(), ['.ootp-import-reserved', 'import-report.json'])
      writeFileSync(join(input, entry.file), 'placeholder\n')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a late input error fails and the partial destination cannot be reused', () => {
  const root = tempDir()
  try {
    const input = fixture(root), out = join(root, 'out')
    rmSync(join(input, FILES.messages)) // synthetic input only
    const result = run(root, input, out)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(join(out, '.ootp-import-reserved')), true)
    assert.equal(existsSync(join(out, 'import-report.json')), false)
    assert.notEqual(run(root, input, out).status, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
