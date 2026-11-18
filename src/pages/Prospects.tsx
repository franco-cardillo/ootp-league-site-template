import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Prospect, ProspectComp } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { reportDateLabel, teamMap } from '../lib/selectors'
import PlayerAvatar from '../components/ui/PlayerAvatar'
import '../styles/prospects-board.css'

// Optional fields keep older exports usable while newer snapshots supply the BNN report.
type BoardProspect = Prospect & { bnnRank?: number | null; bnnPosition?: string | null }
type PositionFilter = 'all' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'SP' | 'RP'
type RoleFilter = 'all' | 'bat' | 'pit'

const POSITIONS: PositionFilter[] = ['all', 'C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP']
const LEVEL_NAME: Record<number, string> = {
  1: 'MLB',
  2: 'Triple-A',
  3: 'Double-A',
  // The export groups both High-A and Single-A leagues at level 4.
  4: 'Class A',
  5: 'Class A',
  6: 'Rookie',
  7: 'Short A',
  8: 'Rookie',
  9: 'Rookie',
  10: 'Rookie',
  11: 'Rookie',
  12: 'Rookie',
}

function levelName(level: number): string {
  return LEVEL_NAME[level] ?? `Level ${level}`
}

function BnnSource() {
  const report = useData<{ reportDate: string }>('bnn-rank.json')
  return <>BNN report: {report.loading ? 'loading date' : reportDateLabel(report.data?.reportDate)}. BNN is a separate snapshot, not a live feed. </>
}

function bnnRankOf(prospect: BoardProspect): number | null {
  const rank = prospect.bnnRank
  return typeof rank === 'number' && Number.isFinite(rank) && rank > 0 ? rank : null
}

/** Prefer the report's role; otherwise classify usage when clear, with stamina as a fallback. */
function pitchingPosition(prospect: BoardProspect): { position: 'SP' | 'RP'; inferred: boolean; source: string } | null {
  const reported = prospect.bnnPosition?.trim().toUpperCase()
  if (reported === 'SP' || reported === 'RP') return { position: reported, inferred: false, source: 'BNN report' }
  if (reported === 'CL') return { position: 'RP', inferred: false, source: 'BNN report: closer' }
  const position = prospect.position.trim().toUpperCase()
  if (position === 'SP' || position === 'RP') return { position, inferred: false, source: 'Listed position' }
  if (position === 'CL') return { position: 'RP', inferred: false, source: 'Listed position: closer' }
  if (position !== 'P' && prospect.role !== 'Pitcher') return null
  const games = prospect.stats?.g
  const starts = prospect.stats?.gs
  if (typeof games === 'number' && games >= 3 && typeof starts === 'number' && starts >= 0 && starts <= games) {
    const share = starts / games
    if (share >= 0.6) return { position: 'SP', inferred: true, source: `Estimated from ${starts} starts in ${games} appearances` }
    if (share <= 0.15) return { position: 'RP', inferred: true, source: `Estimated from ${starts} starts in ${games} appearances` }
  }
  const stamina = prospect.potentialTools?.stamina
  if (typeof stamina !== 'number' || !Number.isFinite(stamina) || stamina <= 0) return null
  return { position: stamina >= 45 ? 'SP' : 'RP', inferred: true, source: 'Estimated from stamina' }
}

function matchesPosition(prospect: BoardProspect, filter: PositionFilter): boolean {
  if (filter === 'all') return true
  const position = prospect.position.trim().toUpperCase()
  if (filter === 'SP' || filter === 'RP') return pitchingPosition(prospect)?.position === filter
  if (filter === 'OF') return ['OF', 'LF', 'CF', 'RF'].includes(position)
  return position === filter
}

function seasonLine(prospect: BoardProspect): string {
  const line = prospect.stats
  if (!line) return '—'
  if (prospect.role === 'Pitcher') {
    const record = line.w != null && line.l != null ? `${line.w}-${line.l}` : '—'
    const era = line.era != null ? `${line.era.toFixed(2)} ERA` : '— ERA'
    return `${record}, ${era}`
  }
  const avg = line.avg != null ? line.avg.toFixed(3).replace(/^0/, '') : '—'
  const homeRuns = line.hr != null ? `${line.hr} HR` : '— HR'
  return `${avg}, ${homeRuns}`
}

