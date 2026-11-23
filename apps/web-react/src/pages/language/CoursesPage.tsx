import { useMemo, useRef, useState } from 'react'
import type { Course } from '@kampus/react-shared/courses.ts'
import { useActivateCourse, useAllCourses, useCourse } from '@kampus/react-shared/use-courses.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { exportCsv } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { CourseArchiveDialog, EOzelModal } from './CourseDialogs.tsx'
import { CourseFormModal, NEW_COURSE } from './CourseFormModal.tsx'
import { activationBlocked } from './course-forms.ts'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from './fresh-submit.ts'
import {
  canCreateCourse,
  COURSE_CSV_COLUMNS,
  COURSE_FILTERS,
  courseActions,
  courseCsvRow,
  courseFormTarget,
  courseRows,
  courseStatusTone,
  type CourseRow,
} from './course-rows.ts'
import { useLanguageAccess } from './use-language-access.ts'

const MOBILE_COLUMNS = ['level', 'status', 'hours']

/**
 * Kurlar (dil okulu; IST-076, DOM-DIL-005…007): kurumun kur programı. Kurum başına kur sayısı az
 * olduğu için bütün kurlar (arşiv dahil) bir kez çekilir; arama, durum/seviye/dil süzgeci, sıralama
 * ve sayfa istemcide, CSV süzülmüş bütün sonucu içerir. Satır sağ panelde özet açar (`?kur=`).
 * Yönetici her seviyede, öğretmen yalnız akademik koordinatörü olduğu seviyede kur tanımlar,
 * düzenler, etkinleştirir ve arşivler; e-Özel kaydını yalnız yönetici işaretler. Ön büro okur.
 */
