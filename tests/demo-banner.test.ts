import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DemoBanner from '../src/components/layout/DemoBanner'
import SiteFooter from '../src/components/layout/SiteFooter'
import type { ImportMeta } from '../src/lib/types'

const meta = { generatedAt: '2041-06-05T12:00:00Z', simDate: '2041-06-05' }
const banner = (value: unknown) => renderToStaticMarkup(createElement(DemoBanner, {
  meta: value as Pick<ImportMeta, 'demo'> | null | undefined,
}))
const footer = (value: unknown) => renderToStaticMarkup(createElement(SiteFooter, {
  meta: value as Pick<ImportMeta, 'demo' | 'generatedAt' | 'simDate'> | null | undefined,
}))

test('explicit demo metadata renders an accessible fictional-data notice', () => {
  const html = banner({ demo: true })
  assert.match(html, /role="status"/)
  assert.match(html, /aria-label="Demo data notice"/)
  assert.match(html, /Demo data/)
  assert.match(html, /Fictional sample data/)
  assert.match(html, /not a real league or OOTP save/)
})

test('only boolean true activates the notice, including during loading or error', () => {
  for (const value of [null, undefined, {}, { demo: false }, { fixture: true },
    { demo: 'true' }, { demo: 1 }, { demo: null }]) {
    assert.equal(banner(value), '', JSON.stringify(value))
  }
})

test('demo footer never presents generated samples as a real save or export', () => {
  const html = footer({ ...meta, demo: true })
  assert.match(html, /fictional sample data/i)
  assert.match(html, /synthetic demo data, not an OOTP save or export/i)
  assert.match(html, /sample date 2041-06-05/)
  assert.doesNotMatch(html, /personal league record|Data source: Out of the Park Baseball 27 exports/)
})

test('real and legacy metadata keep the original footer, but unknown metadata makes no source claim', () => {
  for (const value of [{ ...meta, demo: false }, meta]) {
    const html = footer(value)
    assert.match(html, /a personal league record\. Data updated/)
    assert.match(html, /sim through 2041-06-05/)
    assert.match(html, /Data source: Out of the Park Baseball 27 exports\./)
    assert.doesNotMatch(html, /fictional|demo data/i)
  }
  for (const value of [null, undefined]) {
    const html = footer(value)
    assert.match(html, /Data source unavailable/)
    assert.doesNotMatch(html, /personal league record|Data source: Out of the Park Baseball 27 exports/)
  }
})

test('shared shell loads metadata independently and keeps the existing masthead and routes', () => {
  const shell = readFileSync('src/components/layout/PageShell.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  assert.match(shell, /useData<ImportMeta>\('meta\.json'\)/)
  assert.match(shell, /<Masthead\s*\/>\s*<DemoBanner meta=\{meta\.data\}\s*\/>\s*<ScoreboardRail\s*\/>\s*<PrimaryNav\s*\/>\s*<main>\{children\}<\/main>/)
  assert.match(shell, /<SiteFooter meta=\{meta\.data\}\s*\/>/)
  assert.match(app, /<PageShell>\s*<Routes>/)
  assert.match(app, /<\/Routes>\s*<\/PageShell>/)
  const css = readFileSync('src/components/layout/DemoBanner.css', 'utf8')
  assert.match(css, /flex-wrap:\s*wrap/)
})
