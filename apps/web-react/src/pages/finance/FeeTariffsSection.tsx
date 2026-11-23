import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  emptyTariffForm,
  FEE_DISCOUNT_KIND_LABELS,
  FEE_DISCOUNT_KINDS,
  FEE_ITEM_KIND_LABELS,
  FEE_ITEM_KINDS,
  FEE_UNIT_LABELS,
  FEE_UNITS,
  feeTariffFormSchema,
  isOutsideAnnouncementPeriod,
  tariffFormToBody,
  tariffItemExceedsAnnounced,
  nextYearTariffForm,
  tariffToForm,
  type FeeDiscount,
  type FeeItem,
  type FeeTariffFormValues,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  announcedPaymentTermLabel,
  FEE_PAYMENT_TERM_KIND_LABELS,
  FEE_PAYMENT_TERM_KINDS,
  type FeePaymentTerm,
} from '@kampus/school-core/lib/payment-terms.ts'
import {
  useCreateFeeTariff,
  useFeeTariffs,
  usePublishFeeTariff,
  useUpdateFeeTariff,
} from '@kampus/react-shared/use-fee-tariffs.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useAuth } from '@/auth/use-auth.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'

type TariffRecord = {
  id: string
  academicYear: number
  versionNumber: number
  status: 'draft' | 'published' | 'superseded'
  items: FeeItem[]
  discounts: FeeDiscount[]
  paymentTerms: FeePaymentTerm[]
  announcedDate: string | null
  mebbisRecordedDate: string | null
  version: number
}
type TariffRow = TariffRecord & { yearLabel: string; statusLabel: string; itemCount: number }

const STATUS_LABELS = { draft: 'Taslak', published: 'Yayında', superseded: 'Eski sürüm' } as const
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['yearLabel', 'versionNumber', 'statusLabel']
const EDITOR_FORM = 'tarife-formu'
const PUBLISH_FORM = 'tarife-yayim-formu'

type Editor =
  { mode: 'new'; from?: TariffRecord; nextYear?: boolean } | { mode: 'edit'; tariff: TariffRecord }

/**
 * Ücret tarifesi (ADR 0006 karar 8; DOM-FIN-002, -004, -006, -013; IST-104): eğitim yılı başına sürümlü.
 * Yönetici taslak açar, düzenler, yayımlar; yayımlanan sürüm değişmez, yeni sürüm öncekini kaldırır.
 * Ön büro yalnız görür. Kesin kayıt tutarı yayımdaki sürümden hesaplanır.
 */
