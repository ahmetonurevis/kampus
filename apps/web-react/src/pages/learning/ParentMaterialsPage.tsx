import { use } from 'react'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { SharedMaterialsView } from './SharedMaterialsView.tsx'

/**
 * Materyaller (veli; OG-982, DOM-KYN-041): öğrencinin "Paylaşılan dosyalar" sekmesinin karşılığı.
 * Seçili çocuk kabuktan gelir (`ViewScopeContext`, adreste `?cocuk=`); liste sunucuda o çocuğa
 * paylaşılan yayındaki materyallere daralır (velayetli ve kısıtsız bağ). Yalnız okuma: dosya açılır
 * ve indirilir, yükleme ve paylaşma yoktur.
 */
export function ParentMaterialsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {childId ? (
        <SharedMaterialsView studentId={childId} />
      ) : (
        <EmptyState
          title="Bağlı öğrenci bulunamadı."
          description="Hesabınıza bağlı bir öğrenci olduğunda paylaşılan materyaller burada görünür."
        />
      )}
    </>
  )
}
