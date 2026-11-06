import { useMemo, useState } from 'react'
import { PROGRESSION_OUTCOMES } from '@kampus/school-core/cefr/progression.ts'
import {
  E_OZEL_ACADEMIC_KINDS,
  E_OZEL_KIND_LABELS,
  E_OZEL_KINDS,
  eOzelLearnerStatusLabel,
} from '@kampus/school-core/lib/finance-e-ozel.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  useEOzelExport,
  useEOzelItems,
  useSetEOzelMark,
  type EOzelFileQuery,
  type EOzelItemRow,
} from '@kampus/react-shared/use-finance-e-ozel.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'

type Row = EOzelItemRow & { id: string }

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['learnerName', 'kind', 'details', 'recordedAt']
const ALL_KINDS = 'all'
const BOM = '﻿'
const STATUS_OPTIONS = [
  { value: 'pending', label: 'İşlenmemiş' },
  { value: 'recorded', label: 'İşlendi' },
  { value: 'all', label: 'Tümü' },
] as const
type StatusValue = (typeof STATUS_OPTIONS)[number]['value']

const statusOf = (value: unknown): StatusValue =>
  STATUS_OPTIONS.find((option) => option.value === value)?.value ?? 'pending'
const dayFilter = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

/** Satırın türe özgü bilgisi; alan adları ister listesindeki e-Özel özetindendir. */
function Details({ row }: { row: Row }) {
  if (row.learner)
    return (
      <span className="grid">
        <span>
          {row.learner.maskedIdentity ?? 'Kimlik kaydı yok'}
          {row.learner.birthDate
            ? ` · ${dateLabel(row.learner.birthDate, { year: 'numeric' })}`
            : ''}
        </span>
        <small className="text-xs text-muted-foreground">
          {eOzelLearnerStatusLabel(row.learner.status)}
        </small>
      </span>
    )
  if (row.fee)
    return (
      <span className="grid">
        <strong className="font-semibold">{money(row.fee.amountCents)}</strong>
        <small className="text-xs text-muted-foreground">
          Dekont {row.fee.receipt} · {row.fee.method}
          {row.fee.reference ? ` · ${row.fee.reference}` : ''}
        </small>
      </span>
    )
  if (row.attendance)
    return (
      <span className="grid">
        <span>
          {[row.attendance.courseName, row.attendance.groupName].filter(Boolean).join(' · ') || '—'}
        </span>
        <small className="text-xs text-muted-foreground">
          {row.attendance.lessonHourId
            ? `Ders saati ${row.attendance.lessonHourId}`
            : 'Günlük yoklama'}
          {row.attendance.excused ? ' · Özürlü' : ''}
        </small>
      </span>
    )
  if (row.courseEnd)
    return (
      <span className="grid">
        <span>{PROGRESSION_OUTCOMES[row.courseEnd.outcome].label}</span>
        <small className="text-xs text-muted-foreground">
          {[row.courseEnd.courseName, row.courseEnd.groupName].filter(Boolean).join(' · ')}
          {row.courseEnd.certificateNumber ? ` · Belge ${row.courseEnd.certificateNumber}` : ''}
        </small>
      </span>
    )
  return '—'
}

/**
 * e-Özel işlem listesi (IST-085, DOM-KAY-015): dil okulu ve kursta elle girilecek kayıtlar ve
 * "işlendi" işareti. Süzgeç ve sayfa sunucudadır. Ücret satırının işareti tahsilat geçmişindeki
 * MEBBİS işaretiyle aynı kayıttır. Devamsızlık ve kurs sonu `academic` kapalıyken seçilemez.
 */
