import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { importImageAssets, importPlayerPhotos } from './assets'
import { currentPlayerPhoto, playerPhotoPath } from '../../src/lib/playerPhotos'

// Real 1x1 PNGs, with different pixels, so the cache-key tests do not depend on external files.
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', 'base64')
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const playerIds = new Set([47542, 1234])
const teams = [{ id: 5, city: 'New York', nickname: 'Yankees', abbr: 'NYY' }]

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(process.cwd(), '.ootp-assets-test-'))
  const source = join(root, 'feed', 'photos')
  const out = join(root, 'public', 'data')
  mkdirSync(source, { recursive: true })
  mkdirSync(join(out, 'photos'), { recursive: true })
  mkdirSync(join(out, 'logos'), { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, source, out }
}

test('missing and empty current folders produce no mappings from previously bundled assets', (t) => {
  const { source, out } = fixture(t)
  writeFileSync(join(out, 'photos', '47542.webp'), 'old face')
  writeFileSync(join(out, 'logos', '5.png'), 'old logo')
  for (const dir of ['', join(source, 'missing'), source]) {
    const result = importImageAssets(dir, '', out, playerIds, teams)
    assert.deepEqual(result.photoIndex, {})
    assert.equal(result.photos.count, 0)
    assert.deepEqual(result.logoIndex, {})
    assert.equal(playerPhotoPath(result.photoIndex, 47542), null)
    assert.equal(readFileSync(join(out, 'photos', '47542.webp'), 'utf8'), 'old face')
  }
})

test('indexes only matching current-feed portraits and copies their actual bytes', (t) => {
  const { source, out } = fixture(t)
  mkdirSync(join(source, 'nested'))
  writeFileSync(join(source, 'nested', 'player_47542.png'), RED)
  writeFileSync(join(source, 'player_9999.png'), BLUE) // not in this feed's player IDs
  writeFileSync(join(source, 'coach_1234.png'), BLUE) // coach IDs overlap players
  writeFileSync(join(source, '1234-extra.png'), BLUE)
  writeFileSync(join(source, 'player_1234.png'), 'not a PNG')
  writeFileSync(join(source, 'nested', '1234.png'), RED.subarray(0, 33)) // PNG header without data
  writeFileSync(join(source, 'nested', 'player-1234.webp'), RED) // wrong extension
  const result = importImageAssets(source, '', out, playerIds, teams)
  const path = `photos/47542-${hash(RED)}.png`
  assert.equal(result.photos.count, 1)
  assert.deepEqual(result.photoIndex, { '47542': path })
  assert.deepEqual(readFileSync(join(out, path)), RED)
  assert.deepEqual(readFileSync(join(source, 'nested', 'player_47542.png')), RED)
  assert.equal(playerPhotoPath(result.photoIndex, 47542), path)
  assert.equal(playerPhotoPath(result.photoIndex, 1234), null)
  assert.equal(playerPhotoPath(result.photoIndex, 9999), null)
})

test('old photo extension conflicts never get indexed; paths are stable and change with content', (t) => {
  const { source, out } = fixture(t)
  const legacy = join(out, 'photos', '47542.webp')
  writeFileSync(legacy, 'stale old-save face')
  const input = join(source, 'player_47542.png')
  writeFileSync(input, RED)
  const first = importImageAssets(source, '', out, playerIds, teams).photoIndex
  const same = importImageAssets(source, '', out, playerIds, teams).photoIndex
  assert.deepEqual(first, same)
  assert.equal(first['47542'], `photos/47542-${hash(RED)}.png`)
  assert.deepEqual(readFileSync(join(out, first['47542'])), RED)

  writeFileSync(input, BLUE)
  const changed = importImageAssets(source, '', out, playerIds, teams).photoIndex
  assert.equal(changed['47542'], `photos/47542-${hash(BLUE)}.png`)
  assert.notEqual(changed['47542'], first['47542'])
  assert.deepEqual(readFileSync(join(out, changed['47542'])), BLUE)
  assert.equal(readFileSync(legacy, 'utf8'), 'stale old-save face')
  assert.ok(existsSync(join(out, first['47542']))) // retained, but no longer indexed

  rmSync(input) // remove only our temporary test fixture
  assert.deepEqual(importImageAssets(source, '', out, playerIds, teams).photoIndex, {})
  assert.ok(existsSync(legacy))
  assert.ok(existsSync(join(out, changed['47542'])))
})

