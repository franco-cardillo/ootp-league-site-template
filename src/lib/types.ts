/** Domain types shared by the import pipeline and the site. */

export interface League {
  id: number
  name: string
  abbr: string
  level: number
  parentLeagueId: number
  seasonYear: number
  currentDate: string
}

export interface SubLeague {
  leagueId: number
  id: number
  name: string
  abbr: string
}

export interface Division {
  leagueId: number
  subLeagueId: number
  id: number
  name: string
}

export interface Team {
  id: number
  city: string
  nickname: string
  abbr: string
  leagueId: number
  subLeagueId: number
  divisionId: number
  level: number
  parentTeamId: number
  colors: {
    primary: string
    secondary: string
  }
}

export interface PlayerBio {
  id: number
  firstName: string
  lastName: string
  nickName: string
  age: number
  dateOfBirth: string
  nationId: number
  cityOfBirthId: number
  /** OOTP CSV height in centimeters; zero indicates unavailable. */
  height: number
  /** Weight in pounds. */
  weight: number
  bats: string
  throws: string
  position: string
  positionCode: number
  role: number
  uniformNumber: number
  teamId: number
  leagueId: number
  experience: number
  retired: boolean
  hallOfFame: boolean
  draftYear: number
  draftRound: number
  draftOverallPick: number
  overallRating: number
  potentialRating: number
}

export interface Ratings {
  contact: number
  gap: number
  power: number
  eye: number
  strikeouts: number
  babip: number
  speed: number
  stealing: number
  baserunning: number
  stuff: number
  movement: number
  control: number
  stamina: number
  velocity: number
  groundFly: number
  // Potential on the same 20–80 scale, plus the weighted overalls OOTP does not export.
  contactP: number
  gapP: number
  powerP: number
  eyeP: number
  stuffP: number
  movementP: number
  controlP: number
  overall: number
  potential: number
}

export interface BattingSeason {
  year: number
  teamId: number
  leagueId: number
  levelId: number
  stint: number
  g: number
  ab: number
  r: number
  h: number
  d: number
  t: number
  hr: number
  rbi: number
  bb: number
  ibb: number
  k: number
  sb: number
  cs: number
  hp: number
  sh: number
  sf: number
  gdp: number
  pa: number
  avg: number
  obp: number
  slg: number
  ops: number
  war: number
}

export interface PitchingSeason {
  year: number
  teamId: number
  leagueId: number
  levelId: number
  stint: number
  g: number
  gs: number
  w: number
  l: number
  sv: number
  ip: number
  /** Exact recorded outs; absent on older or ambiguous rows. */
  outs?: number
  /** The source did not contain usable innings, even as a legacy estimate. */
  ipMissing?: boolean
  h: number
  r: number
  er: number
  bb: number
  k: number
  hr: number
  bf: number
  era: number
  whip: number
  k9: number
  war: number
}

export interface PlayerAward {
  year: number
  label: string
}

export interface FieldingLine {
  position: string
  g: number
  po: number
  a: number
  e: number
  dp: number
  fpct: number
  range: number
}

export interface PlayerDetail extends PlayerBio {
  awards: PlayerAward[]
  fielding: FieldingLine[]
  ratings: Ratings
  batting: BattingSeason[]
  pitching: PitchingSeason[]
  careerBatting: BattingSeason | null
  careerPitching: PitchingSeason | null
}

export interface Game {
  id: number
  date: string
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  homeHits: number
  awayHits: number
  homeErrors: number
  awayErrors: number
  innings: number
  played: boolean
  gameType: number
  attendance: number
  winningPitcher: number
  losingPitcher: number
  savePitcher: number
}

export interface StandingRow {
  teamId: number
  leagueId: number
  subLeagueId: number
  divisionId: number
  g: number
  w: number
  l: number
  t: number
  pct: number
  gb: number
  position: number
  streak: number
  magicNumber: number
}

export interface TeamStats {
  teamId: number
  batting: {
    pa: number
    ab: number
    h: number
    d: number
    t: number
    hr: number
    r: number
    rbi: number
    bb: number
    k: number
    sb: number
    avg: number
    obp: number
    slg: number
    ops: number
  }
  pitching: {
    ip: number
    outs?: number
    ipMissing?: boolean
    h: number
    r: number
    er: number
    bb: number
    k: number
    hr: number
    era: number
    whip: number
  }
}

export interface LeaderEntry {
  rank: number
  playerId: number
  name: string
  value: number
  teamId: number
}

export interface Leaders {
  batting: Record<string, LeaderEntry[]>
  pitching: Record<string, LeaderEntry[]>
}

