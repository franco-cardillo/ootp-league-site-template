#!/usr/bin/env node
/**
 * Fetch the Lahman Baseball Database CSVs the prospect comparison pool is built from.
 *
 *   pnpm run data:lahman
 *   node scripts/data/fetch-lahman.mjs --out /tmp/lahman
 *
 * The destination must be new or empty. Existing nonempty destinations are never replaced;
 * choose a different output directory to fetch a fresh copy. Downloads are isolated until all
 * four files pass structural and size checks, then published together. No --force is supported.
 *
 * By default the files land in `scripts/data/lahman/`, which is gitignored. Sources are tried
 * in order: the canonical Chadwick core, a SABR zip, then Chadwick mirrors. Appearances.csv is
 * required for bucketing hitters by position. Attribution lives in docs/data-model.md.
 * Licence: Lahman Baseball Database (SABR), CC BY-SA 3.0; Chadwick Databank, ODC-By 1.0.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse'

const HERE = dirname(fileURLToPath(import.meta.url))

// Conservative size floors catch error pages and obvious truncation, not an authenticated
// checksum: no upstream checksums are provided for these moving raw sources.
const FILES = {
  'Batting.csv': { minBytes: 500_000, minRows: 10_000, columns: ['playerID', 'yearID', 'G', 'AB', 'H', '2B', '3B', 'HR', 'BB', 'SO', 'HBP', 'SF', 'SH', 'SB'] },
  'Pitching.csv': { minBytes: 300_000, minRows: 5_000, columns: ['playerID', 'yearID', 'G', 'GS', 'IPouts', 'BFP', 'BB', 'SO', 'HR'] },
  'People.csv': { minBytes: 100_000, minRows: 3_000, columns: ['playerID', 'birthYear', 'birthMonth', 'birthDay', 'nameFirst', 'nameLast', 'bats', 'throws'] },
  'Appearances.csv': { minBytes: 300_000, minRows: 10_000, columns: ['playerID', 'yearID', 'G_c', 'G_1b', 'G_2b', 'G_3b', 'G_ss', 'G_lf', 'G_cf', 'G_rf', 'G_dh', 'G_of'] },
}
const CORE_FILES = Object.keys(FILES)
const RAW_SOURCES = [
  { name: 'chadwickbureau/baseballdatabank', base: 'https://raw.githubusercontent.com/chadwickbureau/baseballdatabank/master/core' },
  { name: 'xorq-labs/baseballdatabank (mirror)', base: 'https://raw.githubusercontent.com/xorq-labs/baseballdatabank/master/core' },
  { name: 'cbwinslow/baseballdatabank (mirror)', base: 'https://raw.githubusercontent.com/cbwinslow/baseballdatabank/master/core' },
]
const ZIP_SOURCES = [
  { name: 'seanlahman.com 2023 release', url: 'https://seanlahman.com/files/database/lahman-csv_2023-01-01.zip' },
]
const LICENCE = 'Lahman Baseball Database (SABR) — CC BY-SA 3.0; Chadwick Baseball Databank — ODC-By 1.0'
const TIMEOUT_MS = 90_000
const MAX_ZIP_FILE_BYTES = 50 * 1024 * 1024
const log = (msg) => console.log(`[lahman] ${msg}`)

function options(args) {
  let out
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && !out && args[i + 1] && !args[i + 1].startsWith('--')) {
      out = resolve(args[++i])
    } else {
      throw new Error(`unsupported or incomplete argument: ${args[i]}. Usage: node scripts/data/fetch-lahman.mjs [--out DIRECTORY] (no --force)`)
    }
  }
  return out ?? join(HERE, 'lahman')
}

// lstat also rejects dangling symlinks rather than treating them as absent. Check both before
// downloads and immediately before rename; the rename itself refuses a nonempty destination.
function assertAvailable(dir) {
  let stat
  try { stat = lstatSync(dir) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${dir} must be a new or empty directory, not a symlink or file`)
  if (readdirSync(dir).length) throw new Error(`${dir} is not empty; refusing to overwrite or delete existing data. Choose a new or empty directory`)
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return Buffer.from(await res.arrayBuffer())
}

async function fromRaw(source, dir) {
  for (const file of CORE_FILES) {
    const buf = await download(`${source.base}/${file}`)
    writeFileSync(join(dir, file), buf, { flag: 'wx' })
  }
}

async function fromZip(source, dir, stage) {
  const path = join(stage, 'source.zip')
  writeFileSync(path, await download(source.url), { flag: 'wx' })
  // Read individual archive members to stdout, never extract archive paths to the filesystem.
  const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split(/\r?\n/)
  for (const file of CORE_FILES) {
    const matches = entries.filter((entry) => {
      const parts = entry.split('/')
      return !entry.startsWith('/') && parts.every((part) => part && part !== '.' && part !== '..') && basename(entry) === file
    })
    if (matches.length !== 1) throw new Error(`archive has ${matches.length} safe entries named ${file}`)
    const buf = execFileSync('unzip', ['-p', path, matches[0]], { maxBuffer: MAX_ZIP_FILE_BYTES })
    writeFileSync(join(dir, file), buf, { flag: 'wx' })
  }
}

async function validateFile(dir, file) {
  const path = join(dir, file)
  const buf = readFileSync(path)
  const { minBytes, minRows, columns } = FILES[file]
  if (buf.length < minBytes) throw new Error(`${file} looks truncated (${buf.length} bytes)`)
  if (buf.at(-1) !== 10 || buf.includes(0)) throw new Error(`${file} has an incomplete or invalid ending`)
  // Reject broken UTF-8 rather than silently accepting replacement characters in player names.
  new TextDecoder('utf-8', { fatal: true }).decode(buf)
  let rows = 0
  const parser = createReadStream(path).pipe(parse({
    bom: true,
    columns: (header) => {
      const names = header.map((name) => name.trim())
      if (new Set(names).size !== names.length || columns.some((column) => !names.includes(column))) {
        throw new Error(`${file} is missing required columns or has duplicate columns`)
      }
      return names
    },
    skip_empty_lines: true,
  }))
  for await (const row of parser) {
    if (!row.playerID?.trim() || row.playerID.trim() === 'playerID' || ('yearID' in row && !/^\d{4}$/.test(row.yearID))) {
      throw new Error(`${file} has an invalid playerID or yearID`)
    }
    rows++
  }
  if (rows < minRows) throw new Error(`${file} looks incomplete (${rows} data rows)`)
  return { file, bytes: buf.length }
}

async function main() {
  const out = options(process.argv.slice(2))
  assertAvailable(out)
  const parent = dirname(out)
  mkdirSync(parent, { recursive: true })
  // The staging directory is a unique sibling on the same filesystem as the destination.
  const stage = mkdtempSync(join(parent, '.lahman-stage-'))
  try {
    const attempts = []
    const plan = [
      ...RAW_SOURCES.slice(0, 1).map((source) => ({ kind: 'raw', source })),
      ...ZIP_SOURCES.map((source) => ({ kind: 'zip', source })),
      ...RAW_SOURCES.slice(1).map((source) => ({ kind: 'raw', source })),
    ]
    let ready
    for (const step of plan) {
      const candidate = mkdtempSync(join(stage, 'attempt-'))
      try {
        log(`trying ${step.source.name}`)
        if (step.kind === 'raw') await fromRaw(step.source, candidate)
        else await fromZip(step.source, candidate, stage)
        const files = []
        for (const file of CORE_FILES) files.push(await validateFile(candidate, file))
        writeFileSync(join(candidate, 'manifest.json'), `${JSON.stringify({ source: step.source.name, licence: LICENCE, fetchedAt: new Date().toISOString(), files }, null, 2)}\n`, { flag: 'wx' })
        ready = { candidate, source: step.source.name, files }
        break
      } catch (error) {
        attempts.push(`${step.source.name}: ${error instanceof Error ? error.message : String(error)}`)
        log(`failed — ${attempts.at(-1)}`)
      }
    }
    if (!ready) {
      throw new Error(`could not fetch the database:\n  ${attempts.join('\n  ')}\nthe import still runs without it; comps fall back to the save's own history.`)
    }
    assertAvailable(out)
    // A directory rename cannot replace a nonempty directory, even if one appears after the
    // check above. On POSIX an existing empty destination directory is replaced atomically.
    renameSync(ready.candidate, out)
    log(`wrote ${ready.files.map((f) => `${f.file} (${(f.bytes / 1024).toFixed(0)} KB)`).join(', ')}`)
    log(`source: ${ready.source}`)
  } finally {
    // This is the only deletion: never remove destination files or preexisting directories.
    rmSync(stage, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (error) {
  console.error(`[lahman] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
