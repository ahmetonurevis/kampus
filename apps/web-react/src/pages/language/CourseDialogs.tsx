import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  COURSE_EOZEL_APPROVAL_LABELS,
  COURSE_EOZEL_MARKS,
  COURSE_PROGRAM_CODE_MAX,
  courseEOzelSchema,
  type CourseEOzelInput,
} from '@kampus/school-core/lib/courses.ts'
import type { Course } from '@kampus/react-shared/courses.ts'
import {
  useArchiveCourse,
  useCourse,
  useRecordCourseEOzel,
} from '@kampus/react-shared/use-courses.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import {
  ConflictNotice,
  FormActions,
  isVersionConflict,
  RootError,
  useEditConflict,
} from '../management/FormParts.tsx'
import { eOzelDefaults, eOzelErrorField, type EOzelFormValues } from './course-forms.ts'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from './fresh-submit.ts'
import { useDiscardGuard, useReportDirty } from './use-discard-guard.tsx'

/**
 * Kur arşivi onayı: geri alınmaz; kapanmamış grubu olan kur arşivlenmez (sunucu 422
 * `course_has_open_groups`, toast). `If-Match` sürümü gönderimde kurun kimlikle yeniden okunan
 * kaydındandır (listedeki kopya bayat olabilir); 409'da uyarı ve "Güncel kaydı yükle" çıkar.
 */
export function CourseArchiveDialog({
  course,
  onClose,
}: {
  course: Course | null
  onClose: () => void
}) {
  const archive = useArchiveCourse()
  const item = useCourse(course?.id ?? '')
  const [conflicted, setConflicted] = useState(false)
  const [reloading, setReloading] = useState(false)
  const live = item.data?.data ?? course
  const archived = live?.status === 'archived'

  function close() {
    setConflicted(false)
    onClose()
  }
  async function reloadRecord() {
    setReloading(true)
    try {
      await item.refetch()
      setConflicted(false)
    } finally {
      setReloading(false)
    }
  }
  async function confirm() {
    if (!course) return
    const result = await submitWithFreshRecord(
      async () => {
        const fresh = (await item.refetch()).data?.data
        return fresh && fresh.status !== 'archived' ? fresh : undefined
      },
      (fresh) =>
        archive.submit(
          { courseId: fresh.id, version: fresh.rowVersion ?? 0 },
          { silent: isVersionConflict },
        ),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setConflicted(true)
      return
    }
    if (result.outcome.status === 'busy') return
    if (result.outcome.status === 'success') notify.success(`${course.name} arşivlendi.`)
    close()
  }
  return (
    <Modal
      open={course !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title="Kuru arşivle"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={archive.isPending || conflicted || archived}
            aria-busy={archive.isPending || undefined}
          >
            <Icon name="Archive" size={17} aria-hidden="true" />
            Arşivle
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {conflicted ? (
          <ConflictNotice onReload={() => void reloadRecord()} reloading={reloading} />
        ) : null}
        <p className="text-sm">
          <strong className="font-semibold">{course?.name}</strong>{' '}
          {archived
            ? 'zaten arşivlenmiş.'
            : 'arşivlenecek. Arşiv geri alınmaz; kurdan yeni grup planlanamaz. Kapanmamış grubu olan kur arşivlenmez.'}
        </p>
      </div>
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
  const item = useCourse(course.id)
  const form = useForm<EOzelFormValues, unknown, CourseEOzelInput>({
    resolver: zodResolver(courseEOzelSchema),
    defaultValues: eOzelDefaults(course),
  })
  const conflict = useEditConflict<EOzelFormValues>({
    initialVersion: course.rowVersion ?? 0,
    reload: async () => {
      const fresh = (await item.refetch()).data?.data
      return fresh ? { version: fresh.rowVersion ?? 0, values: eOzelDefaults(fresh) } : null
    },
    apply: (values) => form.reset(values),
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const busy = record.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const submit = form.handleSubmit(async (body) => {
    const result = await submitWithFreshRecord(
      async () => (await item.refetch()).data?.data,
      (fresh) =>
        record.submit(
          { courseId: fresh.id, version: fresh.rowVersion ?? 0, body },
          { setError: form.setError, fieldFor: eOzelErrorField, silent: isVersionConflict },
        ),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) conflict.markConflict()
    if (result.outcome.status === 'success') {
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
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
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
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onCancel} />
    </form>
  )
}
