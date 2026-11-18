import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Leaders } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { teamMap } from '../lib/selectors'
import { BATTING_BOARDS, PITCHING_BOARDS, buildLeaderboardRead, leaderboardRows } from '../lib/leaderboardRead'
import PageHeader from '../components/ui/PageHeader'

type LeadersWithQualificationMeta = Leaders & {
  meta?: {
    qualificationVersion?: number
  }
}

export default function Statistics() {
  const leaders = useData<LeadersWithQualificationMeta>('mlb/leaders.json')
  const { core } = useCore()
  const [side, setSide] = useState<'batting' | 'pitching'>('batting')

  const teamsById = core ? teamMap(core.teams) : new Map()
  const boards = side === 'batting' ? BATTING_BOARDS : PITCHING_BOARDS
  const read = leaders.data ? buildLeaderboardRead(leaders.data) : []

  return (
    <div className="container page">
      {leaders.data && (
        <section className="analysis">
          <div className="analysis__kicker">The read · from the current export</div>
          <h2 className="analysis__headline">A look at the leaderboards</h2>
          {read.length > 0 ? (
            <div className="analysis__grid">
              {read.map((item) => (
                <article className="analysis__item" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          ) : (
            <p>No entries from the categories covered by this read are available yet.</p>
          )}
          <p className="analysis__note">
            Generated directly from this export's leaderboard entries, not AI or editorial scouting. Grouped values match the displayed precision and listed players.
          </p>
        </section>
      )}
      <PageHeader eyebrow={core ? `${core.meta.season} season · league leaders` : 'League leaders'} title="Statistics">
        <div className="filters" style={{ marginBottom: 0 }}>
          <button className={`chip-toggle${side === 'batting' ? ' chip-toggle--active' : ''}`} onClick={() => setSide('batting')}>
            Batting
          </button>
          <button className={`chip-toggle${side === 'pitching' ? ' chip-toggle--active' : ''}`} onClick={() => setSide('pitching')}>
            Pitching
          </button>
        </div>
      </PageHeader>

      {leaders.loading && <div className="state">Loading leaderboards…</div>}
      {leaders.error && <div className="state state--error">Leaderboards unavailable ({leaders.error})</div>}

      {leaders.data && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 'var(--sp-3)' }}>
          {leaders.data.meta?.qualificationVersion === 1 ? (
            <>
              AVG and OPS require 3.1 plate appearances per team game; ERA and WHIP require one inning per team game.
              For traded players, team games use the current or latest identifiable club as an approximation.
            </>
          ) : (
            'Qualification rules are unavailable for this data bundle.'
          )}
        </p>
      )}

      {leaders.data && (
        <div className="grid-2">
          {boards.map((board) => {
            const rows = leaderboardRows(leaders.data!, side, board.key)
            return (
              <section className="card" key={board.key}>
                <div className="section-head">
                  <h2>{board.label}</h2>
                  <span className="eyebrow">Top 10</span>
                </div>
                {rows.map((row, index) => {
                  const content = (
                    <>
                      <span className="leader-row__rank">{row.rank ?? '—'}</span>
                      <span className="leader-row__name">
                        {row.name}
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                          {teamsById.get(row.teamId)?.abbr ?? ''}
                        </span>
                      </span>
                      <span className="leader-row__value">{board.format(row.value)}</span>
                    </>
                  )
                  const key = `${board.key}-${row.playerId ?? `row-${index}`}`
                  return typeof row.playerId === 'number' && Number.isFinite(row.playerId) ? (
                    <Link to={`/players/${row.playerId}`} className="leader-row" key={key}>{content}</Link>
                  ) : (
                    <div className="leader-row" key={key}>{content}</div>
                  )
                })}
                {!rows.length && <div className="state">No players listed.</div>}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
