import { useEffect, useState } from 'react'
import { load } from './data'
import type { Division, ImportMeta, League, StandingRow, SubLeague, Team } from './types'

export interface Core {
  meta: ImportMeta
  teams: Team[]
  standings: StandingRow[]
  divisions: Division[]
  subLeagues: SubLeague[]
  leagues: League[]
}

interface CoreState {
  core: Core | null
  error: string | null
  loading: boolean
}

let corePromise: Promise<Core> | null = null

function fetchCore(): Promise<Core> {
  if (!corePromise) {
    corePromise = Promise.all([
      load<ImportMeta>('meta.json'),
      load<Team[]>('teams.json'),
      load<StandingRow[]>('mlb/standings.json'),
      load<Division[]>('divisions.json'),
      load<SubLeague[]>('sub-leagues.json'),
      load<League[]>('leagues.json'),
    ]).then(([meta, teams, standings, divisions, subLeagues, leagues]) => ({
      meta,
      teams,
      standings,
      divisions,
      subLeagues,
      leagues,
    }))
  }
  return corePromise
}

export function useCore(): CoreState {
  const [state, setState] = useState<CoreState>({ core: null, error: null, loading: true })

  useEffect(() => {
    let live = true
    fetchCore()
      .then((core) => live && setState({ core, error: null, loading: false }))
      .catch((err: Error) => live && setState({ core: null, error: err.message, loading: false }))
    return () => {
      live = false
    }
  }, [])

  return state
}
