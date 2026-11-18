import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { History } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { teamMap } from '../lib/selectors'
import PageHeader from '../components/ui/PageHeader'
import TeamMark from '../components/ui/TeamMark'

const pct = (value: number) => (value ? value.toFixed(3).replace(/^0/, '') : '—')

export default function History() {
  const history = useData<History>('history.json')
  const { core } = useCore()
  const [limit, setLimit] = useState(40)

  if (history.loading) return <div className="container page state">Loading league history…</div>
  if (history.error || !history.data)
    return <div className="container page state state--error">History unavailable ({history.error})</div>

  const { seasons, franchises, awards } = history.data
  const teamsById = core ? teamMap(core.teams) : new Map()
  const latestYear = seasons[0]?.year
  const recentAwards = awards.slice(0, 6)

  return (
    <div className="container page">
      <PageHeader
        eyebrow={`${seasons[seasons.length - 1]?.year ?? ''}–${latestYear ?? ''} · ${seasons.length} championship seasons`}
        title="History"
        deck="Every champion OOTP recorded in this save, with the regular-season record that carried them, plus the annual best hitter, pitcher and rookie. Titles are counted per franchise, so a club that moved keeps its history."
      />

      <div className="home-row">
        <section className="card">
          <div className="section-head">
            <h2>Champions</h2>
            <span className="eyebrow">Most recent first</span>
          </div>
          <table className="stat-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Champion</th>
                <th className="is-num">W</th>
                <th className="is-num">L</th>
                <th className="is-num">PCT</th>
                <th className="is-num">Title</th>
              </tr>
            </thead>
            <tbody>
              {seasons.slice(0, limit).map((season) => {
                const team = teamsById.get(season.championTeamId)
                return (
                  <tr key={season.year}>
                    <td>{season.year}</td>
                    <td>
                      <TeamMark team={team} size="sm" showCity />
                    </td>
                    <td className="is-num">{season.w}</td>
                    <td className="is-num">{season.l}</td>
                    <td className="is-num">{pct(season.pct)}</td>
                    <td className="is-num">#{season.titlesToDate}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {limit < seasons.length && (
            <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
              <button className="chip-toggle" onClick={() => setLimit(seasons.length)}>
                Show all {seasons.length} seasons
              </button>
            </div>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Franchise titles</h2>
            </div>
            <table className="stat-table">
              <tbody>
                {franchises.slice(0, 12).map((franchise) => {
                  const team = teamsById.get(franchise.teamId)
                  return (
                    <tr key={franchise.teamId}>
                      <td>
                        <TeamMark team={team} size="sm" />
                      </td>
                      <td className="is-num" style={{ fontWeight: 600 }}>
                        {franchise.titles}
                      </td>
                      <td className="is-num muted">last {franchise.lastYear}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Awards</h2>
              <span className="eyebrow">Best hitter · pitcher · rookie</span>
            </div>
            <table className="stat-table">
              <tbody>
                {recentAwards.map((row) => (
                  <tr key={row.year}>
                    <td style={{ fontWeight: 600 }}>{row.year}</td>
                    <td>
                      {[row.hitter, row.pitcher, row.rookie].filter(Boolean).map((award) => {
                        const awardEntry = award!
                        return awardEntry.hasProfile ? (
                          <Link key={awardEntry.playerId} to={`/players/${awardEntry.playerId}`} className="history-award">
                            {awardEntry.name}
                          </Link>
                        ) : (
                          <span key={awardEntry.playerId} className="history-award history-award--plain">
                            {awardEntry.name}
                          </span>
                        )
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, padding: '0 var(--sp-4) var(--sp-4)' }}>
              Award winners from seasons before this save's player records are named but not linked —
              the export only carries full profiles for players still in the league.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
