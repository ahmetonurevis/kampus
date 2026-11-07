import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { z } from 'zod'
import {
  useCreateScholarshipProgram,
  useNotifyScholarshipProgram,
  useRecordScholarshipMebbis,
  useScholarshipAwards,
  useScholarshipPrograms,
} from '@kampus/react-shared/use-finance-scholarships.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import {
  programBody,
  programDefaults,
  programFormSchema,
  programValueLabel,
  type ProgramFormValues,
} from './scholarship-forms.ts'

type ProgramRow = {
  id: string
  name: string
  durationNote: string
  percentBasisPoints: number | null
  amountCents: number | null
  capacity: number
  awardedCount: number
  notifiedDate: string | null
  version: number
  valueLabel: string
  seats: string
}
type AwardRow = {
  id: string
  studentName: string
  programName: string
  amountCents: number
  mebbisRecordedDate: string | null
  version: number
}
type DateTarget =
  | { kind: 'notify'; id: string; version: number; name: string }
  | { kind: 'mebbis'; id: string; version: number; name: string }

const NO_SORT: readonly string[] = []
const PROGRAM_MOBILE = ['name', 'valueLabel', 'notified']
const AWARD_MOBILE = ['studentName', 'amount', 'mebbis']
const PROGRAM_FORM = 'burs-programi-formu'
const DATE_FORM = 'burs-tarih-formu'
const dayText = (day: string) => dateLabel(day, { year: 'numeric' })

/**
 * Burs programları ve atamaları (DOM-FIN-025; IST-105). Yönetici program açar ve il millî eğitim
 * müdürlüğüne bildirim gününü işler; bildirilmemiş program kesin kayıtta seçilemez. Atama kesin
 * kayıtta yapılır, burada listelenir ve MEBBİS'e işlendiği gün kaydedilir. Ön büro yalnız görür.
 */
export function ScholarshipsSection({
  canManage,
  academicYear,
}: {
  canManage: boolean
  academicYear: number
}) {
  const learner = useEnrollmentLearner()
  const programList = useListState('burs-programlari')
  const awardList = useListState('burs-atamalari')
  const programs = useScholarshipPrograms({
    page: programList.state.page,
    pageSize: programList.state.pageSize,
  })
  const awards = useScholarshipAwards({
    page: awardList.state.page,
    pageSize: awardList.state.pageSize,
  })
  const students = useCoreAll('students')
  const [creating, setCreating] = useState(false)
  const [dating, setDating] = useState<DateTarget | null>(null)

  const programRows = useMemo(
    () =>
      programs.data?.data.map((program): ProgramRow => ({
        ...program,
        valueLabel: programValueLabel(program),
        seats: `${String(program.awardedCount)} / ${String(program.capacity)}`,
      })),
    [programs.data],
  )
  const awardRows = useMemo(() => {
    const studentNames = new Map(students.data?.map((item) => [item.id, item.record.name]))
    const programNames = new Map(programs.data?.data.map((item) => [item.id, item.name]))
    return awards.data?.data.map((award): AwardRow => ({
      ...award,
      studentName: studentNames.get(award.studentId) ?? '—',
      programName: programNames.get(award.programId) ?? '—',
    }))
  }, [awards.data, programs.data, students.data])

  const programColumns = useMemo<DataColumn<ProgramRow>[]>(
    () => [
      { key: 'name', label: 'Program' },
      { key: 'valueLabel', label: 'Miktar' },
      { key: 'durationNote', label: 'Süre' },
      { key: 'seats', label: 'Burslu' },
      {
        key: 'notified',
        label: 'Bildirim',
        cell: (row) =>
          row.notifiedDate ? (
            dayText(row.notifiedDate)
          ) : (
            <StatusBadge text="Bildirilmedi" tone="amber" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          canManage && row.notifiedDate === null ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} bildirim gününü işle`}
              onClick={() =>
                setDating({ kind: 'notify', id: row.id, version: row.version, name: row.name })
              }
            >
              Bildirimi işle
            </Button>
          ) : null,
      },
    ],
    [canManage],
  )
  const awardColumns = useMemo<DataColumn<AwardRow>[]>(
    () => [
      { key: 'studentName', label: learner.title },
      { key: 'programName', label: 'Program' },
      { key: 'amount', label: 'Burs tutarı', cell: (row) => money(row.amountCents) },
      {
        key: 'mebbis',
        label: 'MEBBİS',
        cell: (row) =>
          row.mebbisRecordedDate ? (
            dayText(row.mebbisRecordedDate)
          ) : (
            <StatusBadge text="İşlenmedi" tone="amber" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          canManage && row.mebbisRecordedDate === null ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.studentName} bursunun MEBBİS gününü işle`}
              onClick={() =>
                setDating({
                  kind: 'mebbis',
                  id: row.id,
                  version: row.version,
                  name: row.studentName,
                })
              }
            >
              MEBBİS'e işlendi
            </Button>
          ) : null,
      },
    ],
    [canManage, learner],
  )

  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="burs-programlari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="burs-programlari" className="text-lg font-semibold">
              Burs programları
            </h2>
            <p className="text-sm text-muted-foreground">
              İl millî eğitim müdürlüğüne bildirilmemiş program kesin kayıtta seçilemez. Burs,
              indirim tavanına girmez.
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Yeni burs programı
            </Button>
          ) : null}
        </header>
        <ServerDataTable
          list={programList}
          rows={programRows}
          total={programs.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={programColumns}
          mobileColumns={PROGRAM_MOBILE}
          caption="Burs programları"
          search={false}
          loading={programs.isPending}
          fetching={programs.isFetching && !programs.isPending}
          error={
            programs.error ? (
              <QueryError error={programs.error} onRetry={() => void programs.refetch()} />
            ) : undefined
          }
        />
      </section>
      <section
        aria-labelledby="burs-atamalari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="burs-atamalari" className="text-lg font-semibold">
            Burs atamaları
          </h2>
          <p className="text-sm text-muted-foreground">
            Burs, kesin kayıt sırasında atanır. Atamanın MEBBİS'e işlendiği günü buradan kaydedin.
          </p>
        </header>
        <ServerDataTable
          list={awardList}
          rows={awardRows}
          total={awards.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={awardColumns}
          mobileColumns={AWARD_MOBILE}
          caption="Burs atamaları"
          search={false}
          loading={awards.isPending}
          fetching={awards.isFetching && !awards.isPending}
          error={
            awards.error ? (
              <QueryError error={awards.error} onRetry={() => void awards.refetch()} />
            ) : undefined
          }
        />
      </section>
      {creating ? (
        <ProgramModal academicYear={academicYear} onClose={() => setCreating(false)} />
      ) : null}
      {dating ? <DateModal target={dating} onClose={() => setDating(null)} /> : null}
    </div>
  )
}

