import { Link } from 'react-router'
import { money, number } from '@kampus/school-core/lib/format.ts'
import { useDashboard } from '@kampus/react-shared/use-dashboard.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import type { Session } from '@/auth/auth-port.ts'
import { CollectionTrend } from './CollectionTrend.tsx'
import {
  CardList,
  combineStates,
  DashboardGrid,
  ListCard,
  ShareBar,
  StatCard,
  StatGrid,
} from './DashboardParts.tsx'
import {
  attendanceSummary,
  campusOccupancy,
  dashboardHref,
  invoiceStatusSlices,
  outstandingAmount,
  sectionVisible,
} from './dashboard-model.ts'

const SLICE_TONE = { gecikmis: 'warning', yaklasan: 'primary', odendi: 'success' } as const

/**
 * Yönetici Genel Bakış (Vue `Dashboard.vue` yönetici): öğrenci, sınıf ve kadro sayıları; taksit
 * durumu dağılımı (tutar kuruş → TL); bugünkü yoklama; son kayıtlar ve kampüs doluluğu. Bütün
 * değerler tek özet isteğinden gelir (`GET /api/v1/dashboard`, `useDashboard`); kartlar ilgili
 * listeyi filtresi adreste açar. Kapalı modülün bölümü sunucuda `null`'dır ve kartı çizilmez.
 */
export function AdminDashboard({ session }: { session: Session }) {
  const role = session.role
  const query = useDashboard('yonetici')
  const data = query.data ?? null
  const state = combineStates(query)
  const loaded = data !== null
  const finance = sectionVisible(data?.finance, loaded, session.modules.finance === true)
  const academic = sectionVisible(data?.attendanceToday, loaded, session.modules.academic === true)

  const invoices = data?.finance?.invoices
  const slices = invoices ? invoiceStatusSlices(invoices) : []
  const overdue = slices.find((slice) => slice.key === 'gecikmis')
  const summary = data?.attendanceToday ? attendanceSummary(data.attendanceToday) : null
  const occupancy = data ? campusOccupancy(data.campuses) : []
  const archived = data?.students.archived ?? 0

  return (
    <>
      <StatGrid label="Kurum özeti">
        <StatCard
          label="Aktif öğrenci"
          icon="GraduationCap"
          value={number(data?.students.active)}
          note={archived ? `${number(archived)} öğrenci arşivde` : 'Arşivde öğrenci yok'}
          href={dashboardHref(role, 'subeler')}
          state={state}
        />
        <StatCard
          label="Aktif sınıf"
          icon="School"
          value={number(data?.classes.active)}
          note={`${number(data?.classes.campusCount)} kampüste`}
          href={dashboardHref(role, 'subeler')}
          state={state}
        />
        <StatCard
          label="Öğretmen kadrosu"
          icon="UsersRound"
          value={number(data?.teachers.active)}
          note="Aktif öğretmen"
          href={dashboardHref(role, 'personel')}
          state={state}
        />
        {finance ? (
          <StatCard
            label="Bugünkü tahsilat"
            icon="CircleCheck"
            value={money(data?.finance?.collectedToday.amount ?? 0)}
            note={`${number(data?.finance?.collectedToday.count ?? 0)} taksit bugün ödendi`}
            href={dashboardHref(role, 'finans', { durum: 'odendi' })}
            state={state}
          />
        ) : null}
        {finance ? (
          <StatCard
            label="Bekleyen tahsilat"
            icon="Wallet"
            value={money(invoices ? outstandingAmount(invoices) : 0)}
            note={`${number(overdue?.count)} gecikmiş taksit`}
            href={dashboardHref(role, 'finans', { durum: 'gecikmis' })}
            state={state}
          />
        ) : null}
      </StatGrid>

      <DashboardGrid>
        {finance ? (
          <ListCard
            title="Taksit durumu"
            description={`Ödeme planı toplamı ${money(invoices?.amount)} · ${number(invoices?.total)} taksit`}
            action={{ label: 'Finansı aç', href: dashboardHref(role, 'finans') }}
            state={state}
            isEmpty={invoices?.total === 0}
            emptyText="Henüz ödeme planı oluşturulmadı."
          >
            <CardList label="Taksit durumları">
              {slices.map((slice) => (
                <li key={slice.key} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <Link
                      to={dashboardHref(role, 'finans', { durum: slice.key })}
                      className="inline-flex min-h-6 items-center gap-2 font-medium hover:underline"
                    >
                      <StatusBadge text={slice.label} />
                      <span>{number(slice.count)} taksit</span>
                    </Link>
                    <span className="text-md font-semibold tabular-nums">
                      {money(slice.amount)}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        %{slice.share}
                      </span>
                    </span>
                  </div>
                  <ShareBar value={slice.share} tone={SLICE_TONE[slice.key]} />
                </li>
              ))}
            </CardList>
          </ListCard>
        ) : null}
        {academic ? (
          <ListCard
            title="Bugünkü yoklama"
            description="Bugün alınan yoklama kayıtları"
            state={state}
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
        ) : null}
      </DashboardGrid>

      {finance ? (
        <DashboardGrid>
          <CollectionTrend
            monthly={data?.finance?.monthlyCollection}
            state={state}
            href={dashboardHref(role, 'finans', { durum: 'odendi' })}
          />
        </DashboardGrid>
      ) : null}

      <DashboardGrid>
        <ListCard
          title="Son kayıtlar"
          description="Kuruma en son eklenen öğrenciler"
          state={state}
          isEmpty={data?.recentStudents.length === 0}
          emptyText="Henüz öğrenci kaydı yok."
        >
          <CardList label="Son kayıtlar">
            {data?.recentStudents.map((row) => (
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
        <ListCard
          title="Kampüs dolulukları"
          description="Aktif öğrenci ve kontenjan"
          state={state}
          isEmpty={occupancy.length === 0}
          emptyText="Aktif kampüs bulunmuyor."
        >
          <CardList label="Kampüs dolulukları">
            {occupancy.map((campus) => (
              <li key={campus.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to={dashboardHref(role, 'subeler', { kampus: campus.id })}
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
      </DashboardGrid>
    </>
  )
}
