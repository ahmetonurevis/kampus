// Akademik ekranların ortak parçaları: tablo bölümü başlığı, CSV düğmesi, özet kartları.
import { useId, type ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'

type TableSectionProps = {
  title: string
  subtitle: string
  /** CSV indirme işlevi; verilmezse düğme gösterilmez. */
  onDownload?: () => void
  downloadBusy?: boolean
  downloadDisabled?: boolean
  /** Ana işlem düğmesi (ör. "Not gir"); indirme düğmesinden önce gelir. */
  action?: ReactNode
  children: ReactNode
}

/** Tablo bölümü: başlık, kayıt sayısı ve "Listeyi indir" düğmesi (tüm filtrelenmiş sonuç). */
export function TableSection({
  title,
  subtitle,
  onDownload,
  downloadBusy,
  downloadDisabled,
  action,
  children,
}: TableSectionProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="panel mb-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {onDownload ? (
            <Button
              variant="secondary"
              onClick={onDownload}
              disabled={downloadBusy || downloadDisabled}
              aria-busy={downloadBusy || undefined}
            >
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  )
}

/** Başvuru verisi okunamadığında sayfa üstünde gösterilen hata kutusu. */
export function LookupError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-6 rounded-card border bg-surface p-8">
      <QueryError error={error} onRetry={onRetry} />
    </div>
  )
}

export type StatItem = { label: string; value: ReactNode; note?: string }

/** Özet kartları (Vue `StatCard`): sayılar gerçek kayıtlardan hesaplanır. */
export function StatGrid({ label, items }: { label: string; items: readonly StatItem[] }) {
  return (
    <dl
      aria-label={label}
      className="stats-grid mb-6 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="stat-item @container min-w-0 rounded-card border bg-surface px-5 py-4"
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="stat-value mt-1 text-stat font-semibold tabular-nums [overflow-wrap:anywhere]">
            {item.value}
          </dd>
          {item.note ? <p className="mt-1 text-xs text-muted-foreground">{item.note}</p> : null}
        </div>
      ))}
    </dl>
  )
}
