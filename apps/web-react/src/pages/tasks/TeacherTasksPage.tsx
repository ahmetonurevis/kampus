import { useSearchParams } from 'react-router'
import { useCoordinatorDuties } from '@kampus/react-shared/use-coordinator-duties.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TeacherHomeworkPage } from '../learning/TeacherHomeworkPage.tsx'
import { AppealQueueView } from './AppealQueueView.tsx'
import { DisputeQueueView } from './DisputeQueueView.tsx'
import { GradingQueueView } from './GradingQueueView.tsx'
import { PracticeGradebookView } from './PracticeGradebookView.tsx'
import { TaskAssignmentsView } from './TaskAssignmentsView.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'

type Tab = 'odevler' | 'gorevler' | 'puanlama' | 'itirazlar' | 'alistirma' | 'uyusmazlik'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'odevler', label: 'Ödevler', icon: 'NotebookPen' },
  { value: 'gorevler', label: 'Görevler', icon: 'ListChecks' },
  { value: 'puanlama', label: 'Puanlama kuyruğu', icon: 'ClipboardCheck' },
  { value: 'itirazlar', label: 'Açık itirazlar', icon: 'MessageCircleQuestion' },
  { value: 'alistirma', label: 'Alıştırma not defteri', icon: 'FileCheck' },
]
const DISPUTE_TAB: LineTabOption<Tab> = {
  value: 'uyusmazlik',
  label: 'Uyuşmazlıklar',
  icon: 'ShieldAlert',
}
const isTab = (value: string | null, options: readonly LineTabOption<Tab>[]): value is Tab =>
  options.some((tab) => tab.value === value)

/**
 * Ödevler & Değerlendirme (öğretmen, Vue `Learning.vue` `/odevler`): mevcut ödev teslim listesi,
 * API görev atamaları, rubrikle puanlama kuyruğu, açık itirazlar (OG-1010, DOM-BEC-025) ve
 * alıştırma not defteri (OG-085, DOM-BEC-048).
 * Sekme `?sekme=` ile adreste tutulur.
 * Kapalı `learning` modülünde sayfa menüden ve route'tan kalkar (page-registry); API uçları da
 * 403 `module_disabled` verir.
 *
 * Uyuşmazlıklar sekmesi (OG-058; DOM-BEC-024, DOM-YTK-027) yalnız zümre başkanı ya da akademik
 * koordinatör görevi olan öğretmende görünür; görev listesi öğretmene yalnız kendi görevlerini
 * döndürür. Görünürlük yalnız gezinmedir, kapsam sunucudadır. Görevi olmayanın adresteki
 * `?sekme=uyusmazlik` değeri Ödevler'e düşer.
 */
export function TeacherTasksPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const { session } = useAuth()
  const duties = useCoordinatorDuties({ pageSize: 100 }, { enabled: session?.role === 'ogretmen' })
  const coordinator = (duties.data?.meta.total ?? 0) > 0
  const requested = params.get('sekme')
  // Görev listesi gelmeden adresteki uyuşmazlık sekmesi Ödevler'e düşürülmez: sekme çubuğu seçili
  // sekmeyi adresten gösterir, içerik görev listesi gelince açılır.
  const waiting =
    requested === DISPUTE_TAB.value && duties.isPending && duties.fetchStatus !== 'idle'
  const options = coordinator || waiting ? [...TABS, DISPUTE_TAB] : TABS
  const tab: Tab = isTab(requested, options) ? requested : 'odevler'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="mb-6">
        <LineTabs
          label="Ödev ve görev bölümleri"
          value={tab}
          options={options}
          onChange={(next) =>
            setParams(next === 'odevler' ? {} : { sekme: next }, { preventScrollReset: true })
          }
        />
      </div>
      {waiting ? (
        <p role="status" className="text-sm text-muted-foreground">
          Yükleniyor…
        </p>
      ) : null}
      {tab === 'odevler' ? <TeacherHomeworkPage page={page} heading={false} /> : null}
      {tab === 'gorevler' ? <TaskAssignmentsView /> : null}
      {tab === 'puanlama' ? <GradingQueueView /> : null}
      {tab === 'itirazlar' ? <AppealQueueView /> : null}
      {tab === 'alistirma' ? <PracticeGradebookView /> : null}
      {tab === 'uyusmazlik' && !waiting ? <DisputeQueueView /> : null}
    </>
  )
}