function ProgramModal({ academicYear, onClose }: { academicYear: number; onClose: () => void }) {
  const create = useCreateScholarshipProgram()
  const form = useForm<ProgramFormValues, unknown, z.output<typeof programFormSchema>>({
    resolver: zodResolver(programFormSchema),
    defaultValues: programDefaults(),
  })
  const kind = useWatch({ control: form.control, name: 'valueKind' })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(programBody(values, academicYear), {
      setError: (name, error) => {
        if (
          name === 'name' ||
          name === 'conditions' ||
          name === 'terminationConditions' ||
          name === 'durationNote' ||
          name === 'capacity'
        )
          form.setError(name, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Burs programı açıldı.')
      onClose()
    }
  })

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Yeni burs programı"
      description={`${String(academicYear)}–${String(academicYear + 1)} eğitim yılı`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={PROGRAM_FORM} disabled={busy} aria-busy={busy || undefined}>
            Programı aç
          </Button>
        </>
      }
    >
      <form
        id={PROGRAM_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="burs-ad" label="Program adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="burs-sart" label="Burs şartları" error={errors.conditions}>
          {(control) => (
            <Textarea {...control} {...form.register('conditions')} rows={2} disabled={busy} />
          )}
        </FormField>
        <FormField id="burs-kesilme" label="Kesilme koşulları" error={errors.terminationConditions}>
          {(control) => (
            <Textarea
              {...control}
              {...form.register('terminationConditions')}
              rows={2}
              disabled={busy}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="burs-sure" label="Süre" error={errors.durationNote}>
            {(control) => <Input {...control} {...form.register('durationNote')} disabled={busy} />}
          </FormField>
          <FormField id="burs-sayi" label="Burslu sayısı" error={errors.capacity}>
            {(control) => (
              <Input
                {...control}
                {...form.register('capacity')}
                inputMode="numeric"
                disabled={busy}
              />
            )}
          </FormField>
          <FormField id="burs-tur" label="Miktar türü" error={errors.valueKind}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('valueKind')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="percent">Oran (%)</NativeSelectOption>
                <NativeSelectOption value="amount">Sabit tutar (₺)</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          {kind === 'percent' ? (
            <FormField id="burs-oran" label="Oran (%)" error={errors.percent}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('percent')}
                  inputMode="decimal"
                  disabled={busy}
                />
              )}
            </FormField>
          ) : (
            <FormField id="burs-tutar" label="Tutar (₺)" error={errors.amount}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('amount')}
                  inputMode="decimal"
                  disabled={busy}
                />
              )}
            </FormField>
          )}
        </div>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

/** Bildirim ya da MEBBİS gününü bir kez işleyen pencere; gelecek gün sunucuda da reddedilir. */
function DateModal({ target, onClose }: { target: DateTarget; onClose: () => void }) {
  const notifyProgram = useNotifyScholarshipProgram()
  const recordMebbis = useRecordScholarshipMebbis()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<{ day: string }>({ defaultValues: { day: today } })
  const busy = notifyProgram.isPending || recordMebbis.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const isNotify = target.kind === 'notify'
  const setError = (_name: string, error: { type: string; message: string }) =>
    form.setError('day', error, { shouldFocus: true })

  const onSubmit = form.handleSubmit(async ({ day }) => {
    const outcome = isNotify
      ? await notifyProgram.submit(
          { programId: target.id, version: target.version, body: { notifiedDate: day } },
          { setError },
        )
      : await recordMebbis.submit(
          { awardId: target.id, version: target.version, body: { recordedDate: day } },
          { setError },
        )
    if (outcome.status === 'success') {
      notify.success(isNotify ? 'Bildirim günü işlendi.' : "MEBBİS'e işlendiği kaydedildi.")
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={isNotify ? 'Bildirim gününü işle' : "MEBBİS'e işlendi"}
      description={`${target.name}. Bu gün bir kez işlenir, sonradan değiştirilemez.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={DATE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={DATE_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="burs-gun"
          label={isNotify ? 'İl millî eğitim müdürlüğüne bildirim günü' : "MEBBİS'e işlendiği gün"}
          error={errors.day}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('day', { required: 'Günü seçin.' })}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
