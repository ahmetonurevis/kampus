// PDF sayfa görüntüleyici (pdfjs-dist). Yalnız `React.lazy` ile yüklenir; pdfjs ilk JS paketine
// girmez. Önizleme tarayıcının PDF eklentisine bağlı değildir (başsız tarayıcıda ve mobilde de
// çalışır) ve yazdırma önizlenen aynı PDF'nin sayfalarını kullanır.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { cn } from '@/lib/utils'

GlobalWorkerOptions.workerSrc = workerUrl

const LOAD_ERROR = 'Önizleme gösterilemedi. Yeniden deneyebilir veya PDF’yi indirebilirsiniz.'
const ZOOMS = [
  { value: 1, label: 'Genişliğe sığdır' },
  { value: 1.25, label: '%125' },
  { value: 1.5, label: '%150' },
  { value: 2, label: '%200' },
] as const
const MAX_WIDTH = 820

export type PdfPagesHandle = { print: () => Promise<void> }

export type PdfPagesProps = {
  blob: Blob
  title: string
  /** Sayfa çizildi (`true`) veya çizilemedi/yeniden çiziliyor (`false`). */
  onReady: (ready: boolean) => void
  ref?: Ref<PdfPagesHandle>
}

const PRINT_STYLE =
  '@page{size:A4;margin:0}body{margin:0;background:#eee}p{padding:24px;font:16px sans-serif}img{display:block;width:210mm;max-width:100%;height:auto;margin:0 auto 16px;background:white;break-after:page}img:last-child{break-after:auto}@media print{body{background:white}p{display:none}img{width:210mm;max-width:none;margin:0}}'

