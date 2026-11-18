import { Link } from 'react-router-dom'
import { useCore } from '../lib/hooks'
import { divisionRows, divisionsFor, pct, record, subLeaguesIn, teamMap } from '../lib/selectors'
import PageHeader from '../components/ui/PageHeader'
import TeamMark from '../components/ui/TeamMark'

export default function Teams() {
  const { core, loading, error } = useCore()
  if (loading) return <div className="container page state">Loading clubs…</div>
  if (error || !core) return <div className="container page state state--error">Could not load clubs: {error}</div>

  const { meta, teams, standings, divisions, subLeagues } = core
  const teamsById = teamMap(teams)
  const mlbSubLeagues = subLeaguesIn(subLeagues, meta.mlbLeagueId)

  return (
    <div className="container page">
      <PageHeader
        eyebrow={`${meta.counts.teams} clubs preserved · ${meta.counts.leagues} leagues`}
        title="Teams"
        deck={`The ${meta.counts.mlbTeams} Major League clubs are profiled in full. Minor-league and NCAA clubs are imported and held for the next build.`}
      />

      {mlbSubLeagues.map((sub) => (
        <section key={sub.id} style={{ marginBottom: 'var(--sp-6)' }}>
          <div className="league-band">
            <span className={`badge badge--${sub.abbr.toLowerCase()}`}>{sub.abbr}</span>
            <h2>{sub.name}</h2>
          </div>
          {divisionsFor(divisions, meta.mlbLeagueId, sub.id).map((division) => {
            const rows = divisionRows(standings, sub.id, division.id)
            return (
              <div key={division.id} style={{ marginBottom: 'var(--sp-4)' }}>
                <p className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
                  {division.name}
                </p>
                <div className="grid-3">
                  {rows.map((row) => {
                    const team = teamsById.get(row.teamId)
                    if (!team) return null
                    return (
                      <Link to={`/teams/${team.id}`} className="team-card" key={team.id}>
                        <TeamMark team={team} size="md" showName={false} link={false} />
                        <div className="team-card__body">
                          <div className="team-card__name">{team.city}</div>
                          <div className="team-card__meta">{team.nickname}</div>
                        </div>
                        <div className="team-card__record">
                          {record(row.w, row.l)}
                          <div className="team-card__meta">{pct(row.pct)}</div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
