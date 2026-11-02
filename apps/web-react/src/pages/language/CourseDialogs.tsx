import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  COURSE_EOZEL_APPROVAL_LABELS,
  COURSE_EOZEL_MARKS,
  COURSE_PROGRAM_CODE_MAX,
  courseEOzelSchema,
  type CourseEOzelInput,
} from '@kampus/school-core/lib/courses.ts'
import type { Course } from '@kampus/react-shared/courses.ts'
import { useArchiveCourse, useRecordCourseEOzel } from '@kampus/react-shared/use-courses.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { FormActions, isVersionConflict, RootError } from '../management/FormParts.tsx'
import { eOzelDefaults, eOzelErrorField, type EOzelFormValues } from './course-forms.ts'
import { useDiscardGuard, useReportDirty } from './use-discard-guard.tsx'

/**
 * Kur arşivi onayı: geri alınmaz; kapanmamış grubu olan kur arşivlenmez (sunucu 422
 * `course_has_open_groups`, toast).
 */
export function CourseArchiveDialog({
  course,
  onClose,
}: {
  course: Course | null
  onClose: () => void
}) {
  const archive = useArchiveCourse()
  async function confirm() {
    if (!course) return
    const outcome = await archive.submit({ courseId: course.id, version: course.rowVersion ?? 0 })
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') notify.success(`${course.name} arşivlendi.`)
    onClose()
  }
  return (
    <Modal
      open={course !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kuru arşivle"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
          >
            <Icon name="Archive" size={17} aria-hidden="true" />
            Arşivle
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <strong className="font-semibold">{course?.name}</strong> arşivlenecek. Arşiv geri alınmaz;
        kurdan yeni grup planlanamaz. Kapanmamış grubu olan kur arşivlenmez.
      </p>
    </Modal>
  )
}

/** e-Özel kaydı (yalnız yönetici, DOM-DIL-006): program kodu ve onay durumu. Kısa form. */
export function EOzelModal({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const guard = useDiscardGuard(onClose)
  return (
    <>
      <Modal
        open={course !== null}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title="e-Özel kaydı"
        description="Platform e-Özel'e yazmaz; kurumun e-Özel'e işlediği programı burada işaretleyin."
      >
        {course ? (
          <EOzelForm
            key={course.id}
            course={course}
            onCancel={guard.requestClose}
            onDone={guard.closeClean}
            setDirty={guard.setDirty}
          />
        ) : null}
      </Modal>
      {guard.dialog}
    </>
  )
}

function EOzelForm({
  course,
  onCancel,
  onDone,
  setDirty,
}: {
  course: Course
  onCancel: () => void
  onDone: () => void
  setDirty: (dirty: boolean) => void
}) {
  const record = useRecordCourseEOzel()
  const form = useForm<EOzelFormValues, unknown, CourseEOzelInput>({
    resolver: zodResolver(courseEOzelSchema),
    defaultValues: eOzelDefaults(course),
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const busy = record.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const submit = form.handleSubmit(async (body) => {
    const outcome = await record.submit(
      { courseId: course.id, version: course.rowVersion ?? 0, body },
      { setError: form.setError, fieldFor: eOzelErrorField, silent: isVersionConflict },
    )
    if (outcome.status === 'success') {
      notify.success('e-Özel kaydı güncellendi.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="e-Özel kaydı"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <FormField id="eozel-kod" label="e-Özel program kodu" error={errors.programCode}>
        {(control) => (
          <Input
            {...control}
            {...form.register('programCode')}
            maxLength={COURSE_PROGRAM_CODE_MAX}
            autoComplete="off"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="eozel-durum" label="Onay durumu" error={errors.approval}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('approval')}
            className="w-full"
            disabled={busy}
          >
            {COURSE_EOZEL_MARKS.map((mark) => (
              <NativeSelectOption key={mark} value={mark}>
                {COURSE_EOZEL_APPROVAL_LABELS[mark]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onCancel} />
    </form>
  )
}
