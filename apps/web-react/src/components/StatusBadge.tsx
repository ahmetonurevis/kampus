import type { ReactNode } from 'react'
import { badgeTone, type BadgeTone } from '@/lib/badge-tone.ts'
import { cn } from '@/lib/utils'

const TONES = {
  green: 'bg-success-soft text-success',
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-warning',
  purple: 'bg-primary-soft text-primary',
  gray: 'border border-border bg-surface-soft text-muted-foreground',
} as const satisfies Record<BadgeTone, string>

type StatusBadgeProps = {
  text: string
  tone?: BadgeTone
  children?: ReactNode
  className?: string
}

/** Durum rozeti (Vue `Badge.vue`): ton verilmezse durum metninden çıkarılır. */
export function StatusBadge({ text, tone, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'badge inline-flex items-center gap-[5px] rounded-sm px-2 py-1 text-2xs leading-[1.6] font-medium whitespace-nowrap',
        TONES[badgeTone(text, tone)],
        className,
      )}
    >
      {text}
      {children}
    </span>
  )
}
