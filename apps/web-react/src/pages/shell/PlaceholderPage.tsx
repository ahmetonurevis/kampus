import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'

/** Henüz taşınmamış ekranlar için yer tutucu; başlık ve açıklama navigasyon kaydından gelir. */
export function PlaceholderPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <EmptyState
        icon={page.icon}
        title="Bu ekran taşınıyor"
        description="Bu sayfa yeni web uygulamasına aktarılıyor. Hazır olduğunda burada görünecek."
      />
    </>
  )
}
