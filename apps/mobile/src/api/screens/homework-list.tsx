import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import { acceptsLate } from '@kampus/school-core/lib/homework.ts'
import type { HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import { useAllHomework, useHomework } from '@kampus/react-shared/use-homework.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { Badge, Button, Empty, SearchField, Sheet, T } from '../../ui/components.tsx'
import {
  DetailPair,
  EmptyResults,
  ListRow,
  Notice,
  Pagination,
  Section,
} from '../../ui/SchoolLayout.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import {
  dueText,
  fileSummary,
  homeworkView,
  matchesSearch,
  homeworkAudienceView,
  homeworkEmptyText,
  type HomeworkAudience,
  type SubmissionFields,
} from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useListMemory } from '../view-memory.tsx'
import {
  canSubmitHomework,
  submissionAvailability,
  type SubmissionAvailability,
} from '../homework-submission.ts'
import { SubmissionForm } from './homework-submission.tsx'

function Paragraph({ text, empty }: { text: string; empty: string }) {
  return <T size={15}>{text.trim() ? text : empty}</T>
}

/**
 * Ödev ayrıntısı (web "Ödev ayrıntısı" paneli). Tek kayıt ucu kapsamı uygular: kapsam dışı ödev
 * 404 döner ve Türkçe "bulunamadı" görünür. Teslimler okuyanın gördükleridir; öğrencide yalnız
 * kendisininki (DOM-AKD-074). Teslim formu yalnız öğrencide ve teslim açıkken çıkar (veli salt okur).
 */
function HomeworkSheet({
  homeworkId,
  studentId,
  audience,
  onClose,
}: {
  homeworkId: string
  studentId: string
  audience: HomeworkAudience
  onClose: () => void
}) {
  const item = useHomework(homeworkId)
  const homework = item.data?.data
  const submission: HomeworkSubmission | undefined = homework?.submissions.find(
    (entry) => entry.studentId === studentId,
  )
  const now = new Date()
  const view = homework ? homeworkView(homework, homework.submissions, studentId, now) : undefined
  const text = homework && view ? homeworkAudienceView(audience, homework, view.status, now) : null
  const hint = text?.hint ?? null
  const availability = homework ? submissionAvailability(homework, submission, now) : 'closed'
  return (
    <Sheet visible title={view?.title ?? 'Ödev ayrıntısı'} onClose={onClose}>
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !homework || !view ? (
        <ListLoading label="Ödev yükleniyor…" />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Badge text={view.status} />
            {view.late && <Badge text="Geç teslim" />}
          </View>
          <Section title="Bilgiler" panel>
            <View style={{ gap: 12 }}>
              <DetailPair label="Ders" value={homework.subject} />
              <DetailPair label="Son teslim" value={dueText(homework.dueDate)} />
              <DetailPair
                label="Geç teslim"
                value={acceptsLate(homework) ? 'Kabul edilir' : 'Kabul edilmez'}
              />
              <DetailPair
                label="Teslim tarihi"
                value={submission ? dueText(submission.submittedAt) : 'Henüz teslim edilmedi'}
              />
              <DetailPair label="Teslim dosyası" value={fileSummary(submission)} />
              <DetailPair label="Not" value={view.score ?? '—'} />
            </View>
          </Section>
          <Section title="Ödev açıklaması" panel>
            <Paragraph text={homework.description} empty="Açıklama yazılmadı." />
          </Section>
          {!!submission?.feedback && (
            <Section title="Öğretmen geri bildirimi" panel>
              <Paragraph text={submission.feedback} empty="" />
            </Section>
          )}
          {submission && (
            <Section title={text?.submissionTitle ?? ''} panel>
              <Paragraph text={submission.note} empty="Açıklama yazılmadı." />
            </Section>
          )}
          {hint === 'submit' && canSubmitHomework(availability) && (
            <SubmissionPanel
              homeworkId={homework.id}
              submission={submission}
              availability={availability}
            />
          )}
          {audience === 'student' && availability === 'graded' && (
            <Notice
              title="Teslimin değerlendirildi"
              text="Değerlendirilmiş teslim değiştirilemez."
            />
          )}
          {hint === 'closed' && (
            <Notice title="Teslim süresi doldu" text="Bu ödev geç teslime kapalı." tone="amber" />
          )}
        </>
      )}
    </Sheet>
  )
}

