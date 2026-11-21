import { useId, useMemo } from 'react'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { ScoreBars } from './AnalysisParts.tsx'
import { percentText, questionRows, type QuestionRow } from './exam-analysis-model.ts'

type Evaluation = CoreRecord<'opticalEvaluations'>

const MOBILE_COLUMNS = ['number', 'answer', 'outcome']
const OUTCOME_TONES = { Doğru: 'green', Yanlış: 'red' } as const

type Props = {
  examId: string
  examTitle: string
  /** Yalnız güncel analizler (anahtar ve deneme sonucu değişmemiş); boşsa boş durum çizilir. */
  evaluations: readonly Evaluation[]
  onClose: () => void
}

/**
 * Seçili denemenin optik soru analizi: ders başına net ve kazanım başarısı, soru başına öğrencinin
 * işareti ve doğru cevap. Doğru cevaplar öğrencinin kendi analizinde görünür (deneme sonrası sonuç
 * bildirimi, DOM-AKD-063); sınavın cevap anahtarı ve başkasının analizi sunucudan hiç gelmez.
 */
export function OpticalAnalysis({ examId, examTitle, evaluations, onClose }: Props) {
  const headingId = useId()
  const subjects = useCoreAll('subjects')
  const names = useMemo(
    () => new Map((subjects.data ?? []).map((row) => [row.record.id, row.record.name])),
    [subjects.data],
  )
  const nameOf = (subjectId: string) => names.get(subjectId) ?? subjectId
  const rows = useMemo(
    () =>
      evaluations.flatMap((item) =>
        questionRows(item, names.get(item.subjectId) ?? item.subjectId),
      ),
    [evaluations, names],
  )
  const columns = useMemo<DataColumn<QuestionRow>[]>(
    () => [
      { key: 'subject', label: 'Ders' },
      { key: 'number', label: 'Soru' },
      { key: 'topic', label: 'Kazanım' },
      { key: 'response', label: 'Cevabın' },
      { key: 'answer', label: 'Doğru cevap' },
      {
        key: 'outcome',
        label: 'Sonuç',
        cell: (row) => (
          <StatusBadge
            text={row.outcome}
            tone={OUTCOME_TONES[row.outcome as keyof typeof OUTCOME_TONES] ?? 'gray'}
          />
        ),
      },
    ],
    [],
  )

  return (
    <section
      aria-labelledby={headingId}
      className="panel mb-[var(--space-section)] min-w-0 rounded-card border bg-surface"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold [overflow-wrap:anywhere]">
            Soru analizi · {examTitle}
          </h2>
          <p className="text-sm text-muted-foreground">
            Ders başına net, kazanım başarısı ve soru sonuçları
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          <Icon name="X" size={15} aria-hidden="true" />
          Analizi kapat
        </Button>
      </header>
      {evaluations.length === 0 ? (
        <p className="empty-inline px-5 py-6 text-sm text-muted-foreground">
          Bu deneme için optik soru analizi yok. Okuyucu dosyası değerlendirildiğinde ders ve
          kazanım kırılımı burada görünür.
        </p>
      ) : (
        <div className="grid gap-6 p-5" data-exam={examId}>
          <div className="grid gap-4 lg:grid-cols-2">
            {evaluations.map((item) => (
              <article
                key={item.id}
                aria-label={`${nameOf(item.subjectId)} analizi`}
                className="min-w-0 rounded-card border p-4"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-md font-semibold">{nameOf(item.subjectId)}</h3>
                  <span className="text-sm text-muted-foreground">Kitapçık {item.booklet}</span>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Net <strong className="text-foreground">{item.net}</strong> · {item.correct} doğru
                  · {item.wrong} yanlış · {item.blank} boş
                </p>
                {item.topicScores.some((topic) => topic.percent !== null) ? (
                  <ScoreBars
                    label={`${nameOf(item.subjectId)} kazanım başarısı`}
                    items={item.topicScores.flatMap((topic) =>
                      topic.percent === null
                        ? []
                        : [
                            {
                              key: topic.topic,
                              name: topic.topic,
                              score: topic.percent,
                              text: `${percentText(topic.percent)} · ${topic.correct}/${topic.total}`,
                            },
                          ],
                    )}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Kazanım sonucu yok.</p>
                )}
              </article>
            ))}
          </div>
          <div className="min-w-0 overflow-hidden rounded-card border">
            <DataTable
              listKey="soru-analizi"
              rows={rows}
              columns={columns}
              mobileColumns={MOBILE_COLUMNS}
              caption="Soru bazında sonuçlar"
              searchKeys={['topic', 'subject']}
              pageSize={10}
              empty="Soru sonucu yok."
            />
          </div>
        </div>
      )}
    </section>
  )
}
