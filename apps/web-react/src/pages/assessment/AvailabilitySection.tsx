import { useId, useMemo, useState } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import {
  useAddAvailabilitySlot,
  useRemoveAvailabilitySlot,
} from '@kampus/react-shared/use-assessment-commands.ts'
import { automationSchemas } from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session as CoreSession } from '@kampus/school-core/lib/domain.ts'
import type { Session } from '@/auth/auth-port.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { notify } from '@/lib/notify.ts'
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources } from '../workflows/workflow-state.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import {
  availabilityRows,
  AVAILABILITY_SOURCES,
  slotRequest,
  slotTeachers,
  type AvailabilityRow,
  type SlotFormValues,
} from './tutoring-model.ts'

const MOBILE_COLUMNS = ['when', 'duration'] as const
const FIELDS = ['teacherId', 'date', 'duration'] as const satisfies (keyof SlotFormValues)[]
/** Sunucunun çakışma ve gelecek-saat kuralları tarih alanına yazılır. */
const DATE_CODES = new Set([
  'availability_must_be_future',
  'availability_overlap',
  'tutor_schedule_conflict',
])

/** Formu core `automationSchemas.slot` şemasıyla doğrular (sunucuyla aynı şema). */
const resolver: Resolver<SlotFormValues> = (values) => {
  const parsed = automationSchemas.slot.safeParse(slotRequest(values))
  if (parsed.success) return { values, errors: {} }
  const errors: FieldErrors<SlotFormValues> = {}
  for (const issue of parsed.error.issues) {
    const key = FIELDS.find((name) => name === issue.path[0])
    if (key && !errors[key]) errors[key] = { type: issue.code, message: issue.message }
  }
  return { values: {}, errors }
}

type Props = { session: Session; actor: CoreSession }

/**
 * Öğretmen uygunluk saatleri (etüt planlamasının girdisi): yönetici herkes için, öğretmen kendisi
 * için saat ekler ve kaldırır; kural ve yetkiyi sunucu zorlar (ekran yalnız gizler). Saat
 * kaldırmak mevcut etütleri iptal etmez; geri alınamayacağından kısa bir onay istenir.
 */
export function AvailabilitySection({ session, actor }: Props) {
  const sources = useMemo(
    () => collectionSources(AVAILABILITY_SOURCES, session.role),
    [session.role],
  )
  const data = useSourcesState(sources, session)
  const now = useMinuteClock()
  const rows = availabilityRows(data.state, actor, now)
  const teachers = slotTeachers(data.state, actor)
  const [removing, setRemoving] = useState<AvailabilityRow | null>(null)

  const columns = useMemo<DataColumn<AvailabilityRow>[]>(
    () => [
      { key: 'teacher', label: 'Öğretmen' },
      { key: 'when', label: 'Başlangıç' },
      { key: 'duration', label: 'Süre (dk)' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.past ? 'Geçmiş' : 'Açık'} />,
      },
      {
        key: 'actions',
        label: 'İşlem',
        cell: (row) =>
          row.manageable ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`${row.when} uygunluk saatini kaldır`}
              onClick={() => setRemoving(row)}
            >
              Kaldır
            </Button>
          ) : null,
      },
    ],
    [],
  )

  return (
    <AssessmentPanel
      id="uygunluk-saatleri"
      title="Öğretmen uygunluk saatleri"
      description="Otomatik etüt planı yalnız bu saatlere etüt yerleştirir."
      flush
    >
      {data.error || teachers.length ? (
        <div className="grid gap-4 px-6 pt-2 pb-6 max-[650px]:px-4">
          {data.error ? <QueryError error={data.error} onRetry={data.retry} /> : null}
          {teachers.length ? (
            <SlotForm
              key={teachers[0]?.id}
              teachers={teachers}
              admin={session.role === 'yonetici'}
            />
          ) : null}
        </div>
      ) : null}
      <DataTable
        listKey="uygunluk-saatleri"
        rows={rows}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        searchKeys={['teacher', 'when']}
        caption="Öğretmen uygunluk saatleri"
        empty="Henüz uygunluk saati yok."
      />
      {removing ? (
        <RemoveDialog
          row={removing}
          version={data.versions.get(removing.id)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </AssessmentPanel>
  )
}

function SlotForm({
  teachers,
  admin,
}: {
  teachers: readonly { id: string; name: string }[]
  admin: boolean
}) {
  const prefix = useId()
  const add = useAddAvailabilitySlot()
  const form = useForm<SlotFormValues>({
    resolver,
    defaultValues: { teacherId: teachers[0]?.id ?? '', date: '', duration: '30' },
  })
  const errors = form.formState.errors
  const busy = add.isPending || form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await add.submit(slotRequest(values), {
      setError: (name, issue) => {
        const field = FIELDS.find((item) => item === name)
        if (field) form.setError(field, issue)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Uygunluk saati eklendi.')
      form.reset({ ...values, date: '' })
      return
    }
    if (outcome.status === 'failed' && DATE_CODES.has(outcome.error.code))
      form.setError('date', { type: outcome.error.code, message: outcome.error.message })
  })

  return (
    <form
      noValidate
      aria-label="Uygunluk saati ekle"
      onSubmit={(event) => void onSubmit(event)}
      className="grid max-w-3xl gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {admin ? (
          <FormField id={`${prefix}-ogretmen`} label="Öğretmen" error={errors.teacherId}>
            {(control) => (
              <NativeSelect {...control} className="w-full" {...form.register('teacherId')}>
                {teachers.map((teacher) => (
                  <NativeSelectOption key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <FormField
          id={`${prefix}-tarih`}
          label="Başlangıç (tarih ve saat)"
          error={errors.date}
          description="Gelecekte bir saat seçin; saat Türkiye saatidir."
        >
          {(control) => <Input {...control} type="datetime-local" {...form.register('date')} />}
        </FormField>
        <FormField
          id={`${prefix}-sure`}
          label="Süre (dakika)"
          error={errors.duration}
          description="15 ile 120 dakika arası."
        >
          {(control) => (
            <Input {...control} type="number" inputMode="numeric" {...form.register('duration')} />
          )}
        </FormField>
      </div>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Uygunluk saati ekle
        </Button>
      </div>
    </form>
  )
}

function RemoveDialog({
  row,
  version,
  onClose,
}: {
  row: AvailabilityRow
  version: number | undefined
  onClose: () => void
}) {
  const remove = useRemoveAvailabilitySlot()

  async function confirm() {
    const outcome = await remove.submit({ slotId: row.id, version })
    if (outcome.status === 'success') {
      notify.success('Uygunluk saati kaldırıldı. Mevcut etütler iptal edilmez.')
      onClose()
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Uygunluk saatini kaldır"
      description="Bu işlem geri alınamaz; saat gerekirse yeniden eklenebilir."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            type="button"
            disabled={remove.isPending}
            aria-busy={remove.isPending || undefined}
            onClick={() => void confirm()}
          >
            Saati kaldır
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {row.teacher} için {row.when} ({row.duration} dk) uygunluk saati kaldırılacak. Bu saate daha
        önce yerleştirilmiş etütler iptal edilmez.
      </p>
    </Modal>
  )
}
