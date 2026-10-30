import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const SIZES = {
  default: 'sm:max-w-[560px]',
  wide: 'sm:max-w-[830px]',
  document: 'sm:max-w-[min(1100px,calc(100vw-48px))] h-[calc(100dvh-48px)]',
} as const

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: keyof typeof SIZES
  footer?: ReactNode
  /** Kapanınca odak yönetimi: Radix tetikleyicisiz pencerede odağı kendisi geri vermez. */
  onCloseAutoFocus?: (event: Event) => void
  children: ReactNode
}

/**
 * Ortak pencere (Vue `Modal.vue`): Radix odak tuzağı, Esc ve iç içe pencereler; kapatma
 * düğmesi "Pencereyi kapat". Odak kapanınca açan öğeye döner.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'default',
  footer,
  onCloseAutoFocus,
  children,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        // Portal olaylarının React ağacında üst öğeye (ör. satır tıklaması) sızmasını keser.
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex max-h-[calc(100dvh-48px)] flex-col gap-0 overflow-hidden p-0',
          SIZES[size],
        )}
      >
        <DialogHeader className="border-b px-6 py-[17px] pr-14 text-left">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer ? <DialogFooter className="border-t px-6 py-4">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}
