import type {
  MyTeacherFeedbackResults,
  TeacherFeedbackTeacherView,
} from '@kampus/react-shared/use-finance-teacher-feedback.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  teacherFeedbackAverageText,
  teacherFeedbackHiddenText,
  teacherFeedbackTrendDelta,
} from './finance-teacher-feedback-forms.ts'

// Öğretmen geri bildirimi sonuç gösterimi (DOM-FIN-159; ON-213; K-532): yöneticinin anket
// sonucu ve öğretmenin "Geri bildirim sonuçlarım" görünümü aynı parçaları kullanır. Sonuç yalnız
// sunucunun döndürdüğü toplu değerlerdir; gizli sonuçta neden yazılır, yorum gösterilmez.

type ResultView = Pick<
  TeacherFeedbackTeacherView,
  'responses' | 'visible' | 'hiddenReason' | 'average' | 'questions' | 'groups'
>
export type TrendPoint = MyTeacherFeedbackResults['trend'][number]

const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })

/** Bir öğretmenin bir anketteki sonucu. `label` erişilebilir adların önekidir. */
export function TeacherFeedbackResultBody({
  result,
  threshold,
  label,
}: {
  result: ResultView
  threshold: number
  label: string
}) {
  const hidden = teacherFeedbackHiddenText({ ...result, threshold })
  if (hidden !== null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {hidden}
      </p>
    )
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Genel ortalama <strong>{teacherFeedbackAverageText(result.average)}</strong> / 5 ·{' '}
        {String(result.responses)} yanıt
      </p>
      <ol aria-label={`${label} soruları`} className="grid gap-3">
        {result.questions.map((question, index) => (
          <li key={`${String(index)}-${question.text}`} className="grid gap-1 border-b pb-3">
            <span className="font-medium">
              {String(index + 1)}. {question.text}
            </span>
            {question.hidden ? (
              <span className="text-sm text-muted-foreground">
                Bu sorunun sonucu gizli: cevap sayısı anonimlik eşiğinin altında.
              </span>
            ) : question.kind === 'open' ? (
              question.texts.length === 0 ? (
                <span className="text-sm text-muted-foreground">Yorum yok.</span>
              ) : (
                <ul
                  aria-label={`${label} ${String(index + 1)}. soru yorumları`}
                  className="grid gap-1 text-sm"
                >
                  {question.texts.map((text, position) => (
                    <li key={`${String(position)}-${text}`} className="whitespace-pre-line">
                      {text}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div className="grid gap-1 text-sm">
                <span>
                  Ortalama {teacherFeedbackAverageText(question.average)} ·{' '}
                  {String(question.answered ?? 0)} cevap
                </span>
                <table className="w-full max-w-md text-left">
                  <caption className="sr-only">
                    {label} · {question.text} dağılımı
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="font-medium">
                        Puan
                      </th>
                      <th scope="col" className="font-medium">
                        Yanıt
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {question.distribution.map((total, offset) => (
                      <tr key={String(offset + 1)}>
                        <td>{String(offset + 1)}</td>
                        <td>{String(total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ol>
      {result.groups.length > 0 ? (
        <table className="w-full max-w-md text-left text-sm">
          <caption className="text-left font-medium">
            Sınıf kırılımı (eşik altındaki sınıflar birleşir)
          </caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">
                Sınıf
              </th>
              <th scope="col" className="font-medium">
                Yanıt
              </th>
              <th scope="col" className="font-medium">
                Ortalama
              </th>
            </tr>
          </thead>
          <tbody>
            {result.groups.map((group) => (
              <tr key={group.key}>
                <td>{group.name}</td>
                <td>{String(group.responses)}</td>
                <td>{teacherFeedbackAverageText(group.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

/** Dönemler arası eğilim tablosu: genel ortalama ve önceki döneme göre değişim. */
export function TeacherFeedbackTrendTable({
  trend,
  caption,
}: {
  trend: readonly TrendPoint[]
  caption: string
}) {
  if (trend.length === 0)
    return <p className="text-sm text-muted-foreground">Kapanmış dönem sonucu yok.</p>
  return (
    <table className="w-full text-left text-sm">
      <caption className="text-left font-medium">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="font-medium">
            Dönem
          </th>
          <th scope="col" className="font-medium">
            Kapanış
          </th>
          <th scope="col" className="font-medium">
            Yanıt
          </th>
          <th scope="col" className="font-medium">
            Ortalama
          </th>
          <th scope="col" className="font-medium">
            Değişim
          </th>
        </tr>
      </thead>
      <tbody>
        {trend.map((point, index) => (
          <tr key={point.surveyId}>
            <td>{point.term}</td>
            <td>{day(point.closeDate)}</td>
            <td>{String(point.responses)}</td>
            <td>{point.visible ? teacherFeedbackAverageText(point.average) : 'Eşik altında'}</td>
            <td>{teacherFeedbackTrendDelta(trend, index) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
