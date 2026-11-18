import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const project = process.cwd()
const workflow = readFileSync(join(project, '.github/workflows/deploy-pages.yml'), 'utf8')
const start = workflow.indexOf('      - name: Import and validate league data\n')
const end = workflow.indexOf('      - name: Build site\n', start)
assert.ok(start >= 0 && end > start, 'workflow import step must exist')
const step = workflow.slice(start, end)
const run = step.split('        run: |\n')[1]
assert.ok(run, 'workflow import step must have a shell script')
const script = run.split('\n').filter((line) => line.length > 0).map((line) => {
  assert.ok(line.startsWith('          '), 'unexpected workflow indentation')
  return line.slice(10)
}).join('\n') + '\n'

test('deployment checks the current stage report and excludes it from the public bundle', () => {
  const root = mkdtempSync(join(project, '.workflow-test-'))
  try {
    for (const kind of ['true', 'false', 'missing', 'malformed', 'failed'] as const) {
      const dir = join(root, kind), bin = join(dir, 'bin'), runner = join(dir, 'runner')
      mkdirSync(bin, { recursive: true })
      mkdirSync(runner)
      mkdirSync(join(dir, 'public/data'), { recursive: true })
      writeFileSync(join(dir, 'public/data/old.txt'), 'old bundle')
      // An unrelated, stale success report in cwd must never be removed or accepted.
      const victim = join(dir, 'victim.txt'), cwdReport = join(dir, 'import-report.json')
      writeFileSync(victim, '{"ok":true,"stale":true}')
      symlinkSync(victim, cwdReport)
      const pnpm = join(bin, 'pnpm')
      writeFileSync(pnpm, `#!/usr/bin/env bash
set -eu
mkdir "$RUNNER_TEMP/ootp-data"
printf 'new bundle' > "$RUNNER_TEMP/ootp-data/bundle.txt"
case "$REPORT_KIND" in
  true) printf '{"ok":true}' > "$RUNNER_TEMP/ootp-data/import-report.json" ;;
  false) printf '{"ok":false}' > "$RUNNER_TEMP/ootp-data/import-report.json" ;;
  malformed) printf '{bad' > "$RUNNER_TEMP/ootp-data/import-report.json" ;;
  failed) printf '{"ok":true}' > "$RUNNER_TEMP/ootp-data/import-report.json"; exit 1 ;;
  missing) : ;;
esac
`)
      chmodSync(pnpm, 0o755)
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runner, REPORT_KIND: kind, OOTP_LEAGUE_ID: '' }
      const result = spawnSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' })
      assert.equal(result.status === 0, kind === 'true', `${kind}: ${result.stderr}`)
      assert.equal(lstatSync(cwdReport).isSymbolicLink(), true)
      assert.equal(readFileSync(victim, 'utf8'), '{"ok":true,"stale":true}')
      assert.equal(existsSync(join(runner, 'ootp-import.log')), false)
      if (kind === 'true') {
        assert.equal(readFileSync(join(dir, 'public/data/bundle.txt'), 'utf8'), 'new bundle')
        assert.equal(existsSync(join(dir, 'public/data/import-report.json')), false)
        assert.equal(existsSync(join(dir, 'public/data/old.txt')), false)
      } else {
        assert.equal(readFileSync(join(dir, 'public/data/old.txt'), 'utf8'), 'old bundle')
        assert.equal(existsSync(join(dir, 'public/data/bundle.txt')), false)
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
