import { useSearchParams } from 'react-router'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { PageHeading } from '@/components/PageHeading.tsx'
import { AppealQueueView } from './AppealQueueView.tsx'
import { TaskAssignmentsView } from './TaskAssignmentsView.tsx'

type Tab = 'gorevler' | 'itirazlar'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'gorevler', label: 'Görevler', icon: 'ListChecks' },
  { value: 'itirazlar', label: 'Açık itirazlar', icon: 'MessageCircleQuestion' },
]

/**
 * Beceri görevleri (yönetici, OG-993; DOM-YTK-028): kurumun bütün görev atamaları, sunucu sayfalı;
 * yönetici atama oluşturur, son teslimi uzatır ve teslimleri puanlar. Öğretmenin Görevler
 * sekmesiyle aynı görünümdür (`TaskAssignmentsView`); kapsamı ve yetkiyi sunucu uygular, sayfa
 * yalnız gezinmedir. "Açık itirazlar" sekmesi (`?sekme=itirazlar`, OG-1010; DOM-BEC-025) kurumun
 * karar bekleyen itirazlarını salt okur gösterir: karar öğretmendedir. Kapalı `learning`
 * modülünde sayfa menüden ve route'tan kalkar.
 */
export function AdminTasksPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('sekme') === 'itirazlar' ? 'itirazlar' : 'gorevler'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="mb-6">
        <LineTabs
          label="Görev bölümleri"
          value={tab}
          options={TABS}
          onChange={(next) =>
            setParams(next === 'gorevler' ? {} : { sekme: next }, { preventScrollReset: true })
          }
        />
      </div>
      {tab === 'gorevler' ? <TaskAssignmentsView /> : <AppealQueueView />}
    </>
  )
}
