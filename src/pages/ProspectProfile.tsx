import { Link, useParams } from 'react-router-dom'
import type { Prospect, ProspectComp } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { teamMap } from '../lib/selectors'
import PlayerAvatar from '../components/ui/PlayerAvatar'

const BATTING_TOOLS: [string, string][] = [
  ['contact', 'Contact'],
  ['gap', 'Gap'],
  ['power', 'Power'],
  ['eye', 'Eye'],
]

const PITCHING_TOOLS: [string, string][] = [
  ['stuff', 'Stuff'],
  ['movement', 'Movement'],
  ['control', 'Control'],
]

/** Each reference is independent; an empty slot doesn't explain why a match was unavailable. */
function CompRow({ comp, label, historical = false, needsRefresh = false }: { comp: ProspectComp | null; label: string; historical?: boolean; needsRefresh?: boolean }) {
  if (!comp) {
    return (
      <div className="comp-row comp-row--empty">
        <div className="comp-row__head">
          <span className="comp-row__name">{label}</span>
        </div>
        <span className="comp-row__reason">{needsRefresh ? 'Available after data refresh.' : 'No suitable match.'}</span>
      </div>
    )
  }

  const reason = comp.reason === 'same shape across every tool'
    ? historical ? 'no notable differences in the available statistical proxies' : 'no notable differences in the compared dimensions'
    : comp.reason
  const body = (
    <>
      <div className="comp-row__head">
        <span className="comp-row__name">
          {comp.playerName}
          {comp.year ? <span className="comp-row__year"> · {comp.year}</span> : null}
        </span>
        <span className="comp-row__year">{label}</span>
      </div>
      <span className="comp-row__reason">
        {historical ? 'Estimated proxy difference for prospect' : 'Estimated profile difference for prospect'}: {reason}
      </span>
    </>
  )

  return comp.hasProfile ? (
    <Link to={`/players/${comp.playerId}`} className="comp-row comp-row--link">
      {body}
    </Link>
  ) : (
    <div className="comp-row">{body}</div>
  )
}

