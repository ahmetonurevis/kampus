import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { CEFR_LEVELS } from '@kampus/school-core/content/taxonomy.ts'
import {
  COURSE_GROUP_CAPACITY_MAX,
  COURSE_LANGUAGES,
  COURSE_NAME_MAX,
  COURSE_TOTAL_HOURS_MAX,
  COURSE_WEEKLY_HOURS_MAX,
} from '@kampus/school-core/lib/courses.ts'
import type { Course } from '@kampus/react-shared/courses.ts'
import { useCourse, useCreateCourse, useUpdateCourse } from '@kampus/react-shared/use-courses.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
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
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  courseDefaults,
  courseFormErrorField,
  courseFormSchema,
  coursePatch,
  createCourseBody,
  isProgramLocked,
  type CourseFormOutput,
  type CourseFormValues,
} from './course-forms.ts'
import { CEFR_LEVEL_KEYS, COURSE_LANGUAGE_KEYS, certifiedText, sessionText } from './course-rows.ts'
import { useDiscardGuard, useReportDirty } from './use-discard-guard.tsx'

/** `?kur-form=yeni` yeni kur; aksi hâlde düzenlenen kurun kimliği. */
export const NEW_COURSE = 'yeni'

type Props = {
  /** `''` kapalı. */
  target: string
  /** Öğretmen koordinatörse yalnız kendi seviyeleri seçilir; yöneticide `null` (hepsi). */
  levels: ReadonlySet<string> | null
  onClose: () => void
}

/**
 * Kur tanımla/düzenle (IST-076): dokuz alanlı form geniş pencerede, iki sütun. Etkin kurun program
 * alanları (dil, seviye, saatler, oturum, belge; DOM-DIL-005) salt okur gösterilir ve gönderilmez.
 * Kirli form kapatılırken onay sorulur; 409 sürüm çakışmasında form korunur, güncel kaydı yükleme
 * önerilir.
 */
