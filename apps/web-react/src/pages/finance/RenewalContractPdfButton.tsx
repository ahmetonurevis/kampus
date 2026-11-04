import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import type { PdfPagesHandle, PdfPagesProps } from '@/components/PdfPages.tsx'
import { Button } from '@/components/ui/button'
import type { DocumentPdf } from '@/hooks/use-document-pdf.ts'
import {
  useRenewalContractPdf,
  type RenewalContractRequest,
} from '@/hooks/use-renewal-contract-pdf.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { DOCUMENT_TITLES } from '@/lib/pdf/templates/shared.ts'

// Yenileme sözleşmesinin önizlemesi (IST-100). Ortak `PdfButton`/`PdfPreview` yalnız belge türü ve
// kayıt kimliği alır; yenilemenin ücret kararını şablona taşıyamadığı için pencere burada aynı
// davranışla kurulur: belge pencere açılınca hazırlanır, indirme ve yazdırma aynı Blob'u kullanır,
// geçici adresler kapanışta bırakılır, odak açan düğmeye döner.
//
// TODO(pdf-preview-source): `PdfPreview` hazır belge sorgusunu kabul edince bu dosya ortak bileşene
// döner (Oğuzhan'dan istenecek).

const ViewerUnavailable: ComponentType<PdfPagesProps> = () => (
  <div role="alert" className="rounded-lg border p-6 text-center text-sm">
    Önizleme yüklenemedi. PDF’yi indirebilir veya pencereyi kapatıp yeniden açabilirsiniz.
  </div>
)

const PdfPages = lazy<ComponentType<PdfPagesProps>>(() =>
  import('@/components/PdfPages.tsx').catch((cause: unknown) => {
    console.error('[kampus]', 'pdf-viewer-load', cause)
    return { default: ViewerUnavailable }
  }),
)

const TITLE = DOCUMENT_TITLES.contract

export function RenewalContractPdfButton({
  request,
  label,
}: {
  request: RenewalContractRequest
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      >
        <Icon name="FileText" size={16} />
        {label}
      </Button>
      {used ? (
        <RenewalContractPreview
          request={request}
          open={open}
          onOpenChange={setOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            button.current?.focus()
          }}
        />
      ) : null}
    </>
  )
}

function RenewalContractPreview({
  request,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  request: RenewalContractRequest
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const pdf = useRenewalContractPdf(request, open)
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${TITLE} · Önizleme`}
      size="document"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {pdf.isError ? (
        <div role="alert" className="grid justify-items-center gap-3 py-12 text-center">
          <Icon name="FileText" size={32} />
          <p>{pdf.error.message}</p>
          <Button type="button" onClick={() => void pdf.refetch()}>
            Yeniden dene
          </Button>
        </div>
      ) : pdf.data ? (
        <PreviewBody file={pdf.data} />
      ) : (
        <div role="status" className="grid justify-items-center gap-3 py-12 text-center">
          <Icon name="RefreshCw" size={28} className="motion-safe:animate-spin" />
          <p>Belgeniz hazırlanıyor…</p>
        </div>
      )}
    </Modal>
  )
}

function PreviewBody({ file }: { file: DocumentPdf }) {
  const pages = useRef<PdfPagesHandle>(null)
  const [ready, setReady] = useState(false)
  const [printing, setPrinting] = useState(false)
  const openedUrls = useRef<string[]>([])

  // "Yeni sekmede aç" için geçici adres tıklamada üretilir; pencere kapanınca bırakılır.
  useEffect(() => {
    const urls = openedUrls.current
    return () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url)
    }
  }, [])

  function openInTab() {
    const url = URL.createObjectURL(file.blob)
    openedUrls.current.push(url)
    window.open(url, '_blank', 'noopener')
  }

  async function print() {
    if (!ready || printing) return
    setPrinting(true)
    try {
      await pages.current?.print()
    } finally {
      setPrinting(false)
    }
  }

  function download() {
    saveBlob(file.blob, file.filename)
    notify.success('PDF belgeniz indirildi.')
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid min-w-0">
          <strong className="[overflow-wrap:anywhere]">{file.filename}</strong>
          <small className="text-muted-foreground">{file.pages} sayfa · PDF belgesi</small>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!ready || printing}
            aria-busy={printing || undefined}
            onClick={() => void print()}
          >
            <Icon name="Printer" size={17} />
            {printing ? 'Hazırlanıyor…' : 'Yazdır'}
          </Button>
          <Button type="button" onClick={download}>
            <Icon name="Download" size={17} />
            PDF’yi indir
          </Button>
        </div>
      </div>
      <Suspense
        fallback={
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Önizleme yükleniyor…
          </p>
        }
      >
        <PdfPages ref={pages} blob={file.blob} title={TITLE} onReady={setReady} />
      </Suspense>
      <p className="text-sm text-muted-foreground">
        Belgeyi daha büyük görüntülemek için{' '}
        <Button type="button" variant="link" className="h-auto min-h-0 p-0" onClick={openInTab}>
          yeni sekmede aç
          <Icon name="ExternalLink" size={14} />
        </Button>
        .
      </p>
    </div>
  )
}
