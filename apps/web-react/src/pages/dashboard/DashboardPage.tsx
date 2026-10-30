import { useState } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useAuth } from '@/auth/use-auth.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage, RoleKey } from '@/lib/navigation.ts'
import { AdminDashboard } from './AdminDashboard.tsx'
import { FrontDeskDashboard } from './FrontDeskDashboard.tsx'
import { StudentDashboard } from './StudentDashboard.tsx'
import { TeacherDashboard } from './TeacherDashboard.tsx'
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
 * açıklamadadır. Rol içeriği kendi bileşenindedir; bütün değerler tek özet isteğinden (`useDashboard`) gelir.
 */
export function DashboardPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  // Sayfa açıldığı an: "bugün" ve son teslim karşılaştırmaları aynı ana dayanır.
  const [now] = useState(() => new Date())
  if (!session) return null
  const today = dateLabel(now, { year: 'numeric', weekday: 'long' })
  return (
    <>
      <PageHeading
        title={page.title}
        description={`Merhaba ${firstName(session.user.name)}, ${today}. ${DESCRIPTIONS[session.role]}`}
      />
      {session.role === 'yonetici' ? (
        <AdminDashboard session={session} />
      ) : session.role === 'onburo' ? (
        <FrontDeskDashboard session={session} />
      ) : session.role === 'ogretmen' ? (
        <TeacherDashboard session={session} now={now} />
      ) : (
        <StudentDashboard session={session} now={now} />
      )}
    </>
  )
}
