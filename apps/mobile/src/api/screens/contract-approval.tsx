import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { CONTRACT_STATUS_LABELS, contractStatus } from '@kampus/school-core/lib/contract-status.ts'
import type { ContractRecord } from '@kampus/react-shared/contract-model.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { Badge, Button, Empty, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, ListRow, Notice, Screen, Section } from '../../ui/SchoolLayout.tsx'
import {
  APPROVAL_ON_WEB_NOTICE,
  awaitingApprovalCount,
  canOpenParentContracts,
  contractFacts,
  contractListItems,
  contractNotice,
  contractPlanView,
  contractStatusTone,
} from '../contract-approval.ts'
import { ListLoading, QueryError, resolveChild, useApiSession, useSelectedChild } from '../shell.ts'
import { ContractPdf } from './contract-pdf.tsx'
import { childOptions, ChildPicker } from './parent-child-picker.tsx'

type StudentRecord = State['students'][number]
type ClassRecord = State['classes'][number]
type InvoiceRecord = State['invoices'][number]

/**
 * Veli: Sözleşmeler (web `veli/sozlesmeler` eşi; IST-092, DOM-FIN-010, -051). Seçili çocuğun
 * sözleşme sürümleri durumuyla listelenir, onay bekleyen sürüm üstte durur. Dokununca künye, Ek 1
 * ödeme planı ve PDF açılır. Onay telefonda verilmez: onay ucu taze oturum ister, mobil parola
 * doğrulama penceresi sunmaz; veli onayı web'den verir (`contract-approval.ts`). Kapsamı sunucu
 * uygular: liste yalnız bu velinin çocuklarının kayıtlarıdır, ekran süzmez.
 */
export default function ParentContracts() {
  const session = useApiSession()
  const open = canOpenParentContracts(session)
  const [selected, setSelected] = useSelectedChild()
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const classes = useCollectionAll<ClassRecord>('classes', {}, { enabled: open })
  const options = useMemo(
    () => childOptions(students.data ?? [], classes.data ?? []),
    [students.data, classes.data],
  )
  const childId = resolveChild(
    options.map((option) => option.id),
    selected,
  )

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Eğitim sözleşmeleri, sürümleri ve onay durumu.</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Çocuklarınız yükleniyor…" />
      ) : !childId ? (
        <Empty title="Bağlı öğrenci yok" text="Hesabınıza bağlı öğrenci kaydı bulunamadı." />
      ) : (
        <>
          <ChildPicker options={options} value={childId} onChange={setSelected} />
          <ContractList key={childId} childId={childId} institution={session.institution.name} />
        </>
      )}
    </Screen>
  )
}

function ContractList({ childId, institution }: { childId: string; institution: string }) {
  const contracts = useCollectionAll<ContractRecord>('contracts', {
    filters: { studentId: childId },
  })
  const [openId, setOpenId] = useState('')
  const items = useMemo(() => contractListItems(contracts.data ?? []), [contracts.data])

  if (contracts.error)
    return <QueryError error={contracts.error} onRetry={() => void contracts.refetch()} />
  if (!contracts.data) return <ListLoading label="Sözleşmeler yükleniyor…" />
  if (items.length === 0)
    return (
      <Empty
        title="Sözleşme yok"
        text="Kayıt tamamlandığında çocuğunuzun eğitim sözleşmesi burada görünür."
      />
    )
  const awaiting = awaitingApprovalCount(items)
  return (
    <>
      {awaiting > 0 && (
        <Notice
          title={
            awaiting === 1
              ? 'Bir sözleşme onayınızı bekliyor'
              : `${String(awaiting)} sözleşme onayınızı bekliyor`
          }
          text={APPROVAL_ON_WEB_NOTICE.text}
          tone={APPROVAL_ON_WEB_NOTICE.tone}
        />
      )}
      <View style={{ gap: 10 }} accessibilityRole="list">
        {items.map((item) => (
          <ListRow
            key={item.id}
            card
            title={item.title}
            subtitle={item.subtitle}
            eyebrow={item.amount}
            badge={<Badge text={item.statusLabel} tone={item.tone} />}
            label={`${item.label}, ayrıntıyı aç`}
            onPress={() => setOpenId(item.id)}
          />
        ))}
      </View>
      {openId !== '' && (
        <ContractSheet
          contractId={openId}
          contracts={contracts.data.map((row) => row.record)}
          childId={childId}
          institution={institution}
          onClose={() => setOpenId('')}
        />
      )}
    </>
  )
}

/**
 * Sürümün ayrıntısı: künye, durum bilgisi (onay bekleyende web yönlendirmesi), Ek 1 ödeme planı ve
 * PDF. Kayıt listeden gelir; liste tazelenirse (ör. web'de onaylandıysa) pencere güncel durumu
 * gösterir, kayıt kaybolduysa kapanır.
 */
function ContractSheet({
  contractId,
  contracts,
  childId,
  institution,
  onClose,
}: {
  contractId: string
  contracts: readonly ContractRecord[]
  childId: string
  institution: string
  onClose: () => void
}) {
  const invoices = useCollectionAll<InvoiceRecord>('invoices', { filters: { studentId: childId } })
  const contract = contracts.find((item) => item.id === contractId)
  if (!contract) return null
  const status = contractStatus(contract, contracts)
  const notice = contractNotice(contract, status)
  const plan = invoices.data
    ? contractPlanView(
        contract,
        invoices.data.map((row) => row.record),
      )
    : null
  return (
    <Sheet
      visible
      title="Sözleşme"
      onClose={onClose}
      footer={<Button onPress={onClose}>Kapat</Button>}
    >
      <View style={{ gap: 8 }}>
        <T bold size={18}>
          {contract.title}
        </T>
        <Badge text={CONTRACT_STATUS_LABELS[status]} tone={contractStatusTone(status)} />
      </View>
      {notice && <Notice title={notice.title} text={notice.text} tone={notice.tone} />}
      <View style={{ gap: 12 }}>
        {contractFacts(contract, status).map(([label, value]) => (
          <DetailPair key={label} label={label} value={value} />
        ))}
      </View>
      <Section title={plan?.caption ?? 'Ödeme planı'}>
        {invoices.error ? (
          <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : !plan ? (
          <ListLoading label="Ödeme planı yükleniyor…" />
        ) : plan.rows.length === 0 ? (
          <T muted>Sözleşmeye bağlı taksit yok.</T>
        ) : (
          <View accessibilityRole="list">
            {plan.rows.map((row) => (
              <ListRow
                key={row.key}
                title={row.title}
                subtitle={row.subtitle}
                eyebrow={row.amount}
                badge={row.kind ? <Badge text={row.kind} tone="primary" /> : undefined}
              />
            ))}
          </View>
        )}
      </Section>
      <ContractPdf contractId={contract.id} institution={institution} />
    </Sheet>
  )
}
