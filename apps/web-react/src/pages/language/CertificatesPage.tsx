import { use, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  useAllCourseCertificates,
  useGroupMebbisList,
} from '@kampus/react-shared/use-course-certificates.ts'
import { useAllLanguageGroups } from '@kampus/react-shared/use-language-groups.ts'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { exportCsv } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import {
  CancelCertificateModal,
  IssueCertificateDialog,
  MebbisRecordModal,
  type CancelTarget,
  type IssueTarget,
  type MebbisTarget,
} from './CertificateDialogs.tsx'
import {
  CERTIFICATE_CSV_COLUMNS,
  certificateActions,
  certificateFilters,
  certificateRows,
  eligibleActions,
  eligibleRows,
  type CertificateRow,
  type EligibleRow,
} from './certificate-rows.ts'
import { useLanguageAccess } from './use-language-access.ts'

type Tab = 'belgeler' | 'hak-kazananlar'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'belgeler', label: 'Belgeler', icon: 'ShieldCheck' },
  { value: 'hak-kazananlar', label: 'Belgeye hak kazananlar', icon: 'ListChecks' },
]
const isTab = (value: string | null): value is Tab => TABS.some((option) => option.value === value)

const SEARCH_KEYS = ['number', 'learner', 'course'] as const
const ELIGIBLE_SEARCH_KEYS = ['learner', 'certificate', 'mebbis'] as const
const STAFF_MOBILE = ['learner', 'course', 'status']
const LEARNER_MOBILE = ['course', 'level', 'issued']
const ELIGIBLE_MOBILE = ['certificate', 'mebbis']
const NO_FILTERS: never[] = []

/**
 * Kurum başarı belgeleri (dil okulu; OG-088, IST-081; DOM-DIL-080, 081, 082). Personel iki
 * sekme görür: düzenlenmiş belgeler (arama, durum/kur süzgeci, CSV, PDF, gerekçeli iptal) ve
 * grubun belgeye hak kazanan kursiyerleri (belge düzenle, yeniden düzenle, MEBBİS izi). Yazma
 * yalnız kurum yöneticisi ve kurun seviyesinin akademik koordinatöründedir; diğer öğretmen okur.
 * Öğrenci kendi, veli seçili çocuğunun geçerli belgelerini görür ve PDF'ini indirir.
 */
export function CertificatesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { role } = useLanguageAccess()
  if (role === 'ogrenci' || role === 'veli') return <LearnerCertificates page={page} />
  return <StaffCertificates page={page} />
}

function StaffCertificates({ page }: { page: NavPage }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('sekme')
  const tab: Tab = isTab(requested) ? requested : 'belgeler'
  const groupId = params.get('grup') ?? ''

  function open(next: Tab, group = '', replace = false) {
    const search: Record<string, string> = {}
    if (next !== 'belgeler') search.sekme = next
    if (group) search.grup = group
    setParams(search, { preventScrollReset: true, replace })
  }

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="mb-6">
        <LineTabs label="Başarı belgeleri bölümleri" value={tab} options={TABS} onChange={open} />
      </div>
      {tab === 'belgeler' ? (
        <CertificateList title={page.title} onReissue={(group) => open('hak-kazananlar', group)} />
      ) : (
        <EligibleList
          groupId={groupId}
          onGroup={(group) => open('hak-kazananlar', group, true)}
          title={page.title}
        />
      )}
    </>
  )
}

