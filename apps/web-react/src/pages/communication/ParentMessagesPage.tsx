import { useSearchParams } from 'react-router'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import type { NavPage } from '@/lib/navigation.ts'
import { AppointmentsPage } from './AppointmentsPage.tsx'
import { MessagesPage } from './MessagesPage.tsx'

type Tab = 'mesajlar' | 'randevular'
const TAB_PARAM = 'sekme'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'mesajlar', label: 'Mesajlar', icon: 'MessagesSquare' },
  { value: 'randevular', label: 'Randevular', icon: 'CalendarCheck2' },
]

/**
 * Veli "Randevu & Mesajlar" sayfası: sekme adreste (`?sekme=randevular`) tutulur. Mesajlar
 * sekmesi öğretmen yazışmasıdır; Randevular sekmesi seçili çocuğun (`?cocuk=`) randevularını ve
 * talep formunu gösterir. Sekme değişince açık yazışma ve randevu panelleri kapanır.
 */
export function ParentMessagesPage({ page }: { page: NavPage }) {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get(TAB_PARAM) === 'randevular' ? 'randevular' : 'mesajlar'

  function select(next: Tab) {
    const updated = new URLSearchParams(params)
    for (const key of ['yazisma', 'randevu', 'randevu-form']) updated.delete(key)
    if (next === 'mesajlar') updated.delete(TAB_PARAM)
    else updated.set(TAB_PARAM, next)
    setParams(updated, { replace: true })
  }

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="grid gap-4">
        <LineTabs label="Randevu ve mesajlar" value={tab} options={TABS} onChange={select} />
        {tab === 'mesajlar' ? (
          <MessagesPage page={page} heading={false} />
        ) : (
          <AppointmentsPage page={page} audience="parent" heading={false} />
        )}
      </div>
    </>
  )
}
