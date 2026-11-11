import { useMemo, useState } from 'react'
import { PROGRESSION_OUTCOMES } from '@kampus/school-core/cefr/progression.ts'
import {
  E_OZEL_ACADEMIC_KINDS,
  E_OZEL_KIND_LABELS,
  E_OZEL_KINDS,
  E_OZEL_RECORD_STATUS_LABELS,
  eOzelChangeNote,
  eOzelLearnerStatusLabel,
} from '@kampus/school-core/lib/finance-e-ozel.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  useEOzelExport,
  useEOzelIdentityReveal,
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
type IdentityReveal = ReturnType<typeof useEOzelIdentityReveal>

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['learnerName', 'kind', 'details', 'recordedAt']
const ALL_KINDS = 'all'
const BOM = '﻿'
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Bekleyen' },
  { value: 'needs_correction', label: E_OZEL_RECORD_STATUS_LABELS.needs_correction },
  { value: 'recorded', label: E_OZEL_RECORD_STATUS_LABELS.recorded },
  { value: 'all', label: 'Tümü' },
] as const
type StatusValue = (typeof STATUS_OPTIONS)[number]['value']

const statusOf = (value: unknown): StatusValue =>
  STATUS_OPTIONS.find((option) => option.value === value)?.value ?? 'pending'
const dayFilter = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

/**
 * Maskeli numara ve satır başına "Göster": tam numara yalnız açıkken bellektedir, her açılış denetime
 * yazılır (DOM-YTK-052). Yeniden giriş gerekirse pencereyi bölüm açar.
 */
function LearnerIdentity({ row, reveal }: { row: Row; reveal: IdentityReveal }) {
  const masked = row.learner?.maskedIdentity ?? null
  if (masked === null) return 'Kimlik kaydı yok'
  const open = reveal.revealedFor === row.learnerId
  const error = open ? reveal.query.error : null
  const reauthRequired = error?.code === REAUTHENTICATION_CODE
  const busy = open && reveal.query.isFetching
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono">
        {(open && reveal.query.data?.data.identityNumber) || masked}
      </span>
      {open ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`${row.learnerName} kimlik numarasını gizle`}
          onClick={reveal.hide}
        >
          <Icon name="EyeOff" size={15} aria-hidden="true" />
          Gizle
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${row.learnerName} kimlik numarasını göster`}
          onClick={() => reveal.show(row.learnerId)}
        >
          <Icon name="Eye" size={15} aria-hidden="true" />
          Göster
        </Button>
      )}
      {busy ? (
        <small role="status" className="text-xs text-muted-foreground">
          Okunuyor…
        </small>
      ) : null}
      {error && !reauthRequired && !busy ? (
        <small role="alert" className="text-xs text-destructive">
          {error.message}
        </small>
      ) : null}
    </span>
  )
}

/** Satırın türe özgü bilgisi; alan adları ister listesindeki e-Özel özetindendir. */
function Details({ row, reveal }: { row: Row; reveal: IdentityReveal }) {
  if (row.learner)
    return (
      <span className="grid">
        <span>
          <LearnerIdentity row={row} reveal={reveal} />
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

/** Satır durumu: düzeltilmeli satırda kaynakta ne değiştiği de yazar. */
function RecordState({ row }: { row: Row }) {
  const note = eOzelChangeNote(row)
  return (
    <span className="grid">
      <StatusBadge
        text={E_OZEL_RECORD_STATUS_LABELS[row.recordStatus]}
        {...(row.recordStatus === 'needs_correction' ? { tone: 'amber' as const } : {})}
      />
      {row.recordedAt === null ? null : (
        <small className="text-xs text-muted-foreground">
          {dateLabel(row.recordedAt, { year: 'numeric' })}
          {row.recordedByName ? ` · ${row.recordedByName}` : ''}
        </small>
      )}
      {note ? <small className="text-xs text-muted-foreground">{note}</small> : null}
    </span>
  )
}

/**
 * e-Özel işlem listesi (IST-085, DOM-KAY-015): dil okulu ve kursta elle girilecek kayıtlar ve
 * "işlendi" işareti. Süzgeç ve sayfa sunucudadır. Ücret satırının işareti tahsilat geçmişindeki
 * MEBBİS işaretiyle aynı kayıttır. İşaretlendikten sonra kaynağı değişen satır "e-Özel'de
 * düzeltilmeli" görünür, personel düzeltmeyi yapınca işaretler. Devamsızlık ve kurs sonu `academic`
 * kapalıyken seçilemez.
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
  const reveal = useEOzelIdentityReveal(
    rows?.flatMap((row) => (row.kind === 'learner' ? [row.learnerId] : [])),
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
      { key: 'details', label: 'Bilgi', cell: (row) => <Details row={row} reveal={reveal} /> },
      { key: 'recordedAt', label: 'e-Özel', cell: (row) => <RecordState row={row} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          // Kaynağı kalkmış işlenmiş satırda işaret kaldırılamaz (core `planEOzelMark`).
          if (row.recordStatus === 'recorded' && row.sourceRemoved) return null
          const label = `${row.learnerName} ${E_OZEL_KIND_LABELS[row.kind]}`
          const action = {
            pending: { text: 'İşlendi', name: `${label} kaydını işlendi olarak işaretle` },
            needs_correction: {
              text: 'Düzeltildi',
              name: `${label} kaydını e-Özel'de düzeltildi olarak işaretle`,
            },
            recorded: { text: 'İşareti kaldır', name: `${label} kaydının işaretini kaldır` },
          }[row.recordStatus]
          return (
            <Button
              size="sm"
              variant="secondary"
              disabled={mark.isPending}
              aria-label={action.name}
              onClick={() =>
                void mark.submit({
                  kind: row.kind,
                  sourceId: row.sourceId,
                  version: row.version,
                  recorded: row.recordStatus !== 'recorded',
                })
              }
            >
              {action.text}
            </Button>
          )
        },
      },
    ],
    [mark, reveal],
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
          işlendi olarak işaretlersiniz. İşaretlendikten sonra kaynağı değişen kayıt
          &quot;e-Özel&apos;de düzeltilmeli&quot; görünür; düzeltmeyi yapınca yeniden işaretleyin.
          Alanların e-Özel ekranıyla eşleşmesini kurumunuzla doğrulayın. Kimlik numarası maskelidir;
          &quot;Göster&quot; tek satırın tam numarasını açar, her görüntüleme denetim kaydına
          yazılır.
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
      {reveal.query.error?.code === REAUTHENTICATION_CODE ? (
        <ReauthModal onCancel={reveal.hide} onDone={reveal.retry} />
      ) : null}
    </section>
  )
}
