import { useRef, useState } from 'react'
import type { CommandOutcome } from '@kampus/react-shared/commands.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import type { DocumentPdf, DocumentPdfError } from '@/hooks/use-document-pdf.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { FinancePdfDialog } from './FinancePdfDialog.tsx'

// Kurumsal müşteri ekranlarının ortak düğmeleri: CSV dökümü (taze oturum ister) ve PDF önizlemesi.

const BOM = '\uFEFF'

type CsvOutcome = CommandOutcome<unknown>

/**
 * Sunucu CSV'sini indirir. Oturum eskiyse (`reauthentication_required`) yeniden giriş penceresi
 * açılır ve giriş sonrası indirme yinelenir.
 */
export function CsvButton({
  label,
  filename,
  busy,
  download,
}: {
  label: string
  filename: string
  busy: boolean
  download: () => Promise<CsvOutcome>
}) {
  const [reauth, setReauth] = useState(false)
  async function run() {
    const outcome = await download()
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), filename)
    notify.success('Dosya indirildi.')
  }
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void run()}
      >
        <Icon name="Download" size={16} aria-hidden="true" />
        {label}
      </Button>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void run()
          }}
        />
      ) : null}
    </>
  )
}

type PdfQuery = {
  data: DocumentPdf | undefined
  isError: boolean
  error: DocumentPdfError | null
  refetch: () => unknown
}

/**
 * PDF önizleme düğmesi; belge pencere açılınca hazırlanır, odak düğmeye döner. `id` belgenin
 * kimliğidir (birden çok kimlik isteyen belge nesne verir, ör. sipariş + mal kabul). Aynı listede
 * birden çok düğme varsa `accessibleName` görünür etiketi içeren ayırt edici ad verir.
 */
export function PdfDialogButton<Id>({
  label,
  title,
  id,
  usePdf,
  accessibleName,
}: {
  label: string
  title: string
  id: Id
  usePdf: (id: Id, enabled: boolean) => PdfQuery
  accessibleName?: string
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const pdf = usePdf(id, open)
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        aria-label={accessibleName}
        onClick={() => setOpen(true)}
      >
        <Icon name="FileText" size={16} aria-hidden="true" />
        {label}
      </Button>
      {open ? (
        <FinancePdfDialog
          title={title}
          pdf={pdf}
          open
          onOpenChange={(next) => (next ? undefined : setOpen(false))}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            button.current?.focus()
          }}
        />
      ) : null}
    </>
  )
}
