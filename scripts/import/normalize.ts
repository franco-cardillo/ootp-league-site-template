import type {
  BattingSeason,
  Division,
  Game,
  League,
  PitchingSeason,
  PlayerBio,
  Ratings,
  StandingRow,
  SubLeague,
  Team,
  TeamStats,
} from '../../src/lib/types'
import { handedness, positionName } from './schema'
import { bool, exactPitchingOuts, int, ipToOuts, isoDate, num, round, str, type Row } from './csv'

export function toLeague(r: Row): League {
  return {
    id: int(r.league_id),
    name: str(r.name),
    abbr: str(r.abbr),
    level: int(r.league_level),
    parentLeagueId: int(r.parent_league_id),
    seasonYear: Number(str(r.current_date).slice(0, 4)) || 0,
    currentDate: isoDate(str(r.current_date)),
  }
}

export function toSubLeague(r: Row): SubLeague {
  return {
    leagueId: int(r.league_id),
    id: int(r.sub_league_id),
    name: str(r.name),
    abbr: str(r.abbr),
  }
}

export function toDivision(r: Row): Division {
  return {
    leagueId: int(r.league_id),
    subLeagueId: int(r.sub_league_id),
    id: int(r.division_id),
    name: str(r.name),
  }
}

export function toTeam(r: Row): Team {
  return {
    id: int(r.team_id),
    city: str(r.name),
    nickname: str(r.nickname),
    abbr: str(r.abbr),
    leagueId: int(r.league_id),
    subLeagueId: int(r.sub_league_id),
    divisionId: int(r.division_id),
    level: int(r.level),
    parentTeamId: int(r.parent_team_id),
    colors: {
      primary: str(r.background_color_id) || '#0c2340',
      secondary: str(r.text_color_id) || '#ffffff',
    },
  }
}

export function toPlayerBio(r: Row): PlayerBio {
  return {
    id: int(r.player_id),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    nickName: str(r.nick_name),
    age: int(r.age),
    dateOfBirth: str(r.date_of_birth),
    nationId: int(r.nation_id),
    cityOfBirthId: int(r.city_of_birth_id),
    height: int(r.height),
    weight: int(r.weight),
    bats: handedness(str(r.bats), true),
    throws: handedness(str(r.throws)),
    position: positionName(int(r.position)),
    positionCode: int(r.position),
    role: int(r.role),
    uniformNumber: int(r.uniform_number),
    teamId: int(r.team_id),
    leagueId: int(r.league_id),
    experience: int(r.experience),
    retired: bool(r.retired),
    hallOfFame: bool(r.hall_of_fame) || int(r.inducted) > 0,
    draftYear: int(r.draft_year),
    draftRound: int(r.draft_round),
    draftOverallPick: int(r.draft_overall_pick),
    overallRating: int(r.overall_rating ?? '0'),
    potentialRating: int(r.potential_rating ?? '0'),
  }
}

/** Batting ratings live in players_batting.csv, pitching ratings in players_pitching.csv. */
/**
 * OOTP exports the individual tools but not the headline overall/potential. These are the same
 * documented weights the prospect board uses, so a player's overall means the same thing on his
 * page as it does on the board.
 */
function weightedOverall(tools: { contact: number; power: number; eye: number; gap: number }, pitcher: { stuff: number; movement: number; control: number }): number {
  const batter = tools.contact * 0.32 + tools.power * 0.3 + tools.eye * 0.22 + tools.gap * 0.16
  const arm = pitcher.stuff * 0.45 + pitcher.movement * 0.3 + pitcher.control * 0.25
  const hasPitching = pitcher.stuff > 0 || pitcher.movement > 0 || pitcher.control > 0
  if (hasPitching && batter < 20) return Math.round(arm)
  if (batter >= 20 && !hasPitching) return Math.round(batter)
  return Math.round(Math.max(batter, arm))
}

