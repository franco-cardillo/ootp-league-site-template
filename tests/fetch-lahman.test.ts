import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(project, 'scripts/data/fetch-lahman.mjs')
const files = ['Batting.csv', 'Pitching.csv', 'People.csv', 'Appearances.csv']

// Mock only in the child process: no endpoint is ever contacted in these tests.
const preload = `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
const fixture = process.env.LAHMAN_FIXTURE
const mode = process.env.LAHMAN_MODE
const fail = () => new Response('offline', { status: 503 })
globalThis.fetch = async (url) => {
  appendFileSync(join(fixture, 'calls.log'), url + '\\n')
  const file = basename(new URL(url).pathname)
  if (mode === 'zip') return file.endsWith('.zip') ? new Response(readFileSync(join(fixture, 'source.zip'))) : fail()
  if (file.endsWith('.zip')) return fail()
  if (mode === 'partial' && (!url.includes('chadwickbureau/') || file === 'Appearances.csv')) return fail()
  if (mode === 'offline') return fail()
  let data = readFileSync(join(fixture, file))
  if (mode === 'bad:' + file) data = Buffer.from(data.toString().replace('playerID', 'wrongID'))
  if (mode === 'broken:' + file) data = Buffer.from(data.toString().replace(/\\n$/, ''))
  if (mode === 'race' && file === 'Appearances.csv') {
    mkdirSync(process.env.LAHMAN_OUT, { recursive: true })
    writeFileSync(join(process.env.LAHMAN_OUT, 'Batting.csv'), 'a user saved this during download')
  }
  return new Response(data)
}
`

type Fixture = { root: string; out: string; source: string; preload: string }
function fixture(): Fixture {
  mkdirSync(join(project, '.cache'), { recursive: true })
  const root = mkdtempSync(join(project, '.cache', 'lahman-fetch-test-'))
  const source = join(root, 'source')
  mkdirSync(source)
  const id = 'syntheticplayer000000000000000000000000000000000000000000000000'
  const table = (file: string, columns: string[], row: string[], count: number) => {
    writeFileSync(join(source, file), `${columns.join(',')}\n${(row.join(',') + '\n').repeat(count)}`)
  }
  table('Batting.csv', ['playerID', 'yearID', 'G', 'AB', 'H', '2B', '3B', 'HR', 'BB', 'SO', 'HBP', 'SF', 'SH', 'SB'], [id, '2001', ...Array(12).fill('1')], 10_001)
  table('Pitching.csv', ['playerID', 'yearID', 'G', 'GS', 'IPouts', 'BFP', 'BB', 'SO', 'HR'], [id, '2001', ...Array(7).fill('1')], 5_001)
  table('People.csv', ['playerID', 'birthYear', 'birthMonth', 'birthDay', 'nameFirst', 'nameLast', 'bats', 'throws'], [id, '1975', '1', '1', 'Fake', 'Player', 'R', 'R'], 3_001)
  table('Appearances.csv', ['playerID', 'yearID', 'G_c', 'G_1b', 'G_2b', 'G_3b', 'G_ss', 'G_lf', 'G_cf', 'G_rf', 'G_dh', 'G_of'], [id, '2001', ...Array(10).fill('1')], 10_001)
  const mock = join(root, 'mock-fetch.mjs')
  writeFileSync(mock, preload)
  return { root, out: join(root, 'output'), source, preload: mock }
}
function run(f: Fixture, mode: string, extra: string[] = []) {
  return spawnSync(process.execPath, ['--import', f.preload, script, '--out', f.out, ...extra], {
    cwd: project, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, LAHMAN_FIXTURE: f.source, LAHMAN_MODE: mode, LAHMAN_OUT: f.out },
  })
}
function noOwnedStages(f: Fixture) {
  assert.deepEqual(readdirSync(f.root).filter((name) => name.startsWith('.lahman-stage-')).sort(), ['.lahman-stage-existing'])
  assert.equal(readFileSync(join(f.root, '.lahman-stage-existing', 'keep'), 'utf8'), 'user data')
}
function addUnrelatedStage(f: Fixture) {
  mkdirSync(join(f.root, '.lahman-stage-existing'))
  writeFileSync(join(f.root, '.lahman-stage-existing', 'keep'), 'user data')
}

