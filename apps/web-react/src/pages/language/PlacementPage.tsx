import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { LearnerKind } from '@kampus/school-core/cefr/placement.ts'
import type { PlacementSession } from '@kampus/react-shared/cefr.ts'
import { usePlacementPage } from '@kampus/react-shared/use-cefr.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SearchField } from '@/components/SearchField.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { OpenPlacementPanel, parseAction, PlacementDetailPanel } from './PlacementPanels.tsx'
import {
  isLearnerKind,
  LEARNER_KIND_OPTIONS,
  learnerOptions,
  placementListRow,
  type PlacementListRow,
} from './placement-model.ts'

const KIND_PARAM = 'tur'
const LEARNER_PARAM = 'kisi'
const DETAIL_PARAM = 'tespit'
const ACTION_PARAM = 'tespit-islem'
const OPEN_PARAM = 'tespit-ac'
const NEW = 'yeni'
const MOBILE_COLUMNS = ['started', 'status', 'mode']
const NO_SORT: readonly string[] = []

/**
 * Seviye Tespiti (dil okulu; OG-078, IST-058; DOM-DIL-010…012): öğrenci ya da aday seçilir, kişinin
 * tespit oturumları sunucu sayfalı listelenir (`?tur=&kisi=`). Satır sağ panelde bölüm sonuçlarını,
 * önerilen CEFR seviyesini ve geçerliliği gösterir (`?tespit=`); bölüm girişi ve yerleştirme kararı
 * aynı panelde açılır (`?tespit-islem=`), yeni oturum ayrı panelde (`?tespit-ac=yeni`). Uçlar
 * yönetici ve öğretmene açıktır; öğretmen yalnız grubundaki öğrenciye ulaşır (kapsam dışı 404).
 */
