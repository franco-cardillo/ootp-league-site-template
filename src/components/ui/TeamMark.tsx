import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Team } from '../../lib/types'
import { readableOn } from '../../lib/selectors'

type Props = {
  team: Team | undefined
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  showCity?: boolean
  link?: boolean
}

let logoIndex: Promise<Record<string, string>> | null = null

/** Club logos are optional: they exist only if the save's image folder was supplied. */
function loadLogos(): Promise<Record<string, string>> {
  if (!logoIndex) {
    logoIndex = fetch(`${import.meta.env.BASE_URL}data/logos.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
  }
  return logoIndex
}

export default function TeamMark({ team, size = 'md', showName = true, showCity = false, link = true }: Props) {
  const [logo, setLogo] = useState<string | null>(null)
  const teamId = team?.id

  useEffect(() => {
    if (!teamId) return
    let live = true
    loadLogos().then((index) => {
      const entry = index[String(teamId)]
      if (live && entry) setLogo(`${import.meta.env.BASE_URL}data/${entry}`)
    })
    return () => {
      live = false
    }
  }, [teamId])

  if (!team) return <span className="team-chip__name">Unknown club</span>

  const content = (
    <>
      {logo ? (
        <img className={`team-logo team-logo--${size}`} src={logo} alt="" loading="lazy" />
      ) : (
        <span
          className={`team-mark team-mark--${size}`}
          style={{ background: team.colors.primary, color: readableOn(team.colors.primary) }}
          aria-hidden="true"
        >
          {team.abbr}
        </span>
      )}
      {showName && (
        <span className="team-chip__name">{showCity ? `${team.city} ${team.nickname}` : team.nickname}</span>
      )}
    </>
  )

  return link ? (
    <Link to={`/teams/${team.id}`} className="team-chip">
      {content}
    </Link>
  ) : (
    <span className="team-chip">{content}</span>
  )
}
