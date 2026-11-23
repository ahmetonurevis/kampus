import { useState } from 'react'
import { Platform } from 'react-native'
import type { DocumentType } from '@kampus/school-core/lib/document-data.ts'
import { useLoadedSchool } from '../store/SchoolProvider.tsx'
import { recordError } from '../lib/error-log.ts'
import { createDocument, shareFile, saveFile, printFile, type PdfDocument } from '../lib/files.ts'
import { Button, Sheet, T } from './components.tsx'
import { ListRow } from './SchoolLayout.tsx'

type DocumentLinkProps = { type: DocumentType; id: string; studentId?: string; title?: string }

export default function DocumentLink({
  type,
  id,
  studentId,
  title = 'Çalışma kâğıdı.pdf',
}: DocumentLinkProps) {
  const { data, notify } = useLoadedSchool(),
    [document, setDocument] = useState<PdfDocument | null>(null),
    [busy, setBusy] = useState(false)
  async function prepare() {
    if (busy) return
    setBusy(true)
    try {
      setDocument(await createDocument(data, type, id, studentId))
    } catch (error) {
      recordError(error, 'document-prepare')
      notify('Belge hazırlanamadı. Lütfen tekrar deneyin.', 'error')
    } finally {
      setBusy(false)
    }
  }
  async function handle(action: 'save' | 'print' | 'share') {
    if (!document) return
    setBusy(true)
    try {
      if (action === 'save') {
        if (await saveFile(document)) notify('PDF cihazınıza kaydedildi.')
      } else if (action === 'print') await printFile(document)
      else await shareFile(document.uri)
    } catch (error) {
      recordError(error, 'document-action')
      notify('Belge işlemi tamamlanamadı. Yeniden deneyin.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <ListRow
        title={title}
        subtitle={busy ? 'Belge hazırlanıyor…' : 'PDF · Çalışma belgesi'}
        onPress={prepare}
      />
      {document && (
        <Sheet compact visible title="Çalışma belgesi" onClose={() => !busy && setDocument(null)}>
          <T>
            {Platform.OS === 'web'
              ? 'Belge yeni sekmede açıldı. Tarayıcının yazdırma menüsünden PDF olarak kaydedebilirsiniz.'
              : document.name}
          </T>
          {Platform.OS !== 'web' && (
            <>
              <Button primary disabled={busy} onPress={() => handle('save')}>
                PDF’yi kaydet
              </Button>
              <Button disabled={busy} onPress={() => handle('share')}>
                Paylaş
              </Button>
              <Button disabled={busy} onPress={() => handle('print')}>
                Yazdır
              </Button>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
