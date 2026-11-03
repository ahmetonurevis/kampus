import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLearnerAssignments } from '@kampus/react-shared/use-learner-task-progress.ts'
import { useTaskSubmission } from '@kampus/react-shared/use-task-submissions.ts'
import { Badge, Empty, SearchField, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, EmptyResults, ListRow, Pagination, Section } from '../../ui/SchoolLayout.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import {
  childSkillAssignments,
  skillFacts,
  skillMatches,
  skillResultSource,
  skillRows,
  submissionVersions,
  type SkillAssignmentFields,
} from '../parent-learning.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useListMemory } from '../view-memory.tsx'

/** Teslim sürümleri: puan ve geri bildirim yalnız sunucu kesinleştirdiyse (DOM-BEC-045). */
function SubmissionVersions({ submissionId }: { submissionId: string }) {
  const detail = useTaskSubmission(submissionId)
  const submission = detail.data?.data
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!submission) return <ListLoading label="Teslim yükleniyor…" />
  const versions = submissionVersions(submission.versions)
  if (versions.length === 0) return null
  return (
    <Section title="Gönderilen sürümler" panel>
      <View style={{ gap: 14 }} accessibilityRole="list">
        {versions.map((version) => (
          <View key={version.id} style={{ gap: 6 }}>
            <T bold size={15}>
              {version.title}
              {version.late ? ' · Geç teslim' : ''}
            </T>
            <T muted size={13}>
              {version.stamp}
            </T>
            {!!version.score && <Badge text={version.score} />}
            {!!version.body && <T size={14}>{version.body}</T>}
            {!!version.comment && <T size={14}>Öğretmen geri bildirimi: {version.comment}</T>}
            {version.criteria.map((criterion) => (
              <T key={criterion} muted size={14}>
                {criterion}
              </T>
            ))}
          </View>
        ))}
      </View>
    </Section>
  )
}

function SkillSheet({
  assignment,
  childId,
  onClose,
}: {
  assignment: SkillAssignmentFields
  childId: string
  onClose: () => void
}) {
  const now = new Date()
  const source = skillResultSource(
    assignment,
    assignment.progress.find((entry) => entry.learnerId === childId),
  )
  return (
    <Sheet visible title={assignment.title} onClose={onClose}>
      <Section title="Bilgiler" panel>
        <View style={{ gap: 12 }}>
          {skillFacts(assignment, childId, now).map((fact) => (
            <DetailPair key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </View>
      </Section>
      {source.kind === 'submission' && <SubmissionVersions submissionId={source.submissionId} />}
    </Sheet>
  )
}

/**
 * Veli: seçili çocuğun beceri görevleri (web "Beceri görevleri" sekmesi, `ParentTaskSection`),
 * salt okur. Atama listesi velide her çocuğun durum özetini taşır (`learnerIds`, `progress`);
 * seçili çocuğa daraltma bu alanlarla yapılır, kapsamı sunucu uygular. Başlatma, çözme, teslim ve
 * itiraz yoktur. Otomatik puanlı görevde deneme ayrıntısı telefonda gösterilmez (puan özetten gelir).
 */
export function ParentSkillTasks({ childId }: { childId: string }) {
  const { state, setSearch, setIndex } = useListMemory(`veli/akademik-takip/gorevler/${childId}`)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const assignments = useLearnerAssignments()
  const items = useMemo(
    () =>
      childSkillAssignments(
        assignments.items.filter(
          (item): item is Extract<typeof item, { view: 'learner' }> => item.view === 'learner',
        ),
        childId,
      ),
    [assignments.items, childId],
  )
  const visible = useMemo(
    () =>
      assignments.isReady
        ? skillRows(items, childId, new Date()).filter((row) => skillMatches(row, state.search))
        : undefined,
    [assignments.isReady, items, childId, state.search],
  )
  const total = visible?.length
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const page = visible?.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)
  const selected = items.find((item) => item.id === selectedId)
  const incomplete = assignments.isLoadingMore || assignments.truncated

  return (
    <>
      <SearchField value={state.search} onChange={setSearch} placeholder="Görev veya tür" />
      {assignments.error && !assignments.isReady ? (
        <QueryError error={assignments.error} onRetry={() => void assignments.refetch()} />
      ) : !page || (page.length === 0 && assignments.isLoadingMore) ? (
        <ListLoading label="Görevler yükleniyor…" />
      ) : page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="görev" onClear={() => setSearch('')} />
        ) : (
          <Empty
            title="Atanmış görev yok"
            text="Öğretmenler beceri görevi atadığında burada görünür."
          />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {page.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.title}
              subtitle={row.subtitle}
              eyebrow={row.score !== '—' ? `Puan ${row.score}` : undefined}
              label={`${row.title}, ${row.status}. Ayrıntıyı aç`}
              onPress={() => setSelectedId(row.id)}
              badge={<Badge text={row.status} />}
            />
          ))}
        </View>
      )}
      {assignments.truncated && (
        <T muted size={13} accessibilityRole="alert">
          Bütün görevler yüklenemedi; liste eksik olabilir.
        </T>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
      {selectedId &&
        (selected ? (
          <SkillSheet
            key={selectedId}
            assignment={selected}
            childId={childId}
            onClose={() => setSelectedId(null)}
          />
        ) : !incomplete ? (
          <Sheet visible title="Görev ayrıntısı" onClose={() => setSelectedId(null)}>
            <T muted size={15}>
              Görev bulunamadı. Bu çocuğa atanmamış ya da kaldırılmış olabilir.
            </T>
          </Sheet>
        ) : null)}
    </>
  )
}
