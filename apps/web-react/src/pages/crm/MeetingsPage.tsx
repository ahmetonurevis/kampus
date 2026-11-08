import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import { addDays } from '../academic/academic-rows.ts'
import { MeetingPlanPanel } from './MeetingPlanPanel.tsx'
import { MeetingWeekView } from './MeetingWeekView.tsx'
import { ProspectSeasonWatchSection } from './ProspectSeasonWatchSection.tsx'
import {
  MEETING_DAY_FILTER,
  MEETING_KIND_FILTER,
  MEETING_VIEWS,
  meetingEvents,
  meetingView,
  meetingWeek,
  meetingWeekStart,
  meetingWeekQueries,
  meetingWeekTitle,
  mergeProspectPages,
  stageTone,
  type MeetingEvent,
  type MeetingView,
} from './prospect-rows.ts'

const COLUMNS_MOBILE = ['timeRange', 'kindLabel', 'branch']
const VIEW_PARAM = 'gorunum'
const WEEK_PARAM = 'hafta'
const PLAN_PARAM = 'planlama'
const PLAN_MEETING = 'gorusme'

/**
 * Tanışma Görüşmeleri (ön büro, Vue `Crm.vue` `deneme-dersi-takvimi`): açık adayların planlanmış
 * tanışma görüşmeleri ve (dil okulunda) deneme dersleri iki görünümde: liste (varsayılan) ve
 * haftalık takvim (Vue `WeekCalendar`; `?gorunum=hafta`, hafta `?hafta=<pazartesi>`). Listede
 * yaklaşanlar önce gelir; tür ve görüşme günü (başlangıç/bitiş) süzgeci, arama ve sıralama
 * tarayıcıdadır. Ad adayın detayına bağlanır (`/onburo/aday/:id`). "Tanışma görüşmesi planla"
 * sağ panelde aday seçtirir (`?planlama=gorusme`, DOM-KAY-033). Aday sayısı pipeline ile
 * sınırlıdır, bu yüzden liste açık adayları bir kez çeker. Haftalık takvim yalnız o haftayı okur:
 * `trialAt` ve (dil okulunda) `trialLesson.date` gün aralığı sunucuda süzülür, iki sorgu birleşir
 * (`meetingWeekQueries`, ON-111). Sunucu bir sorguda tek tarih alanı süzdüğü için iki türü bir
 * arada sıralayıp sayfalayan liste ucu yoktur; liste tarayıcıda süzülür. Üçüncü görünüm kayıt
 * sezonu nöbetidir (`?gorunum=nobet`, DOM-KAY-037, ON-077): görüşmeler, deneme dersleri ve geciken
 * takipler kendi ucundan (`GET /prospects/season-watch`) okunur, aday listesi çekilmez.
 */
