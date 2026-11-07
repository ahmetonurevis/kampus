import { useRef, useState } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { useEnrollmentCertificatePdf } from '@/hooks/use-enrollment-certificate-pdf.ts'
import { enrollmentCertificateTitle } from '@/lib/pdf/templates/enrollment-certificate.ts'
import { FinancePdfDialog } from '../finance/FinancePdfDialog.tsx'

// Öğrenci belgesi düğmesi (DOM-KAY-027). Ortak `PdfButton` yalnız `PdfDocumentType` alır; belge türü
// listesi Oğuzhan'ın alanında olduğu için pencere gün sonu ve yenileme belgesi gibi buradan kurulur.

export function EnrollmentCertificateButton({
  studentId,
  studentName,
}: {
  studentId: string
  studentName: string
}) {
  const { session } = useAuth()
  const title = enrollmentCertificateTitle(session?.institution.type)
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
        aria-label={`${studentName} ${title.toLocaleLowerCase('tr-TR')}`}
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      >
        <Icon name="FileText" size={16} />
        {title}
      </Button>
      {used ? (
        <CertificatePreview
          studentId={studentId}
          title={title}
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

function CertificatePreview({
  studentId,
  title,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  studentId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const pdf = useEnrollmentCertificatePdf(studentId, open)
  return (
    <FinancePdfDialog
      title={title}
      pdf={pdf}
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
