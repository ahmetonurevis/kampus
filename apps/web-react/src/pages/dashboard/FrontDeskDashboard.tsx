import { dateLabel, dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { INVOICE_STATUS_LABELS } from '@kampus/school-core/lib/format.ts'
import { countOf, sumOf } from '@kampus/react-shared/collections.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreCounts, useCoreList, type CoreRow } from '@/hooks/use-core-collection.ts'
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
import { dashboardHref, invoiceStatusSlices } from './dashboard-model.ts'

const PAGE_PATH = 'tahsilat-takip'
const LIST_SIZE = 5

/**
 * Ön büro Genel Bakış (Vue `Dashboard.vue` ön büro): gecikmiş ve yaklaşan taksit sayıları/tutarları,
 * öncelikli taksit listeleri, son tahsilatlar ve (CRM açıksa) görüşme bekleyen adaylar. "Bugünkü
 * tahsilat" `paidAt` günü süzgeciyle sunucuda toplanır; öğrenci adları satırın `joined` alanından
 * gelir.
 */
export function FrontDeskDashboard({ session, now }: { session: Session; now: Date }) {
  const role = session.role
  const finance = session.modules.finance === true
  const crm = session.modules.crm === true
  const today = dayKey(now)

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
  const prospects = useCoreCounts('prospects', { groupBy: 'stage' }, { enabled: crm })
  const overdue = useCoreList(
    'invoices',
    { filters: { status: INVOICE_STATUS_LABELS.gecikmis }, sort: ['dueDate'], pageSize: LIST_SIZE },
    { enabled: finance },
  )
  const upcoming = useCoreList(
    'invoices',
    { filters: { status: INVOICE_STATUS_LABELS.yaklasan }, sort: ['dueDate'], pageSize: LIST_SIZE },
    { enabled: finance },
  )
  const paid = useCoreList(
    'invoices',
    {
      filters: { status: INVOICE_STATUS_LABELS.odendi },
      sort: ['-updatedAt', '-dueDate'],
      pageSize: LIST_SIZE,
    },
    { enabled: finance },
  )

  const slices = invoices.data ? invoiceStatusSlices(invoices.data) : []
  const slice = (key: 'gecikmis' | 'yaklasan' | 'odendi') => slices.find((s) => s.key === key)
  const invoiceState = combineStates(invoices)

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
              state={invoiceState}
            />
            <StatCard
              label="Yaklaşan taksit"
              icon="CalendarDays"
              value={number(slice('yaklasan')?.count)}
              note={`${money(slice('yaklasan')?.amount)} vadesi gelmedi`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'yaklasan' })}
              state={invoiceState}
            />
            <StatCard
              label="Bugünkü tahsilat"
              icon="CircleCheck"
              value={money(sumOf(collectedToday.data, INVOICE_STATUS_LABELS.odendi))}
              note={`${number(countOf(collectedToday.data, INVOICE_STATUS_LABELS.odendi))} taksit bugün ödendi`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'odendi' })}
              state={combineStates(collectedToday)}
            />
            <StatCard
              label="Tahsil edilen"
              icon="Wallet"
              value={money(slice('odendi')?.amount)}
              note={`${number(slice('odendi')?.count)} taksit ödendi`}
              href={dashboardHref(role, PAGE_PATH, { durum: 'odendi' })}
              state={invoiceState}
            />
          </>
        ) : null}
        {crm ? (
          <StatCard
            label="Görüşme bekleyen aday"
            icon="ContactRound"
            value={number(countOf(prospects.data, 'Yeni aday'))}
            note={`${number(countOf(prospects.data, 'Kayıt oldu'))} aday kesin kayıt oldu`}
            href={dashboardHref(role, 'adaylar')}
            state={combineStates(prospects)}
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
              state={combineStates(overdue)}
              isEmpty={overdue.data?.rows.length === 0}
              emptyText="Gecikmiş taksit bulunmuyor."
            >
              <InvoiceList label="Gecikmiş taksitler" rows={overdue.data?.rows} />
            </ListCard>
            <ListCard
              title="Yaklaşan taksitler"
              description="Vadesi en yakın olanlar"
              action={{
                label: 'Tümünü gör',
                href: dashboardHref(role, PAGE_PATH, { durum: 'yaklasan' }),
              }}
              state={combineStates(upcoming)}
              isEmpty={upcoming.data?.rows.length === 0}
              emptyText="Yaklaşan taksit bulunmuyor."
            >
              <InvoiceList label="Yaklaşan taksitler" rows={upcoming.data?.rows} compact />
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
              state={combineStates(paid)}
              isEmpty={paid.data?.rows.length === 0}
              emptyText="Henüz tahsilat kaydı yok."
            >
              <InvoiceList label="Son tahsilatlar" rows={paid.data?.rows} today={today} />
            </ListCard>
            {crm ? (
              <ListCard
                title="Aday aşamaları"
                description="CRM'deki adayların dağılımı"
                action={{ label: 'Adayları aç', href: dashboardHref(role, 'adaylar') }}
                state={combineStates(prospects)}
                isEmpty={prospects.data?.total === 0}
                emptyText="Henüz aday kaydı yok."
              >
                <CardList label="Aday aşamaları">
                  {prospects.data?.groups.map((group) => (
                    <li
                      key={String(group.value)}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <span>{group.value === null ? 'Aşama yok' : String(group.value)}</span>
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
  rows: readonly CoreRow<'invoices'>[] | undefined
  /** Dar sütunda tutar ve vade alt satıra iner. */
  compact?: boolean
  /** Verilirse ödeme günü gösterilir; bugün ödenenler rozetle işaretlenir. */
  today?: string
}

function InvoiceList({ label, rows, compact = false, today }: InvoiceListProps) {
  return (
    <CardList label={label}>
      {rows?.map(({ id, record, joined }) => {
        const paidToday = today !== undefined && !!record.paidAt && dayKey(record.paidAt) === today
        const detail =
          today !== undefined && record.paidAt
            ? `${record.installment}. taksit · ödeme ${dateLabel(record.paidAt, { year: 'numeric' })}`
            : `${record.installment}. taksit · vade ${dateLabel(record.dueDate, { year: 'numeric' })}`
        return (
          <li
            key={id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <StudentName name={joined?.studentName} detail={detail} />
            <span
              className={
                compact
                  ? 'ml-11 text-md font-semibold tabular-nums'
                  : 'flex items-center gap-2 text-md font-semibold tabular-nums'
              }
            >
              {money(record.amount)}
              {paidToday ? <StatusBadge text="Bugün" tone="green" /> : null}
            </span>
          </li>
        )
      })}
    </CardList>
  )
}
