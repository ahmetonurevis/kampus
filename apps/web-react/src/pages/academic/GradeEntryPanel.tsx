import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { gradeRecordSchema } from '@kampus/school-core/lib/grades.ts'
import { useRecordGrade } from '@kampus/react-shared/use-academic-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import type { AcademicLookups } from './academic-rows.ts'
import { defaultTerm, gradeTypeOptions, teachingSubjectIds } from './academic-write.ts'
import type { TeacherScope } from './use-teacher-scope.ts'

type GradeFormInput = z.input<typeof gradeRecordSchema>
type GradeFormOutput = z.output<typeof gradeRecordSchema>

const FORM_ID = 'not-girisi-formu'

type Props = {
  open: boolean
  lookups: AcademicLookups
  scope: TeacherScope
  onClose: () => void
}

/**
 * Not girişi (öğretmen): kısa form sağ panelde. Sınıf ve ders seçenekleri öğretmenin ders
 * atamalarından gelir (başka sınıf veya ders seçilemez); şema school-core `gradeRecordSchema`dır,
 * sunucu doğrulama maddeleri alanlara yazılır. Başarıda panel kapanır, liste tazelenir.
 */
export function GradeEntryPanel({ open, lookups, scope, onClose }: Props) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Not gir"
      description="Resmî not kaydı ekler; dönem ortalaması kayıtlardan hesaplanır."
    >
      {open ? <GradeEntryForm lookups={lookups} scope={scope} onClose={onClose} /> : null}
    </SidePanel>
  )
}

function GradeEntryForm({ lookups, scope, onClose }: Omit<Props, 'open'>) {
  const today = dayKey()
  const [classId, setClassId] = useState('')
  const record = useRecordGrade()
  const form = useForm<GradeFormInput, unknown, GradeFormOutput>({
    resolver: zodResolver(gradeRecordSchema),
    defaultValues: {
      studentId: '',
      subjectId: '',
      assessmentType: 'sinav',
      term: defaultTerm(today),
      date: today,
      score: '',
      topic: '',
    },
  })
  const busy = record.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const classes = useMemo(
    () =>
      [...scope.classIds]
        .map((id) => lookups.classes.get(id))
        .filter((item) => item !== undefined)
        .sort((left, right) => left.name.localeCompare(right.name, 'tr', { numeric: true })),
    [scope.classIds, lookups.classes],
  )
  const selectedClass = lookups.classes.get(classId)
  const students = lookups.studentsByClass.get(classId) ?? []
  const subjects = teachingSubjectIds(scope.assignments, scope.teacherId, classId).map((id) => ({
    id,
    name: lookups.subjects.get(id)?.name ?? id,
  }))
  const types = gradeTypeOptions(selectedClass?.grade)

  function chooseClass(next: string) {
    setClassId(next)
    // Öğrenci ve ders sınıfa bağlıdır; eski seçim yeni sınıfta geçersiz olur.
    const only = teachingSubjectIds(scope.assignments, scope.teacherId, next)
    form.setValue('studentId', '')
    form.setValue('subjectId', only.length === 1 ? (only[0] ?? '') : '')
    form.clearErrors(['studentId', 'subjectId'])
    const nextGrade = lookups.classes.get(next)?.grade ?? 0
    // Seçili tür yeni sınıfta sunulmuyorsa (katılım, lise) varsayılana döner.
    if (form.getValues('assessmentType') === 'katilim' && nextGrade > 8)
      form.setValue('assessmentType', 'sinav')
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await record.submit(values, { setError: form.setError })
    if (outcome.status === 'success') {
      notify.success('Not kaydedildi.')
      onClose()
    }
  })

  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
      <FormField id="not-sinif" label="Sınıf">
        {(control) => (
          <NativeSelect
            {...control}
            value={classId}
            onChange={(event) => chooseClass(event.target.value)}
            disabled={busy}
          >
            <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
            {classes.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="not-ders" label="Ders" error={errors.subjectId}>
        {(control) => (
          <NativeSelect {...control} {...form.register('subjectId')} disabled={busy || !classId}>
            <NativeSelectOption value="">Ders seçin</NativeSelectOption>
            {subjects.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="not-tur" label="Değerlendirme türü" error={errors.assessmentType}>
        {(control) => (
          <NativeSelect {...control} {...form.register('assessmentType')} disabled={busy}>
            {types.map((item) => (
              <NativeSelectOption key={item.value} value={item.value}>
                {item.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="not-ogrenci" label="Öğrenci" error={errors.studentId}>
        {(control) => (
          <NativeSelect {...control} {...form.register('studentId')} disabled={busy || !classId}>
            <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
            {students.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="not-puan" label="Puan (0-100)" error={errors.score}>
        {(control) => (
          <Input
            {...control}
            {...form.register('score')}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-4 max-[420px]:grid-cols-1">
        <FormField id="not-donem" label="Dönem" error={errors.term}>
          {(control) => (
            <NativeSelect {...control} {...form.register('term')} disabled={busy}>
              <NativeSelectOption value={1}>1. dönem</NativeSelectOption>
              <NativeSelectOption value={2}>2. dönem</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <FormField id="not-tarih" label="Tarih" error={errors.date}>
          {(control) => (
            <Input
              {...control}
              {...form.register('date')}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
      </div>
      <FormField id="not-konu" label="Kazanım / Konu (isteğe bağlı)" error={errors.topic}>
        {(control) => (
          <Input {...control} {...form.register('topic')} maxLength={200} disabled={busy} />
        )}
      </FormField>
      {errors.root?.server?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.root.server.message}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        <Icon name="CircleCheck" size={17} aria-hidden="true" />
        Notu kaydet
      </Button>
    </form>
  )
}
