import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { BoxScore, BoxTeam, GameStory } from '../lib/types'
import { useCore } from '../lib/hooks'
import { shortDate, teamMap } from '../lib/selectors'
import TeamMark from '../components/ui/TeamMark'

const base = import.meta.env.BASE_URL

async function loadBox(gameId: number): Promise<BoxScore | null> {
  const index: Record<string, string> = await fetch(`${base}data/mlb/boxscore-index.json`).then((r) =>
    r.ok ? r.json() : {},
  )
  const date = index[String(gameId)]
  if (!date) return null
  const games: BoxScore[] = await fetch(`${base}data/mlb/boxscores/${date}.json`).then((r) => r.json())
  return games.find((g) => g.gameId === gameId) ?? null
}

function TeamBox({ side, box }: { side: BoxTeam; box: BoxScore }) {
  const won = side.runs > (side.teamId === box.home.teamId ? box.away.runs : box.home.runs)
  return (
    <section className="box-team">
      <div className="box-team__head">
        <h2>
          {side.city} {side.nickname}
        </h2>
        <span className={`box-team__runs ${won ? 'box-team__runs--win' : ''}`}>{side.runs}</span>
      </div>

      <table className="stat-table stat-table--tight">
        <thead>
          <tr>
            <th>Batting</th>
            <th className="is-num">AB</th>
            <th className="is-num">R</th>
            <th className="is-num">H</th>
            <th className="is-num">RBI</th>
            <th className="is-num">BB</th>
            <th className="is-num">K</th>
          </tr>
        </thead>
        <tbody>
          {side.batting.map((bat) => (
            <tr key={`b-${bat.playerId}`}>
              <td>
                <Link to={`/players/${bat.playerId}`} className="player-cell">
                  <span className="box-pos">{bat.pos}</span>
                  <span>{bat.name}</span>
                </Link>
                {bat.hr > 0 && <span className="box-note"> {bat.hr} HR</span>}
              </td>
              <td className="is-num">{bat.ab}</td>
              <td className="is-num">{bat.r}</td>
              <td className="is-num">{bat.h}</td>
              <td className="is-num">{bat.rbi}</td>
              <td className="is-num">{bat.bb}</td>
              <td className="is-num">{bat.k}</td>
            </tr>
          ))}
          <tr className="box-total">
            <td>Totals</td>
            <td className="is-num">{side.batting.reduce((n, b) => n + b.ab, 0)}</td>
            <td className="is-num">{side.runs}</td>
            <td className="is-num">{side.hits}</td>
            <td className="is-num">{side.batting.reduce((n, b) => n + b.rbi, 0)}</td>
            <td className="is-num">{side.batting.reduce((n, b) => n + b.bb, 0)}</td>
            <td className="is-num">{side.batting.reduce((n, b) => n + b.k, 0)}</td>
          </tr>
        </tbody>
      </table>

      <table className="stat-table stat-table--tight">
        <thead>
          <tr>
            <th>Pitching</th>
            <th className="is-num">IP</th>
            <th className="is-num">H</th>
            <th className="is-num">R</th>
            <th className="is-num">ER</th>
            <th className="is-num">BB</th>
            <th className="is-num">K</th>
          </tr>
        </thead>
        <tbody>
          {side.pitching.map((pit) => (
            <tr key={`p-${pit.playerId}`}>
              <td>
                <Link to={`/players/${pit.playerId}`} className="player-cell">
                  <span>{pit.name}</span>
                </Link>
                {pit.gs === 1 && <span className="box-note"> started</span>}
              </td>
              <td className="is-num">{pit.ip.toFixed(1)}</td>
              <td className="is-num">{pit.h}</td>
              <td className="is-num">{pit.r}</td>
              <td className="is-num">{pit.er}</td>
              <td className="is-num">{pit.bb}</td>
              <td className="is-num">{pit.k}</td>
            </tr>
          ))}
          {!side.pitching.length && (
            <tr>
              <td colSpan={7} className="muted">
                No pitching lines recorded for this game.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

export default function GameBox() {
  const { gameId } = useParams()
  const id = Number(gameId)
  const { core } = useCore()
  const [box, setBox] = useState<BoxScore | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [story, setStory] = useState<GameStory | null>(null)
  useEffect(() => {
    if (!box) return
    let active = true
    const month = (box.date ?? '').slice(0, 7)
    fetch(`${base}data/mlb/stories/${month}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, GameStory> | null) => {
        if (active) setStory(data ? data[String(id)] ?? null : null)
      })
      .catch(() => {
        if (active) setStory(null)
      })
    return () => {
      active = false
    }
  }, [box, id])

  useEffect(() => {
    let live = true
    setStatus('loading')
    loadBox(id)
      .then((found) => {
        if (!live) return
        if (found) {
          setBox(found)
          setStatus('ready')
        } else setStatus('missing')
      })
      .catch(() => live && setStatus('missing'))
    return () => {
      live = false
    }
  }, [id])

  if (status === 'loading') return <div className="container page state">Loading box score…</div>
  if (status === 'missing' || !box)
    return <div className="container page state state--error">No box score recorded for that game.</div>

  const teamsById = core ? teamMap(core.teams) : new Map()
  const away = teamsById.get(box.away.teamId)
  const home = teamsById.get(box.home.teamId)

  return (
    <div className="container page">
      <div className="boxscore-head">
        <div className="boxscore-head__side">
          <TeamMark team={away} size="lg" />
        </div>
        <div className="boxscore-head__score">
          <span>{box.away.runs}</span>
          <span className="boxscore-head__dash">–</span>
          <span>{box.home.runs}</span>
          <div className="boxscore-head__meta">
            Final{box.innings > 9 ? ` (${box.innings})` : ''} · {shortDate(box.date)}
          </div>
        </div>
        <div className="boxscore-head__side boxscore-head__side--right">
          <TeamMark team={home} size="lg" />
        </div>
      </div>

      {story && (
        <section className="story">
          <div className="story__kicker">The story</div>
          <h2 className="story__headline">{story.headline}</h2>
          <p className="story__deck">{story.deck}</p>
          {story.body.map((paragraph, i) => (
            <p className="story__body" key={i}>
              {paragraph}
            </p>
          ))}
        </section>
      )}

      <table className="stat-table stat-table--tight" style={{ marginBottom: 'var(--sp-5)' }}>
        <thead>
          <tr>
            <th>Line score</th>
            <th className="is-num">R</th>
            <th className="is-num">H</th>
            <th className="is-num">E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{box.away.city} {box.away.nickname}</td>
            <td className="is-num">{box.away.runs}</td>
            <td className="is-num">{box.away.hits}</td>
            <td className="is-num">{box.away.errors}</td>
          </tr>
          <tr>
            <td>{box.home.city} {box.home.nickname}</td>
            <td className="is-num">{box.home.runs}</td>
            <td className="is-num">{box.home.hits}</td>
            <td className="is-num">{box.home.errors}</td>
          </tr>
        </tbody>
      </table>

      <TeamBox side={box.away} box={box} />
      <TeamBox side={box.home} box={box} />

      <p className="muted" style={{ fontSize: 12, marginTop: 'var(--sp-4)' }}>
        Batting and pitching lines come straight from the export's per-game tables. OOTP writes team
        runs, hits and errors but no inning-by-inning line, so the line score is R/H/E.
        {box.attendance ? ` Attendance ${box.attendance.toLocaleString()}.` : ''}
      </p>

      <Link to="/scores" className="link-quiet">
        ← All scores
      </Link>
    </div>
  )
}
