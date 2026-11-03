import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form'
import { isStaffItem } from '@kampus/react-shared/resource-model.ts'
import { useCreateTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import { useResourceList } from '@kampus/react-shared/use-resources.ts'
import { useRubrics } from '@kampus/react-shared/use-rubrics.ts'
import { LATE_ACCEPTANCE_MAX_DAYS } from '@kampus/school-core/skills/scoring.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  assignmentBody,
  assignmentFormSchema,
  COUNT_POLICY_OPTIONS,
  defaultAssignment,
  formFieldFor,
  isTeacherScored,
  KIND_OPTIONS,
  TASK_TYPE_OPTIONS,
  type AssignmentFormOutput,
  type AssignmentFormValues,
  type TaskType,
} from './task-model.ts'
import { useTaskLookups } from './use-task-lookups.ts'

/** `?gorev-form=yeni` değeri. */
export const NEW_ASSIGNMENT = 'yeni'

type Props = {
  open: boolean
  onClose: () => void
  /** Atama kaydedildi (kimliğiyle); ekran ayrıntıyı açar. */
  onCreated: (assignmentId: string) => void
}

/** Yeni görev atama penceresi; içerik açılınca yüklenir, kapanınca form sıfırlanır. */
export function TaskAssignmentForm({ open, onClose, onCreated }: Props) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni görev ata"
      description="Yayındaki bir içeriği sınıflarınıza atayın. İçerik ve rubrik sürümü atama anında sabitlenir."
      size="wide"
    >
      {open ? <AssignmentEditor onClose={onClose} onCreated={onCreated} /> : null}
    </Modal>
  )
}

