// Özet panellerinin ortak parçaları (Vue `.detail-person`, `.detail-metrics`, `.detail-section`).
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'

export function SummaryHeader({
  icon,
  title,
  subtitle,
  status,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  status: string
}) {
  return (
    <div className="detail-person mb-5 flex items-center gap-3.5">
      {icon}
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{title}</h3>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>
      </div>
      <StatusBadge text={status} tone={status === 'Aktif' ? 'green' : 'gray'} />
    </div>
  )
}

export function SummaryIcon({ name }: { name: string }) {
  return (
    <span className="mini-icon grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
      <Icon name={name} size={24} aria-hidden="true" />
    </span>
  )
}

export function SummaryMetrics({
  items,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>
}) {
  return (
    <dl className="detail-metrics mb-6 grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-card border bg-surface-soft px-4 py-3">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-md font-semibold [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section mb-6 border-t pt-5">
      <h3 className="mb-3 text-md font-semibold">{title}</h3>
      {children}
    </section>
  )
}

export function SummaryList({
  items,
  empty,
}: {
  items: ReadonlyArray<{ key: string; label: string; value: string }>
  empty: string
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="detail-list grid gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
        >
          <strong className="font-medium">{item.label}</strong>
          <span className="text-right text-muted-foreground">{item.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** Panel içeriği yüklenirken. */
export function SummaryLoading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Özet yükleniyor…
    </p>
  )
}
