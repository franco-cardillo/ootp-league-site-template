import { Link } from 'react-router-dom'
import type { Game, Leaders, MessageItem, NewsItem, Prospect } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { latestPlayedDate, shortDate, teamMap } from '../lib/selectors'
import { buildHomeFeatures } from '../lib/homeFeatures'
import TeamMark from '../components/ui/TeamMark'
import PlayerAvatar from '../components/ui/PlayerAvatar'
import '../styles/home.css'

const KIND_LABEL: Record<NewsItem['kind'], string> = {
  blowout: 'Final score',
  performance: 'Performance',
  power: 'Home runs',
  shutout: 'Shutout',
  streak: 'Streak',
  race: 'Pennant race',
}

export default function Home() {
  const { core, loading, error } = useCore()
  const news = useData<NewsItem[]>('news.json')
  const games = useData<Game[]>('mlb/games.json')
  const leaders = useData<Leaders>('mlb/leaders.json')
  const prospects = useData<Prospect[]>('prospects.json')
  const messages = useData<MessageItem[]>('messages.json')

  if (loading) return <div className="container page state">Loading league data…</div>
  if (error || !core) return <div className="container page state state--error">Could not load league data: {error}</div>

  const { meta, teams } = core
  const teamsById = teamMap(teams)
  const items = news.data ?? []
  const lead = items[0]
  const features = buildHomeFeatures(leaders.data, news.data ?? [], prospects.data ?? [], meta.simDate)
  const featureLoading = news.loading || leaders.loading
  const secondary = (features.lead
    ? items.filter((item) => item.id !== features.lead?.sourceNewsId)
    : items.slice(1)).slice(0, 2)
  const wires = (messages.data ?? []).slice(0, 12)

  const latest = games.data ? latestPlayedDate(games.data.filter((game) => !meta.simDate || game.date <= meta.simDate)) : null
  const today = latest && games.data ? games.data.filter((g) => g.played && g.date === latest) : []

  return (
    <div className="container page">
      <div className="home-grid">
        <aside className="home-col home-col--scores">
          <div className="col-head">
            <h2>Box scores</h2>
            <span className="col-head__meta">{latest ? shortDate(latest) : '—'}</span>
          </div>
          {today.map((game) => {
            const away = teamsById.get(game.awayTeamId)
            const home = teamsById.get(game.homeTeamId)
            const awayWon = game.awayScore > game.homeScore
            return (
              <Link to={`/scores/${game.id}`} className="box box--link" key={game.id}>
                <div className={`box__row ${awayWon ? 'box__row--win' : ''}`}>
                  <TeamMark team={away} size="sm" showCity link={false} />
                  <span className="box__score">{game.awayScore}</span>
                </div>
                <div className={`box__row ${!awayWon ? 'box__row--win' : ''}`}>
                  <TeamMark team={home} size="sm" showCity link={false} />
                  <span className="box__score">{game.homeScore}</span>
                </div>
                <div className="box__meta">
                  Final{game.innings > 9 ? ` / ${game.innings}` : ''} · {game.awayHits}H–{game.awayErrors}E /{' '}
                  {game.homeHits}H–{game.homeErrors}E
                </div>
              </Link>
            )
          })}
          {!today.length && <div className="state">{games.loading ? 'Loading scores…' : 'No games yet.'}</div>}
          <Link to="/scores" className="col-link">
            All scores →
          </Link>
        </aside>

        <main className="home-col home-col--lead">
          {featureLoading ? (
            <div className="state">Loading league stories…</div>
          ) : features.lead ? (
            <article className="home-feature">
              <Link to={features.lead.href} className="home-feature__link">
                <div className="home-feature__topline">
                  <span>In the spotlight</span>
                  <span>{features.lead.sourceLabel}</span>
                </div>
                <div className="home-feature__body">
                  <div className="home-feature__copy">
                    <p className="home-feature__label">{features.lead.label}</p>
                    <h1 className="home-feature__title">{features.lead.headline}</h1>
                    <p className="home-feature__summary">{features.lead.summary}</p>
                    {features.lead.stats.length > 0 && (
                      <div className="home-feature__stats" aria-label="Key statistics">
                        {features.lead.stats.map((stat) => (
                          <div className="home-feature__stat" key={`${stat.label}-${stat.value}`}>
                            <span className="home-feature__stat-value">{stat.value}</span>
                            <span className="home-feature__stat-label">{stat.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <span className="home-feature__cta">View player profile <span aria-hidden="true">→</span></span>
                  </div>
                  <div className="home-feature__identity">
                    <div className="home-feature__portrait" aria-hidden="true">
                      <PlayerAvatar
                        id={features.lead.playerId}
                        name={features.lead.name}
                        color={teamsById.get(features.lead.teamId)?.colors.primary}
                        size="xl"
                      />
                    </div>
                    <div className="home-feature__identity-copy">
                      <div className="home-feature__player-name">{features.lead.name}</div>
                      <TeamMark team={teamsById.get(features.lead.teamId)} size="sm" showCity link={false} />
                    </div>
                  </div>
                </div>
              </Link>
            </article>
          ) : lead ? (
            <article>
              <Link to={lead.link} className="lead__fallback-link">
                <div className="lead__art" aria-hidden="true">
                  <img src={`${import.meta.env.BASE_URL}art/lead-neutral.svg`} alt="" width={960} height={540} />
                  <div className="lead__art-caption">
                    <span className="lead__art-kicker">Around the league</span>
                    <span className="lead__art-title">Baseball<br />notebook</span>
                  </div>
                </div>
                <p className="kicker">
                  {KIND_LABEL[lead.kind]} · {lead.date ? shortDate(lead.date) : `${meta.season} season`}
                </p>
                <h1 className="lead__title">{lead.headline}</h1>
                <p className="lead__deck">{lead.deck}</p>
              </Link>
              <div className="lead__teams">
                {lead.teamIds.map((teamId) => (
                  <TeamMark key={teamId} team={teamsById.get(teamId)} size="sm" />
                ))}
              </div>
            </article>
          ) : (
            <div className="state">{news.loading ? 'Loading news…' : 'No stories yet.'}</div>
          )}

          {!featureLoading && secondary.length > 0 && (
            <div className="secondary">
              {secondary.map((item) => (
                <Link to={item.link} className="secondary__item" key={item.id}>
                  <p className="kicker">{KIND_LABEL[item.kind]}</p>
                  <h3 className="secondary__title">{item.headline}</h3>
                  <p className="secondary__deck">{item.deck}</p>
                </Link>
              ))}
            </div>
          )}

          {features.stars.length > 0 && (
            <section className="home-stars" aria-labelledby="home-stars-title">
              <div className="home-stars__heading">
                <div>
                  <p className="home-stars__eyebrow">Around the league</p>
                  <h2 id="home-stars-title">Stars of the League</h2>
                </div>
                <span className="home-stars__heading-note">Players to watch</span>
              </div>
              <div className="home-stars__grid">
                {features.stars.map((star) => {
                  const team = teamsById.get(star.teamId)
                  return (
                    <Link to={star.href} className="home-star" key={star.playerId}>
                      <span className="home-star__stripe" style={{ backgroundColor: team?.colors.primary || '#739b97' }} aria-hidden="true" />
                      <span className="home-star__label">{star.label}</span>
                      <span className="home-star__person">
                        <span className="home-star__portrait" aria-hidden="true">
                          <PlayerAvatar id={star.playerId} name={star.name} color={team?.colors.primary} size="lg" />
                        </span>
                        <span className="home-star__person-copy">
                          <span className="home-star__name">{star.name}</span>
                          <span className="home-star__team">{team ? `${team.city} ${team.nickname}` : 'League player'}</span>
                        </span>
                      </span>
                      {star.stats.length > 0 && (
                        <span className="home-star__stats">
                          {star.stats.slice(0, 2).map((stat) => (
                            <span className="home-star__stat" key={`${stat.label}-${stat.value}`}>
                              <strong>{stat.value}</strong> {stat.label}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="home-star__reason">{star.summary}</span>
                      <span className="home-star__cta">View profile <span aria-hidden="true">↗</span></span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          <section className="card" style={{ marginTop: 'var(--sp-5)' }}>
            <div className="section-head">
              <h2>Top prospects</h2>
              <Link to="/prospects" className="link-quiet">
                Full board →
              </Link>
            </div>
            <div className="home-prospects-scroll">
              <table className="stat-table">
                <thead>
                  <tr>
                    <th>Board #</th>
                    <th>Player</th>
                    <th>Org</th>
                    <th>Level</th>
                    <th>Age</th>
                    <th className="is-num">Pot.</th>
                  </tr>
                </thead>
                <tbody>
                  {(prospects.data ?? []).slice(0, 5).map((prospect) => {
                    const org = teamsById.get(prospect.orgId)
                    return (
                      <tr key={prospect.id}>
                        <td>{prospect.rank}</td>
                        <td>
                          <Link to={`/prospects/${prospect.id}`} className="player-cell">
                            <PlayerAvatar id={prospect.id} name={prospect.name} color={org?.colors.primary} size="sm" />
                            <span>{prospect.name}</span>
                          </Link>
                        </td>
                        <td>{prospect.orgAbbr}</td>
                        <td>{prospect.leagueAbbr || `Lvl ${prospect.level}`}</td>
                        <td>{prospect.age}</td>
                        <td className="is-num">{prospect.potential}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <aside className="home-col home-col--news">
          <div className="col-head">
            <h2>The latest</h2>
          </div>
          {wires.map((wire) => {
            const href = `/news/wire/${wire.id}`
            return (
              <Link to={href} className="news-item" key={`${wire.id}-${wire.date}`}>
                <div className="news-item__head">{wire.subject}</div>
                <div className="news-item__meta">{shortDate(wire.date)}</div>
              </Link>
            )
          })}
          {messages.loading && <div className="state">Loading league wire…</div>}
          {!wires.length && !messages.loading && <div className="state">No wire stories yet.</div>}

          <div className="col-head" style={{ marginTop: 'var(--sp-5)' }}>
            <h2>Leaders</h2>
          </div>
          {(leaders.data?.batting.hr ?? []).slice(0, 3).map((row) => (
            <Link to={`/players/${row.playerId}`} className="leader-row" key={`hr-${row.playerId}`}>
              <span className="leader-row__rank">{row.rank}</span>
              <span className="leader-row__name">{row.name}</span>
              <span className="leader-row__value">{row.value}</span>
            </Link>
          ))}
          {(leaders.data?.pitching.era ?? []).slice(0, 3).map((row) => (
            <Link to={`/players/${row.playerId}`} className="leader-row" key={`era-${row.playerId}`}>
              <span className="leader-row__rank">{row.rank}</span>
              <span className="leader-row__name">{row.name}</span>
              <span className="leader-row__value">{row.value.toFixed(2)}</span>
            </Link>
          ))}
        </aside>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 'var(--sp-4)' }}>
        {meta.season} season · sim date {shortDate(meta.simDate)} · {meta.counts.games.toLocaleString()} games and{' '}
        {meta.counts.mlbPlayers.toLocaleString()} MLB players from your OOTP export.
      </p>
    </div>
  )
}
