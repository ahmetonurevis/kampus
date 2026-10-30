import React, { useState } from 'react'
import { Platform } from 'react-native'
import { useSchool, recordError } from '../store/SchoolProvider.tsx'
import { createDocument, shareFile, saveFile, printFile } from '../lib/files.ts'
import { Button, Sheet, T } from './components.jsx'
import { ListRow } from './SchoolLayout.jsx'

export default function DocumentLink({ type, id, studentId, title = 'Çalışma kâğıdı.pdf' }) {
  const { data, notify } = useSchool(),
    [document, setDocument] = useState(null),
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
  async function handle(action) {
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