function AssignmentEditor({ onClose, onCreated }: Omit<Props, 'open'>) {
  const { session } = useAuth()
  const languageSchool = session?.institution.type === 'language_school'
  const groupKind = languageSchool ? 'group' : 'class'
  const create = useCreateTaskAssignment()
  const { classOptions, classes } = useTaskLookups()
  const form = useForm<AssignmentFormValues, unknown, AssignmentFormOutput>({
    resolver: zodResolver(assignmentFormSchema) as unknown as Resolver<
      AssignmentFormValues,
      unknown,
      AssignmentFormOutput
    >,
    defaultValues: defaultAssignment,
  })
  const errors = form.formState.errors
  const taskType = useWatch({ control: form.control, name: 'taskType' })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const rubricVersionId = useWatch({ control: form.control, name: 'rubricVersionId' })
  const resourceId = useWatch({ control: form.control, name: 'resourceId' })
  const teacher = isTeacherScored(taskType)
  const busy = create.isPending || form.formState.isSubmitting

  const resources = useResourceList({ page: 1, pageSize: 100, contentType: taskType })
  const assignable = useMemo(
    () =>
      (resources.data?.data ?? [])
        .filter(isStaffItem)
        .filter((item) => item.currentVersionId !== null),
    [resources.data],
  )
  const chosen = assignable.find((item) => item.id === resourceId)
  const skill = chosen?.version.tags.primarySkill ?? null
  const rubrics = useRubrics({ page: 1, pageSize: 100 })
  const rubricOptions = useMemo(
    () =>
      (rubrics.data?.data ?? []).filter(
        (item) => item.publishedVersionId !== null && (skill === null || item.head.skill === skill),
      ),
    [rubrics.data, skill],
  )

  const submit = form.handleSubmit(async (values) => {
    const item = assignable.find((candidate) => candidate.id === values.resourceId)
    if (!item?.currentVersionId) return
    const outcome = await create.submit(assignmentBody(values, item.currentVersionId, groupKind), {
      setError: (name, error) => form.setError(formFieldFor(name) as 'resourceId', error),
    })
    if (outcome.status === 'success') {
      notify.success('Görev atandı.')
      onCreated(outcome.data.data.id)
    }
  })

  function changeType(next: TaskType) {
    form.reset({ ...defaultAssignment, taskType: next, targets: form.getValues('targets') })
  }

  return (
    <form
      noValidate
      aria-label="Yeni görev ata"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="grid gap-6"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="gorev-turu" label="Görev türü">
          {(control) => (
            <NativeSelect
              {...control}
              value={taskType}
              onChange={(event) => changeType(event.target.value as TaskType)}
              className="w-full"
              disabled={busy}
            >
              {TASK_TYPE_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="gorev-icerik"
          label="İçerik"
          error={errors.resourceId}
          description={
            resources.isSuccess && assignable.length === 0
              ? 'Bu türde yayındaki içerik yok. İçerik havuzundan yayımlanmış bir içerik gerekir.'
              : undefined
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('resourceId', {
                onChange: () => form.setValue('rubricVersionId', ''),
              })}
              className="w-full"
              disabled={busy || resources.isPending}
            >
              <NativeSelectOption value="">İçerik seçin</NativeSelectOption>
              {assignable.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.version.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <fieldset className="grid gap-2" aria-describedby={errors.targets ? 'hedef-hata' : undefined}>
        <legend className="mb-1 text-sm font-medium">
          {languageSchool ? 'Gruplar' : 'Sınıflar'}
        </legend>
        {classes.isSuccess && classOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Görev atayabileceğiniz {languageSchool ? 'grup' : 'sınıf'} yok.
          </p>
        ) : null}
        <Controller
          control={form.control}
          name="targets"
          render={({ field }) => (
            <ul className="grid gap-2 sm:grid-cols-3">
              {classOptions.map((option) => (
                <li key={option.id}>
                  <Label className="min-h-9 items-center gap-2.5 rounded-md border px-3 py-2 font-normal">
                    <Checkbox
                      checked={field.value.includes(option.id)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...field.value, option.id]
                            : field.value.filter((id) => id !== option.id),
                        )
                      }
                      disabled={busy}
                    />
                    <span className="text-sm">{option.name}</span>
                  </Label>
                </li>
              ))}
            </ul>
          )}
        />
        {errors.targets?.message ? (
          <p id="hedef-hata" role="alert" className="text-sm text-destructive">
            {errors.targets.message}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="gorev-kind" label="Görev amacı">
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('kind')}
              className="w-full"
              disabled={busy}
            >
              {KIND_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {teacher ? (
          <FormField id="gorev-rubrik" label="Rubrik" error={errors.rubricVersionId}>
            {(control) => (
              <NativeSelect
                {...control}
                value={rubricVersionId}
                onChange={(event) =>
                  form.setValue('rubricVersionId', event.target.value, { shouldValidate: true })
                }
                className="w-full"
                disabled={busy || rubrics.isPending}
              >
                <NativeSelectOption value="">Rubrik seçin</NativeSelectOption>
                {rubricOptions.map((item) => (
                  <NativeSelectOption key={item.rubric.id} value={item.publishedVersionId ?? ''}>
                    {item.head.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {teacher ? (
          <>
            <FormField
              id="gorev-surum"
              label="Sürüm sınırı"
              description="Öğrencinin gönderebileceği en çok sürüm (1–5)."
              error={errors.maxVersions}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5}
                  {...form.register('maxVersions')}
                  disabled={busy}
                />
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="gorev-alt-sozcuk" label="En az sözcük" error={errors.minWords}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    {...form.register('minWords')}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField id="gorev-ust-sozcuk" label="En çok sözcük" error={errors.maxWords}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    {...form.register('maxWords')}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
          </>
        ) : kind === 'evaluation' ? (
          <>
            <FormField
              id="gorev-hak"
              label="Deneme hakkı"
              description="1–3 arası."
              error={errors.maxAttempts}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3}
                  {...form.register('maxAttempts')}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id="gorev-sayim" label="Sayım politikası" error={errors.countPolicy}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('countPolicy')}
                  className="w-full"
                  disabled={busy}
                >
                  {COUNT_POLICY_OPTIONS.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="gorev-son-teslim"
          label="Son teslim"
          description={kind === 'practice' ? 'Alıştırmada son teslim isteğe bağlıdır.' : undefined}
          error={errors.dueAt}
        >
          {(control) => (
            <Input {...control} type="datetime-local" {...form.register('dueAt')} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="gorev-gec-kabul"
          label="Geç kabul (gün)"
          description={`0–${LATE_ACCEPTANCE_MAX_DAYS} gün; 0 ise süre dolunca teslim kapanır.`}
          error={errors.lateAcceptanceDays}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={0}
              max={LATE_ACCEPTANCE_MAX_DAYS}
              {...form.register('lateAcceptanceDays')}
              disabled={busy}
            />
          )}
        </FormField>
      </div>

      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Check" size={17} aria-hidden="true" />
          Görevi ata
        </Button>
      </div>
    </form>
  )
}
