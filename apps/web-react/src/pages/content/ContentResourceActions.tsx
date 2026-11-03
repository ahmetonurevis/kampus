import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type {
  ResourceCommandState,
  StaffResourceDetail,
} from '@kampus/react-shared/resource-model.ts'
import {
  useCopyResource,
  useRemoveResource,
  useReportResourceVersion,
  useShareResource,
} from '@kampus/react-shared/use-resources.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { CheckGroup } from '../communication/CheckGroup.tsx'
import { StudentTargetPicker, type PickableStudent } from '../communication/StudentTargetPicker.tsx'
import { isVersionConflict } from '../management/FormParts.tsx'
import {
  COPY_SUCCESS,
  reasonSchema,
  removalNotice,
  REPORT_SUCCESS,
  SHARE_SCOPE_NOTES,
  SHARE_SCOPE_OPTIONS,
  SHARE_SUCCESS,
  lockedShareTargets,
  lockedTargetsLabel,
  shareDefaults,
  shareErrorField,
  shareFormSchema,
  type ReasonInput,
  type ShareFormOutput,
  type ShareFormValues,
  withLockedTargets,
} from './content-actions-model.ts'

type Dialog = 'share' | 'report' | 'remove' | null

type Props = {
  detail: StaffResourceDetail
  commands: ResourceCommandState
  /** Panelin diğer işlemi sürerken eylemler kilitli. */
  busy: boolean
  /** 409 sürüm çakışması: panel uyarı bandını gösterir. */
  onConflict: () => void
  /** Kopya oluşunca yeni kaydın ayrıntısı açılır. */
  onCopied: (resourceId: string) => void
  /** Kaldırılan içerik listeden düşer; panel kapanır. */
  onRemoved: () => void
}

/**
 * İçerik havuzu kaynak eylemleri (OG-217; DOM-KYN-025, 040, 050, 051): ana eylem "Paylaş" düğme
 * olarak görünür; kopyalama, telif bildirimi ve kaldırma "Diğer işlemler" menüsündedir. Hangi
 * eylemin görüneceğine core kuralının kuru çalıştırması karar verir (`resourceCommands`); sunucu
 * aynı kuralı yeniden uygular. Telif bildirimi ve kaldırma gerekçe isteyen onay penceresi açar.
 */
export function ContentResourceActions({
  detail,
  commands,
  busy,
  onConflict,
  onCopied,
  onRemoved,
}: Props) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const copy = useCopyResource()
  const report = useReportResourceVersion()
  const remove = useRemoveResource()
  const { resource, head } = detail
  const locked = busy || copy.isPending || report.isPending || remove.isPending
  const menu = commands.copy !== null || commands.report !== null || commands.remove
  if (!commands.share && !menu) return null

  async function runCopy() {
    const outcome = await copy.submit({ resourceId: resource.id })
    if (outcome.status === 'success') {
      notify.success(COPY_SUCCESS)
      onCopied(outcome.data.data.resource.id)
    }
  }

  const close = (open: boolean) => (open ? undefined : setDialog(null))
  const reportTarget = commands.report
  return (
    <>
      {commands.share ? (
        <Button variant="outline" onClick={() => setDialog('share')} disabled={locked}>
          <Icon name="Share2" size={16} aria-hidden="true" />
          Paylaş
        </Button>
      ) : null}
      {menu ? (
        // Menü kapanmadan pencere açıldığında odak ve `pointer-events` kilidi çakışmasın diye
        // menü kipsizdir (Radix iç içe katman).
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" disabled={locked}>
              <Icon name="Ellipsis" size={16} aria-hidden="true" />
              Diğer işlemler
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56 rounded-2xl p-1.5">
            {commands.copy ? (
              <DropdownMenuItem
                disabled={commands.copy.blockedReason !== null}
                onSelect={() => void runCopy()}
                className="flex-col items-start gap-0.5"
              >
                <span className="flex items-center gap-2">
                  <Icon name="Copy" size={16} aria-hidden="true" />
                  Kopyala
                </span>
                {commands.copy.blockedReason ? (
                  <span className="text-xs text-muted-foreground">
                    {commands.copy.blockedReason}
                  </span>
                ) : null}
              </DropdownMenuItem>
            ) : null}
            {reportTarget ? (
              <DropdownMenuItem onSelect={() => setDialog('report')}>
                <Icon name="Flag" size={16} aria-hidden="true" />
                Telif bildirimi
              </DropdownMenuItem>
            ) : null}
            {commands.remove ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog('remove')}>
                  <Icon name="Trash2" size={16} aria-hidden="true" />
                  Kaldır
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {commands.share && dialog === 'share' ? (
        // Her açılışta form kaydın güncel paylaşımıyla başlar.
        <ShareModal
          open
          onOpenChange={close}
          detail={detail}
          onConflict={() => {
            setDialog(null)
            onConflict()
          }}
        />
      ) : null}
      {reportTarget ? (
        <ReasonModal
          open={dialog === 'report'}
          onOpenChange={close}
          id="icerik-telif-gerekce"
          title="Telif bildirimi"
          description="İçerik hemen incelemeye alınır; öğrenci ve veliler göremez. Yönetici yeniden yayımlar ya da kaldırır."
          label="Bildirim gerekçesi"
          submitLabel="Bildir"
          icon="Flag"
          onSubmit={async (reason, setError) => {
            const outcome = await report.submit(
              {
                resourceId: resource.id,
                versionId: reportTarget.versionId,
                version: reportTarget.rowVersion,
                reason,
              },
              { setError, silent: isVersionConflict },
            )
            if (outcome.status === 'success') notify.success(REPORT_SUCCESS)
            else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
              setDialog(null)
              onConflict()
            }
            return outcome.status === 'success'
          }}
        />
      ) : null}
      {commands.remove ? (
        <ReasonModal
          open={dialog === 'remove'}
          onOpenChange={close}
          id="icerik-kaldirma-gerekce"
          title="İçeriği kaldır"
          description={`“${head.title}” içeriğinin bütün sürümleri ve dosyaları kapanır; başlık, gerekçe ve tarih kalır. Bu işlem geri alınmaz.`}
          label="Kaldırma gerekçesi"
          submitLabel="Kaldır"
          icon="Trash2"
          destructive
          onSubmit={async (reason, setError) => {
            const outcome = await remove.submit(
              { resourceId: resource.id, version: resource.rowVersion, reason },
              { setError, silent: isVersionConflict },
            )
            if (outcome.status === 'success') {
              notify.success(removalNotice(outcome.data.data))
              onRemoved()
            } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
              setDialog(null)
              onConflict()
            }
            return outcome.status === 'success'
          }}
        />
      ) : null}
    </>
  )
}