function isCancelled(error: unknown) {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

export default function PdfPages({ blob, title, onReady, ref }: PdfPagesProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const printWindow = useRef<Window | null>(null)
  const [loadVersion, setLoadVersion] = useState(0)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  // Çizim durumu "istenen çizim" anahtarıyla türetilir: anahtar çizilenle eşleşmiyorsa yükleniyor.
  const [renderedKey, setRenderedKey] = useState('')
  const [failedKey, setFailedKey] = useState('')
  const [pageText, setPageText] = useState('')

  const wantedKey = pdf && width > 0 ? `${currentPage}:${zoom}:${width}` : ''
  const error = loadFailed || (wantedKey !== '' && failedKey === wantedKey) ? LOAD_ERROR : ''
  const ready = wantedKey !== '' && renderedKey === wantedKey
  const loading = !error && !ready

  useEffect(() => {
    onReady(ready)
  }, [ready, onReady])

  // Belgeyi yükler; "yeniden dene" değişince yeniden. Blob değişince üst bileşen bileşeni
  // yeniden kurar (`key`). `cancelled` her çalıştırmaya özgüdür (Strict Mode çift çalıştırır).
  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    void (async () => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (cancelled) return
        task = getDocument({ data: bytes })
        const loaded = await task.promise
        if (cancelled) return
        setPdf(loaded)
        setCurrentPage(1)
      } catch (cause) {
        if (cancelled) return
        console.error('[kampus]', 'pdf-preview-load', cause)
        setLoadFailed(true)
      }
    })()
    return () => {
      cancelled = true
      printWindow.current?.close()
      void task?.destroy().catch((cause: unknown) => console.warn('[kampus]', 'pdf-cleanup', cause))
    }
  }, [blob, loadVersion])

  // Görünüm genişliği: yeniden çizim yalnız genişlik değişince.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  // Geçerli sayfayı çizer; sayfa, yakınlaştırma veya genişlik değişince önceki çizim iptal edilir.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!pdf || !canvas || width === 0) return
    const key = `${currentPage}:${zoom}:${width}`
    let cancelled = false
    let task: RenderTask | undefined
    viewportRef.current?.scrollTo({ top: 0, left: 0 })
    void (async () => {
      try {
        const page = await pdf.getPage(currentPage)
        if (cancelled) return
        const natural = page.getViewport({ scale: 1 })
        const target = Math.min(width, MAX_WIDTH) * zoom
        const view = page.getViewport({ scale: target / natural.width })
        const density = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(view.width * density)
        canvas.height = Math.floor(view.height * density)
        canvas.style.width = `${view.width}px`
        canvas.style.height = `${view.height}px`
        task = page.render({
          canvas,
          viewport: view,
          ...(density === 1 ? {} : { transform: [density, 0, 0, density, 0, 0] }),
        })
        await task.promise
        const content = await page.getTextContent()
        if (cancelled) return
        // Ekran okuyucu ve arama için sayfanın metni (kanvas görüntüdür).
        setPageText(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
        setRenderedKey(key)
      } catch (cause) {
        if (cancelled || isCancelled(cause)) return
        console.error('[kampus]', 'pdf-preview', cause)
        setFailedKey(key)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, currentPage, zoom, width])

  function retry() {
    setLoadFailed(false)
    setFailedKey('')
    setRenderedKey('')
    setPdf(null)
    setLoadVersion((version) => version + 1)
  }

  // Yazdırma: sayfalar tarayıcının PDF eklentisine gerek duymadan görüntü olarak yeni pencereye
  // konur; pencere kapatılırsa veya görüntüleyici kapanırsa iş yarıda bırakılır.
  async function printPages() {
    if (!pdf) return
    const popup = window.open('', '_blank')
    if (!popup) {
      notify.warning(
        'Yazdırma penceresi açılamadı. Tarayıcıdan açılır pencerelere izin verin veya PDF’yi indirin.',
      )
      return
    }
    printWindow.current = popup
    popup.opener = null
    popup.document.title = `${title} · Yazdır`
    popup.document.documentElement.lang = 'tr'
    const style = popup.document.createElement('style')
    style.textContent = PRINT_STYLE
    popup.document.head.append(style)
    const message = popup.document.createElement('p')
    message.textContent = 'Yazdırma hazırlanıyor…'
    popup.document.body.append(message)
    const aborted = () => popup.closed || printWindow.current !== popup
    try {
      for (let index = 1; index <= pdf.numPages; index++) {
        if (aborted()) return popup.close()
        const page = await pdf.getPage(index)
        const view = page.getViewport({ scale: 2 })
        const sheet = document.createElement('canvas')
        sheet.width = Math.ceil(view.width)
        sheet.height = Math.ceil(view.height)
        await page.render({ canvas: sheet, viewport: view }).promise
        if (aborted()) return popup.close()
        const image = popup.document.createElement('img')
        image.alt = `${title}, sayfa ${index}`
        image.src = sheet.toDataURL('image/png')
        sheet.width = sheet.height = 0
        popup.document.body.append(image)
        await image.decode()
      }
      if (aborted()) return popup.close()
      message.textContent =
        'Belge hazır. Yeniden yazdırmak için tarayıcının Yazdır seçeneğini kullanabilirsiniz.'
      popup.focus()
      popup.print()
    } catch (cause) {
      popup.close()
      if (printWindow.current === popup) {
        console.error('[kampus]', 'pdf-print', cause)
        notify.error('Yazdırma hazırlanamadı. PDF’yi indirerek yeniden deneyin.')
      }
    } finally {
      if (printWindow.current === popup) printWindow.current = null
    }
  }

  useImperativeHandle(ref, () => ({ print: printPages }))

  return (
    <div className="grid gap-3">
      {pdf ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Önceki PDF sayfası"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => page - 1)}
            >
              <Icon name="ChevronLeft" size={18} />
            </Button>
            <span role="status" className="text-sm">
              Sayfa {currentPage} / {pdf?.numPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Sonraki PDF sayfası"
              disabled={currentPage === pdf?.numPages}
              onClick={() => setCurrentPage((page) => page + 1)}
            >
              <Icon name="ChevronRight" size={18} />
            </Button>
          </div>
          <NativeSelect
            aria-label="PDF yakınlaştırma"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {ZOOMS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        tabIndex={0}
        aria-label="PDF sayfa görünümü"
        aria-busy={loading}
        className="grid min-h-64 place-items-start justify-items-center overflow-auto rounded-lg border bg-muted/40 p-4"
      >
        {error ? (
          <div role="alert" className="grid justify-items-center gap-3 p-6 text-center text-sm">
            <p>{error}</p>
            <Button type="button" variant="secondary" onClick={retry}>
              Önizlemeyi yeniden dene
            </Button>
          </div>
        ) : loading ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Sayfa hazırlanıyor…
          </p>
        ) : null}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${title}, sayfa ${currentPage}`}
          className={cn(
            'max-w-none bg-white',
            (error || renderedKey === '') && 'hidden',
            loading && 'opacity-40',
          )}
        />
        <p className="sr-only">{pageText}</p>
      </div>
    </div>
  )
}