export function FeeTariffsSection({
  canManage,
  academicYear,
}: {
  canManage: boolean
  academicYear: number
}) {
  const list = useListState('tarifeler')
  const tariffs = useFeeTariffs({ page: list.state.page, pageSize: list.state.pageSize })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [publishing, setPublishing] = useState<TariffRecord | null>(null)
  const [viewing, setViewing] = useState<TariffRecord | null>(null)

  const rows = useMemo(
    () =>
      tariffs.data?.data.map((tariff): TariffRow => ({
        ...tariff,
        yearLabel: `${String(tariff.academicYear)}–${String(tariff.academicYear + 1)}`,
        statusLabel: STATUS_LABELS[tariff.status],
        itemCount: tariff.items.length,
      })),
    [tariffs.data],
  )

  const columns = useMemo<DataColumn<TariffRow>[]>(
    () => [
      { key: 'yearLabel', label: 'Eğitim yılı' },
      { key: 'versionNumber', label: 'Sürüm' },
      {
        key: 'statusLabel',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.statusLabel} />,
      },
      {
        key: 'announcedDate',
        label: 'İlan tarihi',
        cell: (row) =>
          row.announcedDate ? dateLabel(row.announcedDate, { year: 'numeric' }) : '—',
      },
      { key: 'itemCount', label: 'Kalem' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const name = `${row.yearLabel} sürüm ${String(row.versionNumber)}`
          return (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${name} tarifesini görüntüle`}
                onClick={() => setViewing(row)}
              >
                Görüntüle
              </Button>
              {canManage && row.status === 'draft' ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${name} taslağını düzenle`}
                    onClick={() => setEditor({ mode: 'edit', tariff: row })}
                  >
                    Düzenle
                  </Button>
                  <Button
                    size="sm"
                    aria-label={`${name} tarifesini yayımla`}
                    onClick={() => setPublishing(row)}
                  >
                    Yayımla
                  </Button>
                </>
              ) : null}
              {canManage && row.status === 'published' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${name} tarifesinden yeni sürüm aç`}
                  onClick={() => setEditor({ mode: 'new', from: row })}
                >
                  Yeni sürüm
                </Button>
              ) : null}
              {canManage && row.status === 'published' ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${name} tarifesini sonraki eğitim yılına taşı`}
                  onClick={() => setEditor({ mode: 'new', from: row, nextYear: true })}
                >
                  Sonraki yıla taşı
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ],
    [canManage],
  )

  const total = tariffs.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="ucret-tarifesi"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="ucret-tarifesi" className="text-lg font-semibold">
            Ücret tarifesi
          </h2>
          <p className="text-sm text-muted-foreground">
            Kesin kayıt tutarı yayındaki sürümden hesaplanır. Yayımlanan sürüm değiştirilemez.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditor({ mode: 'new' })}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni tarife
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Ücret tarifeleri"
        search={false}
        loading={tariffs.isPending}
        fetching={tariffs.isFetching && !tariffs.isPending}
        error={
          tariffs.error ? (
            <QueryError error={tariffs.error} onRetry={() => void tariffs.refetch()} />
          ) : undefined
        }
      />
      {editor ? (
        <TariffEditor editor={editor} academicYear={academicYear} onClose={() => setEditor(null)} />
      ) : null}
      {publishing ? <PublishModal tariff={publishing} onClose={() => setPublishing(null)} /> : null}
      {viewing ? <TariffView tariff={viewing} onClose={() => setViewing(null)} /> : null}
    </section>
  )
}