test('refuses incomplete or unrelated nonempty destinations without fetching, including --force', () => {
  const f = fixture()
  try {
    mkdirSync(f.out)
    const original = 'my previous batting data\n'
    writeFileSync(join(f.out, 'Batting.csv'), original)
    writeFileSync(join(f.out, 'manifest.json'), 'keep old manifest')
    mkdirSync(join(f.out, 'private'))
    writeFileSync(join(f.out, 'private', 'keep'), 'keep private file')
    addUnrelatedStage(f)
    for (const extra of [[], ['--force']]) {
      const result = run(f, 'partial', extra)
      assert.notEqual(result.status, 0, result.stderr)
      assert.match(result.stderr, /not empty|no --force/i)
      assert.deepEqual(readdirSync(f.out).sort(), ['Batting.csv', 'manifest.json', 'private'])
      assert.equal(readFileSync(join(f.out, 'Batting.csv'), 'utf8'), original)
      assert.equal(readFileSync(join(f.out, 'manifest.json'), 'utf8'), 'keep old manifest')
      assert.equal(readFileSync(join(f.out, 'private', 'keep'), 'utf8'), 'keep private file')
    }
    assert.equal(existsSync(join(f.source, 'calls.log')), false)
    noOwnedStages(f)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('partial and failed downloads leave an existing empty destination and unrelated files alone', () => {
  const f = fixture()
  try {
    mkdirSync(f.out)
    addUnrelatedStage(f)
    for (const mode of ['partial', 'offline']) {
      const result = run(f, mode)
      assert.notEqual(result.status, 0, result.stderr)
      assert.match(result.stderr, /could not fetch/i)
      assert.deepEqual(readdirSync(f.out), [])
      noOwnedStages(f)
    }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('rejects invalid or truncated CSVs from every source, not just Batting', () => {
  const f = fixture()
  try {
    addUnrelatedStage(f)
    for (const file of files) {
      const result = run(f, `bad:${file}`)
      assert.notEqual(result.status, 0, `${file}: ${result.stderr}`)
      assert.match(result.stderr, /missing required columns/i)
      assert.equal(existsSync(f.out), false)
      noOwnedStages(f)
    }
    const broken = run(f, 'broken:People.csv')
    assert.notEqual(broken.status, 0)
    assert.match(broken.stderr, /incomplete or invalid ending/i)
    assert.equal(existsSync(f.out), false)
    noOwnedStages(f)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('publishes a full fresh synthetic download and refuses to overwrite it', () => {
  const f = fixture()
  try {
    addUnrelatedStage(f)
    const result = run(f, 'ok')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readdirSync(f.out).sort(), [...files, 'manifest.json'].sort())
    for (const file of files) assert.deepEqual(readFileSync(join(f.out, file)), readFileSync(join(f.source, file)))
    const manifest = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'))
    assert.equal(manifest.source, 'chadwickbureau/baseballdatabank')
    assert.deepEqual(manifest.files.map((entry: { file: string; bytes: number }) => entry.file), files)
    assert.deepEqual(manifest.files.map((entry: { file: string; bytes: number }) => entry.bytes), files.map((file) => readFileSync(join(f.source, file)).length))
    assert.notEqual(run(f, 'ok').status, 0)
    noOwnedStages(f)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('successful zip fallback can publish to an existing empty directory', () => {
  const f = fixture()
  try {
    mkdirSync(f.out)
    addUnrelatedStage(f)
    execFileSync('zip', ['-q', join(f.source, 'source.zip'), ...files], { cwd: f.source })
    const result = run(f, 'zip')
    assert.equal(result.status, 0, result.stderr)
    for (const file of files) assert.deepEqual(readFileSync(join(f.out, file)), readFileSync(join(f.source, file)))
    assert.match(JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8')).source, /2023 release/)
    noOwnedStages(f)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('protects a destination populated during the download and refuses destination symlinks', () => {
  const f = fixture()
  try {
    addUnrelatedStage(f)
    const result = run(f, 'race')
    assert.notEqual(result.status, 0, result.stderr)
    assert.match(result.stderr, /not empty/i)
    assert.deepEqual(readdirSync(f.out), ['Batting.csv'])
    assert.equal(readFileSync(join(f.out, 'Batting.csv'), 'utf8'), 'a user saved this during download')
    noOwnedStages(f)
    rmSync(f.out, { recursive: true }) // only the test's fixture
    symlinkSync(f.source, f.out, 'dir')
    const symlink = run(f, 'ok')
    assert.notEqual(symlink.status, 0)
    assert.match(symlink.stderr, /symlink/i)
    assert.equal(readFileSync(join(f.source, 'Batting.csv'), 'utf8').startsWith('playerID,'), true)
    noOwnedStages(f)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