export interface ImportMeta {
  generatedAt: string
  season: number
  mlbLeagueId: number
  simDate: string
  /** True only for a wholly synthetic, fictional demo bundle. */
  demo?: boolean
  counts: Record<string, number>
  sourceFiles: { name: string; rows: number; bytes: number }[]
  checksums: Record<string, string>
}

export interface NewsItem {
  id: string
  rank: number
  kind: 'blowout' | 'performance' | 'power' | 'shutout' | 'streak' | 'race'
  date: string
  headline: string
  deck: string
  playerId?: number
  teamId?: number
  opponentTeamId?: number
  teamIds: number[]
  link: string
}

/**
 * One comparable for a prospect: a current major leaguer or a historical MLB season.
 * `similarity` is a heuristic 0–100 profile-shape index over available shared dimensions,
 * not a probability or forecast. Historical hitter scores do not measure defense.
 * `year` is only set on historical comps.
 */
export interface ProspectComp {
  playerId: number
  playerName: string
  similarity: number
  kind: 'current' | 'historical'
  year?: number
  reason: string
  hasProfile: boolean
}

/**
 * A prospect's comps, one per pool and each claimed by a single prospect across the whole board:
 * a current major leaguer or a historical player-season can only ever back one farmhand. `null`
 * means no eligible, sufficiently similar, unclaimed candidate was available (including when
 * source position, role, handedness, age, playing time, or profile information is insufficient).
 */
export interface ProspectComps {
  /** Version 2 uses independent pools and stricter position, role and usage rules. */
  modelVersion?: 2
  current: ProspectComp | null
  historical: ProspectComp | null
}

export interface Prospect {
  /** Placement on this published board; may differ from the official rank if entries are missing. */
  rank: number
  /** Official BNN rank from the separately dated static report snapshot, if matched. */
  bnnRank?: number | null
  /** Position/role in the BNN report (not necessarily the player's current position). */
  bnnPosition?: string | null
  id: number
  name: string
  age: number
  position: string
  role: string
  bats: string
  throws: string
  nation: string
  teamId: number
  teamAbbr: string
  leagueAbbr: string
  level: number
  orgId: number
  orgAbbr: string
  orgName: string
  current: number
  potential: number
  score: number
  tools: Record<string, number>
  potentialTools: Record<string, number>
  /** The one current major leaguer and the one historical season he is compared to. */
  comps: ProspectComps
  stats: {
    league: string
    g: number
    gs?: number
    avg?: number
    hr?: number
    rbi?: number
    w?: number
    l?: number
    era?: number
    ip?: number
    k?: number
  } | null
}

export interface MessageItem {
  id: number
  date: string
  subject: string
  importance: number
  type: number
  playerId?: number
  playerName?: string
  teamId?: number
  mlb?: boolean
}

export interface HistorySeason {
  year: number
  championTeamId: number
  w: number
  l: number
  pct: number
  titlesToDate: number
}

export interface HistoryAward {
  playerId: number
  name: string
  hasProfile: boolean
}

export interface History {
  seasons: HistorySeason[]
  franchises: { teamId: number; titles: number; lastYear: number }[]
  awards: {
    year: number
    hitter?: HistoryAward
    pitcher?: HistoryAward
    rookie?: HistoryAward
  }[]
}

export interface BoxBat {
  playerId: number
  name: string
  pos: string
  ab: number
  r: number
  h: number
  rbi: number
  bb: number
  k: number
  hr: number
  d: number
  t: number
}

export interface BoxPit {
  playerId: number
  name: string
  ip: number
  h: number
  r: number
  er: number
  bb: number
  k: number
  gs: number
}

export interface BoxTeam {
  teamId: number
  abbr: string
  city: string
  nickname: string
  runs: number
  hits: number
  errors: number
  batting: BoxBat[]
  pitching: BoxPit[]
}

export interface BoxScore {
  gameId: number
  date: string
  innings: number
  attendance: number
  away: BoxTeam
  home: BoxTeam
}

export interface FranchiseLeader {
  playerId: number
  name: string
  value: string
  note: string
  hasProfile: boolean
}

export interface FranchiseLeaders {
  teamId: number
  batting: { key: string; label: string; leaders: FranchiseLeader[] }[]
  pitching: { key: string; label: string; leaders: FranchiseLeader[] }[]
}


export interface GameStory {
  gameId: number
  date: string
  headline: string
  deck: string
  body: string[]
}


export interface StatInsights {
  generatedAt: string
  season: number
  model: string
  headline: string
  insights: { title: string; body: string }[]
}