const NO_RECORDS: never[] = []

/**
 * Paylaşım hedefi seçimi (DOM-KYN-040). Sınıf ve öğrenci listeleri rol kapsamlı koleksiyonlardan
 * gelir: öğretmen yalnız ders verdiği sınıf ve öğrencileri görür, yönetici kurumun tümünü. Kayıtlı
 * paylaşımda olup listede bulunmayan hedef (başkasının eklediği sınıf, arşivlenmiş kayıt) salt
 * okunur etiketle gösterilir ve gövdede değişmeden korunur; sunucu kapsamı yalnız eklenen ve
 * çıkarılan hedefe uygular (403 `share_target_out_of_scope`).
 */
function ShareModal({
  open,
  onOpenChange,
  detail,
  onConflict,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: StaffResourceDetail
  onConflict: () => void
}) {
  const { resource } = detail
  const share = useShareResource()
  const form = useForm<ShareFormValues, unknown, ShareFormOutput>({
    resolver: zodResolver(shareFormSchema),
    defaultValues: shareDefaults(resource),
  })
  const scope = useWatch({ control: form.control, name: 'scope' })
  // Öğrenci seçiminde de sınıf adları gösterilir; listeler yalnız ilgili kapsamda istenir.
  const classes = useCoreAll(
    'classes',
    {},
    { enabled: scope === 'classes' || scope === 'students' },
  )
  const students = useCoreAll('students', {}, { enabled: scope === 'students' })
  const classRecords = useMemo(
    () => classes.data?.map((row) => row.record) ?? NO_RECORDS,
    [classes.data],
  )
  const classNames = useMemo(
    () => new Map(classRecords.map((item) => [item.id, item.name])),
    [classRecords],
  )
  const classOptions = useMemo(
    () =>
      classRecords
        .filter((item) => item.isActive !== false && !item.deletedAt)
        .map((item) => ({ value: item.id, label: item.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'tr', { numeric: true })),
    [classRecords],
  )
  const studentNames = useMemo(
    () => new Map((students.data ?? []).map((row) => [row.record.id, row.record.name])),
    [students.data],
  )
  const pickable = useMemo<PickableStudent[]>(
    () =>
      (students.data ?? [])
        .map((row) => row.record)
        .filter((student) => student.isActive !== false)
        .map((student) => ({
          id: student.id,
          name: student.name,
          className: classNames.get(student.classId) ?? '',
        })),
    [students.data, classNames],
  )
  const lockedClassIds = useMemo(
    () =>
      lockedShareTargets(
        resource.sharedClassIds,
        classes.data ? new Set(classOptions.map((option) => option.value)) : null,
      ),
    [resource.sharedClassIds, classes.data, classOptions],
  )
  const lockedStudentIds = useMemo(
    () =>
      lockedShareTargets(
        resource.sharedStudentIds,
        students.data ? new Set(pickable.map((student) => student.id)) : null,
      ),
    [resource.sharedStudentIds, students.data, pickable],
  )
  const errors = form.formState.errors
  const busy = form.formState.isSubmitting || share.isPending
  const lookupError =
    scope === 'classes' ? classes.error : scope === 'students' ? students.error : null

  const submit = form.handleSubmit(async (targets) => {
    const outcome = await share.submit(
      { resourceId: resource.id, version: resource.rowVersion, targets },
      {
        setError: form.setError,
        fieldFor: (error: ApiError) => shareErrorField(error, targets.scope),
        silent: isVersionConflict,
      },
    )
    if (outcome.status === 'success') {
      notify.success(SHARE_SUCCESS)
      onOpenChange(false)
    } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) onConflict()
  })

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="İçeriği paylaş"
      description="Paylaşım yayındaki sürüme uygulanır; taslak öğrencilere görünmez."
    >
      <form
        noValidate
        aria-label="İçeriği paylaş"
        onSubmit={(event) => {
          event.preventDefault()
          void submit(event)
        }}
        className="grid gap-5"
      >
        <Controller
          control={form.control}
          name="scope"
          render={({ field }) => (
            <FormField
              id="icerik-paylasim-kapsam"
              label="Paylaşım kapsamı"
              error={errors.scope}
              description={SHARE_SCOPE_NOTES[field.value]}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  onBlur={field.onBlur}
                  className="w-full"
                  disabled={busy}
                >
                  {SHARE_SCOPE_OPTIONS.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
        />
        {lookupError ? (
          <QueryError
            error={lookupError}
            onRetry={() => void (scope === 'classes' ? classes.refetch() : students.refetch())}
          />
        ) : null}
        {scope === 'classes' ? (
          <Controller
            control={form.control}
            name="classIds"
            render={({ field }) => (
              <div className="grid gap-2">
                <CheckGroup
                  legend="Sınıf ve gruplar"
                  hint={
                    classes.isPending
                      ? 'Sınıflar yükleniyor…'
                      : classOptions.length === 0
                        ? 'Paylaşabileceğiniz sınıf yok.'
                        : 'Yalnız ders verdiğiniz sınıf ve gruplar listelenir.'
                  }
                  options={classOptions}
                  value={field.value.filter((id) => !lockedClassIds.includes(id))}
                  onChange={(next) => field.onChange(withLockedTargets(lockedClassIds, next))}
                  disabled={busy}
                  error={errors.classIds?.message}
                />
                <LockedTargets label={lockedTargetsLabel(lockedClassIds, classNames, 'sınıf')} />
              </div>
            )}
          />
        ) : null}
        {scope === 'students' ? (
          <Controller
            control={form.control}
            name="studentIds"
            render={({ field }) => (
              <div className="grid gap-2">
                <StudentTargetPicker
                  students={pickable}
                  value={field.value.filter((id) => !lockedStudentIds.includes(id))}
                  onChange={(next) => field.onChange(withLockedTargets(lockedStudentIds, next))}
                  disabled={busy}
                  error={errors.studentIds?.message}
                />
                <LockedTargets
                  label={lockedTargetsLabel(lockedStudentIds, studentNames, 'öğrenci')}
                />
              </div>
            )}
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="Share2" size={16} aria-hidden="true" />
            Paylaşımı kaydet
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Kapsam dışı kayıtlı hedeflerin salt okunur etiketi (DOM-KYN-040); kaldırma denetimi yoktur. */
function LockedTargets({ label }: { label: string | null }) {
  if (label === null) return null
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Icon name="Lock" size={14} aria-hidden="true" className="mt-px shrink-0" />
      <span>{label}. Kaydettiğinizde değişmeden korunur.</span>
    </p>
  )
}

/** Gerekçe isteyen onay penceresi (telif bildirimi, kaldırma). */
function ReasonModal({
  open,
  onOpenChange,
  id,
  title,
  description,
  label,
  submitLabel,
  icon,
  destructive = false,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  id: string
  title: string
  description: string
  label: string
  submitLabel: string
  icon: string
  destructive?: boolean
  onSubmit: (
    reason: string,
    setError: (name: 'reason', error: { type: string; message: string }) => void,
  ) => Promise<boolean>
}) {
  const form = useForm<ReasonInput>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  })
  const busy = form.formState.isSubmitting
  const submit = form.handleSubmit(async ({ reason }) => {
    if (await onSubmit(reason, form.setError)) {
      form.reset()
      onOpenChange(false)
    }
  })
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset()
        onOpenChange(next)
      }}
      title={title}
      description={description}
    >
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault()
          void submit(event)
        }}
        className="grid gap-4"
      >
        <FormField id={id} label={label} error={form.formState.errors.reason}>
          {(control) => (
            <Textarea
              {...control}
              {...form.register('reason')}
              rows={4}
              maxLength={1000}
              disabled={busy}
            />
          )}
        </FormField>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            <Icon name={icon} size={16} aria-hidden="true" />
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