export function toRatings(battingRow?: Row, pitchingRow?: Row): Ratings {
  const contactP = int(battingRow?.batting_ratings_talent_contact)
  const gapP = int(battingRow?.batting_ratings_talent_gap)
  const powerP = int(battingRow?.batting_ratings_talent_power)
  const eyeP = int(battingRow?.batting_ratings_talent_eye)
  const stuffP = int(pitchingRow?.pitching_ratings_talent_stuff)
  const movementP = int(pitchingRow?.pitching_ratings_talent_movement)
  const controlP = int(pitchingRow?.pitching_ratings_talent_control)

  const current = weightedOverall(
    {
      contact: int(battingRow?.batting_ratings_overall_contact),
      power: int(battingRow?.batting_ratings_overall_power),
      eye: int(battingRow?.batting_ratings_overall_eye),
      gap: int(battingRow?.batting_ratings_overall_gap),
    },
    {
      stuff: int(pitchingRow?.pitching_ratings_overall_stuff),
      movement: int(pitchingRow?.pitching_ratings_overall_movement),
      control: int(pitchingRow?.pitching_ratings_overall_control),
    },
  )
  const potential = weightedOverall(
    { contact: contactP, power: powerP, eye: eyeP, gap: gapP },
    { stuff: stuffP, movement: movementP, control: controlP },
  )

  return {
    contact: int(battingRow?.batting_ratings_overall_contact),
    gap: int(battingRow?.batting_ratings_overall_gap),
    power: int(battingRow?.batting_ratings_overall_power),
    eye: int(battingRow?.batting_ratings_overall_eye),
    strikeouts: int(battingRow?.batting_ratings_overall_strikeouts),
    babip: int(battingRow?.batting_ratings_overall_babip),
    speed: int(battingRow?.running_ratings_speed),
    stealing: int(battingRow?.running_ratings_stealing),
    baserunning: int(battingRow?.running_ratings_baserunning),
    stuff: int(pitchingRow?.pitching_ratings_overall_stuff),
    movement: int(pitchingRow?.pitching_ratings_overall_movement),
    control: int(pitchingRow?.pitching_ratings_overall_control),
    stamina: int(pitchingRow?.pitching_ratings_misc_stamina),
    velocity: int(pitchingRow?.pitching_ratings_misc_velocity),
    groundFly: int(pitchingRow?.pitching_ratings_misc_ground_fly),
    contactP,
    gapP,
    powerP,
    eyeP,
    stuffP,
    movementP,
    controlP,
    overall: current,
    potential,
  }
}

export function toBattingSeason(r: Row): BattingSeason {
  const ab = int(r.ab)
  const h = int(r.h)
  const d = int(r.d)
  const t = int(r.t)
  const hr = int(r.hr)
  const bb = int(r.bb)
  const hp = int(r.hp)
  const sf = int(r.sf)
  const pa = int(r.pa) || ab + bb + hp + sf
  const tb = h + d + 2 * t + 3 * hr
  const avg = ab ? h / ab : 0
  const obp = ab + bb + hp + sf ? (h + bb + hp) / (ab + bb + hp + sf) : 0
  const slg = ab ? tb / ab : 0
  return {
    year: int(r.year),
    teamId: int(r.team_id),
    leagueId: int(r.league_id),
    levelId: int(r.level_id),
    stint: int(r.stint),
    g: int(r.g),
    ab,
    r: int(r.r),
    h,
    d,
    t,
    hr,
    rbi: int(r.rbi),
    bb,
    ibb: int(r.ibb),
    k: int(r.k),
    sb: int(r.sb),
    cs: int(r.cs),
    hp,
    sh: int(r.sh),
    sf,
    gdp: int(r.gdp),
    pa,
    avg: round(avg, 3),
    obp: round(obp, 3),
    slg: round(slg, 3),
    ops: round(obp + slg, 3),
    war: round(num(r.war), 1),
  }
}

