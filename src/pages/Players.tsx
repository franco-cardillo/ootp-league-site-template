import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { teamMap } from '../lib/selectors'
import PageHeader from '../components/ui/PageHeader'
import TeamMark from '../components/ui/TeamMark'

interface IndexRow {
  id: number
  name: string
  teamId: number
  teamAbbr: string
  leagueId: number
  position: string
  age: number
  active: boolean
}

const PAGE_SIZE = 50

export default function Players() {
  const { core } = useCore()
  const index = useData<IndexRow[]>('players-index.json')
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('all')
  const [role, setRole] = useState<'all' | 'pitcher' | 'hitter'>('all')
  const [page, setPage] = useState(0)

  const teamsById = core ? teamMap(core.teams) : new Map()
  const mlbTeamIds = useMemo(
    () => new Set(core ? core.teams.filter((t) => t.leagueId === core.meta.mlbLeagueId).map((t) => t.id) : []),
    [core],
  )

  const filtered = useMemo(() => {
    if (!index.data) return []
    const q = query.trim().toLowerCase()
    return index.data.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false
      if (team === 'mlb' && !mlbTeamIds.has(row.teamId)) return false
      if (team !== 'all' && team !== 'mlb' && String(row.teamId) !== team) return false
      if (role === 'pitcher' && row.position !== 'P') return false
      if (role === 'hitter' && row.position === 'P') return false
      return true
    })
  }, [index.data, query, team, role, mlbTeamIds])

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const reset = () => setPage(0)

  return (
    <div className="container page">
      <PageHeader
        eyebrow={`${index.data ? index.data.length.toLocaleString() : '…'} players in the universe`}
        title="Players"
        deck="Every person in the export is searchable. Major League players carry full profiles; minor-league and NCAA players are indexed here and detailed in a later build."
      />

      <div className="filters">
        <input
          type="search"
          placeholder="Search by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            reset()
          }}
        />
        <select
          value={team}
          onChange={(e) => {
            setTeam(e.target.value)
            reset()
          }}
        >
          <option value="all">All clubs</option>
          <option value="mlb">MLB only</option>
          {core?.teams
            .filter((t) => t.leagueId === core.meta.mlbLeagueId && t.abbr !== 'AL' && t.abbr !== 'NL')
            .sort((a, b) => a.city.localeCompare(b.city))
            .map((t) => (
              <option value={t.id} key={t.id}>
                {t.city} {t.nickname}
              </option>
            ))}
        </select>
        {(['all', 'hitter', 'pitcher'] as const).map((r) => (
          <button
            key={r}
            className={`chip-toggle${role === r ? ' chip-toggle--active' : ''}`}
            onClick={() => {
              setRole(r)
              reset()
            }}
          >
            {r === 'all' ? 'Everyone' : r === 'pitcher' ? 'Pitchers' : 'Position players'}
          </button>
        ))}
      </div>

      {index.loading && <div className="state">Loading player index…</div>}
      {index.error && <div className="state state--error">Player index unavailable ({index.error})</div>}

      {index.data && (
        <>
          <div className="card table-scroll">
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Club</th>
                  <th>Pos</th>
                  <th>Age</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/players/${row.id}`}>{row.name}</Link>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {teamsById.get(row.teamId) ? (
                        <TeamMark team={teamsById.get(row.teamId)} size="sm" />
                      ) : (
                        <span className="muted">{row.teamId === 0 ? 'Free agent' : row.teamAbbr || '—'}</span>
                      )}
                    </td>
                    <td>{row.position}</td>
                    <td>{row.age}</td>
                    <td className="muted">{row.active ? 'Active' : 'Reserve'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="date-nav__button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              ← Previous
            </button>
            <span>
              {filtered.length.toLocaleString()} players · page {page + 1} of {pageCount.toLocaleString()}
            </span>
            <button
              className="date-nav__button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
