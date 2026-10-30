import { dateLabel, number, timeLabel } from '@kampus/school-core/lib/format.ts'
import { useDashboard } from '@kampus/react-shared/use-dashboard.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import type { Session } from '@/auth/auth-port.ts'
import { attendanceStatusLabel } from '../academic/academic-rows.ts'
import {
  CardList,
  combineStates,
  DashboardGrid,
  ListCard,
  StatCard,
  StatGrid,
} from './DashboardParts.tsx'
import { StudentName } from './StudentName.tsx'
import { dashboardHref, sectionVisible } from './dashboard-model.ts'

const NONE: readonly never[] = []

/**
 * Öğretmen Genel Bakış (Vue `Dashboard.vue` öğretmen): öğrenci ve sınıf sayıları, bugün gelmeyen
 * öğrenciler; bugünkü dersler (iptaller ayrı sayılır), teslim süresi dolmamış kendi ödevleri teslim
 * sayılarıyla, notlanmamış teslimler ve son devamsızlık kayıtları. Bütün değerler tek özet
 * isteğinden gelir (`useDashboard`); kapsam sunucudadır.
 */
export function TeacherDashboard({ session, now }: { session: Session; now: Date }) {
  const role = session.role
  const query = useDashboard('ogretmen')
  const data = query.data ?? null
  const state = combineStates(query)
  const loaded = data !== null
  const academic = sectionVisible(data?.academic, loaded, session.modules.academic === true)
  const learning = sectionVisible(data?.learning, loaded, session.modules.learning === true)
  const today = data?.today ?? ''

  const lessons = data?.academic?.lessons
  const upcoming = data?.learning?.homework ?? NONE
  const attendanceToday = data?.academic?.attendanceToday

  return (
    <>
      <StatGrid label="Sınıf özeti">
        <StatCard
          label="Öğrencilerim"
          icon="GraduationCap"
          value={number(data?.students.active)}
          note="Ders verdiğiniz sınıflardaki öğrenciler"
          href={dashboardHref(role, 'siniflarim')}
          state={state}
        />
        <StatCard
          label="Sınıflarım"
          icon="School"
          value={number(data?.classes.active)}
          note="Danışman veya branş öğretmeni olduğunuz"
          href={dashboardHref(role, 'siniflarim')}
          state={state}
        />
        {academic ? (
          <StatCard
            label="Bugün gelmeyen"
            icon="ClipboardCheck"
            value={number(attendanceToday?.absent)}
            note={`${number(attendanceToday?.total)} öğrencinin yoklaması alındı`}
            href={dashboardHref(role, 'yoklama', { durum: 'absent', tarih: today })}
            state={state}
          />
        ) : null}
        {learning ? (
          <StatCard
            label="Notlanmamış teslim"
            icon="ClipboardCheck"
            value={number(data?.learning?.ungraded)}
            note="Öğrencilerinizin puanlanmamış ödev teslimi"
            href={dashboardHref(role, 'odevler')}
            state={state}
          />
        ) : null}
      </StatGrid>

      <DashboardGrid>
        {academic ? (
          <ListCard
            title="Bugünkü derslerim"
            description={
              lessons
                ? `${dateLabel(now, { weekday: 'long' })} · ${number(lessons.total)} ders` +
                  (lessons.cancelled ? ` · ${number(lessons.cancelled)} iptal` : '')
                : dateLabel(now, { weekday: 'long' })
            }
            action={{ label: 'Programı aç', href: dashboardHref(role, 'ders-programi') }}
            state={state}
            isEmpty={(lessons?.items ?? NONE).length === 0}
            emptyText="Bugün dersiniz yok."
          >
            <CardList label="Bugünkü derslerim">
              {lessons?.items.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                  <time
                    dateTime={lesson.date}
                    className="w-12 shrink-0 text-md font-semibold tabular-nums"
                  >
                    {timeLabel(lesson.date)}
                  </time>
                  <span className="grid min-w-0">
                    <strong className="font-medium [overflow-wrap:anywhere]">
                      {lesson.title ?? lesson.subject ?? 'Ders'}
                    </strong>
                    <small className="text-sm text-muted-foreground">
                      {[lesson.className, `Derslik ${lesson.room}`].filter(Boolean).join(' · ')}
                      {` · ${lesson.duration} dk`}
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
            state={state}
            isEmpty={upcoming.length === 0}
            emptyText="Teslim süresi devam eden ödev yok."
          >
            <CardList label="Teslim bekleyen ödevler">
              {upcoming.map((item) => (
                <li key={item.id} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
                  <strong className="font-medium [overflow-wrap:anywhere]">{item.title}</strong>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      {[item.className, `Son teslim ${dateLabel(item.dueDate)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="font-medium text-foreground tabular-nums">
                      {number(item.delivered)}/{number(item.expected)} teslim
                    </span>
                  </span>
                </li>
              ))}
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
            state={state}
            isEmpty={data?.academic?.recentAbsences.length === 0}
            emptyText="Son yoklamalarda devamsızlık yok."
          >
            <CardList label="Son yoklamalar">
              {data?.academic?.recentAbsences.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <StudentName
                    name={row.studentName}
                    detail={[row.className, dateLabel(row.date)].filter(Boolean).join(' · ')}
                  />
                  <StatusBadge
                    text={attendanceStatusLabel(row.status)}
                    tone={row.status === 'absent' ? 'red' : 'amber'}
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