function CompSlot({ comp, label, historical = false }: { comp: ProspectComp | null; label: string; historical?: boolean }) {
  const reason = comp?.reason === 'same shape across every tool'
    ? historical ? 'no notable differences in the available statistical proxies' : 'no notable differences in the compared dimensions'
    : comp?.reason
  const name = comp && <>{comp.year ? `${comp.year} · ` : ''}{comp.playerName}</>
  return (
    <span className="prospects-board__comp-slot">
      <span className="prospects-board__comp-label">{label}: </span>
      {comp ? (
        <>
          {comp.hasProfile ? <Link to={`/players/${comp.playerId}`} className="prospects-board__comp-link">{name}</Link> : name}
          <span className="prospects-board__comp-reason">{historical ? 'Estimated proxy difference' : 'Estimated profile difference'} for prospect: {reason}</span>
        </>
      ) : <span className="prospects-board__muted">No suitable match.</span>}
    </span>
  )
}

/** Both pools have their own visible slot, including when either is empty. */
function CompCell({ comps }: { comps: Prospect['comps'] }) {
  if (comps?.modelVersion !== 2) return <span className="prospects-board__muted">Available after data refresh.</span>
  return (
    <span className="prospects-board__comp">
      <CompSlot comp={comps?.current ?? null} label="Current" />
      <CompSlot comp={comps?.historical ?? null} label="Historical" historical />
    </span>
  )
}

