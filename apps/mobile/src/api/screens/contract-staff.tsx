import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { ContractRecord } from '@kampus/react-shared/contract-model.ts'
import {
  useCollectionAll,
  useCollectionItem,
  useCollectionList,
} from '@kampus/react-shared/use-collection.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { CONTRACT_STATUS_LABELS, contractStatus } from '@kampus/school-core/lib/contract-status.ts'
import { Badge, Button, Empty, SearchField, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, EmptyResults, ListRow, Notice, Pagination } from '../../ui/SchoolLayout.tsx'
import { contractStatusTone, contractVersionLabel } from '../contract-approval.ts'
import {
  contractStudentIds,
  contractVersionLinks,
  contractVersions,
  staffContractActions,
  staffContractFacts,
  staffContractItems,
  staffContractNotice,
  staffContractQuery,
} from '../contract-staff.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useApiSession } from '../shell.ts'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'
import { ContractPdf } from './contract-pdf.tsx'
import { ContractPlanSection } from './contract-plan.tsx'
import { AmendmentSheet, CancelAmendmentSheet, SignatorySheet } from './contract-staff-forms.tsx'

type InvoiceRecord = State['invoices'][number]

/**
 * Sözleşmeler (yönetici ve ön büro; web `ContractsSection` eşi; IST-092): kurumun sözleşme sürümleri
 * sunucu sayfalı, öğrenci adı araması sunucuda. Durum saklanmaz: sayfadaki öğrencilerin bütün
 * sürümleri ikinci sorguyla okunur, çünkü bir sürümün yerini alan ek protokol başka sayfada olabilir.
 */
export function FinanceContracts({ today }: { today: string }) {
  const { state, setSearch, setIndex, clear } = useListMemory('finans:sozlesmeler')
  const search = useDebouncedValue(state.search)
  const query = useMemo(() => staffContractQuery(state, search), [state, search])
  const list = useCollectionList<ContractRecord>('contracts', query)
  const total = list.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const studentIds = useMemo(() => contractStudentIds(list.data?.rows ?? []), [list.data])
  const versions = useCollectionAll<ContractRecord>(
    'contracts',
    { filters: { studentId: studentIds } },
    { enabled: studentIds.length > 0 },
  )
  const items = useMemo(
    () => staffContractItems(list.data?.rows ?? [], versions.data),
    [list.data, versions.data],
  )
  const [selectedId, setSelectedId] = useState('')

  return (
    <View style={{ gap: 12 }}>
      <SearchField value={state.search} onChange={setSearch} placeholder="Öğrenci adı" />
      <T muted size={14}>
        Onaylanan sözleşme değişmez; değişiklik ek protokolle yeni sürüm olarak yapılır.
      </T>
      {versions.error && (
        <QueryError error={versions.error} onRetry={() => void versions.refetch()} />
      )}
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <ListLoading label="Sözleşmeler yükleniyor…" />
      ) : items.length === 0 ? (
        state.search.trim() !== '' ? (
          <EmptyResults noun="sözleşme" onClear={clear} />
        ) : (
          <Empty title="Sözleşme yok" text="Kesin kayıtla oluşan sözleşmeler burada görünür." />
        )
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {items.map((item) => (
              <ListRow
                key={item.id}
                card
                title={item.title}
                subtitle={item.subtitle}
                eyebrow={item.amount}
                badge={
                  item.statusLabel ? <Badge text={item.statusLabel} tone={item.tone} /> : undefined
                }
                label={item.label}
                onPress={() => setSelectedId(item.id)}
              />
            ))}
          </View>
          <Pagination
            count={list.data.total}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      {selectedId !== '' && (
        <ContractStaffSheet
          key={selectedId}
          contractId={selectedId}
          today={today}
          onOpen={setSelectedId}
          onClose={() => setSelectedId('')}
        />
      )}
    </View>
  )
}

type Mode = 'view' | 'sign' | 'amend' | 'cancel'

