import { use, useMemo } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TableSection } from '../academic/AcademicParts.tsx'
import { TableGate } from '../learning/LearningParts.tsx'
import { AppointmentPanel } from './AppointmentPanel.tsx'
import { BookAppointmentPanel, NEW_APPOINTMENT } from './BookAppointmentPanel.tsx'
import {
  STATUS_TONES,
  appointmentLookups,
  appointmentRow,
  orderAppointments,
  pendingCount,
  upcomingSchedule,
  type AppointmentAudience,
  type AppointmentRow,
} from './appointment-rows.ts'

const NONE: readonly never[] = []
const SEARCH_KEYS = ['counterpart', 'type', 'note', 'when', 'status']

const toneOf = (row: AppointmentRow) =>
  STATUS_TONES[row.status as keyof typeof STATUS_TONES] ?? 'gray'

/**
 * Etüt Randevusu (öğrenci `randevu-talep`), veli "Randevu & Mesajlar" sayfasının Randevular
 * sekmesi ve öğretmenin Etüt & Görüşmeler (`randevular`) ekranı, Vue `Communication.vue`. Kapsamı
 * sunucu uygular: öğretmen kendi randevularını, öğrenci kendisininkini, veli seçili çocuğun (`?cocuk=`)
 * öğrenci tarafından açılmış randevularını ve yalnız kendi açtığı görüşmeleri görür
 * (DOM-ILT-103). Liste küçüktür: arama, tür/durum süzgeci, sıralama ve sayfalama tarayıcıdadır;
 * liste durumu çocuk bazında korunur, süzgeç değişince sayfa başa döner. Satırdan sağ panelde
 * ayrıntı ve işlemler açılır (`?randevu=<kimlik>`); öğrenci ve veli "Randevu talep et"i sağ panelde
 * açar (`?randevu-form=yeni`).
 * "Yaklaşan randevular" yalnız onaylı ve başlamamış randevuları gösterir (`scheduledAppointments`,
 * DOM-ILT-104): bekleyen talep, red, geri çekme ve iptal programda yoktur.
 */
export function AppointmentsPage({
  page,
  audience,
  heading = true,
}: {
  page: NavPage
  audience: AppointmentAudience
  heading?: boolean
}) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const childId = use(ViewScopeContext)
  const teacher = audience === 'teacher'
  const parent = audience === 'parent'
  const panel = useDetailPanel('randevu')
  const form = useDetailPanel('randevu-form')
  const openAppointment = panel.open
  const now = useMinuteClock()
  const viewerId = session?.user.id ?? ''

  const appointments = useCoreAll(
    'appointments',
    parent ? { filters: { studentId: childId } } : {},
    { enabled: !parent || childId !== '' },
  )
  const teachers = useCoreAll('teachers', {}, { enabled: !teacher })
  const lookups = useMemo(
    () => (teacher ? appointmentLookups([]) : teachers.data && appointmentLookups(teachers.data)),
    [teacher, teachers.data],
  )
  const rows = useMemo(
    () =>
      appointments.data && lookups
        ? orderAppointments(
            appointments.data.map((item) => appointmentRow(item, lookups, audience, viewerId, now)),
          )
        : undefined,
    [appointments.data, lookups, audience, viewerId, now],
  )
  const upcoming = useMemo(() => (rows ? upcomingSchedule(rows, now) : []), [rows, now])

  const columns = useMemo<DataColumn<AppointmentRow>[]>(
    () => [
      {
        key: 'counterpart',
        label: teacher ? 'Öğrenci' : 'Öğretmen',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openAppointment(row.id)}
            aria-label={`${row.counterpart} ile ${row.when} randevusunu aç`}
            className="record-link max-w-[260px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.counterpart}
          </button>
        ),
      },
      { key: 'type', label: 'Tür' },
      // Anahtar sıralama değeridir (ISO an); metin `cell`'den gelir.
      { key: 'startsAt', label: 'Tarih ve saat', cell: (row) => row.when },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={toneOf(row)} />,
      },
      {
        key: 'note',
        label: 'Konu',
        cell: (row) => (
          <span className="block max-w-[280px] truncate" title={row.note}>
            {row.note}
          </span>
        ),
      },
    ],
    [teacher, openAppointment],
  )

  const error = appointments.error ?? teachers.error
  const retry = () => {
    for (const query of [appointments, teachers]) if (query.error) void query.refetch()
  }
  const tableName = teacher ? 'Talepler ve randevular' : 'Randevularım'
  const waiting = rows ? pendingCount(rows) : 0
  const loading = rows === undefined && !error
  return (
    <>
      {heading ? <PageHeading title={page.title} description={page.description} /> : null}
      {upcoming.length > 0 ? <UpcomingSection rows={upcoming} onOpen={openAppointment} /> : null}
      <TableSection
        title={tableName}
        subtitle={`${rows?.length ?? 0} randevu · ${waiting} ${teacher ? 'yanıt bekliyor' : 'onay bekliyor'}`}
        action={
          teacher ? undefined : (
            <Button onClick={() => form.open(NEW_APPOINTMENT)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Randevu talep et
            </Button>
          )
        }
      >
        <TableGate error={error} onRetry={retry} loading={loading}>
          <DataTable
            listKey={`randevular-${audience}`}
            rows={rows ?? NONE}
            columns={columns}
            mobileColumns={['startsAt', 'status']}
            caption={tableName}
            searchKeys={SEARCH_KEYS}
            empty={teacher ? 'Henüz randevu talebi yok.' : 'Henüz randevu talebiniz yok.'}
            onRowClick={(row) => openAppointment(row.id)}
          />
        </TableGate>
      </TableSection>
      <AppointmentPanel
        appointmentId={panel.selectedId}
        onClose={panel.close}
        audience={audience}
        lookups={lookups}
      />
      {teacher ? null : (
        <BookAppointmentPanel
          open={form.selectedId === NEW_APPOINTMENT}
          onClose={form.close}
          audience={audience}
        />
      )}
    </>
  )
}

function UpcomingSection({
  rows,
  onOpen,
}: {
  rows: readonly AppointmentRow[]
  onOpen: (id: string) => void
}) {
  return (
    <section
      aria-labelledby="randevu-yaklasan"
      className="panel mb-6 rounded-card border bg-surface px-6 py-5 max-[650px]:px-4"
    >
      <h2 id="randevu-yaklasan" className="text-lg font-semibold">
        Yaklaşan randevular
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">Yalnız onaylanmış görüşmeler.</p>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card border px-3.5 py-2.5 text-left text-sm hover:bg-surface-soft"
            >
              <span className="font-medium [overflow-wrap:anywhere]">
                {row.when} · {row.counterpart}
              </span>
              <span className="text-muted-foreground">
                {row.type}
                {row.duration === null ? '' : ` · ${row.duration} dk`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
