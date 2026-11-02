// İzin formu aç ve düzenle (yönetici ve rehber öğretmen; IST-067, DOM-ILT-036, -038). Form sağ
// panelin içindedir; kirli form kapatılırken onay ister. `If-Match` sürümü gönderim anında formun
// yeniden okunan hâlindendir (açılıştaki kopya bayat olabilir) ve yalnız kullanıcının değiştirdiği
// alanlar gider; sürüm farkında girdi korunur, uyarı görünür. Son gün ve geçmiş gün kararını sunucu
// verir: istemci saati girdiyi silmez.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { PermissionFormDetail } from '@kampus/react-shared/permission-forms.ts'
import { hasDecisions, PERMISSION_TOPIC_LABELS } from '@kampus/react-shared/permission-forms.ts'
import {
  useCreatePermissionForm,
  usePermissionForm,
  useUpdatePermissionForm,
} from '@kampus/react-shared/use-permission-forms.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { notify } from '@/lib/notify.ts'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from '../language/fresh-submit.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { CheckGroup } from './CheckGroup.tsx'
import {
  changedPermissionFormFields,
  extraTargetStudentIds,
  permissionActions,
  permissionErrorRoutes,
  permissionFormDefaults,
  permissionFormSchema,
  PERMISSION_FORM_DESCRIPTION_MAX_LENGTH,
  PERMISSION_FORM_TITLE_MAX_LENGTH,
  PERMISSION_FORM_TOPIC_KEYS,
  planPermissionFormUpdate,
  removedFromTarget,
  type PermissionActor,
  type PermissionFormOutput,
  type PermissionFormValues,
  type PermissionOverlap,
} from './permission-forms.ts'
import { StudentTargetPicker, type PickableStudent } from './StudentTargetPicker.tsx'

/** `?izin-form=` değeri: yeni form. */
export const NEW_PERMISSION_FORM = 'yeni'

const NONE: readonly never[] = []

/** Adresten açılan formda işlem yetkisi yoksa form çizilmez. */
export function PermissionNoAccess() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Bu işlem için yetkiniz yok.
    </p>
  )
}

type Stale =
  | { kind: 'changed' }
  /** `version`: çakışmanın gösterildiği kayıt sürümü; aynı sürümde yeniden kaydetmek onaydır. */
  | { kind: 'overlap'; overlaps: readonly PermissionOverlap[]; version: number }
  | { kind: 'closed' }

function StaleNotice({ stale }: { stale: Stale | null }) {
  if (!stale) return null
  if (stale.kind === 'closed')
    return (
      <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
        Form bu arada kapatıldı; kapatılmış form değiştirilemez. Girdiniz kaydedilmedi.
      </div>
    )
  if (stale.kind === 'changed')
    return (
      <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
        Form bu arada başka biri tarafından değişti. Güncel hâli yüklendi; girdiniz korundu. Kontrol
        edip yeniden kaydedin.
      </div>
    )
  return (
    <div role="alert" className="grid gap-2 rounded-card border bg-warning-soft p-4 text-sm">
      <p className="font-medium">
        Form bu arada değişti ve değiştirdiğiniz alanlardan biri başkası tarafından da değiştirildi.
        Yeniden kaydederseniz sizin değeriniz yazılır.
      </p>
      <ul className="grid gap-1">
        {stale.overlaps.map((item) => (
          <li key={item.field}>
            <strong className="font-semibold">{item.label}:</strong> kayıtlı değer {item.theirs},
            sizin girdiğiniz {item.mine}.
          </li>
        ))}
      </ul>
    </div>
  )
}

type Props = {
  /** `yeni` ya da düzenlenen formun kimliği. */
  target: string
  actor: PermissionActor
  onClose: () => void
}

/** Sağ panel içeriği: yeni form ya da formu okuyup düzenleme formu. */
export function PermissionFormContent({ target, actor, onClose }: Props) {
  if (target === NEW_PERMISSION_FORM)
    return permissionActions(actor).create ? (
      <PermissionFormEditor actor={actor} onClose={onClose} />
    ) : (
      <PermissionNoAccess />
    )
  return <PermissionFormEdit formId={target} actor={actor} onClose={onClose} />
}

