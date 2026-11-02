import { isApiError } from '@kampus/api-client/errors.ts'
import type { CefrProfile } from '@kampus/react-shared/cefr.ts'
import { useCefrProfile } from '@kampus/react-shared/use-cefr.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { combineStates, DashboardGrid, ListCard } from '../dashboard/DashboardParts.tsx'
import { SummaryLoading, SummarySection } from '../management/SummaryParts.tsx'
import {
  currentLevelRows,
  estimateSkillRows,
  estimateSummary,
  placementRows,
  timelineRows,
  type LevelRow,
} from './cefr-profile-model.ts'

/**
 * CEFR profili görünümleri (OG-054; IST-060; DOM-DIL-010…012, DOM-BEC-034). Öğrenci ve veli
 * Akademik Gelişim sayfasında kartlarla, yönetici ve öğretmen grup özetinde panel bölümleriyle
 * görür. Kapsam ve görünüm sunucudadır: gerekçe yalnız personel yanıtında gelir.
 * TODO(cefr-tespit-ekrani): tespit oturumu açma, bölüm girişi ve karar ekranı sonraki adımdır;
 * kancalar `@kampus/react-shared/use-cefr.ts`'te hazırdır.
 */

function LevelList({ label, rows }: { label: string; rows: readonly LevelRow[] }) {
  return (
    <ul aria-label={label} className="grid gap-2">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
        >
          <span className="grid min-w-0">
            <strong className="font-medium">{row.label}</strong>
            <span className="text-xs text-muted-foreground">{row.note}</span>
          </span>
          <span className="shrink-0 text-base font-semibold">{row.level}</span>
        </li>
      ))}
    </ul>
  )
}

function EstimateBlock({ profile }: { profile: CefrProfile }) {
  const summary = estimateSummary(profile.estimate)
  const skills = estimateSkillRows(profile.estimate)
  return (
    <div className="grid gap-3">
      <p className="grid rounded-xl border px-3.5 py-2.5 text-sm">
        <span className="text-xs text-muted-foreground">{profile.estimate.label}</span>
        <strong className="text-base font-semibold">{summary.level}</strong>
        <span className="text-xs text-muted-foreground">{summary.note}</span>
      </p>
      {skills.length ? <LevelList label="Beceri bazında tahmini seviye" rows={skills} /> : null}
    </div>
  )
}

function PlacementList({ profile }: { profile: CefrProfile }) {
  return (
    <ul aria-label="Seviye tespitleri" className="grid gap-2">
      {placementRows(profile).map((row) => (
        <li key={row.key} className="grid gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <strong className="font-medium">{row.date}</strong>
            <StatusBadge text={row.status} tone={row.tone} />
          </span>
          <span className="text-xs text-muted-foreground">
            {row.mode}
            {row.until ? ` · ${row.until}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

function TimelineList({ profile }: { profile: CefrProfile }) {
  return (
    <ol aria-label="Seviye kararları" className="grid gap-2">
      {timelineRows(profile).map((row) => (
        <li key={row.key} className="grid gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <strong className="font-medium">{row.title}</strong>
            <span className="text-xs text-muted-foreground">{row.date}</span>
          </span>
          <span className="text-xs text-muted-foreground">{row.kind}</span>
          {row.rationale !== null ? (
            <p className="text-sm [overflow-wrap:anywhere]">Gerekçe: {row.rationale}</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

const EMPTY = {
  current: 'Henüz seviye kararı yok.',
  placements: 'Henüz seviye tespiti yok.',
  timeline: 'Seviye kararı geçmişi yok.',
} as const

/** Öğrenci ve veli: Akademik Gelişim sayfasındaki CEFR kartları (dil okulu). */
export function CefrProfileCards({ studentId }: { studentId: string }) {
  const query = useCefrProfile(studentId)
  const state = combineStates(query)
  const profile = query.data
  return (
    <>
      <DashboardGrid>
        <ListCard
          title="Güncel seviye"
          description="Öğretmen kararıyla belirlenen CEFR seviyeleri"
          state={state}
          isEmpty={!profile?.current.length}
          emptyText={EMPTY.current}
        >
          {profile ? <LevelList label="Güncel seviyeler" rows={currentLevelRows(profile)} /> : null}
        </ListCard>
        <ListCard
          title="Tahmini seviye"
          description="Tespit sonuçlarından hesaplanır"
          state={state}
          isEmpty={false}
          emptyText=""
        >
          {profile ? <EstimateBlock profile={profile} /> : null}
        </ListCard>
      </DashboardGrid>
      <DashboardGrid>
        <ListCard
          title="Seviye geçmişi"
          description="Yerleştirme, kur geçişi ve düzeltme kararları"
          state={state}
          isEmpty={!profile?.timeline.length}
          emptyText={EMPTY.timeline}
        >
          {profile ? <TimelineList profile={profile} /> : null}
        </ListCard>
        <ListCard
          title="Seviye tespitleri"
          description="Sonuç 90 gün geçerlidir"
          state={state}
          isEmpty={!profile?.placements.length}
          emptyText={EMPTY.placements}
        >
          {profile ? <PlacementList profile={profile} /> : null}
        </ListCard>
      </DashboardGrid>
    </>
  )
}

/**
 * Yönetici ve öğretmen: grup özetindeki kursiyerin profili. Öğretmenin grubunda olmayan öğrenci
 * sunucuda 404'tür ve "görüntülenemiyor" gösterilir.
 */
export function CefrProfileSummary({ studentId }: { studentId: string }) {
  const query = useCefrProfile(studentId)
  if (query.error)
    return isApiError(query.error) && query.error.status === 404 ? (
      <EmptyState
        icon="UsersRound"
        title="Profil görüntülenemiyor."
        description="Bu kursiyer kapsamınızda değil veya kayıt artık mevcut değil."
      />
    ) : (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    )
  const profile = query.data
  if (!profile) return <SummaryLoading />
  return (
    <>
      <SummarySection title="Güncel seviye">
        {profile.current.length ? (
          <LevelList label="Güncel seviyeler" rows={currentLevelRows(profile)} />
        ) : (
          <p className="text-sm text-muted-foreground">{EMPTY.current}</p>
        )}
      </SummarySection>
      <SummarySection title="Tahmini seviye">
        <EstimateBlock profile={profile} />
      </SummarySection>
      <SummarySection title="Seviye geçmişi">
        {profile.timeline.length ? (
          <TimelineList profile={profile} />
        ) : (
          <p className="text-sm text-muted-foreground">{EMPTY.timeline}</p>
        )}
      </SummarySection>
      <SummarySection title="Seviye tespitleri">
        {profile.placements.length ? (
          <PlacementList profile={profile} />
        ) : (
          <p className="text-sm text-muted-foreground">{EMPTY.placements}</p>
        )}
      </SummarySection>
    </>
  )
}
