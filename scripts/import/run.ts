/**
 * OOTP 27 → website data importer.
 *
 *   OOTP_LEAGUE_ID=203 pnpm data:import --in /path/to/csv --out ./import-stage/new
 *
 * OOTP_LEAGUE_ID selects the primary league (positive safe integer, default 203).
 * --league-id overrides the environment setting. A BNN snapshot is optional and is read only
 * when explicitly supplied with --bnn /path/to/bnn-rank.json; malformed/missing reports fail.
 * Game overalls are optional via --ratings /path/to/ratings.json; verify they belong to this save.
 *
 * Reads the export directory exactly as OOTP wrote it, maps relationships by OOTP identifier,
 * validates integrity, and writes the normalized bundle the site consumes. Each invocation requires
 * an explicit new or empty staging directory; never import over an existing save or live bundle.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BattingSeason,
  Game,
  History,
  HistoryAward,
  HistorySeason,
  FieldingLine,
  FranchiseLeaders,
  ImportMeta,
  League,
  NewsItem,
  PitchingSeason,
  PlayerBio,
  PlayerDetail,
  Prospect,
  Ratings,
  StandingRow,
  Team,
  TeamStats,
} from '../../src/lib/types'
import { combinePitching } from '../../src/lib/selectors'
import { int, ipToOuts, isoDate, num, readCsv, round, str, type Row } from './csv'
import {
  toBattingSeason,
  toDivision,
  toGame,
  toLeague,
  toPitchingSeason,
  toPlayerBio,
  toRatings,
  toStanding,
  toSubLeague,
  toTeam,
  toTeamStats,
} from './normalize'
import { positionName, FILES, parseLeagueId } from './schema'
import { validate, type BattingRecord, type PitchingRecord } from './validate'
import { battingPaKnown, battingRateKnown, buildLeaders, leaderRawWar, pitchingOuts, pitchingRateKnown, teamGamesFromRecords, type BattingLeaderRecord, type PitchingLeaderRecord } from './leaders'
import { buildNews } from './news'
import { buildStory, parseLog, storyPath } from './stories'
import {
  addMlbProspectLines,
  baseballAge,
  buildProspects,
  currentUsageFloors,
  knownHand,
  pitchingGroup,
  positionGroupOf,
  type Handedness,
  type HistoricalSeason,
  type PeerPlayer,
  type RatingRow,
  type SeasonLine,
} from './prospects'
import { buildBoxscores, type GameBatLine, type GamePitLine } from './boxscores'
import { loadLahmanSeasons } from './lahman'
import { importImageAssets } from './assets'
import { loadBnnSnapshot, matchBnn } from './bnn'
import { loadExplicitGameRatings, reserveOutputDirectory, writeImportReport } from './safety'
import type { MessageItem } from '../../src/lib/types'

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2)
const flags = new Set(['--in', '--out', '--photos', '--logos', '--logs', '--lahman', '--league-id', '--bnn', '--ratings'])
const args = new Map<string, string>()
for (let i = 0; i < argv.length; i += 2) {
  const flag = argv[i]
  if (!flags.has(flag)) throw new Error(`unknown argument: ${flag}`)
  if (args.has(flag)) throw new Error(`${flag} may only be supplied once`)
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  args.set(flag, value)
}
const outArg = args.get('--out')
if (outArg === undefined) throw new Error('--out is required; choose a new or empty staging directory')
const IN_DIR = resolve(args.get('--in') ?? join(process.cwd(), 'data/raw/csv'))
const OUT_DIR = resolve(outArg)
const PHOTO_DIR = args.get('--photos') ?? ''
const LOGO_DIR = args.get('--logos') ?? ''
const LOG_DIR = args.get('--logs') ?? ''
const MLB_LEAGUE_ID = parseLeagueId(args.get('--league-id') ?? process.env.OOTP_LEAGUE_ID)
// Report use is opt-in: otherwise an old snapshot may belong to a different save.
const bnnArg = args.get('--bnn')
const BNN_PATH = bnnArg === undefined ? undefined : resolve(bnnArg)
// Player IDs may be reused across saves; external game overall ratings are always opt-in.
const ratingsArg = args.get('--ratings')
const RATINGS_PATH = ratingsArg === undefined ? undefined : resolve(ratingsArg)
// The Lahman CSVs live beside the fetch script that downloads them; the importer never requires
// them, it only uses them when they are there.
const LAHMAN_DIR = resolve(
  args.get('--lahman') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'lahman'),
)
const LIVE_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data')
const ALL_STAR_ABBRS = new Set(['AL', 'NL'])

const started = Date.now()
const log = (msg: string): void => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`)

const path = (file: string): string => join(IN_DIR, file)

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((done, fail) => {
    createReadStream(path(file))
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done())
      .on('error', fail)
  })
  return hash.digest('hex')
}

function write(name: string, value: unknown, pretty = false): void {
  const target = join(OUT_DIR, name)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value), { flag: 'wx' })
}

// ---------------------------------------------------------------- load reference tables

async function main(): Promise<void> {
  reserveOutputDirectory(OUT_DIR, [IN_DIR, PHOTO_DIR, LOGO_DIR, LOG_DIR, LAHMAN_DIR, BNN_PATH ?? '', RATINGS_PATH ?? ''], [LIVE_DATA_DIR])
  const gameRatings = loadExplicitGameRatings(RATINGS_PATH)
  if (RATINGS_PATH) log(`explicit game ratings loaded: ${Object.keys(gameRatings).length}`)
  else log('No game overall ratings supplied; using calculated ratings')
  const completeCounts = (row: Row, fields: string[]) => fields.every((field) => /^\d+$/.test(str(row[field])))
  const validPitchingUsage = (row: Row) => completeCounts(row, ['g', 'gs']) && int(row.gs) <= int(row.g) &&
    /^\d+(?:\.[012])?$/.test(str(row.ip))
  // An explicitly selected report must exist and pass the complete validation. No report means
  // calculated prospects only; a fresh output cannot contain an earlier report snapshot.
  const bnnSnapshot = BNN_PATH === undefined ? null : loadBnnSnapshot(BNN_PATH)
  if (bnnSnapshot?.leagueId !== undefined && bnnSnapshot.leagueId !== MLB_LEAGUE_ID) {
    throw new Error(`BNN snapshot league ${bnnSnapshot.leagueId} does not match primary league ${MLB_LEAGUE_ID}`)
  }
  if (bnnSnapshot) log(`BNN: static report snapshot ${bnnSnapshot.reportDate}; not refreshed by the CSV feed`)
  else log('No BNN report supplied; prospects use calculated scores only')

  const leagues: League[] = []
  for await (const row of readCsv(path(FILES.leagues))) leagues.push(toLeague(row))

  const subLeagues = []
  for await (const row of readCsv(path(FILES.subLeagues))) subLeagues.push(toSubLeague(row))

  const divisions = []
  for await (const row of readCsv(path(FILES.divisions))) divisions.push(toDivision(row))

  const allTeams: Team[] = []
  for await (const row of readCsv(path(FILES.teams))) allTeams.push(toTeam(row))
  const teamById = new Map(allTeams.map((t) => [t.id, t]))

  const mlbLeague = leagues.find((l) => l.id === MLB_LEAGUE_ID)
  if (!mlbLeague) throw new Error(`MLB league ${MLB_LEAGUE_ID} not present in leagues.csv`)
  const season = mlbLeague.seasonYear
  if (bnnSnapshot && mlbLeague.currentDate !== bnnSnapshot.reportDate) {
    log(`BNN snapshot date ${bnnSnapshot.reportDate} differs from CSV sim date ${mlbLeague.currentDate}; rankings may not reflect the CSV date`)
  }

  const mlbTeams = allTeams.filter((t) => t.leagueId === MLB_LEAGUE_ID && !ALL_STAR_ABBRS.has(t.abbr))
  const mlbTeamIds = new Set(mlbTeams.map((t) => t.id))
  log(`${leagues.length} leagues, ${allTeams.length} teams, ${mlbTeams.length} MLB clubs, season ${season}`)

  // ---------------------------------------------------------------- standings

  const standings: StandingRow[] = []
  const standingSourceRows: Row[] = []
  for await (const row of readCsv(path(FILES.teamRecord))) {
    const line = toStanding(row, teamById)
    if (line && mlbTeamIds.has(line.teamId)) {
      standings.push(line)
      standingSourceRows.push(row)
    }
  }
  standings.sort((a, b) => a.teamId - b.teamId)
  const qualifyingTeamGames = teamGamesFromRecords(standingSourceRows, mlbTeamIds)
  const missingTeamGames = mlbTeams.filter((team) => !qualifyingTeamGames.has(team.id)).map((team) => team.id)
  log(`qualifying team games: ${qualifyingTeamGames.size}/${mlbTeams.length} clubs` +
    (missingTeamGames.length ? `; missing/invalid for ${missingTeamGames.join(', ')} (rate qualifiers omitted)` : ''))

  // ---------------------------------------------------------------- team totals

  const battingTotals = new Map<number, Row>()
  for await (const row of readCsv(path(FILES.teamBatting))) {
    if (int(row.league_id) === MLB_LEAGUE_ID) battingTotals.set(int(row.team_id), row)
  }
  const pitchingTotals = new Map<number, Row>()
  for await (const row of readCsv(path(FILES.teamPitching))) {
    if (int(row.league_id) === MLB_LEAGUE_ID) pitchingTotals.set(int(row.team_id), row)
  }
  const teamStats: TeamStats[] = []
  for (const [teamId, battingRow] of battingTotals) {
    const pitchingRow = pitchingTotals.get(teamId)
    if (pitchingRow && mlbTeamIds.has(teamId)) teamStats.push(toTeamStats(battingRow, pitchingRow))
  }
  teamStats.sort((a, b) => a.teamId - b.teamId)
  log(`standings: ${standings.length}, team stat lines: ${teamStats.length}`)

  // ---------------------------------------------------------------- rosters

  const rosterPlayerIds = new Set<number>()
  const rosterTeams = new Map<number, Set<number>>()
  const rosterFlags = new Map<number, { active: boolean; teamId: number; position: number }>()
  for await (const row of readCsv(path(FILES.rosterStatus))) {
    const playerId = int(row.player_id)
    const teamId = int(row.team_id)
    rosterPlayerIds.add(playerId)
    rosterFlags.set(playerId, {
      active: str(row.is_active) === '1',
      teamId,
      position: int(row.position),
    })
    if (mlbTeamIds.has(teamId) && str(row.is_active) === '1') {
      const set = rosterTeams.get(teamId) ?? new Set<number>()
      set.add(playerId)
      rosterTeams.set(teamId, set)
    }
  }
  log(`roster rows: ${rosterPlayerIds.size} players tracked, ${rosterTeams.size} MLB rosters`)

  const leaguesById = new Map(leagues.map((l) => [l.id, l]))
  const minorRosterIds = new Set<number>()
  const mlbGamesByMinor = new Map<number, number>()
  const teamOfPlayer = new Map<number, number>()
  for (const [playerId, flag] of rosterFlags) {
    teamOfPlayer.set(playerId, flag.teamId)
    const team = teamById.get(flag.teamId)
    if (team && team.level > 1) minorRosterIds.add(playerId)
  }
  log(`minor-league players tracked: ${minorRosterIds.size}`)

  // ---------------------------------------------------------------- season stats (current year, MLB)

  const battingSeason = new Map<number, BattingSeason[]>()
  const seasonBattingRecords: BattingRecord[] = []
  const battingLeaderRecords: BattingLeaderRecord[] = []
  for await (const row of readCsv(path(FILES.careerBatting))) {
    // split_id 1 is the full-season total; 2 and 3 are platoon splits of the same playing time.
    if (int(row.year) !== season || int(row.league_id) !== MLB_LEAGUE_ID || int(row.split_id) !== 1) continue
    const playerId = int(row.player_id)
    const line = toBattingSeason(row)
    const list = battingSeason.get(playerId) ?? []
    list.push(line)
    battingSeason.set(playerId, list)
    seasonBattingRecords.push({ playerId, line })
    battingLeaderRecords.push({ playerId, line, paKnown: battingPaKnown(row), rawWar: leaderRawWar(row), rateKnown: battingRateKnown(row) })
  }

  const pitchingSeason = new Map<number, PitchingSeason[]>()
  const seasonPitchingRecords: PitchingRecord[] = []
  const pitchingLeaderRecords: PitchingLeaderRecord[] = []
  const invalidCurrentPitchingUsage = new Set<number>()
  for await (const row of readCsv(path(FILES.careerPitching))) {
    if (int(row.year) !== season || int(row.league_id) !== MLB_LEAGUE_ID || int(row.split_id) !== 1) continue
    const playerId = int(row.player_id)
    if (!validPitchingUsage(row)) invalidCurrentPitchingUsage.add(playerId)
    const line = toPitchingSeason(row)
    const list = pitchingSeason.get(playerId) ?? []
    list.push(line)
    pitchingSeason.set(playerId, list)
    seasonPitchingRecords.push({ playerId, line })
    pitchingLeaderRecords.push({ playerId, line, outs: pitchingOuts(row), rawWar: leaderRawWar(row), rateKnown: pitchingRateKnown(row) })
  }

  const mlbPlayerIds = new Set<number>([...battingSeason.keys(), ...pitchingSeason.keys()])
  for (const ids of rosterTeams.values()) for (const id of ids) mlbPlayerIds.add(id)
  log(`season batting rows: ${seasonBattingRecords.length}, pitching rows: ${seasonPitchingRecords.length}, MLB players: ${mlbPlayerIds.size}`)

  // ---------------------------------------------------------------- career history for MLB players

  const prospectBatting = new Map<number, { level: number; line: BattingSeason }>()
  const prospectPitching = new Map<number, { level: number; line: PitchingSeason; usageKnown: boolean }>()

  type BatAgg = { g: number; ab: number; h: number; hr: number; rbi: number; r: number; sb: number; first: number; last: number }
  type PitAgg = { g: number; w: number; l: number; sv: number; k: number; first: number; last: number }
  const franchiseBatting = new Map<number, Map<number, BatAgg>>()
  const franchisePitching = new Map<number, Map<number, PitAgg>>()

  // Every qualifying MLB season the save remembers, for the historical prospect comp. Names are
  // attached later: players.csv is read after this pass, and retired players live there too.
  const historicalBatting = new Map<string, HistoricalSeason>()
  const historicalPitching = new Map<string, HistoricalSeason>()
  const invalidBatting = new Set<string>()
  const invalidPitching = new Set<string>()

  const careerBatting = new Map<number, BattingSeason[]>()
  for await (const row of readCsv(path(FILES.careerBatting))) {
    const playerId = int(row.player_id)
    if (int(row.split_id) === 1 && int(row.league_id) === MLB_LEAGUE_ID && int(row.year) < season) {
      const key = `${playerId}|${int(row.year)}`
      const positionCode = int(row.position)
      const prev = historicalBatting.get(key)
      // A zero/unknown position cannot be inferred from a player's present bio. Every stint must
      // be complete and carry the same precise position before fielding usage can validate it.
      if (!positionGroupOf(positionCode) || (prev && prev.positionCode !== positionCode) ||
          !completeCounts(row, ['ab', 'pa', 'h', 'd', 't', 'hr', 'bb', 'k', 'sb', 'g'])) {
        invalidBatting.add(key)
      } else if (!invalidBatting.has(key)) {
        const entry = prev ?? { playerId, key, name: '', year: int(row.year), positionCode,
          pitcher: false, hasProfile: false, source: 'save' as const, age: null, bats: null, throws: null,
          bat: { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, sb: 0, pa: 0, g: 0, positionGames: 0 } }
        const b = entry.bat!
        for (const field of ['ab', 'pa', 'h', 'd', 't', 'hr', 'bb', 'k', 'sb', 'g'] as const) b[field] += int(row[field])
        historicalBatting.set(key, entry)
      }
    }
    if (minorRosterIds.has(playerId) && int(row.league_id) === MLB_LEAGUE_ID && int(row.split_id) === 1) {
      // Career major-league games, so a veteran on a minor-league assignment is not ranked as a
      // prospect just because his current roster is Triple-A.
      mlbGamesByMinor.set(playerId, (mlbGamesByMinor.get(playerId) ?? 0) + int(row.g))
    }
    if (int(row.split_id) === 1 && int(row.year) === season && minorRosterIds.has(playerId)) {
      // Only the line from the club he is currently assigned to, so a .428 college season never
      // gets printed next to a Triple-A level.
      const current = teamById.get(teamOfPlayer.get(playerId) ?? 0)
      if (current && int(row.league_id) === current.leagueId) {
        prospectBatting.set(playerId, { level: current.level, line: toBattingSeason(row) })
      }
    }
    if (int(row.split_id) === 1 && int(row.league_id) === MLB_LEAGUE_ID) {
      // Franchise leaders count everything a player did in that club's uniform, retired or not.
      const teamId = int(row.team_id)
      const byPlayer = franchiseBatting.get(teamId) ?? new Map<number, BatAgg>()
      const year = int(row.year)
      const agg = byPlayer.get(playerId) ?? { g: 0, ab: 0, h: 0, hr: 0, rbi: 0, r: 0, sb: 0, first: year, last: year }
      agg.g += int(row.g)
      agg.ab += int(row.ab)
      agg.h += int(row.h)
      agg.hr += int(row.hr)
      agg.rbi += int(row.rbi)
      agg.r += int(row.r)
      agg.sb += int(row.sb)
      agg.first = Math.min(agg.first, year)
      agg.last = Math.max(agg.last, year)
      byPlayer.set(playerId, agg)
      franchiseBatting.set(teamId, byPlayer)
    }
    if (!mlbPlayerIds.has(playerId)) continue
    if (int(row.split_id) !== 1) continue
    if (int(row.year) === season && int(row.league_id) === MLB_LEAGUE_ID) continue
    const list = careerBatting.get(playerId) ?? []
    list.push(toBattingSeason(row))
    careerBatting.set(playerId, list)
  }
  const careerPitching = new Map<number, PitchingSeason[]>()
  for await (const row of readCsv(path(FILES.careerPitching))) {
    const playerId = int(row.player_id)
    if (int(row.split_id) === 1 && int(row.league_id) === MLB_LEAGUE_ID && int(row.year) < season) {
      const key = `${playerId}|${int(row.year)}`
      const validIp = /^\d+(?:\.[012])?$/.test(str(row.ip))
      if (!validIp || !completeCounts(row, ['bf', 'bb', 'k', 'hra', 'gs', 'g'])) {
        invalidPitching.add(key)
      } else if (!invalidPitching.has(key)) {
        const entry = historicalPitching.get(key) ?? { playerId, key, name: '', year: int(row.year),
          positionCode: 1, pitcher: true, hasProfile: false, source: 'save' as const, age: null, bats: null,
          throws: null, pit: { ip: 0, bf: 0, bb: 0, k: 0, hr: 0, gs: 0, g: 0 } }
        const p = entry.pit!
        p.ip += ipToOuts(num(row.ip)) / 3
        for (const field of ['bf', 'bb', 'k', 'gs', 'g'] as const) p[field] += int(row[field])
        p.hr += int(row.hra)
        historicalPitching.set(key, entry)
      }
    }
    if (minorRosterIds.has(playerId) && int(row.league_id) === MLB_LEAGUE_ID && int(row.split_id) === 1) {
      mlbGamesByMinor.set(playerId, (mlbGamesByMinor.get(playerId) ?? 0) + int(row.g))
    }
    if (int(row.split_id) === 1 && int(row.year) === season && minorRosterIds.has(playerId)) {
      const current = teamById.get(teamOfPlayer.get(playerId) ?? 0)
      if (current && int(row.league_id) === current.leagueId) {
        prospectPitching.set(playerId, { level: current.level, line: toPitchingSeason(row), usageKnown: validPitchingUsage(row) })
      }
    }
    if (int(row.split_id) === 1 && int(row.league_id) === MLB_LEAGUE_ID) {
      const teamId = int(row.team_id)
      const byPlayer = franchisePitching.get(teamId) ?? new Map<number, PitAgg>()
      const year = int(row.year)
      const agg = byPlayer.get(playerId) ?? { g: 0, w: 0, l: 0, sv: 0, k: 0, first: year, last: year }
      agg.g += int(row.g)
      agg.w += int(row.w)
      agg.l += int(row.l)
      agg.sv += int(row.sv)
      agg.k += int(row.k)
      agg.first = Math.min(agg.first, year)
      agg.last = Math.max(agg.last, year)
      byPlayer.set(playerId, agg)
      franchisePitching.set(teamId, byPlayer)
    }
    if (!mlbPlayerIds.has(playerId)) continue
    if (int(row.split_id) !== 1) continue
    if (int(row.year) === season && int(row.league_id) === MLB_LEAGUE_ID) continue
    const list = careerPitching.get(playerId) ?? []
    list.push(toPitchingSeason(row))
    careerPitching.set(playerId, list)
  }
  log(`career rows collected: batting ${[...careerBatting.values()].reduce((n, l) => n + l.length, 0)}, pitching ${[...careerPitching.values()].reduce((n, l) => n + l.length, 0)}`)
  log(`historical comparison rows with explicit batting positions: ${historicalBatting.size}, pitching: ${historicalPitching.size}`)

  // The Lahman database widens the same pool with real major-league seasons. It is optional:
  // without the folder the board keeps the save's own history and nothing else breaks.
  const lahman = await loadLahmanSeasons(LAHMAN_DIR, { log })

  // ---------------------------------------------------------------- league history

  const recordByTeamYear = new Map<string, { w: number; l: number; pct: number }>()
  for await (const row of readCsv(path(FILES.teamHistoryRecord))) {
    if (int(row.league_id) !== MLB_LEAGUE_ID) continue
    recordByTeamYear.set(`${int(row.team_id)}|${int(row.year)}`, {
      w: int(row.w),
      l: int(row.l),
      pct: num(row.pct),
    })
  }

  const championRows: { teamId: number; year: number }[] = []
  for await (const row of readCsv(path(FILES.teamHistory))) {
    if (int(row.league_id) !== MLB_LEAGUE_ID) continue
    // won_playoffs marks the club that won the postseason that year.
    if (str(row.won_playoffs) !== '1') continue
    championRows.push({ teamId: int(row.team_id), year: int(row.year) })
  }
  championRows.sort((a, b) => a.year - b.year)

  const awardIds = new Set<number>()
  const awardsByYear = new Map<number, { hitter: number[]; pitcher: number[]; rookie: number[] }>()
  for await (const row of readCsv(path(FILES.leagueHistory))) {
    if (int(row.league_id) !== MLB_LEAGUE_ID) continue
    const year = int(row.year)
    const entry = awardsByYear.get(year) ?? { hitter: [], pitcher: [], rookie: [] }
    for (const [key, id] of [
      ['hitter', int(row.best_hitter_id)],
      ['pitcher', int(row.best_pitcher_id)],
      ['rookie', int(row.best_rookie_id)],
    ] as const) {
      if (id) {
        entry[key].push(id)
        awardIds.add(id)
      }
    }
    awardsByYear.set(year, entry)
  }
  log(`history: ${championRows.length} championship seasons, ${awardsByYear.size} award years`)

  // ---------------------------------------------------------------- bios, ratings, geography

  const neededBioIds = new Set<number>([...mlbPlayerIds, ...rosterPlayerIds, ...awardIds])
  const bios = new Map<number, PlayerBio>()
  const allNames = new Map<number, string>()
  const compBio = new Map<number, { birthYear: number; birthMonth: number; birthDay: number; bats: Handedness | null; throws: Handedness | null }>()
  for await (const row of readCsv(path(FILES.players))) {
    const id = int(row.player_id)
    allNames.set(id, `${str(row.first_name)} ${str(row.last_name)}`.trim())
    const birth = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str(row.date_of_birth))
    compBio.set(id, { birthYear: birth ? Number(birth[1]) : 0, birthMonth: birth ? Number(birth[2]) : 0,
      birthDay: birth ? Number(birth[3]) : 0,
      bats: knownHand(str(row.bats), true), throws: knownHand(str(row.throws)) })
    if (!neededBioIds.has(id)) continue
    bios.set(id, toPlayerBio(row))
  }

  const battingRatings = new Map<number, Row>()
  for await (const row of readCsv(path(FILES.playerBattingRatings))) {
    const id = int(row.player_id)
    if (mlbPlayerIds.has(id) || rosterPlayerIds.has(id)) battingRatings.set(id, row)
  }
  const pitchingRatings = new Map<number, Row>()
  for await (const row of readCsv(path(FILES.playerPitchingRatings))) {
    const id = int(row.player_id)
    if (mlbPlayerIds.has(id) || rosterPlayerIds.has(id)) pitchingRatings.set(id, row)
  }

  // Fielding ratings feed the "defense" axis only when actually present.
  const fieldingRatings = new Map<number, Row>()
  if (existsSync(path(FILES.playerFieldingRatings))) {
    for await (const row of readCsv(path(FILES.playerFieldingRatings))) {
      const id = int(row.player_id)
      if (mlbPlayerIds.has(id) || rosterPlayerIds.has(id)) fieldingRatings.set(id, row)
    }
  }

  const nationNames = new Map<number, string>()
  const nations: { id: number; name: string; abbr: string }[] = []
  for await (const row of readCsv(path(FILES.nations))) {
    const id = int(row.nation_id)
    nationNames.set(id, str(row.name))
    nations.push({ id, name: str(row.name), abbr: str(row.abbr) })
  }

  const neededCityIds = new Set<number>()
  for (const bio of bios.values()) if (bio.cityOfBirthId) neededCityIds.add(bio.cityOfBirthId)
  const cityNames = new Map<number, string>()
  for await (const row of readCsv(path(FILES.cities))) {
    const id = int(row.city_id)
    if (neededCityIds.has(id)) cityNames.set(id, str(row.name))
  }
  log(`bios ${bios.size}, rating rows ${battingRatings.size + pitchingRatings.size}, cities ${cityNames.size}`)

  // ---------------------------------------------------------------- games

  const messages: MessageItem[] = []

  const games: Game[] = []
  for await (const row of readCsv(path(FILES.games))) {
    if (int(row.league_id) !== MLB_LEAGUE_ID) continue
    games.push(toGame(row))
  }
  games.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  log(`games: ${games.length}`)

  const gameBatting: GameBatLine[] = []
  for await (const row of readCsv(path(FILES.gameBatting))) {
    // Game-level rows are single lines per player-game: split_id is 0 here, not 1.
    if (int(row.year) !== season || int(row.league_id) !== MLB_LEAGUE_ID) continue
    gameBatting.push({
      playerId: int(row.player_id),
      gameId: int(row.game_id),
      teamId: int(row.team_id),
      pos: positionName(int(row.position)),
      ab: int(row.ab),
      r: int(row.r),
      h: int(row.h),
      d: int(row.d),
      t: int(row.t),
      hr: int(row.hr),
      rbi: int(row.rbi),
      bb: int(row.bb),
      k: int(row.k),
    })
  }
  log(`game batting lines: ${gameBatting.length}`)

  const gamePitching: GamePitLine[] = []
  for await (const row of readCsv(path(FILES.gamePitching))) {
    if (int(row.year) !== season || int(row.league_id) !== MLB_LEAGUE_ID) continue
    gamePitching.push({
      playerId: int(row.player_id),
      gameId: int(row.game_id),
      teamId: int(row.team_id),
      ip: num(row.ip),
      h: int(row.ha),
      r: int(row.r),
      er: int(row.er),
      bb: int(row.bb),
      k: int(row.k),
      gs: int(row.gs),
    })
  }
  log(`game pitching lines: ${gamePitching.length}`)

  // ---------------------------------------------------------------- fielding and awards

  const fieldingByPlayer = new Map<number, Map<string, FieldingLine>>()
  for await (const row of readCsv(path(FILES.careerFielding))) {
    const playerId = int(row.player_id)
    const historicalRow = historicalBatting.get(`${playerId}|${int(row.year)}`)
    if (historicalRow && !invalidBatting.has(historicalRow.key) && int(row.league_id) === MLB_LEAGUE_ID &&
        int(row.split_id) === 1 && int(row.position) === historicalRow.positionCode &&
        completeCounts(row, ['g'])) {
      historicalRow.bat!.positionGames += int(row.g)
    }
    if (!mlbPlayerIds.has(playerId)) continue
    if (int(row.league_id) !== MLB_LEAGUE_ID || int(row.split_id) !== 1) continue
    const position = positionName(int(row.position))
    const byPos = fieldingByPlayer.get(playerId) ?? new Map<string, FieldingLine>()
    const line = byPos.get(position) ?? { position, g: 0, po: 0, a: 0, e: 0, dp: 0, fpct: 0, range: 0 }
    line.g += int(row.g)
    line.po += int(row.po)
    line.a += int(row.a)
    line.e += int(row.e)
    line.dp += int(row.dp)
    byPos.set(position, line)
    fieldingByPlayer.set(playerId, byPos)
  }
  for (const byPos of fieldingByPlayer.values()) {
    for (const line of byPos.values()) {
      const chances = line.po + line.a + line.e
      line.fpct = chances ? (line.po + line.a) / chances : 0
      line.range = line.g ? (line.po + line.a) / line.g : 0
    }
  }

  // Awards come from the league history table, which records one winner per league and season.
  const awardsByPlayer = new Map<number, { year: number; label: string }[]>()
  const awardLabel = (kind: string) => kind
  for (const [year, entry] of awardsByYear) {
    for (const id of entry.hitter) {
      const list = awardsByPlayer.get(id) ?? []
      list.push({ year, label: awardLabel('Best hitter') })
      awardsByPlayer.set(id, list)
    }
    for (const id of entry.pitcher) {
      const list = awardsByPlayer.get(id) ?? []
      list.push({ year, label: awardLabel('Best pitcher') })
      awardsByPlayer.set(id, list)
    }
    for (const id of entry.rookie) {
      const list = awardsByPlayer.get(id) ?? []
      list.push({ year, label: awardLabel('Rookie of the year') })
      awardsByPlayer.set(id, list)
    }
  }

  // ---------------------------------------------------------------- assemble players

  const players: PlayerDetail[] = []
  for (const id of [...mlbPlayerIds].sort((a, b) => a - b)) {
    const bio = bios.get(id)
    if (!bio) continue
    const seasonBattingLines = (battingSeason.get(id) ?? []).sort((a, b) => a.stint - b.stint)
    const seasonPitchingLines = (pitchingSeason.get(id) ?? []).sort((a, b) => a.stint - b.stint)
    const historyBatting = (careerBatting.get(id) ?? []).sort((a, b) => b.year - a.year || a.teamId - b.teamId)
    const historyPitching = (careerPitching.get(id) ?? []).sort((a, b) => b.year - a.year || a.teamId - b.teamId)

    // History contains minor/other leagues too, but the displayed major-league career totals do not.
    const allBatting = [...seasonBattingLines, ...historyBatting].filter((line) => line.leagueId === MLB_LEAGUE_ID)
    const allPitching = [...seasonPitchingLines, ...historyPitching].filter((line) => line.leagueId === MLB_LEAGUE_ID)

    const careerBattingTotal = allBatting.length ? sumBatting(allBatting) : null
    const careerPitchingSum = combinePitching(allPitching)
    const careerPitchingTotal = careerPitchingSum ? {
      ...careerPitchingSum, year: 0, teamId: 0, leagueId: 0, levelId: 0, stint: 0,
      war: round(careerPitchingSum.war, 1),
    } : null

    players.push({
      ...bio,
      awards: (awardsByPlayer.get(id) ?? []).sort((a, b) => b.year - a.year),
      fielding: [...(fieldingByPlayer.get(id)?.values() ?? [])]
        .sort((a, b) => b.g - a.g)
        .slice(0, 5),
      ratings: toRatings(battingRatings.get(id), pitchingRatings.get(id)) as Ratings,
      batting: [...seasonBattingLines, ...historyBatting],
      pitching: [...seasonPitchingLines, ...historyPitching],
      careerBatting: careerBattingTotal,
      careerPitching: careerPitchingTotal,
    })
  }
  log(`player details assembled: ${players.length}`)

  // ---------------------------------------------------------------- leaders

  const nameById = new Map([...bios].map(([id, bio]) => [id, `${bio.firstName} ${bio.lastName}`.trim()]))
  // Game rows carry a numeric position, and 0 means "no fielding position recorded" — fall back
  // to the position listed on the player's own record rather than printing UTIL.
  const battingForBox = gameBatting.map((line) =>
    line.pos === 'UTIL' ? { ...line, pos: bios.get(line.playerId)?.position ?? '—' } : line,
  )

  // Integrity failures are fatal and are reported before bundle data is written.
  const { failures, checked } = validate({
    teams: teamById,
    standings,
    games,
    batting: seasonBattingRecords,
    pitching: seasonPitchingRecords,
    playerIds: new Set(bios.keys()),
  })
  if (failures.length) {
    const report = {
      ok: false,
      failures,
      checked,
      counts: {
        leagues: leagues.length, teams: allTeams.length, mlbTeams: mlbTeams.length,
        standings: standings.length, games: games.length, mlbPlayers: players.length,
        playerIndex: [...rosterPlayerIds].filter((id) => bios.has(id)).length,
        minorPlayers: minorRosterIds.size, battingRows: seasonBattingRecords.length,
        pitchingRows: seasonPitchingRecords.length,
      },
      durationSeconds: round((Date.now() - started) / 1000, 1),
    }
    writeImportReport(OUT_DIR, report)
    log(`validation failures: ${failures.length}`)
    for (const f of failures.slice(0, 10)) console.error(`  ${f.check}: ${f.detail}`)
    throw new Error('Import validation failed; no bundle is publishable')
  }

  // ---------------------------------------------------------------- franchise leaders

  const buildBattingLeaders = (byPlayer: Map<number, BatAgg>): FranchiseLeaders['batting'] => {
    const rows = [...byPlayer.entries()]
    const pick = (label: string, key: keyof BatAgg, unit: string) => ({
      key: `${label}`,
      label,
      leaders: rows
        .sort((a, b) => (b[1][key] as number) - (a[1][key] as number))
        .slice(0, 8)
        .map(([playerId, agg]) => ({
          playerId,
          name: allNames.get(playerId) ?? `Player ${playerId}`,
          value: `${(agg[key] as number).toLocaleString('en-US')}${unit}`,
          note: agg.first === agg.last ? `${agg.first}` : `${agg.first}–${agg.last}`,
          hasProfile: mlbPlayerIds.has(playerId),
        })),
    })
    return [
      pick('Home runs', 'hr', ''),
      pick('Hits', 'h', ''),
      pick('RBI', 'rbi', ''),
      pick('Runs', 'r', ''),
      pick('Stolen bases', 'sb', ''),
    ]
  }

  const buildPitchingLeaders = (byPlayer: Map<number, PitAgg>): FranchiseLeaders['pitching'] => {
    const rows = [...byPlayer.entries()]
    const pick = (label: string, key: keyof PitAgg, unit: string) => ({
      key: `${label}`,
      label,
      leaders: rows
        .sort((a, b) => (b[1][key] as number) - (a[1][key] as number))
        .slice(0, 8)
        .map(([playerId, agg]) => ({
          playerId,
          name: allNames.get(playerId) ?? `Player ${playerId}`,
          value: `${(agg[key] as number).toLocaleString('en-US')}${unit}`,
          note: agg.first === agg.last ? `${agg.first}` : `${agg.first}–${agg.last}`,
          hasProfile: mlbPlayerIds.has(playerId),
        })),
    })
    return [
      pick('Wins', 'w', ''),
      pick('Strikeouts', 'k', ''),
      pick('Saves', 'sv', ''),
      pick('Games', 'g', ''),
    ]
  }

  for (const team of mlbTeams) {
    const leaders: FranchiseLeaders = {
      teamId: team.id,
      batting: buildBattingLeaders(franchiseBatting.get(team.id) ?? new Map()),
      pitching: buildPitchingLeaders(franchisePitching.get(team.id) ?? new Map()),
    }
    write(`mlb/team-leaders/${team.id}.json`, leaders)
  }
  log(`franchise leaders written for ${mlbTeams.length} clubs`)

  const boxes = buildBoxscores({
    games,
    batting: battingForBox,
    pitching: gamePitching,
    names: nameById,
    teams: teamById,
  })
  for (const [date, scores] of boxes.byDate) write(`mlb/boxscores/${date}.json`, scores)
  write('mlb/boxscore-index.json', boxes.index)
  log(`box scores: ${Object.keys(boxes.index).length} games across ${boxes.byDate.size} dates`)

  const leaders = buildLeaders({ batting: battingLeaderRecords, pitching: pitchingLeaderRecords, names: nameById,
    season, mlbLeagueId: MLB_LEAGUE_ID, teamGames: qualifyingTeamGames,
    rosterTeams: new Map([...teamOfPlayer].filter(([, teamId]) => mlbTeamIds.has(teamId))) })

  // ---------------------------------------------------------------- prospects + news

  const leagueAbbr = new Map(leagues.map((l) => [l.id, l.abbr]))

  const orgOf = (teamId: number): number => {
    let current = teamById.get(teamId)
    let hops = 0
    while (current && current.level > 1 && current.parentTeamId && hops < 8) {
      const parent = teamById.get(current.parentTeamId)
      if (!parent) break
      current = parent
      hops++
    }
    return current?.id ?? teamId
  }

  const pickTools = (row: Row, prefix: string, keys: string[]): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const key of keys) out[key] = int(row[`${prefix}${key}`])
    return out
  }

  // Defense is the rating at the position the player actually plays, with the arm that position
  // uses folded in — a shortstop's arm matters, a left fielder's matters differently.
  const armColumn = (positionCode: number): string => {
    if (positionCode === 2) return 'fielding_ratings_catcher_arm'
    if (positionCode >= 7 && positionCode <= 9) return 'fielding_ratings_outfield_arm'
    return 'fielding_ratings_infield_arm'
  }
  const defenseGrade = (id: number, positionCode: number, potential: boolean): number | undefined => {
    const row = fieldingRatings.get(id)
    if (!row) return undefined
    const key = `fielding_rating_pos${positionCode}`
    const rating = int(row[potential ? `${key}_pot` : key])
    if (rating < 20 || rating > 100) return undefined
    const arm = int(row[armColumn(positionCode)])
    return arm >= 20 && arm <= 100 ? Math.round(rating * 0.8 + arm * 0.2) : rating
  }

  const ratingFor = (id: number): RatingRow | null => {
    const bio = bios.get(id)
    if (!bio) return null
    const pitcher = bio.positionCode === 1
    const batRow = battingRatings.get(id)
    const pitRow = pitchingRatings.get(id)
    if (pitcher && pitRow) {
      const tools = pickTools(pitRow, 'pitching_ratings_overall_', ['stuff', 'movement', 'control'])
      const potentialTools = pickTools(pitRow, 'pitching_ratings_talent_', ['stuff', 'movement', 'control'])
      const stamina = int(pitRow['pitching_ratings_misc_stamina'])
      tools.stamina = stamina
      potentialTools.stamina = stamina
      return {
        playerId: id,
        kind: 'pit',
        current: Math.round((tools.stuff + tools.movement + tools.control) / 3),
        potential: Math.round((potentialTools.stuff + potentialTools.movement + potentialTools.control) / 3),
        tools,
        potentialTools,
      }
    }
    if (!pitcher && batRow) {
      const tools = pickTools(batRow, 'batting_ratings_overall_', ['contact', 'gap', 'power', 'eye'])
      const potentialTools = pickTools(batRow, 'batting_ratings_talent_', ['contact', 'gap', 'power', 'eye'])
      // The comparison vector needs the whole profile, not just the four bat tools.
      tools.avoidK = int(batRow['batting_ratings_overall_strikeouts'])
      tools.speed = int(batRow['running_ratings_speed'])
      const defense = defenseGrade(id, bio.positionCode, false)
      if (defense !== undefined) tools.defense = defense
      potentialTools.avoidK = int(batRow['batting_ratings_talent_strikeouts'])
      potentialTools.speed = int(batRow['running_ratings_speed'])
      const potentialDefense = defenseGrade(id, bio.positionCode, true)
      if (potentialDefense !== undefined) potentialTools.defense = potentialDefense
      return {
        playerId: id,
        kind: 'bat',
        current: Math.round((tools.contact + tools.gap + tools.power + tools.eye) / 4),
        potential: Math.round((potentialTools.contact + potentialTools.gap + potentialTools.power + potentialTools.eye) / 4),
        tools,
        potentialTools,
      }
    }
    return null
  }

  const prospectPlayers = []
  // Match against the entire roster universe, including MLB and unaffiliated players, so a
  // duplicate name cannot become falsely unique merely because a candidate was pre-filtered.
  for (const id of rosterPlayerIds) {
    const bio = bios.get(id)
    if (!bio) continue
    prospectPlayers.push({
      id,
      firstName: bio.firstName,
      lastName: bio.lastName,
      age: bio.age,
      position: bio.position,
      positionCode: bio.positionCode,
      teamId: bio.teamId,
      nation: nationNames.get(bio.nationId) ?? '',
      bats: bio.bats,
      throws: bio.throws,
      compBats: compBio.get(id)?.bats ?? null,
      compThrows: compBio.get(id)?.throws ?? null,
    })
  }
  const bnnMatches = bnnSnapshot ? matchBnn(bnnSnapshot, prospectPlayers.map((player) => {
    const orgId = orgOf(player.teamId)
    return {
      id: player.id,
      name: `${player.firstName} ${player.lastName}`.trim(),
      age: player.age,
      position: player.position,
      orgId,
      orgCity: teamById.get(orgId)?.city ?? '',
    }
  }), mlbLeague.currentDate) : { byPlayerId: new Map(), unmatched: [], ambiguous: [] }
  for (const issue of [...bnnMatches.unmatched, ...bnnMatches.ambiguous]) {
    log(`BNN unresolved #${issue.entry.rank} ${issue.entry.name}: ${issue.reason}` +
      (issue.candidateIds ? ` (candidates ${issue.candidateIds.join(', ')})` : ''))
  }
  if (bnnSnapshot) log(`BNN identities: ${bnnMatches.byPlayerId.size}/100 matched, ${bnnMatches.unmatched.length} unmatched, ${bnnMatches.ambiguous.length} ambiguous`)

  const prospectRatings = new Map<number, RatingRow>()
  for (const player of prospectPlayers) {
    const rating = ratingFor(player.id)
    if (rating) prospectRatings.set(player.id, rating)
  }

  const prospectLines = new Map<number, SeasonLine>()
  for (const [id, entry] of prospectBatting) {
    prospectLines.set(id, {
      playerId: id,
      leagueAbbr: leagueAbbr.get(entry.line.leagueId) ?? '',
      g: entry.line.g,
      avg: entry.line.avg,
      hr: entry.line.hr,
      rbi: entry.line.rbi,
    })
  }
  for (const [id, entry] of prospectPitching) {
    prospectLines.set(id, {
      playerId: id,
      leagueAbbr: leagueAbbr.get(entry.line.leagueId) ?? '',
      g: entry.line.g,
      gs: entry.line.gs,
      w: entry.line.w,
      l: entry.line.l,
      era: entry.line.era,
      ip: entry.line.ip,
      k: entry.line.k,
      usageKnown: entry.usageKnown,
    })
  }

  const prospectLinesWithMlb = addMlbProspectLines({
    lines: prospectLines,
    players: prospectPlayers,
    ratings: prospectRatings,
    teams: teamById,
    bnnMatches: bnnMatches.byPlayerId,
    batting: battingSeason,
    pitching: pitchingSeason,
    leagues: leagueAbbr,
    invalidPitchingUsage: invalidCurrentPitchingUsage,
  })

  // The career batting table has position=0; game batting rows carry the actual position. Use
  // regular-season games only, counting unknown/PH in the denominator, not spring-training use.
  const regularGameIds = new Set(games.filter((game) => game.gameType === 0 && game.played).map((game) => game.id))
  const positionCodes: Record<string, number> = { C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9, DH: 10 }
  const currentPositions = new Map<number, { games: number; positions: Map<number, number> }>()
  for (const line of gameBatting) {
    if (!regularGameIds.has(line.gameId)) continue
    const usage = currentPositions.get(line.playerId) ?? { games: 0, positions: new Map<number, number>() }
    usage.games++
    const code = positionCodes[line.pos]
    if (code) usage.positions.set(code, (usage.positions.get(code) ?? 0) + 1)
    currentPositions.set(line.playerId, usage)
  }
  const currentPositionOf = (id: number, minimumGames: number): number | null => {
    const usage = currentPositions.get(id)
    if (!usage) return null
    const slots = [...usage.positions].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const top = slots[0]
    if (!top || top[1] < minimumGames || top[1] / usage.games < 0.5 || slots[1]?.[1] === top[1]) return null
    return top[0]
  }

  // Current major leaguers with meaningful playing time; pitcher roles use actual MLB usage.
  const peers: PeerPlayer[] = []
  const gamesByTeam = new Map(standings.map((row) => [row.teamId, row.g]))
  for (const id of mlbPlayerIds) {
    const bio = bios.get(id)
    const rating = ratingFor(id)
    if (!bio || !rating) continue
    const floors = currentUsageFloors(gamesByTeam.get(bio.teamId) ?? 0)
    if (!floors) continue
    const name = `${bio.firstName} ${bio.lastName}`.trim()
    if (rating.kind === 'bat') {
      const pa = (battingSeason.get(id) ?? []).reduce((total, line) => total + line.pa, 0)
      const positionCode = currentPositionOf(id, floors.positionGames)
      if (pa < floors.pa || positionCode === null) continue
      const tools = { ...rating.tools }
      delete tools.defense
      const defense = defenseGrade(id, positionCode, false)
      if (defense !== undefined) tools.defense = defense
      peers.push({ id, name, positionCode, tools, gs: 0, g: 0,
        age: bio.age > 0 ? bio.age : null, bats: compBio.get(id)?.bats ?? null, throws: compBio.get(id)?.throws ?? null })
    } else {
      const lines = pitchingSeason.get(id) ?? []
      const ip = lines.reduce((total, line) => total + line.ip, 0)
      const gs = lines.reduce((total, line) => total + line.gs, 0)
      const g = lines.reduce((total, line) => total + line.g, 0)
      const role = pitchingGroup(gs, g)
      if (invalidCurrentPitchingUsage.has(id) || !role || ip < (role === 'SP' ? floors.starterIp : floors.relieverIp)) continue
      peers.push({
        id,
        name,
        positionCode: 1,
        tools: rating.tools,
        gs,
        g,
        age: bio.age > 0 ? bio.age : null,
        bats: compBio.get(id)?.bats ?? null,
        throws: compBio.get(id)?.throws ?? null,
      })
    }
  }
  log(`comparison peers: ${peers.length} current major leaguers`)

  // Retired players are named too, so a 1978 comp carries the hitter's name, not his id.
  const historical: HistoricalSeason[] = [
    ...[...historicalBatting.values()].filter((row) => !invalidBatting.has(row.key)),
    ...[...historicalPitching.values()].filter((row) => !invalidPitching.has(row.key)),
  ].map((row) => {
    const bio = compBio.get(row.playerId)
    return { ...row, name: allNames.get(row.playerId) ?? `Player ${row.playerId}`,
      hasProfile: mlbPlayerIds.has(row.playerId),
      age: bio ? baseballAge(row.year, bio.birthYear, bio.birthMonth, bio.birthDay) : null,
      bats: bio?.bats ?? null, throws: bio?.throws ?? null }
  })

  const prospects: Prospect[] = buildProspects({
    players: prospectPlayers,
    ratings: prospectRatings,
    teams: teamById,
    orgOf: (teamId) => {
      const orgId = orgOf(teamId)
      return mlbTeamIds.has(orgId) ? orgId : 0
    },
    lines: prospectLinesWithMlb,
    leagues: leagueAbbr,
    mlbGames: mlbGamesByMinor,
    peers,
    historical,
    externalHistory: lahman.seasons,
    season,
    gameRatings,
    bnnMatches: bnnMatches.byPlayerId,
    limit: 400,
  })
  const publishedIds = new Set(prospects.map((p) => p.id))
  for (const [id, entry] of bnnMatches.byPlayerId) {
    if (!publishedIds.has(id)) {
      const player = prospectPlayers.find((p) => p.id === id)
      const team = player && teamById.get(player.teamId)
      const org = player && teamById.get(orgOf(player.teamId))
      const reason = !prospectRatings.has(id) ? 'missing CSV ratings' : !team ? 'missing current team' :
        !org || !mlbTeamIds.has(org.id) ? 'not currently in the primary league organization' : 'not eligible for board'
      log(`BNN matched but omitted #${entry.rank} ${entry.name} (${id}): ${reason}`)
    }
  }
  if (bnnSnapshot) log(`BNN published: ${prospects.filter((p) => p.bnnRank != null).length}/100; remaining slots use computed grade`)
  log(`prospects ranked: ${prospects.length} of ${minorRosterIds.size} minor leaguers`)
  log(
    `prospect comps: ${prospects.filter((p) => p.comps.current).length} current, ` +
      `${prospects.filter((p) => p.comps.historical).length} historical — each comp used once`,
  )

  // ---------------------------------------------------------------- history bundle

  const titleCount = new Map<number, number>()
  const historySeasons: HistorySeason[] = []
  for (const row of championRows) {
    const record = recordByTeamYear.get(`${row.teamId}|${row.year}`)
    const titles = (titleCount.get(row.teamId) ?? 0) + 1
    titleCount.set(row.teamId, titles)
    historySeasons.push({
      year: row.year,
      championTeamId: row.teamId,
      w: record?.w ?? 0,
      l: record?.l ?? 0,
      pct: record?.pct ?? 0,
      titlesToDate: titles,
    })
  }
  historySeasons.reverse()

  const awardEntry = (ids: number[]): HistoryAward | undefined => {
    for (const id of ids) {
      const bio = bios.get(id)
      if (!bio) continue
      return {
        playerId: id,
        name: `${bio.firstName} ${bio.lastName}`.trim(),
        hasProfile: mlbPlayerIds.has(id),
      }
    }
    return undefined
  }

  const historyAwards = [...awardsByYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, entry]) => ({
      year,
      hitter: awardEntry(entry.hitter),
      pitcher: awardEntry(entry.pitcher),
      rookie: awardEntry(entry.rookie),
    }))
    .filter((row) => row.hitter || row.pitcher || row.rookie)

  const history: History = {
    seasons: historySeasons,
    franchises: [...titleCount.entries()]
      .map(([teamId, titles]) => ({
        teamId,
        titles,
        lastYear: Math.max(...historySeasons.filter((s) => s.championTeamId === teamId).map((s) => s.year)),
      }))
      .sort((a, b) => b.titles - a.titles),
    awards: historyAwards,
  }
  write('history.json', history)
  log(`history written: ${historySeasons.length} seasons, ${history.franchises.length} franchises`)

  // ---------------------------------------------------------------- league news feed

  // messages.csv is OOTP's own news wire: awards, signings, injuries, roster moves, trades.
  // It carries headlines only (no body text), and repeats each item once per recipient, so
  // entries are deduplicated by date + subject.
  const messageIndex = new Map<string, number>()
  for await (const row of readCsv(path(FILES.messages))) {
    const raw = str(row.date)
    const date = isoDate(raw)
    if (!date.startsWith(String(season))) continue
    if (str(row.deleted) === '1') continue
    const subject = str(row.subject).trim()
    if (!subject) continue
    const key = `${date}|${subject}`
    if (messageIndex.has(key)) continue
    const playerId = int(row.player_id_0)
    const teamId = int(row.team_id_0)
    messageIndex.set(key, 1)
    // Tag MLB-scope stories so the front page leads with the majors, not the Appalachian League.
    const levelOf = (id: number | undefined): number => (id ? teamById.get(id)?.level ?? 99 : 99)
    const mlb = levelOf(teamId) === 1 || levelOf(playerId ? bios.get(playerId)?.teamId : undefined) === 1
    messages.push({
      id: int(row.message_id),
      date,
      subject,
      importance: int(row.importance),
      type: int(row.message_type),
      playerId: playerId || undefined,
      playerName: playerId ? bios.get(playerId) ? `${bios.get(playerId)!.firstName} ${bios.get(playerId)!.lastName}`.trim() : undefined : undefined,
      teamId: teamId || undefined,
      mlb,
    })
  }
  messages.sort(
    (a, b) =>
      Number(Boolean(b.mlb)) - Number(Boolean(a.mlb)) ||
      (a.date < b.date ? 1 : a.date > b.date ? -1 : b.importance - a.importance),
  )
  log(`league messages: ${messages.length}`)
  write('messages.json', messages.slice(0, 200))

  // ---------------------------------------------------------------- optional images

  // Old portraits may belong to another save; only the current input can establish identity.
  const { photos, logos, photoIndex, logoIndex } = importImageAssets(
    PHOTO_DIR, LOGO_DIR, OUT_DIR, new Set([...rosterPlayerIds, ...mlbPlayerIds]), allTeams,
  )
  log(`images matched: ${photos.count} current-feed player photos, ${logos.count} club logos`)
  if (!photos.count) log('no current-feed player photos matched; displaying initials')
  log(`image index: ${Object.keys(photoIndex).length} player photos, ${Object.keys(logoIndex).length} club logos`)
  write('photos.json', photoIndex)
  write('logos.json', logoIndex)

  const news: NewsItem[] = buildNews({
    games,
    gameBatting,
    standings,
    divisions,
    subLeagues,
    teams: teamById,
    names: nameById,
    season,
    mlbLeagueId: MLB_LEAGUE_ID,
    seasonBatting: seasonBattingRecords,
    seasonPitching: seasonPitchingRecords,
  })
  log(`news items: ${news.length}`)

  // ---------------------------------------------------------------- write bundle

  const playerIndex = [...rosterPlayerIds]
    .map((id) => {
      const bio = bios.get(id)
      if (!bio) return null
      const team = teamById.get(bio.teamId)
      return {
        id,
        name: `${bio.firstName} ${bio.lastName}`.trim(),
        teamId: bio.teamId,
        teamAbbr: team?.abbr ?? '',
        leagueId: bio.leagueId,
        position: bio.position,
        age: bio.age,
        active: rosterFlags.get(id)?.active ?? false,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  write('leagues.json', leagues)
  write('sub-leagues.json', subLeagues)
  write('divisions.json', divisions)
  write('teams.json', allTeams)
  write('nations.json', nations.sort((a, b) => a.name.localeCompare(b.name)))
  write('players-index.json', playerIndex)
  write('mlb/standings.json', standings)
  write('mlb/team-stats.json', teamStats)
  // ---------------------------------------------------------------- game stories

  interface StoryIndexRow {
    gameId: number
    date: string
    awayTeamId: number
    homeTeamId: number
    awayScore: number
    homeScore: number
    headline: string
    deck: string
  }
  const storyIndex: StoryIndexRow[] = []
  const storiesByMonth = new Map<string, Record<string, unknown>>()
  const teamLookup = new Map(allTeams.map((t) => [t.id, t]))
  if (LOG_DIR) {
    let matched = 0
    for (const game of games) {
      if (!game.played) continue
      const away = teamLookup.get(game.awayTeamId)
      const home = teamLookup.get(game.homeTeamId)
      if (!away || !home) continue
      const innings = parseLog(storyPath(LOG_DIR, game.id))
      if (!innings.length) continue
      const story = buildStory(
        {
          gameId: game.id,
          date: game.date,
          awayAbbr: away.abbr,
          homeAbbr: home.abbr,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
        },
        innings,
      )
      if (!story) continue
      const month = game.date.slice(0, 7)
      const bucket = storiesByMonth.get(month) ?? {}
      bucket[String(game.id)] = story
      storiesByMonth.set(month, bucket)
      storyIndex.push({
        gameId: game.id,
        date: game.date,
        awayTeamId: game.awayTeamId,
        homeTeamId: game.homeTeamId,
        awayScore: game.awayScore,
        homeScore: game.homeScore,
        headline: story.headline,
        deck: story.deck,
      })
      matched += 1
    }
    log(`game stories written: ${matched} of ${games.length} MLB games`)
  } else {
    log('no play-by-play logs supplied (--logs); recaps skipped')
  }
  for (const [month, bucket] of storiesByMonth) write(`mlb/stories/${month}.json`, bucket)
  write('mlb/story-index.json', storyIndex.sort((a, b) => (a.date < b.date ? 1 : -1)))

  write('mlb/games.json', games)
  write('mlb/leaders.json', leaders)
  write('prospects.json', prospects)
  if (bnnSnapshot) write('bnn-rank.json', bnnSnapshot, true)
  write('news.json', news)

  // Split the player payload: summaries stay small and are fetched on demand, while the long
  // career history is bucketed by id so a single player page loads a few hundred KB, not ten.
  const summaries = players.map((p) => ({
    ...p,
    batting: p.batting.filter((line) => line.year === season),
    pitching: p.pitching.filter((line) => line.year === season),
  }))

  // Player pages load only the bucket that contains their id, and team pages load only their
  // own roster — never the whole league's player table.
  const PLAYER_BUCKETS = 32
  const playerBuckets: Record<number, PlayerDetail[]> = {}
  for (const player of summaries) {
    const bucket = player.id % PLAYER_BUCKETS
    ;(playerBuckets[bucket] ??= []).push(player)
  }
  for (let i = 0; i < PLAYER_BUCKETS; i++) {
    write(`mlb/players/${i}.json`, playerBuckets[i] ?? [])
  }

  for (const team of mlbTeams) {
    const roster = summaries
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => (a.positionCode === 1 ? 1 : 0) - (b.positionCode === 1 ? 1 : 0) || a.lastName.localeCompare(b.lastName))
    write(`mlb/rosters/${team.id}.json`, roster)
  }

  const BUCKETS = 32
  const historyBuckets: Record<number, Record<number, { batting: BattingSeason[]; pitching: PitchingSeason[] }>> = {}
  for (const p of players) {
    const bucket = p.id % BUCKETS
    const target = (historyBuckets[bucket] ??= {})
    const battingHistory = p.batting.filter((line) => line.year !== season)
    const pitchingHistory = p.pitching.filter((line) => line.year !== season)
    if (battingHistory.length || pitchingHistory.length) {
      target[p.id] = { batting: battingHistory, pitching: pitchingHistory }
    }
  }
  for (let i = 0; i < BUCKETS; i++) {
    write(`mlb/history/${i}.json`, historyBuckets[i] ?? {})
  }

  const usedFiles = [
    FILES.leagues,
    FILES.subLeagues,
    FILES.divisions,
    FILES.teams,
    FILES.teamRecord,
    FILES.teamBatting,
    FILES.teamPitching,
    FILES.rosterStatus,
    FILES.players,
    FILES.playerBattingRatings,
    FILES.playerPitchingRatings,
    FILES.careerBatting,
    FILES.careerPitching,
    FILES.games,
    FILES.cities,
    FILES.nations,
  ]
  const checksums: Record<string, string> = {}
  const sourceFiles: ImportMeta['sourceFiles'] = []
  for (const file of usedFiles) {
    checksums[file] = await sha256(file)
    sourceFiles.push({ name: file, rows: 0, bytes: statSync(path(file)).size })
  }

  const meta: ImportMeta = {
    generatedAt: new Date().toISOString(),
    season,
    mlbLeagueId: MLB_LEAGUE_ID,
    simDate: mlbLeague.currentDate,
    counts: {
      leagues: leagues.length,
      teams: allTeams.length,
      mlbTeams: mlbTeams.length,
      standings: standings.length,
      games: games.length,
      mlbPlayers: players.length,
      playerIndex: playerIndex.length,
      minorPlayers: minorRosterIds.size,
      battingRows: seasonBattingRecords.length,
      pitchingRows: seasonPitchingRecords.length,
    },
    sourceFiles,
    checksums,
  }
  write('meta.json', meta, true)

  const report = {
    ok: failures.length === 0,
    failures,
    checked,
    counts: meta.counts,
    durationSeconds: round((Date.now() - started) / 1000, 1),
  }
  writeImportReport(OUT_DIR, report)
  log(`validation failures: ${failures.length}`)
  if (failures.length) {
    for (const f of failures.slice(0, 10)) console.error(`  ${f.check}: ${f.detail}`)
  }
  log(`wrote bundle to ${OUT_DIR}`)
}

// ---------------------------------------------------------------- aggregation helpers

function sumBatting(lines: BattingSeason[]): BattingSeason {
  const total = lines.reduce(
    (acc, l) => {
      acc.g += l.g
      acc.ab += l.ab
      acc.r += l.r
      acc.h += l.h
      acc.d += l.d
      acc.t += l.t
      acc.hr += l.hr
      acc.rbi += l.rbi
      acc.bb += l.bb
      acc.ibb += l.ibb
      acc.k += l.k
      acc.sb += l.sb
      acc.cs += l.cs
      acc.hp += l.hp
      acc.sh += l.sh
      acc.sf += l.sf
      acc.gdp += l.gdp
      acc.pa += l.pa
      acc.war += l.war
      return acc
    },
    {
      year: 0,
      teamId: 0,
      leagueId: 0,
      levelId: 0,
      stint: 0,
      g: 0,
      ab: 0,
      r: 0,
      h: 0,
      d: 0,
      t: 0,
      hr: 0,
      rbi: 0,
      bb: 0,
      ibb: 0,
      k: 0,
      sb: 0,
      cs: 0,
      hp: 0,
      sh: 0,
      sf: 0,
      gdp: 0,
      pa: 0,
      avg: 0,
      obp: 0,
      slg: 0,
      ops: 0,
      war: 0,
    },
  )
  total.avg = total.ab ? round(total.h / total.ab, 3) : 0
  const obpDen = total.ab + total.bb + total.hp + total.sf
  total.obp = obpDen ? round((total.h + total.bb + total.hp) / obpDen, 3) : 0
  const tb = total.h + total.d + 2 * total.t + 3 * total.hr
  total.slg = total.ab ? round(tb / total.ab, 3) : 0
  total.ops = round(total.obp + total.slg, 3)
  total.war = round(total.war, 1)
  return total
}

main().catch((err) => {
  console.error(err)
  console.error('Do not publish output from a failed import; use a different new or empty directory for the next attempt.')
  process.exit(1)
})
