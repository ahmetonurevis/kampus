import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { meetingEvents, type ProspectRecord } from '@kampus/react-shared/prospect-model.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import { Badge, Empty, Select, T } from '../../ui/components.tsx'
import { ListRow, Pagination, Screen, Tabs } from '../../ui/SchoolLayout.tsx'
import {
  canOpenMeetings,
  filterMeetings,
  MEETING_VIEWS,
  meetingKindOptions,
  meetingListItem,
  pageOf,
  type MeetingView,
} from '../prospect-mobile.ts'
import {
  API_PAGE_SIZE,
  clampPageIndex,
  ListLoading,
  QueryError,
  useApiSession,
  useListMemory,
} from '../shell.ts'
import { ProspectSheet } from './prospect-sheet.tsx'

type Named = { id: string; name: string }
const OPEN_QUERY = { filters: { stage: [...OPEN_PROSPECT_STAGES] } }

/**
 * Tanışma Görüşmeleri (ön büro `deneme-dersi-takvimi`, web `MeetingsPage` liste görünümü; ON-122):
 * açık adayların planlanmış tanışma görüşmeleri ve (dil okulunda) deneme dersleri. Yaklaşanlar
 * yakından uzağa, geçmişler yeniden eskiye (DOM-KAY-033, -034); kapalı adayın olayı listelenmez.
 * Aday sayısı açık aşamalarla sınırlı olduğundan liste bir kez okunur, süzgeç ve sayfa bellektedir.
 * Dokununca aday kartı açılır. Planlama ve haftalık takvim web'dedir.
 */
export default function FrontOfficeMeetings() {
  const session = useApiSession()
  if (!canOpenMeetings(session))
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return <MeetingList />
}

function MeetingList() {
  const session = useApiSession()
  const type = session.institution.type
  // "Şimdi" ekran açılışında sabitlenir; liste yeniden çizilirken olaylar grup değiştirmez.
  const [now] = useState(() => Date.now())
  const [view, setView] = useState<MeetingView>('upcoming')
  const { state, setFilter, setIndex } = useListMemory('onburo:gorusmeler')
  const prospects = useCollectionAll<ProspectRecord>('prospects', OPEN_QUERY)
  const branches = useCollectionAll<Named>('branches')
  const classes = useCollectionAll<Named>('classes', {}, { enabled: type === 'language_school' })
  const events = useMemo(
    () =>
      meetingEvents(
        (prospects.data ?? []).map((entry) => entry.record),
        type,
        {
          now,
          branches: new Map(
            (branches.data ?? []).map((entry) => [entry.record.id, entry.record.name]),
          ),
          classes: new Map(
            (classes.data ?? []).map((entry) => [entry.record.id, entry.record.name]),
          ),
        },
      ),
    [prospects.data, branches.data, classes.data, type, now],
  )
  const kinds = meetingKindOptions(type)
  const shown = filterMeetings(events, view, state.filter)
  const index = clampPageIndex(state.index, prospects.data ? shown.length : undefined)
  if (index !== state.index) setIndex(index)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <Screen>
      <T muted>Açık adayların planlanmış görüşmeleri. Planlama web uygulamasından yapılır.</T>
      <Tabs
        value={view}
        onChange={(next) => {
          setView(next)
          setIndex(0)
        }}
        options={MEETING_VIEWS}
      />
      {kinds.length > 0 && (
        <Select label="Tür" value={state.filter} options={kinds} onChange={setFilter} />
      )}
      {prospects.error ? (
        <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
      ) : !prospects.data ? (
        <ListLoading label="Görüşmeler yükleniyor…" />
      ) : shown.length === 0 ? (
        <Empty
          title={view === 'upcoming' ? 'Yaklaşan görüşme yok' : 'Geçmiş görüşme yok'}
          text="Planlanan görüşmeler burada görünür."
        />
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {pageOf(shown, index).map((event) => {
              const item = meetingListItem(event)
              return (
                <ListRow
                  key={event.id}
                  card
                  title={item.title}
                  subtitle={item.subtitle}
                  eyebrow={item.eyebrow}
                  badge={<Badge text={item.stageLabel} tone={item.tone} />}
                  label={item.label}
                  onPress={() => setSelected(event.prospectId)}
                />
              )
            })}
          </View>
          <Pagination
            count={shown.length}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      {selected && (
        <ProspectSheet key={selected} prospectId={selected} onClose={() => setSelected(null)} />
      )}
    </Screen>
  )
}
