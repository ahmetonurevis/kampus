import { useState } from 'react'
import { isApiError } from '@kampus/api-client/errors.ts'
import type { CefrProfile } from '@kampus/react-shared/cefr.ts'
import { useCefrProfile } from '@kampus/react-shared/use-cefr.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { combineStates, DashboardGrid, ListCard } from '../dashboard/DashboardParts.tsx'
import { SummaryLoading, SummarySection } from '../management/SummaryParts.tsx'
import {
  currentLevelRows,
  estimateSkillRows,
  estimateSummary,
  levelChart,
  placementRows,
  resolveTimelineFilter,
  timelineFilterOptions,
  timelineRows,
  type LevelRow,
  type TimelineFilter,
  type TimelineRow,
} from './cefr-profile-model.ts'

/**
 * CEFR profili görünümleri (OG-054, OG-079; IST-060; DOM-DIL-010…012, DOM-BEC-034). Öğrenci ve
 * veli Akademik Gelişim sayfasında kartlarla, yönetici ve öğretmen grup özetinde panel bölümleriyle
 * görür. Kapsam ve görünüm sunucudadır: gerekçe, kararı veren ve kanıt yalnız personel yanıtında
 * gelir. Tespit oturumu açma, bölüm girişi ve karar ekranı Seviye Tespiti sayfasındadır
 * (`PlacementPage.tsx`, OG-078).
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

/**
 * Seçili becerinin seviye grafiği: yalnız gerçek karar noktaları (OG-079). Çizim süsleyicidir
 * (`aria-hidden`); aynı bilgi altındaki metinde ve listede vardır.
 */
function LevelChart({ chart }: { chart: NonNullable<ReturnType<typeof levelChart>> }) {
  const width = 240
  const height = 56
  const pad = 6
  const x = (value: number) => pad + value * (width - 2 * pad)
  const y = (value: number) => height - pad - value * (height - 2 * pad)
  const path = chart.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.x)} ${y(point.y)}`)
    .join(' ')
  return (
    <figure className="grid gap-1.5 rounded-xl border px-3.5 py-2.5">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        className="h-14 w-60 max-w-full text-primary"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
          className="stroke-border"
          strokeWidth="1"
        />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
        {chart.points.map((point) => (
          <circle key={point.key} cx={x(point.x)} cy={y(point.y)} r="3" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        <span className="sr-only">{chart.label}: </span>
        {chart.summary}
      </figcaption>
    </figure>
  )
}

function EvidenceDetails({ evidence }: { evidence: NonNullable<TimelineRow['evidence']> }) {
  return (
    <div className="grid gap-1 border-t pt-2 text-xs">
      <p className="text-muted-foreground">{evidence.suggestion}</p>
      {evidence.items.length ? (
        <details>
          <summary className="cursor-pointer font-medium text-primary">{evidence.summary}</summary>
          <ul aria-label="Kanıt görevleri" className="mt-1.5 grid gap-1.5">
            {evidence.items.map((item) => (
              <li key={item.key} className="grid">
                <span className="font-medium [overflow-wrap:anywhere]">{item.title}</span>
                <span className="text-muted-foreground [overflow-wrap:anywhere]">
                  {item.note} · <time dateTime={item.dateTime}>{item.date}</time>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-muted-foreground">{evidence.summary}</p>
      )}
    </div>
  )
}

/**
 * Seviye kararlarının zaman çizelgesi (OG-079; IST-060): beceri süzgeci, seçili becerinin mini
 * grafiği ve en yeniden eskiye karar listesi. Personel kararı vereni, gerekçeyi ve karar anının
 * kanıt görevlerini de görür; öğrenci ve veli yanıtında bunlar yoktur. Süzgeç seçimi kursiyere
 * bağlıdır: çağıran `key={profile.studentId}` verir, başka kursiyere geçince "Tümü"ne döner.
 */
function TimelineList({ profile }: { profile: CefrProfile }) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const options = timelineFilterOptions(profile)
  const active = resolveTimelineFilter(options, filter)
  const rows = timelineRows(profile, active)
  const chart = levelChart(profile, active)
  return (
    <div className="grid min-w-0 gap-3">
      {options.length ? (
        <LineTabs label="Beceri süzgeci" value={active} options={options} onChange={setFilter} />
      ) : null}
      {chart ? <LevelChart chart={chart} /> : null}
      <ol aria-label="Seviye kararları" className="grid gap-2">
        {rows.map((row) => (
          <li key={row.key} className="grid min-w-0 gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <strong className="font-medium">{row.title}</strong>
              <time dateTime={row.dateTime} className="text-xs text-muted-foreground">
                {row.date}
              </time>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{row.kind}</span>
              <StatusBadge text={row.change.label} tone={row.change.tone} />
              {row.change.detail ? <span>{row.change.detail}</span> : null}
            </span>
            {row.decidedBy !== null ? (
              <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                Karar veren: {row.decidedBy}
              </span>
            ) : null}
            {row.rationale !== null ? (
              <p className="text-sm [overflow-wrap:anywhere]">Gerekçe: {row.rationale}</p>
            ) : null}
            {row.evidence ? <EvidenceDetails evidence={row.evidence} /> : null}
          </li>
        ))}
      </ol>
    </div>
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
          {profile ? <TimelineList key={profile.studentId} profile={profile} /> : null}
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
          <TimelineList key={profile.studentId} profile={profile} />
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