export function CoursesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const access = useLanguageAccess()
  const courses = useAllCourses()
  const rows = useMemo(() => (courses.data ? courseRows(courses.data) : undefined), [courses.data])
  const panel = useDetailPanel('kur')
  const formPanel = useDetailPanel('kur-form')
  const openCourse = panel.open
  const openForm = formPanel.open
  const table = useRef<DataTableHandle<CourseRow>>(null)
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null)
  const [eOzelTarget, setEOzelTarget] = useState<Course | null>(null)
  const canCreate = canCreateCourse(access.role, access.levels)
  const { role, levels } = access

  const columns = useMemo<DataColumn<CourseRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Kur',
        cell: (row) => (
          <span className="grid">
            <button
              type="button"
              onClick={() => openCourse(row.id)}
              className="record-link text-left font-medium text-primary hover:underline"
            >
              {row.name}
            </button>
            <small className="text-xs text-muted-foreground">{row.language}</small>
          </span>
        ),
      },
      { key: 'level', label: 'Seviye' },
      { key: 'language', label: 'Dil' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={courseStatusTone(row.statusKey)} />,
      },
      { key: 'hours', label: 'Ders saati' },
      { key: 'learners', label: 'Mevcut' },
      { key: 'certified', label: 'Belge' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.name} özeti`}
              onClick={() => openCourse(row.id)}
            >
              <Icon name="Eye" size={15} aria-hidden="true" />
              Özet
            </Button>
            {courseActions(row.course, role, levels).edit ? (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`${row.name} düzenle`}
                onClick={() => openForm(row.id)}
              >
                <Icon name="Pencil" size={15} aria-hidden="true" />
                Düzenle
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [openCourse, openForm, role, levels],
  )

  function download() {
    const all = table.current?.filteredRows() ?? rows ?? []
    exportCsv(page.title, COURSE_CSV_COLUMNS, all.map(courseCsvRow))
  }

  const selected = courses.data?.find((course) => course.id === panel.selectedId)
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <>
            <Button variant="secondary" onClick={download} disabled={rows === undefined}>
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
            {canCreate ? (
              <Button onClick={() => openForm(NEW_COURSE)}>
                <Icon name="Plus" size={17} aria-hidden="true" />
                Kur tanımla
              </Button>
            ) : null}
          </>
        }
      />
      <section
        aria-labelledby="kur-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="kur-tablosu" className="text-lg font-semibold">
            Kur programı
          </h2>
          <p className="text-sm text-muted-foreground">
            {rows?.length ?? 0} kur · seviye sırasıyla
          </p>
        </header>
        {courses.error ? (
          <div role="alert" className="p-[45px] text-center">
            <QueryError error={courses.error} onRetry={() => void courses.refetch()} />
          </div>
        ) : rows === undefined ? (
          <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
            Kurlar yükleniyor…
          </p>
        ) : (
          <DataTable
            ref={table}
            listKey="kurlar"
            rows={rows}
            columns={columns}
            filters={COURSE_FILTERS}
            mobileColumns={MOBILE_COLUMNS}
            caption="Kurlar"
            empty="Henüz kur tanımlanmadı."
            onRowClick={(row) => openCourse(row.id)}
          />
        )}
      </section>
      <CourseSummaryPanel
        open={panel.selectedId !== ''}
        course={selected}
        loading={courses.isPending}
        onClose={panel.close}
        onEdit={openForm}
        onArchive={setArchiveTarget}
        onEOzel={setEOzelTarget}
      />
      <CourseFormModal
        target={courseFormTarget(formPanel.selectedId, role, levels)}
        levels={role === 'yonetici' ? null : levels}
        onClose={formPanel.close}
      />
      <CourseArchiveDialog course={archiveTarget} onClose={() => setArchiveTarget(null)} />
      <EOzelModal course={eOzelTarget} onClose={() => setEOzelTarget(null)} />
    </>
  )
}

function CourseSummaryPanel({
  open,
  course,
  loading,
  onClose,
  onEdit,
  onArchive,
  onEOzel,
}: {
  open: boolean
  course: Course | undefined
  loading: boolean
  onClose: () => void
  onEdit: (id: string) => void
  onArchive: (course: Course) => void
  onEOzel: (course: Course) => void
}) {
  const access = useLanguageAccess()
  const activate = useActivateCourse()
  const item = useCourse(course?.id ?? '')
  const row = course ? courseRows([course])[0] : undefined
  const actions = course ? courseActions(course, access.role, access.levels) : null
  const blocked = course ? activationBlocked(course) : null

  async function activateCourse() {
    if (!course) return
    // Liste kopyası bayat olabilir: sürüm gönderimde kimlikle yeniden okunur.
    const result = await submitWithFreshRecord(
      async () => (await item.refetch()).data?.data,
      (fresh) => activate.submit({ courseId: fresh.id, version: fresh.rowVersion ?? 0 }),
    )
    if (result.status === 'missing') notify.error(RECORD_UNAVAILABLE_MESSAGE)
    else if (result.outcome.status === 'success') notify.success(`${course.name} etkinleştirildi.`)
  }

  const footer =
    course && actions && (actions.edit || actions.activate || actions.archive || actions.eOzel) ? (
      <div className="flex w-full flex-wrap gap-2">
        {actions.activate ? (
          <Button
            onClick={() => void activateCourse()}
            disabled={activate.isPending || blocked !== null}
            aria-busy={activate.isPending || undefined}
            {...(blocked ? { 'aria-describedby': 'kur-etkinlestirme-engeli' } : {})}
          >
            <Icon name="Play" size={17} aria-hidden="true" />
            Etkinleştir
          </Button>
        ) : null}
        {actions.edit ? (
          <Button variant="secondary" onClick={() => onEdit(course.id)}>
            <Icon name="Pencil" size={17} aria-hidden="true" />
            Düzenle
          </Button>
        ) : null}
        {actions.eOzel ? (
          <Button variant="secondary" aria-haspopup="dialog" onClick={() => onEOzel(course)}>
            <Icon name="ShieldCheck" size={17} aria-hidden="true" />
            e-Özel kaydı
          </Button>
        ) : null}
        {actions.archive ? (
          <Button variant="ghost" aria-haspopup="dialog" onClick={() => onArchive(course)}>
            <Icon name="Archive" size={17} aria-hidden="true" />
            Arşivle
          </Button>
        ) : null}
      </div>
    ) : undefined

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Kur özeti"
      {...(footer ? { footer } : {})}
    >
      {!course || !row ? (
        <p role="status" className="text-sm text-muted-foreground">
          {loading ? 'Özet yükleniyor…' : 'Kur bulunamadı.'}
        </p>
      ) : (
        <>
          <SummaryHeader
            icon={<SummaryIcon name="Languages" />}
            title={course.name}
            subtitle={`${row.language} · ${row.level}`}
            status={row.status}
            tone={courseStatusTone(row.statusKey)}
          />
          <SummaryMetrics
            items={[
              { label: 'Toplam ders saati', value: `${course.totalHours} saat` },
              { label: 'Haftalık', value: `${course.weeklyHours} saat` },
              { label: 'Süre', value: `${course.durationWeeks} hafta` },
              { label: 'Ders süresi', value: row.session },
              { label: 'Mevcut', value: row.learners },
              { label: 'Belge', value: row.certified },
            ]}
          />
          {blocked && actions?.activate ? (
            <p id="kur-etkinlestirme-engeli" className="mb-6 text-sm text-warning">
              {blocked}
            </p>
          ) : null}
          {course.eOzel ? (
            <SummarySection title="e-Özel kaydı">
              <SummaryList
                empty=""
                items={[
                  { key: 'durum', label: 'Onay durumu', value: row.eOzel },
                  {
                    key: 'kod',
                    label: 'Program kodu',
                    value: course.eOzel.programCode ?? '—',
                  },
                  {
                    key: 'an',
                    label: 'Son işaretleme',
                    value: dateLabel(course.eOzel.recordedAt, { year: 'numeric' }),
                  },
                ]}
              />
            </SummarySection>
          ) : null}
          {course.description ? (
            <SummarySection title="Açıklama">
              <p className="text-sm [overflow-wrap:anywhere]">{course.description}</p>
            </SummarySection>
          ) : null}
        </>
      )}
    </SidePanel>
  )
}
