import { useMemo } from 'react'
import { dateLabel, dayKey, number, timeLabel } from '@kampus/school-core/lib/format.ts'
import { countOf } from '@kampus/react-shared/collections.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll, useCoreCounts, useCoreList } from '@/hooks/use-core-collection.ts'
import type { Session } from '@/auth/auth-port.ts'
import { attendanceStatusLabel, isVisibleLesson } from '../academic/academic-rows.ts'
import {
  CardList,
  combineStates,
  DashboardGrid,
  ListCard,
  StatCard,
  StatGrid,
} from './DashboardParts.tsx'
import { StudentName } from './StudentName.tsx'
import { dashboardHref, upcomingByDueDate } from './dashboard-model.ts'

const NONE: readonly never[] = []
const ACTIVE = { isActive: 'true' } as const
/** Yaklaşan ödevler `-dueDate` sırasıyla bu kadar kayıttan seçilir. */
const HOMEWORK_WINDOW = 20

/**
 * Öğretmen Genel Bakış (Vue `Dashboard.vue` öğretmen): öğrenci ve sınıf sayıları, bugün gelmeyen
 * öğrenciler; bugünkü dersler (iptal edilen ders görünmez), teslim süresi dolmamış kendi ödevleri
 * teslim sayılarıyla ve son devamsızlık kayıtları. Kapsam (kendi sınıfları ve dersleri) sunucudadır.
 * TODO(api-filter-cancelled): iptal dersi sunucuda süzülünce ders sayısı da sayımdan gelir.
 */
