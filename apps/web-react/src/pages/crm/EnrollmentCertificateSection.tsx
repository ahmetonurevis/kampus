import { useMemo } from 'react'
import { ENROLLMENT_CERTIFICATE_ROLES } from '@kampus/school-core/lib/enrollment-certificate.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import {
  collectionQueryFromList,
  sortableColumns,
  type CollectionListConfig,
} from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { learnerTerm } from '@/lib/pdf/templates/finance-shared.ts'
import { EnrollmentCertificateButton } from './EnrollmentCertificateButton.tsx'

type Row = { id: string; name: string; number: string; className: string }

const LIST = {
  sortFields: { name: 'name', number: 'number' },
  defaultSort: ['name'],
} satisfies CollectionListConfig
const SORTABLE = sortableColumns(LIST)
const MOBILE_COLUMNS = ['number', 'className']
const canIssue = (role: string | undefined) =>
  ENROLLMENT_CERTIFICATE_ROLES.some((allowed) => allowed === role)

/**
 * Öğrenci belgesi bölümü (DOM-KAY-027): personelin React'te genel öğrenci detayı olmadığı için belge
 * Kayıt İşlemleri'nden düzenlenir. Liste yalnız aktif kayıtları gösterir; ayrılan ve mezun
 * öğrenciye belge düzenlenmez, sunucu da reddeder. Okulda öğrenci, dil okulunda kursiyer terimi.
 */
export function EnrollmentCertificateSection() {
  const { session } = useAuth()
  if (!canIssue(session?.role)) return null
  return <CertificateList learner={learnerTerm(session?.institution.type)} />
}

function CertificateList({ learner }: { learner: ReturnType<typeof learnerTerm> }) {
  const list = useListState('ogrenci-belgesi', { urlPrefix: 'belge-' })
  const search = useDebouncedValue(list.state.query)
  const query = collectionQueryFromList(list.state, LIST, search)
  const students = useCoreList('students', {
    ...query,
    filters: { ...query.filters, isActive: 'true' },
  })
  const classes = useCoreAll('classes')
  const rows = useMemo<Row[] | undefined>(() => {
    const classNames = new Map(classes.data?.map((item) => [item.id, item.record.name]))
    return students.data?.rows.map(({ record }) => ({
      id: record.id,
      name: record.name,
      number: record.number || '—',
      className: classNames.get(record.classId) ?? '—',
    }))
  }, [students.data, classes.data])
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: learner },
      { key: 'number', label: learner === 'Öğrenci' ? 'Okul numarası' : 'Kursiyer numarası' },
      { key: 'className', label: 'Sınıf' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => <EnrollmentCertificateButton studentId={row.id} studentName={row.name} />,
      },
    ],
    [learner],
  )
  const lower = learner.toLocaleLowerCase('tr-TR')
  return (
    <section aria-labelledby="ogrenci-belgesi-baslik" className="mt-6">
      <h2 id="ogrenci-belgesi-baslik" className="text-lg font-semibold">
        {learner} belgesi
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Kaydı aktif {lower} için kurum belgesi hazırlayın. Belge bilgilendirme amaçlıdır, resmî
        belge yerine geçmez; her düzenleme işlem geçmişine yazılır.
      </p>
      <ServerDataTable
        list={list}
        rows={rows}
        total={students.data?.total ?? 0}
        sortable={SORTABLE}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption={`Belge düzenlenebilecek ${lower} kayıtları`}
        empty={`Aktif ${lower} kaydı yok.`}
        loading={students.isPending}
        fetching={students.isFetching && !students.isPending}
        error={
          students.error ? (
            <QueryError error={students.error} onRetry={() => void students.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}