export function MeetingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const role = session?.role ?? 'onburo'
  const type = session?.institution.type ?? 'school'
  const [now] = useState(() => Date.now())
  const [params, setParams] = useSearchParams()
  const view = meetingView(params.get(VIEW_PARAM))
  const today = dayKey(now)
  const thisWeek = meetingWeekStart(null, today)
  const start = meetingWeekStart(params.get(WEEK_PARAM), today)
  const plan = useDetailPanel(PLAN_PARAM)
  const planning = plan.selectedId === PLAN_MEETING
  // Liste ve planlama paneli bütün açık adayları okur; haftalık takvim yalnız o haftanın
  // görüşme ve deneme dersi günlerini sunucuda süzer (ON-111).
  const prospects = useCoreAll(
    'prospects',
    { filters: { stage: [...OPEN_PROSPECT_STAGES] } },
    { enabled: view === 'liste' || planning },
  )
  const [meetingQuery, trialQuery] = meetingWeekQueries(start, type)
  const weekMeetings = useCoreAll('prospects', meetingQuery?.query ?? {}, {
    enabled: view === 'hafta',
  })
  const weekTrials = useCoreAll('prospects', trialQuery?.query ?? {}, {
    enabled: view === 'hafta' && trialQuery !== undefined,
  })
  const source =
    view === 'hafta'
      ? {
          data:
            weekMeetings.data && (trialQuery === undefined || weekTrials.data)
              ? mergeProspectPages([weekMeetings.data, weekTrials.data])
              : undefined,
          error: weekMeetings.error ?? weekTrials.error,
          refetch: () => Promise.all([weekMeetings.refetch(), weekTrials.refetch()]),
        }
      : prospects
  const branches = useCoreAll('branches')
  const classes = useCoreAll('classes', {}, { enabled: type === 'language_school' })
  const rows = useMemo(
    () =>
      meetingEvents(
        (source.data ?? []).map((item) => item.record),
        type,
        {
          now,
          branches: new Map(
            (branches.data ?? []).map((item) => [item.record.id, item.record.name]),
          ),
          classes: new Map((classes.data ?? []).map((item) => [item.record.id, item.record.name])),
        },
      ),
    [source.data, branches.data, classes.data, type, now],
  )
  const columns = useMemo<DataColumn<MeetingEvent>[]>(
    () => [
      {
        key: 'name',
        label: 'Aday',
        cell: (row) => (
          <Link
            to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}
            className="record-link font-medium text-primary hover:underline"
          >
            {row.name}
          </Link>
        ),
      },
      { key: 'kindLabel', label: 'Tür' },
      { key: 'whenLabel', label: 'Gün' },
      { key: 'timeRange', label: 'Saat' },
      { key: 'branch', label: 'Kampüs' },
      { key: 'place', label: type === 'language_school' ? 'Oda / grup' : 'Oda' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={stageTone(row.stage)} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" asChild>
            <Link
              to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}
              aria-label={`${row.name} adayını aç`}
            >
              <Icon name="ArrowUpRight" size={15} aria-hidden="true" />
              Aday
            </Link>
          </Button>
        ),
      },
    ],
    [role, type],
  )
  const filters = useMemo(
    () =>
      type === 'language_school' ? [MEETING_KIND_FILTER, MEETING_DAY_FILTER] : [MEETING_DAY_FILTER],
    [type],
  )
  const upcoming = rows.filter((row) => row.upcoming).length
  const week = useMemo(() => meetingWeek(rows, start, today), [rows, start, today])

  const setParam = (name: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null) next.delete(name)
        else next.set(name, value)
        return next
      },
      { preventScrollReset: true },
    )
  const changeView = (next: MeetingView) => {
    setParam(VIEW_PARAM, next === 'liste' ? null : next)
  }
  const goToWeek = (key: string) => setParam(WEEK_PARAM, key === thisWeek ? null : key)

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button onClick={() => plan.open(PLAN_MEETING)}>
            <Icon name="CalendarDays" size={17} aria-hidden="true" />
            Tanışma görüşmesi planla
          </Button>
        }
      />
      <section
        aria-labelledby={view === 'nobet' ? 'sezon-nobeti-baslik' : 'gorusme-tablosu'}
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        {view === 'nobet' ? null : (
          <header className="panel-heading px-6 pt-6 pb-2">
            <h2 id="gorusme-tablosu" className="text-lg font-semibold">
              Planlanan görüşmeler
            </h2>
            <p className="text-sm text-muted-foreground">
              {rows.length} kayıt · {upcoming} yaklaşan
            </p>
          </header>
        )}
        <div className={view === 'nobet' ? 'px-6 pt-6 max-[650px]:px-4' : 'px-6 max-[650px]:px-4'}>
          <LineTabs label="Görünüm" value={view} options={MEETING_VIEWS} onChange={changeView} />
        </div>
        {view === 'nobet' ? (
          <ProspectSeasonWatchSection role={role} type={type} />
        ) : source.error ? (
          <div role="alert" className="p-6">
            <QueryError error={source.error} onRetry={() => void source.refetch()} />
          </div>
        ) : !source.data ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Görüşmeler yükleniyor…
          </p>
        ) : view === 'hafta' ? (
          <MeetingWeekView
            role={role}
            title={meetingWeekTitle(start)}
            days={week}
            atCurrent={start === thisWeek}
            onPrevious={() => goToWeek(addDays(start, -7))}
            onCurrent={() => goToWeek(thisWeek)}
            onNext={() => goToWeek(addDays(start, 7))}
          />
        ) : (
          <DataTable
            listKey="gorusmeler"
            rows={rows}
            columns={columns}
            mobileColumns={COLUMNS_MOBILE}
            filters={filters}
            searchKeys={['name', 'branch', 'place']}
            caption="Planlanan görüşmeler"
            empty="Planlanmış görüşme yok. “Tanışma görüşmesi planla” ile ya da aday detayından planlayın."
            emptyFiltered="Bu süzgece uyan görüşme yok."
          />
        )}
      </section>
      <MeetingPlanPanel
        open={planning}
        prospects={prospects.data ?? []}
        canPickTeacher={role === 'yonetici'}
        onClose={plan.close}
      />
    </>
  )
}
