import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'

/**
 * Yazma ucu henüz olmayan ekranlarda sakin bilgi kutusu: eksik işlem sessizce gizlenmez, kullanıcıya
 * Türkçe olarak söylenir. Sahte düğme veya çalışmayan form çizilmez.
 */
export function PendingWriteNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="info-box mb-6 flex items-start gap-3 rounded-card border bg-surface-soft px-4 py-3 text-sm text-muted-foreground"
    >
      <Icon name="Clock3" size={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
