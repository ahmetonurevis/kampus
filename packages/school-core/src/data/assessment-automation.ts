import type { AnswerKeyQuestion } from '../lib/assessment-automation.ts'

export function createAssessmentAutomation(state: { createdAt: string }) {
  const subjectIds = ['math', 'turkish', 'science'] as const
  const topics = {
    math: 'Denklemler',
    turkish: 'Sözcükte anlam',
    science: 'Hücre ve canlılar',
  }
  const questions: AnswerKeyQuestion[] = subjectIds.flatMap((subjectId, index) =>
    Array.from({ length: 4 }, (_, n) => ({
      number: index * 4 + n + 1,
      subjectId,
      topic: topics[subjectId],
      answer: 'ABCD'.charAt(n),
    })),
  )
  const keys = [
    { booklet: 'A', questions },
    {
      booklet: 'B',
      // B kitapçığı aynı soruları ters sırada içerir.
      questions: [...questions].reverse().map((q, i) => ({ ...q, number: i + 1 })),
    },
  ]
  const keyCsv = [
    'booklet;question;subjectId;topic;answer',
    ...keys.flatMap((k) =>
      k.questions.map((q) => `${k.booklet};${q.number};${q.subjectId};${q.topic};${q.answer}`),
    ),
  ].join('\n')
  return {
    opticalProfiles: [
      {
        id: 'optical-exam-7-1',
        examId: 'exam-7-1',
        title: '7. Sınıf Denemesi · Genel CSV',
        format: 'csv',
        identifier: 'number',
        headerLines: 0,
        studentStart: 1,
        studentLength: 7,
        bookletStart: 8,
        bookletLength: 1,
        answersStart: 9,
        answersLength: 12,
        keyCsv,
        keys,
        revision: 1,
        createdAt: state.createdAt,
        updatedAt: state.createdAt,
      },
    ],
    opticalEvaluations: [],
    tutorSessions: [],
  }
}
