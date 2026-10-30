import type { ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type SidePanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  footer?: ReactNode
  children: ReactNode
}

/** Sağ panel: öğrenci/ödeme/sınıf özetleri ve kısa formlar (Vue drawer, 560 px, kenardan 12 px). */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: SidePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        {...(description ? {} : { 'aria-describedby': undefined })}
        className="inset-y-3 right-3 h-auto w-[min(560px,calc(100vw-24px))] gap-0 rounded-dialog border sm:max-w-none"
      >
        <SheetHeader className="border-b px-6 py-[17px] pr-14">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer ? <SheetFooter className="border-t px-6 py-4">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}
