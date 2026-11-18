import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * OOTP writes one play-by-play log per game as news/txt/leagues/log_<game_id>.txt.
 * The useful lines are the half-inning footers:
 *
 *   [%F]  Top of the 9th over - 0 runs, 0 hits, 0 errors, 0 left on base; Texas 1 - Philadelphia 9
 *
 * They carry the runs, hits, errors and running score for that half inning, so a
 * recap can be built without replaying 400 pitch lines.
 */

export interface HalfInning {
  inning: number
  half: 'top' | 'bottom'
  battingClub: string
  pitchingClub: string
  runs: number
  hits: number
  errors: number
  leftOnBase: number
  awayScore: number
  homeScore: number
}

export interface StoryInput {
  gameId: number
  date: string
  awayAbbr: string
  homeAbbr: string
  awayScore: number
  homeScore: number
}

export interface GameStory {
  gameId: number
  date: string
  headline: string
  deck: string
  body: string[]
}

const FOOTER = /^(Top|Bottom) of the (\d+)(?:st|nd|rd|th)? over - (\d+) runs?, (\d+) hits?, (\d+) errors?, (\d+) left on base; (.+?) (\d+) - (.+?) (\d+)$/

function ordinal(n: number): string {
  if (n === 1) return 'first'
  if (n === 2) return 'second'
  if (n === 3) return 'third'
  if (n === 4) return 'fourth'
  if (n === 5) return 'fifth'
  if (n === 6) return 'sixth'
  if (n === 7) return 'seventh'
  if (n === 8) return 'eighth'
  if (n === 9) return 'ninth'
  return `${n}th`
}

export function parseLog(file: string): HalfInning[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }

  const innings: HalfInning[] = []
  let battingClub = ''
  let pitchingClub = ''

  for (const line of text.split('\n')) {
    if (line.startsWith('[%T]')) {
      // [%T]  Top of the 1st - Texas Rangers batting - Pitching for Philadelphia Phillies : LHP ...
      const match = /^(Top|Bottom) of the .*? - (.+?) batting - Pitching for (.+?) :/.exec(line.replace('[%T]\t', ''))
      if (match) {
        battingClub = match[2].trim()
        pitchingClub = match[3].trim()
      }
      continue
    }
    if (!line.startsWith('[%F]')) continue
    const match = FOOTER.exec(line.replace('[%F]\t', '').trim())
    if (!match) continue
    innings.push({
      half: match[1] === 'Top' ? 'top' : 'bottom',
      inning: Number(match[2]),
      runs: Number(match[3]),
      hits: Number(match[4]),
      errors: Number(match[5]),
      leftOnBase: Number(match[6]),
      awayScore: Number(match[8]),
      homeScore: Number(match[10]),
      battingClub,
      pitchingClub,
    })
  }

  return innings
}

function runsByClub(innings: HalfInning[], club: string): number {
  return innings.filter((i) => i.battingClub === club).reduce((sum, i) => sum + i.runs, 0)
}

