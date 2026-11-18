import { Link, useParams } from 'react-router-dom'
import type { MessageItem } from '../lib/types'
import { useData } from '../lib/data'
import { useCore } from '../lib/hooks'
import { shortDate, teamMap } from '../lib/selectors'
import TeamMark from '../components/ui/TeamMark'
import '../styles/pages.css'

export default function WireItem() {
  const { messageId } = useParams()
  const id = Number(messageId)
  const { core } = useCore()
  const wire = useData<MessageItem[]>('messages.json')

  if (!core) return <div className="container page state">Loading…</div>

  const item = (wire.data ?? []).find((row) => row.id === id)
  if (!item) {
    return (
      <div className="container page state">
        {wire.loading ? 'Loading story…' : `No headline with id ${id} in this export.`}
      </div>
    )
  }

  const teams = teamMap(core.teams)
  const team = item.teamId ? teams.get(item.teamId) : undefined

  return (
    <div className="container page">
      <p className="eyebrow">{shortDate(item.date)} · League wire</p>
      <h1 className="wire-headline">{item.subject}</h1>
      <p className="wire-note">
        This dispatch was filed without a written story. The parties involved are below.
      </p>

      {team && (
        <section className="card" style={{ maxWidth: '42rem' }}>
          <div className="section-head">
            <h2>Club</h2>
          </div>
          <Link to={`/teams/${team.id}`} className="wire-entity">
            <TeamMark team={team} size="md" />
          </Link>
        </section>
      )}

      {item.playerId && (
        <section className="card" style={{ maxWidth: '42rem' }}>
          <div className="section-head">
            <h2>Player</h2>
          </div>
          <Link to={`/players/${item.playerId}`} className="wire-entity">
            {item.playerName ?? 'Player profile'}
          </Link>
        </section>
      )}

      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link className="link-quiet" to="/news">
          ← All news
        </Link>
      </p>
    </div>
  )
}
