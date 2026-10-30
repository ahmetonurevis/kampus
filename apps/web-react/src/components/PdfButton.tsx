import { useRef, useState, type ComponentProps } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { PdfPreview } from '@/components/PdfPreview.tsx'
import { Button } from '@/components/ui/button'
import type { PdfDocumentType } from '@/lib/pdf/templates.ts'

type Props = {
  type: PdfDocumentType
  recordId: string
  /** Belgeyi alan öğrenci (ödev çalışma kâğıdında öğrenci ve veli); öğretmende boş. */
  studentId?: string
  /** Görünen metin ("Dekontu görüntüle"). */
  label: string
  /** Aynı metinli düğmeleri ayırt eden erişilebilir ad (ör. satırda öğrenci adı). */
  ariaLabel?: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
}

/**
 * Belgeyi önizleme penceresinde açan düğme (Vue `PdfButton`). Önizleme ilk tıklamada kurulur;
 * kapanınca odak bu düğmeye döner. PDF kodu önizleme açılana kadar yüklenmez.
 */
export function PdfButton({
  type,
  recordId,
  studentId,
  label,
  ariaLabel,
  variant = 'secondary',
  size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant={variant}
        size={size}
        aria-label={ariaLabel}
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
        <PdfPreview
          type={type}
          recordId={recordId}
          {...(studentId ? { studentId } : {})}
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
