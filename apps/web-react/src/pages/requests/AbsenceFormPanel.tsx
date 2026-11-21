import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { notifyAbsenceSchema } from '@kampus/school-core/lib/requests.ts'
import { useNotifyAbsence } from '@kampus/react-shared/use-request-commands.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { ChildrenGate, ChildSelectField, type ChildOption } from './ChildSelectField.tsx'
import { ABSENCE_DOCUMENT_LIMIT, addAbsenceDocument, documentIds } from './absence-forms.ts'
import { ABSENCE_REASON_OPTIONS, focusFirstError } from './request-forms.ts'

type Values = z.input<typeof notifyAbsenceSchema>
type Output = z.output<typeof notifyAbsenceSchema>

/** `?bildirim-form=` değeri: yeni bildirim. */
export const NEW_NOTICE = 'yeni'

/**
 * İzin/mazeret bildirimi (veli): çocuk, tarih aralığı, gerekçe kategorisi ve isteğe bağlı özür
 * belgesi (PDF/JPEG/PNG, en çok 3; dosya seçilince yüklenir, bildirimle aynı işlemde bağlanır).
 * Serbest açıklama alanı yoktur; gerekçe yalnız kategoridir (DOM-ILT-053, KVKK md. 6). Geç mazeret
 * ve örtüşen bildirim hatası ilgili tarih alanının altında, belge hatası belge alanının altında
 * görünür (toast çıkmaz). Belge sonradan da eklenebilir (bildirim paneli).
 */
export function AbsenceFormPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="İzin veya mazeret bildir"
    >
      {open ? (
        <ChildrenGate>
          {(options, defaultId) => (
            <AbsenceForm options={options} defaultId={defaultId} onClose={onClose} />
          )}
        </ChildrenGate>
      ) : null}
    </SidePanel>
  )
}

function AbsenceForm({
  options,
  defaultId,
  onClose,
}: {
  options: readonly ChildOption[]
  defaultId: string
  onClose: () => void
}) {
  const notice = useNotifyAbsence()
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(notifyAbsenceSchema),
    // Gerekçe boş başlar: kullanıcı bilerek seçer, seçmezse şema mesajı alanın altında çıkar.
    defaultValues: { studentId: defaultId, startDate: '', endDate: '' },
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  // Taranan belge yalnız gönder düğmesini kilitler; alanlar açık kalır (OG-987).
  const [scanBlocked, setScanBlocked] = useState(false)
  const busy = notice.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const fileIds = documentIds(files)
    const outcome = await notice.submit(
      { ...values, ...(fileIds ? { fileIds } : {}) },
      { setError: focusFirstError(form.setError) },
    )
    if (outcome.status === 'success') {
      notify.success('Bildiriminiz kuruma iletildi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="İzin veya mazeret bildir"
      onSubmit={(event) => {
        if (scanBlocked || uploading) return event.preventDefault()
        void onSubmit(event)
      }}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Gerekçe yalnız kategori olarak alınır; sağlık veya özel bilgi yazmanıza gerek yoktur. Özür
        belgesi isteğe bağlıdır ve sonradan da eklenebilir.
      </p>
      <ChildSelectField
        id="bildirim-ogrenci"
        options={options}
        error={errors.studentId}
        selectProps={{ ...form.register('studentId'), disabled: busy }}
      />
      <FormField id="bildirim-baslangic" label="Başlangıç tarihi" error={errors.startDate}>
        {(control) => (
          <Input
            {...control}
            {...form.register('startDate')}
            type="date"
            className="w-full"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bildirim-bitis" label="Bitiş tarihi" error={errors.endDate}>
        {(control) => (
          <Input
            {...control}
            {...form.register('endDate')}
            type="date"
            className="w-full"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bildirim-gerekce" label="Gerekçe" error={errors.reasonCategory}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reasonCategory')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {ABSENCE_REASON_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FileUploadField
        id="bildirim-belge"
        label="Özür belgesi"
        purpose="absence_document"
        multiple
        maxFiles={ABSENCE_DOCUMENT_LIMIT}
        description={`İsteğe bağlı. PDF, JPEG veya PNG; en çok ${ABSENCE_DOCUMENT_LIMIT} belge.`}
        listLabel="Eklenen belgeler"
        items={files}
        error={errors.fileIds}
        disabled={busy}
        onUploaded={(item) => setFiles((current) => addAbsenceDocument(current, item))}
        onRemoved={(id) => setFiles((current) => current.filter((file) => file.id !== id))}
        onBusyChange={setUploading}
        onBlockedChange={setScanBlocked}
      />
      <RootError message={errors.root?.server?.message} />
      <FormActions
        busy={busy}
        disabled={uploading || scanBlocked}
        onCancel={onClose}
        submitLabel="Bildir"
        icon="ArrowRight"
      />
    </form>
  )
}
