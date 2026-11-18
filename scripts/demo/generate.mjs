#!/usr/bin/env node
/**
 * A wholly fictional, self-contained demo. No save, export, asset, network request,
 * or existing public/data content is read. Run from any directory:
 *   node scripts/demo/generate.mjs
 * The output is tied to this script's project root, not the current directory.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--force') || args.filter((arg) => arg === '--force').length > 1) {
  console.error('Usage: node scripts/demo/generate.mjs [--force]')
  process.exit(2)
}
const force = args.includes('--force')
if (force) console.warn('WARNING: --force replaces the ENTIRE public/data directory, including meta.json and any other existing files. All prior data there will be deleted.')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const publicDir = join(root, 'public')
const output = join(publicDir, 'data')
try {
  if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true })
  if (lstatSync(publicDir).isSymbolicLink() || !lstatSync(publicDir).isDirectory()) throw new Error('public must be a real directory, not a symlink')
  // lstat catches even dangling symlinks; never follow one outside the template.
  let outputStat
  try { outputStat = lstatSync(output) } catch (err) { if (err.code !== 'ENOENT') throw err }
  if (outputStat?.isSymbolicLink() || (outputStat && !outputStat.isDirectory())) throw new Error('public/data must be a real directory, not a symlink or file')
  if (!force && outputStat && readdirSync(output).length) {
    throw new Error('public/data is not empty; refusing to overwrite any existing data or meta.json. Back it up first, then use --force only if replacement is intended.')
  }

  const YEAR = 2041
  const SIM_DATE = `${YEAR}-06-05`
  const MAJOR = 810
  const MINOR = 811
  const BUCKETS = 32
  const round = (n, digits = 3) => Number(n.toFixed(digits))
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0)
  const teamsSpec = [
    ['Aster Bay', 'Lanterns', 'ABL', '#285b70', '#d9b66f'],
    ['Brambleport', 'Badgers', 'BRB', '#674252', '#e3ba7e'],
    ['Cinder Ridge', 'Foxes', 'CRF', '#864832', '#efd095'],
    ['Driftwood', 'Owls', 'DWO', '#3d526e', '#c8dce5'],
    ['Ember Falls', 'Sparks', 'EFS', '#8a403d', '#e3ba6a'],
    ['Fable Coast', 'Whales', 'FCW', '#275971', '#d9e7da'],
    ['Glimmer Glen', 'Comets', 'GGC', '#584e81', '#ead58b'],
    ['Juniper Point', 'Stags', 'JPS', '#365e49', '#e1d2a4'],
  ]
  const majorTeams = teamsSpec.map(([city, nickname, abbr, primary, secondary], i) => ({
    id: 101 + i, city, nickname, abbr, leagueId: MAJOR,
    subLeagueId: i < 4 ? 1 : 2, divisionId: Math.floor((i % 4) / 2),
    level: 1, parentTeamId: 0, colors: { primary, secondary },
  }))
  const minorTeams = majorTeams.map((team, i) => ({
    id: 301 + i, city: `${team.city} Grove`, nickname: 'Saplings', abbr: `D${i + 1}`,
    leagueId: MINOR, subLeagueId: 3, divisionId: 0, level: 2,
    parentTeamId: team.id, colors: { ...team.colors },
  }))
  const teams = [...majorTeams, ...minorTeams]
  const leagues = [
    { id: MAJOR, name: 'Fictional Demo League', abbr: 'FDL', level: 1, parentLeagueId: 0, seasonYear: YEAR, currentDate: SIM_DATE },
    { id: MINOR, name: 'Fictional Development League', abbr: 'DEV', level: 2, parentLeagueId: MAJOR, seasonYear: YEAR, currentDate: SIM_DATE },
  ]
  const subLeagues = [
    { leagueId: MAJOR, id: 1, name: 'Sunrise Circuit', abbr: 'SUN' },
    { leagueId: MAJOR, id: 2, name: 'Twilight Circuit', abbr: 'TWI' },
    { leagueId: MINOR, id: 3, name: 'Development Circuit', abbr: 'DEV' },
  ]
  // Major division IDs start at zero: wildCardRows in the app iterates 0..count-1.
  const divisions = [1, 2].flatMap((subLeagueId) => [0, 1].map((id) => ({
    leagueId: MAJOR, subLeagueId, id, name: id === 0 ? 'North' : 'South',
  })))
  divisions.push({ leagueId: MINOR, subLeagueId: 3, id: 0, name: 'Development' })
  const firstNames = ['Aven', 'Brio', 'Calyx', 'Daro', 'Evin', 'Fenn', 'Galen', 'Hollis', 'Iven', 'Jori', 'Kestrel']
  const familyNames = ['Ambervale', 'Briarlock', 'Cindermere', 'Duskfern', 'Everwake', 'Fallowmere', 'Glimmerby', 'Hollowglen']
  const prospectNames = ['Luma', 'Merrin', 'Novi', 'Orlen', 'Perri', 'Quillan', 'Riven', 'Solen']
  const positions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P', 'P']
  const positionCodes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 1]
  function ratings(seed) {
    const offset = seed % 9
    return { contact: 49 + offset, gap: 46 + offset, power: 48 + offset, eye: 47 + offset,
      strikeouts: 50, babip: 50, speed: 48 + offset, stealing: 47 + offset, baserunning: 49 + offset,
      stuff: 50 + offset, movement: 48 + offset, control: 49 + offset, stamina: 60, velocity: 93, groundFly: 50,
      contactP: 60 + offset, gapP: 58 + offset, powerP: 59 + offset, eyeP: 57 + offset,
      stuffP: 61 + offset, movementP: 59 + offset, controlP: 60 + offset,
      overall: 50 + offset, potential: 62 + offset }
  }
  function bio(id, firstName, lastName, team, position, positionCode, age, seed) {
    const r = ratings(seed)
    return { id, firstName, lastName, nickName: '', age, dateOfBirth: `${YEAR - age}-02-10`, nationId: 0,
      cityOfBirthId: 0, height: 181 + seed % 10, weight: 175 + seed % 25, bats: seed % 2 ? 'L' : 'R', throws: 'R',
      position, positionCode, role: positionCode === 1 ? 1 : 0, uniformNumber: seed % 80 + 1,
      teamId: team.id, leagueId: team.leagueId, experience: Math.max(0, age - 22), retired: false,
      hallOfFame: false, draftYear: YEAR - Math.max(1, age - 20), draftRound: 1, draftOverallPick: seed + 1,
      overallRating: r.overall, potentialRating: r.potential, ratings: r,
      awards: [], fielding: [], batting: [], pitching: [], careerBatting: null, careerPitching: null }
  }
  const rosters = new Map(teams.map((t) => [t.id, []]))
  majorTeams.forEach((team, ti) => positions.forEach((position, pi) => {
    rosters.get(team.id).push(bio(41001 + ti * 11 + pi, firstNames[pi], familyNames[ti], team,
      position, positionCodes[pi], 23 + (ti + pi) % 10, ti * 11 + pi))
  }))

  const games = []
  const boxByDate = new Map()
  const schedules = [
    [[0, 1], [2, 3], [4, 5], [6, 7]],
    [[0, 2], [1, 3], [4, 6], [5, 7]],
    [[1, 2], [3, 0], [5, 6], [7, 4]],
    [[2, 0], [3, 1], [6, 4], [7, 5]],
  ]
  function boxBatting(team, hits, runs, seed) {
    const players = rosters.get(team.id).slice(0, 9)
    const hitCounts = Array(9).fill(0)
    // At most three hits in four at-bats per player; all totals reconcile.
    for (let n = 0; n < hits; n++) hitCounts[(seed + n * 5) % 9]++
    const runCounts = Array(9).fill(0)
    const rbiCounts = Array(9).fill(0)
    const hitters = [...Array(9).keys()].filter((i) => hitCounts[i] > 0)
    for (let n = 0; n < runs; n++) {
      runCounts[hitters[n % hitters.length]]++
      rbiCounts[hitters[(n + 1) % hitters.length]]++
    }
    const homeRunIndex = hitters.find((i) => runCounts[i] && rbiCounts[i]) ?? hitters[0]
    return players.map((p, i) => ({ playerId: p.id, name: `${p.firstName} ${p.lastName}`, pos: p.position,
      ab: 4, r: runCounts[i], h: hitCounts[i], rbi: rbiCounts[i], bb: (i + seed) % 5 === 0 ? 1 : 0,
      k: (i + seed) % 3 === 0 ? 1 : 0, hr: i === homeRunIndex ? 1 : 0, d: 0, t: 0 }))
  }
  schedules.forEach((pairs, day) => pairs.forEach(([awayIndex, homeIndex], gameIndex) => {
    const away = majorTeams[awayIndex]
    const home = majorTeams[homeIndex]
    const awayScore = 2 + ((day * 3 + gameIndex * 2) % 5)
    let homeScore = 2 + ((day * 2 + gameIndex * 3 + 1) % 5)
    if (homeScore === awayScore) homeScore++
    const awayHits = awayScore + 5
    const homeHits = homeScore + 5
    const date = `${YEAR}-06-0${day + 1}`
    const id = 9001 + day * 4 + gameIndex
    const awayPitcher = rosters.get(away.id)[9 + day % 2]
    const homePitcher = rosters.get(home.id)[9 + day % 2]
    const game = { id, date, homeTeamId: home.id, awayTeamId: away.id, homeScore, awayScore,
      homeHits, awayHits, homeErrors: gameIndex % 2, awayErrors: day % 2, innings: 9, played: true,
      gameType: 0, attendance: 12000 + day * 700 + gameIndex * 300,
      winningPitcher: homeScore > awayScore ? homePitcher.id : awayPitcher.id,
      losingPitcher: homeScore < awayScore ? homePitcher.id : awayPitcher.id, savePitcher: 0 }
    const side = (team, score, hits, errors, opponentScore, opponentHits, pitcher, seed) => ({
      teamId: team.id, abbr: team.abbr, city: team.city, nickname: team.nickname,
      runs: score, hits, errors, batting: boxBatting(team, hits, score, seed),
      pitching: [{ playerId: pitcher.id, name: `${pitcher.firstName} ${pitcher.lastName}`, ip: 9,
        h: opponentHits, r: opponentScore, er: opponentScore, bb: 2, k: 5 + seed % 5, gs: 1 }],
    })
    const box = { gameId: id, date, innings: 9, attendance: game.attendance,
      away: side(away, awayScore, awayHits, game.awayErrors, homeScore, homeHits, awayPitcher, day + gameIndex),
      home: side(home, homeScore, homeHits, game.homeErrors, awayScore, awayHits, homePitcher, day + gameIndex + 3) }
    games.push(game)
    const list = boxByDate.get(date) ?? []
    list.push(box)
    boxByDate.set(date, list)
  }))
  // Upcoming games are present for team pages, never in the played-date scoreboard.
  schedules[0].forEach(([a, h], i) => games.push({ id: 9017 + i, date: `${YEAR}-06-06`,
    awayTeamId: majorTeams[a].id, homeTeamId: majorTeams[h].id, awayScore: 0, homeScore: 0,
    awayHits: 0, homeHits: 0, awayErrors: 0, homeErrors: 0, innings: 9, played: false,
    gameType: 0, attendance: 0, winningPitcher: 0, losingPitcher: 0, savePitcher: 0 }))

  const played = games.filter((g) => g.played)
  const boxes = [...boxByDate.values()].flat()
  const standings = majorTeams.map((team) => {
    const matches = played.filter((g) => g.homeTeamId === team.id || g.awayTeamId === team.id)
    const results = matches.map((g) => g.homeTeamId === team.id ? g.homeScore > g.awayScore : g.awayScore > g.homeScore)
    const w = results.filter(Boolean).length
    let streak = 0
    for (const win of [...results].reverse()) {
      const step = win ? 1 : -1
      if (streak && Math.sign(streak) !== step) break
      streak += step
    }
    return { teamId: team.id, leagueId: MAJOR, subLeagueId: team.subLeagueId, divisionId: team.divisionId,
      g: matches.length, w, l: matches.length - w, t: 0, pct: round(w / matches.length), gb: 0, position: 0, streak, magicNumber: 0 }
  })
  for (const division of divisions.filter((d) => d.leagueId === MAJOR)) {
    const rows = standings.filter((s) => s.subLeagueId === division.subLeagueId && s.divisionId === division.id)
      .sort((a, b) => b.pct - a.pct || b.w - a.w || a.teamId - b.teamId)
    rows.forEach((row, i) => { row.position = i + 1; row.gb = (rows[0].w - row.w + row.l - rows[0].l) / 2 })
  }

  function battingSeason(team, lines, year = YEAR) {
    const ab = sum(lines, 'ab'), h = sum(lines, 'h'), d = sum(lines, 'd'), t = sum(lines, 't'), hr = sum(lines, 'hr')
    const bb = sum(lines, 'bb'), hp = 0, sf = 0, avg = ab ? round(h / ab) : 0
    const obp = ab + bb ? round((h + bb) / (ab + bb)) : 0
    const slg = ab ? round((h + d + 2 * t + 3 * hr) / ab) : 0
    return { year, teamId: team.id, leagueId: team.leagueId, levelId: team.level, stint: 1, g: lines.length,
      ab, r: sum(lines, 'r'), h, d, t, hr, rbi: sum(lines, 'rbi'), bb, ibb: 0, k: sum(lines, 'k'),
      sb: 0, cs: 0, hp, sh: 0, sf, gdp: 0, pa: ab + bb, avg, obp, slg, ops: round(obp + slg),
      war: round((h + hr * 2) / 20, 1) }
  }
  function pitchingSeason(team, lines, year = YEAR) {
    const outs = sum(lines, 'ip') * 3, ip = outs / 3
    const er = sum(lines, 'er'), h = sum(lines, 'h'), bb = sum(lines, 'bb'), k = sum(lines, 'k')
    return { year, teamId: team.id, leagueId: team.leagueId, levelId: team.level, stint: 1,
      g: lines.length, gs: sum(lines, 'gs'), w: sum(lines, 'win'), l: sum(lines, 'loss'), sv: 0,
      ip, outs, h, r: sum(lines, 'r'), er, bb, k, hr: lines.length, bf: lines.length * 36,
      era: ip ? round(er * 9 / ip, 2) : 0, whip: ip ? round((h + bb) / ip, 2) : 0,
      k9: ip ? round(k * 9 / ip, 1) : 0, war: round(k / 20, 1) }
  }
  majorTeams.forEach((team) => rosters.get(team.id).forEach((p) => {
    const battingLines = boxes.flatMap((box) => [box.away, box.home]).filter((s) => s.teamId === team.id)
      .flatMap((s) => s.batting.filter((b) => b.playerId === p.id))
    const pitchingLines = boxes.flatMap((box) => [box.away, box.home].filter((s) => s.teamId === team.id)
      .flatMap((s) => s.pitching.filter((pit) => pit.playerId === p.id).map((pit) => {
        const game = played.find((g) => g.id === box.gameId)
        return { ...pit, win: Number(game.winningPitcher === p.id), loss: Number(game.losingPitcher === p.id) }
      })))
    if (battingLines.length) p.batting = [battingSeason(team, battingLines)]
    if (pitchingLines.length) p.pitching = [pitchingSeason(team, pitchingLines)]
    p.careerBatting = p.batting[0] ?? null
    p.careerPitching = p.pitching[0] ?? null
  }))

  const prospects = majorTeams.map((org, i) => {
    const club = minorTeams[i], pitcher = i % 2 === 1
    const p = bio(51001 + i, prospectNames[i], familyNames[i], club, pitcher ? 'P' : 'SS', pitcher ? 1 : 6, 19 + i % 3, 100 + i)
    // Fictional development lines: no claim that the demo includes minor-league games.
    if (pitcher) {
      const line = pitchingSeason(club, [{ ip: 36, gs: 6, h: 28, r: 13, er: 12, bb: 9, k: 40, win: 3, loss: 1 }])
      line.g = 6; line.hr = 3; line.bf = 145
      p.pitching = [line]; p.careerPitching = line
    } else {
      const line = battingSeason(club, [{ ab: 120, r: 20, h: 34, d: 7, t: 1, hr: 4, rbi: 18, bb: 14, k: 22 }])
      line.g = 30
      p.batting = [line]; p.careerBatting = line
    }
    rosters.get(club.id).push(p)
    const comp = rosters.get(org.id)[pitcher ? 9 : 4]
    const r = p.ratings
    return { rank: i + 1, bnnRank: null, bnnPosition: null, id: p.id, name: `${p.firstName} ${p.lastName}`,
      age: p.age, position: p.position, role: pitcher ? 'Pitcher' : 'Hitter', bats: p.bats, throws: p.throws,
      nation: 'Fictional', teamId: club.id, teamAbbr: club.abbr, leagueAbbr: 'DEV', level: 2,
      orgId: org.id, orgAbbr: org.abbr, orgName: `${org.city} ${org.nickname}`,
      current: r.overall, potential: r.potential, score: 100 - i,
      tools: { contact: r.contact, gap: r.gap, power: r.power, eye: r.eye, stuff: r.stuff, movement: r.movement, control: r.control, stamina: r.stamina },
      potentialTools: { contact: r.contactP, gap: r.gapP, power: r.powerP, eye: r.eyeP, stuff: r.stuffP, movement: r.movementP, control: r.controlP, stamina: r.stamina },
      comps: { modelVersion: 2, current: { playerId: comp.id, playerName: `${comp.firstName} ${comp.lastName}`,
        similarity: 75, kind: 'current', reason: 'fictional demo comparison', hasProfile: true }, historical: null },
      stats: pitcher ? { league: 'DEV', g: 6, gs: 6, w: 3, l: 1, era: p.pitching[0].era, ip: 36, k: 40 }
        : { league: 'DEV', g: 30, avg: p.batting[0].avg, hr: 4, rbi: 18 } }
  })
  const players = [...rosters.values()].flat()
  const playersById = new Map(players.map((p) => [p.id, p]))
  const rosterByPlayer = new Map(players.map((p) => [p.id, teams.find((t) => t.id === p.teamId)]))
  const playerIndex = players.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, teamId: p.teamId,
    teamAbbr: rosterByPlayer.get(p.id).abbr, leagueId: p.leagueId, position: p.position, age: p.age, active: true }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const makeBoard = (kind, key, ascending = false) => majorTeams.flatMap((t) => rosters.get(t.id))
    .filter((p) => p[kind].length > 0)
    .sort((a, b) => (ascending ? 1 : -1) * (a[kind][0][key] - b[kind][0][key]) || a.id - b.id)
    .slice(0, 10).map((p, i, sorted) => ({
      rank: sorted.findIndex((other) => other[kind][0][key] === p[kind][0][key]) + 1,
      playerId: p.id, name: `${p.firstName} ${p.lastName}`, value: p[kind][0][key], teamId: p.teamId,
    }))
  const leaders = { meta: { qualificationVersion: 1 }, batting: {}, pitching: {} }
  for (const key of ['avg', 'hr', 'rbi', 'h', 'r', 'sb', 'ops', 'war']) leaders.batting[key] = makeBoard('batting', key)
  for (const key of ['w', 'era', 'k', 'sv', 'whip', 'ip', 'war']) leaders.pitching[key] = makeBoard('pitching', key, key === 'era' || key === 'whip')

  const teamStats = majorTeams.map((team) => {
    const ps = rosters.get(team.id), bat = ps.flatMap((p) => p.batting), pit = ps.flatMap((p) => p.pitching)
    const ab = sum(bat, 'ab'), h = sum(bat, 'h'), bb = sum(bat, 'bb'), d = sum(bat, 'd'), t = sum(bat, 't'), hr = sum(bat, 'hr')
    const avg = round(h / ab), obp = round((h + bb) / (ab + bb)), slg = round((h + d + 2 * t + 3 * hr) / ab)
    const outs = sum(pit, 'outs'), ip = outs / 3, ph = sum(pit, 'h'), pbb = sum(pit, 'bb'), er = sum(pit, 'er')
    return { teamId: team.id, batting: { pa: sum(bat, 'pa'), ab, h, d, t, hr, r: sum(bat, 'r'), rbi: sum(bat, 'rbi'), bb,
      k: sum(bat, 'k'), sb: sum(bat, 'sb'), avg, obp, slg, ops: round(obp + slg) },
    pitching: { ip, outs, h: ph, r: sum(pit, 'r'), er, bb: pbb, k: sum(pit, 'k'), hr: sum(pit, 'hr'),
      era: round(er * 9 / ip, 2), whip: round((ph + pbb) / ip, 2) } }
  })

  const storyIndex = played.map((g) => {
    const winner = teams.find((t) => t.id === (g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId))
    return { gameId: g.id, date: g.date, awayTeamId: g.awayTeamId, homeTeamId: g.homeTeamId,
      awayScore: g.awayScore, homeScore: g.homeScore, headline: `Demo: ${winner.nickname} take the fictional matchup`,
      deck: `A made-up ${g.awayScore}–${g.homeScore} final from the demo league.` }
  }).reverse()
  const stories = Object.fromEntries(storyIndex.map((s) => [String(s.gameId), { gameId: s.gameId, date: s.date,
    headline: s.headline, deck: s.deck, body: ['This recap and every player, club, and statistic in this demo are fictional.'] }]))
  const featuredGame = played.at(-1), featuredBox = boxes.find((box) => box.gameId === featuredGame.id)
  const featuredSide = featuredGame.homeScore > featuredGame.awayScore ? featuredBox.home : featuredBox.away
  const featuredBat = featuredSide.batting.find((bat) => bat.hr) ?? featuredSide.batting[0]
  const news = [
    { id: 'demo-performance', rank: 1, kind: 'performance', date: featuredGame.date,
      headline: `${featuredBat.name}: ${featuredBat.h} hits, ${featuredBat.hr} HR, ${featuredBat.rbi} RBI`,
      deck: 'A fictional player in a fictional game.', playerId: featuredBat.playerId, teamId: featuredSide.teamId,
      opponentTeamId: featuredSide.teamId === featuredGame.homeTeamId ? featuredGame.awayTeamId : featuredGame.homeTeamId,
      teamIds: [featuredGame.awayTeamId, featuredGame.homeTeamId], link: `/players/${featuredBat.playerId}` },
    ...storyIndex.slice(0, 2).map((s, i) => ({ id: `demo-recap-${i + 1}`, rank: i + 2, kind: 'blowout', date: s.date,
      headline: s.headline, deck: s.deck, teamIds: [s.awayTeamId, s.homeTeamId], link: `/scores/${s.gameId}` })),
  ]
  const messages = [
    { id: 701, date: `${YEAR}-06-04`, subject: 'Demo league: a fictional season is underway', importance: 1, type: 0,
      teamId: featuredSide.teamId, playerId: featuredBat.playerId, playerName: featuredBat.name, mlb: true },
    { id: 702, date: `${YEAR}-06-03`, subject: 'Demo: development clubs welcome a new class', importance: 1, type: 0,
      teamId: majorTeams[0].id, mlb: true },
  ]
  const history = { seasons: [{ year: YEAR - 1, championTeamId: majorTeams[0].id, w: 60, l: 40, pct: 0.6, titlesToDate: 1 }],
    franchises: [{ teamId: majorTeams[0].id, titles: 1, lastYear: YEAR - 1 }], awards: [] }
  const files = new Map()
  const add = (path, value) => files.set(path, `${JSON.stringify(value, null, 2)}\n`)
  add('teams.json', teams); add('leagues.json', leagues); add('sub-leagues.json', subLeagues); add('divisions.json', divisions)
  add('mlb/standings.json', standings); add('mlb/games.json', games); add('mlb/team-stats.json', teamStats)
  add('mlb/leaders.json', leaders); add('news.json', news); add('messages.json', messages); add('history.json', history)
  add('players-index.json', playerIndex); add('prospects.json', prospects)
  // No real portrait, logo, report, or historical comparison is supplied.
  add('photos.json', {}); add('logos.json', {}); add('bnn-rank.json', { reportDate: '', rankings: [] })
  add('mlb/boxscore-index.json', Object.fromEntries(played.map((g) => [String(g.id), g.date])))
  add('mlb/story-index.json', storyIndex); add(`mlb/stories/${YEAR}-06.json`, stories)
  for (const [date, dayBoxes] of boxByDate) add(`mlb/boxscores/${date}.json`, dayBoxes)
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const members = players.filter((p) => p.id % BUCKETS === bucket)
    add(`mlb/players/${bucket}.json`, members)
    add(`mlb/history/${bucket}.json`, Object.fromEntries(members.map((p) => [String(p.id), { batting: p.batting, pitching: p.pitching }])))
  }
  for (const team of teams) {
    const roster = rosters.get(team.id)
    add(`mlb/rosters/${team.id}.json`, roster)
    const groups = (kind, key, label) => roster.filter((p) => p[kind].length).map((p) => ({
      playerId: p.id, name: `${p.firstName} ${p.lastName}`, value: String(p[kind][0][key]), note: 'demo season', hasProfile: true,
    })).sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 5)
    add(`mlb/team-leaders/${team.id}.json`, { teamId: team.id,
      batting: [{ key: 'hr', label: 'Home runs', leaders: groups('batting', 'hr', 'Home runs') }],
      pitching: [{ key: 'k', label: 'Strikeouts', leaders: groups('pitching', 'k', 'Strikeouts') }] })
  }
  add('meta.json', { generatedAt: new Date().toISOString(), season: YEAR, mlbLeagueId: MAJOR, simDate: SIM_DATE,
    demo: true, fixture: true, description: 'Fictional demo only; generated from code, not a save or export.',
    counts: { teams: teams.length, leagues: leagues.length, mlbTeams: majorTeams.length,
      mlbPlayers: majorTeams.reduce((n, t) => n + rosters.get(t.id).length, 0), players: players.length, games: played.length },
    sourceFiles: [], checksums: {} })

  // Write a complete staging tree first. Only after successful generation replace the
  // target, restoring it if the rename fails. A force replacement removes stale files.
  const stage = mkdtempSync(join(publicDir, '.demo-stage-'))
  let backup
  try {
    for (const [path, content] of files) {
      const target = join(stage, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content, { flag: 'wx' })
    }
    // Another process might have populated or replaced data while staging.
    let currentStat
    try { currentStat = lstatSync(output) } catch (err) { if (err.code !== 'ENOENT') throw err }
    if (currentStat?.isSymbolicLink() || (currentStat && !currentStat.isDirectory())) throw new Error('public/data changed to a symlink or file during generation')
    if (!force && currentStat && readdirSync(output).length) throw new Error('public/data became nonempty during generation; refusing to overwrite existing data or meta.json')
    if (currentStat) {
      backup = mkdtempSync(join(publicDir, '.demo-backup-'))
      rmSync(backup, { recursive: true })
      renameSync(output, backup)
      if (!force && readdirSync(backup).length) {
        renameSync(backup, output)
        backup = undefined
        throw new Error('public/data became nonempty during replacement; refusing to overwrite existing data or meta.json')
      }
    }
    try { renameSync(stage, output) } catch (err) {
      if (backup) { renameSync(backup, output); backup = undefined }
      throw err
    }
    if (backup) rmSync(backup, { recursive: true, force: true })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  console.log(`Generated ${files.size} fictional demo JSON files in ${output}.`)
  console.log('All clubs, people, scores, ratings, stories and stats are invented; photos and logos are empty.')
} catch (err) {
  console.error(`Demo generation refused or failed: ${err.message}`)
  process.exitCode = 1
}
