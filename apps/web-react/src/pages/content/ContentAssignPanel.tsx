import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form'
import { useCreateTaskAssignmentBatch } from '@kampus/react-shared/use-content-assignments.ts'
import { useResourceVersion } from '@kampus/react-shared/use-resources.ts'
import { useRubrics } from '@kampus/react-shared/use-rubrics.ts'
import { ASSIGNMENT_BATCH_MAX } from '@kampus/school-core/skills/assignment.ts'
import { LATE_ACCEPTANCE_MAX_DAYS } from '@kampus/school-core/skills/scoring.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  assignmentListening,
  COUNT_POLICY_OPTIONS,
  isTeacherScored,
  KIND_OPTIONS,
  LISTENING_PLAY_OPTIONS,
  type TaskType,
} from '../tasks/task-model.ts'
import { useTaskLookups } from '../tasks/use-task-lookups.ts'
import {
  batchBody,
  batchFieldFor,
  contentAssignDefaults,
  contentAssignFormSchema,
  emptyTargetRow,
  groupKindFor,
  targetKindOptions,
  type ContentAssignFormOutput,
  type ContentAssignFormValues,
  type TargetKind,
} from './content-assign-model.ts'

type Props = {
  open: boolean
  onClose: () => void
  resourceId: string
  /** Güncel yayındaki sürüm; atama bu sürüme sabitlenir (DOM-KYN-032). */
  versionId: string
  title: string
  taskType: TaskType
}

/**
 * İçerikten atama penceresi (OG-089; IST-034, DOM-BEC-049): aynı içerik birden çok sınıfa, gruba
 * ya da öğrenciye her satırda ayrı son tarihle tek işlemde atanır. Bir satır reddedilirse hiçbir
 * atama açılmaz; sunucunun hatası ilgili satırın alanında görünür. İçerik açılınca yüklenir,
 * kapanınca form sıfırlanır.
 */
export function ContentAssignPanel({ open, onClose, ...content }: Props) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="İçeriği ata"
      description="Her satır kendi son tarihiyle ayrı görev olur. İçerik ve rubrik sürümü atama anında sabitlenir."
      size="wide"
    >
      {open ? <AssignEditor onClose={onClose} {...content} /> : null}
    </Modal>
  )
}

