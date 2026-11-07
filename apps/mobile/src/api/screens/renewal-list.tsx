import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { renewalDetailSections, renewalRow } from '@kampus/react-shared/renewal-model.ts'
import { useRenewal, useRenewals } from '@kampus/react-shared/use-finance-renewals.ts'
import { Badge, Button, Empty, SearchField, Select, Sheet, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen, Section } from '../../ui/SchoolLayout.tsx'
import {
  canOpenRenewals,
  RENEWAL_STATUS_OPTIONS,
  renewalListItem,
  renewalListQuery,
} from '../renewal-mobile.ts'
import {
  API_PAGE_SIZE,
  clampPageIndex,
  ListLoading,
  QueryError,
  useApiSession,
  useListMemory,
} from '../shell.ts'
import { useDebouncedValue } from '../use-debounced-value.ts'

/**
 * Kayıt Yenileme (yönetici ve ön büro `kayit-yenileme`, web `RenewalsPage` listesi; ON-122, IST-100):
 * kurumun yenileme planları sunucu sayfalı; öğrenci adı araması ve durum süzgeci sunucuda, arama,
 * süzgeç ve sayfa yalnız bellekte. Dokununca ayrıntı açılır (dönem geçişi, plan anındaki ücret
 * kararı, yeni dönem taksitleri). Telefon salt okurdur; plan ve dönem geçişi web'dedir.
 */
export default function StaffRenewals() {
  const session = useApiSession()
  if (!canOpenRenewals(session))
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return <RenewalList />
}

function RenewalList() {
  const { state, setSearch, setFilter, setIndex, clear } = useListMemory('kayit-yenileme')
  const search = useDebouncedValue(state.search)
  const query = useMemo(() => renewalListQuery(state, search), [state, search])
  const renewals = useRenewals(query)
  const total = renewals.data?.meta.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const [selected, setSelected] = useState<string | null>(null)
  const filtered = state.search.trim() !== '' || state.filter !== ''

  return (
    <Screen>
      <T muted>
        Kurumun yenileme planları. Plan, toplu yenileme ve dönem geçişi web uygulamasından yapılır.
      </T>
      <SearchField value={state.search} onChange={setSearch} placeholder="Öğrenci adı" />
      <Select
        label="Durum"
        value={state.filter}
        options={RENEWAL_STATUS_OPTIONS}
        onChange={setFilter}
      />
      {renewals.error ? (
        <QueryError error={renewals.error} onRetry={() => void renewals.refetch()} />
      ) : !renewals.data ? (
        <ListLoading label="Yenileme planları yükleniyor…" />
      ) : renewals.data.data.length === 0 ? (
        filtered ? (
          <EmptyResults noun="yenileme planı" onClear={clear} />
        ) : (
          <Empty
            title="Henüz yenileme planı yok"
            text="Web'den planlanan yenilemeler burada görünür."
          />
        )
      ) : (
        <>
          <T muted size={14}>{`${String(renewals.data.meta.total)} kayıt`}</T>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {renewals.data.data.map((item) => {
              const entry = renewalListItem(renewalRow(item))
              return (
                <ListRow
                  key={item.id}
                  card
                  title={entry.title}
                  subtitle={entry.subtitle}
                  eyebrow={entry.eyebrow}
                  badge={<Badge text={entry.status} />}
                  label={entry.label}
                  onPress={() => setSelected(item.id)}
                />
              )
            })}
          </View>
          <Pagination
            count={renewals.data.meta.total}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      {selected && (
        <RenewalSheet key={selected} renewalId={selected} onClose={() => setSelected(null)} />
      )}
    </Screen>
  )
}

/** Yenileme ayrıntısı (web `RenewalDetail`): tek kayıt ucundan; kapsam dışı kayıt 404 ile anlatılır. */
function RenewalSheet({ renewalId, onClose }: { renewalId: string; onClose: () => void }) {
  const renewal = useRenewal(renewalId)
  const data = renewal.data?.data
  return (
    <Sheet
      visible
      title={data ? (data.studentName ?? 'Kayıt') : 'Yenileme ayrıntısı'}
      onClose={onClose}
      footer={<Button onPress={onClose}>Kapat</Button>}
    >
      {renewal.error ? (
        <QueryError error={renewal.error} onRetry={() => void renewal.refetch()} />
      ) : !data ? (
        <ListLoading label="Kayıt yükleniyor…" />
      ) : (
        <>
          <Badge text={data.status} />
          {renewalDetailSections(data).map((section) => (
            <Section key={section.title} title={section.title}>
              <View style={{ gap: 6 }}>
                {section.lines.map((line) => (
                  <T key={line} muted size={14}>
                    {line}
                  </T>
                ))}
              </View>
            </Section>
          ))}
          {data.contractId && (
            <T muted size={14}>
              Yeni dönem sözleşmesinin PDF'i web uygulamasından alınır.
            </T>
          )}
        </>
      )}
    </Sheet>
  )
}