function TariffView({ tariff, onClose }: { tariff: TariffRecord; onClose: () => void }) {
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${String(tariff.academicYear)}–${String(tariff.academicYear + 1)} tarifesi`}
      description={`Sürüm ${String(tariff.versionNumber)} · ${STATUS_LABELS[tariff.status]}`}
    >
      <ul className="divide-y text-sm">
        {tariff.items.map((item) => (
          <li
            key={`${item.kind}-${item.level ?? ''}`}
            className="flex flex-wrap justify-between gap-2 py-2"
          >
            <span>
              {FEE_ITEM_KIND_LABELS[item.kind]}
              {item.level ? ` · ${item.level}` : ''}
            </span>
            <span className="font-medium">
              {money(item.amountCents)} / {FEE_UNIT_LABELS[item.unit]} · KDV %
              {String(item.vatBasisPoints / 100)}
            </span>
          </li>
        ))}
      </ul>
      {tariff.discounts.length > 0 ? (
        <>
          <h3 className="mt-5 mb-1 font-semibold">İlan edilen indirimler</h3>
          <ul className="divide-y text-sm">
            {tariff.discounts.map((discount) => (
              <li key={discount.kind} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{FEE_DISCOUNT_KIND_LABELS[discount.kind]}</span>
                <span className="font-medium">
                  {discount.amountCents === null
                    ? `%${String((discount.percentBasisPoints ?? 0) / 100)}`
                    : money(discount.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="mt-5 mb-1 font-semibold">İlan edilen ödeme koşulları</h3>
      {tariff.paymentTerms.length > 0 ? (
        <ul aria-label="İlan edilen ödeme koşulları" className="divide-y text-sm">
          {tariff.paymentTerms.map((term) => (
            <li key={`${term.kind}-${String(term.minInstallments)}`} className="py-2">
              {announcedPaymentTermLabel(term)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Bu sürümde ödeme koşulu ilan edilmemiş; taksit sayısı sınırlanmaz.
        </p>
      )}
    </Modal>
  )
}

function TariffEditor({
  editor,
  academicYear,
  onClose,
}: {
  editor: Editor
  academicYear: number
  onClose: () => void
}) {
  const create = useCreateFeeTariff()
  const update = useUpdateFeeTariff()
  const source = editor.mode === 'edit' ? editor.tariff : editor.from
  const form = useForm<FeeTariffFormValues>({
    resolver: zodResolver(feeTariffFormSchema),
    defaultValues: source
      ? editor.mode === 'new' && editor.nextYear === true
        ? nextYearTariffForm(source)
        : tariffToForm(source)
      : emptyTariffForm(academicYear, dayKey()),
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const discounts = useFieldArray({ control: form.control, name: 'discounts' })
  const terms = useFieldArray({ control: form.control, name: 'paymentTerms' })
  const termValues = useWatch({ control: form.control, name: 'paymentTerms' })
  const itemValues = useWatch({ control: form.control, name: 'items' })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const body = tariffFormToBody(values)
    const toRoot = {
      setError: (_name: string, error: { type: string; message: string }) =>
        form.setError('root.server', error),
    }
    const outcome =
      editor.mode === 'edit'
        ? await update.submit(
            {
              tariffId: editor.tariff.id,
              version: editor.tariff.version,
              body: {
                items: body.items,
                discounts: body.discounts,
                paymentTerms: body.paymentTerms,
              },
            },
            toRoot,
          )
        : await create.submit(body, toRoot)
    if (outcome.status === 'success') {
      notify.success('Tarife kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={
        editor.mode === 'edit'
          ? 'Tarife taslağını düzenle'
          : editor.nextYear === true
            ? 'Sonraki yıl tarifesi'
            : 'Yeni tarife'
      }
      description="Yalnız sabit listedeki kalemlerle borç açılır; KDV oranı kalemde tarihli tutulur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={EDITOR_FORM} disabled={busy} aria-busy={busy || undefined}>
            Taslağı kaydet
          </Button>
        </>
      }
    >
      <form
        id={EDITOR_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <div className="max-w-40">
          <FormField id="tarife-yil" label="Eğitim yılı" error={errors.academicYear}>
            {(control) => (
              <Input
                {...control}
                {...form.register('academicYear')}
                inputMode="numeric"
                disabled={busy || editor.mode === 'edit'}
              />
            )}
          </FormField>
        </div>
        <fieldset className="grid gap-4">
          <legend className="mb-2 font-semibold">Ücret kalemleri</legend>
          {items.fields.map((field, index) => {
            const itemErrors = errors.items?.[index]
            const itemValue = itemValues[index]
            return (
              <div
                key={field.id}
                className="grid grid-cols-3 gap-3 rounded-card border p-3 max-[650px]:grid-cols-1"
              >
                <FormField id={`kalem-${String(index)}-tur`} label="Kalem" error={itemErrors?.kind}>
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`items.${index}.kind`)}
                      disabled={busy}
                    >
                      {FEE_ITEM_KINDS.map((kind) => (
                        <NativeSelectOption key={kind} value={kind}>
                          {FEE_ITEM_KIND_LABELS[kind]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`kalem-${String(index)}-duzey`}
                  label="Düzey (boşsa tüm düzeyler)"
                  error={itemErrors?.level}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`items.${index}.level`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`kalem-${String(index)}-tutar`}
                  label="Tutar (₺)"
                  error={itemErrors?.amount}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`items.${index}.amount`)}
                      inputMode="decimal"
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`kalem-${String(index)}-birim`}
                  label="Birim"
                  error={itemErrors?.unit}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`items.${index}.unit`)}
                      disabled={busy}
                    >
                      {FEE_UNITS.map((unit) => (
                        <NativeSelectOption key={unit} value={unit}>
                          {FEE_UNIT_LABELS[unit]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`kalem-${String(index)}-kdv`}
                  label="KDV (%)"
                  error={itemErrors?.vatPercent}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`items.${index}.vatPercent`)}
                      inputMode="decimal"
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`kalem-${String(index)}-kdv-tarih`}
                  label="KDV geçerlilik tarihi"
                  error={itemErrors?.vatEffectiveDate}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`items.${index}.vatEffectiveDate`)}
                      type="date"
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`kalem-${String(index)}-onayli`}
                  label="MEBBİS onaylı tutar (₺)"
                  error={itemErrors?.announcedAmount}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`items.${index}.announcedAmount`)}
                      inputMode="decimal"
                      disabled={busy}
                    />
                  )}
                </FormField>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || items.fields.length === 1}
                    aria-label={`${String(index + 1)}. kalemi kaldır`}
                    onClick={() => items.remove(index)}
                  >
                    Kalemi kaldır
                  </Button>
                </div>
                {itemValue && tariffItemExceedsAnnounced(itemValue) ? (
                  <p
                    role="status"
                    className="col-span-full rounded-card border bg-surface-soft px-4 py-3 text-sm"
                  >
                    Tutar, MEBBİS onaylı tutarı aşıyor. Taslak kaydedilebilir, ancak tarife bu
                    haliyle yayımlanamaz.
                  </p>
                ) : null}
              </div>
            )
          })}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                items.append({
                  kind: 'meal',
                  level: '',
                  amount: '',
                  unit: 'year',
                  vatPercent: '10',
                  vatEffectiveDate: dayKey(),
                  announcedAmount: '',
                })
              }
            >
              <Icon name="Plus" size={17} aria-hidden="true" />
              Kalem ekle
            </Button>
          </div>
        </fieldset>
        <fieldset className="grid gap-4">
          <legend className="mb-2 font-semibold">İlan edilen indirimler</legend>
          {discounts.fields.map((field, index) => {
            const discountErrors = errors.discounts?.[index]
            return (
              <div
                key={field.id}
                className="grid grid-cols-4 items-end gap-3 rounded-card border p-3 max-[650px]:grid-cols-1"
              >
                <FormField
                  id={`indirim-${String(index)}-tur`}
                  label="İndirim"
                  error={discountErrors?.kind}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`discounts.${index}.kind`)}
                      disabled={busy}
                    >
                      {FEE_DISCOUNT_KINDS.map((kind) => (
                        <NativeSelectOption key={kind} value={kind}>
                          {FEE_DISCOUNT_KIND_LABELS[kind]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`indirim-${String(index)}-mod`}
                  label="Tür"
                  error={discountErrors?.mode}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`discounts.${index}.mode`)}
                      disabled={busy}
                    >
                      <NativeSelectOption value="percent">Oran (%)</NativeSelectOption>
                      <NativeSelectOption value="amount">Tutar (₺)</NativeSelectOption>
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`indirim-${String(index)}-deger`}
                  label="Değer"
                  error={discountErrors?.value}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`discounts.${index}.value`)}
                      inputMode="decimal"
                      disabled={busy}
                    />
                  )}
                </FormField>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  aria-label={`${String(index + 1)}. indirimi kaldır`}
                  onClick={() => discounts.remove(index)}
                >
                  Kaldır
                </Button>
              </div>
            )
          })}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => discounts.append({ kind: 'sibling', mode: 'percent', value: '' })}
            >
              <Icon name="Plus" size={17} aria-hidden="true" />
              İndirim ekle
            </Button>
          </div>
        </fieldset>
        <fieldset className="grid gap-4">
          <legend className="mb-2 font-semibold">Ödeme koşulları</legend>
          <p className="text-sm text-muted-foreground">
            Kayıt ve yenileme yalnız burada ilan edilen taksit sayılarıyla yapılır. Fiyat farkı ilan
            ücretinden düşer, ilan ücretinin üstüne çıkılamaz. Peşin indirimi yukarıdaki &quot;Peşin
            ödeme&quot; indirim satırıyla ilan edilir.
          </p>
          {terms.fields.map((field, index) => {
            const termErrors = errors.paymentTerms?.[index]
            const value = termValues[index]
            const upfront = value?.kind === 'upfront'
            const position = String(index + 1)
            return (
              <div
                key={field.id}
                className="grid grid-cols-3 items-end gap-3 rounded-card border p-3 max-[650px]:grid-cols-1"
              >
                <FormField
                  id={`kosul-${String(index)}-tur`}
                  label={`${position}. ödeme koşulu`}
                  error={termErrors?.kind}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`paymentTerms.${index}.kind`)}
                      disabled={busy}
                    >
                      {FEE_PAYMENT_TERM_KINDS.map((kind) => (
                        <NativeSelectOption key={kind} value={kind}>
                          {FEE_PAYMENT_TERM_KIND_LABELS[kind]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                {upfront ? (
                  <p className="self-center text-sm text-muted-foreground">Tek ödeme.</p>
                ) : (
                  <>
                    <FormField
                      id={`kosul-${String(index)}-en-az`}
                      label={`${position}. koşul en az taksit`}
                      error={termErrors?.minInstallments}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          {...form.register(`paymentTerms.${index}.minInstallments`)}
                          inputMode="numeric"
                          disabled={busy}
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`kosul-${String(index)}-en-cok`}
                      label={`${position}. koşul en çok taksit`}
                      error={termErrors?.maxInstallments}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          {...form.register(`paymentTerms.${index}.maxInstallments`)}
                          inputMode="numeric"
                          disabled={busy}
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`kosul-${String(index)}-fark`}
                      label={`${position}. koşul fiyat farkı`}
                      error={termErrors?.mode}
                    >
                      {(control) => (
                        <NativeSelect
                          {...control}
                          {...form.register(`paymentTerms.${index}.mode`)}
                          disabled={busy}
                        >
                          <NativeSelectOption value="none">Yok</NativeSelectOption>
                          <NativeSelectOption value="percent">İndirim oranı (%)</NativeSelectOption>
                          <NativeSelectOption value="amount">İndirim tutarı (₺)</NativeSelectOption>
                        </NativeSelect>
                      )}
                    </FormField>
                    {value?.mode === 'none' ? null : (
                      <FormField
                        id={`kosul-${String(index)}-deger`}
                        label={`${position}. koşul indirim değeri`}
                        error={termErrors?.value}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            {...form.register(`paymentTerms.${index}.value`)}
                            inputMode="decimal"
                            disabled={busy}
                          />
                        )}
                      </FormField>
                    )}
                  </>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  aria-label={`${position}. ödeme koşulunu kaldır`}
                  onClick={() => terms.remove(index)}
                >
                  Kaldır
                </Button>
              </div>
            )
          })}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                terms.append({
                  kind: 'installment',
                  minInstallments: '2',
                  maxInstallments: '12',
                  mode: 'none',
                  value: '',
                })
              }
            >
              <Icon name="Plus" size={17} aria-hidden="true" />
              Koşul ekle
            </Button>
          </div>
        </fieldset>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

function PublishModal({ tariff, onClose }: { tariff: TariffRecord; onClose: () => void }) {
  const publish = usePublishFeeTariff()
  const today = dayKey()
  const form = useForm<{ announcedDate: string; mebbisRecordedDate: string }>({
    defaultValues: { announcedDate: today, mebbisRecordedDate: '' },
  })
  const busy = publish.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const { session } = useAuth()
  const institutionType = session?.institution.type ?? 'school'
  const announcedDate = useWatch({ control: form.control, name: 'announcedDate' })

  const onSubmit = form.handleSubmit(async ({ announcedDate, mebbisRecordedDate }) => {
    const outcome = await publish.submit(
      {
        tariffId: tariff.id,
        version: tariff.version,
        body: { announcedDate, mebbisRecordedDate: mebbisRecordedDate || null },
      },
      {
        setError: (name, error) => {
          if (name === 'announcedDate' || name === 'mebbisRecordedDate') form.setError(name, error)
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Tarife yayımlandı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Tarifeyi yayımla"
      description="Yayımlanan sürüm değiştirilemez; aynı yılın önceki sürümü yayından kalkar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={PUBLISH_FORM} disabled={busy} aria-busy={busy || undefined}>
            Tarifeyi yayımla
          </Button>
        </>
      }
    >
      <form
        id={PUBLISH_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        {announcedDate && isOutsideAnnouncementPeriod(announcedDate, institutionType) ? (
          <p role="status" className="rounded-card border bg-surface-soft px-4 py-3 text-sm">
            İlan tarihi ocak–mayıs dönemi dışında. Okullarda ücret bu dönemde ilan edilir (5580 md.
            13/1); yayımlamadan önce gerekçenizi kontrol edin.
          </p>
        ) : null}
        <FormField id="yayim-ilan" label="İlan tarihi" error={errors.announcedDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('announcedDate', { required: 'İlan tarihini seçin.' })}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="yayim-mebbis"
          label="MEBBİS'e işlendiği tarih (isteğe bağlı)"
          error={errors.mebbisRecordedDate}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('mebbisRecordedDate')}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
