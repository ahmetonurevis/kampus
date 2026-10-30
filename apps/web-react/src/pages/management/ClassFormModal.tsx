import { useEffect, useRef, useState, type FormEvent } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { subjectsForGrade } from '@kampus/school-core/data/curriculum.ts'
import { classInputSchema } from '@kampus/school-core/lib/school-management.ts'
import { useSaveClass } from '@kampus/react-shared/use-management-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { FormSteps } from '@/components/FormSteps.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { NEW_RECORD } from './CampusFormPanel.tsx'
import {
  ConflictNotice,
  errorRoutes,
  isVersionConflict,
  RootError,
  useEditConflict,
} from './FormParts.tsx'
import {
  activeOf,
  CLASS_ERROR_FIELDS,
  CLASS_INFO_FIELDS,
  CLASS_STEPS,
  classBody,
  classDefaults,
  classStepOf,
  fillSubjectTeachers,
  missingTeachers,
  type ClassFormValues,
  type ClassPayload,
  type ClassStep,
} from './management-forms.ts'
import type { ManagementLookups } from './management-rows.ts'
import { SummaryLoading } from './SummaryParts.tsx'

type SchoolClass = CoreRecord<'classes'>

const GRADES = Array.from({ length: 8 }, (_, index) => index + 5)
const STEP_HEADINGS = [
  'Sınıf bilgileri',
  'Ders ve öğretmen atamaları',
  'Kaydetmeden önce kontrol edin',
] as const

type ModalProps = {
  /** `''` kapalı, `yeni` oluşturma, aksi hâlde düzenlenen sınıfın kimliği. */
  target: string
  lookups: ManagementLookups
  onClose: () => void
}

/**
 * Sınıf aç/düzenle (Vue "Sınıf" formu): uzun form geniş pencerede, üç adımda — bilgiler,
 * ders → branş öğretmeni atamaları, kontrol. Kontenjan, derslik ve atama kuralları sunucuda
 * core `saveClass` ile doğrulanır; yolsuz iş kuralı hatası ilgili alanın altında gösterilir ve
 * kullanıcı o alanın adımına döner.
 */
