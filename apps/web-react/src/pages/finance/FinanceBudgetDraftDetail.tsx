import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  useBudgetDraft,
  useBudgetDraftComparison,
  useBudgetDraftOptions,
  useBudgetDraftTransition,
  useUpdateBudgetDraftLines,
  type BudgetDraftComparisonData,
  type BudgetDraftDetail,
  type BudgetDraftVerb,
} from '@kampus/react-shared/use-finance-budget-drafts.ts'
import { BUDGET_ITEM_KIND_LABELS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  BUDGET_DRAFT_EVENT_LABELS,
  budgetDraftComparisonCsv,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  BUDGET_DRAFT_STATUS_VIEW,
  emptyLine,
  fileSlug,
  linesBody,
  linesDefaults,
  linesFormField,
  linesFormSchema,
  noteBody,
  noteFormSchema,
  ownerText,
  reasonFormSchema,
  type LinesFormValues,
} from './finance-budget-draft-forms.ts'

const BOM = '﻿'
const dash = '—'
const moment = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`
const optionalMoney = (cents: number | null) => (cents === null ? dash : money(cents))
type Draft = BudgetDraftDetail
type ComparisonRow = BudgetDraftComparisonData['rows'][number]

/**
 * Bütçe taslağının ayrıntısı (DOM-FIN-093): bilgiler, kalem satırları (düzenlenebilirken form;
 * her satırın yanında önceki dönemin planı ve gerçekleşeni, onaylı tutar), rolün yapabileceği
 * geçişler (`actions`; sunucu yeniden denetler), karşılaştırma tablosu ve CSV'si, revizyon geçmişi.
 */
export function BudgetDraftDetailView({ draftId }: { draftId: string }) {
  const item = useBudgetDraft(draftId)
  const comparison = useBudgetDraftComparison(draftId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const draft = item.data?.data
  if (!draft) return <SummaryLoading />
  const compared = comparison.data?.data
  const byItem = new Map(compared?.rows.map((row) => [row.itemId, row]) ?? [])
  return (
    <div className="grid gap-6">
      <section aria-labelledby="taslak-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="taslak-bilgileri" className="text-base font-semibold [overflow-wrap:anywhere]">
            {draft.costCenter.path} · {draft.costCenter.name}
          </h3>
          <StatusBadge
            text={BUDGET_DRAFT_STATUS_VIEW[draft.status].label}
            tone={BUDGET_DRAFT_STATUS_VIEW[draft.status].tone}
          />
        </div>
        <DraftFacts draft={draft} />
        {draft.decisionNote !== null &&
        (draft.status === 'revision_requested' || draft.status === 'rejected') ? (
          <p role="note" className="rounded-sm border px-3 py-2 text-sm">
            <span className="font-medium">
              {draft.status === 'rejected' ? 'Ret gerekçesi: ' : 'Revizyon gerekçesi: '}
            </span>
            {draft.decisionNote}
          </p>
        ) : null}
      </section>
      {draft.actions.edit ? (
        <LinesEditor key={draft.id} draft={draft} comparison={byItem} />
      ) : (
        <LinesTable draft={draft} comparison={byItem} />
      )}
      <DraftDecisions draft={draft} />
      {comparison.error ? (
        <QueryError error={comparison.error} onRetry={() => void comparison.refetch()} />
      ) : compared ? (
        <ComparisonTable draft={draft} comparison={compared} />
      ) : null}
      <DraftHistory draft={draft} />
    </div>
  )
}

function DraftFacts({ draft }: { draft: Draft }) {
  const pairs: [string, string][] = [
    ['Dönem', draft.period.name],
    ['Sorumlu', ownerText(draft.owner)],
    ['Sürüm', draft.revision === 0 ? 'Henüz gönderilmedi' : String(draft.revision)],
    ['Onaylı sürüm', draft.approvedRevision === null ? dash : String(draft.approvedRevision)],
    ['Gelir toplamı', money(draft.incomeCents)],
    ['Gider toplamı', money(draft.expenseCents)],
    ['Açan', draft.createdByName ?? dash],
    ...(draft.submittedAt !== null
      ? ([['Son gönderim', `${moment(draft.submittedAt)} · ${draft.submittedByName ?? dash}`]] as [
          string,
          string,
        ][])
      : []),
    ...(draft.approvedAt !== null
      ? ([['Son onay', `${moment(draft.approvedAt)} · ${draft.approvedByName ?? dash}`]] as [
          string,
          string,
        ][])
      : []),
  ]
  return (
    <dl className="grid gap-2 text-sm">
      {pairs.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 max-[480px]:grid-cols-1"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Satırın yan sütunu: önceki dönemin planı ve gerçekleşeni, bu dönemin onaylı tutarı (K-259). */
function PreviousColumn({ row }: { row: ComparisonRow | undefined }) {
  return (
    <dl className="grid gap-1 text-sm text-muted-foreground">
      <div>
        <dt className="inline">Önceki plan: </dt>
        <dd className="inline">{optionalMoney(row?.previousPlanCents ?? null)}</dd>
      </div>
      <div>
        <dt className="inline">Önceki gerçekleşen: </dt>
        <dd className="inline">{optionalMoney(row?.previousActualCents ?? null)}</dd>
      </div>
      <div>
        <dt className="inline">Onaylı: </dt>
        <dd className="inline">{optionalMoney(row?.approvedCents ?? null)}</dd>
      </div>
    </dl>
  )
}

/**
 * Satırların düzenlenmesi: kalem, tutar ve gerekçe; "Kaydet" satırları yazar, "Kaydet ve onaya
 * gönder" kaydedip yeni sürümle gönderir. Gerekçe gönderimde yeni ya da tutarı değişen kalemde
 * zorunludur (K-257); sunucu hatası ilgili satıra yazılır.
 */
function LinesEditor({
  draft,
  comparison,
}: {
  draft: Draft
  comparison: ReadonlyMap<string, ComparisonRow>
}) {
  const options = useBudgetDraftOptions()
  const save = useUpdateBudgetDraftLines()
  const transition = useBudgetDraftTransition()
  const form = useForm<LinesFormValues>({
    resolver: zodResolver(linesFormSchema),
    defaultValues: linesDefaults(draft),
  })
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const values = useWatch({ control: form.control, name: 'lines' })
  const [mode, setMode] = useState<'save' | 'submit'>('save')
  const busy = save.isPending || transition.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  // Seçenekler etkin kalemlerdir; taslakta kalan pasif kalem kendi adıyla listelenir.
  const items = [
    ...(options.data?.data.items ?? []),
    ...draft.lines
      .filter((line) => !line.itemActive)
      .map((line) => ({
        id: line.itemId,
        code: line.itemCode,
        name: `${line.itemName} (pasif)`,
        kind: line.itemKind,
      })),
  ]
  const setError = (name: string, error: { type: string; message: string }) => {
    const field = linesFormField(name)
    if (field === 'lines') form.setError('root.server', error)
    else if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (formValues) => {
    const saved = await save.submit(
      { draftId: draft.id, version: draft.version, body: linesBody(formValues) },
      { setError },
    )
    if (saved.status !== 'success') return
    if (mode === 'save') {
      notify.success('Taslak kaydedildi.')
      return
    }
    const sent = await transition.submit(
      {
        verb: 'submit',
        draftId: draft.id,
        version: saved.data.data.version,
        body: { note: null },
      },
      { setError },
    )
    if (sent.status === 'success')
      notify.success(`Taslak ${String(sent.data.data.revision)}. sürüm olarak onaya gönderildi.`)
  })
  return (
    <section aria-labelledby="taslak-kalemleri" className="grid gap-3 border-t pt-4">
      <h3 id="taslak-kalemleri" className="text-base font-semibold">
        Kalemler
      </h3>
      <form
        noValidate
        aria-label="Taslak kalemleri"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        {lines.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Taslakta kalem yok; kalem ekleyin.</p>
        ) : null}
        {lines.fields.map((line, index) => {
          const number = String(index + 1)
          const itemId = values[index]?.itemId ?? ''
          return (
            <fieldset
              key={line.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] gap-3 rounded-sm border px-3 py-3 max-[480px]:grid-cols-1"
            >
              <legend className="px-1 text-sm font-medium">{number}. kalem</legend>
              <div className="grid gap-3">
                <FormField
                  id={`taslak-kalem-${number}`}
                  label={`${number}. kalem`}
                  error={errors.lines?.[index]?.itemId}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`lines.${index}.itemId`)}
                      className="w-full"
                      disabled={busy}
                    >
                      <NativeSelectOption value="">Kalem seçin</NativeSelectOption>
                      {items.map((option) => (
                        <NativeSelectOption key={option.id} value={option.id}>
                          {option.code} · {option.name} ({BUDGET_ITEM_KIND_LABELS[option.kind]})
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`taslak-tutar-${number}`}
                  label={`${number}. kalem tutarı (₺)`}
                  error={errors.lines?.[index]?.amount}
                >
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="decimal"
                      {...form.register(`lines.${index}.amount`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`taslak-gerekce-${number}`}
                  label={`${number}. kalem gerekçesi`}
                  error={errors.lines?.[index]?.justification}
                  description="Yeni ya da onaylı tutarı değişen kalemde gönderimde zorunlu."
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      {...form.register(`lines.${index}.justification`)}
                      rows={2}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${number}. kalemi çıkar`}
                    disabled={busy}
                    onClick={() => lines.remove(index)}
                  >
                    <Icon name="Trash2" size={16} aria-hidden="true" />
                    Çıkar
                  </Button>
                </div>
              </div>
              <PreviousColumn row={comparison.get(itemId)} />
            </fieldset>
          )
        })}
        <RootError message={errors.lines?.root?.message ?? errors.lines?.message} />
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => lines.append(emptyLine())}
          >
            <Icon name="Plus" size={16} aria-hidden="true" />
            Kalem ekle
          </Button>
        </div>
        <RootError message={errors.root?.server?.message} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            disabled={busy}
            aria-busy={(busy && mode === 'save') || undefined}
            onClick={() => setMode('save')}
          >
            Kaydet
          </Button>
          {draft.actions.submit ? (
            <Button
              type="submit"
              disabled={busy}
              aria-busy={(busy && mode === 'submit') || undefined}
              onClick={() => setMode('submit')}
            >
              Kaydet ve onaya gönder
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  )
}

