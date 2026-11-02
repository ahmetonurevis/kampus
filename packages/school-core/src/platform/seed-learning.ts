import { questionBank } from '../data/question-bank.ts'
import { subjectById, subjectsForGrade } from '../data/curriculum.ts'
import { gradeQuiz } from '../lib/domain.ts'
import { required, type SeedDate, type SeedStudentRef } from './seed-support.ts'
import type { createStructure } from './seed-structure.ts'

type Structure = ReturnType<typeof createStructure>

/**
 * Örnek öğrenme kayıtları: soru bankası, kazanım testleri ve denemeleri, ödev ve teslimler,
 * "Öğretmenime Sor" soruları, videolar ve materyaller. Üretim sırası ve kimlikler sabittir.
 */
export function createLearning(input: {
  now: Date
  date: SeedDate
  students: SeedStudentRef[]
  classes: Structure['classes']
  assignments: Structure['assignments']
  teachers: Structure['teachers']
  gradeOrder: Structure['gradeOrder']
}) {
  const { now, date, students, classes, assignments, teachers, gradeOrder } = input
  const bank = structuredClone(questionBank)
  const quizzes = assignments
    .filter((a) => !['music', 'art', 'pe', 'religion', 'informatics'].includes(a.subjectId))
    .map((a, i) => {
      const c = required(
        classes.find((c) => c.id === a.classId),
        'sınav sınıfı',
      )
      const subject = required(subjectById(a.subjectId), 'sınav dersi')
      return {
        title: `${subject.name} · ${c.name} kazanım testi`,
        ...a,
        id: `quiz${i + 1}`,
        subject: subject.name,
        questionIds: bank
          .filter(
            (q) => q.subjectId === a.subjectId && c.grade >= q.minGrade && c.grade <= q.maxGrade,
          )
          .map((q) => q.id),
        createdAt: date(-5 - (i % 10)),
        duration: 20,
      }
    })
  const quizAttempts = students.flatMap((student, i) =>
    quizzes
      .filter((q) => q.classId === student.classId)
      .slice(0, 3)
      .map((quiz, n) => {
        const answers = Object.fromEntries(
          quiz.questionIds.map((qid, j) => {
            const q = required(
              bank.find((q) => q.id === qid),
              'sınav sorusu',
            )
            return [qid, j % 5 === i % 5 ? (q.answer + 1) % 4 : q.answer]
          }),
        )
        return {
          id: `attempt-${student.id}-${n}`,
          quizId: quiz.id,
          studentId: student.id,
          answers,
          ...gradeQuiz(quiz, bank, answers),
          date: date(-3 - n),
        }
      }),
  )
  const homework = assignments.map((a, i) => {
    const subject = required(subjectById(a.subjectId), 'ödev dersi')
    return {
      ...a,
      id: `hw${i + 1}`,
      subject: subject.name,
      title: `${subject.name} · ${subject.topics[i % subject.topics.length]} çalışması`,
      description: subject.task,
      dueDate: date(i % 5 === 0 ? -2 : 2 + (i % 6)),
      createdAt: date(-6),
    }
  })
  homework.push({
    ...required(homework[0], 'ödev'),
    id: 'hw-review',
    title: 'Matematik · Denklem çalışma kâğıdı',
    dueDate: date(-7),
    createdAt: date(-14),
  })
  const submissions = students.flatMap((s, i) =>
    homework
      .filter((h) => h.classId === s.classId)
      .filter((_, n) => (i + n) % 3 !== 0)
      // Deniz'in hw-review teslimi aşağıda elle (sub-deniz) tanımlanır; yinelenmesin.
      .filter((h) => !(s.id === 's1' && h.id === 'hw-review'))
      .map((h, n) => ({
        id: `sub-${s.id}-${h.id}`,
        homeworkId: h.id,
        studentId: s.id,
        fileName: `${s.name.split(' ')[0]}-${h.subjectId}.pdf`,
        submittedAt: date(-3),
        score: n % 3 ? 65 + ((i + n) % 35) : null,
        feedback:
          n % 3
            ? `${h.subject} çalışmanda örnekleri doğru ilişkilendirmişsin. Çözüm adımlarını ve kaynaklarını daha açık belirtmeni öneririm.`
            : '',
      })),
  )
  submissions.push({
    id: 'sub-deniz',
    homeworkId: 'hw-review',
    studentId: 's1',
    fileName: 'deniz-denklemler.pdf',
    submittedAt: date(-8),
    score: 88,
    feedback:
      'Denklemin iki tarafına aynı işlemi doğru uygulamışsın. Sonucunu yerine koyarak kontrol etmen çok iyi.',
  })
  const questions = Array.from({ length: 36 }, (_, i) => {
    const s = required(students[i % 6 === 0 ? 0 : i], 'soru soran öğrenci')
    const a = required(assignments.filter((a) => a.classId === s.classId)[i % 6], 'soru dersi')
    const grade = required(
      classes.find((c) => c.id === s.classId),
      'soru sınıfı',
    ).grade
    const q = required(
      bank.find((q) => q.subjectId === a.subjectId && q.minGrade <= grade),
      'soru bankası sorusu',
    )
    return {
      id: `ask${i + 1}`,
      studentId: s.id,
      teacherId: a.teacherId,
      subjectId: a.subjectId,
      title: q.topic + ' hakkında sorum var',
      text: `${q.text} Bu soruda iki seçenek arasında kaldım. Çözümü açıklayabilir misiniz?`,
      createdAt: new Date(
        +now - (i < 12 ? i + 1 : i < 24 ? i + 10 : i + 30) * 3600000,
      ).toISOString(),
      answeredAt: i >= 24 ? new Date(+now - 12 * 3600000).toISOString() : null,
      answer: i >= 24 ? q.explanation : '',
      fileName: i % 3 === 0 ? 'soru-fotografi.jpg' : null,
    }
  })
  const videos = [
    {
      id: 'v1',
      title: 'Denklemleri adım adım çözelim',
      subjectId: 'math',
      subject: 'Matematik',
      level: '7. Sınıf',
      teacherId: 't1',
      duration: 1,
      topic: 'Denklemler',
      color: 'lavender',
      src: '/videos/denklemler.mp4',
      poster: '/videos/denklemler.jpg',
      captions: '/videos/denklemler.vtt',
      description:
        'Terazinin dengesinden yola çıkarak 2x + 6 = 18 denklemini çözüyoruz. Her işlem iki tarafa da uygulanır.',
      transcript: [
        'Denklem, iki ifadenin eşitliğini gösterir. Eşitliği dengede bir terazi gibi düşünebiliriz.',
        '2x + 6 = 18. Önce her iki taraftan 6 çıkarırız: 2x = 12.',
        'İki tarafı da 2’ye böleriz: x = 6.',
        'Kontrol: 2 × 6 + 6 = 18. Bulduğumuz sonuç eşitliği sağlar. Şimdi sen çöz: 3x + 3 = 18.',
      ],
    },
    {
      id: 'v2',
      title: 'Hücreyi keşfedelim: bitki ve hayvan',
      subjectId: 'science',
      subject: 'Fen Bilimleri',
      level: '7. Sınıf',
      teacherId: 't3',
      duration: 2,
      topic: 'Hücre ve canlılar',
      color: 'mint',
      src: '/videos/hucre.mp4',
      poster: '/videos/hucre.jpg',
      captions: '/videos/hucre.vtt',
      description:
        'Hücre zarı, çekirdek ve mitokondrinin görevlerini öğreniyor; bitki ile hayvan hücresini karşılaştırıyoruz.',
      transcript: [
        'Hücre, canlıların temel yapı ve görev birimidir.',
        'Hücre zarı madde alışverişini düzenler. Çekirdek kalıtsal bilgiyi taşır. Mitokondri enerji üretiminde görevlidir.',
        'Bitki hücresinde ayrıca hücre duvarı ve kloroplast bulunur. Kloroplast fotosentezle görevlidir.',
        'Hayvan hücresinde hücre duvarı ve kloroplast bulunmaz. Her iki hücrede de zar, sitoplazma ve çekirdek bulunabilir.',
      ],
    },
  ]
  const videoProgress = [
    { studentId: 's1', videoId: 'v1', progress: 35 },
    { studentId: 's1', videoId: 'v2', progress: 0 },
    { studentId: 's2', videoId: 'v1', progress: 100 },
  ]
  const materials = gradeOrder.flatMap((grade) =>
    subjectsForGrade(grade).map((subject, i) => ({
      id: `mat-${grade}-${subject.id}`,
      title: `${subject.name} · ${subject.topics[grade % subject.topics.length]}`,
      fileName: `${subject.id}-${grade}-calisma.pdf`,
      subjectId: subject.id,
      subject: subject.name,
      level: `${grade}. Sınıf`,
      teacherId: required(
        teachers.find((t) => t.branchId === 'b1' && t.subjectId === subject.id),
        'materyal öğretmeni',
      ).id,
      size: 'PDF',
      createdAt: date(-i),
      type: 'Doküman',
      content: [
        subject.lesson,
        'Uygulama çalışması',
        subject.task,
        'Öz değerlendirme: Öğrendiklerini kendi cümlelerinle özetle. Zorlandığın noktaları öğretmeninle paylaş.',
      ],
    })),
  )
  return {
    bank,
    quizzes,
    quizAttempts,
    homework,
    submissions,
    questions,
    videos,
    videoProgress,
    materials,
  }
}

/** Her kazanım testi denemesi bir not satırıdır (`seed.ts` bunları not listesine ekler). */
export function quizGrades(
  quizAttempts: ReturnType<typeof createLearning>['quizAttempts'],
  quizzes: ReturnType<typeof createLearning>['quizzes'],
) {
  return quizAttempts.map((attempt) => {
    const quiz = required(
      quizzes.find((q) => q.id === attempt.quizId),
      'sınav',
    )
    return {
      id: `g-${attempt.id}`,
      studentId: attempt.studentId,
      subjectId: quiz.subjectId,
      subject: quiz.subject,
      title: quiz.title,
      topic: 'Kazanım testi',
      score: attempt.score,
      date: attempt.date,
    }
  })
}