function CertificateList({
  title,
  onReissue,
}: {
  title: string
  onReissue: (groupId: string) => void
}) {
  const { role, levels } = useLanguageAccess()
  const certificates = useAllCourseCertificates({})
  const rows = useMemo(
    () => (certificates.data ? certificateRows(certificates.data) : undefined),
    [certificates.data],
  )
  const filters = useMemo(() => (rows ? certificateFilters(rows) : NO_FILTERS), [rows])
  const table = useRef<DataTableHandle<CertificateRow>>(null)
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null)

  const columns = useMemo<DataColumn<CertificateRow>[]>(
    () => [
      { key: 'number', label: 'Belge no' },
      { key: 'learner', label: 'Kursiyer' },
      { key: 'course', label: 'Kur' },
      { key: 'level', label: 'Seviye' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={row.tone} />,
      },
      { key: 'issued', label: 'Düzenlenme' },
      {
        key: 'replaces',
        label: 'Yerine düzenlendiği',
        cell: (row) => row.replaces || '—',
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const actions = certificateActions(row, role, levels)
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <PdfButton
                type="course-certificate"
                recordId={row.id}
                label="PDF"
                ariaLabel={`${row.number} belgesini görüntüle`}
              />
              {actions.cancel ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-haspopup="dialog"
                  aria-label={`${row.number} belgesini iptal et`}
                  onClick={() =>
                    setCancelTarget({ id: row.id, number: row.number, learner: row.learner })
                  }
                >
                  <Icon name="X" size={15} aria-hidden="true" />
                  İptal et
                </Button>
              ) : null}
              {actions.reissue && row.staff ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`${row.number} yerine yeniden düzenle`}
                  onClick={() => row.staff && onReissue(row.staff.groupId)}
                >
                  <Icon name="RotateCcw" size={15} aria-hidden="true" />
                  Yeniden düzenle
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ],
    [role, levels, onReissue],
  )

  function download() {
    exportCsv(title, CERTIFICATE_CSV_COLUMNS, table.current?.filteredRows() ?? rows ?? [])
  }

  return (
    <section
      aria-labelledby="belge-tablosu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="belge-tablosu" className="text-lg font-semibold">
            Düzenlenen belgeler
          </h2>
          <p className="text-sm text-muted-foreground">
            {rows?.length ?? 0} belge · yeniden eskiye
          </p>
        </div>
        <Button variant="secondary" onClick={download} disabled={rows === undefined}>
          <Icon name="Download" size={17} aria-hidden="true" />
          Listeyi indir
        </Button>
      </header>
      {certificates.error ? (
        <div role="alert" className="p-[45px] text-center">
          <QueryError error={certificates.error} onRetry={() => void certificates.refetch()} />
        </div>
      ) : rows === undefined ? (
        <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
          Belgeler yükleniyor…
        </p>
      ) : (
        <DataTable
          ref={table}
          listKey="basari-belgeleri"
          rows={rows}
          columns={columns}
          filters={filters}
          searchKeys={SEARCH_KEYS}
          mobileColumns={STAFF_MOBILE}
          caption="Kurum başarı belgeleri"
          empty="Henüz belge düzenlenmedi. Belgeye hak kazananlar sekmesinden düzenleyin."
        />
      )}
      <CancelCertificateModal target={cancelTarget} onClose={() => setCancelTarget(null)} />
    </section>
  )
}

