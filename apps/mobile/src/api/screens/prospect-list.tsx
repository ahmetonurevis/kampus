import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import type { ProspectRecord } from '@kampus/react-shared/prospect-model.ts'
import { useCollectionAll, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, SearchField, Select, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen } from '../../ui/SchoolLayout.tsx'
import {
  canOpenProspects,
  prospectListItem,
  prospectListQuery,
  stageFilterOptions,
} from '../prospect-mobile.ts'
import {
  API_PAGE_SIZE,
  clampPageIndex,
  ListLoading,
  QueryError,
  useApiSession,
  useListMemory,
} from '../shell.ts'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { ProspectSheet } from './prospect-sheet.tsx'

type Named = { id: string; name: string }

/**
 * Aday Öğrenciler (ön büro `adaylar`, web `ProspectsPage` eşi; ON-122): kurumun adayları sunucu
 * sayfalı, yeni aday önce. Arama (ad, telefon, ilgi) ve aşama süzgeci sunucuda uygulanır; arama,
 * süzgeç ve sayfa yalnız bellekte korunur. Dokununca aday kartı açılır (aşama, not). Yeni aday,
 * CSV ve kesin kayıt web'dedir. Veriler cihaza yazılmaz.
 */
export default function FrontOfficeProspects() {
  const session = useApiSession()
  if (!canOpenProspects(session))
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return <ProspectList />
}

function ProspectList() {
  const session = useApiSession()
  const type = session.institution.type
  const { state, setSearch, setFilter, setIndex, clear } = useListMemory('onburo:adaylar')
  const search = useDebouncedValue(state.search)
  const query = useMemo(() => prospectListQuery(state, search), [state, search])
  const list = useCollectionList<ProspectRecord>('prospects', query)
  const branches = useCollectionAll<Named>('branches')
  const branchNames = useMemo(
    () => new Map((branches.data ?? []).map((entry) => [entry.record.id, entry.record.name])),
    [branches.data],
  )
  const total = list.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const [selected, setSelected] = useState<CollectionRow<ProspectRecord> | null>(null)
  const filtered = state.search.trim() !== '' || state.filter !== ''

  return (
    <Screen>
      <T muted>Adayları arayın, aşamasını güncelleyin, görüşme notu ekleyin.</T>
      <SearchField value={state.search} onChange={setSearch} placeholder="Ad, telefon veya ilgi" />
      <Select
        label="Aday aşaması"
        value={state.filter}
        options={stageFilterOptions(type)}
        onChange={setFilter}
      />
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <ListLoading label="Adaylar yükleniyor…" />
      ) : list.data.rows.length === 0 ? (
        filtered ? (
          <EmptyResults noun="aday" onClear={clear} />
        ) : (
          <Empty title="Henüz aday yok" text="Web'den eklenen adaylar burada görünür." />
        )
      ) : (
        <>
          <T muted size={14}>{`${String(list.data.total)} aday`}</T>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {list.data.rows.map((row) => {
              const item = prospectListItem(row.record, type, branchNames.get(row.record.branchId))
              return (
                <ListRow
                  key={row.id}
                  card
                  title={item.title}
                  subtitle={item.subtitle}
                  eyebrow={item.contact}
                  badge={<Badge text={item.stageLabel} tone={item.tone} />}
                  label={item.label}
                  onPress={() => setSelected(row)}
                />
              )
            })}
          </View>
          <Pagination
            count={list.data.total}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      {selected && (
        <ProspectSheet
          key={selected.id}
          prospectId={selected.id}
          initial={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </Screen>
  )
}
