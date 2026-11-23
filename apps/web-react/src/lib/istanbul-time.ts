// `datetime-local` alanlarının Europe/Istanbul çevirisi. Türkiye 2016'dan beri yaz saati
// uygulamaz; fark sabit +03:00'tür. Gösterim ve gün anahtarı core biçimleyicilerindendir.
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'

const ISTANBUL_OFFSET = '+03:00'
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** `datetime-local` değeri (Europe/Istanbul, sabit +03:00) → ISO 8601 UTC; geçersizse olduğu gibi. */
export function istanbulToIso(value: string): string {
  if (!LOCAL_DATE_TIME.test(value)) return value
  const time = Date.parse(`${value}:00${ISTANBUL_OFFSET}`)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/** ISO an → `datetime-local` değeri (Europe/Istanbul). */
export function isoToIstanbul(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return ''
  return `${dayKey(value)}T${timeLabel(value)}`
}
