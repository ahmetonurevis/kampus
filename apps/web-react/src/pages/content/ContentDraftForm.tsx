import { useState, type FormEvent } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { COPYRIGHT_DECLARATION } from '@kampus/school-core/content/taxonomy.ts'
import { fileAttachField } from '@kampus/react-shared/files.ts'
import {
  isStaffDetail,
  type AuthorableType,
  type StaffResourceDetail,
} from '@kampus/react-shared/resource-model.ts'
import {
  useCreateResource,
  useResourceDetail,
  useUpdateDraft,
} from '@kampus/react-shared/use-resources.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import {
  ConflictNotice,
  isVersionConflict,
  RootError,
  useEditConflict,
} from '../management/FormParts.tsx'
import { ItemSetFields } from './ReadingActivityFields.tsx'
import { isNewTarget, NEW_MATERIAL } from './content-form-targets.ts'
import {
  ContentFields,
  fieldError,
  LicenseFields,
  TagFields,
  type DraftForm,
} from './ContentDraftFields.tsx'
import {
  AUTHORABLE_OPTIONS,
  defaultDraft,
  draftFormSchema,
  draftFromHead,
  isItemSetType,
  patchFromDraft,
  type DraftFormOutput,
  type DraftFormValues,
} from './content-pool-model.ts'
import { linkedFieldMessage, linkedHints } from './reading-activity-model.ts'

type FormModalProps = {
  /** `''` kapalı, `yeni` oluşturma, aksi hâlde düzenlenen içeriğin kimliği. */
  target: string
  onClose: () => void
  /** Yeni içerik kaydedildi (kimliğiyle); ekran ayrıntıyı açar. */
  onCreated: (resourceId: string) => void
  /** Mevcut taslak güncellendi. */
  onSaved: () => void
}

/**
 * Taslak formu (geniş pencere): okuma parçası, tek çoktan seçmeli soru, materyal dosyası
 * (DOM-KYN-006) ya da quiz/alıştırma seti (okuma parçasına bağlanınca okuma-anlama etkinliği;
 * OG-984, IST-042, DOM-BEC-006; dinleme kaydına bağlanınca dinleme etkinliği, OG-052, IST-045,
 * DOM-BEC-005). Bağlı parça, kayıt ve soru hataları (`passage_*`, `listening_*`, `quiz_item_*`)
 * ortak Türkçe iletiyle alanın altına yazılır. Doğrulama core `resourceVersionInputSchema` ile istemcide yapılır; sunucu hatası
 * (400 ya da 422 iş kuralı) alan yoluyla gelirse yalnız alanın altında, yoksa toast olarak görünür
 * (`exclusive`). Dosya yüklemesi ve güvenlik taraması sürerken kaydet kilitlidir; yolsuz bağlama
 * hatası (422 `file_not_ready`, `file_rejected`) da dosya alanında görünür (`FILE_FIELD`, OG-987).
 * Diğer içerik türleri sonraki dilimdedir.
 * TODO(F3c2): ses, video, çalışma kâğıdı ve lisanslı yayın türleri.
 */
/** Dosya bağlama hatalarının alanı: dosya listesinin altında (`filesError`) okunur. */
const FILE_FIELD = fileAttachField('fileIds')

