/**
 * Lahman Baseball Database → historical comparison seasons.
 *
 * The prospect comp engine already knows how to turn a qualified major-league season into a
 * 0–100 profile: it percentiles each rate stat inside that season's own cohort, so a .300 average
 * in 1968 and in 1998 land in the same place. Lahman only has to supply the counting stats in the
 * same shape OOTP's career tables do, and the same `historicalCandidates()` code rates it — no
 * separate rating model, no second similarity function.
 *
 * The four files are read from `scripts/data/lahman/` (see scripts/data/fetch-lahman.mjs). If the
 * folder is missing the loader returns nothing: the import keeps the pool it had and never fails
 * because a public dataset could not be downloaded.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { int, readCsv, str } from './csv'
import { baseballAge, knownHand, pitchingGroup, MIN_BATTER_PA,
  MIN_POSITION_GAMES, MIN_POSITION_SHARE, MIN_STARTER_IP, MIN_RELIEF_IP, MIN_RELIEF_G,
  type Handedness, type HistoricalSeason } from './prospects'

/** Files the loader needs, in the order they are read. */
export const LAHMAN_FILES = ['People.csv', 'Batting.csv', 'Pitching.csv', 'Appearances.csv'] as const

/** First season that counts. The save's own history covers 1871–, so Lahman's value is depth in
 *  the era a modern prospect can plausibly be compared to. */
export const LAHMAN_FROM_YEAR = 1970

/**
 * OOTP position codes, the only vocabulary the comparison groups understand:
 * 2 = C, 3–6 = infield, 7–9 = outfield, 10 = DH. Lahman records positions as strings.
 */

export interface LahmanPool {
  /** One entry per qualified player-season, ready for buildComparisonPool. */
  seasons: HistoricalSeason[]
  /** Where the files came from, for the import log. */
  source: string
  batters: number
  pitchers: number
}

const EMPTY: LahmanPool = { seasons: [], source: 'none', batters: 0, pitchers: 0 }

/** Census of one player-season across his stints (a mid-season trade is two rows). */
interface BatAgg {
  complete: boolean
  ab: number
  h: number
  d: number
  t: number
  hr: number
  bb: number
  k: number
  hbp: number
  sf: number
  sh: number
  sb: number
  g: number
}

interface PitAgg {
  complete: boolean
  ip: number
  bf: number
  bb: number
  k: number
  hr: number
  gs: number
  g: number
}

const seasonKey = (playerId: string, year: number): string => `${playerId}|${year}`

/**
 * A stable numeric handle for a Lahman string id, so the payload keeps the `playerId: number`
 * shape the site already uses. Lahman ids never collide with OOTP ids (which stay below 200,000),
 * and the hash is salted by probing when two ids happen to land on the same number.
 */
