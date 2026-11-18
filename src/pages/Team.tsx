import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { FranchiseLeaders, Game, Prospect, PitchingSeason, BattingSeason, PlayerDetail, StandingRow, Team as TeamType, TeamStats } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { combineBatting, combinePitching, currentSeasonLines, ip as formatIp, pct, pitchingRate, record, shortDate, streakLabel, teamMap } from '../lib/selectors'
import TeamMark from '../components/ui/TeamMark'
import DataTable, { type Column } from '../components/ui/DataTable'
import '../styles/pages.css'

const name = (p: PlayerDetail) => `${p.firstName} ${p.lastName}`

const pitcherColumns: Column<{ player: PlayerDetail; line: PitchingSeason | undefined }>[] = [
  {
    key: 'name',
    label: 'Pitcher',
    sortable: true,
    sortValue: (row) => row.player.lastName,
    render: (row) => <Link to={`/players/${row.player.id}`}>{name(row.player)}</Link>,
  },
  { key: 'age', label: 'Age', align: 'right', sortable: true, sortValue: (r) => r.player.age, render: (r) => r.player.age },
  { key: 'w', label: 'W', align: 'right', sortable: true, sortValue: (r) => r.line?.w ?? 0, render: (r) => r.line?.w ?? 0 },
  { key: 'l', label: 'L', align: 'right', sortable: true, sortValue: (r) => r.line?.l ?? 0, render: (r) => r.line?.l ?? 0 },
  { key: 'sv', label: 'SV', align: 'right', sortable: true, sortValue: (r) => r.line?.sv ?? 0, render: (r) => r.line?.sv ?? 0 },
  {
    key: 'era',
    label: 'ERA',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.line?.era ?? null,
    render: (r) => (r.line ? pitchingRate(r.line.era, r.line.outs, r.line.ipMissing) : '—'),
  },
  {
    key: 'ip',
    label: 'IP',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.line?.ip ?? 0,
    render: (r) => (r.line ? formatIp(r.line.ip, r.line.outs, r.line.ipMissing) : '—'),
  },
  { key: 'k', label: 'K', align: 'right', sortable: true, sortValue: (r) => r.line?.k ?? 0, render: (r) => r.line?.k ?? 0 },
]

const batterColumns: Column<{ player: PlayerDetail; line: BattingSeason | undefined }>[] = [
  {
    key: 'name',
    label: 'Position player',
    sortable: true,
    sortValue: (row) => row.player.lastName,
    render: (row) => <Link to={`/players/${row.player.id}`}>{name(row.player)}</Link>,
  },
  {
    key: 'pos',
    label: 'Pos',
    sortable: true,
    sortValue: (r) => r.player.position,
    render: (r) => r.player.position,
  },
  { key: 'age', label: 'Age', align: 'right', sortable: true, sortValue: (r) => r.player.age, render: (r) => r.player.age },
  {
    key: 'avg',
    label: 'AVG',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.line?.avg ?? null,
    render: (r) => (r.line ? r.line.avg.toFixed(3).replace(/^0/, '') : '—'),
  },
  { key: 'hr', label: 'HR', align: 'right', sortable: true, sortValue: (r) => r.line?.hr ?? 0, render: (r) => r.line?.hr ?? 0 },
  { key: 'rbi', label: 'RBI', align: 'right', sortable: true, sortValue: (r) => r.line?.rbi ?? 0, render: (r) => r.line?.rbi ?? 0 },
  {
    key: 'ops',
    label: 'OPS',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.line?.ops ?? null,
    render: (r) => (r.line ? r.line.ops.toFixed(3).replace(/^0/, '') : '—'),
  },
]

