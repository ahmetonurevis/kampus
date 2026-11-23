import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useState } from 'react'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  GROUP_AGE_BAND_LABELS,
  GROUP_AGE_BANDS,
  GROUP_NAME_MAX,
  GROUP_ROOM_MAX,
  sessionsPerWeek,
  WEEKDAY_LABELS,
} from '@kampus/school-core/lib/language-groups.ts'
import type { Course } from '@kampus/react-shared/courses.ts'
import type { LanguageGroup } from '@kampus/react-shared/language-groups.ts'
import { useActiveCourses } from '@kampus/react-shared/use-courses.ts'
import {
  useCreateLanguageGroup,
  useLanguageGroup,
  useUpdateLanguageGroup,
} from '@kampus/react-shared/use-language-groups.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
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
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  createGroupBody,
  groupDefaults,
  groupFormErrorField,
  groupFormSchema,
  groupPatch,
  isScheduleLocked,
  NEW_SLOT,
  type GroupFormOutput,
  type GroupFormValues,
} from './group-forms.ts'
import { DELIVERY_LABELS, dayText, periodText, scheduleText } from './group-rows.ts'
import { useDiscardGuard, useReportDirty } from './use-discard-guard.tsx'

export const NEW_GROUP = 'yeni'

export type TeacherOption = { value: string; label: string }

type Props = {
  /** `''` kapalı, `yeni` yeni grup, aksi hâlde düzenlenen grubun kimliği. */
  target: string
  /** Öğretmen seçenekleri (`''` atanmamış); yönetici dışında adlar okunamaz. */
  teacherOptions: readonly TeacherOption[]
  /** Öğretmen koordinatörse yalnız kendi seviyelerinin kurları; yöneticide `null`. */
  levels: ReadonlySet<string> | null
  onClose: () => void
}

const WEEKDAYS = Object.entries(WEEKDAY_LABELS).map(([value, label]) => ({
  value: Number(value),
  label,
}))

/**
 * Grup planla/düzenle (IST-077, DOM-DIL-008): uzun form geniş pencerede. Kur yalnız etkin kurlardan
 * seçilir ve sonradan değişmez; bitiş tarihi sunucuda kurun toplam saatinden hesaplanır. Kursiyeri
 * olan ya da başlamış grupta haftalık kalıp, başlangıç ve yaş bandı salt okurdur
 * (`group_schedule_locked`). Kirli form kapatılırken onay sorulur; 409'da form korunur.
 */
export function GroupFormModal({ target, teacherOptions, levels, onClose }: Props) {
  const guard = useDiscardGuard(onClose)
  const creating = target === NEW_GROUP
  const handlers = {
    teacherOptions,
    levels,
    onCancel: guard.requestClose,
    onDone: guard.closeClean,
    setDirty: guard.setDirty,
  }
  return (
    <>
      <Modal
        open={target !== ''}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title={creating ? 'Grup planla' : 'Grubu düzenle'}
        description="Grup, etkin bir kurun tarihli açılışıdır."
        size="wide"
      >
        {creating ? <GroupCreate {...handlers} /> : null}
        {target !== '' && !creating ? <GroupEdit groupId={target} {...handlers} /> : null}
      </Modal>
      {guard.dialog}
    </>
  )
}

type Handlers = {
  teacherOptions: readonly TeacherOption[]
  levels: ReadonlySet<string> | null
  onCancel: () => void
  onDone: () => void
  setDirty: (dirty: boolean) => void
}

function GroupCreate(handlers: Handlers) {
  const courses = useActiveCourses()
  if (courses.error)
    return <QueryError error={courses.error} onRetry={() => void courses.refetch()} />
  if (!courses.data) return <SummaryLoading />
  const usable = courses.data.filter(
    (course) => handlers.levels === null || handlers.levels.has(course.level),
  )
  if (!usable.length)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Grup planlamak için önce etkin bir kur gerekir.
      </p>
    )
  return <GroupForm {...handlers} courses={usable} />
}

const NOT_ALLOWED = 'Bu grubu düzenleme yetkiniz yok.'

function GroupEdit({ groupId, ...handlers }: Handlers & { groupId: string }) {
  const item = useLanguageGroup(groupId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const group = item.data?.data
  if (!group) return <SummaryLoading />
  // Koordinatör öğretmen yalnız kendi seviyesindeki grubu düzenler (`?grup-form=<id>` adresi dahil).
  if (handlers.levels !== null && !handlers.levels.has(group.level))
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {NOT_ALLOWED}
      </p>
    )
  if (group.status === 'completed' || group.status === 'cancelled')
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Tamamlanan ya da iptal edilen grup değiştirilemez.
      </p>
    )
  return (
    <GroupForm
      {...handlers}
      group={group}
      courses={[]}
      reload={async () => {
        const fresh = (await item.refetch()).data?.data
        return fresh
          ? {
              version: fresh.rowVersion ?? 0,
              values: groupDefaults(fresh, { startDate: fresh.startDate }),
            }
          : null
      }}
    />
  )
}