function LinesTable({
  draft,
  comparison,
}: {
  draft: Draft
  comparison: ReadonlyMap<string, ComparisonRow>
}) {
  return (
    <section aria-labelledby="taslak-kalemleri" className="grid gap-3 border-t pt-4">
      <h3 id="taslak-kalemleri" className="text-base font-semibold">
        Kalemler
      </h3>
      {draft.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Taslakta kalem yok.</p>
      ) : (
        <ul aria-label="Taslak kalemleri" className="grid gap-2 text-sm">
          {draft.lines.map((line) => (
            <li
              key={line.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] gap-3 rounded-sm border px-3 py-2 max-[480px]:grid-cols-1"
            >
              <div className="grid gap-1">
                <span className="font-medium [overflow-wrap:anywhere]">
                  {line.itemCode} · {line.itemName} · {money(line.amountCents)}
                </span>
                {line.justification ? (
                  <span className="[overflow-wrap:anywhere]">{line.justification}</span>
                ) : null}
              </div>
              <PreviousColumn row={comparison.get(line.itemId)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const DECISION_FORM = 'taslak-karar'

/**
 * Yönetici kararı (K-256): onay (isteğe bağlı not), revizyon isteği ve ret (gerekçe zorunlu); onaylı
 * taslakta yeni revizyon (K-258). Not ya da gerekçe aynı alandadır, düğmeye göre denetlenir.
 */
function DraftDecisions({ draft }: { draft: Draft }) {
  const transition = useBudgetDraftTransition()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { actions } = draft
  if (!actions.approve && !actions.requestRevision && !actions.reject && !actions.reopen)
    return null
  const busy = transition.isPending
  async function run(verb: BudgetDraftVerb, done: string) {
    const needsReason = verb === 'request-revision' || verb === 'reject'
    const parsed = needsReason
      ? reasonFormSchema.safeParse({ reason: text })
      : noteFormSchema.safeParse({ note: text })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Metni düzeltin.')
      return
    }
    setError(null)
    const body = needsReason ? { reason: text.trim() } : noteBody({ note: text })
    const outcome = await transition.submit(
      { verb, draftId: draft.id, version: draft.version, body },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      setText('')
      notify.success(done)
    }
  }
  const showText = actions.approve || actions.requestRevision || actions.reject
  return (
    <section aria-labelledby="taslak-karar" className="grid gap-3 border-t pt-4">
      <h3 id="taslak-karar" className="text-base font-semibold">
        {showText ? 'Karar' : 'Yeni revizyon'}
      </h3>
      {showText ? (
        <FormField
          id={DECISION_FORM}
          label="Karar notu ya da gerekçe"
          description="Revizyon isteği ve ret için gerekçe zorunlu; onay notu isteğe bağlı."
          error={error === null ? undefined : { message: error }}
        >
          {(control) => (
            <Textarea
              {...control}
              value={text}
              rows={3}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </FormField>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Onaylı bütçe yeni sürüm onaylanana kadar yürürlükte kalır.
          </p>
          <RootError message={error ?? undefined} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.approve ? (
          <Button disabled={busy} onClick={() => void run('approve', 'Taslak onaylandı.')}>
            Onayla
          </Button>
        ) : null}
        {actions.requestRevision ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run('request-revision', 'Revizyon istendi.')}
          >
            Revizyon iste
          </Button>
        ) : null}
        {actions.reject ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run('reject', 'Taslak reddedildi.')}
          >
            Reddet
          </Button>
        ) : null}
        {actions.reopen ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run('reopen', 'Yeni revizyon açıldı.')}
          >
            Yeni revizyon aç
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function ComparisonTable({
  draft,
  comparison,
}: {
  draft: Draft
  comparison: BudgetDraftComparisonData
}) {
  const download = () => {
    saveBlob(
      new Blob([BOM, budgetDraftComparisonCsv(comparison)], { type: 'text/csv;charset=utf-8' }),
      `butce-taslagi-${fileSlug(draft.period.name)}-${fileSlug(draft.costCenter.code)}.csv`,
    )
    notify.success('Karşılaştırma CSV dosyası indirildi.')
  }
  const previous = comparison.previousPeriod
  return (
    <section aria-labelledby="taslak-karsilastirma" className="grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="taslak-karsilastirma" className="text-base font-semibold">
          Karşılaştırma
        </h3>
        <Button size="sm" variant="secondary" onClick={download}>
          <Icon name="Download" size={16} aria-hidden="true" />
          CSV indir
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {previous
          ? `Önceki dönem: ${previous.name} (tahakkuk esaslı gerçekleşen).`
          : 'Bu dönemden önce biten bir bütçe dönemi yok; önceki dönem sütunları boş.'}
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableCaption className="sr-only">Taslak karşılaştırması</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Kalem</TableHead>
              <TableHead className="text-right">Önceki plan</TableHead>
              <TableHead className="text-right">Önceki gerçekleşen</TableHead>
              <TableHead className="text-right">Onaylı</TableHead>
              <TableHead className="text-right">Taslak</TableHead>
              <TableHead className="text-right">Değişim</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row) => (
              <TableRow key={row.itemId}>
                <TableCell className="[overflow-wrap:anywhere]">
                  {row.itemCode} · {row.itemName}
                </TableCell>
                <TableCell className="text-right">{optionalMoney(row.previousPlanCents)}</TableCell>
                <TableCell className="text-right">
                  {optionalMoney(row.previousActualCents)}
                </TableCell>
                <TableCell className="text-right">{optionalMoney(row.approvedCents)}</TableCell>
                <TableCell className="text-right">{optionalMoney(row.draftCents)}</TableCell>
                <TableCell className="text-right">
                  {optionalMoney(row.changeFromPreviousCents)}
                </TableCell>
              </TableRow>
            ))}
            {(['income', 'expense'] as const).map((kind) => {
              const sum = comparison.totals[kind]
              return (
                <TableRow key={kind} className="font-medium">
                  <TableCell>{BUDGET_ITEM_KIND_LABELS[kind]} toplamı</TableCell>
                  <TableCell className="text-right">{money(sum.previousPlanCents)}</TableCell>
                  <TableCell className="text-right">
                    {optionalMoney(sum.previousActualCents)}
                  </TableCell>
                  <TableCell className="text-right">{money(sum.approvedCents)}</TableCell>
                  <TableCell className="text-right">{money(sum.draftCents)}</TableCell>
                  <TableCell className="text-right">
                    {sum.previousActualCents === null
                      ? dash
                      : money(sum.draftCents - sum.previousActualCents)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function DraftHistory({ draft }: { draft: Draft }) {
  return (
    <section aria-labelledby="taslak-gecmis" className="grid gap-2 border-t pt-4">
      <h3 id="taslak-gecmis" className="text-base font-semibold">
        Revizyon geçmişi
      </h3>
      <ol aria-label="Revizyon geçmişi" className="grid gap-2 text-sm">
        {draft.events.map((event) => (
          <li key={event.id} className="grid gap-1 rounded-sm border px-3 py-2">
            <span className="font-medium">
              {BUDGET_DRAFT_EVENT_LABELS[event.event]}
              {event.event === 'submitted' ? ` · ${String(event.revision)}. sürüm` : ''}
            </span>
            <span className="text-muted-foreground">
              {moment(event.occurredAt)}
              {event.actorName ? ` · ${event.actorName}` : ''}
            </span>
            {event.note ? <span className="[overflow-wrap:anywhere]">{event.note}</span> : null}
            {event.changes && event.changes.length > 0 ? (
              <ul aria-label={`${String(event.revision)}. sürümde değişen kalemler`}>
                {event.changes.map((change) => (
                  <li key={change.itemId} className="[overflow-wrap:anywhere]">
                    {change.itemCode} · {change.itemName}: {optionalMoney(change.beforeCents)} →{' '}
                    {optionalMoney(change.afterCents)}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