export function toPitchingSeason(r: Row): PitchingSeason {
  const exactOuts = exactPitchingOuts(r)
  const ip = exactOuts === undefined ? ipToOuts(num(r.ip)) / 3 : exactOuts / 3
  const ipMissing = exactOuts === undefined && (!str(r.ip) || str(r.ip) === 'NULL' || !Number.isFinite(Number(r.ip)) || Number(r.ip) < 0)
  const er = int(r.er)
  const ha = int(r.ha)
  const bb = int(r.bb)
  const k = int(r.k)
  return {
    year: int(r.year),
    teamId: int(r.team_id),
    leagueId: int(r.league_id),
    levelId: int(r.level_id),
    stint: int(r.stint),
    g: int(r.g),
    gs: int(r.gs),
    w: int(r.w),
    l: int(r.l),
    sv: int(r.s),
    ip: exactOuts === undefined ? round(ip, 2) : ip,
    ...(exactOuts !== undefined ? { outs: exactOuts } : {}),
    ...(ipMissing ? { ipMissing: true } : {}),
    h: ha,
    r: int(r.r),
    er,
    bb,
    k,
    hr: int(r.hra),
    bf: int(r.bf),
    era: ip ? round((er * 9) / ip, 2) : 0,
    whip: ip ? round((ha + bb) / ip, 2) : 0,
    k9: ip ? round((k * 9) / ip, 1) : 0,
    war: round(num(r.war), 1),
  }
}

export function toGame(r: Row): Game {
  return {
    id: int(r.game_id),
    date: isoDate(str(r.date)),
    homeTeamId: int(r.home_team),
    awayTeamId: int(r.away_team),
    homeScore: int(r.runs1),
    awayScore: int(r.runs0),
    homeHits: int(r.hits1),
    awayHits: int(r.hits0),
    homeErrors: int(r.errors1),
    awayErrors: int(r.errors0),
    innings: int(r.innings),
    played: bool(r.played),
    gameType: int(r.game_type),
    attendance: int(r.attendance),
    winningPitcher: int(r.winning_pitcher),
    losingPitcher: int(r.losing_pitcher),
    savePitcher: int(r.save_pitcher),
  }
}

export function toStanding(r: Row, teams: Map<number, Team>): StandingRow | null {
  const teamId = int(r.team_id)
  const team = teams.get(teamId)
  if (!team) return null
  return {
    teamId,
    leagueId: team.leagueId,
    subLeagueId: team.subLeagueId,
    divisionId: team.divisionId,
    g: int(r.g),
    w: int(r.w),
    l: int(r.l),
    t: int(r.t),
    pct: round(num(r.pct), 3),
    gb: round(num(r.gb), 1),
    position: int(r.pos),
    streak: int(r.streak),
    magicNumber: int(r.magic_number),
  }
}

export function toTeamStats(battingRow: Row, pitchingRow: Row): TeamStats {
  const exactOuts = exactPitchingOuts(pitchingRow)
  const ip = exactOuts === undefined ? ipToOuts(num(pitchingRow.ip)) / 3 : exactOuts / 3
  const ipMissing = exactOuts === undefined && (!str(pitchingRow.ip) || str(pitchingRow.ip) === 'NULL' || !Number.isFinite(Number(pitchingRow.ip)) || Number(pitchingRow.ip) < 0)
  return {
    teamId: int(battingRow.team_id),
    batting: {
      pa: int(battingRow.pa),
      ab: int(battingRow.ab),
      h: int(battingRow.h),
      d: int(battingRow.d),
      t: int(battingRow.t),
      hr: int(battingRow.hr),
      r: int(battingRow.r),
      rbi: int(battingRow.rbi),
      bb: int(battingRow.bb),
      k: int(battingRow.k),
      sb: int(battingRow.sb),
      avg: round(num(battingRow.avg), 3),
      obp: round(num(battingRow.obp), 3),
      slg: round(num(battingRow.slg), 3),
      ops: round(num(battingRow.ops), 3),
    },
    pitching: {
      ip: exactOuts === undefined ? round(ip, 1) : ip,
      ...(exactOuts !== undefined ? { outs: exactOuts } : {}),
      ...(ipMissing ? { ipMissing: true } : {}),
      h: int(pitchingRow.ha),
      r: int(pitchingRow.r),
      er: int(pitchingRow.er),
      bb: int(pitchingRow.bb),
      k: int(pitchingRow.k),
      hr: int(pitchingRow.hra),
      era: exactOuts === undefined ? round(num(pitchingRow.era), 2) : ip ? round(int(pitchingRow.er) * 9 / ip, 2) : 0,
      whip: exactOuts === undefined ? round(num(pitchingRow.whip), 2) : ip ? round((int(pitchingRow.ha) + int(pitchingRow.bb)) / ip, 2) : 0,
    },
  }
}
