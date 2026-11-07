import { dateLabel, number, timeLabel } from '@kampus/school-core/lib/format.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { attendanceStatusLabel } from '../academic/academic-rows.ts'
import { CardList, ListCard, StatCard } from './DashboardParts.tsx'
import { StudentName } from './StudentName.tsx'
import { defineCard } from './dashboard-cards-model.ts'
import { dashboardHref } from './dashboard-model.ts'

const NONE: readonly never[] = []

/**
 * Öğretmen Genel Bakışı (Vue `Dashboard.vue` öğretmen): öğrenci ve sınıf sayıları, bugün gelmeyen
 * öğrenciler; bugünkü dersler (iptaller ayrı sayılır), teslim süresi dolmamış kendi ödevleri teslim
 * sayılarıyla, notlanmamış teslimler ve son devamsızlık kayıtları. Kapsam sunucudadır.
 */
export const TEACHER_CARDS = [
  defineCard({
    id: 'ogretmen.ogrencilerim',
    roles: ['ogretmen'],
    area: 'stat',
    order: 10,
    component: ({ ctx }) => (
      <StatCard
        label="Öğrencilerim"
        icon="GraduationCap"
        value={number(ctx.data?.students.active)}
        note="Ders verdiğiniz sınıflardaki öğrenciler"
        href={dashboardHref(ctx.role, 'siniflarim')}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'ogretmen.siniflarim',
    roles: ['ogretmen'],
    area: 'stat',
    order: 20,
    component: ({ ctx }) => (
      <StatCard
        label="Sınıflarım"
        icon="School"
        value={number(ctx.data?.classes.active)}
        note="Danışman veya branş öğretmeni olduğunuz"
        href={dashboardHref(ctx.role, 'siniflarim')}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'ogretmen.bugun-gelmeyen',
    roles: ['ogretmen'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'stat',
    order: 30,
    component: ({ ctx }) => {
      const attendanceToday = ctx.data?.academic?.attendanceToday
      return (
        <StatCard
          label="Bugün gelmeyen"
          icon="ClipboardCheck"
          value={number(attendanceToday?.absent)}
          note={`${number(attendanceToday?.total)} öğrencinin yoklaması alındı`}
          href={dashboardHref(ctx.role, 'yoklama', {
            durum: 'absent',
            tarih: ctx.data?.today ?? '',
          })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'ogretmen.notlanmamis-teslim',
    roles: ['ogretmen'],
    module: 'learning',
    section: (data) => data.learning,
    area: 'stat',
    order: 40,
    component: ({ ctx }) => (
      <StatCard
        label="Notlanmamış teslim"
        icon="ClipboardCheck"
        value={number(ctx.data?.learning?.ungraded)}
        note="Öğrencilerinizin puanlanmamış ödev teslimi"
        href={dashboardHref(ctx.role, 'odevler')}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'ogretmen.bugunku-derslerim',
    roles: ['ogretmen'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'main',
    order: 100,
    component: ({ ctx }) => {
      const lessons = ctx.data?.academic?.lessons
      return (
        <ListCard
          title="Bugünkü derslerim"
          description={
            lessons
              ? `${dateLabel(ctx.now, { weekday: 'long' })} · ${number(lessons.total)} ders` +
                (lessons.cancelled ? ` · ${number(lessons.cancelled)} iptal` : '')
              : dateLabel(ctx.now, { weekday: 'long' })
          }
          action={{ label: 'Programı aç', href: dashboardHref(ctx.role, 'ders-programi') }}
          state={ctx.state}
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
      )
    },
  }),
  defineCard({
    id: 'ogretmen.teslim-bekleyen-odevler',
    roles: ['ogretmen'],
    module: 'learning',
    section: (data) => data.learning,
    area: 'side',
    order: 110,
    component: ({ ctx }) => {
      const upcoming = ctx.data?.learning?.homework ?? NONE
      return (
        <ListCard
          title="Teslim bekleyen ödevler"
          description="Son teslim tarihi gelmemiş ödevleriniz"
          action={{ label: 'Ödevleri aç', href: dashboardHref(ctx.role, 'odevler') }}
          state={ctx.state}
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
      )
    },
  }),
  defineCard({
    id: 'ogretmen.son-yoklamalar',
    roles: ['ogretmen'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'main',
    order: 200,
    component: ({ ctx }) => (
      <ListCard
        title="Son yoklamalar"
        description="Sınıflarınızda gelmeyen veya geç kalan öğrenciler"
        action={{
          label: 'Yoklamayı aç',
          href: dashboardHref(ctx.role, 'yoklama', { durum: 'absent' }),
        }}
        state={ctx.state}
        isEmpty={ctx.data?.academic?.recentAbsences.length === 0}
        emptyText="Son yoklamalarda devamsızlık yok."
      >
        <CardList label="Son yoklamalar">
          {ctx.data?.academic?.recentAbsences.map((row) => (
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
    ),
  }),
]