export function ClassFormModal({ target, lookups, onClose }: ModalProps) {
  const creating = target === NEW_RECORD
  return (
    <Modal
      open={target !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={creating ? 'Sınıf ekle' : 'Sınıfı düzenle'}
      size="wide"
    >
      {creating ? <ClassForm lookups={lookups} onClose={onClose} /> : null}
      {target !== '' && !creating ? (
        <ClassEdit classId={target} lookups={lookups} onClose={onClose} />
      ) : null}
    </Modal>
  )
}

function ClassEdit({
  classId,
  lookups,
  onClose,
}: Omit<ModalProps, 'target'> & { classId: string }) {
  const item = useCoreItem('classes', classId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  if (!item.data.record.isActive)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Arşivdeki sınıf düzenlenemez. Önce arşivden geri alın.
      </p>
    )
  return (
    <ClassForm
      record={item.data.record}
      version={item.data.version}
      lookups={lookups}
      reload={async () => {
        const fresh = (await item.refetch()).data
        return fresh
          ? {
              version: fresh.version,
              values: defaultsFor(fresh.record, lookups),
            }
          : null
      }}
      onClose={onClose}
    />
  )
}

function defaultsFor(record: SchoolClass | undefined, lookups: ManagementLookups) {
  return classDefaults(
    record,
    record ? (lookups.assignmentsByClass.get(record.id) ?? []) : [],
    activeOf(lookups.branches.values()),
    activeOf(lookups.teachers.values()),
  )
}

type FormProps = {
  record?: SchoolClass
  version?: number
  lookups: ManagementLookups
  reload?: () => Promise<{ version: number; values: ClassFormValues } | null>
  onClose: () => void
}

function ClassForm({ record, version = 0, lookups, reload, onClose }: FormProps) {
  const branches = activeOf(lookups.branches.values())
  const teachers = activeOf(lookups.teachers.values())
  const save = useSaveClass()
  const [step, setStep] = useState<ClassStep>(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const stepChanged = useRef(false)
  const form = useForm<ClassFormValues, unknown, ClassPayload>({
    resolver: zodResolver(classInputSchema),
    defaultValues: defaultsFor(record, lookups),
  })
  const conflict = useEditConflict<ClassFormValues>({
    initialVersion: version,
    reload: async () => (reload ? reload() : null),
    apply: (values) => {
      form.reset(values)
      setStep(0)
    },
  })
  const busy = save.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const values = useWatch({ control: form.control })
  const grade = Number(values.grade)

  // Adım değişince odak adım başlığına gider (klavye ve ekran okuyucu bağlamı kaybetmez).
  useEffect(() => {
    if (stepChanged.current) heading.current?.focus()
    stepChanged.current = true
  }, [step])

  async function goTo(next: ClassStep) {
    if (next > step && step === 0) {
      if (!(await form.trigger([...CLASS_INFO_FIELDS]))) return
      form.setValue(
        'subjectTeachers',
        fillSubjectTeachers(
          Number(form.getValues('grade')),
          form.getValues('branchId'),
          form.getValues('subjectTeachers'),
          teachers,
        ),
      )
    }
    if (next > step && step === 1 && !assignmentsComplete()) return
    setStep(next)
  }

  /** Düzeyin her dersi için öğretmen seçilmeli; eksik ders alanının altında bildirilir. */
  function assignmentsComplete(): boolean {
    const missing = missingTeachers(
      Number(form.getValues('grade')),
      form.getValues('subjectTeachers'),
    )
    for (const subject of missing)
      form.setError(`subjectTeachers.${subject.id}`, {
        type: 'required',
        message: `${subject.name} dersi için uygun branş öğretmeni seçin.`,
      })
    return missing.length === 0
  }

  const submit = form.handleSubmit(async (parsed) => {
    if (!assignmentsComplete()) {
      setStep(1)
      return
    }
    const body = classBody(parsed)
    const outcome = await save.submit(
      record ? { recordId: record.id, version: conflict.version, body } : { body },
      { setError: form.setError, ...errorRoutes(CLASS_ERROR_FIELDS, true) },
    )
    if (outcome.status === 'success') {
      notify.success(record ? 'Sınıf güncellendi.' : 'Sınıf eklendi.')
      onClose()
      return
    }
    if (outcome.status !== 'failed') return
    if (isVersionConflict(outcome.error)) conflict.markConflict()
    // Yolsuz iş kuralı hatası alanına bağlanır; hatalı alanın adımına dönülür.
    const mapped = CLASS_ERROR_FIELDS[outcome.error.code as keyof typeof CLASS_ERROR_FIELDS]
    const fields = [
      ...(mapped ? [mapped] : []),
      ...outcome.error.issues.map((issue) => issue.path.join('.')),
    ]
    const first = fields[0]
    if (first !== undefined) setStep(classStepOf(first))
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step < 2) void goTo((step + 1) as ClassStep)
    else void submit(event)
  }

  const studentCount = record ? (lookups.studentCounts.get(record.id) ?? 0) : 0
  const subjects = subjectsForGrade(grade)
  const submitLabel = step < 2 ? 'Devam et' : 'Kaydet'
  return (
    <form
      noValidate
      aria-label={record ? 'Sınıfı düzenle' : 'Sınıf ekle'}
      onSubmit={onSubmit}
      className="grid gap-5"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      <FormSteps
        steps={CLASS_STEPS}
        current={step}
        onBack={(index) => setStep(index as ClassStep)}
      />
      <h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
        {STEP_HEADINGS[step]}
      </h3>
      <p className="text-sm text-muted-foreground">
        {step === 2
          ? 'Bilgileri değiştirmek için önceki adımlara dönebilirsiniz.'
          : 'Bu adımdaki tüm alanlar zorunludur.'}
      </p>

      {/* Adımlar gizlenir, kaldırılmaz: alan değerleri ve hatalar adımlar arasında korunur. */}
      <div hidden={step !== 0} className="grid gap-5 sm:grid-cols-2">
        <FormField id="sinif-duzey" label="Sınıf düzeyi" error={errors.grade}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('grade')}
              className="w-full"
              disabled={busy}
            >
              {GRADES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}. Sınıf
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="sinif-sube" label="Şube harfi" error={errors.section}>
          {(control) => (
            <Input
              {...control}
              {...form.register('section')}
              maxLength={3}
              placeholder="A"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="sinif-kampus" label="Kampüs" error={errors.branchId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('branchId')}
              className="w-full"
              disabled={busy}
            >
              {branches.map((branch) => (
                <NativeSelectOption key={branch.id} value={branch.id}>
                  {branch.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="sinif-kontenjan"
          label="Kontenjan"
          error={errors.capacity}
          {...(studentCount > 0
            ? {
                description: `Sınıfta ${studentCount} aktif öğrenci var; kontenjan bundan az olamaz.`,
              }
            : {})}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('capacity')}
              type="number"
              inputMode="numeric"
              min={1}
              max={40}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="sinif-derslik" label="Derslik" error={errors.room}>
          {(control) => (
            <Input
              {...control}
              {...form.register('room')}
              maxLength={30}
              placeholder="Örn. 209"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="sinif-danisman" label="Sınıf danışmanı" error={errors.teacherId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('teacherId')}
              className="w-full"
              disabled={busy}
            >
              {teachers.map((teacher) => (
                <NativeSelectOption key={teacher.id} value={teacher.id}>
                  {teacher.name} · {teacher.subject}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <div hidden={step !== 1} className="grid gap-5 sm:grid-cols-2">
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Her ders için ilgili branştan bir öğretmen seçin. Atamalar öğretmen panellerine yansır.
        </p>
        {subjects.map((subject) => (
          <FormField
            key={subject.id}
            id={`sinif-ders-${subject.id}`}
            label={`${subject.name} öğretmeni`}
            error={errors.subjectTeachers?.[subject.id]}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register(`subjectTeachers.${subject.id}`, {
                  onChange: () => form.clearErrors(`subjectTeachers.${subject.id}`),
                })}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Öğretmen seçin</NativeSelectOption>
                {teachers
                  .filter((teacher) => teacher.subjectId === subject.id)
                  .map((teacher) => (
                    <NativeSelectOption key={teacher.id} value={teacher.id}>
                      {teacher.name} · {lookups.branches.get(teacher.branchId)?.name ?? '—'}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            )}
          </FormField>
        ))}
      </div>

      {step === 2 ? (
        <div className="grid gap-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ['Sınıf', `${grade}-${String(values.section ?? '').toLocaleUpperCase('tr')}`],
              ['Kampüs', lookups.branches.get(values.branchId ?? '')?.name ?? '—'],
              [
                'Kontenjan / Derslik',
                `${String(values.capacity ?? '')} öğrenci · ${values.room ?? ''}`,
              ],
              ['Danışman', lookups.teachers.get(values.teacherId ?? '')?.name ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card border bg-surface-soft px-4 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
          <ul aria-label="Ders atamaları" className="grid gap-1 text-sm">
            {subjects.map((subject) => (
              <li key={subject.id} className="flex justify-between gap-4 border-b py-2">
                <span>{subject.name}</span>
                <strong className="font-medium">
                  {lookups.teachers.get(values.subjectTeachers?.[subject.id] ?? '')?.name ?? '—'}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        {step > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((step - 1) as ClassStep)}
            disabled={busy}
          >
            <Icon name="ArrowLeft" size={17} aria-hidden="true" />
            Geri
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={busy || (step === 2 && conflict.conflicted)}
          aria-busy={busy || undefined}
        >
          <Icon name={step < 2 ? 'ArrowRight' : 'Check'} size={17} aria-hidden="true" />
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
