import { useMemo, useState } from 'react'
import { View } from 'react-native'
import {
  usePaymentList,
  useReversePayment,
  useSetPaymentMebbis,
} from '@kampus/react-shared/use-payment-commands.ts'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@kampus/school-core/lib/payments.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  Badge,
  Button,
  DateField,
  Empty,
  Field,
  SearchField,
  Select,
  Sheet,
  T,
} from '../../ui/components.tsx'
import {
  DetailPair,
  EmptyResults,
  ListRow,
  Notice,
  Pagination,
  TextAction,
} from '../../ui/SchoolLayout.tsx'
import { createFieldCollector } from '../command-failure.ts'
import {
  canReversePayment,
  isReversedRange,
  mebbisActionLabel,
  NO_PAYMENT_FILTERS,
  paymentCommandFailure,
  paymentFacts,
  paymentListItem,
  paymentListQuery,
  paymentReceipt,
  readPaymentFilters,
  REVERSED_RANGE_MESSAGE,
  reverseReasonError,
  writePaymentFilters,
  type PaymentFilters,
  type PaymentRecord,
} from '../finance-staff.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import type { MemberRole } from '../session-state.ts'
import { useNotify } from '../toast.tsx'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'
import { FieldError } from './finance-form-parts.tsx'

const METHOD_OPTIONS = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_METHOD_LABELS[method],
}))
const MEBBIS_OPTIONS = [{ value: 'pending', label: 'İşlenmemiş' }]

/**
 * Tahsilat geçmişi (web `PaymentsSection` eşi; DOM-FIN-030, -032, -033): her ödeme ayrı satırdır, en
 * yeni önce. Arama, yöntem, MEBBİS ve ödeme günü süzgeci sunucudadır; ters aralık gönderilmez.
 * Dokununca ayrıntı açılır: MEBBİS işareti ve (yalnız yönetici) gerekçeli iptal.
 */
