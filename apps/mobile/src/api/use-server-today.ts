import { useEffect } from 'react'
import { useCurrentAcademicPeriod } from '@kampus/react-shared/use-academic-years.ts'
import { useMinute } from '../ui/use-minute.ts'
import { historyDay } from './attendance-history.ts'

/**
 * Sunucunun bugünü (Europe/Istanbul, `YYYY-AA-GG`): `/academic-years/current` `date`. Cihaz saati
 * "bugün" yerine kullanılmaz; yalnız yanıtın eskidiğini (gece yarısı geçti) anlamak için dakikada bir
 * bakılır ve gün yeniden istenir. Yanıt gelene kadar `today` `null`'dır.
 */
export function useServerToday() {
  const period = useCurrentAcademicPeriod()
  const minute = useMinute()
  const { today, stale } = historyDay(
    period.data?.data.date,
    period.dataUpdatedAt,
    new Date(minute * 60_000),
  )
  const refetch = period.refetch
  useEffect(() => {
    if (stale) void refetch()
  }, [stale, refetch])
  return { today, error: period.error ?? undefined, refetch }
}