export function ContentDraftForm({ target, onClose, onCreated, onSaved }: FormModalProps) {
  const creating = isNewTarget(target)
  return (
    <Modal
      open={target !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={creating ? 'Yeni içerik' : 'Taslağı düzenle'}
      size="wide"
    >
      {creating ? (
        <DraftEditor
          key={target}
          initialType={target === NEW_MATERIAL ? 'file' : 'reading_passage'}
          onClose={onClose}
          onCreated={onCreated}
        />
      ) : null}
      {target !== '' && !creating ? (
        <EditLoader resourceId={target} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Modal>
  )
}

function EditLoader({
  resourceId,
  onClose,
  onSaved,
}: {
  resourceId: string
  onClose: () => void
  onSaved: () => void
}) {
  const detail = useResourceDetail(resourceId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        İçerik yükleniyor…
      </p>
    )
  const staff = isStaffDetail(data) ? data : null
  const initial = staff ? draftFromHead(staff.head) : null
  if (!staff || !initial)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Bu içerik türü henüz düzenlenemez.
      </p>
    )
  return (
    <DraftEditor
      detail={staff}
      initial={initial}
      reload={async () => {
        const fresh = (await detail.refetch()).data?.data
        const head = fresh && isStaffDetail(fresh) ? fresh.head : null
        const values = head ? draftFromHead(head) : null
        return head && values ? { version: head.rowVersion, values } : null
      }}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

type EditorProps = {
  /** Düzenlemede mevcut kaynak; yoksa yeni içerik. */
  detail?: StaffResourceDetail
  initial?: DraftFormValues
  /** Yeni içerikte başlangıçta seçili tür. */
  initialType?: AuthorableType
  reload?: () => Promise<{ version: number; values: DraftFormValues } | null>
  onClose: () => void
  onCreated?: (resourceId: string) => void
  onSaved?: () => void
}

function DraftEditor({
  detail,
  initial,
  initialType = 'reading_passage',
  reload,
  onClose,
  onCreated,
  onSaved,
}: EditorProps) {
  const { session } = useAuth()
  const languageSchool = session?.institution.type === 'language_school'
  const create = useCreateResource()
  const update = useUpdateDraft()
  const [type, setType] = useState<AuthorableType>(initial?.content.type ?? initialType)
  const [uploading, setUploading] = useState(false)
  // Taranan dosya yalnız kaydeti kilitler; tür seçimi dahil alanlar açık kalır (OG-987).
  const [scanBlocked, setScanBlocked] = useState(false)
  const [declared, setDeclared] = useState(false)
  const [declarationMissing, setDeclarationMissing] = useState(false)
  // Çözümleyici birleşim girdisini (core) doğrular; form değerleri düz tipte tutulur (yollar tipli
  // kalsın). Ön işlem (`files` → `fileIds`) girdiyi `unknown` yaptığından tip form değerine bağlanır.
  const form: DraftForm = useForm<DraftFormValues, unknown, DraftFormOutput>({
    // TODO(ts): `z.preprocess` girdiyi `unknown` yapar; şema tipi form değerine bağlanır.
    resolver: zodResolver(draftFormSchema as z.ZodType<DraftFormOutput, DraftFormValues>),
    defaultValues: initial ?? defaultDraft(initialType),
  })
  const conflict = useEditConflict<DraftFormValues>({
    initialVersion: detail?.head.rowVersion ?? 0,
    reload: async () => (reload ? reload() : null),
    apply: (values) => form.reset(values),
  })
  // Yükleme sürerken alanlar açık kalır (iptal, başka alan); yalnız kaydet ve tür seçimi kilitli.
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  // Sunucu alan hatası: bağlı içerik kodu ortak Türkçe iletiyi alır (`LINKED_CONTENT_MESSAGES`).
  const setServerError: DraftForm['setError'] = (name, error, options) =>
    form.setError(
      name,
      { ...error, message: linkedFieldMessage(error.type ?? '', error.message ?? '') },
      options,
    )
  // Yayım sorunları kayıtlı sürümündür; kayıtlı bağlar başlangıç değerlerinden okunur.
  const hints = linkedHints(detail?.publicationIssues ?? [], {
    passageVersionId: initial?.content.passageVersionId ?? null,
    listeningVersionId: initial?.content.listeningVersionId ?? null,
    itemIds: (initial?.content.items ?? []).map((item) => item.questionVersionId),
  })

  function changeType(next: AuthorableType) {
    setType(next)
    form.reset({ ...defaultDraft(next), title: form.getValues('title') })
  }

  const submit = form.handleSubmit(async (values) => {
    if (!declared) return
    if (detail) {
      const outcome = await update.submit(
        {
          resourceId: detail.resource.id,
          versionId: detail.head.id,
          version: conflict.version,
          patch: patchFromDraft(values),
        },
        { setError: setServerError, silent: isVersionConflict, fieldFor: FILE_FIELD },
      )
      if (outcome.status === 'success') {
        notify.success('Taslak güncellendi.')
        onSaved?.()
      } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
        conflict.markConflict()
      }
      return
    }
    const outcome = await create.submit(patchFromDraft(values), {
      setError: setServerError,
      fieldFor: FILE_FIELD,
    })
    if (outcome.status === 'success') {
      notify.success('Taslak kaydedildi.')
      onCreated?.(outcome.data.data.resource.id)
    }
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (uploading || scanBlocked) return
    // Beyan, form hatalarıyla birlikte görünsün diye doğrulamadan önce işaretlenir.
    setDeclarationMissing(!declared)
    void submit(event)
  }

  return (
    <form
      noValidate
      aria-label={detail ? 'Taslağı düzenle' : 'Yeni içerik'}
      onSubmit={onSubmit}
      className="grid gap-6"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {!detail ? (
          <FormField id="icerik-tur" label="İçerik türü">
            {(control) => (
              <NativeSelect
                {...control}
                value={type}
                onChange={(event) => {
                  const chosen = AUTHORABLE_OPTIONS.find(
                    (option) => option.value === event.target.value,
                  )
                  if (chosen) changeType(chosen.value)
                }}
                className="w-full"
                disabled={busy || uploading}
              >
                {AUTHORABLE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <div className={detail ? 'sm:col-span-2' : undefined}>
          <FormField id="icerik-baslik" label="Başlık" error={fieldError(form, 'title')}>
            {(control) => (
              <Input {...control} {...form.register('title')} maxLength={200} disabled={busy} />
            )}
          </FormField>
        </div>
      </div>

      {isItemSetType(type) ? (
        <ItemSetFields form={form} busy={busy} languageSchool={languageSchool} hints={hints} />
      ) : (
        <ContentFields
          form={form}
          type={type}
          busy={busy}
          onUploadingChange={setUploading}
          onScanBlockedChange={setScanBlocked}
        />
      )}
      <TagFields form={form} type={type} languageSchool={languageSchool} busy={busy} />
      <LicenseFields form={form} busy={busy} />

      <div className="grid gap-1.5 rounded-card border bg-surface-soft p-4">
        <Label htmlFor="icerik-beyan" className="items-start gap-2.5 font-normal">
          <Checkbox
            id="icerik-beyan"
            checked={declared}
            onCheckedChange={(checked) => {
              setDeclared(checked === true)
              if (checked === true) setDeclarationMissing(false)
            }}
            aria-invalid={declarationMissing || undefined}
            aria-describedby={declarationMissing ? 'icerik-beyan-hata' : undefined}
            disabled={busy}
            className="mt-0.5"
          />
          <span className="text-sm">{COPYRIGHT_DECLARATION}</span>
        </Label>
        {declarationMissing ? (
          <p id="icerik-beyan-hata" role="alert" className="text-sm text-destructive">
            Devam etmek için telif beyanını onaylayın.
          </p>
        ) : null}
      </div>

      <RootError message={form.formState.errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button
          type="submit"
          disabled={busy || uploading || scanBlocked || conflict.conflicted}
          aria-busy={busy || uploading || undefined}
        >
          <Icon name="Check" size={17} aria-hidden="true" />
          {detail ? 'Değişiklikleri kaydet' : 'Taslağı kaydet'}
        </Button>
      </div>
    </form>
  )
}
