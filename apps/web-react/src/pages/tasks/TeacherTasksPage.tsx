import { useSearchParams } from 'react-router'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TeacherHomeworkPage } from '../learning/TeacherHomeworkPage.tsx'
import { GradingQueueView } from './GradingQueueView.tsx'
import { TaskAssignmentsView } from './TaskAssignmentsView.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'

type Tab = 'odevler' | 'gorevler' | 'puanlama'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'odevler', label: 'Ödevler', icon: 'NotebookPen' },
  { value: 'gorevler', label: 'Görevler', icon: 'ListChecks' },
  { value: 'puanlama', label: 'Puanlama kuyruğu', icon: 'ClipboardCheck' },
]
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value)

/**
 * Ödevler & Değerlendirme (öğretmen, Vue `Learning.vue` `/odevler`): mevcut ödev teslim listesi,
 * API görev atamaları ve rubrikle puanlama kuyruğu. Sekme `?sekme=` ile adreste tutulur.
 * Kapalı `learning` modülünde sayfa menüden ve route'tan kalkar (page-registry); API uçları da
 * 403 `module_disabled` verir.
 */
export function TeacherTasksPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const requested = params.get('sekme')
  const tab: Tab = isTab(requested) ? requested : 'odevler'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="mb-6">
        <LineTabs
          label="Ödev ve görev bölümleri"
          value={tab}
          options={TABS}
          onChange={(next) =>
            setParams(next === 'odevler' ? {} : { sekme: next }, { preventScrollReset: true })
          }
        />
      </div>
      {tab === 'odevler' ? <TeacherHomeworkPage page={page} heading={false} /> : null}
      {tab === 'gorevler' ? <TaskAssignmentsView /> : null}
      {tab === 'puanlama' ? <GradingQueueView /> : null}
    </>
  )
}