export function FinancePayments({ role }: { role: MemberRole }) {
  const { state, setSearch, setFilter, setIndex, clear } = useListMemory('finans:tahsilatlar')
  const search = useDebouncedValue(state.search)
  const query = useMemo(() => paymentListQuery(state, search), [state, search])
  const list = usePaymentList(query)
  const total = list.data?.meta.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const [selectedId, setSelectedId] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const filters = readPaymentFilters(state.filter)
  const reversed = isReversedRange(filters)
  const rows = list.data?.data
  // Kayıt listeden okunur: işlem sonrası tazelenen satır pencereye de yansır (`If-Match` güncel kalır).
  const selected = rows?.find((row) => row.id === selectedId)
  const setFilters = (patch: Partial<PaymentFilters>) =>
    setFilter(writePaymentFilters({ ...filters, ...patch }))

  return (
    <View style={{ gap: 12 }}>
      <SearchField
        value={state.search}
        onChange={setSearch}
        placeholder="Öğrenci adı veya işlem referansı"
      />
      <TextAction onPress={() => setShowFilters(!showFilters)}>
        {showFilters ? 'Süzgeçleri gizle' : state.filter ? 'Süzgeçler (etkin)' : 'Süzgeçler'}
      </TextAction>
      {showFilters && (
        <View style={{ gap: 12 }}>
          <Select
            label="Ödeme yöntemi"
            value={filters.method}
            options={METHOD_OPTIONS}
            onChange={(method) =>
              setFilters({ method: METHOD_OPTIONS.find((o) => o.value === method)?.value ?? '' })
            }
          />
          <Select
            label="MEBBİS durumu"
            value={filters.mebbisPending ? 'pending' : ''}
            options={MEBBIS_OPTIONS}
            onChange={(value) => setFilters({ mebbisPending: value === 'pending' })}
          />
          <DateField
            label="Ödeme günü (başlangıç)"
            value={filters.from}
            onChange={(from) => setFilters({ from })}
          />
          <DateField
            label="Ödeme günü (bitiş)"
            value={filters.to}
            onChange={(to) => setFilters({ to })}
          />
          <FieldError text={reversed ? REVERSED_RANGE_MESSAGE : undefined} />
          {state.filter !== '' && (
            <TextAction onPress={() => setFilter(writePaymentFilters(NO_PAYMENT_FILTERS))}>
              Süzgeçleri temizle
            </TextAction>
          )}
        </View>
      )}
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !rows ? (
        <ListLoading label="Tahsilatlar yükleniyor…" />
      ) : rows.length === 0 ? (
        state.search.trim() !== '' || state.filter !== '' ? (
          <EmptyResults noun="tahsilat" onClear={clear} />
        ) : (
          <Empty title="Tahsilat yok" text="Kaydedilen tahsilatlar burada görünür." />
        )
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {rows.map((row) => {
              const item = paymentListItem(row)
              return (
                <ListRow
                  key={row.id}
                  card
                  title={item.title}
                  subtitle={item.subtitle}
                  eyebrow={item.amount}
                  badge={<Badge text={item.status} />}
                  label={item.label}
                  onPress={() => setSelectedId(row.id)}
                />
              )
            })}
          </View>
          <Pagination
            count={total ?? rows.length}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      {selected && (
        <PaymentDetailSheet
          key={selected.id}
          payment={selected}
          role={role}
          onClose={() => setSelectedId('')}
        />
      )}
    </View>
  )
}

/**
 * Tahsilat ayrıntısı. MEBBİS işareti platformun MEBBİS'e bağlandığı anlamına gelmez, kurumun takibidir
 * (DOM-FIN-032). İptal edilen satır silinmez, işlem düğmeleri kalkar. Hata pencerede gösterilir.
 * Dekont PDF'i web'dedir; belge motoru paylaşılan pakete taşınınca telefona gelir (OG-112).
 */
function PaymentDetailSheet({
  payment,
  role,
  onClose,
}: {
  payment: PaymentRecord
  role: MemberRole
  onClose: () => void
}) {
  const notify = useNotify()
  const mebbis = useSetPaymentMebbis()
  const [reversing, setReversing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const active = payment.reversedAt === null

  async function toggleMebbis() {
    if (mebbis.isPending) return
    setMessage(null)
    const collector = createFieldCollector()
    const recorded = payment.mebbisRecordedAt === null
    const outcome = await mebbis.submit(
      { paymentId: payment.id, version: payment.version, recorded },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'success')
      notify(recorded ? 'MEBBİS işareti kaydedildi.' : 'MEBBİS işareti kaldırıldı.')
    else if (outcome.status === 'failed')
      setMessage(paymentCommandFailure(outcome.error, collector.fields).message)
  }

  if (reversing)
    return <ReverseSheet payment={payment} onBack={() => setReversing(false)} onClose={onClose} />
  return (
    <Sheet
      visible
      title="Tahsilat ayrıntısı"
      onClose={onClose}
      footer={
        <View style={{ gap: 10 }}>
          {message && <Notice tone="red" title="İşlem tamamlanamadı" text={message} />}
          {active && (
            <Button
              icon="ClipboardCheck"
              disabled={mebbis.isPending}
              label={`${paymentReceipt(payment)} numaralı tahsilatın MEBBİS işaretini değiştir`}
              onPress={() => void toggleMebbis()}
            >
              {mebbis.isPending ? 'Kaydediliyor…' : mebbisActionLabel(payment)}
            </Button>
          )}
          {active && canReversePayment(role) && (
            <Button
              danger
              label={`${paymentReceipt(payment)} numaralı tahsilatı iptal et`}
              onPress={() => setReversing(true)}
            >
              İptal et
            </Button>
          )}
          <Button onPress={onClose}>Kapat</Button>
        </View>
      }
    >
      <View style={{ gap: 12 }}>
        {paymentFacts(payment).map(([label, value]) => (
          <DetailPair key={label} label={label} value={value} />
        ))}
      </View>
      <T muted size={14}>
        Dekont belgesi web uygulamasından alınır.
      </T>
    </Sheet>
  )
}

/**
 * Tahsilat iptali (yalnız yönetici; DOM-FIN-033): kayıt silinmez, dağıtıldığı taksitler yeniden
 * açılır. Belirsiz sonuçta yalnız aynı gerekçe yeniden gönderilir; aynı anahtar ikinci iptal açmaz.
 */
function ReverseSheet({
  payment,
  onBack,
  onClose,
}: {
  payment: PaymentRecord
  onBack: () => void
  onClose: () => void
}) {
  const notify = useNotify()
  const reverse = useReversePayment()
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = reverse.isPending

  async function submit() {
    if (pending) return
    const invalid = reverseReasonError(reason)
    if (invalid) {
      setFieldError(invalid)
      return
    }
    setFieldError(undefined)
    setMessage(null)
    const collector = createFieldCollector()
    const outcome = await reverse.submit(
      { paymentId: payment.id, version: payment.version, reason },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') {
      notify('Tahsilat iptal edildi.')
      onClose()
      return
    }
    const failure = paymentCommandFailure(outcome.error, collector.fields)
    if (failure.conflict) {
      notify(failure.message ?? 'Tahsilat değiştirildi. Liste güncellendi.', 'error')
      onClose()
      return
    }
    setFieldError(failure.reason)
    setMessage(failure.message)
    setUncertain(failure.uncertain)
  }

  return (
    <Sheet
      visible
      title="Tahsilatı iptal et"
      onClose={pending ? () => undefined : onClose}
      pinFooter
      footer={
        <View style={{ gap: 10 }}>
          {message && (
            <Notice tone="red" title="Tahsilat iptal edilemedi" text={message}>
              {uncertain && (
                <T size={13}>İptal işlenmiş olabilir. Yeniden denemek ikinci iptal açmaz.</T>
              )}
            </Notice>
          )}
          <Button danger disabled={pending} onPress={() => void submit()}>
            {pending ? 'İptal ediliyor…' : uncertain ? 'Yeniden dene' : 'Tahsilatı iptal et'}
          </Button>
          <Button disabled={pending} onPress={onBack}>
            Vazgeç
          </Button>
        </View>
      }
    >
      <Notice
        title={`${paymentReceipt(payment)} · ${payment.studentName ?? '—'} · ${money(payment.amountCents)}`}
        text="Kayıt silinmez, dağıtıldığı taksitler yeniden açılır."
        tone="amber"
      />
      <Field
        label="İptal gerekçesi"
        value={reason}
        onChange={(text) => {
          setReason(text)
          setFieldError(undefined)
          setMessage(null)
          setUncertain(false)
        }}
        multiline
        maxLength={500}
        editable={!pending}
        {...(fieldError ? { error: fieldError } : {})}
      />
    </Sheet>
  )
}