test('different current-feed portraits for the same ID are ambiguous and fail closed', (t) => {
  const { source, out } = fixture(t)
  writeFileSync(join(source, 'player_47542.png'), RED)
  writeFileSync(join(source, '47542.png'), BLUE)
  assert.deepEqual(importPlayerPhotos(source, out, playerIds), { count: 0, index: {} })
  writeFileSync(join(source, '47542.png'), RED)
  assert.deepEqual(importPlayerPhotos(source, out, playerIds).index, { '47542': `photos/47542-${hash(RED)}.png` })
})

test('a corrupt existing hashed file or destination symlink is never overwritten', (t) => {
  const { source, out } = fixture(t)
  const input = join(source, 'player_47542.png')
  const dest = join(out, 'photos', `47542-${hash(RED)}.png`)
  writeFileSync(input, RED)
  writeFileSync(dest, BLUE)
  assert.throws(() => importPlayerPhotos(source, out, playerIds), /does not match/)
  assert.deepEqual(readFileSync(dest), BLUE)
  rmSync(dest) // temporary test fixture only
  symlinkSync(input, dest)
  assert.throws(() => importPlayerPhotos(source, out, playerIds), /does not match/)
  assert.deepEqual(readFileSync(input), RED)
})

test('an output photos directory symlink is rejected, including a dangling symlink', (t) => {
  const { root, source, out } = fixture(t)
  const photos = join(out, 'photos')
  const unrelated = join(root, 'unrelated')
  mkdirSync(unrelated)
  writeFileSync(join(unrelated, 'keep.txt'), 'untouched')
  writeFileSync(join(source, 'player_47542.png'), RED)
  rmSync(photos, { recursive: true }) // temporary test fixture only
  symlinkSync(unrelated, photos, 'dir')

  assert.throws(() => importPlayerPhotos(source, out, playerIds), /portrait output directory must not be a symlink/)
  assert.equal(readFileSync(join(unrelated, 'keep.txt'), 'utf8'), 'untouched')
  assert.equal(existsSync(join(unrelated, `47542-${hash(RED)}.png`)), false)

  rmSync(photos) // temporary test fixture only
  symlinkSync(join(root, 'missing-target'), photos, 'dir')
  assert.throws(() => importPlayerPhotos(source, out, playerIds), /portrait output directory must not be a symlink/)
  assert.equal(existsSync(join(root, 'missing-target')), false)
})

test('output folders and nested symlinks cannot be reimported as current-feed photos', (t) => {
  const { source, out } = fixture(t)
  writeFileSync(join(out, 'photos', '47542.png'), RED)
  symlinkSync(join(out, 'photos'), join(source, 'old-output'), 'dir')
  assert.deepEqual(importPlayerPhotos(source, out, playerIds).index, {})
  assert.deepEqual(importPlayerPhotos(join(out, 'photos'), out, playerIds).index, {})
  assert.deepEqual(importPlayerPhotos(out, out, playerIds).index, {})
  mkdirSync(join(out, 'other'))
  writeFileSync(join(out, 'other', '47542.png'), BLUE)
  assert.deepEqual(importPlayerPhotos(join(out, 'other'), out, playerIds).index, {})
  assert.deepEqual(readFileSync(join(out, 'photos', '47542.png')), RED)
})

