import { useMemo, useState } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TableSection } from '../academic/AcademicParts.tsx'
import { AskQuestionPanel, NEW_QUESTION } from './AskQuestionPanel.tsx'
import { TableGate } from './LearningParts.tsx'
import { QuestionPanel, type QuestionAudience } from './QuestionPanel.tsx'
import {
  OVERDUE_LABEL,
  SLA_FILTERS,
  matchesSla,
  orderQuestions,
  questionLookups,
  questionRow,
  questionStamp,
  type QuestionRow,
  type SlaFilter,
} from './question-rows.ts'

const NONE: readonly never[] = []
const STATE_TONES = {
  pending: 'amber',
  answered: 'green',
  withdrawn: 'gray',
} as const satisfies Record<QuestionRow['state'], BadgeTone>

const SLA_LABELS = Object.fromEntries(SLA_FILTERS.map((item) => [item.value, item.label]))

const STUDENT_MOBILE = ['subject', 'status']
const TEACHER_MOBILE = ['student', 'status']
const STUDENT_SEARCH = ['title', 'text', 'subject', 'teacher', 'topic', 'answer']
const TEACHER_SEARCH = ['title', 'text', 'subject', 'student', 'topic']

/**
 * Öğretmenime Sor (öğrenci) ve Soru Kuyruğu (öğretmen), Vue `Learning.vue`: kapsamı sunucu
 * uygular (öğrenci kendi, öğretmen kendisine atanan soruları okur; DOM-ILT-093). Durum ve yanıt
 * süresi kayıttan hesaplanır, saklanmaz. Liste küçüktür: arama, durum/ders filtresi, yanıt süresi
 * süzgeci ("Süresi aşılmış", "Süresi yaklaşan") ve sayfalama tarayıcıdadır; liste durumu korunur
 * ve süzgeç değişince sayfa başa döner (`filterKey`). Satırdan sağ panelde ayrıntı açılır (`?soru=<kimlik>`);
 * öğrenci "Yeni soru"yu sağ panelde açar (`?soru-form=yeni`).
 */
export function QuestionsPage({ page, audience }: { page: NavPage; audience: QuestionAudience }) {
  useDocumentTitle(page.title)
  const student = audience === 'student'
  const questions = useCoreAll('questions')
  const subjects = useCoreAll('subjects')
  const teachers = useCoreAll('teachers')
  const now = useMinuteClock()
  const panel = useDetailPanel('soru')
  const form = useDetailPanel('soru-form')
  const openQuestion = panel.open
  const [sla, setSla] = useState<SlaFilter>('all')

  const lookups = useMemo(
    () =>
      subjects.data && teachers.data ? questionLookups(subjects.data, teachers.data) : undefined,
    [subjects.data, teachers.data],
  )
  const rows = useMemo(
    () =>
      questions.data && lookups
        ? orderQuestions(
            questions.data.map((item) => questionRow(item, lookups, now)),
            audience,
          )
        : undefined,
    [questions.data, lookups, now, audience],
  )

  const visibleRows = useMemo(() => rows?.filter((row) => matchesSla(row, sla)), [rows, sla])

  const columns = useMemo<DataColumn<QuestionRow>[]>(() => {
    const title: DataColumn<QuestionRow> = {
      key: 'title',
      label: 'Konu',
      cell: (row) => (
        <button
          type="button"
          onClick={() => openQuestion(row.id)}
          aria-label={`${row.title} sorusunu aç`}
          className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
        >
          {row.title}
        </button>
      ),
    }
    const status: DataColumn<QuestionRow> = {
      key: 'status',
      label: 'Durum',
      cell: (row) => <StatusBadge text={row.status} tone={STATE_TONES[row.state]} />,
    }
    const created: DataColumn<QuestionRow> = {
      key: 'createdAt',
      label: 'Tarih',
      cell: (row) => dateLabel(row.createdAt, { year: 'numeric' }),
    }
    if (student)
      return [
        title,
        { key: 'subject', label: 'Ders' },
        { key: 'teacher', label: 'Öğretmen' },
        status,
        created,
        {
          key: 'answer',
          label: 'Yanıt',
          cell: (row) => (
            <span className="block max-w-[260px] truncate" title={row.answer || undefined}>
              {row.answer || '—'}
            </span>
          ),
        },
      ]
    return [
      title,
      {
        key: 'student',
        label: 'Öğrenci',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.student} size="small" />
            {row.student || '—'}
          </span>
        ),
      },
      { key: 'subject', label: 'Ders' },
      status,
      {
        // Anahtar sıralama değeridir (kalan dakika); metin `cell`'den gelir.
        key: 'remainingMinutes',
        label: 'Yanıt süresi',
        cell: (row) =>
          row.overdue ? (
            <StatusBadge text={OVERDUE_LABEL} tone="red" />
          ) : (
            <span title={row.state === 'pending' ? undefined : questionStamp(row.createdAt)}>
              {row.response}
            </span>
          ),
      },
      created,
    ]
  }, [student, openQuestion])

  const error = questions.error ?? subjects.error ?? teachers.error
  const retry = () => {
    for (const query of [questions, subjects, teachers]) if (query.error) void query.refetch()
  }
  const tableName = student ? 'Sorularım' : 'Gelen sorular'
  const pending = rows?.filter((row) => row.state === 'pending').length ?? 0
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          student ? (
            <Button onClick={() => form.open(NEW_QUESTION)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Yeni soru
            </Button>
          ) : undefined
        }
      />
      <TableSection
        title={tableName}
        subtitle={`${rows?.length ?? 0} soru · ${pending} yanıt bekliyor`}
      >
        <TableGate error={error} onRetry={retry} loading={rows === undefined}>
          <DataTable
            listKey={student ? 'sorularim' : 'soru-kuyrugu'}
            rows={visibleRows ?? NONE}
            columns={columns}
            mobileColumns={student ? STUDENT_MOBILE : TEACHER_MOBILE}
            caption={tableName}
            searchKeys={student ? STUDENT_SEARCH : TEACHER_SEARCH}
            empty={student ? 'Henüz soru sormadınız.' : 'Size atanmış soru yok.'}
            onRowClick={(row) => openQuestion(row.id)}
            filterKey={sla}
            externalActive={sla !== 'all'}
            externalLabel={`Yanıt süresi: ${SLA_LABELS[sla]}`}
            onReset={() => setSla('all')}
            toolbar={
              <NativeSelect
                aria-label="Yanıt süresi durumu"
                value={sla}
                onChange={(event) =>
                  setSla(
                    SLA_FILTERS.find((item) => item.value === event.target.value)?.value ?? 'all',
                  )
                }
                className="min-h-9 text-sm"
              >
                {SLA_FILTERS.map((item) => (
                  <NativeSelectOption key={item.value} value={item.value}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            }
          />
        </TableGate>
      </TableSection>
      <QuestionPanel
        questionId={panel.selectedId}
        onClose={panel.close}
        audience={audience}
        lookups={lookups}
      />
      {student ? (
        <AskQuestionPanel open={form.selectedId === NEW_QUESTION} onClose={form.close} />
      ) : null}
    </>
  )
}
