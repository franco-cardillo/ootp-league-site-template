import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatPlayerHeight } from '../src/lib/playerHeight'

test('formats OOTP centimeter heights in feet and inches', () => {
  // 183 cm is approximately six feet.
  assert.equal(formatPlayerHeight(183), `6'0"`)
  assert.equal(formatPlayerHeight(191), `6'3"`)
  assert.equal(formatPlayerHeight(180), `5'11"`)
})

test('rounds total inches before splitting feet and inches', () => {
  assert.equal(formatPlayerHeight(181.6), `5'11"`)
  assert.equal(formatPlayerHeight(181.61), `6'0"`)
  assert.equal(formatPlayerHeight(182), `6'0"`)
})

test('does not invent a height for missing or invalid values', () => {
  for (const height of [0, -1, NaN, Infinity, -Infinity, null, undefined, '', '183', 0.1, Number.MAX_VALUE]) {
    assert.equal(formatPlayerHeight(height), '—')
  }
})

test('the player page formats height while retaining the original weight in pounds', () => {
  const page = readFileSync('src/pages/Player.tsx', 'utf8')
  assert.match(page, /\{formatPlayerHeight\(player\.height\)\}\s*·\s*\{player\.weight\}\s*lb/)
})
