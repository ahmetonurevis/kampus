import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { CEFR_LEVELS } from '@kampus/school-core/content/taxonomy.ts'
import { PACKAGE_KIND_LABELS, PACKAGE_KINDS } from '@kampus/school-core/lib/finance-packages.ts'
import { useAllCourses } from '@kampus/react-shared/use-courses.ts'
import {
  useCreateLessonPackage,
  useUpdateLessonPackage,
} from '@kampus/react-shared/use-finance-packages.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  packageBody,
  packageDefaults,
  packageFormField,
  packageFormSchema,
  packageUpdateBody,
  type PackageFormValues,
  type PackageRecord,
} from './package-forms.ts'

const FORM_ID = 'paket-formu'
const LEVELS = Object.keys(CEFR_LEVELS)

/**
 * Paket tanımı (yönetici; DOM-DIL-050, DOM-DIL-006). Tür ve kur bağı sonradan değişmez. Kur ücretinde
 * saat ve seviye kurdan gelir; saat ücreti boşsa tarifenin saat ücreti uygulanır, ilan üstü satışta
 * sunucu reddeder. Sürüm tutmazsa pencere kapanır, liste tazelenir: yeniden açan güncel satırı görür.
 */
export function PackageFormModal({
  pkg,
  onClose,
}: {
  pkg?: PackageRecord | undefined
  onClose: () => void
}) {
  const create = useCreateLessonPackage()
  const update = useUpdateLessonPackage()
  const courses = useAllCourses()
  const form = useForm<PackageFormValues>({
    resolver: zodResolver(packageFormSchema),
    defaultValues: packageDefaults(pkg),
  })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const courseId = useWatch({ control: form.control, name: 'courseId' })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const editing = pkg !== undefined
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = packageFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (pkg) {
      const outcome = await update.submit(
        { packageId: pkg.id, version: pkg.version, body: packageUpdateBody(values) },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Paket güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(packageBody(values), fields)
    if (outcome.status === 'success') {
      notify.success('Paket tanımlandı.')
      onClose()
    }
  })

  // Arşivli kura yeni paket bağlanamaz; düzeltmede bağlı kur adı görünmeye devam eder.
  const courseOptions = (courses.data ?? []).filter(
    (course) => course.status !== 'archived' || course.id === pkg?.courseId,
  )
  const title = editing ? 'Paketi düzenle' : 'Yeni paket'
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Paket tutar taşımaz; fiyat satış anında yayımdaki tarifeden hesaplanır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      {courses.error ? (
        <QueryError error={courses.error} onRetry={() => void courses.refetch()} />
      ) : null}
      <form
        id={FORM_ID}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="paket-ad" label="Paket adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="paket-tur" label="Paket türü" error={errors.kind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('kind')}
              className="w-full"
              disabled={busy || editing}
            >
              {PACKAGE_KINDS.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {PACKAGE_KIND_LABELS[item]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="paket-kur"
          label={kind === 'course' ? 'Kur' : 'Kur (isteğe bağlı)'}
          error={errors.courseId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('courseId')}
              className="w-full"
              disabled={busy || editing}
            >
              <NativeSelectOption value="">
                {kind === 'course' ? 'Kur seçin' : 'Kura bağlı değil'}
              </NativeSelectOption>
              {courseOptions.map((course) => (
                <NativeSelectOption key={course.id} value={course.id}>
                  {course.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {courseId === '' ? (
          <FormField
            id="paket-seviye"
            label="Seviye (isteğe bağlı)"
            description="Tarifede bu seviyenin saat ücreti varsa o uygulanır."
            error={errors.level}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('level')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Genel</NativeSelectOption>
                {LEVELS.map((level) => (
                  <NativeSelectOption key={level} value={level}>
                    {level}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {kind === 'course' ? null : (
          <FormField id="paket-saat" label="Ders saati" error={errors.lessonHours}>
            {(control) => (
              <Input
                {...control}
                {...form.register('lessonHours')}
                inputMode="numeric"
                disabled={busy}
              />
            )}
          </FormField>
        )}
        <FormField
          id="paket-saat-ucreti"
          label="İlan altı saat ücreti (₺, isteğe bağlı)"
          description="Boş bırakılırsa tarifenin saat ücreti uygulanır."
          error={errors.hourlyAmount}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('hourlyAmount')}
              inputMode="decimal"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="paket-sure"
          label="Kullanım süresi (gün, isteğe bağlı)"
          description="Boş bırakılırsa paketin son kullanma tarihi olmaz."
          error={errors.validityDays}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('validityDays')}
              inputMode="numeric"
              disabled={busy}
            />
          )}
        </FormField>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}
