import { Link } from 'react-router-dom'
import type { Game, Team } from '../../lib/types'
import { useData } from '../../lib/data'
import { latestPlayedDate, shortDate, teamMap } from '../../lib/selectors'

export default function ScoreboardRail() {
  const games = useData<Game[]>('mlb/games.json')
  const teams = useData<Team[]>('teams.json')

  const teamsById = teams.data ? teamMap(teams.data) : new Map<number, Team>()
  const latest = games.data ? latestPlayedDate(games.data) : null
  const recent = latest && games.data ? games.data.filter((g) => g.date === latest).slice(0, 15) : []

  return (
    <div className="rail" role="region" aria-label="Scoreboard">
      <div className="container rail__inner">
        <span className="rail__tag">
          <span className="rail__dot" aria-hidden="true" />
          {latest ? `Scores · ${shortDate(latest)}` : 'Scores'}
        </span>

        {games.loading && <span className="rail__game rail__status">Loading…</span>}
        {games.error && <span className="rail__game rail__status">Scoreboard unavailable</span>}

        {recent.map((game) => {
          const away = teamsById.get(game.awayTeamId)
          const home = teamsById.get(game.homeTeamId)
          const awayWon = game.awayScore > game.homeScore
          return (
            <Link to={`/scores/${game.id}`} className="rail__game" key={game.id}>
              <div className="rail__teams">
                <div className="rail__team">
                  <span
                    className="rail__abbr"
                    style={{ color: away?.colors.primary ? undefined : undefined }}
                  >
                    {away?.abbr ?? '—'}
                  </span>
                  <span>{away?.nickname ?? 'Away'}</span>
                  <span className={`rail__score${awayWon ? '' : ' rail__score--muted'}`}>{game.awayScore}</span>
                </div>
                <div className="rail__team">
                  <span className="rail__abbr">{home?.abbr ?? '—'}</span>
                  <span>{home?.nickname ?? 'Home'}</span>
                  <span className={`rail__score${awayWon ? ' rail__score--muted' : ''}`}>{game.homeScore}</span>
                </div>
              </div>
              <span className="rail__status">
                {game.innings > 9 ? `F/${game.innings}` : 'Final'}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