test('logos are indexed only from the explicit source and have content-addressed URLs', (t) => {
  const { root, source, out } = fixture(t)
  const logos = join(root, 'feed', 'logos')
  mkdirSync(logos)
  writeFileSync(join(out, 'logos', '5.png'), 'old fifth logo')
  writeFileSync(join(out, 'logos', '6.png'), 'old sixth logo')
  writeFileSync(join(logos, 'NYY.png'), RED)
  const result = importImageAssets(source, logos, out, playerIds, teams)
  assert.deepEqual(result.logoIndex, { '5': `logos/5-${hash(RED)}.png` })
  assert.equal(result.logos.count, 1)
  assert.deepEqual(readFileSync(join(out, result.logoIndex['5'])), RED)
  assert.equal(readFileSync(join(out, 'logos', '5.png'), 'utf8'), 'old fifth logo')
  writeFileSync(join(logos, 'NYY.png'), BLUE)
  const changed = importImageAssets(source, logos, out, playerIds, teams)
  assert.equal(changed.logoIndex['5'], `logos/5-${hash(BLUE)}.png`)
  assert.notEqual(changed.logoIndex['5'], result.logoIndex['5'])
  rmSync(join(logos, 'NYY.png'))
  assert.deepEqual(importImageAssets(source, logos, out, playerIds, teams).logoIndex, {})
  assert.equal(readFileSync(join(out, 'logos', '6.png'), 'utf8'), 'old sixth logo')
})

test('ambiguous logo matches, source/output overlap, and nested symlinks fail closed', (t) => {
  const { root, out } = fixture(t)
  const logos = join(root, 'feed', 'logos')
  mkdirSync(logos)
  writeFileSync(join(logos, 'NYY.png'), RED)
  writeFileSync(join(logos, '5.png'), BLUE)
  assert.deepEqual(importImageAssets('', logos, out, playerIds, teams).logoIndex, {})
  rmSync(join(logos, '5.png'))
  symlinkSync(join(out, 'logos'), join(logos, 'old-output'), 'dir')
  writeFileSync(join(out, 'logos', '5.png'), BLUE)
  assert.deepEqual(importImageAssets('', logos, out, playerIds, teams).logoIndex, { '5': `logos/5-${hash(RED)}.png` })
  assert.deepEqual(importImageAssets('', out, out, playerIds, teams).logoIndex, {})
  assert.deepEqual(importImageAssets('', join(out, 'logos'), out, playerIds, teams).logoIndex, {})
})

test('logo target symlinks and corrupt content-addressed files are never overwritten', (t) => {
  const { root, out } = fixture(t)
  const logos = join(root, 'feed', 'logos')
  mkdirSync(logos)
  writeFileSync(join(logos, 'NYY.png'), RED)
  const destination = join(out, 'logos', `5-${hash(RED)}.png`)
  writeFileSync(destination, BLUE)
  assert.throws(() => importImageAssets('', logos, out, playerIds, teams), /existing content-addressed logo does not match/)
  assert.deepEqual(readFileSync(destination), BLUE)
  rmSync(join(out, 'logos'), { recursive: true })
  const unrelated = join(root, 'unrelated')
  mkdirSync(unrelated)
  writeFileSync(join(unrelated, 'keep.txt'), 'untouched')
  symlinkSync(unrelated, join(out, 'logos'), 'dir')
  assert.throws(() => importImageAssets('', logos, out, playerIds, teams), /logo output directory must not be a symlink/)
  assert.equal(readFileSync(join(unrelated, 'keep.txt'), 'utf8'), 'untouched')
})

test('the avatar accepts only ID-bound hashed paths and never retains a different player face', () => {
  const good = `photos/47542-${hash(RED)}.png`
  assert.equal(playerPhotoPath({ '47542': good }, 47542), good)
  for (const bad of ['photos/47542.webp', 'photos/47542.png', `photos/1234-${hash(RED)}.png`, '../photos/47542.png', null]) {
    assert.equal(playerPhotoPath({ '47542': bad }, 47542), null)
  }
  assert.equal(playerPhotoPath({}, 47542), null)
  assert.equal(currentPlayerPhoto({ id: 47542, url: good }, 47542), good)
  assert.equal(currentPlayerPhoto({ id: 47542, url: good }, 1234), null)
  assert.equal(currentPlayerPhoto(null, 1234), null)
})