export default function ProspectProfile() {
  const { prospectId } = useParams()
  const id = Number(prospectId)
  const prospects = useData<Prospect[]>('prospects.json')
  const { core } = useCore()

  if (prospects.loading) return <div className="container page state">Loading prospect…</div>
  const prospect = prospects.data?.find((p) => p.id === id)
  if (!prospect) return <div className="container page state state--error">No prospect with that id.</div>

  const teamsById = core ? teamMap(core.teams) : new Map()
  const org = teamsById.get(prospect.orgId)
  const club = teamsById.get(prospect.teamId)
  const tools = prospect.role === 'Pitcher' ? PITCHING_TOOLS : BATTING_TOOLS
  const line = prospect.stats
  const needsCompRefresh = prospect.comps?.modelVersion !== 2
  const current = needsCompRefresh ? null : prospect.comps?.current ?? null
  const historical = needsCompRefresh ? null : prospect.comps?.historical ?? null

  return (
    <div className="container page">
      <div className="player-hero">
        <PlayerAvatar
          id={prospect.id}
          name={prospect.name}
          color={org?.colors.primary}
          size="xl"
        />
        <div>
          <p className="hero__eyebrow" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {prospect.orgAbbr} organization · {club?.abbr ?? prospect.teamAbbr} ·{' '}
            {prospect.leagueAbbr || `level ${prospect.level}`}
          </p>
          <h1 className="player-hero__name" style={{ color: '#fff' }}>
            {prospect.name}
          </h1>
          <div className="player-hero__meta" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <span>Board #{prospect.rank}</span>
            <span>{prospect.age} years old</span>
            <span>{prospect.position}</span>
            <span>
              B/T {prospect.bats}/{prospect.throws}
            </span>
            {prospect.nation && <span>{prospect.nation}</span>}
          </div>
        </div>
        <div className="player-hero__stats" style={{ color: '#fff' }}>
          <div>
            <div className="player-hero__stat-value">{prospect.potential}</div>
            <div className="player-hero__stat-label" style={{ color: 'rgba(255,255,255,0.7)' }}>Potential</div>
          </div>
          <div>
            <div className="player-hero__stat-value">{prospect.current}</div>
            <div className="player-hero__stat-label" style={{ color: 'rgba(255,255,255,0.7)' }}>Current</div>
          </div>
        </div>
      </div>

      <div className="grid-main" style={{ marginTop: 'var(--sp-5)' }}>
        <div className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Tools</h2>
              <span className="eyebrow">Current vs potential</span>
            </div>
            <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
              {tools.map(([key, label]) => (
                <div className="tool-row" key={key}>
                  <span className="tool-row__label">{label}</span>
                  <span className="tool-row__value">{prospect.tools[key] ?? 0}</span>
                  <span className="rating__track">
                    <span
                      className="rating__fill"
                      style={{ width: `${Math.min(100, (prospect.potentialTools[key] ?? 0))}%` }}
                    />
                  </span>
                  <span className="tool-row__value tool-row__value--pot">{prospect.potentialTools[key] ?? 0}</span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 12, marginTop: 'var(--sp-3)' }}>
                Left number is the current rating, the bar and right number are potential, both on OOTP's
                20–80 scale.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Player comparisons</h2>
              <span className="eyebrow">Current player / historical season</span>
            </div>
            <div className="comp-list">
              <CompRow comp={current} label="Current" needsRefresh={needsCompRefresh} />
              <CompRow comp={historical} label="Historical" historical needsRefresh={needsCompRefresh} />
            </div>
            <p className="comp-note">
              These are statistical and style references, not career forecasts or professional scouting.
              Current references compare OOTP tool ratings. Historical references compare the prospect's
              OOTP potential grades, mapped to estimated percentiles, with a past season's statistical
              percentiles—not historical scouting grades. Historical comparisons do not measure defense.
              Stolen-base rate is only a speed proxy, not a direct measure of speed.
              The differences shown are model estimates, not established real-world tool differences.
            </p>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>{core?.meta.season ?? ''} season</h2>
              <span className="eyebrow">{line?.league || 'No line recorded'}</span>
            </div>
            {line ? (
              <div className="career-grid">
                <div className="career-cell">
                  <div className="career-cell__value">{line.g}</div>
                  <div className="career-cell__label">Games</div>
                </div>
                {prospect.role === 'Pitcher' ? (
                  <>
                    <div className="career-cell">
                      <div className="career-cell__value">
                        {line.w ?? 0}-{line.l ?? 0}
                      </div>
                      <div className="career-cell__label">W-L</div>
                    </div>
                    <div className="career-cell">
                      <div className="career-cell__value">{(line.era ?? 0).toFixed(2)}</div>
                      <div className="career-cell__label">ERA</div>
                    </div>
                    <div className="career-cell">
                      <div className="career-cell__value">{(line.ip ?? 0).toFixed(1)}</div>
                      <div className="career-cell__label">IP</div>
                    </div>
                    <div className="career-cell">
                      <div className="career-cell__value">{line.k ?? 0}</div>
                      <div className="career-cell__label">K</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="career-cell">
                      <div className="career-cell__value">{(line.avg ?? 0).toFixed(3).replace(/^0/, '')}</div>
                      <div className="career-cell__label">AVG</div>
                    </div>
                    <div className="career-cell">
                      <div className="career-cell__value">{line.hr ?? 0}</div>
                      <div className="career-cell__label">HR</div>
                    </div>
                    <div className="career-cell">
                      <div className="career-cell__value">{line.rbi ?? 0}</div>
                      <div className="career-cell__label">RBI</div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="state">No {core?.meta.season ?? ''} stats recorded for this player.</div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Organization</h2>
            </div>
            <div style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 'var(--fs-small)' }}>
              <div className="bio-row">
                <span className="muted">Parent club</span>
                <span>{prospect.orgName}</span>
              </div>
              <div className="bio-row">
                <span className="muted">Assigned to</span>
                <span>{club ? `${club.city} ${club.nickname}` : prospect.teamAbbr}</span>
              </div>
              <div className="bio-row">
                <span className="muted">League</span>
                <span>{prospect.leagueAbbr || `Level ${prospect.level}`}</span>
              </div>
              <div className="bio-row">
                <span className="muted">Prospect score</span>
                <span>{prospect.score.toFixed(1)}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>What's next</h2>
            </div>
            <div style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 'var(--fs-small)', color: 'var(--text-2)' }}>
              Full minor-league game logs, promotions and organizational rankings come with the
              minor-league build. Today this page reads the ratings and current-season line your export
              already contains.
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