export default function Team() {
  const { teamId } = useParams()
  const id = Number(teamId)
  const { core, loading, error } = useCore()
  const roster = useData<PlayerDetail[]>(`mlb/rosters/${id}.json`)
  const stats = useData<TeamStats[]>('mlb/team-stats.json')
  const games = useData<Game[]>('mlb/games.json')
  const prospects = useData<Prospect[]>('prospects.json')
  const leaders = useData<FranchiseLeaders>(`mlb/team-leaders/${id}.json`)
  const [side, setSide] = useState<'batting' | 'pitching'>('batting')

  if (loading) return <div className="container page state">Loading club…</div>
  if (error || !core) return <div className="container page state state--error">Could not load club: {error}</div>

  const teamsById = teamMap(core.teams)
  const team: TeamType | undefined = teamsById.get(id)
  if (!team) return <div className="container page state state--error">That club is not in the Major League set.</div>

  const standing: StandingRow | undefined = core.standings.find((r) => r.teamId === id)
  const division = core.standings
    .filter((r) => r.subLeagueId === team.subLeagueId && r.divisionId === team.divisionId)
    .sort((a, b) => b.pct - a.pct)
  const divisionRank = division.findIndex((r) => r.teamId === id) + 1
  const divisionName = core.divisions.find((d) => d.subLeagueId === team.subLeagueId && d.id === team.divisionId)?.name
  const leagueAbbr = core.subLeagues.find((s) => s.id === team.subLeagueId)?.abbr
  const teamStats = stats.data?.find((s) => s.teamId === id)
  const farm = (prospects.data ?? []).filter((p) => p.orgId === id).slice(0, 10)
  const leaderGroups = (side === 'batting' ? leaders.data?.batting : leaders.data?.pitching) ?? []

  const played = (games.data ?? []).filter((g) => g.played && (g.homeTeamId === id || g.awayTeamId === id))
  const recent = played.slice(-8).reverse()
  const upcoming = (games.data ?? []).filter((g) => !g.played && (g.homeTeamId === id || g.awayTeamId === id)).slice(0, 6)

  const pitchers = (roster.data ?? [])
    .filter((p) => p.positionCode === 1)
    .map((player) => ({ player, line: combinePitching(currentSeasonLines(player.pitching, core.meta.season, core.meta.mlbLeagueId, id)) ?? undefined }))
  const hitters = (roster.data ?? [])
    .filter((p) => p.positionCode !== 1)
    .map((player) => ({ player, line: combineBatting(currentSeasonLines(player.batting, core.meta.season, core.meta.mlbLeagueId, id)) ?? undefined }))

  return (
    <div className="container page">
      <div className="player-hero" style={{ background: team.colors.primary }}>
        <TeamMark team={team} size="lg" showName={false} link={false} />
        <div>
          <p className="hero__eyebrow" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {leagueAbbr} {divisionName}
          </p>
          <h1 className="player-hero__name" style={{ color: '#fff' }}>
            {team.city} {team.nickname}
          </h1>
          <div className="player-hero__meta" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <span>{core.meta.season} season</span>
            {standing && (
              <span>
                {record(standing.w, standing.l)} · {pct(standing.pct)}
              </span>
            )}
            {standing && divisionRank > 0 && <span>{`${divisionRank}${suffix(divisionRank)} in division`}</span>}
            {standing && <span>Streak {streakLabel(standing.streak)}</span>}
          </div>
        </div>
        {teamStats && (
          <div className="player-hero__stats" style={{ color: '#fff' }}>
            <div>
              <div className="player-hero__stat-value">{teamStats.batting.avg.toFixed(3).replace(/^0/, '')}</div>
              <div className="player-hero__stat-label" style={{ color: 'rgba(255,255,255,0.7)' }}>Team AVG</div>
            </div>
            <div>
              <div className="player-hero__stat-value">{teamStats.batting.hr}</div>
              <div className="player-hero__stat-label" style={{ color: 'rgba(255,255,255,0.7)' }}>HR</div>
            </div>
            <div>
              <div className="player-hero__stat-value">{pitchingRate(teamStats.pitching.era, teamStats.pitching.outs, teamStats.pitching.ipMissing)}</div>
              <div className="player-hero__stat-label" style={{ color: 'rgba(255,255,255,0.7)' }}>Team ERA</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid-main" style={{ marginTop: 'var(--sp-5)' }}>
        <div className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Pitchers</h2>
              <span className="eyebrow">
                {roster.data ? `${pitchers.length} on roster · click a column to sort · ~ means estimated pitching stats` : 'loading'}
              </span>
            </div>
            {roster.loading && <div className="state">Loading roster…</div>}
            {roster.error && <div className="state state--error">Roster unavailable ({roster.error})</div>}
            {roster.data && (
              <DataTable
                columns={pitcherColumns}
                rows={pitchers}
                rowKey={(row) => row.player.id}
                initialSort={{ key: 'ip', dir: 'desc' }}
                emptyMessage="No pitchers on the active roster."
              />
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Position players</h2>
              <span className="eyebrow">
                {roster.data ? `${hitters.length} on roster · click a column to sort` : 'loading'}
              </span>
            </div>
            {roster.data && (
              <DataTable
                columns={batterColumns}
                rows={hitters}
                rowKey={(row) => row.player.id}
                initialSort={{ key: 'ops', dir: 'desc' }}
                emptyMessage="No position players on the active roster."
              />
            )}
          </section>

          {teamStats && (
            <section className="card">
              <div className="section-head">
                <h2>Team totals</h2>
                <span className="eyebrow">{core.meta.season}</span>
              </div>
              <div className="grid-2">
                <div>
                  <div className="leader-group-label">Batting</div>
                  <table className="stat-table">
                    <tbody>
                      <tr><td>Runs</td><td>{teamStats.batting.r}</td></tr>
                      <tr><td>Hits</td><td>{teamStats.batting.h}</td></tr>
                      <tr><td>Home runs</td><td>{teamStats.batting.hr}</td></tr>
                      <tr><td>AVG</td><td>{teamStats.batting.avg.toFixed(3).replace(/^0/, '')}</td></tr>
                      <tr><td>OBP</td><td>{teamStats.batting.obp.toFixed(3).replace(/^0/, '')}</td></tr>
                      <tr><td>SLG</td><td>{teamStats.batting.slg.toFixed(3).replace(/^0/, '')}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="leader-group-label">Pitching</div>
                  <table className="stat-table">
                    <tbody>
                      <tr><td>Innings</td><td>{formatIp(teamStats.pitching.ip, teamStats.pitching.outs, teamStats.pitching.ipMissing)}</td></tr>
                      <tr><td>Runs allowed</td><td>{teamStats.pitching.r}</td></tr>
                      <tr><td>Home runs</td><td>{teamStats.pitching.hr}</td></tr>
                      <tr><td>ERA</td><td>{pitchingRate(teamStats.pitching.era, teamStats.pitching.outs, teamStats.pitching.ipMissing)}</td></tr>
                      <tr><td>WHIP</td><td>{pitchingRate(teamStats.pitching.whip, teamStats.pitching.outs, teamStats.pitching.ipMissing)}</td></tr>
                      <tr><td>Strikeouts</td><td>{teamStats.pitching.k}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Recent results</h2>
            </div>
            {recent.map((game) => {
              const isHome = game.homeTeamId === id
              const us = isHome ? game.homeScore : game.awayScore
              const them = isHome ? game.awayScore : game.homeScore
              const opponent = teamsById.get(isHome ? game.awayTeamId : game.homeTeamId)
              return (
                <div className="leader-row" key={game.id} style={{ gridTemplateColumns: '20px minmax(0,1fr) auto' }}>
                  <span className={`result-flag ${us > them ? 'result-flag--win' : 'result-flag--loss'}`}>
                    {us > them ? 'W' : 'L'}
                  </span>
                  <span className="leader-row__name">
                    {isHome ? 'vs' : '@'} {opponent?.abbr}
                  </span>
                  <span className="leader-row__value">
                    {us}–{them}
                  </span>
                </div>
              )
            })}
            {!recent.length && <div className="state">No games played yet.</div>}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Franchise leaders</h2>
              <div className="scope-chips">
                {(['batting', 'pitching'] as const).map((option) => (
                  <button
                    key={option}
                    className={`scope-chip${side === option ? ' scope-chip--on' : ''}`}
                    onClick={() => setSide(option)}
                  >
                    {option === 'batting' ? 'Batting' : 'Pitching'}
                  </button>
                ))}
              </div>
            </div>
            {leaders.loading && <div className="state">Loading franchise history…</div>}
            {leaders.error && <div className="state state--error">Leaders unavailable ({leaders.error})</div>}
            {leaderGroups.map((group) => (
              <div key={group.key} className="leader-group">
                <div className="leader-group__label">{group.label}</div>
                {group.leaders.slice(0, 5).map((leader, index) => {
                  const inner = (
                    <>
                      <span className="leader-row__rank">{index + 1}</span>
                      <span className="leader-row__name">{leader.name}</span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {leader.note}
                      </span>
                      <span className="leader-row__value">{leader.value}</span>
                    </>
                  )
                  return leader.hasProfile ? (
                    <Link
                      to={`/players/${leader.playerId}`}
                      className="leader-row"
                      key={`${group.key}-${leader.playerId}`}
                      style={{ gridTemplateColumns: '18px minmax(0,1fr) auto auto' }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div
                      className="leader-row leader-row--flat"
                      key={`${group.key}-${leader.playerId}`}
                      style={{ gridTemplateColumns: '18px minmax(0,1fr) auto auto' }}
                    >
                      {inner}
                    </div>
                  )
                })}
              </div>
            ))}
            <p className="muted" style={{ fontSize: 11, padding: '0 var(--sp-4) var(--sp-4)' }}>
              Career totals in this uniform only, counting every league the club has played in.
            </p>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Farm system</h2>
              <Link to="/prospects" className="link-quiet">
                Full board →
              </Link>
            </div>
            {farm.length > 0 && (
              <p className="muted" style={{ fontSize: 11, padding: '0 var(--sp-4)' }}>Board rank shown first.</p>
            )}
            {farm.map((prospect) => (
              <Link to={`/prospects/${prospect.id}`} className="leader-row" key={prospect.id} style={{ gridTemplateColumns: '26px minmax(0,1fr) auto 30px' }}>
                <span className="leader-row__rank" aria-label={`Board rank ${prospect.rank}`}>{prospect.rank}</span>
                <span className="leader-row__name">{prospect.name}</span>
                <span className="muted">{prospect.leagueAbbr || `Lvl ${prospect.level}`}</span>
                <span className="leader-row__value">{prospect.potential}</span>
              </Link>
            ))}
            {prospects.loading && <div className="state">Loading prospects…</div>}
            {!farm.length && !prospects.loading && (
              <div className="state">No ranked prospects in this organization yet.</div>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Upcoming</h2>
            </div>
            {upcoming.map((game) => {
              const isHome = game.homeTeamId === id
              const opponent = teamsById.get(isHome ? game.awayTeamId : game.homeTeamId)
              return (
                <div className="leader-row" key={game.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span className="leader-row__name">
                    {isHome ? 'vs' : '@'} {opponent?.abbr}
                  </span>
                  <span className="muted">{shortDate(game.date)}</span>
                </div>
              )
            })}
            {!upcoming.length && <div className="state">Season complete.</div>}
          </section>
        </aside>
      </div>
    </div>
  )
}

function suffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}
