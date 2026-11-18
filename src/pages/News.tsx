import { Link } from 'react-router-dom'
import type { MessageItem } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { shortDate, teamMap } from '../lib/selectors'
import TeamMark from '../components/ui/TeamMark'
import '../styles/pages.css'

interface StoryRow {
  gameId: number
  date: string
  awayTeamId: number
  homeTeamId: number
  awayScore: number
  homeScore: number
  headline: string
  deck: string
}

export default function News() {
  const { core } = useCore()
  const stories = useData<StoryRow[]>('mlb/story-index.json')
  const wire = useData<MessageItem[]>('messages.json')

  if (!core) return <div className="container page state">Loading the wire…</div>

  const teams = teamMap(core.teams)
  const recaps = (stories.data ?? []).slice(0, 40)
  const headlines = (wire.data ?? []).filter((item) => item.mlb).slice(0, 40)

  const byDate = new Map<string, StoryRow[]>()
  for (const recap of recaps) {
    const list = byDate.get(recap.date) ?? []
    list.push(recap)
    byDate.set(recap.date, list)
  }

  return (
    <div className="container page">
      <header className="page-header">
        <p className="eyebrow">The wire</p>
        <h1>News</h1>
        <p className="page-header__note">
          Game write-ups are composed from the play-by-play logs OOTP saves for each game. League
          headlines are the subject lines from the save's message table — OOTP writes the article
          bodies in-game and never exports them, so each headline opens what it refers to.
        </p>
      </header>

      {[...byDate.entries()].map(([date, list]) => (
        <section key={date} className="news-day">
          <div className="section-head">
            <h2>{shortDate(date)}</h2>
            <span className="eyebrow">{list.length} game{list.length === 1 ? '' : 's'}</span>
          </div>
          {list.map((recap) => {
            const away = teams.get(recap.awayTeamId)
            const home = teams.get(recap.homeTeamId)
            return (
              <Link to={`/scores/${recap.gameId}`} className="recap-row" key={recap.gameId}>
                <div className="recap-row__teams">
                  <TeamMark team={away} size="sm" />
                  <span className="recap-row__abbr">{away?.abbr ?? '—'}</span>
                  <span className="recap-row__score">
                    {recap.awayScore}–{recap.homeScore}
                  </span>
                  <span className="recap-row__abbr">{home?.abbr ?? '—'}</span>
                  <TeamMark team={home} size="sm" />
                </div>
                <div className="recap-row__text">
                  <div className="recap-row__headline">{recap.headline}</div>
                  <div className="recap-row__deck">{recap.deck}</div>
                </div>
              </Link>
            )
          })}
        </section>
      ))}

      <section className="news-day">
        <div className="section-head">
          <h2>League headlines</h2>
          <span className="eyebrow">{headlines.length} stories</span>
        </div>
        {headlines.map((item) => (
          <Link to={`/news/wire/${item.id}`} className="wire-row" key={item.id}>
            <span className="wire-row__date">{shortDate(item.date)}</span>
            <span className="wire-row__subject">{item.subject}</span>
          </Link>
        ))}
        {wire.loading && <div className="state">Loading league wire…</div>}
      </section>
    </div>
  )
}
