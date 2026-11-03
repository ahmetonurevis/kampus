import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import { useAllQuizzes, useQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { Badge, Empty, SearchField, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, EmptyResults, ListRow, Pagination, Section } from '../../ui/SchoolLayout.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import {
  quizDetailView,
  quizMatches,
  quizRows,
  QUESTIONS_MISSING_TEXT,
  REVIEW_LOCKED_TEXT,
} from '../parent-learning.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useListMemory } from '../view-memory.tsx'

/**
 * Quiz sonucu ayrıntısı (web "Quiz sonucu" paneli). Tek kayıt ucu kapsamı uygular: kapsam dışı quiz
 * 404 döner ve Türkçe "bulunamadı" görünür. Puan sunucunun cevaplardan hesapladığı sonuçtur;
 * cevap anahtarı ve çözüm veliye gelmez.
 */
function QuizSheet({
  quizId,
  studentId,
  onClose,
}: {
  quizId: string
  studentId: string
  onClose: () => void
}) {
  const item = useQuiz(quizId)
  const quiz = item.data?.data
  const view = quiz ? quizDetailView(quiz, studentId) : undefined
  return (
    <Sheet visible title={view?.title ?? 'Quiz sonucu'} onClose={onClose}>
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !quiz || !view ? (
        <ListLoading label="Quiz yükleniyor…" />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Badge text={view.status} />
          </View>
          <T muted size={14}>
            {view.subtitle}
          </T>
          <DetailPair label="Son tarih" value={view.due} />
          {view.result ? (
            <Section title="Sonuç" panel>
              <View style={{ gap: 12 }}>
                <DetailPair label="Puan" value={view.result.score} />
                <DetailPair label="Doğru / soru" value={view.result.correct} />
                {!!view.result.stamp && (
                  <T muted size={14}>
                    {view.result.stamp}
                  </T>
                )}
                {!!view.result.expiredNote && <T size={14}>{view.result.expiredNote}</T>}
              </View>
            </Section>
          ) : (
            <T muted size={15}>
              {view.note}
            </T>
          )}
          {view.review && (
            <>
              <Section title="Konu bazında başarı" panel>
                {view.review.topics.length === 0 ? (
                  <T muted size={14}>
                    Konu bazında sonuç yok.
                  </T>
                ) : (
                  <View style={{ gap: 12 }}>
                    {view.review.topics.map((topic) => (
                      <DetailPair key={topic.topic} label={topic.topic} value={topic.score} />
                    ))}
                  </View>
                )}
              </Section>
              <Section title="Cevaplar" panel>
                {view.review.answers ? (
                  <View style={{ gap: 12 }} accessibilityRole="list">
                    {view.review.answers.map((answer, index) => (
                      <View key={answer.id} style={{ gap: 4 }}>
                        <T bold size={15}>
                          {index + 1}. {answer.text}
                        </T>
                        <T muted size={14}>
                          {answer.detail}
                        </T>
                      </View>
                    ))}
                  </View>
                ) : (
                  <T muted size={14}>
                    {QUESTIONS_MISSING_TEXT}
                  </T>
                )}
              </Section>
            </>
          )}
          {view.reviewLocked && (
            <T muted size={14}>
              {REVIEW_LOCKED_TEXT}
            </T>
          )}
        </>
      )}
    </Sheet>
  )
}

/**
 * Veli: seçili çocuğun quiz sonuçları (web Akademik Takip "Quiz sonuçları" sekmesi), salt okur.
 * Sınıfın quizleri `/quizzes` ucundan gelir; deneme durumu ve puan yalnız seçili çocuğun
 * denemesinden okunur (iki çocuk aynı sınıfta olabilir). Kapsamı sunucu uygular.
 */
export function ParentQuizzes({ student }: { student: { id: string; classId: string } }) {
  const { state, setSearch, setIndex } = useListMemory(`veli/akademik-takip/quizler/${student.id}`)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const quizzes = useAllQuizzes({ classId: student.classId })
  const visible = useMemo(
    () =>
      quizzes.data
        ? quizRows(quizzes.data, student.id).filter((row) => quizMatches(row, state.search))
        : undefined,
    [quizzes.data, student.id, state.search],
  )
  const total = visible?.length
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const page = visible?.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)

  return (
    <>
      <SearchField value={state.search} onChange={setSearch} placeholder="Quiz veya ders" />
      {quizzes.error ? (
        <QueryError error={toApiError(quizzes.error)} onRetry={() => void quizzes.refetch()} />
      ) : !page ? (
        <ListLoading label="Quizler yükleniyor…" />
      ) : page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="quiz" onClear={() => setSearch('')} />
        ) : (
          <Empty title="Henüz quiz yok" text="Öğretmenler quiz hazırladığında burada görünür." />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {page.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.title}
              subtitle={row.subtitle}
              eyebrow={row.score}
              label={`${row.title}, ${row.status}. Sonucu aç`}
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
        <QuizSheet
          key={selectedId}
          quizId={selectedId}
          studentId={student.id}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
