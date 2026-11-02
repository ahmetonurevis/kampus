import { useState } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useAuth } from '@/auth/use-auth.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage, RoleKey } from '@/lib/navigation.ts'
import { RoleDashboard } from './RoleDashboard.tsx'
import { StaffDashboard } from './StaffDashboard.tsx'
import { StudentDashboard } from './StudentDashboard.tsx'
import { firstName } from './dashboard-model.ts'

const DESCRIPTIONS = {
  yonetici: 'Kayıt, tahsilat ve akademik durum özeti.',
  onburo: 'Taksit takibi, tahsilatlar ve aday görüşmeleri.',
  ogretmen: 'Bugünkü dersleriniz, teslimler ve son yoklamalar.',
  ogrenci: 'Ödevleriniz, son notlarınız ve devamsızlık durumunuz.',
  veli: 'Seçili öğrencinin güncel eğitim özeti.',
} as const satisfies Record<RoleKey, string>

/**
 * Genel Bakış (beş rol; Vue `Dashboard.vue`). Başlık menü kaydındandır; selamlama ve tarih
 * açıklamadadır. Gövde kart kaydından çizilir (`dashboard-cards.tsx`); bütün değerler tek özet isteğinden (`useDashboard`) gelir.
 */
export function DashboardPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  // Sayfa açıldığı an: "bugün" ve son teslim karşılaştırmaları aynı ana dayanır.
  const [now] = useState(() => new Date())
  if (!session) return null
  const today = dateLabel(now, { year: 'numeric', weekday: 'long' })
  const description = `Merhaba ${firstName(session.user.name)}, ${today}. ${DESCRIPTIONS[session.role]}`
  if (session.role === 'yonetici' || session.role === 'onburo')
    return (
      <StaffDashboard
        session={session}
        role={session.role}
        now={now}
        title={page.title}
        description={description}
      />
    )
  return (
    <>
      <PageHeading title={page.title} description={description} />
      {session.role === 'ogretmen' ? (
        <RoleDashboard session={session} role={session.role} now={now} />
      ) : (
        <StudentDashboard session={session} now={now} />
      )}
    </>
  )
}
