import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useRecordMedicationAdministration } from '@kampus/react-shared/use-finance-infirmary.ts'
import {
  useCorrectMedicationAdministration,
  useCorrectMedicationDoseSkip,
  useMedicationChart,
  useMedicationSettings,
  useRecordMedicationDoseSkip,
  useSetMedicationSettings,
  type MedicationChartItem,
  type MedicationDoseRecord,
} from '@kampus/react-shared/use-finance-infirmary-schedule.ts'
import {
  DOSE_CORRECTION_KIND_LABELS,
  DOSE_CORRECTION_KINDS,
  DOSE_SKIP_REASON_LABELS,
  DOSE_SKIP_REASONS,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'
import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  activeRecord,
  administrationCorrectionBody,
  chartSummaryText,
  correctionDefaults,
  correctionFormField,
  correctionFormSchema,
  doseRecordText,
  doseStateBadge,
  skipBody,
  skipCorrectionBody,
  skipDefaults,
  skipFormSchema,
  toleranceFormSchema,
  type CorrectionFormValues,
  type SkipFormValues,
  type ToleranceFormValues,
} from './finance-infirmary-schedule-forms.ts'

/**
 * "Bugünkü ilaçlar" (DOM-FIN-152; ON-161; K-511…K-513): Revir sekmesinde günün onaylı ilaçlarının
 * doz çizelgesi. Geciken dozlar üstte; her satır büyük dokunma hedefli "Verildi" ve "Atla"
 * işlemleriyle (yalnız bugün), yöneticide gerekçeli düzeltme/iptal ve gecikme payı ayarıyla gelir.
 * Yoklamada yok/izinli öğrenci işaretlenir. Sağlık ayrıntısı sunucudan okunur ve denetime düşer;
 * veliye ileti gönderilmez. Görünümün erişim gerekçesi Revir sekmesinde bir kez seçilir
 * (DOM-FIN-156).
 */
