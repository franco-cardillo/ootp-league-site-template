import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/demo/generate.mjs')
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ootp-demo-test-'))
  mkdirSync(join(dir, 'scripts/demo'), { recursive: true })
  mkdirSync(join(dir, 'public/data'), { recursive: true })
  cpSync(script, join(dir, 'scripts/demo/generate.mjs'))
  return dir
}
const run = (dir, ...args) => spawnSync(process.execPath, [join(dir, 'scripts/demo/generate.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8' })
const read = (dir, path) => JSON.parse(readFileSync(join(dir, 'public/data', path), 'utf8'))
const allFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)])
const sum = (lines, key) => lines.reduce((n, l) => n + (l[key] || 0), 0)

// These tests run only against temporary directories. They never read or overwrite
// the template's public/data or any user's export.
test('produces the JSON referenced by the actual app and internally consistent synthetic links', () => {
  const dir = fixture()
  try {
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /fictional/i)
    const dataDir = join(dir, 'public/data')
    const jsonFiles = allFiles(dataDir)
    assert.ok(jsonFiles.length > 100)
    for (const file of jsonFiles) {
      assert.match(file, /\.json$/)
      const raw = readFileSync(file, 'utf8')
      assert.doesNotThrow(() => JSON.parse(raw), file)
      assert.doesNotMatch(raw, /https?:\/\//i, `unexpected URL in ${file}`)
    }

    // Collect literal useData/load paths directly from the checked-in page code.
    const appFiles = [...allFiles(join(root, 'src/pages')), ...allFiles(join(root, 'src/components/layout')), join(root, 'src/lib/hooks.ts')]
    const literals = new Set()
    for (const file of appFiles) {
      if (!/\.tsx?$/.test(file)) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?:useData|load)(?:<[^\n]*?>)?\(\s*(['"])([^'"\n]+\.json)\1/g)) literals.add(match[2])
    }
    assert.ok(literals.size >= 15, `missed app data references: ${[...literals]}`)
    for (const path of literals) assert.ok(existsSync(join(dataDir, path)), `missing app reference ${path}`)
    for (const path of ['photos.json', 'logos.json', 'mlb/boxscore-index.json']) assert.ok(existsSync(join(dataDir, path)))
    assert.deepEqual(read(dir, 'photos.json'), {})
    assert.deepEqual(read(dir, 'logos.json'), {})
    assert.equal(read(dir, 'bnn-rank.json').reportDate, '')

    const meta = read(dir, 'meta.json')
    assert.equal(meta.fixture, true)
    assert.deepEqual(meta.sourceFiles, [])
    const teams = read(dir, 'teams.json')
    const leagues = read(dir, 'leagues.json')
    const subs = read(dir, 'sub-leagues.json')
    const divs = read(dir, 'divisions.json')
    const standings = read(dir, 'mlb/standings.json')
    const games = read(dir, 'mlb/games.json')
    const played = games.filter((g) => g.played)
    const teamMap = new Map(teams.map((t) => [t.id, t]))
    assert.equal(meta.counts.teams, teams.length)
    assert.equal(meta.counts.leagues, leagues.length)
    assert.equal(meta.counts.games, played.length)
    assert.ok(standings.length >= 4 && played.length >= 4)
    assert.ok(games.some((g) => !g.played))
    for (const team of teams) {
      assert.ok(leagues.some((l) => l.id === team.leagueId))
      assert.ok(subs.some((s) => s.id === team.subLeagueId && s.leagueId === team.leagueId))
      assert.ok(divs.some((d) => d.id === team.divisionId && d.subLeagueId === team.subLeagueId && d.leagueId === team.leagueId))
      assert.ok(Array.isArray(read(dir, `mlb/rosters/${team.id}.json`)))
      assert.equal(read(dir, `mlb/team-leaders/${team.id}.json`).teamId, team.id)
    }
    for (const division of divs.filter((d) => d.leagueId === meta.mlbLeagueId)) {
      assert.ok(standings.some((s) => s.subLeagueId === division.subLeagueId && s.divisionId === division.id))
    }
    for (const row of standings) {
      const team = teamMap.get(row.teamId)
      assert.ok(team && team.leagueId === meta.mlbLeagueId)
      const matches = played.filter((g) => g.homeTeamId === row.teamId || g.awayTeamId === row.teamId)
      const wins = matches.filter((g) => g.homeTeamId === row.teamId ? g.homeScore > g.awayScore : g.awayScore > g.homeScore).length
      assert.equal(row.g, matches.length); assert.equal(row.w, wins); assert.equal(row.l, matches.length - wins)
      assert.equal(row.pct, Number((wins / matches.length).toFixed(3)))
    }

    const playerIndex = read(dir, 'players-index.json')
    assert.ok(playerIndex.length >= 20)
    const ids = new Set()
    for (let b = 0; b < 32; b++) {
      assert.ok(Array.isArray(read(dir, `mlb/players/${b}.json`)))
      assert.ok(read(dir, `mlb/history/${b}.json`))
    }
    for (const entry of playerIndex) {
      assert.ok(!ids.has(entry.id)); ids.add(entry.id)
      assert.ok(teamMap.has(entry.teamId))
      const bucket = entry.id % 32
      const profile = read(dir, `mlb/players/${bucket}.json`).find((p) => p.id === entry.id)
      const history = read(dir, `mlb/history/${bucket}.json`)[String(entry.id)]
      assert.ok(profile, `missing profile for ${entry.id}`)
      assert.equal(`${profile.firstName} ${profile.lastName}`, entry.name)
      assert.equal(profile.teamId, entry.teamId)
      assert.ok(profile.ratings && Array.isArray(profile.awards) && Array.isArray(profile.fielding))
      assert.deepEqual(history, { batting: profile.batting, pitching: profile.pitching })
      assert.ok(read(dir, `mlb/rosters/${entry.teamId}.json`).some((p) => p.id === entry.id))
    }
    for (const team of teams) {
      const franchise = read(dir, `mlb/team-leaders/${team.id}.json`)
      for (const group of [...franchise.batting, ...franchise.pitching]) {
        for (const leader of group.leaders) if (leader.hasProfile) assert.ok(ids.has(leader.playerId))
      }
    }
    assert.equal(meta.counts.mlbPlayers, playerIndex.filter((p) => p.leagueId === meta.mlbLeagueId).length)
    const profileOf = (id) => read(dir, `mlb/players/${id % 32}.json`).find((p) => p.id === id)
    const leaders = read(dir, 'mlb/leaders.json')
    for (const [side, keys] of Object.entries({ batting: ['avg', 'hr', 'rbi', 'h', 'r', 'sb', 'ops', 'war'], pitching: ['w', 'era', 'k', 'sv', 'whip', 'ip', 'war'] })) {
      for (const key of keys) {
        assert.ok(leaders[side][key].length, `empty ${side}.${key}`)
        const board = leaders[side][key]
        for (const [index, row] of board.entries()) {
          const p = profileOf(row.playerId)
          assert.ok(p); assert.equal(p.teamId, row.teamId)
          assert.equal(row.value, p[side][0][key])
          assert.equal(row.rank, board.findIndex((other) => other.value === row.value) + 1)
          if (index) assert.ok(['era', 'whip'].includes(key) && side === 'pitching' ? board[index - 1].value <= row.value : board[index - 1].value >= row.value)
          const teamGames = standings.find((s) => s.teamId === p.teamId).g
          if (side === 'batting' && ['avg', 'ops'].includes(key)) assert.ok(p.batting[0].pa >= 3.1 * teamGames)
          if (side === 'pitching' && ['era', 'whip'].includes(key)) assert.ok(p.pitching[0].ip >= teamGames)
        }
      }
    }
    const prospects = read(dir, 'prospects.json')
    assert.ok(prospects.length >= 4)
    for (const p of prospects) {
      assert.ok(ids.has(p.id)); assert.ok(teamMap.has(p.teamId)); assert.ok(teamMap.has(p.orgId))
      assert.equal(teamMap.get(p.teamId).parentTeamId, p.orgId)
      assert.equal(p.bnnRank, null)
      if (p.comps.current?.hasProfile) assert.ok(profileOf(p.comps.current.playerId))
      assert.equal(p.comps.historical, null)
    }

    const boxIndex = read(dir, 'mlb/boxscore-index.json')
    const storyIndex = read(dir, 'mlb/story-index.json')
    assert.equal(storyIndex.length, played.length)
    for (const game of played) {
      assert.ok(teamMap.has(game.homeTeamId) && teamMap.has(game.awayTeamId))
      assert.equal(boxIndex[String(game.id)], game.date)
      const box = read(dir, `mlb/boxscores/${game.date}.json`).find((b) => b.gameId === game.id)
      assert.ok(box)
      for (const [side, idKey, scoreKey, hitKey, errorKey] of [
        ['away', 'awayTeamId', 'awayScore', 'awayHits', 'awayErrors'],
        ['home', 'homeTeamId', 'homeScore', 'homeHits', 'homeErrors'],
      ]) {
        const t = box[side]
        assert.equal(t.teamId, game[idKey]); assert.equal(t.runs, game[scoreKey])
        assert.equal(t.hits, game[hitKey]); assert.equal(t.errors, game[errorKey])
        assert.equal(sum(t.batting, 'h'), t.hits); assert.equal(sum(t.batting, 'r'), t.runs)
        assert.equal(sum(t.batting, 'rbi'), t.runs)
        for (const line of [...t.batting, ...t.pitching]) assert.ok(profileOf(line.playerId))
        for (const line of t.batting) { assert.ok(line.h <= line.ab); assert.ok(line.hr <= line.h) }
      }
      const story = read(dir, `mlb/stories/${game.date.slice(0, 7)}.json`)[String(game.id)]
      assert.ok(story && Array.isArray(story.body))
    }
    for (const news of read(dir, 'news.json')) {
      for (const teamId of news.teamIds) assert.ok(teamMap.has(teamId))
      if (news.playerId) assert.ok(profileOf(news.playerId))
      const match = /^\/(players|scores)\/(\d+)$/.exec(news.link)
      assert.ok(match, `broken news route ${news.link}`)
      assert.ok(match[1] === 'players' ? profileOf(Number(match[2])) : boxIndex[match[2]])
    }
    for (const wire of read(dir, 'messages.json')) {
      if (wire.teamId) assert.ok(teamMap.has(wire.teamId))
      if (wire.playerId) assert.ok(profileOf(wire.playerId))
    }
    for (const line of read(dir, 'mlb/team-stats.json')) {
      const roster = read(dir, `mlb/rosters/${line.teamId}.json`)
      const bats = roster.flatMap((p) => p.batting), pits = roster.flatMap((p) => p.pitching)
      for (const key of ['pa', 'ab', 'h', 'd', 't', 'hr', 'r', 'rbi', 'bb', 'k', 'sb']) assert.equal(line.batting[key], sum(bats, key))
      for (const key of ['outs', 'h', 'r', 'er', 'bb', 'k', 'hr']) assert.equal(line.pitching[key], sum(pits, key))
    }
    for (const season of read(dir, 'history.json').seasons) assert.ok(teamMap.has(season.championTeamId))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('refuses existing meta or any nonempty data unless --force; force warns and removes stale files', () => {
  const dir = fixture(), data = join(dir, 'public/data')
  try {
    const meta = '{"important":"do not touch"}\n'
    writeFileSync(join(data, 'meta.json'), meta)
    writeFileSync(join(data, 'private-sentinel.txt'), 'keep me')
    let result = run(dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refus.*overwrite/i)
    assert.equal(readFileSync(join(data, 'meta.json'), 'utf8'), meta)
    assert.equal(readFileSync(join(data, 'private-sentinel.txt'), 'utf8'), 'keep me')
    assert.deepEqual(readdirSync(data).sort(), ['meta.json', 'private-sentinel.txt'])
    result = run(dir, '--force')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /WARNING.*--force.*ENTIRE public\/data.*deleted/i)
    assert.equal(read(dir, 'meta.json').fixture, true)
    assert.equal(existsSync(join(data, 'private-sentinel.txt')), false)
    assert.ok(!readdirSync(join(dir, 'public')).some((name) => /^\.demo-(?:stage|backup)-/.test(name)))
    result = run(dir)
    assert.notEqual(result.status, 0)
    assert.equal(read(dir, 'meta.json').fixture, true)
    result = run(dir, '--surprise')
    assert.notEqual(result.status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('refuses even a non-meta file without force and refuses symlinked data with or without force', () => {
  const dir = fixture(), data = join(dir, 'public/data'), outside = mkdtempSync(join(tmpdir(), 'ootp-demo-outside-'))
  try {
    writeFileSync(join(data, 'old.txt'), 'preserve')
    let result = run(dir)
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(join(data, 'old.txt'), 'utf8'), 'preserve')
    rmSync(data, { recursive: true })
    writeFileSync(join(outside, 'meta.json'), 'untouched')
    symlinkSync(outside, data)
    assert.ok(lstatSync(data).isSymbolicLink())
    for (const args of [[], ['--force']]) {
      result = run(dir, ...args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/i)
      assert.equal(readFileSync(join(outside, 'meta.json'), 'utf8'), 'untouched')
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
})
