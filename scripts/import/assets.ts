import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative } from 'node:path'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** First integer token in a filename, so `player_1234.png` and `1234.png` both work. */
function idToken(file: string): number | null {
  const match = basename(file, extname(file)).match(/(\d{1,7})/)
  return match ? Number(match[1]) : null
}

/**
 * Player portraits live beside coach and staff pictures in OOTP's own folder, and those share the
 * id space, so a loose id match would put a coach's face on a player who happens to carry the same
 * number. Only a bare id or an explicit `player_<id>` counts as a portrait.
 */
function playerIdToken(file: string): number | null {
  const stem = basename(file, extname(file))
  const match = stem.match(/^(?:player[_-]?)?(\d{1,7})$/i)
  return match ? Number(match[1]) : null
}

export interface AssetResult {
  count: number
  index: Record<string, string>
}

type LogoTeam = { id: number; city: string; nickname: string; abbr: string }

/** Walk the supplied source only; do not follow symlinks into old output or unrelated trees. */
function walkImageSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkImageSource(full, out)
    else if (entry.isFile() && IMAGE_EXT.has(extname(entry.name).toLowerCase())) out.push(full)
  }
  return out
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

/** Check image signatures and basic container completeness; the browser handles decode errors. */
function hasImageSignature(bytes: Buffer, ext: string): boolean {
  if (ext === '.png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
        !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) return false
    let offset = 8
    let hasData = false
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset)
      const next = offset + 12 + length
      if (next > bytes.length) return false
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (type === 'IDAT' && length > 0) hasData = true
      if (type === 'IEND') return length === 0 && hasData && next === bytes.length
      offset = next
    }
    return false
  }
  if (ext === '.jpg' || ext === '.jpeg') return bytes.length >= 5 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  if (ext === '.gif') return bytes.length >= 14 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a') && bytes[bytes.length - 1] === 0x3b
  if (ext === '.webp') return bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
  return false
}

/**
 * Copy portraits from this feed only. Never derive player identities from previously bundled files:
 * OOTP ids can identify different people in different saves. Missing/empty/ambiguous input means
 * initials. Content-addressed names prevent an old image being reused from a browser/CDN cache.
 */
export function importPlayerPhotos(dir: string, outDir: string, playerIds: Set<number>): AssetResult {
  const index: Record<string, string> = {}
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return { count: 0, index }

  mkdirSync(outDir, { recursive: true })
  const source = realpathSync(dir)
  const output = realpathSync(outDir)
  const targetPath = join(output, 'photos')
  // lstat catches dangling symlinks too; never redirect portrait writes into another tree.
  const targetStat = lstatSync(targetPath, { throwIfNoEntry: false })
  if (targetStat?.isSymbolicLink()) throw new Error(`portrait output directory must not be a symlink: ${targetPath}`)
  const target = targetStat ? realpathSync(targetPath) : targetPath
  // A source encompassing any part of the output (or vice versa) could reimport old portraits.
  if (contains(source, output) || contains(output, source)) {
    console.warn('photo source overlaps the output directory; ignoring portraits')
    return { count: 0, index }
  }

  type Candidate = { bytes: Buffer; ext: string; hash: string }
  const candidates = new Map<number, Candidate | null>()
  for (const file of walkImageSource(source)) {
    const id = playerIdToken(file)
    if (!id || !playerIds.has(id)) continue
    const ext = extname(file).toLowerCase()
    const bytes = readFileSync(file)
    if (!hasImageSignature(bytes, ext)) continue
    const hash = createHash('sha256').update(bytes).digest('hex')
    const prior = candidates.get(id)
    if (prior === null) continue
    if (prior && prior.hash !== hash) {
      // Two different faces for one id are ambiguous, even if both came from the supplied folder.
      candidates.set(id, null)
    } else if (!prior) {
      candidates.set(id, { bytes, ext: ext === '.jpeg' ? '.jpg' : ext, hash })
    }
  }

  if (candidates.size) mkdirSync(target, { recursive: true })
  for (const [id, photo] of candidates) {
    if (!photo) continue
    const name = `${id}-${photo.hash}${photo.ext}`
    const destination = join(target, name)
    // Preserve all existing assets and reject a corrupt path or symlink rather than trusting it.
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile() || !readFileSync(destination).equals(photo.bytes)) {
        throw new Error(`existing content-addressed portrait does not match: ${destination}`)
      }
    } else {
      // Exclusive create avoids overwriting any existing file; bytes are exactly those hashed.
      writeFileSync(destination, photo.bytes, { flag: 'wx' })
    }
    index[String(id)] = `photos/${name}`
  }
  return { count: Object.keys(index).length, index }
}

export function importTeamLogos(
  dir: string,
  outDir: string,
  teams: LogoTeam[],
): AssetResult {
  const index: Record<string, string> = {}
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return { count: 0, index }
  mkdirSync(outDir, { recursive: true })
  const source = realpathSync(dir)
  const output = realpathSync(outDir)
  const targetPath = join(output, 'logos')
  const targetStat = lstatSync(targetPath, { throwIfNoEntry: false })
  if (targetStat?.isSymbolicLink()) throw new Error(`logo output directory must not be a symlink: ${targetPath}`)
  const target = targetStat ? realpathSync(targetPath) : targetPath
  if (contains(source, output) || contains(output, source)) {
    console.warn('logo source overlaps the output directory; ignoring logos')
    return { count: 0, index }
  }

  const bySlug = new Map<string, number>()
  const byAbbr = new Map<string, number>()
  for (const team of teams) {
    bySlug.set(slug(`${team.city}_${team.nickname}`), team.id)
    bySlug.set(slug(`${team.city}${team.nickname}`), team.id)
    byAbbr.set(team.abbr.toLowerCase(), team.id)
  }

  type Candidate = { bytes: Buffer; ext: string; hash: string }
  const candidates = new Map<number, Candidate | null>()
  for (const file of walkImageSource(source)) {
    const stem = basename(file, extname(file))
    const teamId =
      bySlug.get(slug(stem)) ?? byAbbr.get(stem.toLowerCase()) ?? (idToken(file) ? Number(idToken(file)) : null)
    if (!teamId || !teams.some((t) => t.id === teamId)) continue
    const ext = extname(file).toLowerCase()
    const bytes = readFileSync(file)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const prior = candidates.get(teamId)
    if (prior === null) continue
    if (prior && prior.hash !== hash) candidates.set(teamId, null)
    else if (!prior) candidates.set(teamId, { bytes, ext: ext === '.jpeg' ? '.jpg' : ext, hash })
  }

  if (candidates.size) mkdirSync(target, { recursive: true })
  for (const [teamId, logo] of candidates) {
    if (!logo) continue
    const name = `${teamId}-${logo.hash}${logo.ext}`
    const destination = join(target, name)
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile() || !readFileSync(destination).equals(logo.bytes)) {
        throw new Error(`existing content-addressed logo does not match: ${destination}`)
      }
    } else {
      writeFileSync(destination, logo.bytes, { flag: 'wx' })
    }
    index[String(teamId)] = `logos/${name}`
  }
  return { count: Object.keys(index).length, index }
}

/** Both indices contain only successful copies from this invocation's explicit sources. */
export function importImageAssets(photoDir: string, logoDir: string, outDir: string, playerIds: Set<number>, teams: LogoTeam[]) {
  const photos = importPlayerPhotos(photoDir, outDir, playerIds)
  const logos = importTeamLogos(logoDir, outDir, teams)
  return {
    photos,
    logos,
    photoIndex: photos.index,
    logoIndex: logos.index,
  }
}