function AssignEditor({ onClose, resourceId, versionId, title, taskType }: Omit<Props, 'open'>) {
  const { session } = useAuth()
  const institutionType = session?.institution.type ?? 'school'
  const create = useCreateTaskAssignmentBatch()
  const { classOptions, classes } = useTaskLookups()
  const form = useForm<ContentAssignFormValues, unknown, ContentAssignFormOutput>({
    resolver: zodResolver(contentAssignFormSchema) as unknown as Resolver<
      ContentAssignFormValues,
      unknown,
      ContentAssignFormOutput
    >,
    defaultValues: contentAssignDefaults(taskType, institutionType),
  })
  const rows = useFieldArray({ control: form.control, name: 'rows' })
  const errors = form.formState.errors
  const kind = useWatch({ control: form.control, name: 'kind' })
  const rowKinds = useWatch({ control: form.control, name: 'rows' }).map((row) => row.kind)
  const teacher = isTeacherScored(taskType)
  const kindOptions = targetKindOptions(institutionType)
  const groupLabel = groupKindFor(institutionType) === 'group' ? 'grup' : 'sınıf'

  // Öğrenci listesi yalnız bir satır öğrenci hedeflediğinde istenir; kapsamı sunucu daraltır.
  const wantsStudents = rowKinds.includes('student')
  const students = useCoreAll('students', {}, { enabled: wantsStudents })
  const studentOptions = useMemo(
    () =>
      (students.data ?? [])
        .map((row) => row.record)
        .filter((student) => student.isActive !== false)
        .map((student) => ({ id: student.id, name: student.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [students.data],
  )

  // Rubrik becerisi ve dinleme kaydı bağı (IST-045) yayındaki sürümün içeriğindedir.
  const version = useResourceVersion(resourceId, versionId)
  const versionData = version.data?.data
  const loaded =
    versionData?.view === 'staff' && versionData.version.id === versionId
      ? versionData.version
      : null
  const { listening, pending: listeningPending } = assignmentListening({
    itemList: taskType === 'quiz' || taskType === 'exercise_set',
    selected: true,
    loaded: loaded ? { content: loaded.content } : null,
    failed: version.isError,
  })
  const skill = loaded?.tags.primarySkill ?? null
  const rubrics = useRubrics({ page: 1, pageSize: 100 })
  const rubricOptions = useMemo(
    () =>
      (rubrics.data?.data ?? []).filter(
        (item) => item.publishedVersionId !== null && (skill === null || item.head.skill === skill),
      ),
    [rubrics.data, skill],
  )
  const busy = create.isPending || form.formState.isSubmitting

  const submit = form.handleSubmit(async (values) => {
    if (listeningPending) return
    const plan = batchBody(values, versionId, listening)
    const outcome = await create.submit(plan.body, {
      setError: (name, error) =>
        form.setError(batchFieldFor(name, plan.rowsOfItem) as 'root.server', error),
      // DOM-BEC-005: kaydı olmayan içerikte seçilen hak alanın altında bildirilir.
      fieldFor: (error) =>
        error.code === 'listening_plays_unavailable' ? 'listeningPlays' : undefined,
    })
    if (outcome.status === 'success') {
      const count = outcome.data.data.length
      notify.success(count === 1 ? 'Görev atandı.' : `${count} görev atandı.`)
      onClose()
    }
  })

  function addRow() {
    const index = rows.fields.length
    rows.append(emptyTargetRow(groupKindFor(institutionType)), {
      focusName: `rows.${index}.kind`,
    })
  }

  /** Satır kalkınca odak kaybolmasın: bir önceki satırın ilk alanına (ilk satır kalktıysa yeni ilkine) gider. */
  function removeRow(index: number) {
    rows.remove(index)
    const next = Math.max(index - 1, 0)
    window.setTimeout(() => form.setFocus(`rows.${next}.kind`), 0)
  }

  const rowsMessage = errors.rows?.message ?? errors.rows?.root?.message
  return (
    <form
      noValidate
      aria-label="İçeriği ata"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="grid gap-6"
    >
      <p className="text-sm">
        Atanacak içerik: <strong className="font-medium [overflow-wrap:anywhere]">{title}</strong>
      </p>

      <fieldset
        className="grid gap-3"
        aria-describedby={rowsMessage ? 'atama-satir-hata' : undefined}
      >
        <legend className="mb-1 text-sm font-medium">Hedefler ve son teslim</legend>
        {classes.isSuccess && classOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Görev atayabileceğiniz {groupLabel} yok; öğrenci hedefi seçebilirsiniz.
          </p>
        ) : null}
        <ol className="grid gap-3">
          {rows.fields.map((field, index) => {
            const number = index + 1
            const rowKind: TargetKind = rowKinds[index] ?? field.kind
            const rowErrors = errors.rows?.[index]
            const options =
              rowKind === 'student'
                ? studentOptions
                : classOptions.map((option) => ({ id: option.id, name: option.name }))
            return (
              <li
                key={field.id}
                className="grid gap-3 rounded-card border p-3 sm:grid-cols-[minmax(8rem,10rem)_1fr_minmax(12rem,15rem)_auto] sm:items-start"
              >
                <FormField id={`atama-satir-${field.id}-tur`} label={`${number}. hedef türü`}>
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`rows.${index}.kind`, {
                        onChange: () => form.setValue(`rows.${index}.id`, ''),
                      })}
                      className="w-full"
                      disabled={busy}
                    >
                      {kindOptions.map((option) => (
                        <NativeSelectOption key={option.value} value={option.value}>
                          {option.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`atama-satir-${field.id}-hedef`}
                  label={`${number}. hedef`}
                  error={rowErrors?.id}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`rows.${index}.id`)}
                      className="w-full"
                      disabled={
                        busy || (rowKind === 'student' ? students.isPending : classes.isPending)
                      }
                    >
                      <NativeSelectOption value="">
                        {rowKind === 'student' ? 'Öğrenci seçin' : `${groupLabel} seçin`}
                      </NativeSelectOption>
                      {options.map((option) => (
                        <NativeSelectOption key={option.id} value={option.id}>
                          {option.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`atama-satir-${field.id}-son`}
                  label={`${number}. hedef son teslimi`}
                  error={rowErrors?.dueAt}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="datetime-local"
                      {...form.register(`rows.${index}.dueAt`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:mt-7"
                  aria-label={`${number}. hedefi kaldır`}
                  onClick={() => removeRow(index)}
                  disabled={busy || rows.fields.length === 1}
                >
                  <Icon name="Trash2" size={16} aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ol>
        {rowsMessage ? (
          <p id="atama-satir-hata" role="alert" className="text-sm text-destructive">
            {rowsMessage}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            disabled={busy || rows.fields.length >= ASSIGNMENT_BATCH_MAX}
          >
            <Icon name="Plus" size={16} aria-hidden="true" />
            Hedef ekle
          </Button>
          <p className="text-xs text-muted-foreground">
            {kind === 'practice'
              ? 'Alıştırmada son teslim isteğe bağlıdır.'
              : 'Aynı son tarihli satırlar tek görevde birleşir.'}{' '}
            En çok {ASSIGNMENT_BATCH_MAX} satır.
          </p>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="atama-kind" label="Görev amacı">
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
        <FormField
          id="atama-gec-kabul"
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
        {teacher ? (
          <>
            <FormField id="atama-rubrik" label="Rubrik" error={errors.rubricVersionId}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('rubricVersionId')}
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
            <FormField
              id="atama-surum"
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
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <FormField id="atama-alt-sozcuk" label="En az sözcük" error={errors.minWords}>
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
              <FormField id="atama-ust-sozcuk" label="En çok sözcük" error={errors.maxWords}>
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
              id="atama-hak"
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
            <FormField id="atama-sayim" label="Sayım politikası" error={errors.countPolicy}>
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
        {listening ? (
          <FormField
            id="atama-dinleme-hakki"
            label="Dinleme hakkı"
            description="Kayıt her denemede bu kadar dinlenebilir; sayfa yenilemek hak harcamaz."
            error={errors.listeningPlays}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('listeningPlays')}
                className="w-full"
                disabled={busy}
              >
                {LISTENING_PLAY_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
      </div>

      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button
          type="submit"
          disabled={busy || listeningPending}
          aria-busy={busy || listeningPending || undefined}
        >
          <Icon name="Check" size={17} aria-hidden="true" />
          Görevi ata
        </Button>
      </div>
    </form>
  )
}
