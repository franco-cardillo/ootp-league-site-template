import { useMemo, useState } from 'react'
import type { Game } from '../lib/types'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { gamesOnDate, latestPlayedDate, longDate, playedDates, teamMap } from '../lib/selectors'
import PageHeader from '../components/ui/PageHeader'
import TeamMark from '../components/ui/TeamMark'

export default function Scores() {
  const { core, loading } = useCore()
  const games = useData<Game[]>('mlb/games.json')
  const [date, setDate] = useState<string | null>(null)

  const dates = useMemo(() => (games.data ? playedDates(games.data) : []), [games.data])
  const activeDate = date ?? (games.data ? latestPlayedDate(games.data) : null)
  const index = activeDate ? dates.indexOf(activeDate) : -1

  if (loading || games.loading) return <div className="container page state">Loading scores…</div>
  if (!core || !games.data) return <div className="container page state state--error">Scores unavailable{uniform(games.error)}</div>

  const teamsById = teamMap(core.teams)
  const gamesToday = activeDate ? gamesOnDate(games.data, activeDate) : []
  const step = (delta: number) => {
    const next = index + delta
    if (next >= 0 && next < dates.length) setDate(dates[next])
  }

  return (
    <div className="container page">
      <PageHeader eyebrow={`${core.meta.season} season`} title="Scores" deck="Every completed game date in the export, newest first.">
        <div className="date-nav">
          <button className="date-nav__button" onClick={() => step(-1)} disabled={index <= 0}>
            ← Earlier
          </button>
          <span className="date-nav__label">{activeDate ? longDate(activeDate) : 'No games'}</span>
          <button className="date-nav__button" onClick={() => step(1)} disabled={index < 0 || index >= dates.length - 1}>
            Later →
          </button>
        </div>
      </PageHeader>

      <div className="grid-2">
        {gamesToday.map((game) => {
          const away = teamsById.get(game.awayTeamId)
          const home = teamsById.get(game.homeTeamId)
          const awayWon = game.awayScore > game.homeScore
          return (
            <Link to={`/scores/${game.id}`} className="card card--link" key={game.id}>
              <div className="score-line">
                <div>
                  <div className={`score-line__team ${awayWon ? 'score-line__team--winner' : 'score-line__team--loser'}`}>
                    <TeamMark team={away} size="sm" showCity />
                  </div>
                  <div className={`score-line__team ${!awayWon ? 'score-line__team--winner' : 'score-line__team--loser'}`}>
                    <TeamMark team={home} size="sm" showCity />
                  </div>
                </div>
                <div>
                  <div className="score-line__score">{game.awayScore}</div>
                  <div className="score-line__score">{game.homeScore}</div>
                </div>
                <div className="score-line__meta">
                  {game.innings > 9 ? `Final / ${game.innings}` : 'Final'} · {game.awayHits}H–{game.awayErrors}E /{' '}
                  {game.homeHits}H–{game.homeErrors}E · {game.attendance.toLocaleString()} in attendance
                </div>
              </div>
              <div className="card__cta">Box score →</div>
            </Link>
          )
        })}
      </div>

      {gamesToday.length === 0 && <div className="state">No games scheduled on this date.</div>}
    </div>
  )
}

function uniform(error: string | null): string {
  return error ? ` (${error})` : ''
}
