import { useMemo } from 'react'
import { Link } from 'react-router'
import { dayKey, INVOICE_STATUS_LABELS, money, number } from '@kampus/school-core/lib/format.ts'
import { countOf, sumOf } from '@kampus/react-shared/collections.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll, useCoreCounts, useCoreList } from '@/hooks/use-core-collection.ts'
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
} from './dashboard-model.ts'

const ACTIVE = { isActive: 'true' } as const
const SLICE_TONE = { gecikmis: 'warning', yaklasan: 'primary', odendi: 'success' } as const

/**
 * Yönetici Genel Bakış (Vue `Dashboard.vue` yönetici): öğrenci, sınıf ve kadro sayıları; taksit
 * durumu dağılımı (tutar kuruş → TL); bugünkü yoklama; son kayıtlar ve kampüs doluluğu. Bütün
 * sayılar sunucu sayımından gelir; kartlar ilgili listeyi filtresi adreste açar. Bugünkü tahsilat
 * `paidAt` günü süzgeciyle, aylık tahsilat eğilimi `paidAt:month` gruplamasıyla sayılır.
 */
export function AdminDashboard({ session, now }: { session: Session; now: Date }) {
  const role = session.role
  const finance = session.modules.finance === true
  const academic = session.modules.academic === true
  const today = dayKey(now)

  const students = useCoreCounts('students', { groupBy: 'isActive' })
  const studentsByClass = useCoreCounts('students', { groupBy: 'classId', filters: ACTIVE })
  const classes = useCoreCounts('classes', {
    groupBy: 'branchId',
    sum: 'capacity',
    filters: ACTIVE,
  })
  const teachers = useCoreCounts('teachers', { groupBy: 'isActive' })
  const invoices = useCoreCounts(
    'invoices',
    { groupBy: 'status', sum: 'amount' },
    { enabled: finance },
  )
  const collectedToday = useCoreCounts(
    'invoices',
    {
      groupBy: 'status',
      sum: 'amount',
      filters: { dateField: 'paidAt', dateFrom: today, dateTo: today },
    },
    { enabled: finance },
  )
  const attendance = useCoreCounts(
    'attendance',
    { groupBy: 'status', filters: { dateFrom: today, dateTo: today } },
    { enabled: academic },
  )
  const recent = useCoreList('students', { sort: ['-createdAt'], pageSize: 5, filters: ACTIVE })
  const classRefs = useCoreAll('classes')
  const branchRefs = useCoreAll('branches', { filters: ACTIVE })

  const occupancy = useMemo(() => {
    if (!classRefs.data || !branchRefs.data || !studentsByClass.data || !classes.data) return []
    const classBranch = new Map(classRefs.data.map((row) => [row.record.id, row.record.branchId]))
    return campusOccupancy(
      branchRefs.data.map((row) => row.record),
      classBranch,
      studentsByClass.data,
      classes.data,
    )
  }, [classRefs.data, branchRefs.data, studentsByClass.data, classes.data])

  const slices = invoices.data ? invoiceStatusSlices(invoices.data) : []
  const overdue = slices.find((slice) => slice.key === 'gecikmis')
  const summary = attendance.data ? attendanceSummary(attendance.data) : null
  const campusCount = classes.data?.groups.filter((group) => group.value !== null).length ?? 0

  return (
    <>
      <StatGrid label="Kurum özeti">
        <StatCard
          label="Aktif öğrenci"
          icon="GraduationCap"
          value={number(countOf(students.data, true))}
          note={
            countOf(students.data, false)
              ? `${number(countOf(students.data, false))} öğrenci arşivde`
              : 'Arşivde öğrenci yok'
          }
          href={dashboardHref(role, 'subeler')}
          state={combineStates(students)}
        />
        <StatCard
          label="Aktif sınıf"
          icon="School"
          value={number(classes.data?.total)}
          note={`${number(campusCount)} kampüste`}
          href={dashboardHref(role, 'subeler')}
          state={combineStates(classes)}
        />
        <StatCard
          label="Öğretmen kadrosu"
          icon="UsersRound"
          value={number(countOf(teachers.data, true))}
          note="Aktif öğretmen"
          href={dashboardHref(role, 'personel')}
          state={combineStates(teachers)}
        />
        {finance ? (
          <StatCard
            label="Bugünkü tahsilat"
            icon="CircleCheck"
            value={money(sumOf(collectedToday.data, INVOICE_STATUS_LABELS.odendi))}
            note={`${number(countOf(collectedToday.data, INVOICE_STATUS_LABELS.odendi))} taksit bugün ödendi`}
            href={dashboardHref(role, 'finans', { durum: 'odendi' })}
            state={combineStates(collectedToday)}
          />
        ) : null}
        {finance ? (
          <StatCard
            label="Bekleyen tahsilat"
            icon="Wallet"
            value={money(invoices.data ? outstandingAmount(invoices.data) : 0)}
            note={`${number(overdue?.count)} gecikmiş taksit`}
            href={dashboardHref(role, 'finans', { durum: 'gecikmis' })}
            state={combineStates(invoices)}
          />
        ) : null}
      </StatGrid>

      <DashboardGrid>
        {finance ? (
          <ListCard
            title="Taksit durumu"
            description={`Ödeme planı toplamı ${money(invoices.data?.sum)} · ${number(invoices.data?.total)} taksit`}
            action={{ label: 'Finansı aç', href: dashboardHref(role, 'finans') }}
            state={combineStates(invoices)}
            isEmpty={invoices.data?.total === 0}
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
            state={combineStates(attendance)}
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
          <CollectionTrend now={now} href={dashboardHref(role, 'finans', { durum: 'odendi' })} />
        </DashboardGrid>
      ) : null}

      <DashboardGrid>
        <ListCard
          title="Son kayıtlar"
          description="Kuruma en son eklenen öğrenciler"
          state={combineStates(recent)}
          isEmpty={recent.data?.rows.length === 0}
          emptyText="Henüz öğrenci kaydı yok."
        >
          <CardList label="Son kayıtlar">
            {recent.data?.rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <Avatar name={row.record.name} size="small" />
                <span className="grid min-w-0">
                  <strong className="font-medium [overflow-wrap:anywhere]">
                    {row.record.name}
                  </strong>
                  <small className="text-sm text-muted-foreground">
                    {[row.joined?.className ?? '—', row.record.number]
                      .filter(Boolean)
                      .join(' · No: ')}
                  </small>
                </span>
              </li>
            ))}
          </CardList>
        </ListCard>
        <ListCard
          title="Kampüs dolulukları"
          description="Aktif öğrenci ve kontenjan"
          state={combineStates(classRefs, branchRefs, studentsByClass, classes)}
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
