import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { isModuleDisabledError } from '@kampus/react-shared/collections.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError, queryErrorMessage } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Kartın veri durumu: TanStack Query sonucunun gereken kısmı (birden çok sorgu birleşebilir). */
export type CardState = {
  isPending: boolean
  error: unknown
  retry: () => void
}

/** Birden çok sorgunun ortak durumu: biri bekliyorsa bekler, ilk hata gösterilir. */
export function combineStates(
  ...queries: readonly { isPending: boolean; error: unknown; refetch: () => unknown }[]
): CardState {
  return {
    isPending: queries.some((query) => query.isPending),
    error: queries.find((query) => query.error)?.error ?? null,
    retry: () => {
      for (const query of queries) if (query.error) void query.refetch()
    },
  }
}

/** Sayaç ızgarası: geniş ekranda dört, dar ekranda iki sütun. */
export function StatGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="dashboard-stats mb-[var(--space-section)] grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3 sm:gap-4"
    >
      {children}
    </section>
  )
}

/** İçerik ızgarası: geniş ekranda 2:1 (ana kart solda), dar ekranda tek sütun. */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-grid mb-[var(--space-section)] grid gap-[var(--space-section)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {children}
    </div>
  )
}

type StatCardProps = {
  label: string
  icon: string
  /** Biçimlenmiş değer (sayı, tutar, yüzde); veri gelene kadar gösterilmez. */
  value: string
  note?: string
  /** İlgili listeye derin bağlantı (filtre adreste). */
  href?: string
  state: CardState
}

/**
 * Sayaç kartı: değer sunucu sayımından gelir. Kartın tamamı bağlantıdır (etiket bağlantının adı,
 * kart alanı tıklanabilir); yükleniyor, hata ve kapalı modül durumları kendisindedir.
 */
export function StatCard({ label, icon, value, note, href, state }: StatCardProps) {
  const id = useId()
  if (state.error && isModuleDisabledError(state.error)) return null
  return (
    <article
      aria-labelledby={id}
      aria-busy={state.isPending || undefined}
      className="stat-card @container relative flex min-w-0 flex-col gap-2 rounded-card border bg-surface p-4 focus-within:ring-2 focus-within:ring-focus"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={id} className="text-sm font-medium text-muted-foreground">
          {href ? (
            <Link
              to={href}
              className="outline-none after:absolute after:inset-0 after:rounded-card hover:text-foreground"
            >
              {label}
            </Link>
          ) : (
            label
          )}
        </h2>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon name={icon} size={16} aria-hidden="true" />
        </span>
      </div>
      {state.error ? (
        <div className="relative z-10 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-danger">{queryErrorMessage(state.error)}</span>
          <Button variant="secondary" size="sm" onClick={state.retry}>
            Yeniden dene
          </Button>
        </div>
      ) : state.isPending ? (
        <p className="h-8 w-20 animate-pulse rounded-md bg-surface-soft motion-reduce:animate-none">
          <span className="sr-only">Yükleniyor…</span>
        </p>
      ) : (
        <p className="stat-value text-stat font-semibold tracking-[-0.4px] tabular-nums [overflow-wrap:anywhere]">
          {value}
        </p>
      )}
      {note && !state.error && !state.isPending ? (
        <p className="text-sm text-muted-foreground">{note}</p>
      ) : null}
    </article>
  )
}

type ListCardProps = {
  title: string
  description?: string
  /** Sakin ikincil işlem: listenin tamamına bağlantı. */
  action?: { label: string; href: string }
  state: CardState
  isEmpty: boolean
  emptyText: string
  children: ReactNode
  className?: string
}

/**
 * Kısa liste kartı (ör. son kayıtlar, yaklaşan ödevler). Boş, yükleniyor ve hata durumu ortaktır;
 * hata `QueryError` ile gösterilir. Kapalı modülün kartı hiç çizilmez (dashboard kendine
 * yönlendirmez).
 */
export function ListCard({
  title,
  description,
  action,
  state,
  isEmpty,
  emptyText,
  children,
  className,
}: ListCardProps) {
  const id = useId()
  if (state.error && isModuleDisabledError(state.error)) return null
  return (
    <section
      aria-labelledby={id}
      aria-busy={state.isPending || undefined}
      className={cn('panel flex min-w-0 flex-col rounded-card border bg-surface', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? (
          <Link
            to={action.href}
            className="text-link inline-flex min-h-6 items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {action.label}
            <Icon name="ArrowRight" size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </header>
      <div className="min-w-0 flex-1 px-5 py-4">
        {state.error ? (
          <QueryError error={state.error} onRetry={state.retry} />
        ) : state.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Yükleniyor…
          </p>
        ) : isEmpty ? (
          <p className="empty-inline text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

/** Kısa listenin satır listesi; satırlar arasında ince ayraç. */
export function CardList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="grid divide-y">
      {children}
    </ul>
  )
}

/** Oran çubuğu: değeri gerçek kayıttan gelir; çubuk süs değil, metinle birlikte okunur. */
export function ShareBar({
  value,
  tone = 'primary',
}: {
  value: number
  tone?: 'primary' | 'warning' | 'success'
}) {
  const fill = { primary: 'bg-primary', warning: 'bg-warning', success: 'bg-success' }[tone]
  return (
    <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-surface-soft">
      <span
        className={cn('block h-full rounded-full', fill)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  )
}
