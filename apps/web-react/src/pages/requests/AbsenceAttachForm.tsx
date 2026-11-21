import { useState } from 'react'
import { useAttachAbsenceDocuments } from '@kampus/react-shared/use-request-commands.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import { SummarySection } from '../management/SummaryParts.tsx'
import { addAbsenceDocument, documentIds } from './absence-forms.ts'
import type { AbsenceRow } from './request-rows.ts'

/**
 * Veli, karar verilmemiş bildirimine sonradan belge ekler (DOM-ILT-053): dosya seçilince yüklenir,
 * "Belgeleri ekle" bildirime bağlar (`If-Match` okunan sürüm). Toplam en çok 3 belge; süre ve karar
 * denetimi sunucudadır (422 `absence_document_late`, 409 `absence_already_decided`) ve Türkçe
 * toast olur. Başarıda form sıfırlanır (bileşen `key` ile yeniden kurulur).
 */
export function AbsenceAttachForm({ row, remaining }: { row: AbsenceRow; remaining: number }) {
  const attach = useAttachAbsenceDocuments()
  const [items, setItems] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const busy = attach.isPending || uploading

  async function submit() {
    const fileIds = documentIds(items)
    if (!fileIds) return
    const outcome = await attach.submit({
      absenceId: row.id,
      version: row.version,
      body: { fileIds },
    })
    if (outcome.status === 'success') {
      notify.success('Belge bildirime eklendi.')
      setItems([])
    }
  }

  return (
    <SummarySection title="Belge ekle">
      <form
        noValidate
        aria-label="Özür belgesi ekle"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && !scanBlocked) void submit()
        }}
        className="grid gap-4"
      >
        <FileUploadField
          id="mazeret-belge-ekle"
          label="Özür belgesi"
          purpose="absence_document"
          multiple
          maxFiles={remaining}
          description={`PDF, JPEG veya PNG; en çok ${remaining} belge daha ekleyebilirsiniz. Belge zorunlu değildir.`}
          listLabel="Eklenecek belgeler"
          items={items}
          disabled={attach.isPending}
          onUploaded={(item) => setItems((current) => addAbsenceDocument(current, item, remaining))}
          onRemoved={(id) => setItems((current) => current.filter((file) => file.id !== id))}
          onBusyChange={setUploading}
          onBlockedChange={setScanBlocked}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={busy || scanBlocked || items.length === 0}
            aria-busy={attach.isPending || undefined}
          >
            <Icon name="Send" size={16} aria-hidden="true" />
            Belgeleri ekle
          </Button>
        </div>
      </form>
    </SummarySection>
  )
}
