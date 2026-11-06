import { useMemo, useState } from 'react'
import {
  useReferralRewards,
  type ReferralReward,
} from '@kampus/react-shared/use-finance-referrals.ts'
import {
  REFERRAL_CANCEL_REASON_LABELS,
  REFERRAL_REWARD_STATUSES,
  REFERRAL_REWARD_STATUS_LABELS,
  type ReferralRewardStatus,
} from '@kampus/school-core/lib/finance-referrals.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { referralValueLabel } from './referral-forms.ts'

const NO_SORT: readonly string[] = []
const STAFF_MOBILE = ['referrer', 'status', 'value']
const FAMILY_MOBILE = ['referrer', 'status', 'used']
const STATUS_TONES = {
  pending: 'amber',
  available: 'green',
  used: 'gray',
  cancelled: 'red',
} as const satisfies Record<ReferralRewardStatus, 'amber' | 'green' | 'gray' | 'red'>

const statusCell = (row: ReferralReward) => (
  <StatusBadge text={REFERRAL_REWARD_STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />
)
const usedCell = (row: ReferralReward) =>
  row.usedAmountCents === null ? '—' : money(row.usedAmountCents)

/**
 * Personelin referans hakkı listesi (Finans "Referans hakları"; DOM-FIN-024). Hak kesin kayıtta
 * açılır, ilk taksitle doğar, kesin kayıt ya da yenileme formunda kullanılır; burada yalnız izlenir.
 * Nakit ya da para iadesi karşılığı yoktur.
 */
export function ReferralRewardsSection() {
  const [status, setStatus] = useState<ReferralRewardStatus | ''>('')
  const list = useListState('referans-haklari', { resetKey: status })
  const rewards = useReferralRewards({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === '' ? {} : { status }),
  })
  const columns = useMemo<DataColumn<ReferralReward>[]>(
    () => [
      { key: 'referrer', label: 'Referans veren', cell: (row) => row.referrerStudentName ?? '—' },
      { key: 'referred', label: 'Referansla gelen', cell: (row) => row.referredStudentName ?? '—' },
      { key: 'academicYear', label: 'Eğitim yılı' },
      { key: 'value', label: 'Tarife değeri', cell: referralValueLabel },
      { key: 'status', label: 'Durum', cell: statusCell },
      { key: 'used', label: 'Kullanılan tutar', cell: usedCell },
      {
        key: 'reason',
        label: 'İptal nedeni',
        cell: (row) => (row.cancelReason ? REFERRAL_CANCEL_REASON_LABELS[row.cancelReason] : '—'),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="referans-haklari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="referans-haklari" className="text-lg font-semibold">
            Referans hakları
          </h2>
          <p className="text-sm text-muted-foreground">
            Hak, referansla gelen kaydın ilk taksiti ödenince doğar ve sonraki kesin kayıt ya da
            yenilemede bir kez indirim olarak kullanılır.
          </p>
        </div>
        <FormField id="referans-durum" label="Durum">
          {(control) => (
            <NativeSelect
              {...control}
              value={status}
              onChange={(event) => setStatus(event.target.value as ReferralRewardStatus | '')}
            >
              <NativeSelectOption value="">Tümü</NativeSelectOption>
              {REFERRAL_REWARD_STATUSES.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {REFERRAL_REWARD_STATUS_LABELS[item]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </header>
      <ServerDataTable
        list={list}
        rows={rewards.data?.data}
        total={rewards.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={STAFF_MOBILE}
        caption="Referans hakları"
        search={false}
        loading={rewards.isPending}
        fetching={rewards.isFetching && !rewards.isPending}
        error={
          rewards.error ? (
            <QueryError error={rewards.error} onRetry={() => void rewards.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}

/**
 * Ailenin referans hakları (DOM-FIN-024): veli ve kursiyer ödeme sayfasında kendi hakkını görür. Aday
 * ve referansla gelen öğrenci yanıtta yoktur, doğmamış hak listelenmez (KVKK). Hak yoksa bölüm çıkmaz.
 */
export function FamilyReferralRewards() {
  const list = useListState('referans-haklarim')
  const rewards = useReferralRewards({ page: list.state.page, pageSize: list.state.pageSize })
  const columns = useMemo<DataColumn<ReferralReward>[]>(
    () => [
      { key: 'referrer', label: 'Öğrenci', cell: (row) => row.referrerStudentName ?? '—' },
      { key: 'academicYear', label: 'Eğitim yılı' },
      { key: 'status', label: 'Durum', cell: statusCell },
      {
        key: 'used',
        label: 'Kullanıldı',
        cell: (row) =>
          row.usedAt === null
            ? '—'
            : `${usedCell(row)} · ${dateLabel(row.usedAt, { year: 'numeric' })}`,
      },
    ],
    [],
  )
  if (!rewards.error && (rewards.data?.meta.total ?? 0) === 0) return null
  return (
    <section
      aria-labelledby="referans-haklarim"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="referans-haklarim" className="text-lg font-semibold">
          Referans haklarım
        </h2>
        <p className="text-sm text-muted-foreground">
          Hak, okulla yapacağınız sonraki sözleşme ya da yenilemede bir kez indirim olarak
          uygulanır; nakit karşılığı yoktur.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rewards.data?.data}
        total={rewards.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={FAMILY_MOBILE}
        caption="Referans haklarım"
        search={false}
        loading={rewards.isPending}
        fetching={rewards.isFetching && !rewards.isPending}
        error={
          rewards.error ? (
            <QueryError error={rewards.error} onRetry={() => void rewards.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}