/**
 * Sözleşme ayrıntısı (web `ContractPanel`; IST-092, DOM-FIN-010, -012, -051): sürüm ve durum, imza
 * yetkilisi, ödeyici onayı, Ek 1 planı ve PDF. İmza yetkilisi (yalnız yönetici), ek protokol ve
 * iptal aynı pencerede kısa formdur; ıslak imzalı onay taze oturum istediği için web'dedir. Kimlik
 * görüntüleme denetim kaydı ürettiği için bu ekranda yoktur. Kayıt tek kayıt ucundan okunur ve komut
 * sonrası tazelenir; `If-Match` okunan sürümdür.
 */
function ContractStaffSheet({
  contractId,
  today,
  onOpen,
  onClose,
}: {
  contractId: string
  today: string
  onOpen: (contractId: string) => void
  onClose: () => void
}) {
  const session = useApiSession()
  const item = useCollectionItem<ContractRecord>('contracts', contractId)
  const studentId = item.data?.record.studentId ?? ''
  const versions = useCollectionAll<ContractRecord>(
    'contracts',
    { filters: { studentId } },
    { enabled: studentId !== '' },
  )
  const invoices = useCollectionAll<InvoiceRecord>(
    'invoices',
    { filters: { studentId } },
    { enabled: studentId !== '' },
  )
  const [mode, setMode] = useState<Mode>('view')
  const back = () => setMode('view')
  const error = item.error ?? versions.error

  if (error || !item.data || !versions.data)
    return (
      <Sheet visible title="Sözleşme" onClose={onClose}>
        {error ? (
          <QueryError
            error={error}
            onRetry={() => {
              if (item.error) void item.refetch()
              if (versions.error) void versions.refetch()
            }}
          />
        ) : (
          <ListLoading label="Sözleşme yükleniyor…" />
        )}
      </Sheet>
    )

  const contract = item.data.record
  const target = { contractId: contract.id, version: item.data.version }
  const all = contractVersions(contract, versions.data)
  const status = contractStatus(contract, all)
  const actions = staffContractActions(contract, all, session.role)
  const notice = staffContractNotice(contract, status, actions.sign)
  const invoiceRows = invoices.data?.map((row) => row.record)

  if (mode === 'sign') return <SignatorySheet contract={contract} target={target} onDone={back} />
  if (mode === 'amend' && invoiceRows)
    return (
      <AmendmentSheet
        contract={contract}
        invoices={invoiceRows}
        today={today}
        target={target}
        onDone={back}
        onCreated={onOpen}
      />
    )
  if (mode === 'cancel') return <CancelAmendmentSheet target={target} onDone={back} />

  return (
    <Sheet
      visible
      title="Sözleşme ayrıntısı"
      onClose={onClose}
      footer={<Button onPress={onClose}>Kapat</Button>}
    >
      <View style={{ gap: 8 }}>
        <T bold size={18}>
          {contract.title}
        </T>
        <T muted size={14}>
          {contractVersionLabel(contract)}
        </T>
        <Badge text={CONTRACT_STATUS_LABELS[status]} tone={contractStatusTone(status)} />
      </View>
      {notice && <Notice title={notice.title} text={notice.text} tone={notice.tone} />}
      <View style={{ gap: 12 }}>
        {staffContractFacts(contract, status, item.data.joined?.studentName).map(
          ([label, value]) => (
            <DetailPair key={label} label={label} value={value} />
          ),
        )}
      </View>
      <ContractPlanSection
        contract={contract}
        invoices={invoiceRows}
        error={invoices.error}
        onRetry={() => void invoices.refetch()}
      />
      <ContractPdf contractId={contract.id} institution={session.institution.name} />
      <View style={{ gap: 10 }}>
        {actions.sign && (
          <Button primary icon="Pencil" onPress={() => setMode('sign')}>
            {contract.signatory ? 'İmza yetkilisini düzelt' : 'İmza yetkilisini işle'}
          </Button>
        )}
        {actions.amend && (
          <Button icon="Plus" disabled={!invoiceRows} onPress={() => setMode('amend')}>
            Ek protokol hazırla
          </Button>
        )}
        {actions.cancelAmendment && (
          <Button danger onPress={() => setMode('cancel')}>
            Ek protokolü iptal et
          </Button>
        )}
        {contractVersionLinks(contract, all).map((link) => (
          <Button key={link.id} onPress={() => onOpen(link.id)}>
            {link.label}
          </Button>
        ))}
      </View>
    </Sheet>
  )
}