/**
 * Teslim bölümü: ilk teslimde form doğrudan açılır; teslim varsa "Teslimi güncelle" düğmesiyle
 * açılır. Başarılı gönderimden sonra form kapanır; güncel teslim sunucu verisinden gelir.
 */
function SubmissionPanel({
  homeworkId,
  submission,
  availability,
}: {
  homeworkId: string
  submission: HomeworkSubmission | undefined
  availability: SubmissionAvailability
}) {
  const [open, setOpen] = useState(submission === undefined)
  if (!open)
    return (
      <Button icon="Upload" label="Teslimi güncelle" onPress={() => setOpen(true)}>
        Teslimi güncelle
      </Button>
    )
  return (
    <SubmissionForm
      homeworkId={homeworkId}
      submission={submission}
      availability={availability}
      onDone={() => setOpen(false)}
    />
  )
}

/**
 * Öğrencinin ödev listesi (arama, sayfa, ayrıntı penceresi). `listKey` liste belleği anahtarıdır
 * (veli için çocuk bazında). Kapsamı sunucu uygular; kapsam dışı ödev 404 döner.
 */
export function HomeworkList({
  student,
  listKey,
  audience,
}: {
  student: { id: string; classId: string }
  listKey: string
  audience: HomeworkAudience
}) {
  const { state, setSearch, setIndex } = useListMemory(listKey)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Sınıfın ödevleri `/homework` ucundan; öğrencinin teslim durumu ve puanı kendi teslim
  // kayıtlarından (web `StudentHomeworkView` ile aynı kaynaklar).
  const homework = useAllHomework({ classId: student.classId })
  const submissions = useCollectionAll<SubmissionFields>('submissions', {
    filters: { studentId: student.id },
  })
  const rows = useMemo(() => {
    if (!homework.data || !submissions.data) return undefined
    const entries = submissions.data.map((row) => row.record)
    const now = new Date()
    return homework.data.map((item) => homeworkView(item, entries, student.id, now))
  }, [homework.data, submissions.data, student.id])
  const visible = useMemo(
    () => rows?.filter((row) => matchesSearch([row.title, row.subject], state.search)),
    [rows, state.search],
  )
  const total = visible?.length
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const page = visible?.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)
  // Ödev listesi düz `useQuery`dir; hata türü tek tutulsun diye `ApiError`'a çevrilir (beklenmeyen
  // hatada teknik ayrıntısız Türkçe genel mesaj).
  const error = homework.error ? toApiError(homework.error) : submissions.error

  return (
    <>
      <SearchField value={state.search} onChange={setSearch} placeholder="Ödev veya ders" />
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            if (homework.error) void homework.refetch()
            if (submissions.error) void submissions.refetch()
          }}
        />
      ) : !page ? (
        <ListLoading label="Ödevler yükleniyor…" />
      ) : page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="ödev" onClear={() => setSearch('')} />
        ) : (
          <Empty title="Henüz ödev yok" text={homeworkEmptyText(audience)} />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {page.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.title}
              subtitle={row.subtitle}
              eyebrow={row.score ?? undefined}
              label={`${row.title}, ${row.status}. Ayrıntıyı aç`}
              onPress={() => setSelectedId(row.id)}
              badge={<Badge text={row.status} />}
            />
          ))}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
      {selectedId && (
        <HomeworkSheet
          key={selectedId}
          homeworkId={selectedId}
          studentId={student.id}
          audience={audience}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
