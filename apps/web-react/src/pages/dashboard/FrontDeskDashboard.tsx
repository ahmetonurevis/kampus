import { dateLabel, dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { useDashboard } from '@kampus/react-shared/use-dashboard.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import type { Session } from '@/auth/auth-port.ts'
import {
  CardList,
  combineStates,
  DashboardGrid,
  ListCard,
  StatCard,
  StatGrid,
} from './DashboardParts.tsx'
import { StudentName } from './StudentName.tsx'
import {
  dashboardHref,
  invoiceStatusSlices,
  sectionVisible,
  type InvoiceRow,
} from './dashboard-model.ts'

const PAGE_PATH = 'tahsilat-takip'

/**
 * Ön büro Genel Bakış (Vue `Dashboard.vue` ön büro): gecikmiş ve yaklaşan taksit sayıları/tutarları,
 * öncelikli taksit listeleri, son tahsilatlar ve (CRM açıksa) görüşme bekleyen adaylar. Bütün
 * değerler tek özet isteğinden gelir (`useDashboard`); "Bugünkü tahsilat" sunucuda `paidAt` günüyle
 * toplanır, öğrenci adları satırın bağlı adıdır.
 */
export function FrontDeskDashboard({ session }: { session: Session }) {
  const role = session.role
  const query = useDashboard('onburo')
  const data = query.data ?? null
  const state = combineStates(query)
  const loaded = data !== null
  const finance = sectionVisible(data?.finance, loaded, session.modules.finance === true)
  const crm = sectionVisible(data?.prospects, loaded, session.modules.crm === true)
  const today = data?.today ?? ''

  const slices = data?.finance ? invoiceStatusSlices(data.finance.invoices) : []
  const slice = (key: 'gecikmis' | 'yaklasan' | 'odendi') => slices.find((s) => s.key === key)
  const stageCount = (stage: string) =>
    data?.prospects?.stages.find((item) => item.stage === stage)?.count ?? 0

  return (
    <>
      <StatGrid label="Tahsilat özeti">
        {finance ? (
          <>
            <StatCard
              label="Gecikmiş taksit"
              icon="Timer"
              value={number(slice('gecikmis')?.count)}
              note={`${money(slice('gecikmis')?.amount)} tahsilat bekliyor`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'gecikmis' })}
              state={state}
            />
            <StatCard
              label="Yaklaşan taksit"
              icon="CalendarDays"
              value={number(slice('yaklasan')?.count)}
              note={`${money(slice('yaklasan')?.amount)} vadesi gelmedi`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'yaklasan' })}
              state={state}
            />
            <StatCard
              label="Bugünkü tahsilat"
              icon="CircleCheck"
              value={money(data?.finance?.collectedToday.amount ?? 0)}
              note={`${number(data?.finance?.collectedToday.count ?? 0)} taksit bugün ödendi`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'odendi' })}
              state={state}
            />
            <StatCard
              label="Tahsil edilen"
              icon="Wallet"
              value={money(slice('odendi')?.amount)}
              note={`${number(slice('odendi')?.count)} taksit ödendi`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'odendi' })}
              state={state}
            />
          </>
        ) : null}
        {crm ? (
          <StatCard
            label="Görüşme bekleyen aday"
            icon="ContactRound"
            value={number(stageCount('Yeni aday'))}
            note={`${number(stageCount('Kayıt oldu'))} aday kesin kayıt oldu`}
            href={dashboardHref(role, 'adaylar')}
            state={state}
          />
        ) : null}
      </StatGrid>

      {finance ? (
        <>
          <DashboardGrid>
            <ListCard
              title="Gecikmiş taksitler"
              description="Vadesi en eski olanlar önce"
              action={{
                label: 'Tümünü gör',
                href: dashboardHref(role, PAGE_PATH, { durum: 'gecikmis' }),
              }}
              state={state}
              isEmpty={data?.finance?.overdue.length === 0}
              emptyText="Gecikmiş taksit bulunmuyor."
            >
              <InvoiceList label="Gecikmiş taksitler" rows={data?.finance?.overdue} />
            </ListCard>
            <ListCard
              title="Yaklaşan taksitler"
              description="Vadesi en yakın olanlar"
              action={{
                label: 'Tümünü gör',
                href: dashboardHref(role, PAGE_PATH, { durum: 'yaklasan' }),
              }}
              state={state}
              isEmpty={data?.finance?.upcoming.length === 0}
              emptyText="Yaklaşan taksit bulunmuyor."
            >
              <InvoiceList label="Yaklaşan taksitler" rows={data?.finance?.upcoming} compact />
            </ListCard>
          </DashboardGrid>
          <DashboardGrid>
            <ListCard
              title="Son tahsilatlar"
              description="En son kaydedilen ödemeler; bugün ödenenler işaretli"
              action={{
                label: 'Tümünü gör',
                href: dashboardHref(role, PAGE_PATH, { durum: 'odendi' }),
              }}
              state={state}
              isEmpty={data?.finance?.recentPayments.length === 0}
              emptyText="Henüz tahsilat kaydı yok."
            >
              <InvoiceList
                label="Son tahsilatlar"
                rows={data?.finance?.recentPayments}
                today={today}
              />
            </ListCard>
            {crm ? (
              <ListCard
                title="Aday aşamaları"
                description="CRM'deki adayların dağılımı"
                action={{ label: 'Adayları aç', href: dashboardHref(role, 'adaylar') }}
                state={state}
                isEmpty={data?.prospects?.total === 0}
                emptyText="Henüz aday kaydı yok."
              >
                <CardList label="Aday aşamaları">
                  {data?.prospects?.stages.map((group) => (
                    <li
                      key={String(group.stage)}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <span>{group.stage ?? 'Aşama yok'}</span>
                      <strong className="font-semibold tabular-nums">{number(group.count)}</strong>
                    </li>
                  ))}
                </CardList>
              </ListCard>
            ) : null}
          </DashboardGrid>
        </>
      ) : null}
    </>
  )
}

type InvoiceListProps = {
  label: string
  rows: readonly InvoiceRow[] | undefined
  /** Dar sütunda tutar ve vade alt satıra iner. */
  compact?: boolean
  /** Verilirse ödeme günü gösterilir; bugün ödenenler rozetle işaretlenir. */
  today?: string
}

function InvoiceList({ label, rows, compact = false, today }: InvoiceListProps) {
  return (
    <CardList label={label}>
      {rows?.map((row) => {
        const paidToday = today !== undefined && !!row.paidAt && dayKey(row.paidAt) === today
        const detail =
          today !== undefined && row.paidAt
            ? `${row.installment}. taksit · ödeme ${dateLabel(row.paidAt, { year: 'numeric' })}`
            : `${row.installment}. taksit · vade ${row.dueDate ? dateLabel(row.dueDate, { year: 'numeric' }) : '—'}`
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <StudentName name={row.studentName} detail={detail} />
            <span
              className={
                compact
                  ? 'ml-11 text-md font-semibold tabular-nums'
                  : 'flex items-center gap-2 text-md font-semibold tabular-nums'
              }
            >
              {money(row.amount)}
              {paidToday ? <StatusBadge text="Bugün" tone="green" /> : null}
            </span>
          </li>
        )
      })}
    </CardList>
  )
}
