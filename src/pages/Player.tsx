import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { BattingSeason, PitchingSeason, PlayerDetail } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { combineBatting, combinePitching, currentSeasonLines, ip as formatIp, pitchingRate, teamMap } from '../lib/selectors'
import { formatPlayerHeight } from '../lib/playerHeight'
import TeamMark from '../components/ui/TeamMark'
import PlayerAvatar from '../components/ui/PlayerAvatar'

const BUCKETS = 32

type HistoryRow = { batting: BattingSeason[]; pitching: PitchingSeason[] }

export default function Player() {
  const { playerId } = useParams()
  const id = Number(playerId)
  const { core, loading } = useCore()
  const bucket = useData<PlayerDetail[]>(`mlb/players/${id % BUCKETS}.json`)
  const history = useData<Record<string, HistoryRow>>(`mlb/history/${id % BUCKETS}.json`)
  const [scope, setScope] = useState<'MLB' | 'MINORS' | 'ALL'>('MLB')

  if (loading || bucket.loading) return <div className="container page state">Loading player…</div>
  if (!core) return <div className="container page state state--error">League data unavailable.</div>

  const player = bucket.data?.find((p) => p.id === id)
  if (!player) {
    return (
      <div className="container page state state--error">
        No Major League profile for player {id}. This player exists in the wider universe but is not part of the
        MLB detail set yet.
      </div>
    )
  }

  const teamsById = teamMap(core.teams)
  const team = teamsById.get(player.teamId)
  const seasonBatting = currentSeasonLines(player.batting, core.meta.season, core.meta.mlbLeagueId)
  const seasonPitching = currentSeasonLines(player.pitching, core.meta.season, core.meta.mlbLeagueId)
  const seasonBattingTotal = combineBatting(seasonBatting)
  const seasonPitchingTotal = combinePitching(seasonPitching)
  const career = player.careerBatting
  const careerPitch = player.careerPitching
  const hist = history.data?.[String(id)]
  const inScope = (leagueId: number) =>
    scope === 'ALL' ? true : scope === 'MLB' ? leagueId === core.meta.mlbLeagueId : leagueId !== core.meta.mlbLeagueId
  const battingRows = (hist?.batting ?? []).filter((line) => inScope(line.leagueId))
  const pitchingRows = (hist?.pitching ?? []).filter((line) => inScope(line.leagueId))
  const isPitcher = player.positionCode === 1
  const leagueAbbr = new Map(core.leagues.map((l) => [l.id, l.abbr]))
  const seasonsPlayed = new Set<number>([
    ...(hist?.batting ?? []).map((l) => l.year),
    ...(hist?.pitching ?? []).map((l) => l.year),
    ...seasonBatting.map((l) => l.year),
    ...seasonPitching.map((l) => l.year),
  ]).size

  return (
    <div className="container page">
      <div className="player-hero">
        <PlayerAvatar id={player.id} name={`${player.firstName} ${player.lastName}`} color={team?.colors.primary} size="xl" />
        <span className="player-hero__number">#{player.uniformNumber || '—'}</span>
        <div>
          <h1 className="player-hero__name">
            {player.firstName} {player.lastName}
          </h1>
          <div className="player-hero__meta">
            <span>{player.position}</span>
            {team && (
              <span>
                <TeamMark team={team} size="sm" />
              </span>
            )}
            <span>{player.age} years old</span>
            <span>
              B/T {player.bats}/{player.throws}
            </span>
            <span>
              {formatPlayerHeight(player.height)} · {player.weight} lb
            </span>
            {player.hallOfFame && <span>Hall of Fame</span>}
          </div>
        </div>
        <div className="player-hero__stats">
          {isPitcher
            ? seasonPitchingTotal && (
                <>
                  <Stat label="W-L" value={`${seasonPitchingTotal.w}-${seasonPitchingTotal.l}`} />
                  <Stat label="ERA" value={pitchingRate(seasonPitchingTotal.era, seasonPitchingTotal.outs, seasonPitchingTotal.ipMissing)} />
                  <Stat label="IP" value={formatIp(seasonPitchingTotal.ip, seasonPitchingTotal.outs, seasonPitchingTotal.ipMissing)} />
                  <Stat label="K" value={String(seasonPitchingTotal.k)} />
                </>
              )
            : seasonBattingTotal && (
                <>
                  <Stat label="AVG" value={seasonBattingTotal.avg.toFixed(3).replace(/^0/, '')} />
                  <Stat label="HR" value={String(seasonBattingTotal.hr)} />
                  <Stat label="RBI" value={String(seasonBattingTotal.rbi)} />
                  <Stat label="OPS" value={seasonBattingTotal.ops.toFixed(3).replace(/^0/, '')} />
                </>
              )}
        </div>
      </div>

      <div className="grid-main" style={{ marginTop: 'var(--sp-5)' }}>
        <div className="stack">
          {!!seasonBatting.length && (
            <section className="card">
              <div className="section-head">
                <h2>Batting · {core.meta.season}</h2>
                <span className="eyebrow">Current season</span>
              </div>
              <div className="table-scroll">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Club</th>
                      <th>Lg</th>
                      <th>G</th>
                      <th>AB</th>
                      <th>R</th>
                      <th>H</th>
                      <th>HR</th>
                      <th>RBI</th>
                      <th>SB</th>
                      <th>AVG</th>
                      <th>OPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonBatting.map((line, i) => (
                      <tr key={`sb-${i}`}>
                        <td>{line.year}</td>
                        <td>{teamsById.get(line.teamId)?.abbr ?? '—'}</td>
                        <td>{leagueAbbr.get(line.leagueId) ?? line.leagueId}</td>
                        <td>{line.g}</td>
                        <td>{line.ab}</td>
                        <td>{line.r}</td>
                        <td>{line.h}</td>
                        <td>{line.hr}</td>
                        <td>{line.rbi}</td>
                        <td>{line.sb}</td>
                        <td>{line.avg.toFixed(3).replace(/^0/, '')}</td>
                        <td>{line.ops.toFixed(3).replace(/^0/, '')}</td>
                      </tr>
                    ))}
                    {!seasonBatting.length && (
                      <tr>
                        <td colSpan={12} className="muted">
                          No batting this season.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!!seasonPitching.length && (
            <section className="card">
              <div className="section-head">
                <h2>Pitching · {core.meta.season}</h2>
                <span className="eyebrow">Current season</span>
              </div>
              <div className="table-scroll">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Club</th>
                      <th>G</th>
                      <th>GS</th>
                      <th>W-L</th>
                      <th>SV</th>
                      <th>IP</th>
                      <th>H</th>
                      <th>ER</th>
                      <th>BB</th>
                      <th>K</th>
                      <th>ERA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonPitching.map((line, i) => (
                      <tr key={`sp-${i}`}>
                        <td>{line.year}</td>
                        <td>{teamsById.get(line.teamId)?.abbr ?? '—'}</td>
                        <td>{line.g}</td>
                        <td>{line.gs}</td>
                        <td>
                          {line.w}-{line.l}
                        </td>
                        <td>{line.sv}</td>
                        <td>{formatIp(line.ip, line.outs, line.ipMissing)}</td>
                        <td>{line.h}</td>
                        <td>{line.er}</td>
                        <td>{line.bb}</td>
                        <td>{line.k}</td>
                        <td>{pitchingRate(line.era, line.outs, line.ipMissing)}</td>
                      </tr>
                    ))}
                    {!seasonPitching.length && (
                      <tr>
                        <td colSpan={12} className="muted">
                          No pitching this season.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <div className="section-head">
              <h2>Career</h2>
              <span className="eyebrow">All leagues, all seasons · ~ means estimated pitching stats</span>
            </div>
            {career && (
              <div className="career-grid">
                <Cell label="Seasons" value={String(seasonsPlayed)} />
                <Cell label="AVG" value={career.avg.toFixed(3).replace(/^0/, '')} />
                <Cell label="HR" value={String(career.hr)} />
                <Cell label="RBI" value={String(career.rbi)} />
                <Cell label="H" value={String(career.h)} />
                <Cell label="OPS" value={career.ops.toFixed(3).replace(/^0/, '')} />
                <Cell label="WAR" value={career.war.toFixed(1)} />
              </div>
            )}
            {careerPitch && (
              <div className="career-grid">
                <Cell label="W-L" value={`${careerPitch.w}-${careerPitch.l}`} />
                <Cell label="ERA" value={pitchingRate(careerPitch.era, careerPitch.outs, careerPitch.ipMissing)} />
                <Cell label="IP" value={formatIp(careerPitch.ip, careerPitch.outs, careerPitch.ipMissing)} />
                <Cell label="K" value={String(careerPitch.k)} />
                <Cell label="SV" value={String(careerPitch.sv)} />
                <Cell label="WHIP" value={pitchingRate(careerPitch.whip, careerPitch.outs, careerPitch.ipMissing)} />
                <Cell label="WAR" value={careerPitch.war.toFixed(1)} />
              </div>
            )}
            {!career && !careerPitch && <div className="state">No career lines recorded.</div>}
          </section>

          {(hist?.batting.length || hist?.pitching.length) && (
            <section className="card">
              <div className="section-head">
                <h2>Year by year</h2>
                <div className="scope-chips">
                  {(['MLB', 'MINORS', 'ALL'] as const).map((option) => (
                    <button
                      key={option}
                      className={`scope-chip${scope === option ? ' scope-chip--on' : ''}`}
                      onClick={() => setScope(option)}
                    >
                      {option === 'MLB' ? 'MLB only' : option === 'MINORS' ? 'Minors' : 'Every level'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-scroll">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Club</th>
                      <th>Lg</th>
                      <th>G</th>
                      <th>AB</th>
                      <th>R</th>
                      <th>H</th>
                      <th>HR</th>
                      <th>RBI</th>
                      <th>SB</th>
                      <th>AVG</th>
                      <th>OPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {battingRows.map((line, i) => (
                      <tr key={`yb-${i}`}>
                        <td>{line.year}</td>
                        <td>{teamsById.get(line.teamId)?.abbr ?? '—'}</td>
                        <td>{leagueAbbr.get(line.leagueId) ?? line.leagueId}</td>
                        <td>{line.g}</td>
                        <td>{line.ab}</td>
                        <td>{line.r}</td>
                        <td>{line.h}</td>
                        <td>{line.hr}</td>
                        <td>{line.rbi}</td>
                        <td>{line.sb}</td>
                        <td>{line.avg.toFixed(3).replace(/^0/, '')}</td>
                        <td>{line.ops.toFixed(3).replace(/^0/, '')}</td>
                      </tr>
                    ))}
                    {!battingRows.length && (
                      <tr>
                        <td colSpan={12} className="muted">
                          No batting seasons at this level.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pitchingRows.length > 0 && (
                <div className="table-scroll">
                  <table className="stat-table">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Club</th>
                        <th>Lg</th>
                        <th>G</th>
                        <th>GS</th>
                        <th>W-L</th>
                        <th>SV</th>
                        <th>IP</th>
                        <th>ERA</th>
                        <th>WHIP</th>
                        <th>K</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pitchingRows.map((line, i) => (
                        <tr key={`yp-${i}`}>
                          <td>{line.year}</td>
                          <td>{teamsById.get(line.teamId)?.abbr ?? '—'}</td>
                          <td>{leagueAbbr.get(line.leagueId) ?? line.leagueId}</td>
                          <td>{line.g}</td>
                          <td>{line.gs}</td>
                          <td>
                            {line.w}-{line.l}
                          </td>
                          <td>{line.sv}</td>
                          <td>{formatIp(line.ip, line.outs, line.ipMissing)}</td>
                          <td>{pitchingRate(line.era, line.outs, line.ipMissing)}</td>
                          <td>{pitchingRate(line.whip, line.outs, line.ipMissing)}</td>
                          <td>{line.k}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Ratings</h2>
              <span className="eyebrow">20–80 scale</span>
            </div>
            <div className="overall-row">
              <div className="overall-cell">
                <span className="overall-cell__value">{player.ratings.overall || '—'}</span>
                <span className="overall-cell__label">Overall</span>
              </div>
              <div className="overall-cell overall-cell--pot">
                <span className="overall-cell__value">{player.ratings.potential || '—'}</span>
                <span className="overall-cell__label">Potential</span>
              </div>
              <div className="overall-cell overall-cell--gap">
                <span className="overall-cell__value">
                  {player.ratings.overall && player.ratings.potential
                    ? `+${Math.max(0, player.ratings.potential - player.ratings.overall)}`
                    : '—'}
                </span>
                <span className="overall-cell__label">Room</span>
              </div>
            </div>
            <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
              {(isPitcher
                ? [
                    ['Stuff', player.ratings.stuff],
                    ['Movement', player.ratings.movement],
                    ['Control', player.ratings.control],
                    ['Stamina', player.ratings.stamina],
                  ]
                : [
                    ['Contact', player.ratings.contact],
                    ['Gap', player.ratings.gap],
                    ['Power', player.ratings.power],
                    ['Eye', player.ratings.eye],
                    ['Speed', player.ratings.speed],
                  ]
              ).map(([label, value]) => (
                <RatingBar key={String(label)} label={String(label)} value={Number(value)} />
              ))}
            </div>
          </section>

          {player.awards.length > 0 && (
            <section className="card">
              <div className="section-head">
                <h2>Awards</h2>
                <span className="eyebrow">League history</span>
              </div>
              <div style={{ padding: 'var(--sp-2) var(--sp-4) var(--sp-4)' }}>
                {player.awards.slice(0, 8).map((award) => (
                  <div
                    key={`${award.year}-${award.label}`}
                    className="leader-row"
                    style={{ gridTemplateColumns: 'auto minmax(0,1fr)' }}
                  >
                    <span className="leader-row__value">{award.year}</span>
                    <span className="leader-row__name">{award.label}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {player.fielding.length > 0 && (
            <section className="card">
              <div className="section-head">
                <h2>Fielding</h2>
                <span className="eyebrow">Career by position</span>
              </div>
              <div className="table-scroll">
                <table className="stat-table stat-table--tight">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th className="is-num">G</th>
                      <th className="is-num">PO</th>
                      <th className="is-num">A</th>
                      <th className="is-num">E</th>
                      <th className="is-num">FPCT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {player.fielding.map((line) => (
                      <tr key={line.position}>
                        <td>{line.position}</td>
                        <td className="is-num">{line.g}</td>
                        <td className="is-num">{line.po}</td>
                        <td className="is-num">{line.a}</td>
                        <td className="is-num">{line.e}</td>
                        <td className="is-num">{line.fpct.toFixed(3).replace(/^0/, '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <div className="section-head">
              <h2>Bio</h2>
            </div>
            <div style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 'var(--fs-small)' }}>
              <BioRow label="Born" value={player.dateOfBirth} />
              <BioRow label="Experience" value={`${player.experience} seasons`} />
              {player.draftYear > 0 && (
                <BioRow label="Drafted" value={`${player.draftYear}, round ${player.draftRound} (${player.draftOverallPick} overall)`} />
              )}
              <BioRow label="OOTP ID" value={String(player.id)} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="player-hero__stat-value">{value}</div>
      <div className="player-hero__stat-label">{label}</div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="career-cell">
      <div className="career-cell__value">{value}</div>
      <div className="career-cell__label">{label}</div>
    </div>
  )
}

function RatingBar({ label, value }: { label: string; value: number }) {
  const pctWidth = Math.max(2, Math.min(100, (value / 100) * 100))
  return (
    <div className="rating">
      <span className="rating__label">{label}</span>
      <span className="rating__track">
        <span className="rating__fill" style={{ width: `${pctWidth}%` }} />
      </span>
      <span className="rating__value">{value}</span>
    </div>
  )
}

function BioRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bio-row">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  )
}
