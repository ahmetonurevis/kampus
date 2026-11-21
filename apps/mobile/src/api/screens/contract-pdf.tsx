import { useEffect, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { recordError } from '../../lib/error-log.ts'
import { printFile, saveFile, shareFile, type PdfDocument } from '../../lib/files.ts'
import { Button, T } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import {
  contractDocumentErrorMessage,
  contractDocumentHtml,
  contractDocumentName,
  loadContractDocument,
} from '../contract-document.ts'
import { useNotify } from '../toast.tsx'

type PdfState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'ready'; document: PdfDocument }
  | { status: 'failed'; message: string }

/** HTML'i A4 PDF'e çevirir; web önizlemesinde (export:web) belge yeni sekmede açılır. */
async function htmlToPdf(html: string, name: string): Promise<PdfDocument> {
  if (Platform.OS === 'web') {
    const popup = window.open('', '_blank')
    if (!popup) throw new Error('Belge için açılır pencerelere izin verin.')
    popup.document.write(html)
    popup.document.close()
    return { uri: '', name, html }
  }
  const result = await Print.printToFileAsync({ html, width: 595, height: 842 })
  const uri = `${FileSystem.cacheDirectory ?? ''}${name}`
  await FileSystem.copyAsync({ from: result.uri, to: uri })
  return { uri, name }
}

/**
 * Sözleşme PDF'i (IST-092): belge düğmeye basınca hazırlanır (sözleşme açılınca değil, gereksiz
 * istek atılmaz), ardından sistem görüntüleyicisinde açılır; kaydetme ve paylaşma aynı dosyayı
 * kullanır. Geçici dosya pencere kapanınca silinir. Hata sayfa içinde Türkçe gösterilir, teknik
 * ayrıntı `recordError` ile loglanır.
 */
export function ContractPdf({
  contractId,
  institution,
}: {
  contractId: string
  institution: string
}) {
  const client = useKampusClient()
  const notify = useNotify()
  const [state, setState] = useState<PdfState>({ status: 'idle' })
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const uri = state.status === 'ready' ? state.document.uri : ''

  // Ekran kapanınca süren hazırlık iptal edilir, hazırlanan geçici dosya silinir.
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (!uri) return undefined
    return () => {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch((error: unknown) =>
        recordError(error, 'contract-pdf-cleanup', 'warn'),
      )
    }
  }, [uri])

  async function prepare() {
    if (state.status === 'preparing') return
    const controller = new AbortController()
    abort.current = controller
    setState({ status: 'preparing' })
    try {
      const data = await loadContractDocument(client, contractId, controller.signal)
      const html = contractDocumentHtml(data, { institution, generatedAt: new Date() })
      const document = await htmlToPdf(html, contractDocumentName(contractId))
      if (controller.signal.aborted) return
      setState({ status: 'ready', document })
      if (Platform.OS !== 'web') await printFile(document)
    } catch (error) {
      if (controller.signal.aborted) return
      recordError(error, 'contract-pdf')
      setState({ status: 'failed', message: contractDocumentErrorMessage(error) })
    }
  }

  async function handle(action: 'open' | 'save' | 'share') {
    if (state.status !== 'ready' || busy) return
    setBusy(true)
    try {
      if (action === 'open') await printFile(state.document)
      else if (action === 'save') {
        if (await saveFile(state.document)) notify('PDF cihazınıza kaydedildi.')
      } else await shareFile(state.document.uri)
    } catch (error) {
      recordError(error, 'contract-pdf-action')
      notify('Belge işlemi tamamlanamadı. Yeniden deneyin.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'ready' && Platform.OS !== 'web')
    return (
      <View style={{ gap: 10 }}>
        <Button primary icon="FileText" disabled={busy} onPress={() => void handle('open')}>
          Sözleşmeyi görüntüle
        </Button>
        <Button icon="Download" disabled={busy} onPress={() => void handle('save')}>
          PDF’yi kaydet
        </Button>
        <Button icon="Share2" disabled={busy} onPress={() => void handle('share')}>
          Paylaş
        </Button>
      </View>
    )
  return (
    <View style={{ gap: 10 }}>
      {state.status === 'failed' && (
        <Notice title="Belge hazırlanamadı" text={state.message} tone="red" />
      )}
      {state.status === 'ready' && (
        <T muted size={14}>
          Belge yeni sekmede açıldı. Tarayıcının yazdırma menüsünden PDF olarak kaydedebilirsiniz.
        </T>
      )}
      <Button
        primary
        icon="FileText"
        disabled={state.status === 'preparing'}
        onPress={() => void prepare()}
      >
        {state.status === 'preparing'
          ? 'Belge hazırlanıyor…'
          : state.status === 'failed'
            ? 'Yeniden dene'
            : 'Sözleşmeyi görüntüle'}
      </Button>
    </View>
  )
}
