import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useProspectSeasonWatch } from '@kampus/react-shared/use-prospect-season-watch.ts'
import { dateLabel, number } from '@kampus/school-core/lib/format.ts'
import { prospectStageLabel } from '@kampus/school-core/lib/prospects.ts'
import {
  SEASON_FOLLOW_UP_REASONS,
  SEASON_WATCH_DAYS,
  type SeasonFollowUpReason,
} from '@kampus/school-core/lib/prospect-season-watch.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { RoleKey } from '@/lib/navigation.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import {
  followUpLabel,
  followUpSince,
  followUpTone,
  meetingTitle,
  SEASON_DAY_OPTIONS,
  SEASON_DAYS_PARAM,
  seasonDays,
  trialResultNote,
  windowText,
} from './prospect-season-watch.ts'
import { slotLabel, stageTone } from './prospect-rows.ts'

const DAY = { weekday: 'long', year: 'numeric' } as const
const ROW_PAGE = 10

type MeetingRow = {
  id: string
  prospectId: string
  name: string
  stage: string
  stageLabel: string
  branchName: string | null
  dayLabel: string
  timeRange: string
  place: string
  held: boolean
}
type TrialRow = MeetingRow & { resultRecorded: boolean }
type FollowUpRow = {
  id: string
  prospectId: string
  name: string
  stage: string
  stageLabel: string
  branchName: string | null
  reason: SeasonFollowUpReason
  since: string
  note: string | null
}

const keysOf = (columns: readonly { key: string }[]) => columns.map((column) => column.key)

/** Bölüm başlığı ve açıklaması; tam liste Aday Öğrenciler ve görüşme listesindedir. */
function WatchPart({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <header className="grid gap-0.5">
        <h3 id={id} className="text-base font-semibold">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  )
}

/** Adayı açan bağlantı düğmesi (satır işlemi). */
function OpenProspect({ role, row }: { role: RoleKey; row: { prospectId: string; name: string } }) {
  return (
    <Button variant="secondary" size="sm" asChild>
      <Link
        to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}
        aria-label={`${row.name} adayını aç`}
      >
        Aday
      </Link>
    </Button>
  )
}

function NameLink({ role, row }: { role: RoleKey; row: { prospectId: string; name: string } }) {
  return (
    <Link
      to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}
      className="record-link font-medium text-primary hover:underline"
    >
      {row.name}
    </Link>
  )
}

/**
 * Kayıt sezonu nöbeti (Tanışma Görüşmeleri `?gorunum=nobet`; DOM-KAY-037, ON-077; IST-079,
 * IST-091): bugün ve yakın günlerdeki tanışma görüşmeleri, dil okulunda deneme dersleri ve geciken
 * takipler tek görünümde. Pencere adreste (`?gun=`, varsayılan 7 gün). Satırlar aday detayına
 * bağlanır; satır iletişim bilgisi taşımaz, arama ve not detaydadır. Bölge etiketi sayfanın
 * panelindedir (`MeetingsPage`, `sezon-nobeti-baslik`).
 */
