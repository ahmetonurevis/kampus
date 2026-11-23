import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { useMarkAnnouncementRead } from '@kampus/react-shared/use-communication.ts'
import { Empty, SearchField, Sheet, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import {
  announcementView,
  WITHDRAWN_NOTICE,
  type AnnouncementRecord,
  type AnnouncementView,
} from '@kampus/react-shared/announcement-model.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'
import { BadgeRow } from './communication-parts.tsx'

/**
 * Duyurular (beş rol, yalnız okuma): kullanıcının alıcısı olduğu duyurular, en yeni üstte.
 * Açılan duyuru alıcı için okundu yazılır. Geri çekilen duyurunun metni gösterilmez. Yayın,
 * düzeltme ve geri çekme web uygulamasındadır; kapsamı sunucu daraltır.
 */
export default function Announcements() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'Announcements')
  const { state, setSearch, setIndex } = useListMemory('duyurular')
  const search = useDebouncedValue(state.search)
  const list = useCollectionList<AnnouncementRecord>(
    'announcements',
    { page: state.index + 1, pageSize: API_PAGE_SIZE, q: search, sort: ['-date'] },
    { enabled: open },
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const views = useMemo(
    () => list.data?.rows.map((row) => announcementView(row.record)),
    [list.data],
  )
  const selected = views?.find((view) => view.id === selectedId)
  const total = list.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  const unread = views?.filter((view) => view.unread).length ?? 0
  return (
    <Screen>
      <T muted>
        {unread > 0
          ? `Bu sayfada ${unread} okunmamış duyuru var.`
          : 'Kurumdan haberler ve duyurular.'}
      </T>
      <SearchField value={state.search} onChange={setSearch} placeholder="Duyuru ara" />
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !views ? (
        <ListLoading label="Duyurular yükleniyor…" />
      ) : views.length === 0 ? (
        search ? (
          <EmptyResults noun="duyuru" onClear={() => setSearch('')} />
        ) : (
          <Empty title="Henüz duyuru yok" text="Yeni duyurular burada görünür." />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {views.map((view) => (
            <ListRow
              key={view.id}
              card
              title={view.title}
              eyebrow={[view.category, view.date].filter(Boolean).join(' · ')}
              subtitle={view.withdrawn ? WITHDRAWN_NOTICE : undefined}
              badge={<BadgeRow badges={view.badges} />}
              label={`${view.title} duyurusunu aç`}
              onPress={() => setSelectedId(view.id)}
            />
          ))}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
      {selected && <AnnouncementSheet view={selected} onClose={() => setSelectedId(null)} />}
    </Screen>
  )
}

function AnnouncementSheet({ view, onClose }: { view: AnnouncementView; onClose: () => void }) {
  const { mutate } = useMarkAnnouncementRead()
  const marked = useRef('')
  // Arka plan işlemi (dış sistem): açılan okunmamış duyuru bir kez okundu yazılır; hata toast
  // göstermez, duyuru yine okunabilir.
  useEffect(() => {
    if (!view.unread || marked.current === view.id) return
    marked.current = view.id
    mutate(view.id)
  }, [view.unread, view.id, mutate])
  return (
    <Sheet visible title={view.title} onClose={onClose}>
      <BadgeRow badges={view.badges} />
      {!!(view.category || view.date) && (
        <T muted size={14}>
          {[view.category, view.date].filter(Boolean).join(' · ')}
        </T>
      )}
      {view.withdrawn ? (
        <T>{WITHDRAWN_NOTICE}</T>
      ) : view.text ? (
        <T selectable>{view.text}</T>
      ) : (
        <T muted>Bu duyurunun metni yok.</T>
      )}
    </Sheet>
  )
}
