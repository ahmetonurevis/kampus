import { useRef, useState } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import {
  useRenewalContractPdf,
  type RenewalContractRequest,
} from '@/hooks/use-renewal-contract-pdf.ts'
import { DOCUMENT_TITLES } from '@/lib/pdf/templates/shared.ts'
import { FinancePdfDialog } from './FinancePdfDialog.tsx'

// Yenileme sözleşmesinin önizlemesi (IST-100). Ortak `PdfButton`/`PdfPreview` yalnız belge türü ve
// kayıt kimliği alır; yenilemenin ücret kararını şablona taşıyamadığı için pencere burada kurulur.
//
// TODO(pdf-preview-source): `PdfPreview` hazır belge sorgusunu kabul edince bu dosya ortak bileşene
// döner (Oğuzhan'dan istenecek).

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
    <FinancePdfDialog
      title={DOCUMENT_TITLES.contract}
      pdf={pdf}
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
