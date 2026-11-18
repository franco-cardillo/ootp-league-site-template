import { useCore } from '../lib/hooks'
import {
  divisionRows,
  divisionsFor,
  pct,
  streakLabel,
  subLeaguesIn,
  teamMap,
  wildCardRows,
} from '../lib/selectors'
import PageHeader from '../components/ui/PageHeader'
import TeamMark from '../components/ui/TeamMark'

function gamesBehind(leader: { w: number; l: number }, row: { w: number; l: number }): string {
  const value = (leader.w - row.w + (row.l - leader.l)) / 2
  if (value <= 0) return '—'
  return `+${value.toFixed(1)}`
}

export default function Standings() {
  const { core, loading, error } = useCore()
  if (loading) return <div className="container page state">Loading standings…</div>
  if (error || !core) return <div className="container page state state--error">Could not load standings: {error}</div>

  const { meta, teams, standings, divisions, subLeagues } = core
  const teamsById = teamMap(teams)
  const mlbSubLeagues = subLeaguesIn(subLeagues, meta.mlbLeagueId)

  return (
    <div className="container page">
      <PageHeader
        eyebrow={`${meta.season} season · through ${meta.simDate}`}
        title="Standings"
        deck="Division races first, then the wild card. Division leaders are marked; the top two wild cards would host a playoff spot if the season ended today."
      />

      {mlbSubLeagues.map((sub) => {
        const leagueDivisions = divisionsFor(divisions, meta.mlbLeagueId, sub.id)
        const wild = wildCardRows(standings, sub.id, leagueDivisions.length)
        return (
          <section key={sub.id} style={{ marginBottom: 'var(--sp-7)' }}>
            <div className="league-band">
              <span className={`badge badge--${sub.abbr.toLowerCase()}`}>{sub.abbr}</span>
              <h2>{sub.name}</h2>
            </div>

            <div className="grid-3">
              {leagueDivisions.map((division) => {
                const rows = divisionRows(standings, sub.id, division.id)
                return (
                  <div className="card" key={division.id}>
                    <div className="division-card__head">
                      <span className="division-card__name">{division.name}</span>
                    </div>
                    <table className="stat-table">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>W</th>
                          <th>L</th>
                          <th>PCT</th>
                          <th>GB</th>
                          <th>STRK</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={row.teamId} className={i === 0 ? 'standings-row standings-row--leader' : 'standings-row'}>
                            <td>
                              <TeamMark team={teamsById.get(row.teamId)} size="sm" />
                            </td>
                            <td>{row.w}</td>
                            <td>{row.l}</td>
                            <td>{pct(row.pct)}</td>
                            <td>{i === 0 ? '—' : row.gb.toFixed(1)}</td>
                            <td>{streakLabel(row.streak)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>

            <div className="card" style={{ marginTop: 'var(--sp-5)' }}>
              <div className="section-head">
                <h2>Wild card</h2>
                <span className="eyebrow">Non-division leaders</span>
              </div>
              <div className="table-scroll">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>W</th>
                      <th>L</th>
                      <th>PCT</th>
                      <th>GB</th>
                      <th>STRK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wild.slice(0, 6).map((row, i) => (
                      <tr key={row.teamId} className={i < 2 ? 'standings-row standings-row--leader' : 'standings-row'}>
                        <td>
                          <TeamMark team={teamsById.get(row.teamId)} size="sm" />
                        </td>
                        <td>{row.w}</td>
                        <td>{row.l}</td>
                        <td>{pct(row.pct)}</td>
                        <td>{i === 0 ? '—' : gamesBehind(wild[0], row)}</td>
                        <td>{streakLabel(row.streak)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
