import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'

type EmptyStateProps = {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}

/** Boş liste veya taşınmamış ekran için sakin durum kutusu. */
export function EmptyState({ icon = 'FolderOpen', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-page flex flex-col items-center gap-3 rounded-card border bg-surface px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon name={icon} size={22} />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? (
        <p className="max-w-[52ch] text-base text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}
