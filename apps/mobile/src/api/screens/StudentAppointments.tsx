import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Badge, Button, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Notice, Pagination, Screen, Tabs } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  APPOINTMENT_GROUP_OPTIONS,
  appointmentBadgeTone,
  appointmentEmptyText,
  appointmentErrorView,
  appointmentGroupCounts,
  appointmentLookups,
  studentAppointmentRows,
  visibleAppointmentRows,
} from '../student-appointment.ts'
import { useServerToday } from '../use-server-today.ts'
import { useListMemory } from '../view-memory.tsx'
import { AppointmentBookSheet } from './appointment-book.tsx'
import { AppointmentSheet } from './appointment-sheet.tsx'

type AppointmentRecord = State['appointments'][number]
type StudentRecord = State['students'][number]
type TeacherRecord = State['teachers'][number]

const LIST_KEY = 'ogrenci/randevu-talep'

/**
 * Öğrenci: Etüt Randevusu (web `ogrenci/randevu-talep`; IST-124, DOM-ILT-100…105). Randevular
 * kapsamdan gelir (öğrenci yalnız kendisininkini görür). Talep, geri çekme ve iptal yalnız sunucu
 * yanıtıyla listeye yansır. Gün ve saat Europe/Istanbul gösterilir; "bugün" sunucudandır
 * (`useServerToday`), cihaz saatine dayalı karar yoktur. Konu ve gerekçe yalnız bellekte durur.
 */
export default function StudentAppointments() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentAppointments')
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const appointments = useCollectionAll<AppointmentRecord>('appointments', {}, { enabled: open })
  const teachers = useCollectionAll<TeacherRecord>('teachers', {}, { enabled: open })
  const server = useServerToday()
  const [booking, setBooking] = useState(false)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  const error = appointments.error ?? teachers.error
  const loaded = !!appointments.data && !!teachers.data
  const student = students.data?.[0]?.record
  const retry = () => {
    for (const query of [appointments, teachers]) if (query.error) void query.refetch()
  }
  return (
    <Screen>
      <T muted>Öğretmenlerinin müsait saatlerinden birebir görüşme talep et.</T>
      {student && student.isActive !== false && (
        <Button primary icon="Plus" onPress={() => setBooking(true)}>
          Randevu talep et
        </Button>
      )}
      {students.data && !student && (
        <Empty title="Öğrenci kaydı bulunamadı" text="Hesabına bağlı öğrenci kaydı görünmüyor." />
      )}
      {student && student.isActive === false && (
        <Notice
          title="Randevu alınamıyor"
          text="Kaydın pasif olduğu için randevu talep edilemez."
        />
      )}
      {students.error && (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      )}
      {server.error && server.today === null && (
        <Notice
          tone="amber"
          title="Bugünün tarihi alınamadı"
          text="Onaylı randevu iptali tarih alınana kadar sunulmuyor."
        >
          <Button onPress={() => void server.refetch()}>Yeniden dene</Button>
        </Notice>
      )}
      {error && loaded && <QueryError error={error} onRetry={retry} />}
      {appointmentErrorView(error, loaded) === 'full' && error ? (
        <QueryError error={error} onRetry={retry} />
      ) : !appointments.data || !teachers.data ? (
        <ListLoading label="Randevular yükleniyor…" />
      ) : (
        <AppointmentList
          items={appointments.data}
          teachers={teachers.data}
          viewerId={session.user.id}
          today={server.today}
        />
      )}
      {booking && student && (
        <AppointmentBookSheet studentId={student.id} onClose={() => setBooking(false)} />
      )}
    </Screen>
  )
}

function AppointmentList({
  items,
  teachers,
  viewerId,
  today,
}: {
  items: readonly CollectionRow<AppointmentRecord>[]
  teachers: readonly CollectionRow<TeacherRecord>[]
  viewerId: string
  today: string | null
}) {
  const { state, setSearch, setFilter, setIndex } = useListMemory(LIST_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lookups = useMemo(() => appointmentLookups(teachers), [teachers])
  const rows = useMemo(
    () => studentAppointmentRows(items, lookups, viewerId, today),
    [items, lookups, viewerId, today],
  )
  const counts = useMemo(() => appointmentGroupCounts(rows), [rows])
  const visible = useMemo(
    () => visibleAppointmentRows(rows, state.filter, state.search),
    [rows, state.filter, state.search],
  )
  const index = clampPageIndex(state.index, visible.length)
  if (index !== state.index) setIndex(index)
  const page = visible.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)
  const tabs = APPOINTMENT_GROUP_OPTIONS.map((option) => ({
    value: option.value,
    label: option.value === '' ? option.label : `${option.label} (${counts[option.value]})`,
  }))
  const empty = appointmentEmptyText(state.filter)
  const selected = selectedId ? rows.find((row) => row.id === selectedId) : undefined

  return (
    <>
      <Tabs value={state.filter} onChange={setFilter} options={tabs} />
      <SearchField
        value={state.search}
        onChange={setSearch}
        placeholder="Öğretmen, tür veya konu"
      />
      {page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="randevu" onClear={() => setSearch('')} />
        ) : (
          <Empty title={empty.title} text={empty.text} />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {page.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.counterpart}
              subtitle={`${row.type} · ${row.when}\n${row.note}`}
              label={`${row.counterpart}, ${row.when}, ${row.status}. Ayrıntıyı aç`}
              onPress={() => setSelectedId(row.id)}
              badge={<Badge text={row.status} tone={appointmentBadgeTone(row.status)} />}
            />
          ))}
        </View>
      )}
      <Pagination
        count={visible.length}
        index={index}
        pageSize={API_PAGE_SIZE}
        onChange={setIndex}
      />
      {selected && (
        <AppointmentSheet row={selected} today={today} onClose={() => setSelectedId(null)} />
      )}
    </>
  )
}