export function ProspectSeasonWatchSection({
  role,
  type,
}: {
  role: RoleKey
  type: InstitutionType
}) {
  const [params, setParams] = useSearchParams()
  const days = seasonDays(params.get(SEASON_DAYS_PARAM))
  const query = useProspectSeasonWatch(days)
  const data = query.data?.data

  const setDays = (value: number) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === SEASON_WATCH_DAYS.default) next.delete(SEASON_DAYS_PARAM)
        else next.set(SEASON_DAYS_PARAM, String(value))
        return next
      },
      { preventScrollReset: true },
    )

  const meetingRows = useMemo<MeetingRow[]>(
    () =>
      (data?.meetings.rows ?? []).map((row) => ({
        id: `gorusme-${row.prospectId}`,
        prospectId: row.prospectId,
        name: row.name,
        stage: row.stage,
        stageLabel: prospectStageLabel(row.stage, type),
        branchName: row.branchName,
        dayLabel: dateLabel(row.date, DAY),
        timeRange: slotLabel(row.date, row.duration),
        place: [row.room, row.teacherName].filter((part) => part).join(' · ') || '—',
        held: row.held,
      })),
    [data, type],
  )
  const trialRows = useMemo<TrialRow[]>(
    () =>
      (data?.trials.rows ?? []).map((row) => ({
        id: `deneme-${row.prospectId}`,
        prospectId: row.prospectId,
        name: row.name,
        stage: row.stage,
        stageLabel: prospectStageLabel(row.stage, type),
        branchName: row.branchName,
        dayLabel: dateLabel(row.date, DAY),
        timeRange: slotLabel(row.date, row.duration),
        place: row.groupName ?? '—',
        held: row.held,
        resultRecorded: row.resultRecorded,
      })),
    [data, type],
  )
  const followUpRows = useMemo<FollowUpRow[]>(
    () =>
      (data?.followUps.rows ?? []).map((row) => ({
        id: `takip-${row.prospectId}`,
        prospectId: row.prospectId,
        name: row.name,
        stage: row.stage,
        stageLabel: prospectStageLabel(row.stage, type),
        branchName: row.branchName,
        reason: row.reason,
        since: followUpSince(row),
        note: trialResultNote(row.trialResultRecorded),
      })),
    [data, type],
  )

  const meetingColumns = useMemo<DataColumn<MeetingRow>[]>(
    () => [
      { key: 'name', label: 'Aday', cell: (row) => <NameLink role={role} row={row} /> },
      { key: 'dayLabel', label: 'Gün' },
      {
        key: 'timeRange',
        label: 'Saat',
        cell: (row) =>
          row.held ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {row.timeRange}
              <StatusBadge text="Yapıldı" tone="gray" />
            </span>
          ) : (
            row.timeRange
          ),
      },
      { key: 'branchName', label: 'Kampüs', cell: (row) => row.branchName ?? '—' },
      { key: 'place', label: 'Oda / görevli' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={stageTone(row.stage)} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => <OpenProspect role={role} row={row} />,
      },
    ],
    [role],
  )
  const trialColumns = useMemo<DataColumn<TrialRow>[]>(
    () => [
      { key: 'name', label: 'Aday', cell: (row) => <NameLink role={role} row={row} /> },
      { key: 'dayLabel', label: 'Gün' },
      { key: 'timeRange', label: 'Saat' },
      { key: 'place', label: 'Grup' },
      {
        key: 'resultRecorded',
        label: 'Sonuç',
        cell: (row) =>
          !row.held ? (
            '—'
          ) : row.resultRecorded ? (
            <StatusBadge text="Sonuç yazıldı" tone="green" />
          ) : (
            <StatusBadge text="Sonuç bekleniyor" tone="amber" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => <OpenProspect role={role} row={row} />,
      },
    ],
    [role],
  )
  const followUpColumns = useMemo<DataColumn<FollowUpRow>[]>(
    () => [
      { key: 'name', label: 'Aday', cell: (row) => <NameLink role={role} row={row} /> },
      {
        key: 'reason',
        label: 'Neden',
        cell: (row) => (
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge text={followUpLabel(row.reason)} tone={followUpTone(row.reason)} />
            {row.note ? <StatusBadge text={row.note} tone="amber" /> : null}
          </span>
        ),
      },
      { key: 'since', label: 'Gecikme' },
      { key: 'branchName', label: 'Kampüs', cell: (row) => row.branchName ?? '—' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={stageTone(row.stage)} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => <OpenProspect role={role} row={row} />,
      },
    ],
    [role],
  )

  const more = (total: number, shown: number) =>
    total > shown ? ` İlk ${number(shown)} satır gösteriliyor; toplam ${number(total)}.` : ''

  return (
    <div className="grid gap-6 px-6 pt-4 pb-6 max-[650px]:px-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="sezon-nobeti-baslik" className="text-lg font-semibold">
            Kayıt sezonu nöbeti
          </h2>
          <p className="text-sm text-muted-foreground">
            {data ? windowText(data.window) : 'Bugün ve yakın günlerde ilgilenilecek adaylar'}
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Pencere
          <NativeSelect
            value={String(days ?? SEASON_WATCH_DAYS.default)}
            onChange={(event) => setDays(Number(event.target.value))}
            className="min-h-9 text-sm"
          >
            {SEASON_DAY_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={String(option.value)}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </header>
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Sezon nöbeti yükleniyor…
        </p>
      ) : (
        <>
          <StatGrid
            label="Sezon nöbeti özeti"
            items={[
              {
                label: 'Bugünkü görüşme',
                value: number(data.summary.meetingsToday),
                note: `Pencerede ${number(data.summary.meetingsInWindow)}`,
              },
              ...(data.trialsEnabled
                ? [
                    {
                      label: 'Bugünkü deneme dersi',
                      value: number(data.summary.trialsToday),
                      note: `Pencerede ${number(data.summary.trialsInWindow)}`,
                    },
                  ]
                : []),
              {
                label: 'Geciken takip',
                value: number(data.summary.followUps),
                note: SEASON_FOLLOW_UP_REASONS.filter(
                  (reason) => data.summary.followUpsByReason[reason] > 0,
                )
                  .map(
                    (reason) =>
                      `${followUpLabel(reason)}: ${number(data.summary.followUpsByReason[reason])}`,
                  )
                  .join(' · '),
              },
              { label: 'Bugün gelen aday', value: number(data.summary.newToday) },
            ]}
          />
          <WatchPart
            id="nobet-takip"
            title="Geciken takipler"
            description={`İleri tarihli görüşmesi olmayan ve geri dönüş bekleyen açık adaylar, en çok geciken önce.${more(data.followUps.total, data.followUps.rows.length)}`}
          >
            <DataTable
              listKey="sezon-nobeti-takip"
              rows={followUpRows}
              columns={followUpColumns}
              mobileColumns={['reason', 'since']}
              caption="Geciken takipler"
              search={false}
              excludeFilters={keysOf(followUpColumns)}
              pageSize={ROW_PAGE}
              empty="Geciken takip yok."
            />
          </WatchPart>
          <WatchPart
            id="nobet-gorusme"
            title={meetingTitle(type)}
            description={`Penceredeki görüşmeler saat sırasıyla; saati geçenler “Yapıldı” görünür.${more(data.meetings.total, data.meetings.rows.length)}`}
          >
            <DataTable
              listKey={`sezon-nobeti-gorusme-${data.window.to}`}
              rows={meetingRows}
              columns={meetingColumns}
              mobileColumns={['dayLabel', 'timeRange']}
              caption={meetingTitle(type)}
              search={false}
              excludeFilters={keysOf(meetingColumns)}
              pageSize={ROW_PAGE}
              empty="Bu pencerede görüşme yok."
            />
          </WatchPart>
          {data.trialsEnabled ? (
            <WatchPart
              id="nobet-deneme"
              title="Deneme dersleri"
              description={`Penceredeki deneme dersleri; gün ve saat ders programındaki güncel kayıttan.${more(data.trials.total, data.trials.rows.length)}`}
            >
              <DataTable
                listKey={`sezon-nobeti-deneme-${data.window.to}`}
                rows={trialRows}
                columns={trialColumns}
                mobileColumns={['dayLabel', 'timeRange']}
                caption="Deneme dersleri"
                search={false}
                excludeFilters={keysOf(trialColumns)}
                pageSize={ROW_PAGE}
                empty="Bu pencerede deneme dersi yok."
              />
            </WatchPart>
          ) : null}
        </>
      )}
    </div>
  )
}
