import type { LineTabOption } from '@/components/LineTabs.tsx'
import type { ModuleState } from '@/lib/navigation.ts'

/**
 * Velinin Akademik Takip sekmeleri (`?sekme=`). Beceri görevleri (OG-992) `learning` modülünün
 * görev uçlarından okunur; modül kapalıyken sekme çizilmez (uçlar 403 `module_disabled` döner) ve
 * adresteki `?sekme=gorevler` ilk sekmeye düşer.
 */
export type ParentTrackingTab =
  'notlar' | 'devamsizlik' | 'program' | 'odevler' | 'quizler' | 'gorevler'

type TabEntry = LineTabOption<ParentTrackingTab> & { module?: string }

const TABS: readonly TabEntry[] = [
  { value: 'notlar', label: 'Notlar', icon: 'Award' },
  { value: 'devamsizlik', label: 'Devamsızlık', icon: 'ClipboardCheck' },
  { value: 'program', label: 'Ders programı', icon: 'CalendarDays' },
  { value: 'odevler', label: 'Ödev durumu', icon: 'NotebookPen' },
  { value: 'quizler', label: 'Quiz sonuçları', icon: 'ListChecks' },
  { value: 'gorevler', label: 'Beceri görevleri', icon: 'BookOpen', module: 'learning' },
]

export const DEFAULT_PARENT_TAB: ParentTrackingTab = 'notlar'

/** Açık modüllere göre görünen sekmeler (kayıt sırasıyla). */
export function parentTrackingTabs(modules: ModuleState): LineTabOption<ParentTrackingTab>[] {
  return TABS.filter((tab) => !tab.module || modules[tab.module] === true).map(
    ({ value, label, icon }) => ({ value, label, ...(icon ? { icon } : {}) }),
  )
}

/** Adresteki sekme görünen sekmelerden biri değilse ilk sekme. */
export function resolveParentTab(
  requested: string | null,
  tabs: readonly LineTabOption<ParentTrackingTab>[],
): ParentTrackingTab {
  return tabs.find((tab) => tab.value === requested)?.value ?? DEFAULT_PARENT_TAB
}