export function TeacherDashboard({ session, now }: { session: Session; now: Date }) {
  const role = session.role
  const academic = session.modules.academic === true
  const learning = session.modules.learning === true
  const today = dayKey(now)

  // Öğretmenin kendi kaydı (kapsam yalnız onu döndürür): ödev ve ders süzgeci için kimlik.
  const self = useCoreAll('teachers')
  const teacherId = self.data?.[0]?.record.id ?? ''
  const students = useCoreCounts('students', { groupBy: 'isActive' })
  const studentsByClass = useCoreCounts('students', { groupBy: 'classId', filters: ACTIVE })
  const classes = useCoreCounts('classes', { groupBy: 'isActive' })
  const classRefs = useCoreAll('classes')
  const todayAttendance = useCoreCounts(
    'attendance',
    { groupBy: 'status', filters: { dateFrom: today, dateTo: today } },
    { enabled: academic },
  )
  const lessons = useCoreList(
    'schedule',
    { filters: { teacherId, dateFrom: today, dateTo: today }, sort: ['date'], pageSize: 20 },
    { enabled: academic && teacherId !== '' },
  )
  const homework = useCoreList(
    'homework',
    { filters: { teacherId }, sort: ['-dueDate'], pageSize: HOMEWORK_WINDOW },
    { enabled: learning && teacherId !== '' },
  )
  const recentAbsences = useCoreList(
    'attendance',
    { filters: { status: ['absent', 'late'] }, sort: ['-date'], pageSize: 5 },
    { enabled: academic },
  )

  const classNames = useMemo(
    () => new Map((classRefs.data ?? NONE).map((row) => [row.record.id, row.record.name])),
    [classRefs.data],
  )
  const visibleLessons = (lessons.data?.rows ?? NONE).filter((row) => isVisibleLesson(row.record))
  const upcoming = upcomingByDueDate(
    (homework.data?.rows ?? NONE).map((row) => row.record),
    now,
    5,
  )
  const deliveries = useCoreCounts(
    'submissions',
    { groupBy: 'homeworkId', filters: { homeworkId: upcoming.map((item) => item.id) } },
    { enabled: learning && upcoming.length > 0 },
  )

  return (
    <>
      <StatGrid label="Sınıf özeti">
        <StatCard
          label="Öğrencilerim"
          icon="GraduationCap"
          value={number(countOf(students.data, true))}
          note="Ders verdiğiniz sınıflardaki öğrenciler"
          href={dashboardHref(role, 'siniflarim')}
          state={combineStates(students)}
        />
        <StatCard
          label="Sınıflarım"
          icon="School"
          value={number(countOf(classes.data, true))}
          note="Danışman veya branş öğretmeni olduğunuz"
          href={dashboardHref(role, 'siniflarim')}
          state={combineStates(classes)}
        />
        {academic ? (
          <StatCard
            label="Bugün gelmeyen"
            icon="ClipboardCheck"
            value={number(countOf(todayAttendance.data, 'absent'))}
            note={`${number(todayAttendance.data?.total)} öğrencinin yoklaması alındı`}
            href={dashboardHref(role, 'yoklama', { durum: 'absent', tarih: today })}
            state={combineStates(todayAttendance)}
          />
        ) : null}
      </StatGrid>

      <DashboardGrid>
        {academic ? (
          <ListCard
            title="Bugünkü derslerim"
            description={
              lessons.data
                ? `${dateLabel(now, { weekday: 'long' })} · ${number(visibleLessons.length)} ders`
                : dateLabel(now, { weekday: 'long' })
            }
            action={{ label: 'Programı aç', href: dashboardHref(role, 'ders-programi') }}
            state={combineStates(self, lessons, classRefs)}
            isEmpty={visibleLessons.length === 0}
            emptyText="Bugün dersiniz yok."
          >
            <CardList label="Bugünkü derslerim">
              {visibleLessons.map(({ id, record }) => (
                <li key={id} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                  <time
                    dateTime={record.date}
                    className="w-12 shrink-0 text-md font-semibold tabular-nums"
                  >
                    {timeLabel(record.date)}
                  </time>
                  <span className="grid min-w-0">
                    <strong className="font-medium [overflow-wrap:anywhere]">
                      {record.title ?? record.subject ?? 'Ders'}
                    </strong>
                    <small className="text-sm text-muted-foreground">
                      {[classNames.get(record.classId), `Derslik ${record.room}`]
                        .filter(Boolean)
                        .join(' · ')}
                      {` · ${record.duration} dk`}
                    </small>
                  </span>
                </li>
              ))}
            </CardList>
          </ListCard>
        ) : null}
        {learning ? (
          <ListCard
            title="Teslim bekleyen ödevler"
            description="Son teslim tarihi gelmemiş ödevleriniz"
            action={{ label: 'Ödevleri aç', href: dashboardHref(role, 'odevler') }}
            state={combineStates(self, homework, deliveries, studentsByClass)}
            isEmpty={upcoming.length === 0}
            emptyText="Teslim süresi devam eden ödev yok."
          >
            <CardList label="Teslim bekleyen ödevler">
              {upcoming.map((item) => {
                const delivered = countOf(deliveries.data, item.id)
                const expected = countOf(studentsByClass.data, item.classId)
                return (
                  <li key={item.id} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
                    <strong className="font-medium [overflow-wrap:anywhere]">{item.title}</strong>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span>
                        {[classNames.get(item.classId), `Son teslim ${dateLabel(item.dueDate)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="font-medium text-foreground tabular-nums">
                        {number(delivered)}/{number(expected)} teslim
                      </span>
                    </span>
                  </li>
                )
              })}
            </CardList>
          </ListCard>
        ) : null}
      </DashboardGrid>

      {academic ? (
        <DashboardGrid>
          <ListCard
            title="Son yoklamalar"
            description="Sınıflarınızda gelmeyen veya geç kalan öğrenciler"
            action={{
              label: 'Yoklamayı aç',
              href: dashboardHref(role, 'yoklama', { durum: 'absent' }),
            }}
            state={combineStates(recentAbsences, classRefs)}
            isEmpty={recentAbsences.data?.rows.length === 0}
            emptyText="Son yoklamalarda devamsızlık yok."
          >
            <CardList label="Son yoklamalar">
              {recentAbsences.data?.rows.map(({ id, record }) => (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <StudentName
                    studentId={record.studentId}
                    detail={[classNames.get(record.classId), dateLabel(record.date)]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <StatusBadge
                    text={attendanceStatusLabel(record.status)}
                    tone={record.status === 'absent' ? 'red' : 'amber'}
                  />
                </li>
              ))}
            </CardList>
          </ListCard>
        </DashboardGrid>
      ) : null}
    </>
  )
}
