import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { PageHeading } from '@/components/PageHeading.tsx'
import { TaskAssignmentsView } from './TaskAssignmentsView.tsx'

/**
 * Beceri görevleri (yönetici, OG-993; DOM-YTK-028): kurumun bütün görev atamaları, sunucu sayfalı;
 * yönetici atama oluşturur, son teslimi uzatır ve teslimleri puanlar. Öğretmenin Görevler
 * sekmesiyle aynı görünümdür (`TaskAssignmentsView`); kapsamı ve yetkiyi sunucu uygular, sayfa
 * yalnız gezinmedir. Kapalı `learning` modülünde sayfa menüden ve route'tan kalkar.
 */
export function AdminTasksPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <TaskAssignmentsView />
    </>
  )
}
