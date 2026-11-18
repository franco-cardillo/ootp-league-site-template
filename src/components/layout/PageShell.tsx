import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import DemoBanner from './DemoBanner'
import Masthead from './Masthead'
import PrimaryNav from './PrimaryNav'
import ScoreboardRail from './ScoreboardRail'
import SiteFooter from './SiteFooter'
import { useData } from '../../lib/data'
import { useCore } from '../../lib/hooks'
import { formatStamp, useLiveStamp } from '../../lib/live'
import type { ImportMeta } from '../../lib/types'
import '../../styles/layout.css'
import '../../styles/pages.css'
import '../../styles/mobile.css'
import './DemoBanner.css'

export default function PageShell({ children }: { children: ReactNode }) {
  const { core } = useCore()
  // Use the same cached metadata request as the masthead, without waiting for every core file.
  const meta = useData<ImportMeta>('meta.json')
  const { latest, stale } = useLiveStamp(core?.meta.generatedAt)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
  }, [latest?.generatedAt])

  const showBanner = stale && !dismissed

  return (
    <>
      <Masthead />
      <DemoBanner meta={meta.data} />
      <ScoreboardRail />
      <PrimaryNav />
      <main>{children}</main>

      {showBanner && (
        <div className="live-banner" role="status">
          <span className="live-banner__dot" aria-hidden="true" />
          <span className="live-banner__text">
            New sim available — {latest?.simDate} ({formatStamp(latest?.generatedAt)})
          </span>
          <button className="live-banner__button" onClick={() => window.location.reload()}>
            Load it
          </button>
          <button
            className="live-banner__dismiss"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        </div>
      )}

      <SiteFooter meta={meta.data} />
    </>
  )
}
