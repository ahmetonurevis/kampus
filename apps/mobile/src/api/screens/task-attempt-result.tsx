import { View } from 'react-native'
import type { TaskAttemptDetail } from '@kampus/react-shared/use-task-attempts.ts'
import { Badge, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import { attemptResultView } from '../student-quiz-task.ts'

/**
 * Deneme sonucu (DOM-BEC-045): puan, madde sonucu ve doğru cevap yalnız sunucu açtıysa çizilir;
 * açılmayan alan için ipucu da yoktur. İstemci puan hesaplamaz (`attemptResultView`).
 */
export function TaskAttemptResult({ attempt }: { attempt: TaskAttemptDetail }) {
  const view = attemptResultView(attempt)
  return (
    <Section title={view.heading} panel>
      {!!view.note && <Notice tone="amber" title="İçerik gösterilemiyor" text={view.note} />}
      {view.score && (
        <View style={{ gap: 12 }}>
          <DetailPair label="Puan" value={view.score.percent} />
          <DetailPair label="Toplam" value={view.score.points} />
        </View>
      )}
      {view.items && (
        <View style={{ gap: 14 }} accessibilityRole="list">
          {view.items.map((row) => (
            <View
              key={row.questionVersionId}
              accessible
              accessibilityLabel={[
                `Soru ${row.number}, ${row.outcome}, ${row.points}`,
                `Cevabın: ${row.answer}`,
                row.key ? `Doğru cevap: ${row.key}` : null,
                row.explanation,
              ]
                .filter(Boolean)
                .join('. ')}
              style={{ gap: 4 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T bold size={14}>
                  Soru {row.number}
                </T>
                <Badge text={row.outcome} tone={row.tone} />
                <T muted size={13}>
                  {row.points}
                </T>
              </View>
              <T size={14}>Cevabın: {row.answer}</T>
              {!!row.key && <T size={14}>Doğru cevap: {row.key}</T>}
              {!!row.explanation && (
                <T muted size={13}>
                  {row.explanation}
                </T>
              )}
            </View>
          ))}
        </View>
      )}
    </Section>
  )
}
