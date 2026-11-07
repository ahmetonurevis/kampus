import { useMemo } from 'react'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { activeRoster } from './learning-rows.ts'

/**
 * Bir sınıfın aktif öğrencileri (ödev teslim ve quiz sonuç panelleri). Liste ekranı bütün
 * öğrencileri çekmez; panel yalnız açıldığında kendi sınıfının listesini okur.
 */
export function useClassRoster(classId: string | undefined) {
  const query = useCoreAll(
    'students',
    { filters: { classId: classId ?? '', isActive: 'true' } },
    { enabled: Boolean(classId) },
  )
  const roster = useMemo(() => (query.data ? activeRoster(query.data) : undefined), [query.data])
  return { roster, query }
}
