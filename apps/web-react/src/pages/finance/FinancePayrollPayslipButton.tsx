import { useRef, useState, type ComponentProps } from 'react'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  usePayrollPayslips,
  type PayrollPayslips,
} from '@kampus/react-shared/use-finance-payroll-runs.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  PAYROLL_PAYSLIP_TITLE,
  payrollPayslipFilename,
  payrollPayslipsDocument,
} from '@/lib/pdf/templates/finance-payroll-payslip.ts'
import { FinancePdfDialog } from './FinancePdfDialog.tsx'

const QUIET = { silent: isReauthenticationRequired }

type Rendering =
  | { status: 'pending' }
  | { status: 'ready'; file: DocumentPdf }
  | { status: 'error'; error: DocumentPdfError }

/**
 * Ücret hesap pusulası düğmesi (DOM-FIN-119; ON-201). Tıklamada pusula verisi ayın kayıtlı
 * hesabından okunur (taze oturum; eskiyse parola sorulur ve okuma bir kez yinelenir; her okuma
 * denetime düşer), sonra PDF önizleme penceresi açılır. `membershipId` verilmezse ayın bütün
 * pusulaları tek belgede, her biri ayrı sayfada. Veri yalnız pencere açıkken bellekte tutulur;
 * jsPDF yalnız bu noktada yüklenir.
 */
export function FinancePayrollPayslipButton({
  month,
  membershipId,
  label,
  accessibleName,
  size,
}: {
  month: string
  membershipId?: string
  label: string
  accessibleName?: string
  size?: ComponentProps<typeof Button>['size']
}) {
  const payslips = usePayrollPayslips()
  const { run, reauthModal } = useReauthRetry()
  const [data, setData] = useState<PayrollPayslips | null>(null)
  const [rendering, setRendering] = useState<Rendering>({ status: 'pending' })
  const button = useRef<HTMLButtonElement>(null)

  async function render(source: PayrollPayslips) {
    setRendering({ status: 'pending' })
    try {
      const { renderPdf } = await import('@/lib/pdf/render.ts')
      const { blob, pages } = await renderPdf((measurer) =>
        payrollPayslipsDocument(measurer, source, { institution: source.institutionName }),
      )
      setRendering({
        status: 'ready',
        file: { blob, pages, filename: payrollPayslipFilename(source) },
      })
    } catch (error) {
      console.error('[kampus]', 'pdf', error)
      setRendering({
        status: 'error',
        error: new DocumentPdfError(documentErrorMessage(error), error),
      })
    }
  }

  async function open() {
    const outcome = await run(() =>
      payslips.submit(membershipId === undefined ? { month } : { month, membershipId }, QUIET),
    )
    if (outcome.status !== 'done' || outcome.result.status !== 'success') return
    const fetched = outcome.result.data.data
    setData(fetched)
    await render(fetched)
  }

  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="secondary"
        size={size}
        aria-haspopup="dialog"
        aria-label={accessibleName}
        disabled={payslips.isPending}
        aria-busy={payslips.isPending || undefined}
        onClick={() => void open()}
      >
        <Icon name="FileText" size={16} aria-hidden="true" />
        {label}
      </Button>
      {data === null ? null : (
        <FinancePdfDialog
          title={PAYROLL_PAYSLIP_TITLE}
          pdf={{
            data: rendering.status === 'ready' ? rendering.file : undefined,
            isError: rendering.status === 'error',
            error: rendering.status === 'error' ? rendering.error : null,
            refetch: () => void render(data),
          }}
          open
          onOpenChange={(next) => {
            if (next) return
            // Ücret verisi pencere kapanınca bırakılır.
            setData(null)
            setRendering({ status: 'pending' })
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            button.current?.focus()
          }}
        />
      )}
      {reauthModal}
    </>
  )
}
