import { useMemo } from 'react'
import { View } from 'react-native'
import { packageHourRows } from '@kampus/react-shared/finance-package-hours.ts'
import { usePackageSales } from '@kampus/react-shared/use-finance-packages.ts'
import { Badge, T } from '../../ui/components.tsx'
import { DetailPair, ListRow, Section } from '../../ui/SchoolLayout.tsx'
import { ownPackageHoursStudent } from '../finance-package-hours.ts'
import { ListLoading, QueryError, useApiSession } from '../shell.ts'

// Web `FamilyPackagesSection` ile aynı sayfa boyu: sayfalanmaz, öğrencinin paket sayısı küçüktür.
const PAGE = { page: 1, pageSize: 100 } as const

/**
 * Kalan paket saati (ON-302, K-24, DOM-DIL-051): paket adı, kalan saat, son kullanma. Bölümdür, menü
 * sayfası değil: öğrenciye `finance` modülü sayfası kaydedilmez (`pages.ts`), ödeme bilgisi
 * gösterilmez. Dil okulu öğrencisi dışında hiçbir şey çizmez ve istek atmaz.
 */
export default function StudentPackageHours() {
  const session = useApiSession()
  const studentId = ownPackageHoursStudent(session)
  return studentId === null ? null : <OwnPackageHours studentId={studentId} />
}

function OwnPackageHours({ studentId }: { studentId: string }) {
  const sales = usePackageSales({ ...PAGE, studentId })
  const rows = useMemo(() => (sales.data ? packageHourRows(sales.data.data) : []), [sales.data])
  // Paketi olmayan kursiyerin ana ekranında boş bölüm durmaz.
  if (sales.data && rows.length === 0) return null
  return (
    <Section title="Paket saatlerim">
      {sales.error ? (
        <QueryError error={sales.error} onRetry={() => void sales.refetch()} />
      ) : !sales.data ? (
        <ListLoading label="Paket saatleri yükleniyor…" />
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {rows.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.name}
              badge={<Badge text={row.statusLabel} tone={row.statusTone} />}
            >
              <DetailPair label="Kalan saat" value={row.remaining} />
              <DetailPair label="Son kullanma" value={row.expires} />
              {row.note ? (
                <T muted size={14}>
                  {row.note}
                </T>
              ) : null}
            </ListRow>
          ))}
        </View>
      )}
    </Section>
  )
}