function EligibleList({
  groupId,
  onGroup,
  title,
}: {
  groupId: string
  onGroup: (groupId: string) => void
  title: string
}) {
  const groups = useAllLanguageGroups({})
  const list = useGroupMebbisList(groupId)
  const courseId = list.data?.data.courseId ?? ''
  const certificates = useAllCourseCertificates({ courseId }, { enabled: courseId !== '' })
  const students = useCoreAll('students', {}, { enabled: groupId !== '' })
  const names = useMemo(
    () => new Map((students.data ?? []).map(({ record }) => [record.id, record.name])),
    [students.data],
  )
  const mebbis = list.data?.data
  const rows = useMemo(
    () =>
      mebbis && certificates.data ? eligibleRows(mebbis, certificates.data, names) : undefined,
    [mebbis, certificates.data, names],
  )
  const canRecord = mebbis?.canRecord ?? false
  const table = useRef<DataTableHandle<EligibleRow>>(null)
  const [issueTarget, setIssueTarget] = useState<IssueTarget | null>(null)
  const [mebbisTarget, setMebbisTarget] = useState<MebbisTarget | null>(null)
  const sortedGroups = useMemo(
    () =>
      [...(groups.data ?? [])].sort((a, b) =>
        `${a.courseName} ${a.name}`.localeCompare(`${b.courseName} ${b.name}`, 'tr'),
      ),
    [groups.data],
  )

  const columns = useMemo<DataColumn<EligibleRow>[]>(
    () => [
      { key: 'learner', label: 'Kursiyer' },
      { key: 'certificate', label: 'Kurum başarı belgesi' },
      { key: 'mebbis', label: 'MEBBİS belgesi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const actions = eligibleActions(row, canRecord)
          if (!actions.issue && !actions.reissue && !actions.mebbis) return '—'
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              {actions.issue || actions.reissue ? (
                <Button
                  size="sm"
                  aria-haspopup="dialog"
                  aria-label={`${row.learner} için ${actions.reissue ? 'yeniden düzenle' : 'belge düzenle'}`}
                  onClick={() =>
                    setIssueTarget({
                      decisionId: row.decisionId,
                      learner: row.learner,
                      replacesCertificateId: row.replacesCertificateId,
                      replacesNumber: row.replacesNumber ?? row.certificate,
                    })
                  }
                >
                  <Icon name={actions.reissue ? 'RotateCcw' : 'ShieldCheck'} size={15} />
                  {actions.reissue ? 'Yeniden düzenle' : 'Belge düzenle'}
                </Button>
              ) : null}
              {actions.mebbis ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-haspopup="dialog"
                  aria-label={`${row.learner} için MEBBİS'te düzenlendi`}
                  onClick={() =>
                    setMebbisTarget({ decisionId: row.decisionId, learner: row.learner })
                  }
                >
                  <Icon name="Check" size={15} aria-hidden="true" />
                  MEBBİS'te düzenlendi
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ],
    [canRecord],
  )

  const error = list.error ?? certificates.error
  const group = sortedGroups.find((item) => item.id === groupId)
  return (
    <section
      aria-labelledby="hak-kazanan-tablosu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-4 px-6 pt-6 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="hak-kazanan-tablosu" className="text-lg font-semibold">
              Belgeye hak kazananlar
            </h2>
            <p className="text-sm text-muted-foreground">
              Onaylı geçti kararı olan kursiyerler; resmî belge MEBBİS'te düzenlenir.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              exportCsv(
                `${title} ${group?.name ?? ''}`.trim(),
                ELIGIBLE_CSV,
                table.current?.filteredRows() ?? rows ?? [],
              )
            }
            disabled={rows === undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Listeyi indir
          </Button>
        </div>
        <div className="grid max-w-md gap-2">
          <Label htmlFor="belge-grup">Grup</Label>
          <NativeSelect
            id="belge-grup"
            value={groupId}
            onChange={(event) => onGroup(event.target.value)}
            disabled={groups.isPending}
          >
            <NativeSelectOption value="">Grup seçin</NativeSelectOption>
            {sortedGroups.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.courseName} · {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </header>
      {groups.error ? (
        <div role="alert" className="p-[45px] text-center">
          <QueryError error={groups.error} onRetry={() => void groups.refetch()} />
        </div>
      ) : groupId === '' ? (
        <p className="p-[45px] text-center text-base text-muted-foreground">
          Belgeye hak kazanan kursiyerleri görmek için grup seçin.
        </p>
      ) : error ? (
        <div role="alert" className="p-[45px] text-center">
          <QueryError
            error={error}
            onRetry={() => {
              void list.refetch()
              void certificates.refetch()
            }}
          />
        </div>
      ) : rows === undefined ? (
        <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
          Liste yükleniyor…
        </p>
      ) : (
        <DataTable
          ref={table}
          listKey="belge-hak-kazananlar"
          rows={rows}
          columns={columns}
          filterKey={groupId}
          searchKeys={ELIGIBLE_SEARCH_KEYS}
          mobileColumns={ELIGIBLE_MOBILE}
          caption="Belgeye hak kazanan kursiyerler"
          empty="Bu grupta onaylı geçti kararı olan kursiyer yok."
        />
      )}
      <IssueCertificateDialog target={issueTarget} onClose={() => setIssueTarget(null)} />
      <MebbisRecordModal target={mebbisTarget} onClose={() => setMebbisTarget(null)} />
    </section>
  )
}

const ELIGIBLE_CSV = [
  { key: 'learner', label: 'Kursiyer' },
  { key: 'certificate', label: 'Kurum başarı belgesi' },
  { key: 'mebbis', label: 'MEBBİS belgesi' },
] as const

/** Öğrenci ve veli: geçerli belgeler (sunucu yalnız geçerli belgeyi ve dar içeriği döndürür). */
function LearnerCertificates({ page }: { page: NavPage }) {
  const { role } = useLanguageAccess()
  const parent = role === 'veli'
  const childId = use(ViewScopeContext)
  const certificates = useAllCourseCertificates(parent ? { studentId: childId } : {}, {
    enabled: !parent || childId !== '',
  })
  const rows = useMemo(
    () =>
      certificates.data
        ? certificateRows(certificates.data).filter((row) => row.statusKey === 'valid')
        : undefined,
    [certificates.data],
  )
  const columns = useMemo<DataColumn<CertificateRow>[]>(
    () => [
      { key: 'course', label: 'Kur' },
      { key: 'level', label: 'Seviye' },
      { key: 'number', label: 'Belge no' },
      { key: 'issued', label: 'Düzenlenme' },
      {
        key: ACTIONS_KEY,
        label: 'Belge',
        cell: (row) => (
          <PdfButton
            type="course-certificate"
            recordId={row.id}
            label="Belgeyi görüntüle"
            ariaLabel={`${row.course} belgesini görüntüle`}
          />
        ),
      },
    ],
    [],
  )
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="belgelerim"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="belgelerim" className="text-lg font-semibold">
            Kurum başarı belgeleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Kurum değerlendirmesine dayanır; resmî Kurs Bitirme Belgesi MEBBİS'te düzenlenir.
          </p>
        </header>
        {parent && childId === '' ? (
          <p className="p-[45px] text-center text-base text-muted-foreground">
            Hesabınıza bağlı öğrenci yok.
          </p>
        ) : certificates.error ? (
          <div role="alert" className="p-[45px] text-center">
            <QueryError error={certificates.error} onRetry={() => void certificates.refetch()} />
          </div>
        ) : rows === undefined ? (
          <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
            Belgeler yükleniyor…
          </p>
        ) : (
          <DataTable
            listKey="basari-belgelerim"
            filterKey={childId}
            rows={rows}
            columns={columns}
            searchKeys={SEARCH_KEYS}
            mobileColumns={LEARNER_MOBILE}
            caption="Kurum başarı belgeleri"
            empty="Henüz kurum başarı belgesi yok. Kur sonunda geçti kararıyla düzenlenir."
          />
        )}
      </section>
    </>
  )
}
