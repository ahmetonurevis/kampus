import { useSearchParams } from 'react-router'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import type { NavPage } from '@/lib/navigation.ts'
import { StudentHomeworkView } from './StudentHomeworkView.tsx'
import { StudentQuizzesView } from './StudentQuizzesView.tsx'
import { LearningStudentGate, StudentSummary } from './StudentLearningPages.tsx'

type Tab = 'odevler' | 'quizler'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'odevler', label: 'Ödev durumu', icon: 'NotebookPen' },
  { value: 'quizler', label: 'Quiz sonuçları', icon: 'ListChecks' },
]
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value)

/**
 * Akademik Takip → ödev durumu ve quiz sonuçları (veli, Vue `Academic.vue` çocuk görünümü).
 * Seçili çocuk kabuktan gelir (`ViewScopeContext`); kapsamı sunucu velinin bağlı çocuklarına
 * daraltır. Sekme adresin `?sekme=` parametresindedir (`odevler`, `quizler`).
 * TODO(web-akademik): Akademik ekranlar `feature/web-akademik` dalında yazılıyor; birleşince bu
 * iki görünüm (`StudentHomeworkView`, `StudentQuizzesView`) oradaki "Akademik Takip" sekmelerine
 * eklenir ve bu sayfa kalkar.
 */
export function ParentLearningPage({ page }: { page: NavPage }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('sekme')
  const tab: Tab = isTab(requested) ? requested : 'odevler'
  return (
    <LearningStudentGate page={page}>
      {(student) => (
        <>
          <StudentSummary student={student} />
          <div className="mb-6">
            <LineTabs
              label="Akademik takip bölümleri"
              value={tab}
              options={TABS}
              onChange={(next) => {
                const nextParams = new URLSearchParams(params)
                nextParams.set('sekme', next)
                nextParams.delete('odev')
                nextParams.delete('quiz')
                setParams(nextParams, { preventScrollReset: true })
              }}
            />
          </div>
          {tab === 'odevler' ? (
            <StudentHomeworkView student={student} title="Ödev durumu" />
          ) : (
            <StudentQuizzesView student={student} title="Quiz sonuçları" />
          )}
        </>
      )}
    </LearningStudentGate>
  )
}
