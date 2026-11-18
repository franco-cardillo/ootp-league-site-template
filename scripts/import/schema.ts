/** Constants and code mappings for the OOTP 27 export format. Verified against the real export. */

export const MLB_LEAGUE_ID = 203

/** Parse the import setting without reading process.env at module load. The caller chooses
 * --league-id first, then OOTP_LEAGUE_ID; when neither is set the historical default is 203. */
export function parseLeagueId(value: string | undefined): number {
  if (value === undefined) return MLB_LEAGUE_ID
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error('OOTP_LEAGUE_ID / --league-id must be a positive safe integer')
  }
  return Number(value)
}

export const FILES = {
  leagues: 'leagues.csv',
  subLeagues: 'sub_leagues.csv',
  divisions: 'divisions.csv',
  teams: 'teams.csv',
  teamRecord: 'team_record.csv',
  teamBatting: 'team_batting_stats.csv',
  teamPitching: 'team_pitching_stats.csv',
  players: 'players.csv',
  playerBattingRatings: 'players_batting.csv',
  playerPitchingRatings: 'players_pitching.csv',
  careerBatting: 'players_career_batting_stats.csv',
  careerPitching: 'players_career_pitching_stats.csv',
  rosterStatus: 'players_roster_status.csv',
  games: 'games.csv',
  gameBatting: 'players_game_batting.csv',
  gamePitching: 'players_game_pitching_stats.csv',
  careerFielding: 'players_career_fielding_stats.csv',
  playerFieldingRatings: 'players_fielding.csv',
  messages: 'messages.csv',
  teamHistory: 'team_history.csv',
  teamHistoryRecord: 'team_history_record.csv',
  leagueHistory: 'league_history.csv',
  cities: 'cities.csv',
  nations: 'nations.csv',
} as const

/** OOTP position codes. */
export const POSITION_NAMES: Record<number, string> = {
  1: 'P',
  2: 'C',
  3: '1B',
  4: '2B',
  5: '3B',
  6: 'SS',
  7: 'LF',
  8: 'CF',
  9: 'RF',
  10: 'DH',
  11: 'PH',
  12: 'PR',
}

export const positionName = (code: number): string => POSITION_NAMES[code] ?? 'UTIL'

/** OOTP handedness codes: 1 = right, 2 = left, 3 = switch. */
export const handedness = (code: string, allowSwitch = false): string => {
  switch (code) {
    case '1':
      return 'R'
    case '2':
      return 'L'
    case '3':
      return allowSwitch ? 'S' : 'R'
    default:
      return 'R'
  }
}

/** Game types in games.csv: 0 regular season, 2 spring, 4/8 postseason. */
export const GAME_TYPE = {
  regular: 0,
  spring: 2,
  postseason: [4, 8] as number[],
}

/** Leaderboard definitions: label, stat key, and sort direction. */
export const BATTING_LEADERS = [
  { key: 'avg', label: 'Batting Average', short: 'AVG', min: 'pa' },
  { key: 'hr', label: 'Home Runs', short: 'HR', min: null },
  { key: 'rbi', label: 'Runs Batted In', short: 'RBI', min: null },
  { key: 'h', label: 'Hits', short: 'H', min: null },
  { key: 'r', label: 'Runs', short: 'R', min: null },
  { key: 'sb', label: 'Stolen Bases', short: 'SB', min: null },
  { key: 'ops', label: 'On-Base Plus Slugging', short: 'OPS', min: 'pa' },
  { key: 'war', label: 'Wins Above Replacement', short: 'WAR', min: null },
] as const

export const PITCHING_LEADERS = [
  { key: 'w', label: 'Wins', short: 'W', min: null },
  { key: 'era', label: 'Earned Run Average', short: 'ERA', min: 'ip', ascending: true },
  { key: 'k', label: 'Strikeouts', short: 'K', min: null },
  { key: 'sv', label: 'Saves', short: 'SV', min: null },
  { key: 'whip', label: 'Walks and Hits per Inning', short: 'WHIP', min: 'ip', ascending: true },
  { key: 'ip', label: 'Innings Pitched', short: 'IP', min: null },
  { key: 'war', label: 'Wins Above Replacement', short: 'WAR', min: null },
] as const
