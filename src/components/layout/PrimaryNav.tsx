import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/scores', label: 'Scores' },
  { to: '/standings', label: 'Standings' },
  { to: '/teams', label: 'Teams' },
  { to: '/players', label: 'Players' },
  { to: '/prospects', label: 'Prospects' },
  { to: '/statistics', label: 'Statistics' },
  { to: '/history', label: 'History' },
  { to: '/watchlist', label: 'My Watchlist' },
]

export default function PrimaryNav() {
  return (
    <nav className="nav" aria-label="Primary">
      <div className="container nav__inner">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