export function buildStory(input: StoryInput, innings: HalfInning[]): GameStory | null {
  if (!innings.length) return null

  const last = innings[innings.length - 1]
  const awayWon = last.awayScore > last.homeScore
  const winner = awayWon ? input.awayAbbr : input.homeAbbr
  const loser = awayWon ? input.homeAbbr : input.awayAbbr
  const margin = Math.abs(last.awayScore - last.homeScore)
  const tied = last.awayScore === last.homeScore

  const winnerClub = awayWon ? innings.find((i) => i.half === 'top')?.battingClub ?? winner : innings.find((i) => i.half === 'bottom')?.battingClub ?? winner
  const loserClub = awayWon ? innings.find((i) => i.half === 'bottom')?.battingClub ?? loser : innings.find((i) => i.half === 'top')?.battingClub ?? loser

  const winnerRuns = runsByClub(innings, winnerClub)
  const loserRuns = runsByClub(innings, loserClub)
  const winnerHits = innings.filter((i) => i.battingClub === winnerClub).reduce((s, i) => s + i.hits, 0)
  const winnerErrors = innings.filter((i) => i.battingClub === winnerClub).reduce((s, i) => s + i.errors, 0)
  const winnerLob = innings.filter((i) => i.battingClub === winnerClub).reduce((s, i) => s + i.leftOnBase, 0)

  // The turning point only means something if the club that won is the one that broke it open.
  const winnerInnings = innings.filter((i) => i.battingClub === winnerClub && i.runs > 0)
  const winnerBig = winnerInnings.reduce<HalfInning | null>((best, i) => (!best || i.runs > best.runs ? i : best), null)
  const body: string[] = []

  if (tied) {
    body.push(`The ${awayClub(innings)} and ${homeClub(innings)} finished level at ${last.awayScore}, a result that reads strangely on a line score and stranger on a box score.`)
  } else if (margin === 1) {
    body.push(`${winnerClub} won by a run, the kind of margin that turns every stranded runner into a decision.`)
  } else if (margin >= 6) {
    body.push(`${winnerClub} did not need a rally: ${winnerRuns} runs on ${winnerHits} hits, and the game was effectively decided before the late innings.`)
  } else {
    body.push(`${winnerClub} won by ${margin}, with ${winnerRuns} runs on ${winnerHits} hits.`)
  }

  if (!tied && winnerBig && winnerBig.runs >= 2) {
    body.push(
      `The separation came in the ${winnerBig.half === 'top' ? 'top' : 'bottom'} of the ${ordinal(winnerBig.inning)}, when ${winnerClub} scored ${winnerBig.runs} on ${winnerBig.hits} hit${winnerBig.hits === 1 ? '' : 's'}.`,
    )
  } else if (!tied) {
    body.push(`${winnerClub} never broke the game open — ${winnerInnings.length} scoring half-inning${winnerInnings.length === 1 ? '' : 's'} of one run apiece, which is how a one- or two-run game ends up looking comfortable on paper and nothing like it in the dugout.`)
  }

  const lateRuns = innings.filter((i) => i.inning >= 8).reduce((sum, i) => sum + i.runs, 0)
  if (lateRuns >= 2) {
    body.push(`${lateRuns} runs arrived in the eighth inning or later.`)
  }

  if (winnerErrors === 0 && winnerLob <= 6 && !tied) {
    body.push(`${winnerClub} played it clean: no errors, ${winnerLob} runners left on base.`)
  } else if (winnerErrors > 0) {
    body.push(`${winnerClub} committed ${winnerErrors} error${winnerErrors === 1 ? '' : 's'} and left ${winnerLob} on base, which kept the final score closer than the underlying line.`)
  }

  const headline = tied
    ? `${awayClub(innings)} and ${homeClub(innings)} trade blows in ${last.awayScore}-${last.homeScore} draw`
    : margin >= 6
      ? `${winnerClub} rout ${loserClub} ${Math.max(winnerRuns, loserRuns)}-${Math.min(winnerRuns, loserRuns)}`
      : margin === 1
        ? `${winnerClub} edge ${loserClub} ${Math.max(winnerRuns, loserRuns)}-${Math.min(winnerRuns, loserRuns)}`
        : `${winnerClub} take down ${loserClub} ${Math.max(winnerRuns, loserRuns)}-${Math.min(winnerRuns, loserRuns)}`

  const deck = !tied && winnerBig && winnerBig.runs >= 2
    ? `${winnerBig.runs} in the ${winnerBig.half === 'top' ? 'top' : 'bottom'} of the ${ordinal(winnerBig.inning)} broke it open.`
    : `${winnerRuns} runs on ${winnerHits} hits, ${winnerLob} left on base.`

  return { gameId: input.gameId, date: input.date, headline, deck, body }
}

function awayClub(innings: HalfInning[]): string {
  return innings.find((i) => i.half === 'top')?.battingClub ?? 'the visitors'
}

function homeClub(innings: HalfInning[]): string {
  return innings.find((i) => i.half === 'bottom')?.battingClub ?? 'the hosts'
}

export function storyPath(logDir: string, gameId: number): string {
  return join(logDir, `log_${gameId}.txt`)
}
