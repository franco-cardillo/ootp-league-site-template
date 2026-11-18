import { readFileSync } from 'node:fs'

/** IDs and affiliations belong to the source report's snapshot; they are not trusted join keys. */
export interface BnnEntry {
  rank: number
  name: string
  reportPlayerId: number
  organizationId: number
  organization: string
  age: number
  position: string
  level: string
}

export interface BnnSnapshot {
  schemaVersion: 1
  reportDate: string
  /** Optional for legacy reports; newly extracted reports include the primary league. */
  leagueId?: number
  source: string
  sourceSha256: string
  note: string
  entries: BnnEntry[]
}

export interface BnnCandidate {
  id: number
  name: string
  age: number
  position: string
  orgId: number
  orgCity: string
}

export interface BnnIssue {
  entry: BnnEntry
  reason: string
  candidateIds?: number[]
}

export interface BnnMatches {
  byPlayerId: Map<number, BnnEntry>
  unmatched: BnnIssue[]
  ambiguous: BnnIssue[]
}

/** Ignore case, accents, spaces and punctuation, but never discard name components or suffixes. */
export function normalizeBnnName(name: string): string {
  return name.normalize('NFKD').toLocaleLowerCase('en-US').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
}

export function loadBnnSnapshot(path: string): BnnSnapshot {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!data || typeof data !== 'object') throw new Error('Invalid BNN snapshot: expected an object')
  const s = data as BnnSnapshot
  if (s.schemaVersion !== 1 || !validDate(s.reportDate) || typeof s.source !== 'string' || !s.source.trim() ||
      (s.leagueId !== undefined && (!Number.isSafeInteger(s.leagueId) || s.leagueId <= 0)) ||
      typeof s.note !== 'string' || !s.note.trim() || typeof s.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(s.sourceSha256) || !Array.isArray(s.entries)) {
    throw new Error('Invalid BNN snapshot metadata')
  }
  if (s.entries.length !== 100) throw new Error('Invalid BNN snapshot: expected exactly 100 entries')
  const ranks = new Set<number>()
  const ids = new Set<number>()
  for (const entry of s.entries) {
    if (!entry || !Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > 100 || ranks.has(entry.rank) ||
        typeof entry.name !== 'string' || !normalizeBnnName(entry.name) ||
        !Number.isInteger(entry.reportPlayerId) || entry.reportPlayerId <= 0 || ids.has(entry.reportPlayerId) ||
        !Number.isInteger(entry.organizationId) || entry.organizationId <= 0 ||
        typeof entry.organization !== 'string' || !entry.organization.trim() ||
        !Number.isInteger(entry.age) || entry.age <= 0 ||
        typeof entry.position !== 'string' || !entry.position.trim() || typeof entry.level !== 'string') {
      throw new Error(`Invalid or duplicate BNN snapshot entry: ${JSON.stringify(entry)}`)
    }
    ranks.add(entry.rank)
    ids.add(entry.reportPlayerId)
  }
  return { ...s, entries: [...s.entries].sort((a, b) => a.rank - b.rank) }
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

function isPitcher(position: string): boolean {
  return ['P', 'SP', 'RP', 'CL'].includes(position.toUpperCase())
}

/**
 * Match on the complete normalized name, consistent age and pitcher/batter category. For duplicate
 * names, report organization ID AND city can break ties; if no unique candidate remains, abstain.
 * Report player IDs are never used to select a match, even if they happen to agree. This protects
 * against a reused ID belonging to a different player in another export. No fuzzy names or suffix
 * removal. Age must move in the correct direction between dates, allowing birthdays in the gap.
 */
export function matchBnn(snapshot: BnnSnapshot, candidates: BnnCandidate[], simDate: string): BnnMatches {
  if (!validDate(simDate) || !validDate(snapshot.reportDate)) throw new Error('Cannot safely match BNN identities without valid snapshot and CSV dates')
  const dateDelta = Date.parse(simDate) - Date.parse(snapshot.reportDate)
  const ageTolerance = Math.ceil(Math.abs(dateDelta) / (365 * 86400_000))
  const byName = new Map<string, BnnCandidate[]>()
  for (const candidate of candidates) {
    const key = normalizeBnnName(candidate.name)
    const list = byName.get(key) ?? []
    if (!list.some((c) => c.id === candidate.id)) list.push(candidate)
    byName.set(key, list)
  }
  const unmatched: BnnIssue[] = []
  const ambiguous: BnnIssue[] = []
  const proposals = new Map<number, BnnEntry[]>()
  for (const entry of snapshot.entries) {
    const named = byName.get(normalizeBnnName(entry.name)) ?? []
    const compatible = named.filter((c) => {
      const ageDelta = c.age - entry.age
      const plausibleAge = dateDelta < 0 ? ageDelta <= 0 && ageDelta >= -ageTolerance : ageDelta >= 0 && ageDelta <= ageTolerance
      return Number.isFinite(c.age) && c.age > 0 && plausibleAge && isPitcher(c.position) === isPitcher(entry.position)
    })
    if (!compatible.length) {
      unmatched.push({ entry, reason: named.length ? 'name found, but age or pitcher/batter category conflicts' : 'no exact normalized name' })
      continue
    }
    let choices = compatible
    if (choices.length > 1) {
      const sameOrg = choices.filter((c) => c.orgId === entry.organizationId &&
        normalizeBnnName(c.orgCity) === normalizeBnnName(entry.organization))
      if (sameOrg.length) choices = sameOrg
    }
    if (choices.length !== 1) {
      ambiguous.push({ entry, reason: 'multiple name/age/role matches could not be distinguished safely', candidateIds: choices.map((c) => c.id) })
      continue
    }
    const chosen = choices[0]
    const list = proposals.get(chosen.id) ?? []
    list.push(entry)
    proposals.set(chosen.id, list)
  }
  const byPlayerId = new Map<number, BnnEntry>()
  for (const [id, entries] of proposals) {
    if (entries.length === 1) byPlayerId.set(id, entries[0])
    else for (const entry of entries) ambiguous.push({ entry, reason: 'multiple report entries resolve to the same player', candidateIds: [id] })
  }
  return { byPlayerId, unmatched, ambiguous }
}