export function CourseFormModal({ target, levels, onClose }: Props) {
  const guard = useDiscardGuard(onClose)
  const creating = target === NEW_COURSE
  return (
    <>
      <Modal
        open={target !== ''}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title={creating ? 'Kur tanımla' : 'Kuru düzenle'}
        description="Kur, kurumun öğretim programıdır; tarihli açılışı gruptur."
        size="wide"
      >
        {creating ? (
          <CourseForm
            levels={levels}
            onCancel={guard.requestClose}
            onDone={guard.closeClean}
            setDirty={guard.setDirty}
          />
        ) : null}
        {target !== '' && !creating ? (
          <CourseEdit
            courseId={target}
            levels={levels}
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

type FormHandlers = {
  levels: ReadonlySet<string> | null
  onCancel: () => void
  onDone: () => void
  setDirty: (dirty: boolean) => void
}

function CourseEdit({ courseId, ...handlers }: FormHandlers & { courseId: string }) {
  const item = useCourse(courseId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const course = item.data?.data
  if (!course) return <SummaryLoading />
  if (course.status === 'archived')
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Arşivlenmiş kur değiştirilemez.
      </p>
    )
  return (
    <CourseForm
      {...handlers}
      course={course}
      reload={async () => {
        const fresh = (await item.refetch()).data?.data
        return fresh ? { version: fresh.rowVersion ?? 0, values: courseDefaults(fresh) } : null
      }}
    />
  )
}

function CourseForm({
  course,
  levels,
  reload,
  onCancel,
  onDone,
  setDirty,
}: FormHandlers & {
  course?: Course
  reload?: () => Promise<{ version: number; values: CourseFormValues } | null>
}) {
  const create = useCreateCourse()
  const update = useUpdateCourse()
  const form = useForm<CourseFormValues, unknown, CourseFormOutput>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: courseDefaults(course),
  })
  const conflict = useEditConflict<CourseFormValues>({
    initialVersion: course?.rowVersion ?? 0,
    reload: async () => (reload ? reload() : null),
    apply: (values) => form.reset(values),
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const locked = isProgramLocked(course)
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  // Öğretmen koordinatörü olmadığı seviyede kur açamaz; düzenlenen kurun seviyesi listede kalır.
  const levelOptions = CEFR_LEVEL_KEYS.filter(
    (key) => levels === null || levels.has(key) || key === course?.level,
  )

  const submit = form.handleSubmit(async (parsed) => {
    const routes = {
      setError: form.setError,
      fieldFor: courseFormErrorField,
      silent: isVersionConflict,
    }
    if (!course) {
      const outcome = await create.submit(createCourseBody(parsed), routes)
      if (outcome.status === 'success') {
        notify.success('Kur taslak olarak kaydedildi.')
        onDone()
      }
      return
    }
    const body = coursePatch(course, parsed)
    if (Object.keys(body).length === 0) {
      notify.info('Değişiklik yok.')
      onDone()
      return
    }
    const outcome = await update.submit(
      { courseId: course.id, version: conflict.version, body },
      routes,
    )
    if (outcome.status === 'success') {
      notify.success('Kur güncellendi.')
      onDone()
      return
    }
    if (outcome.status === 'failed' && isVersionConflict(outcome.error)) conflict.markConflict()
  })

  const number = (field: keyof CourseFormValues) => form.register(field, { valueAsNumber: true })
  return (
    <form
      noValidate
      aria-label={course ? 'Kuru düzenle' : 'Kur tanımla'}
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField id="kur-ad" label="Kur adı" error={errors.name}>
            {(control) => (
              <Input
                {...control}
                {...form.register('name')}
                maxLength={COURSE_NAME_MAX}
                placeholder="Örn. Genel İngilizce A1"
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        {locked && course ? (
          <LockedProgram course={course} />
        ) : (
          <>
            <FormField id="kur-dil" label="Dil" error={errors.language}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('language')}
                  className="w-full"
                  disabled={busy}
                >
                  {COURSE_LANGUAGE_KEYS.map((key) => (
                    <NativeSelectOption key={key} value={key}>
                      {COURSE_LANGUAGES[key]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id="kur-seviye" label="CEFR seviyesi" error={errors.level}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('level')}
                  className="w-full"
                  disabled={busy}
                >
                  {levelOptions.map((key) => (
                    <NativeSelectOption key={key} value={key}>
                      {CEFR_LEVELS[key].label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id="kur-toplam-saat"
              label="Toplam ders saati"
              description="Bir ders saati 45 dakikadır."
              error={errors.totalHours}
            >
              {(control) => (
                <Input
                  {...control}
                  {...number('totalHours')}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={COURSE_TOTAL_HOURS_MAX}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id="kur-haftalik-saat"
              label="Haftalık ders saati"
              description="Haftalık sıklık: oturum sayısı bundan hesaplanır."
              error={errors.weeklyHours}
            >
              {(control) => (
                <Input
                  {...control}
                  {...number('weeklyHours')}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={COURSE_WEEKLY_HOURS_MAX}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id="kur-oturum" label="Ders süresi" error={errors.sessionMinutes}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('sessionMinutes', { setValueAs: Number })}
                  className="w-full"
                  disabled={busy}
                >
                  <NativeSelectOption value={45}>{sessionText(45)}</NativeSelectOption>
                  <NativeSelectOption value={90}>{sessionText(90)}</NativeSelectOption>
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id="kur-belge"
              label="Belge türü"
              description="Belgeli kurs e-Özel'de onaylanmadan etkinleşmez."
              error={errors.certified}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('certified', {
                    setValueAs: (value: unknown) => value === true || value === 'true',
                  })}
                  className="w-full"
                  disabled={busy}
                >
                  <NativeSelectOption value="false">{certifiedText(false)}</NativeSelectOption>
                  <NativeSelectOption value="true">{certifiedText(true)}</NativeSelectOption>
                </NativeSelect>
              )}
            </FormField>
          </>
        )}
        <FormField
          id="kur-asgari"
          label="Asgari açılış (kişi)"
          description="Grup bu sayıya ulaşmadan açılmaz."
          error={errors.minLearners}
        >
          {(control) => (
            <Input
              {...control}
              {...number('minLearners')}
              type="number"
              inputMode="numeric"
              min={1}
              max={COURSE_GROUP_CAPACITY_MAX}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="kur-kapasite"
          label="Kapasite (en çok kişi)"
          description={`Grup mevcudu en çok ${COURSE_GROUP_CAPACITY_MAX} kişidir.`}
          error={errors.maxLearners}
        >
          {(control) => (
            <Input
              {...control}
              {...number('maxLearners')}
              type="number"
              inputMode="numeric"
              min={1}
              max={COURSE_GROUP_CAPACITY_MAX}
              disabled={busy}
            />
          )}
        </FormField>
      </div>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onCancel} />
    </form>
  )
}

/** Etkin kurun değişmeyen program alanları: salt okur, formdan gönderilmez. */
function LockedProgram({ course }: { course: Course }) {
  const items = [
    ['Dil', COURSE_LANGUAGES[course.language]],
    ['CEFR seviyesi', CEFR_LEVELS[course.level].label],
    ['Toplam ders saati', `${course.totalHours} saat`],
    ['Haftalık ders saati', `${course.weeklyHours} saat`],
    ['Ders süresi', sessionText(course.sessionMinutes)],
    ['Belge türü', certifiedText(course.certified)],
  ] as const
  return (
    <div className="grid gap-3 sm:col-span-2">
      <p className="text-sm text-muted-foreground">
        Etkin kurun programı değişmez; farklı program için yeni kur tanımlayın.
      </p>
      <dl aria-label="Kur programı" className="grid gap-3 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-card border bg-surface-soft px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