function GroupForm({
  group,
  courses,
  teacherOptions,
  reload,
  onCancel,
  onDone,
  setDirty,
}: Handlers & {
  group?: LanguageGroup
  courses: readonly Course[]
  reload?: () => Promise<{ version: number; values: GroupFormValues } | null>
}) {
  const create = useCreateLanguageGroup()
  const update = useUpdateLanguageGroup()
  // Bugün ilk çizimde sabitlenir (render sırasında saat okunmaz).
  const [today] = useState(() => dayKey(new Date()))
  const form = useForm<GroupFormValues, unknown, GroupFormOutput>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: groupDefaults(group, {
      ...(courses[0] ? { courseId: courses[0].id } : {}),
      startDate: today,
    }),
  })
  const slots = useFieldArray({ control: form.control, name: 'schedule' })
  const conflict = useEditConflict<GroupFormValues>({
    initialVersion: group?.rowVersion ?? 0,
    reload: async () => (reload ? reload() : null),
    apply: (values) => form.reset(values),
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const locked = isScheduleLocked(group)
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const delivery = useWatch({ control: form.control, name: 'delivery' })
  const courseId = useWatch({ control: form.control, name: 'courseId' })
  const course = courses.find((item) => item.id === courseId)
  // Atanmış ama listede olmayan öğretmen (ad okunamıyor) seçenek olarak korunur.
  const currentTeacher = group?.teacherMembershipId ?? ''
  const options =
    currentTeacher && !teacherOptions.some((option) => option.value === currentTeacher)
      ? [...teacherOptions, { value: currentTeacher, label: 'Atanmış öğretmen' }]
      : teacherOptions

  const submit = form.handleSubmit(async (parsed) => {
    const routes = {
      setError: form.setError,
      fieldFor: groupFormErrorField,
      silent: isVersionConflict,
    }
    if (!group) {
      const outcome = await create.submit(createGroupBody(parsed), routes)
      if (outcome.status === 'success') {
        notify.success('Grup planlandı.')
        onDone()
      }
      return
    }
    const body = groupPatch(group, parsed)
    if (Object.keys(body).length === 0) {
      notify.info('Değişiklik yok.')
      onDone()
      return
    }
    const outcome = await update.submit(
      { groupId: group.id, version: conflict.version, body },
      routes,
    )
    if (outcome.status === 'success') {
      notify.success('Grup güncellendi.')
      onDone()
      return
    }
    if (outcome.status === 'failed' && isVersionConflict(outcome.error)) conflict.markConflict()
  })

  const scheduleError = errors.schedule?.message ?? errors.schedule?.root?.message
  return (
    <form
      noValidate
      aria-label={group ? 'Grubu düzenle' : 'Grup planla'}
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
        {group ? (
          <ReadOnly label="Kur" value={`${group.courseName} · ${group.level}`} />
        ) : (
          <FormField
            id="grup-kur"
            label="Kur"
            error={errors.courseId}
            {...(course
              ? {
                  description: `Haftada ${sessionsPerWeek(course)} oturum, ${course.sessionMinutes} dk; en çok ${course.maxLearners} kişi.`,
                }
              : {})}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('courseId')}
                className="w-full"
                disabled={busy}
              >
                {courses.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name} · {item.level}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField id="grup-ad" label="Grup adı" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              {...form.register('name')}
              maxLength={GROUP_NAME_MAX}
              placeholder="Örn. A1 Akşam"
              disabled={busy}
            />
          )}
        </FormField>
        {locked && group ? (
          <ReadOnly label="Yaş bandı" value={GROUP_AGE_BAND_LABELS[group.ageBand]} />
        ) : (
          <FormField id="grup-yas" label="Yaş bandı" error={errors.ageBand}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('ageBand')}
                className="w-full"
                disabled={busy}
              >
                {GROUP_AGE_BANDS.map((band) => (
                  <NativeSelectOption key={band} value={band}>
                    {GROUP_AGE_BAND_LABELS[band]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField id="grup-ogretmen" label="Öğretmen" error={errors.teacherMembershipId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('teacherMembershipId')}
              className="w-full"
              disabled={busy}
            >
              {options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="grup-teslim" label="Ders yeri" error={errors.delivery}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('delivery')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="in_person">{DELIVERY_LABELS.in_person}</NativeSelectOption>
              <NativeSelectOption value="online">{DELIVERY_LABELS.online}</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        {delivery === 'online' ? null : (
          <FormField
            id="grup-derslik"
            label="Derslik"
            description="Açılan yüz yüze grupta zorunludur."
            error={errors.room}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('room')}
                maxLength={GROUP_ROOM_MAX}
                placeholder="Örn. 204"
                disabled={busy}
              />
            )}
          </FormField>
        )}
        {locked && group ? (
          <ReadOnly label="Başlangıç" value={dayText(group.startDate)} />
        ) : (
          <FormField id="grup-baslangic" label="Başlangıç" error={errors.startDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('startDate')}
                type="date"
                min={today}
                disabled={busy}
              />
            )}
          </FormField>
        )}
        <FormField
          id="grup-kapasite"
          label="Kapasite"
          description={
            group
              ? `Etkin kursiyer: ${group.activeLearners ?? 0}. Kapasite kurun en çok mevcudunu aşamaz.`
              : 'Kapasite kurun en çok mevcudunu (≤ 18) aşamaz.'
          }
          error={errors.capacity}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('capacity', { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              min={1}
              max={18}
              disabled={busy}
            />
          )}
        </FormField>
      </div>

      {locked && group ? (
        <div className="grid gap-2">
          <ReadOnly
            label="Haftalık program"
            value={scheduleText(group.schedule, group.sessionMinutes)}
          />
          <p className="text-sm text-muted-foreground">
            Kursiyeri olan ya da başlamış grupta haftalık program, başlangıç ve yaş bandı değişmez.
          </p>
        </div>
      ) : (
        <fieldset className="grid gap-3" aria-describedby="grup-program-aciklama">
          <legend className="mb-1 text-sm font-medium">Haftalık program</legend>
          <p id="grup-program-aciklama" className="text-sm text-muted-foreground">
            {course
              ? `Haftada ${sessionsPerWeek(course)} oturum ekleyin; saatler 07.00–23.00 arasıdır.`
              : 'Her oturum için gün ve başlangıç saati seçin; saatler 07.00–23.00 arasıdır.'}
          </p>
          <ul className="grid gap-3">
            {slots.fields.map((field, index) => {
              const rowError = errors.schedule?.[index]
              const message =
                rowError?.message ?? rowError?.startTime?.message ?? rowError?.weekday?.message
              const errorId = message ? `grup-oturum-${index}-hata` : undefined
              return (
                <li key={field.id} className="grid gap-1">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-sm" htmlFor={`grup-oturum-${index}-gun`}>
                      {`${index + 1}. oturum günü`}
                      <NativeSelect
                        id={`grup-oturum-${index}-gun`}
                        {...form.register(`schedule.${index}.weekday`, { valueAsNumber: true })}
                        aria-invalid={Boolean(message)}
                        aria-describedby={errorId}
                        disabled={busy}
                      >
                        {WEEKDAYS.map((day) => (
                          <NativeSelectOption key={day.value} value={day.value}>
                            {day.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="grid gap-1 text-sm" htmlFor={`grup-oturum-${index}-saat`}>
                      {`${index + 1}. oturum saati`}
                      <Input
                        id={`grup-oturum-${index}-saat`}
                        {...form.register(`schedule.${index}.startTime`)}
                        type="time"
                        step={300}
                        aria-invalid={Boolean(message)}
                        aria-describedby={errorId}
                        disabled={busy}
                      />
                    </label>
                    {slots.fields.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${index + 1}. oturumu kaldır`}
                        onClick={() => slots.remove(index)}
                        disabled={busy}
                      >
                        <Icon name="Trash2" size={15} aria-hidden="true" />
                        Kaldır
                      </Button>
                    ) : null}
                  </div>
                  {message ? (
                    <p id={errorId} role="alert" className="text-sm text-danger">
                      {message}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {scheduleError ? (
            <p role="alert" className="text-sm text-danger">
              {scheduleError}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => slots.append({ ...NEW_SLOT })}
              disabled={busy}
            >
              <Icon name="Plus" size={15} aria-hidden="true" />
              Oturum ekle
            </Button>
          </div>
        </fieldset>
      )}

      <p className="text-sm text-muted-foreground">
        {group
          ? `Tarih aralığı: ${periodText(group)}. Bitiş kurun toplam saatinden hesaplanır.`
          : 'Bitiş tarihi kayıttan sonra kurun toplam saatinden hesaplanır.'}
      </p>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onCancel} />
    </form>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <p className="rounded-card border bg-surface-soft px-4 py-2.5 text-sm">{value}</p>
    </div>
  )
}
