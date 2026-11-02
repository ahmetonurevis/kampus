import { Link } from 'react-router'
import { number } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { CardList, ListCard, ShareBar, StatCard } from './DashboardParts.tsx'
import { defineCard } from './dashboard-cards-model.ts'
import { attendanceSummary, campusOccupancy, dashboardHref } from './dashboard-model.ts'

/**
 * Yönetici Genel Bakışı'nın akademik ve kurum kartları (Vue `Dashboard.vue` yönetici). Finans
 * kartları `HandoverFinanceCards.tsx`'tedir. Değerler tek özet isteğinden gelir; kartlar ilgili listeyi
 * filtresi adreste açar.
 */
export const ADMIN_CARDS = [
  defineCard({
    id: 'yonetici.aktif-ogrenci',
    roles: ['yonetici'],
    area: 'stat',
    order: 10,
    component: ({ ctx }) => {
      const { data } = ctx
      const archived = data?.students.archived ?? 0
      return (
        <StatCard
          label="Aktif öğrenci"
          icon="GraduationCap"
          value={number(data?.students.active)}
          note={archived ? `${number(archived)} öğrenci arşivde` : 'Arşivde öğrenci yok'}
          href={dashboardHref(ctx.role, 'subeler')}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'yonetici.aktif-sinif',
    roles: ['yonetici'],
    area: 'stat',
    order: 20,
    component: ({ ctx }) => (
      <StatCard
        label="Aktif sınıf"
        icon="School"
        value={number(ctx.data?.classes.active)}
        note={`${number(ctx.data?.classes.campusCount)} kampüste`}
        href={dashboardHref(ctx.role, 'subeler')}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'yonetici.ogretmen-kadrosu',
    roles: ['yonetici'],
    area: 'stat',
    order: 30,
    component: ({ ctx }) => (
      <StatCard
        label="Öğretmen kadrosu"
        icon="UsersRound"
        value={number(ctx.data?.teachers.active)}
        note="Aktif öğretmen"
        href={dashboardHref(ctx.role, 'personel')}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'yonetici.bugunku-yoklama',
    roles: ['yonetici'],
    module: 'academic',
    section: (data) => data.attendanceToday,
    area: 'side',
    order: 110,
    component: ({ ctx }) => {
      const summary = ctx.data?.attendanceToday ? attendanceSummary(ctx.data.attendanceToday) : null
      return (
        <ListCard
          title="Bugünkü yoklama"
          description="Bugün alınan yoklama kayıtları"
          state={ctx.state}
          isEmpty={summary?.total === 0}
          emptyText="Bugün henüz yoklama alınmadı."
        >
          {summary ? (
            <div className="grid gap-3">
              <p className="text-2xl font-semibold tabular-nums">
                %{summary.rate}
                <span className="ml-2 text-sm font-normal text-muted-foreground">katılım</span>
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ['Geldi', summary.present],
                    ['Gelmedi', summary.absent],
                    ['Geç geldi', summary.late],
                    ['Mazeretli', summary.excused],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface-soft px-3 py-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-md font-semibold tabular-nums">{number(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </ListCard>
      )
    },
  }),
  defineCard({
    id: 'yonetici.son-kayitlar',
    roles: ['yonetici'],
    area: 'main',
    order: 300,
    component: ({ ctx }) => (
      <ListCard
        title="Son kayıtlar"
        description="Kuruma en son eklenen öğrenciler"
        state={ctx.state}
        isEmpty={ctx.data?.recentStudents.length === 0}
        emptyText="Henüz öğrenci kaydı yok."
      >
        <CardList label="Son kayıtlar">
          {ctx.data?.recentStudents.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Avatar name={row.name} size="small" />
              <span className="grid min-w-0">
                <strong className="font-medium [overflow-wrap:anywhere]">{row.name}</strong>
                <small className="text-sm text-muted-foreground">
                  {[row.className ?? '—', row.number].filter(Boolean).join(' · No: ')}
                </small>
              </span>
            </li>
          ))}
        </CardList>
      </ListCard>
    ),
  }),
  defineCard({
    id: 'yonetici.kampus-dolulugu',
    roles: ['yonetici'],
    area: 'side',
    order: 310,
    component: ({ ctx }) => {
      const occupancy = ctx.data ? campusOccupancy(ctx.data.campuses) : []
      return (
        <ListCard
          title="Kampüs dolulukları"
          description="Aktif öğrenci ve kontenjan"
          state={ctx.state}
          isEmpty={occupancy.length === 0}
          emptyText="Aktif kampüs bulunmuyor."
        >
          <CardList label="Kampüs dolulukları">
            {occupancy.map((campus) => (
              <li key={campus.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to={dashboardHref(ctx.role, 'subeler', { kampus: campus.id })}
                    className="min-h-6 font-medium [overflow-wrap:anywhere] hover:underline"
                  >
                    {campus.name}
                  </Link>
                  <span className="text-sm whitespace-nowrap tabular-nums">
                    <strong className="font-semibold">{number(campus.students)}</strong>
                    <span className="text-muted-foreground"> / {number(campus.capacity)}</span>
                  </span>
                </div>
                <ShareBar value={campus.percentage} />
              </li>
            ))}
          </CardList>
        </ListCard>
      )
    },
  }),
]
