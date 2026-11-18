import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

/** True for a path itself or a path below it (not merely a shared textual prefix). */
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

/**
 * Reserve one empty destination for one import. Never delete, reuse, or overwrite an old bundle.
 * Refuse symlinks even in existing path components, and keep the exclusive marker after failure;
 * both failed and successful destinations must not be used for a second run.
 */
export function reserveOutputDirectory(outputPath: string, sourcePaths: string[], protectedPaths: string[] = []): void {
  const output = resolve(outputPath)
  const components: string[] = []
  for (let current = output; current !== parse(current).root; current = dirname(current)) components.push(current)
  for (const component of components.reverse()) {
    const info = lstatSync(component, { throwIfNoEntry: false })
    if (info?.isSymbolicLink()) throw new Error(`output path must not contain a symlink: ${component}`)
    if (info && !info.isDirectory()) throw new Error(`output path is not a directory: ${component}`)
  }

  for (const candidate of sourcePaths) {
    if (!candidate) continue
    const input = existsSync(candidate) ? realpathSync(candidate) : resolve(candidate)
    if (contains(output, input) || contains(input, output)) {
      throw new Error(`output must not overlap an input source: ${output} and ${input}`)
    }
  }

  for (const candidate of protectedPaths) {
    const protectedPath = existsSync(candidate) ? realpathSync(candidate) : resolve(candidate)
    if (contains(output, protectedPath) || contains(protectedPath, output)) {
      throw new Error(`output must not overlap a protected live bundle: ${output} and ${protectedPath}`)
    }
  }

  mkdirSync(output, { recursive: true })
  if (readdirSync(output).length) {
    throw new Error(`output directory must be new or empty; no existing data was removed: ${output}`)
  }
  // Exclusive creation makes simultaneous imports into the same empty directory fail closed.
  // The marker is intentionally retained even on error; never resume a partial import in place.
  writeFileSync(join(output, '.ootp-import-reserved'), 'Reserved for a single OOTP import. Do not reuse this directory.\n', { flag: 'wx' })
  if (readdirSync(output).some((entry) => entry !== '.ootp-import-reserved')) {
    throw new Error(`output directory changed during reservation; do not use it: ${output}`)
  }
}

/** Create this run's report once, without following or replacing an existing file or symlink. */
export function writeImportReport(outputPath: string, report: unknown): void {
  writeFileSync(join(outputPath, 'import-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
}

/**
 * Game overalls are not in the CSV feed. IDs can be reused between saves, so they are never
 * discovered in public output; an explicitly provided file is the caller's responsibility.
 */
export function loadExplicitGameRatings(file: string | undefined): Record<string, [number, number]> {
  if (file === undefined) return {}
  console.warn(`WARNING: --ratings ${file} is an external snapshot. Verify it belongs to this exact save; player IDs can overlap between saves.`)
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`could not read --ratings JSON ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('--ratings must be a JSON object mapping player IDs to [current, potential] numbers')
  }
  for (const [id, grades] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) ||
        !Array.isArray(grades) || grades.length !== 2 ||
        !grades.every((grade) => typeof grade === 'number' && Number.isFinite(grade))) {
      throw new Error(`invalid --ratings entry for player ID ${JSON.stringify(id)}; expected [current, potential] numbers`)
    }
  }
  return value as Record<string, [number, number]>
}
