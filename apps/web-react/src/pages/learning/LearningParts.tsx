// Öğrenme panellerinin ortak parçaları.
import type { ReactNode } from 'react'
import { QueryError } from '@/components/QueryError.tsx'
import { SummaryIcon } from '../management/SummaryParts.tsx'

/** Panel başlığı: simge, kayıt adı ve tek satır bağlam (durum rozeti gerekmeyen kayıtlar). */
export function SummaryTitle({
  icon,
  title,
  subtitle,
}: {
  icon: string
  title: string
  subtitle: ReactNode
}) {
  return (
    <div className="detail-person mb-5 flex items-center gap-3.5">
      <SummaryIcon name={icon} />
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{title}</h3>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>
      </div>
    </div>
  )
}

/** Etiket/değer çiftleri (`detail-facts`). */
export function Facts({ items }: { items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="detail-facts mb-6 grid gap-0 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b py-2.5 last:border-b-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * İstemci tablosunun yükleme ve hata durumu (`DataTable` bu durumları taşımaz): hata > yükleniyor
 * > tablo. Küçük, kapsamı daraltılmış listeler içindir.
 */
export function TableGate({
  error,
  onRetry,
  loading,
  children,
}: {
  error: unknown
  onRetry: () => void
  loading: boolean
  children: ReactNode
}) {
  if (error)
    return (
      <div role="alert" className="table-error p-[45px] text-center">
        <QueryError error={error} onRetry={onRetry} />
      </div>
    )
  if (loading)
    return (
      <p
        role="status"
        className="table-loading p-[45px] text-center text-base text-muted-foreground"
      >
        Kayıtlar yükleniyor…
      </p>
    )
  return children
}