export function EOzelSection({ academicEnabled }: { academicEnabled: boolean }) {
  const list = useListState('e-ozel')
  const search = useDebouncedValue(list.state.query)
  const mark = useSetEOzelMark()
  const exporter = useEOzelExport()
  const [reauth, setReauth] = useState(false)

  const kinds = E_OZEL_KINDS.filter(
    (kind) => academicEnabled || !E_OZEL_ACADEMIC_KINDS.includes(kind),
  )
  const kind = kinds.find((item) => item === list.state.filters.kind)
  const status = statusOf(list.state.filters.status)
  const dateFrom = dayFilter(list.state.filters.dateFrom)
  const dateTo = dayFilter(list.state.filters.dateTo)
  const reversedRange = dateFrom !== null && dateTo !== null && dateTo < dateFrom
  const filter: EOzelFileQuery = {
    status,
    ...(kind ? { kind } : {}),
    ...(search.trim().length >= 2 ? { q: search.trim() } : {}),
    ...(dateFrom && !reversedRange ? { dateFrom } : {}),
    ...(dateTo && !reversedRange ? { dateTo } : {}),
  }
  const items = useEOzelItems({ page: list.state.page, pageSize: list.state.pageSize, ...filter })

  const rows = useMemo(
    () => items.data?.data.map((item): Row => ({ ...item, id: `${item.kind}:${item.sourceId}` })),
    [items.data],
  )

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'learnerName', label: 'Kursiyer', cell: (row) => row.learnerName || '—' },
      {
        key: 'kind',
        label: 'Tür',
        cell: (row) => E_OZEL_KIND_LABELS[row.kind],
      },
      {
        key: 'date',
        label: 'Gün',
        cell: (row) => (row.date ? dateLabel(row.date, { year: 'numeric' }) : '—'),
      },
      { key: 'details', label: 'Bilgi', cell: (row) => <Details row={row} /> },
      {
        key: 'recordedAt',
        label: 'e-Özel',
        cell: (row) =>
          row.recordedAt === null ? (
            <StatusBadge text="İşlenmedi" />
          ) : (
            <span className="grid">
              <StatusBadge text="İşlendi" />
              <small className="text-xs text-muted-foreground">
                {dateLabel(row.recordedAt, { year: 'numeric' })}
                {row.recordedByName ? ` · ${row.recordedByName}` : ''}
              </small>
            </span>
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const label = `${row.learnerName} ${E_OZEL_KIND_LABELS[row.kind]}`
          return (
            <Button
              size="sm"
              variant="secondary"
              disabled={mark.isPending}
              aria-label={
                row.recordedAt === null
                  ? `${label} kaydını işlendi olarak işaretle`
                  : `${label} kaydının işaretini kaldır`
              }
              onClick={() =>
                void mark.submit({
                  kind: row.kind,
                  sourceId: row.sourceId,
                  version: row.version,
                  recorded: row.recordedAt === null,
                })
              }
            >
              {row.recordedAt === null ? 'İşlendi' : 'İşareti kaldır'}
            </Button>
          )
        },
      },
    ],
    [mark],
  )

  async function download() {
    const outcome = await exporter.submit(filter)
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), 'e-ozel-islem-listesi.csv')
    notify.success('Dosya indirildi.')
  }

  const total = items.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="e-ozel-tablosu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="e-ozel-tablosu" className="text-lg font-semibold">
          e-Özel işlem listesi
        </h2>
        <p className="text-sm text-muted-foreground">
          {total} kayıt · Kampüs e-Özel&apos;e bağlanmaz; kaydı e-Özel&apos;e siz girersiniz, burada
          işlendi olarak işaretlersiniz. Alanların e-Özel ekranıyla eşleşmesini kurumunuzla
          doğrulayın. Kimlik numarası maskelidir.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium">
            Tür
            <NativeSelect
              value={kind ?? ALL_KINDS}
              onChange={(event) =>
                list.dispatch({
                  type: 'filter',
                  key: 'kind',
                  value: event.target.value === ALL_KINDS ? '' : event.target.value,
                })
              }
            >
              <NativeSelectOption value={ALL_KINDS}>Tüm türler</NativeSelectOption>
              {kinds.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {E_OZEL_KIND_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium">
            e-Özel durumu
            <NativeSelect
              value={status}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'status', value: event.target.value })
              }
            >
              {STATUS_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Gün (başlangıç)
            <Input
              type="date"
              value={dateFrom ?? ''}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'dateFrom', value: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Gün (bitiş)
            <Input
              type="date"
              value={dateTo ?? ''}
              aria-invalid={reversedRange || undefined}
              aria-describedby={reversedRange ? 'e-ozel-gun-hata' : undefined}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'dateTo', value: event.target.value })
              }
            />
          </label>
          <Button
            variant="secondary"
            disabled={exporter.isPending}
            aria-busy={exporter.isPending || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Listeyi indir
          </Button>
          {reversedRange ? (
            <p id="e-ozel-gun-hata" role="alert" className="text-sm text-destructive">
              Bitiş günü başlangıç gününden önce olamaz.
            </p>
          ) : null}
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows ?? []}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="e-Özel işlem listesi"
        loading={items.isPending}
        fetching={items.isFetching && !items.isPending}
        error={
          items.error ? (
            <QueryError error={items.error} onRetry={() => void items.refetch()} />
          ) : undefined
        }
      />
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </section>
  )
}
