import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { acceptsLate } from '@kampus/school-core/lib/homework.ts'
import type { HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import { useAllHomework, useHomework } from '@kampus/react-shared/use-homework.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, SearchField, Sheet, T } from '../../ui/components.tsx'
import {
  DetailPair,
  EmptyResults,
  ListRow,
  Notice,
  Pagination,
  Screen,
  Section,
} from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import {
  dueText,
  fileSummary,
  homeworkView,
  matchesSearch,
  submissionHint,
  type SubmissionFields,
} from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useListMemory } from '../view-memory.tsx'

type StudentRecord = State['students'][number]

const LIST_KEY = 'ogrenci/odevler'

function Paragraph({ text, empty }: { text: string; empty: string }) {
  return <T size={15}>{text.trim() ? text : empty}</T>
}

/**
 * Ödev ayrıntısı (web "Ödev ayrıntısı" paneli). Tek kayıt ucu kapsamı uygular: kapsam dışı ödev
 * 404 döner ve Türkçe "bulunamadı" görünür. Teslimler okuyanın gördükleridir; öğrencide yalnız
 * kendisininki (DOM-AKD-074). Teslim formu telefonda yoktur, salt okunur.
 */
function HomeworkSheet({
  homeworkId,
  studentId,
  onClose,
}: {
  homeworkId: string
  studentId: string
  onClose: () => void
}) {
  const item = useHomework(homeworkId)
  const homework = item.data?.data
  const submission: HomeworkSubmission | undefined = homework?.submissions.find(
    (entry) => entry.studentId === studentId,
  )
  const now = new Date()
  const view = homework ? homeworkView(homework, homework.submissions, studentId, now) : undefined
  const hint = homework && view ? submissionHint(homework, view.status, now) : null
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
            <Section title="Teslimin" panel>
              <Paragraph text={submission.note} empty="Açıklama yazılmadı." />
            </Section>
          )}
          {hint === 'web' && (
            <Notice
              title="Teslim web'de"
              text="Ödevini şimdilik Kampüs web uygulamasından teslim edebilirsin."
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

function HomeworkList({ student }: { student: StudentRecord }) {
  const { state, setSearch, setIndex } = useListMemory(LIST_KEY)
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
          <Empty title="Henüz ödev yok" text="Öğretmenlerin ödev verdiğinde burada görünür." />
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
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}

/**
 * Öğrenci: ödevlerim (web `ogrenci/odevler` sınıf ödevleri bölümü). Öğrenci kaydı kapsamdan gelir
 * (öğrencide tek kayıt döner); ödevler öğrencinin sınıfından istenir, sunucu yine yalnız kendi
 * sınıfının ödevlerini döndürür (DOM-AKD-074). Durum ve puan salt okunur; teslim web'dedir.
 */
export default function StudentHomework() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentHomework')
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const student = students.data?.[0]?.record

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Ödevlerin, son tarihleri ve değerlendirmeleri.</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Öğrenci bilgileri yükleniyor…" />
      ) : !student ? (
        <Empty title="Öğrenci kaydı bulunamadı" text="Hesabına bağlı öğrenci kaydı görünmüyor." />
      ) : !student.classId ? (
        <Empty title="Sınıf atanmamış" text="Sınıfın atandığında ödevlerin burada görünür." />
      ) : (
        <HomeworkList student={student} />
      )}
    </Screen>
  )
}