function PermissionFormEdit({
  formId,
  actor,
  onClose,
}: {
  formId: string
  actor: PermissionActor
  onClose: () => void
}) {
  const item = usePermissionForm(formId)
  const students = useCoreAll('students')
  // Formun açıldığı andaki kayıt: sonradan gelen tazeleme girdiyi silmesin.
  const [opened, setOpened] = useState<PermissionFormDetail | null>(null)
  const live = item.data?.data
  if (!opened && live) setOpened(live)
  const error = (!opened ? item.error : undefined) ?? students.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (students.error) void students.refetch()
        }}
      />
    )
  if (!opened || !students.data) return <SummaryLoading />
  // Adresten gelinen form da yetkiye bağlıdır: formu açan öğretmen ya da yönetici (DOM-ILT-038).
  if (!permissionActions(actor, opened).manage) return <PermissionNoAccess />
  if (opened.status === 'closed' && opened.closedAt !== null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Kapatılmış form değiştirilemez; kararlar korunur.
      </p>
    )
  return (
    <PermissionFormEditor
      key={opened.id}
      actor={actor}
      opened={opened}
      fetchFresh={async () => {
        const result = await item.refetch()
        return result.error ? undefined : result.data?.data
      }}
      onClose={onClose}
    />
  )
}

function PermissionFormEditor({
  opened,
  fetchFresh,
  actor,
  onClose,
}: {
  opened?: PermissionFormDetail
  fetchFresh?: () => Promise<PermissionFormDetail | undefined>
  actor: PermissionActor
  onClose: () => void
}) {
  const create = useCreatePermissionForm()
  const update = useUpdatePermissionForm()
  const classes = useCoreAll('classes')
  const students = useCoreAll('students')
  const editing = opened !== undefined
  const allStudents = useMemo(
    () => students.data?.map((row) => row.record) ?? NONE,
    [students.data],
  )
  // Sınıf dışında tek tek seçilen öğrenciler yanıtta ayrı gelmez: hedef sınıflara girmeyen
  // çözülmüş öğrenciler tek tek seçilmiş sayılır.
  const openedExtras = useMemo(
    () =>
      opened ? extraTargetStudentIds(opened.studentIds, opened.classIds ?? [], allStudents) : [],
    [opened, allStudents],
  )
  const form = useForm<PermissionFormValues, unknown, PermissionFormOutput>({
    resolver: zodResolver(permissionFormSchema),
    defaultValues: permissionFormDefaults(opened, openedExtras),
  })
  const [stale, setStale] = useState<Stale | null>(null)
  const guard = useRouteDiscardGuard(form.formState.isDirty)
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const locked = opened !== undefined && hasDecisions(opened)
  // Son günü geçmiş formda son gün değişmez (DOM-ILT-038); sunucu da reddeder.
  const deadlineLocked = opened !== undefined && !opened.acceptingDecisions

  const classRecords = classes.data?.map((row) => row.record) ?? NONE
  const ownClasses = classRecords.filter((item) =>
    actor.role === 'yonetici'
      ? item.isActive !== false && !item.deletedAt
      : actor.teacherId !== null && item.teacherId === actor.teacherId && item.isActive !== false,
  )
  const keep = new Set(opened?.classIds ?? [])
  const classOptions = [...ownClasses, ...classRecords.filter((item) => keep.has(item.id))]
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr', { numeric: true }))
  const scopedClassIds = new Set(ownClasses.map((item) => item.id))
  const classNames = new Map(classRecords.map((item) => [item.id, item.name]))
  const pickable: PickableStudent[] = allStudents
    .filter(
      (student) =>
        student.isActive !== false &&
        (actor.role === 'yonetici' || scopedClassIds.has(student.classId)),
    )
    .map((student) => ({
      id: student.id,
      name: student.name,
      className: classNames.get(student.classId) ?? '',
    }))
  const lookupError = classes.error ?? students.error

  const onSubmit = form.handleSubmit(async (values) => {
    const routes = { setError: form.setError, ...permissionErrorRoutes('form') }
    const shown = stale
    setStale(null)
    if (!opened || !fetchFresh) {
      const outcome = await create.submit(
        {
          topic: values.topic,
          title: values.title,
          description: values.description,
          deadline: values.deadline,
          ...(values.classIds?.length ? { classIds: values.classIds } : {}),
          ...(values.studentIds?.length ? { studentIds: values.studentIds } : {}),
        },
        routes,
      )
      if (outcome.status === 'success') {
        notify.success('İzin formu açıldı; veliler bilgilendirildi.')
        guard.leave()
        onClose()
      }
      return
    }
    const result = await submitWithFreshRecord(fetchFresh, async (fresh) => {
      if (fresh.status === 'closed' && fresh.closedAt !== null) {
        setStale({ kind: 'closed' })
        return { status: 'busy' as const }
      }
      const removed = removedFromTarget(
        { classIds: opened.classIds ?? [], studentIds: openedExtras },
        { classIds: values.classIds ?? [], studentIds: values.studentIds ?? [] },
      )
      if (hasDecisions(fresh) && (removed.classIds.length > 0 || removed.studentIds.length > 0)) {
        form.setError('classIds', {
          type: 'manual',
          message: 'Karar verilmiş formun hedefinden sınıf ya da öğrenci çıkarılamaz.',
        })
        return { status: 'busy' as const }
      }
      const plan = planPermissionFormUpdate(opened, fresh, values, openedExtras)
      if (Object.keys(plan.body).length === 0) {
        const touched =
          Object.keys(changedPermissionFormFields(opened, values, openedExtras)).length > 0
        form.setError('root.server', {
          type: 'manual',
          message: touched ? 'Form zaten bu değerlerde kayıtlı.' : 'Değişiklik yapmadınız.',
        })
        return { status: 'busy' as const }
      }
      const confirmed = shown?.kind === 'overlap' && shown.version === fresh.version
      if (plan.overlaps.length > 0 && !confirmed) {
        setStale({ kind: 'overlap', overlaps: plan.overlaps, version: fresh.version })
        return { status: 'busy' as const }
      }
      return update.submit({ formId: fresh.id, version: fresh.version, body: plan.body }, routes)
    })
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setStale({ kind: 'changed' })
      return
    }
    if (result.outcome.status === 'success') {
      notify.success('İzin formu güncellendi.')
      guard.leave()
      onClose()
    }
  })

  if (lookupError)
    return (
      <QueryError
        error={lookupError}
        onRetry={() => {
          if (classes.error) void classes.refetch()
          if (students.error) void students.refetch()
        }}
      />
    )
  if (classes.isPending || students.isPending) return <SummaryLoading />
  if (!editing && classOptions.length === 0 && pickable.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        İzin formu açabileceğiniz sınıf yok. Öğretmen yalnız rehber öğretmeni olduğu sınıflara form
        açar.
      </p>
    )
  const title = editing ? 'İzin formunu düzenle' : 'İzin formu aç'
  return (
    <>
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <StaleNotice stale={stale} />
        <p className="text-sm text-muted-foreground">
          {editing
            ? 'Konu türü değişmez. Karar verilmiş formun hedefine sınıf ya da öğrenci eklenebilir, çıkarılamaz.'
            : 'Form açılınca öğrencilerin velilerine bildirim gider. Son gün Türkiye saatiyle o günün sonuna kadardır.'}
        </p>
        <FormField id="izin-konu" label="Konu" error={errors.topic}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('topic')}
              disabled={busy || editing}
              className="w-full"
            >
              <NativeSelectOption value="">Konu türünü seçin</NativeSelectOption>
              {PERMISSION_FORM_TOPIC_KEYS.map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {PERMISSION_TOPIC_LABELS[key]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="izin-baslik" label="Başlık" error={errors.title}>
          {(control) => (
            <Input
              {...control}
              {...form.register('title')}
              maxLength={PERMISSION_FORM_TITLE_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="izin-aciklama"
          label="Açıklama"
          error={errors.description}
          description="Velinin karar verirken okuyacağı ayrıntılar: yer, saat, ulaşım, ücret."
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('description')}
              rows={5}
              maxLength={PERMISSION_FORM_DESCRIPTION_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="izin-son-gun"
          label="Son gün"
          error={errors.deadline}
          description={
            deadlineLocked
              ? 'Son günü geçmiş formun son günü değiştirilemez.'
              : 'Veliler bu günün sonuna kadar karar verebilir; geçmiş gün seçilemez.'
          }
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('deadline')}
              type="date"
              readOnly={deadlineLocked}
              disabled={busy}
            />
          )}
        </FormField>
        <Controller
          control={form.control}
          name="classIds"
          render={({ field }) => (
            <CheckGroup
              legend="Hedef sınıflar"
              hint={
                actor.role === 'ogretmen'
                  ? 'Yalnız rehber öğretmeni olduğunuz sınıflar listelenir.'
                  : 'Sınıfın etkin öğrencilerinin hepsinden izin istenir.'
              }
              options={classOptions}
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
              error={errors.classIds?.message}
            />
          )}
        />
        <Controller
          control={form.control}
          name="studentIds"
          render={({ field }) => (
            <StudentTargetPicker
              students={pickable}
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
              error={errors.studentIds?.message}
            />
          )}
        />
        {locked ? (
          <p className="text-xs text-muted-foreground">
            Bu formda karar verildi; hedeften sınıf ya da öğrenci çıkarılamaz.
          </p>
        ) : null}
        <RootError message={errors.root?.server?.message} />
        <FormActions busy={busy} onCancel={onClose} submitLabel={editing ? 'Kaydet' : 'Formu aç'} />
      </form>
      {guard.dialog}
    </>
  )
}