export default function Prospects() {
  const prospects = useData<BoardProspect[]>('prospects.json')
  const { core } = useCore()
  const [org, setOrg] = useState('all')
  const [level, setLevel] = useState('all')
  const [role, setRole] = useState<RoleFilter>('all')
  const [position, setPosition] = useState<PositionFilter>('all')
  const [query, setQuery] = useState('')
  const teamsById = useMemo(() => core ? teamMap(core.teams) : new Map(), [core])

  const orgs = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of prospects.data ?? []) if (!seen.has(p.orgAbbr)) seen.set(p.orgAbbr, p.orgName)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [prospects.data])
  const levels = useMemo(
    () => [...new Set((prospects.data ?? []).map((p) => p.level))].sort((a, b) => a - b),
    [prospects.data],
  )
  const board = useMemo(() => {
    return [...(prospects.data ?? [])]
      .sort((a, b) => {
        const aRank = bnnRankOf(a)
        const bRank = bnnRankOf(b)
        if (aRank !== null && bRank !== null) return aRank - bRank || a.name.localeCompare(b.name)
        if (aRank !== null) return -1
        if (bRank !== null) return 1
        return b.score - a.score || a.name.localeCompare(b.name)
      })
      .map((prospect, index) => ({ prospect, boardRank: index + 1 }))
  }, [prospects.data])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return board.filter(({ prospect: p }) => {
      if (org !== 'all' && p.orgAbbr !== org) return false
      if (level !== 'all' && p.level !== Number(level)) return false
      if (role === 'pit' && p.role !== 'Pitcher') return false
      if (role === 'bat' && p.role === 'Pitcher') return false
      if (!matchesPosition(p, position)) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [board, org, level, role, position, query])
  const bnnCount = useMemo(() => board.filter(({ prospect }) => bnnRankOf(prospect) !== null).length, [board])
  const hasBnnRanks = bnnCount > 0
  const hasFilters = org !== 'all' || level !== 'all' || role !== 'all' || position !== 'all' || query !== ''
  const clearFilters = () => {
    setOrg('all')
    setLevel('all')
    setRole('all')
    setPosition('all')
    setQuery('')
  }

  return (
    <div className="prospects-board">
      <div className="prospects-board__inner">
        <header className="prospects-board__hero">
          <div className="prospects-board__hero-main">
            <div className="prospects-board__eyebrow"><span /> Player development <b>/</b> Scouting board</div>
            <h1>Prospects<span>Scouting board</span></h1>
            <p className="prospects-board__deck">The next wave, on the record. Explore the farm system by organization, level and position.</p>
          </div>
          <div className="prospects-board__hero-side">
            <div className="prospects-board__edition">THE PROSPECT REPORT <span> / </span> {core?.meta.season ?? 'SNAPSHOT'}</div>
            <p>{prospects.data && (hasBnnRanks
              ? <BnnSource />
              : <>Rankings are calculated from OOTP ratings. </>)}Current feed: {core?.meta.simDate ?? 'date unavailable'}. Grades are estimates based on OOTP ratings.</p>
          </div>
        </header>

        <div className="prospects-board__summary" aria-label="Board summary">
          <div><span className="prospects-board__summary-value">{prospects.data ? prospects.data.length.toLocaleString() : '—'}</span><span>Prospects on board</span></div>
          <div><span className="prospects-board__summary-value">{prospects.data ? (hasBnnRanks ? bnnCount.toLocaleString() : 'Calculated') : '—'}</span><span>{hasBnnRanks ? 'BNN ranked' : 'Ranking method'}</span></div>
          <div><span className="prospects-board__summary-value">{prospects.data ? orgs.length.toLocaleString() : '—'}</span><span>Organizations</span></div>
          <div className="prospects-board__summary-note"><strong>THE ORDER</strong><span>{prospects.data ? (hasBnnRanks ? <>BNN snapshot first.<br />Others by calculated score.</> : <>By calculated score.</>) : 'Loading rankings.'}</span></div>
        </div>

        <section className="prospects-board__filters" aria-labelledby="filter-heading">
          <div className="prospects-board__section-heading">
            <div><span className="prospects-board__section-index">01</span><h2 id="filter-heading">Filter the board</h2></div>
            <button type="button" className="prospects-board__reset" onClick={clearFilters} disabled={!hasFilters}>Clear filters <span aria-hidden="true">×</span></button>
          </div>
          <div className="prospects-board__filter-grid">
            <label className="prospects-board__field"><span>Search player</span><input type="search" placeholder="Enter a name" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            <label className="prospects-board__field">
              <span>Organization</span>
              <select value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="all">All organizations</option>
                {orgs.map(([abbr, name]) => <option value={abbr} key={abbr}>{name}</option>)}
              </select>
            </label>
            <label className="prospects-board__field">
              <span>Level</span>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="all">All levels</option>
                {levels.map((value) => <option value={value} key={value}>{levelName(value)}</option>)}
              </select>
            </label>
          </div>
          <div className="prospects-board__filter-groups">
            <fieldset className="prospects-board__filter-group">
              <legend>Role</legend>
              <div className="prospects-board__chips">
                {(['all', 'bat', 'pit'] as const).map((value) => (
                  <button type="button" key={value} aria-pressed={role === value} className={role === value ? 'is-active' : ''} onClick={() => setRole(value)}>
                    {value === 'all' ? 'All players' : value === 'bat' ? 'Position players' : 'Pitchers'}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="prospects-board__filter-group">
              <legend>Position</legend>
              <div className="prospects-board__chips prospects-board__chips--position">
                {POSITIONS.map((value) => (
                  <button type="button" key={value} aria-pressed={position === value} className={position === value ? 'is-active' : ''} onClick={() => setPosition(value)}>{value === 'all' ? 'All' : value}</button>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="prospects-board__filter-note">OF includes LF, CF and RF. {hasBnnRanks && 'SP/RP uses the BNN report when available; otherwise ' }* marks an estimate from season starts and appearances, or stamina when usage is unclear. Pitchers without enough information are unclassified.</p>
        </section>

        <section className="prospects-board__results" aria-labelledby="board-heading">
          <div className="prospects-board__results-head">
            <div><span className="prospects-board__section-index">02</span><h2 id="board-heading">The board</h2><span className="prospects-board__live-label">SNAPSHOT</span></div>
            <p aria-live="polite">{prospects.data ? `${rows.length.toLocaleString()} of ${board.length.toLocaleString()} prospects` : 'Prospect rankings'}</p>
          </div>
          <p className="prospects-board__ranking-note">{hasBnnRanks ? 'Board # is the combined order. BNN # is the rank in the supplied snapshot; a dash means no BNN rank. Remaining players are ordered by calculated score.' : 'Board # is ordered by calculated score, not an official report.'}</p>
          <p className="prospects-board__comp-note">Comparisons are statistical and style references, not career forecasts or professional scouting. Current references compare OOTP tool ratings. Historical references compare the prospect's OOTP potential grades, mapped to estimated percentiles, with a past season's statistical percentiles—not historical scouting grades. Historical comparisons do not measure defense. Differences shown are model estimates, not established real-world tool differences.</p>
          {prospects.loading && <div className="prospects-board__state" role="status">Loading the prospect board…</div>}
          {prospects.error && <div className="prospects-board__state prospects-board__state--error" role="alert">Prospects unavailable ({prospects.error})</div>}
          {prospects.data && rows.length > 0 && (
            <>
              <p className="prospects-board__scroll-hint">Scroll horizontally to see the full scouting report <span aria-hidden="true">→</span></p>
              <div className="prospects-board__table-scroll" tabIndex={0} role="region" aria-label="Prospect scouting board, scroll horizontally for all columns">
                <table className="prospects-board__table">
                  <thead><tr><th scope="col">Board #</th>{hasBnnRanks && <th scope="col">BNN #</th>}<th scope="col">Player</th><th scope="col">Org</th><th scope="col">Club</th><th scope="col">Level</th><th scope="col">Age</th><th scope="col">Pos</th><th scope="col">B/T</th><th scope="col">Cur</th><th scope="col">Pot</th><th scope="col">{core?.meta.season ?? 'Season'} line</th><th scope="col">Style references <span>current / historical</span></th></tr></thead>
                  <tbody>
                    {rows.map(({ prospect, boardRank }) => {
                      const club = teamsById.get(prospect.teamId)
                      const orgTeam = teamsById.get(prospect.orgId)
                      const bnnRank = bnnRankOf(prospect)
                      const pitcherPosition = pitchingPosition(prospect)
                      return (
                        <tr key={prospect.id}>
                          <td className="prospects-board__rank">{String(boardRank).padStart(2, '0')}</td>
                          {hasBnnRanks && <td className="prospects-board__bnn">{bnnRank !== null ? `#${bnnRank}` : '—'}</td>}
                          <td><Link to={`/prospects/${prospect.id}`} className="prospects-board__player"><PlayerAvatar id={prospect.id} name={prospect.name} color={orgTeam?.colors.primary} size="sm" /><span>{prospect.name}</span></Link></td>
                          <td className="prospects-board__org">{prospect.orgAbbr}</td><td>{club?.abbr ?? prospect.teamAbbr}</td>
                          <td>{levelName(prospect.level)} <span className="prospects-board__league">{prospect.leagueAbbr}</span></td>
                          <td>{prospect.age}</td><td title={pitcherPosition?.source}>{pitcherPosition ? `${pitcherPosition.position}${pitcherPosition.inferred ? '*' : ''}` : prospect.position}</td><td>{prospect.bats}/{prospect.throws}</td>
                          <td>{prospect.current}</td><td className="prospects-board__potential">{prospect.potential}</td><td>{seasonLine(prospect)}</td><td><CompCell comps={prospect.comps} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {prospects.data && !rows.length && <div className="prospects-board__state"><strong>No prospects match these filters.</strong><span>Try a different search or clear the filters to see the full board.</span><button type="button" onClick={clearFilters}>Clear filters</button></div>}
        </section>
        <div className="prospects-board__footer-note"><span>OOTP <b>/</b> PLAYER DEVELOPMENT</span><span>RANKINGS &amp; RATINGS ARE A SNAPSHOT</span></div>
      </div>
    </div>
  )
}