function numericId(playerId: string, used: Map<number, string>): number {
  let hash = 2166136261
  for (let i = 0; i < playerId.length; i++) {
    hash ^= playerId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  let id = 1_000_000 + ((hash >>> 0) % 900_000)
  while (used.has(id) && used.get(id) !== playerId) id = id >= 1_899_999 ? 1_000_000 : id + 1
  used.set(id, playerId)
  return id
}

/** Most games at an exact position. Generic OF and missing positions cannot imply CF or DH. */
function positionOf(appearances: Map<string, number[]>): { code: number; games: number } | null {
  const slots: [string, number][] = [
    ['G_c', 2],
    ['G_1b', 3],
    ['G_2b', 4],
    ['G_3b', 5],
    ['G_ss', 6],
    ['G_lf', 7],
    ['G_cf', 8],
    ['G_rf', 9],
    ['G_dh', 10],
  ]
  let best = 0
  let bestGames = 0
  let tied = false
  for (const [column, code] of slots) {
    const games = appearances.get(column)?.[0] ?? 0
    if (games > bestGames) {
      bestGames = games
      best = code
      tied = false
    } else if (games > 0 && games === bestGames) {
      tied = true
    }
  }
  return best && !tied ? { code: best, games: bestGames } : null
}

/** Missing counting stats are not zero. A partial stint invalidates that season's profile. */
function complete(row: Record<string, string>, fields: string[]): boolean {
  return fields.every((field) => /^\d+$/.test(str(row[field])))
}

/**
 * Read every file, or nothing. A missing or unreadable directory is a normal state (fresh clone
 * without the download), so it is reported and swallowed rather than thrown.
 */
export async function loadLahmanSeasons(
  dir: string,
  options: { fromYear?: number; log?: (message: string) => void } = {},
): Promise<LahmanPool> {
  const { fromYear = LAHMAN_FROM_YEAR, log = () => {} } = options
  const missing = LAHMAN_FILES.filter((file) => !existsSync(join(dir, file)))
  if (missing.length) {
    log(`lahman: not loaded (${missing.join(', ')} missing in ${dir}) — comps stay on the save's own history`)
    return EMPTY
  }

  let source = 'local files'
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { source?: string }
    if (manifest.source) source = manifest.source
  } catch {
    // A hand-placed copy without a manifest is still perfectly usable.
  }

  // ---------------------------------------------------------------- people

  const people = new Map<string, { name: string; birthYear: number; birthMonth: number; birthDay: number; bats: Handedness | null; throws: Handedness | null }>()
  for await (const row of readCsv(join(dir, 'People.csv'))) {
    const id = str(row.playerID)
    if (!id) continue
    people.set(id, { name: `${str(row.nameFirst)} ${str(row.nameLast)}`.trim(), birthYear: int(row.birthYear),
      birthMonth: int(row.birthMonth), birthDay: int(row.birthDay),
      bats: knownHand(str(row.bats), true), throws: knownHand(str(row.throws)) })
  }

  // ---------------------------------------------------------------- appearances (position)

  // player-season → column → games, so the busiest position wins the season.
  const appearances = new Map<string, Map<string, number[]>>()
  for await (const row of readCsv(join(dir, 'Appearances.csv'))) {
    const year = int(row.yearID)
    if (year < fromYear) continue
    const key = seasonKey(str(row.playerID), year)
    const byColumn = appearances.get(key) ?? new Map<string, number[]>()
    for (const column of ['G_c', 'G_1b', 'G_2b', 'G_3b', 'G_ss', 'G_lf', 'G_cf', 'G_rf', 'G_dh', 'G_of']) {
      const value = int(row[column])
      if (!value) continue
      const current = byColumn.get(column) ?? [0]
      current[0] += value
      byColumn.set(column, current)
    }
    appearances.set(key, byColumn)
  }

  // ---------------------------------------------------------------- batting

  const batting = new Map<string, BatAgg>()
  for await (const row of readCsv(join(dir, 'Batting.csv'))) {
    const year = int(row.yearID)
    if (year < fromYear) continue
    const key = seasonKey(str(row.playerID), year)
    const agg =
      batting.get(key) ??
      { complete: true, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, hbp: 0, sf: 0, sh: 0, sb: 0, g: 0 }
    agg.complete &&= complete(row, ['AB', 'H', '2B', '3B', 'HR', 'BB', 'SO', 'HBP', 'SF', 'SH', 'SB', 'G'])
    agg.ab += int(row.AB)
    agg.h += int(row.H)
    agg.d += int(row['2B'])
    agg.t += int(row['3B'])
    agg.hr += int(row.HR)
    agg.bb += int(row.BB)
    agg.k += int(row.SO)
    agg.hbp += int(row.HBP)
    agg.sf += int(row.SF)
    agg.sh += int(row.SH)
    agg.sb += int(row.SB)
    agg.g += int(row.G)
    batting.set(key, agg)
  }

  // ---------------------------------------------------------------- pitching

  const pitching = new Map<string, PitAgg>()
  for await (const row of readCsv(join(dir, 'Pitching.csv'))) {
    const year = int(row.yearID)
    if (year < fromYear) continue
    const key = seasonKey(str(row.playerID), year)
    const agg = pitching.get(key) ?? { complete: true, ip: 0, bf: 0, bb: 0, k: 0, hr: 0, gs: 0, g: 0 }
    agg.complete &&= complete(row, ['IPouts', 'BFP', 'BB', 'SO', 'HR', 'GS', 'G'])
    agg.ip += int(row.IPouts) / 3
    agg.bf += int(row.BFP)
    agg.bb += int(row.BB)
    agg.k += int(row.SO)
    agg.hr += int(row.HR)
    agg.gs += int(row.GS)
    agg.g += int(row.G)
    pitching.set(key, agg)
  }

  // ---------------------------------------------------------------- qualify and shape

  const usedIds = new Map<number, string>()
  const rows: HistoricalSeason[] = []
  let batters = 0
  let pitchers = 0

  // Sorted so the numeric handles assigned below never depend on file order.
  for (const key of [...new Set([...batting.keys(), ...pitching.keys()])].sort()) {
    const [playerId, yearText] = key.split('|')
    const year = int(yearText)
    // A season whose player is not in People.csv cannot be shown on the board.
    const person = people.get(playerId)
    if (!person?.name) continue

    const pit = pitching.get(key)
    const bat = batting.get(key)
    const role = pit ? pitchingGroup(pit.gs, pit.g) : null
    const qualifiesPitching =
      !!pit && pit.complete && pit.bf > 0 &&
      ((role === 'SP' && pit.ip >= MIN_STARTER_IP) || (role === 'RP' && pit.ip >= MIN_RELIEF_IP && pit.g >= MIN_RELIEF_G))
    const pa = bat ? bat.ab + bat.bb + bat.hbp + bat.sh + bat.sf : 0
    const position = positionOf(appearances.get(key) ?? new Map())
    const qualifiesBatting = !!bat && bat.complete && !!position &&
      bat.ab > 0 && pa >= MIN_BATTER_PA &&
      position.games >= MIN_POSITION_GAMES && position.games <= bat.g && position.games / bat.g >= MIN_POSITION_SHARE

    // A player-season is one candidate. A two-way year is filed where he played more games, so
    // an Ohtani season backs a DH rather than being counted twice under one key.
    const asPitcher = qualifiesPitching && (!qualifiesBatting || (pit?.g ?? 0) > (bat?.g ?? 0))
    if (!asPitcher && !qualifiesBatting) continue

    const season: HistoricalSeason = {
      playerId: numericId(playerId, usedIds),
      key,
      name: person.name,
      year,
      positionCode: asPitcher ? 1 : position!.code,
      pitcher: asPitcher,
      hasProfile: false,
      age: baseballAge(year, person.birthYear, person.birthMonth, person.birthDay),
      bats: person.bats,
      throws: person.throws,
      source: 'lahman',
    }

    if (asPitcher && pit) {
      // Outs are exact; do not synthesize batters faced or round away a third of an inning.
      season.pit = { ip: pit.ip, bf: pit.bf, bb: pit.bb, k: pit.k, hr: pit.hr, gs: pit.gs, g: pit.g }
      pitchers++
    } else if (bat) {
      season.bat = {
        ab: bat.ab,
        h: bat.h,
        d: bat.d,
        t: bat.t,
        hr: bat.hr,
        bb: bat.bb,
        k: bat.k,
        sb: bat.sb,
        pa,
        g: bat.g,
        positionGames: position!.games,
      }
      batters++
    }
    rows.push(season)
  }

  log(`lahman: ${rows.length} qualified player-seasons from ${fromYear} on (${batters} bat, ${pitchers} pit) — ${source}`)
  return { seasons: rows, source, batters, pitchers }
}
