import { Link } from 'react-router-dom'
import { useData } from '../../lib/data'
import type { ImportMeta } from '../../lib/types'

export default function Masthead() {
  const meta = useData<Pick<ImportMeta, 'season'>>('meta.json')

  return (
    <div className="masthead">
      <div className="container masthead__inner">
        <Link to="/" className="wordmark" aria-label="OOTP League Site home">
          <img
            className="wordmark__mark"
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={44}
            height={44}
            decoding="async"
          />
          <span className="wordmark__text">
            <span className="wordmark__title">OOTP League Site</span>
            <span className="wordmark__sub">Baseball league network</span>
          </span>
        </Link>

        <div className="masthead__meta">
          <span className="masthead__season">{meta.data?.season ? `${meta.data.season} Season` : 'League season'}</span>
          <label className="masthead__search">
            <span aria-hidden="true">⌕</span>
            <input type="search" placeholder="Search players, teams" aria-label="Search players and teams" />
          </label>
        </div>
      </div>
    </div>
  )
}