// TODO(api-tespit-listesi): Liste ucu kişiye bağlıdır (`learnerKind` + `learnerId` zorunlu);
// kurum geneli, durum süzgeçli tespit listesi yok. Gelince kişi seçmeden süren tespitler listelenir.
export function PlacementPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const kindParam = params.get(KIND_PARAM)
  const kind: LearnerKind = isLearnerKind(kindParam) ? kindParam : 'student'
  const learnerId = params.get(LEARNER_PARAM) ?? ''
  const [search, setSearch] = useState('')

  const students = useCoreAll('students')
  const prospects = useCoreAll('prospects')
  const records = useMemo(
    () => ({
      student: (students.data ?? []).map((row) => row.record),
      prospect: (prospects.data ?? []).map((row) => row.record),
    }),
    [students.data, prospects.data],
  )
  const learners = useCallback((of: LearnerKind) => learnerOptions(records[of], ''), [records])
  const options = useMemo(() => learnerOptions(records[kind], search), [records, kind, search])
  const learnerName = useCallback(
    (id: string) =>
      [...records.student, ...records.prospect].find((record) => record.id === id)?.name ?? id,
    [records],
  )

  const list = useListState('seviye-tespitleri', { resetKey: `${kind}:${learnerId}` })
  const sessions = usePlacementPage({
    learnerKind: kind,
    learnerId,
    page: list.state.page,
    pageSize: list.state.pageSize,
  })
  const rows = useMemo(() => sessions.data?.rows.map(placementListRow), [sessions.data])

  const panel = useDetailPanel(DETAIL_PARAM, [ACTION_PARAM])
  const actionPanel = useDetailPanel(ACTION_PARAM)
  const openPanel = useDetailPanel(OPEN_PARAM)
  const openSession = panel.open

  function selectLearner(next: { kind?: LearnerKind; learnerId?: string }) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next.kind !== undefined) updated.set(KIND_PARAM, next.kind)
        if (next.learnerId) updated.set(LEARNER_PARAM, next.learnerId)
        else updated.delete(LEARNER_PARAM)
        return updated
      },
      { replace: true },
    )
  }

  /** Açılan oturum: form paneli kapanır, kişi seçilir ve oturumun ayrıntısı açılır. */
  function opened(session: PlacementSession) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        updated.delete(OPEN_PARAM)
        updated.set(KIND_PARAM, session.learnerKind)
        updated.set(LEARNER_PARAM, session.learnerId)
        updated.set(DETAIL_PARAM, session.id)
        return updated
      },
      { replace: true },
    )
  }

  const columns = useMemo<DataColumn<PlacementListRow>[]>(
    () => [
      { key: 'started', label: 'Başlangıç' },
      { key: 'mode', label: 'Yer' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={row.tone} />,
      },
      { key: 'completed', label: 'Bitiş' },
      { key: 'until', label: 'Geçerlilik sonu' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.started} tespitinin ayrıntısı`}
            onClick={() => openSession(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openSession],
  )

  const lookupError = students.error ?? prospects.error
  const selectedName = learnerId ? learnerName(learnerId) : ''
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button onClick={() => openPanel.open(NEW)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Seviye tespiti aç
          </Button>
        }
      />
      <section
        aria-labelledby="tespit-kisi"
        className="panel mb-5 grid gap-4 rounded-card border bg-surface p-6"
      >
        <h2 id="tespit-kisi" className="text-lg font-semibold">
          Kişi
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            Kişi türü
            <NativeSelect
              value={kind}
              onChange={(event) => {
                setSearch('')
                selectLearner({ kind: event.target.value as LearnerKind, learnerId: '' })
              }}
            >
              {LEARNER_KIND_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <SearchField label="Kişi ara" value={search} onChange={setSearch} />
          <label className="grid min-w-[220px] gap-1.5 text-sm font-medium">
            {kind === 'prospect' ? 'Aday' : 'Öğrenci'}
            <NativeSelect
              value={learnerId}
              onChange={(event) => selectLearner({ learnerId: event.target.value })}
              className="w-full"
            >
              <NativeSelectOption value="">
                {options.length ? 'Kişi seçin' : 'Eşleşen kişi yok'}
              </NativeSelectOption>
              {/* Seçili kişi aramaya uymasa da seçenekte kalır. */}
              {learnerId && !options.some((option) => option.id === learnerId) ? (
                <NativeSelectOption value={learnerId}>{selectedName}</NativeSelectOption>
              ) : null}
              {options.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        {lookupError ? (
          <QueryError
            error={lookupError}
            onRetry={() => {
              void students.refetch()
              void prospects.refetch()
            }}
          />
        ) : null}
      </section>
      {learnerId === '' ? (
        <EmptyState
          icon="ListChecks"
          title="Kişi seçin"
          description="Seviye tespitlerini görmek için bir öğrenci ya da aday seçin. Yeni tespiti sağ üstteki düğmeyle açabilirsiniz."
        />
      ) : (
        <section
          aria-labelledby="tespit-tablosu"
          className="panel overflow-hidden rounded-card border bg-surface"
        >
          <header className="panel-heading px-6 pt-6 pb-2">
            <h2 id="tespit-tablosu" className="text-lg font-semibold">
              {selectedName} · seviye tespitleri
            </h2>
            <p className="text-sm text-muted-foreground">
              {sessions.data?.total ?? 0} tespit · sonuç 90 gün geçerlidir
            </p>
          </header>
          <ServerDataTable
            list={list}
            rows={rows}
            total={sessions.data?.total ?? 0}
            sortable={NO_SORT}
            search={false}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption="Seviye tespitleri"
            empty="Bu kişinin seviye tespiti yok."
            loading={sessions.isPending}
            fetching={sessions.isFetching && !sessions.isPending}
            error={
              sessions.error ? (
                <QueryError error={sessions.error} onRetry={() => void sessions.refetch()} />
              ) : undefined
            }
            onRowClick={(row) => openSession(row.id)}
          />
        </section>
      )}
      <PlacementDetailPanel
        sessionId={panel.selectedId}
        learnerName={learnerName}
        action={parseAction(actionPanel.selectedId)}
        onAction={actionPanel.open}
        onActionClose={actionPanel.close}
        onClose={panel.close}
      />
      <OpenPlacementPanel
        open={openPanel.selectedId === NEW}
        defaults={{ learnerKind: kind, learnerId }}
        learners={learners}
        onClose={openPanel.close}
        onOpened={opened}
      />
    </>
  )
}