export function TodayMedications({ reason }: { reason: HealthAccessReason }) {
  const { session } = useAuth()
  const isManager = session?.role === 'yonetici'
  const [today] = useState(() => dayKey(new Date()))
  const [day, setDay] = useState(today)
  const isToday = day === today
  const chart = useMedicationChart(isToday ? undefined : day, reason)
  const [skipItem, setSkipItem] = useState<MedicationChartItem | null>(null)
  const [correcting, setCorrecting] = useState<MedicationDoseRecord | null>(null)
  const [toleranceOpen, setToleranceOpen] = useState(false)
  const data = chart.data?.data
  const items = data?.items ?? []
  return (
    <section aria-labelledby="revir-bugun" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h3 id="revir-bugun" className="text-base font-semibold">
            {isToday ? 'Bugünkü ilaçlar' : `${dateLabel(day)} ilaçları`}
          </h3>
          {data ? (
            <p className="text-sm text-muted-foreground">
              {`Gecikme payı ${String(data.lateToleranceMinutes)} dk`}
              {items.length === 0 ? '' : ` · ${chartSummaryText(items)}`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor="revir-ilac-gun" className="text-sm font-medium">
              Gün
            </label>
            <Input
              id="revir-ilac-gun"
              type="date"
              className="min-h-11"
              value={day}
              onChange={(event) => setDay(event.target.value === '' ? today : event.target.value)}
            />
          </div>
          {isManager ? (
            <Button variant="outline" className="min-h-11" onClick={() => setToleranceOpen(true)}>
              Gecikme payı
            </Button>
          ) : null}
        </div>
      </div>
      {chart.error ? (
        <QueryError error={chart.error} onRetry={() => void chart.refetch()} />
      ) : chart.isPending ? (
        <SummaryLoading />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isToday ? 'Bugün verilecek onaylı ilaç yok.' : 'Bu gün için onaylı ilaç yok.'}
        </p>
      ) : (
        <ul aria-label="Bugünkü ilaçlar" className="grid gap-2">
          {items.map((item) => (
            <DoseRow
              key={`${item.consentId} ${item.scheduledTime}`}
              item={item}
              canRecord={isToday}
              isManager={isManager}
              onSkip={() => setSkipItem(item)}
              onCorrect={setCorrecting}
            />
          ))}
        </ul>
      )}
      <Modal
        open={skipItem !== null}
        onOpenChange={(open) => (open ? undefined : setSkipItem(null))}
        title="Dozu atla"
      >
        {skipItem ? <SkipForm item={skipItem} day={day} onDone={() => setSkipItem(null)} /> : null}
      </Modal>
      <Modal
        open={correcting !== null}
        onOpenChange={(open) => (open ? undefined : setCorrecting(null))}
        title={correcting?.kind === 'skip' ? 'Atlamayı düzelt' : 'Uygulamayı düzelt'}
      >
        {correcting ? (
          <CorrectionForm record={correcting} onDone={() => setCorrecting(null)} />
        ) : null}
      </Modal>
      {isManager ? (
        <Modal open={toleranceOpen} onOpenChange={setToleranceOpen} title="Gecikme payı">
          <ToleranceForm onDone={() => setToleranceOpen(false)} />
        </Modal>
      ) : null}
    </section>
  )
}

function DoseRow({
  item,
  canRecord,
  isManager,
  onSkip,
  onCorrect,
}: {
  item: MedicationChartItem
  canRecord: boolean
  isManager: boolean
  onSkip: () => void
  onCorrect: (record: MedicationDoseRecord) => void
}) {
  const record = useRecordMedicationAdministration()
  const badge = doseStateBadge(item.state)
  const active = activeRecord(item)
  const voided = item.records.filter((row) => row.voided)
  const student = item.studentName ?? 'Öğrenci'
  const give = async () => {
    const outcome = await record.submit({
      consentId: item.consentId,
      body: { scheduledTime: item.scheduledTime, dose: item.dose },
    })
    if (outcome.status === 'success') notify.success('İlaç uygulaması kaydedildi.')
  }
  return (
    <li className="grid gap-2 rounded-card border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold tabular-nums">{item.scheduledTime}</span>
        <StatusBadge text={badge.text} tone={badge.tone} />
        {item.absent === true ? <StatusBadge text="Yoklamada yok" tone="red" /> : null}
      </div>
      <p>{`${item.studentName ?? '—'} · ${item.medicationName} (${item.dose})`}</p>
      {active ? (
        <p className="text-muted-foreground">
          {doseRecordText(active)}
          {active.note === null ? '' : ` · ${active.note}`}
          {active.corrected ? ' · düzeltildi' : ''}
        </p>
      ) : null}
      {voided.length === 0 ? null : (
        <ul
          aria-label={`${student} ${item.scheduledTime} iptal edilen kayıtlar`}
          className="grid gap-1"
        >
          {voided.map((row) => (
            <li key={row.id} className="text-muted-foreground line-through">
              {`İptal: ${doseRecordText(row)}`}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {active === null && canRecord ? (
          <>
            <Button
              className="min-h-12 flex-1 sm:flex-none"
              disabled={record.isPending}
              aria-busy={record.isPending || undefined}
              aria-label={`${student} ${item.scheduledTime} dozunu verildi olarak kaydet`}
              onClick={() => void give()}
            >
              Verildi
            </Button>
            <Button
              variant="outline"
              className="min-h-12 flex-1 sm:flex-none"
              aria-label={`${student} ${item.scheduledTime} dozunu atla`}
              onClick={onSkip}
            >
              Atla
            </Button>
          </>
        ) : null}
        {active !== null && isManager ? (
          <Button
            variant="outline"
            className="min-h-12 flex-1 sm:flex-none"
            aria-label={`${student} ${item.scheduledTime} kaydını düzelt`}
            onClick={() => onCorrect(active)}
          >
            Düzelt
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function SkipForm({
  item,
  day,
  onDone,
}: {
  item: MedicationChartItem
  day: string
  onDone: () => void
}) {
  const skip = useRecordMedicationDoseSkip()
  const form = useForm<SkipFormValues>({
    resolver: zodResolver(skipFormSchema),
    defaultValues: skipDefaults(),
  })
  const errors = form.formState.errors
  const busy = skip.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await skip.submit(
      { consentId: item.consentId, body: skipBody(item, day, values) },
      {
        setError: (name, error) =>
          form.setError(name === 'reason' || name === 'note' ? name : 'root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Doz atlandı olarak kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Dozu atla"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{`${item.scheduledTime} · ${item.studentName ?? '—'} · ${item.medicationName}`}</p>
      <FormField id="ilac-atla-gerekce" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <NativeSelect {...control} {...form.register('reason')} disabled={busy}>
            {DOSE_SKIP_REASONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {DOSE_SKIP_REASON_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="ilac-atla-aciklama" label="Açıklama" error={errors.note}>
        {(control) => <Textarea {...control} {...form.register('note')} rows={3} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-12" disabled={busy} aria-busy={busy || undefined}>
        Atlandı olarak kaydet
      </Button>
    </form>
  )
}

function CorrectionForm({ record, onDone }: { record: MedicationDoseRecord; onDone: () => void }) {
  const correctAdministration = useCorrectMedicationAdministration()
  const correctSkip = useCorrectMedicationDoseSkip()
  const form = useForm<CorrectionFormValues>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: correctionDefaults(record),
  })
  const errors = form.formState.errors
  const kind = useWatch({ control: form.control, name: 'kind' })
  const busy =
    correctAdministration.isPending || correctSkip.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const options = {
      setError: (name: string, error: { type: string; message: string }) =>
        form.setError(correctionFormField(name) ?? 'root.server', error),
    }
    const outcome =
      record.kind === 'administration'
        ? await correctAdministration.submit(
            { administrationId: record.id, body: administrationCorrectionBody(record, values) },
            options,
          )
        : await correctSkip.submit(
            { skipId: record.id, body: skipCorrectionBody(record, values) },
            options,
          )
    if (outcome.status !== 'success') return
    notify.success(values.kind === 'void' ? 'Kayıt iptal edildi.' : 'Düzeltme kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Kaydı düzelt"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{`${record.scheduledTime} · ${doseRecordText(record)}`}</p>
      <p className="text-sm text-muted-foreground">
        Kayıt silinmez; düzeltme gerekçesiyle ayrı kayıt olarak eklenir. İptal edilen dozun saatine
        yeniden kayıt yazılabilir.
      </p>
      <FormField id="ilac-duzelt-tur" label="İşlem" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} disabled={busy}>
            {DOSE_CORRECTION_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {DOSE_CORRECTION_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {kind === 'amend' && record.kind === 'administration' ? (
        <FormField id="ilac-duzelt-saat" label="Uygulama saati" error={errors.time}>
          {(control) => (
            <Input {...control} {...form.register('time')} type="time" disabled={busy} />
          )}
        </FormField>
      ) : null}
      {kind === 'amend' && record.kind === 'skip' ? (
        <FormField id="ilac-duzelt-atlama" label="Atlama gerekçesi" error={errors.skipReason}>
          {(control) => (
            <NativeSelect {...control} {...form.register('skipReason')} disabled={busy}>
              {DOSE_SKIP_REASONS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {DOSE_SKIP_REASON_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {kind === 'amend' ? (
        <FormField id="ilac-duzelt-not" label="Not" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      ) : null}
      <FormField id="ilac-duzelt-gerekce" label="Düzeltme gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-12" disabled={busy} aria-busy={busy || undefined}>
        {kind === 'void' ? 'Kaydı iptal et' : 'Düzeltmeyi kaydet'}
      </Button>
    </form>
  )
}

function ToleranceForm({ onDone }: { onDone: () => void }) {
  const settings = useMedicationSettings()
  const save = useSetMedicationSettings()
  const current = settings.data?.data
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  if (!current) return <SummaryLoading />
  return (
    <ToleranceFields
      initial={current.lateToleranceMinutes}
      busyExternal={save.isPending}
      onSave={async (values, setError) => {
        const outcome = await save.submit({ version: current.version, body: values }, { setError })
        if (outcome.status !== 'success') return
        notify.success('Gecikme payı kaydedildi.')
        onDone()
      }}
    />
  )
}

function ToleranceFields({
  initial,
  busyExternal,
  onSave,
}: {
  initial: number
  busyExternal: boolean
  onSave: (
    values: ToleranceFormValues,
    setError: (name: string, error: { type: string; message: string }) => void,
  ) => Promise<void>
}) {
  const form = useForm<ToleranceFormValues>({
    resolver: zodResolver(toleranceFormSchema),
    defaultValues: { lateToleranceMinutes: initial },
  })
  const errors = form.formState.errors
  const busy = busyExternal || form.formState.isSubmitting
  const onSubmit = form.handleSubmit((values) =>
    onSave(values, (name, error) =>
      form.setError(name === 'lateToleranceMinutes' ? name : 'root.server', error),
    ),
  )
  return (
    <form
      noValidate
      aria-label="Gecikme payı"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="ilac-gecikme-payi"
        label="Gecikme payı (dakika)"
        description="Doz saatinden bu kadar dakika sonra verilmeyen doz gecikti sayılır."
        error={errors.lateToleranceMinutes}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('lateToleranceMinutes', { valueAsNumber: true })}
            type="number"
            inputMode="numeric"
            min={5}
            max={180}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-12" disabled={busy} aria-busy={busy || undefined}>
        Kaydet
      </Button>
    </form>
  )
}
