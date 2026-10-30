export function createAssessmentAutomation(state: { createdAt: string }) {
  const subjectIds = ['math', 'turkish', 'science']
  const topics: Record<string, string> = {
    math: 'Denklemler',
    turkish: 'Sözcükte anlam',
    science: 'Hücre ve canlılar',
  }
  const questions = subjectIds.flatMap((subjectId, index) =>
    Array.from({ length: 4 }, (_, n) => ({
      number: index * 4 + n + 1,
      subjectId,
      topic: topics[subjectId],
      answer: ['A', 'B', 'C', 'D'][n],
    })),
  )
  const keys = [
    { booklet: 'A', questions },
    {
      booklet: 'B',
      questions: questions.map((q, i) => ({
        ...questions[questions.length - i - 1],
        number: i + 1,
      })),
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
