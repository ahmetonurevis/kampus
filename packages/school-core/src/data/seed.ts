import { questionBank } from './question-bank.ts'
import { subjects, subjectsForGrade, subjectById } from './curriculum.ts'
import { gradeQuiz, type AttendanceCorrection } from '../lib/domain.ts'
import { createSchoolWorkflows } from './school-workflows.ts'
import { createAssessmentAutomation } from './assessment-automation.ts'
import type {
  AuditEntry,
  ClubAttendanceRecord,
  EnrollmentRecord,
  EventConsent,
  GoalComment,
  GoalStep,
  GuidanceNote,
  LessonSubstitution,
  Renewal,
} from '../lib/school-workflows.ts'
import type { OpticalEvaluation, TutorSession } from '../lib/assessment-automation.ts'
import type { OfficialGradeFields } from '../lib/grades.ts'
import type {
  AnnouncementFields,
  ConversationFields,
  ConversationMessageFields,
} from '../lib/communication.ts'
import type { AbsenceReasonCategory, RequestActor, RequestFields } from '../lib/requests.ts'
import type { AppointmentFields } from '../lib/appointments.ts'
import type { QuestionFields } from '../lib/questions.ts'
export const topics = subjects.map((s) => s.name)

// Örnek veri kendi içinde tutarlıdır; aranan kayıt yoksa üretici hatalıdır ve hemen durur.
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Örnek veri tutarsız: ${what} bulunamadı.`)
  return value
}
export const studentNames = [
  'Deniz Yılmaz',
  'Ece Yılmaz',
  'Zeynep Demir',
  'Arda Çelik',
  'Elif Şahin',
  'Mert Aydın',
  'Defne Koç',
  'Kerem Arslan',
  'Asya Yıldız',
  'Emir Kaya',
  'Duru Aksoy',
  'Ege Öztürk',
  'İpek Güneş',
  'Kaan Polat',
  'Ada Tekin',
  'Berk Acar',
  'Mina Yalçın',
  'Can Eren',
  'Yağmur Erdem',
  'Ali Keskin',
  'Lara Bulut',
  'Oğuz Karaca',
  'Selin Kurt',
  'Umut Doğan',
  'Nehir Baş',
  'Atlas Özkan',
  'Sude Kaplan',
  'Efe Taş',
  'Azra Sarı',
  'Doruk Uçar',
  'Melis Sezer',
  'Baran Aslan',
  'İdil Kılıç',
  'Yiğit Avcı',
  'Nil Güler',
  'Bora Can',
  'Nisa Duman',
  'Alp Toprak',
  'Ceren Aksu',
  'Tuna Yavuz',
  'Ela Çetin',
  'Burak Işık',
  'Öykü Sağlam',
  'Onur Deniz',
  'Selma Ateş',
  'Emre Özdemir',
  'Nazlı Çakır',
  'Fırat Ekinci',
  'Sena Altun',
  'Batuhan Yücel',
  'İrem Çınar',
  'Tolga Öz',
  'Buse Duran',
  'Serkan Şen',
]

function buildSeed(now: Date) {
  const date = (days: number, hour = 9) => {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() + days)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  const month = (offset: number, day = 10) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 9)).toISOString()
  const branches = [
    {
      id: 'b1',
      name: 'Kadıköy Kampüsü',
      address: 'Caferağa Mah. Moda Cad. No: 24, İstanbul',
      color: '#8674c9',
    },
    {
      id: 'b2',
      name: 'Beşiktaş Kampüsü',
      address: 'Sinanpaşa Mah. Ihlamurdere Cad. No: 18, İstanbul',
      color: '#6aab9c',
    },
    {
      id: 'b3',
      name: 'Ataşehir Kampüsü',
      address: 'Atatürk Mah. Ataşehir Bulvarı No: 36, İstanbul',
      color: '#d4a475',
    },
  ].map((b) => ({ ...b, isActive: true, deletedAt: null as string | null }))
  const teacherNames = [
    'Selin Kaya',
    'Ahmet Yıldırım',
    'Derya Arslan',
    'Burcu Aksoy',
    'Emre Demir',
    'Ceren Aydın',
    'Mehmet Koç',
    'Ebru Çelik',
    'Canan Şahin',
    'Murat Eren',
    'İrem Güneş',
    'Okan Polat',
    'Seda Tekin',
    'Bahar Yalçın',
    'Tolga Acar',
    'Nermin Bulut',
  ]
  const teachers = branches.flatMap((branch, b) =>
    subjects.map((subject, i) => ({
      id: `t${b * subjects.length + i + 1}`,
      name:
        b === 0
          ? required(teacherNames[i], 'öğretmen adı')
          : `${['Aylin', 'Cem', 'Sevgi', 'Barış', 'Banu', 'Erdem', 'Sibel', 'Hakan', 'Nur', 'Deniz', 'Özge', 'Alper', 'Gizem', 'Koray', 'Pelin', 'Suat'][i]} ${b === 1 ? ['Özer', 'Akın', 'Uslu', 'Çetin'][i % 4] : ['Güler', 'Kurt', 'Toprak', 'Erdem'][i % 4]}`,
      subjectId: subject.id,
      subject: subject.name,
      branchId: branch.id,
      email: `ogretmen${b * subjects.length + i + 1}@kampus.example`,
      phone: `0555100${String(b * 16 + i).padStart(4, '0')}`,
      attendanceRate: 100 - (i % 4) * 3,
      homeworkRate: 98 - (i % 5) * 4,
      isActive: true,
      deletedAt: null as string | null,
      // kvkk: K — rehberlik görevi (DOM-YTK-026): iç notları okur ve yazar. Demo öğretmeni Selin
      // Kaya aynı zamanda rehberlik görevlisidir.
      guidanceCounselor: b === 0 && i === 0,
    })),
  )
  const gradeOrder = [7, 5, 6, 8, 9, 10, 11, 12]
  const classes = branches.flatMap((branch, b) =>
    gradeOrder.map((grade, i) => ({
      id: `c${b * 8 + i + 1}`,
      name: `${grade}-${['A', 'B', 'C'][b]}`,
      grade,
      section: ['A', 'B', 'C'][b],
      level: `${grade}. Sınıf`,
      branchId: branch.id,
      teacherId: required(
        teachers.find(
          (t) => t.branchId === branch.id && t.subjectId === (grade <= 8 ? 'math' : 'literature'),
        ),
        'sınıf öğretmeni',
      ).id,
      capacity: 24,
      room: `${b + 1}${String(i + 1).padStart(2, '0')}`,
      isActive: true,
      deletedAt: null as string | null,
    })),
  )
  const assignments = classes.flatMap((c) =>
    subjectsForGrade(c.grade).map((subject) => ({
      id: `assign-${c.id}-${subject.id}`,
      classId: c.id,
      subjectId: subject.id,
      teacherId: required(
        teachers.find((t) => t.branchId === c.branchId && t.subjectId === subject.id),
        'branş öğretmeni',
      ).id,
    })),
  )
  const names = [...studentNames]
  const firstNames = [
    'Eylül',
    'Berkay',
    'Aylin',
    'Kuzey',
    'Zehra',
    'Kıvanç',
    'Damla',
    'Demir',
    'İlayda',
    'Uras',
    'Dilan',
    'Aras',
    'Gökçe',
    'Alper',
    'İclal',
    'Eray',
    'Deren',
    'Utku',
    'Bengisu',
    'Eren',
  ]
  const lastNames = [
    'Akın',
    'Güven',
    'Yüksel',
    'Bayram',
    'Soylu',
    'Özer',
    'Çalışkan',
    'Taşkın',
    'Bilgin',
    'Uslu',
  ]
  for (const last of lastNames)
    for (const first of firstNames)
      if (names.length < 240 && !names.includes(`${first} ${last}`)) names.push(`${first} ${last}`)
  const students = names.map((name, i) => ({
    id: `s${i + 1}`,
    name,
    classId: required(classes[i % classes.length], 'sınıf').id,
    parentId: i < 2 ? 'p1' : `p${i + 1}`,
    email: `ogrenci${i + 1}@kampus.example`,
    phone: `0555010${String(i + 1).padStart(4, '0')}`,
    joinedAt: month(-12, 3 + (i % 20)),
    isActive: true,
    progress: 45 + ((i * 7) % 50),
    number: String(2026001 + i),
  }))
  const parents = [
    { id: 'p1', name: 'Ayşe Yılmaz', studentIds: ['s1', 's2'] },
    ...students.slice(2).map((s, i) => ({
      id: s.parentId,
      name: `${['Fatma', 'Mustafa', 'Zeynep', 'Ali'][i % 4]} ${s.name.split(' ').at(-1)}`,
      studentIds: [s.id],
    })),
  ]
  const academicMonths: string[] = []
  for (let offset = 0; academicMonths.length < 4; offset--) {
    const candidate = new Date(month(offset, 5))
    if (![6, 7].includes(candidate.getUTCMonth()) && candidate <= now)
      academicMonths.unshift(candidate.toISOString())
  }
  const grades = students.flatMap((student, i) =>
    Array.from({ length: 4 }, (_, m) =>
      subjectsForGrade(
        required(
          classes.find((c) => c.id === student.classId),
          'öğrenci sınıfı',
        ).grade,
      ).map((subject, t) => ({
        id: `g-${student.id}-${m}-${t}`,
        studentId: student.id,
        subjectId: subject.id,
        subject: subject.name,
        title: `${subject.name} · ${['Hazırbulunuşluk', 'Kazanım değerlendirme', 'Yazılı sınav', 'Aylık değerlendirme'][m]}`,
        topic: subject.topics[m % subject.topics.length],
        score: Math.min(
          100,
          43 +
            ((i * 13 + t * 9) % 43) +
            m * 4 +
            ((classes.findIndex((c) => c.id === student.classId) % 6) - 2) * 4,
        ),
        date: academicMonths[m],
      })),
    ).flat(),
  )
  const schoolDays: string[] = []
  for (let n = 1; schoolDays.length < 32; n += 3) {
    const d = new Date(date(-n))
    if (![0, 6].includes(d.getUTCDay()) && ![6, 7].includes(d.getUTCMonth()))
      schoolDays.push(d.toISOString())
  }
  const attendance = students.flatMap((s, i) =>
    schoolDays.map((d, n) => ({
      id: `att-${s.id}-${n}`,
      studentId: s.id,
      classId: s.classId,
      date: d,
      status:
        (i + n) % (i % 17 === 0 ? 4 : 19) === 0
          ? 'absent'
          : (i + n) % 23 === 0
            ? 'late'
            : 'present',
      reason: n % 8 === 0 ? 'Veli bilgilendirildi' : '',
    })),
  )
  const invoices = students.flatMap((s, i) =>
    Array.from({ length: 8 }, (_, n) => {
      const paid = n < 3 || (n === 3 && i % 4 !== 0)
      return {
        id: `inv-${s.id}-${n}`,
        studentId: s.id,
        installment: n + 1,
        amount: 2450000 + (i % 3) * 250000,
        dueDate: month(n - 3),
        paidAt: paid ? month(n - 3, 8) : null,
        method: paid ? ['Banka havalesi', 'Kredi kartı', 'Nakit'][i % 3] : null,
        reminderAt: null as string | null,
      }
    }),
  )
  const prospects = [
    'Alara Güven',
    'Ömer Faruk',
    'Doğa Yıldırım',
    'Sarp Ekin',
    'İnci Özer',
    'Rüzgar Soylu',
    'Aylin Akın',
    'Cem Arı',
    'Esma Korkmaz',
    'Poyraz Yüksel',
    'Eylül Varol',
    'Ozan Işık',
    'Beren Dal',
    'Sinan Gök',
    ...studentNames.slice(0, 4),
    'Melisa Önal',
    'Ege Yaman',
    'İdil Uğur',
    'Yağız Özkan',
    'Nehir Tunç',
    'Aren Özen',
    'İnci Sarı',
    'Efe Gündüz',
    'Nil Su',
    'Çınar Ateş',
    'Dora Keskin',
    'Mira Bal',
  ].map((name, i) => ({
    id: `pr${i + 1}`,
    name,
    phone: `0555020${String(i + 1).padStart(4, '0')}`,
    email: `aday${i + 1}@kampus.example`,
    branchId: required(branches[i % 3], 'kampüs').id,
    interest: `${gradeOrder[i % 8]}. Sınıf · ${required(gradeOrder[i % 8], 'düzey') < 9 ? 'Ortaokul' : 'Anadolu Lisesi'}`,
    source: ['Web sitesi', 'Veli referansı', 'Kampüs ziyareti', 'Telefon', 'Bursluluk sınavı'][
      i % 5
    ],
    stage:
      i >= 14 && i < 18
        ? 'Kayıt oldu'
        : ['Yeni aday', 'İletişime geçildi', 'Görüşme planlandı', 'Teklif verildi', 'Vazgeçti'][
            i % 5
          ],
    studentId: i >= 14 && i < 18 ? `s${i - 13}` : null,
    createdAt: date(-i * 2),
    trialAt: i % 5 === 2 ? date(i % 5, 9 + (i % 4)) : null,
    notes: [
      {
        id: `note${i}`,
        text: [
          'Veliyle akademik program, okul servisi ve yemek hizmetleri görüşüldü.',
          'Kampüs gezisi ve rehberlik görüşmesi planlandı. Bursluluk koşulları paylaşıldı.',
          'Öğrencinin önceki okul notları değerlendirildi; sınıf kontenjanı hakkında bilgi verildi.',
        ][i % 3],
        date: date(-i - 1),
        author: 'Büşra Aydın',
      },
    ],
  }))
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
  for (const attempt of quizAttempts) {
    const quiz = required(
      quizzes.find((q) => q.id === attempt.quizId),
      'sınav',
    )
    grades.push({
      id: `g-${attempt.id}`,
      studentId: attempt.studentId,
      subjectId: quiz.subjectId,
      subject: quiz.subject,
      title: quiz.title,
      topic: 'Kazanım testi',
      score: attempt.score,
      date: attempt.date,
    })
  }
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
  const announcementContent = [
    [
      'Yeni eğitim öğretim yılına merhaba',
      'Güncel ders programları, branş öğretmenleri ve sınıf listeleri panelinizde. Rehber öğretmeniniz okul uyum sürecinde yanınızda.',
    ],
    [
      'Bilim şenliği proje başvuruları',
      'Fen ve bilişim zümrelerinin düzenlediği bilim şenliğine enerji, çevre ve robotik projeleriyle katılabilirsiniz. Başvurular cuma gününe kadar danışman öğretmeninize yapılabilir.',
    ],
    [
      'Birinci yazılı sınav hazırlıkları',
      'Matematik, Türkçe, fen ve sosyal bilgiler kazanım testleri kütüphaneye eklendi. Branş öğretmenleriniz etüt saatlerinde sorularınızı yanıtlayacak.',
    ],
    [
      'Kütüphane okuma günleri',
      'Bu ayın teması doğa ve insan. Okuduğunuz kitapların değerlendirmelerini Türkçe ve edebiyat derslerinde paylaşabilirsiniz.',
    ],
    [
      'Veli görüşme haftası',
      'Branş öğretmenleriyle görüşme saatlerini randevu ekranından seçebilirsiniz. Her görüşme için 30 dakika ayrılmıştır.',
    ],
    [
      'Okullar arası basketbol turnuvası',
      'Okul takımının seçmeleri spor salonunda yapılacak. Katılmak isteyen öğrenciler beden eğitimi öğretmenine başvurabilir.',
    ],
    [
      'LGS ve YKS deneme sınavları',
      '8 ve 12. sınıflar için deneme sınavı sonuçları açıklanmıştır. Konu eksiklerinizi akademik gelişim ekranında inceleyebilirsiniz.',
    ],
    [
      'Görsel sanatlar sergisi',
      'Öğrencilerimizin doğa temalı resimleri ana binada sergilenecek. Eser teslimi için görsel sanatlar öğretmeninizle görüşün.',
    ],
    [
      'Müzik korosu çalışmaları',
      'Çok sesli okul korosunun çalışmaları salı ve perşembe günleri ders çıkışında müzik atölyesinde yapılacak.',
    ],
    [
      'Yemekhane ve servis bilgilendirmesi',
      'Alerjen bilgileri için okul danışmasına ulaşabilirsiniz. Servis güzergâh değişikliği talepleri ön büro tarafından değerlendirilecektir.',
    ],
    [
      'Dijital vatandaşlık atölyesi',
      'Bilişim dersinde güvenli parola, kişisel veri ve kaynak doğrulama konularını uygulamalarla ele alıyoruz.',
    ],
    [
      'Cumhuriyet haftası hazırlıkları',
      'Tarih, sosyal bilgiler ve müzik zümreleri ortak bir etkinlik hazırlıyor. Görev almak isteyen öğrenciler sınıf danışmanına başvurabilir.',
    ],
    [
      'Rehberlik: verimli çalışma',
      'Haftalık çalışma planınızı yaparken kısa molalara, uykuya ve sosyal etkinliklere de zaman ayırın. Rehberlik servisi bireysel planlama desteği sunuyor.',
    ],
    [
      'İngilizce kitap paylaşım saati',
      'Yabancı dil dersinde bu hafta okuduğumuz kısa hikâyeleri paylaşacağız. Her öğrenci sevdiği bir karakteri tanıtacak.',
    ],
    [
      'Çevre gönüllüleri buluşuyor',
      'Okul bahçesinde atık ayrıştırma ve bitki gözlem alanı kurulacak. Fen ve biyoloji zümreleri çalışmaya rehberlik edecek.',
    ],
    [
      'Matematik oyunları günü',
      'Akıl oyunları, geometrik yapbozlar ve sayı bulmacaları matematik atölyesinde sizleri bekliyor.',
    ],
  ]
  const announcements = announcementContent.map(([title, text], i) => ({
    id: `ann${i + 1}`,
    title,
    text,
    date: date(-i),
    classId: i % 4 === 0 ? 'c1' : null,
    category: ['Akademik', 'Etkinlik', 'Bilgilendirme'][i % 3],
  }))
  const messageTexts = [
    'Merhaba hocam, bu haftaki çalışma konularını paylaşabilir misiniz?',
    'Merhaba. Matematikte denklem kurma ve problem çözme adımlarına odaklanıyoruz.',
    'Problem metnini denkleme dönüştürürken zorlanıyoruz. Ek kaynak var mı?',
    'Materyaller bölümündeki çalışma kâğıdını ve denklemler videosunu inceleyebilirsiniz.',
    'Kaynağı bulduk. Bir etüt görüşmesi de planlayabilir miyiz?',
    'Tabii, randevu ekranından uygun bir saat seçebilirsiniz.',
    'Teşekkürler. Önce soruları çözüp takıldığımız adımları not edeceğiz.',
    'Çok iyi bir yöntem. Görüşmede birlikte değerlendirelim.',
  ]
  // Yazışma kaydı yalnız taraf bilgisini ve son mesaj anını taşır; mesajlar ayrı kayıtlardır
  // (`conversationMessages`, ADR 0005). Mesaj, yazışmanın taraf anahtarlarını kopya olarak taşır:
  // kapsam kuralı ve SQL süzgeci yazışmaya bakmadan karar verir; taraflar değişmez.
  const conversationParties = [
    { id: 'conv1', studentId: 's1', teacherId: 't1', audience: 'student' },
    { id: 'conv2', studentId: 's1', teacherId: 't1', audience: 'parent', parentUserId: 'p1' },
    { id: 'conv3', studentId: 's2', teacherId: 't1', audience: 'parent', parentUserId: 'p1' },
    { id: 'conv4', studentId: 's1', teacherId: 't3', audience: 'student' },
  ]
  const conversationMessages = conversationParties.flatMap(({ id, ...parties }) =>
    messageTexts.map((text, i) => ({
      id: `${id}-m${i}`,
      conversationId: id,
      ...parties,
      text:
        parties.teacherId === 't3'
          ? text
              .replace(
                'Matematikte denklem kurma ve problem çözme adımlarına',
                'Fen bilimlerinde hücrelerin yapılarına',
              )
              .replace('denklemler videosunu', 'hücre videosunu')
              .replace(
                'Problem metnini denkleme dönüştürürken',
                'Hücre yapılarını karşılaştırırken',
              )
          : text,
      sender: i % 2 ? 'teacher' : parties.audience,
      date: date(-2 + Math.floor(i / 4), 8 + i),
    })),
  )
  const conversations = conversationParties.map((c) => ({
    ...c,
    lastMessageAt: conversationMessages.filter((m) => m.conversationId === c.id).at(-1)?.date,
  }))
  const appointments = [
    {
      id: 'apt1',
      studentId: 's1',
      teacherId: 't1',
      date: date(2, 12),
      type: 'Bireysel etüt',
      note: 'Denklem kurma problemlerini tekrar etmek istiyorum.',
      status: 'Bekliyor',
    },
    {
      id: 'apt2',
      studentId: 's2',
      teacherId: 't1',
      date: date(3, 13),
      type: 'Veli görüşmesi',
      note: 'Dönem içi gelişimini değerlendirmek istiyorum.',
      status: 'Onaylandı',
    },
    {
      id: 'apt3',
      studentId: 's25',
      teacherId: 't1',
      date: date(1, 11),
      type: 'Bireysel etüt',
      note: 'Yazılı öncesi konu tekrarı.',
      status: 'Onaylandı',
    },
  ]
  const requests = [
    {
      id: 'req1',
      studentId: 's1',
      title: 'Okul servisi güzergâhı',
      text: 'Servis durağının evimize daha yakın bir noktaya alınmasını rica ediyoruz.',
      category: 'Talep',
      status: 'İnceleniyor',
      assignedTo: 'Ön büro',
      date: date(-2),
    },
    {
      id: 'req2',
      studentId: 's2',
      title: 'Sınıfın havalandırılması',
      text: 'Öğleden sonraki derslerde sınıfın havalandırılması konusunda destek rica ediyorum.',
      category: 'Şikayet',
      status: 'Yeni',
      assignedTo: 'Akademik koordinatör',
      date: date(-1),
    },
    {
      id: 'req3',
      studentId: 's3',
      title: 'Materyal desteği',
      text: 'Fen bilimleri için ek kaynak kitap önerisi rica ediyorum.',
      category: 'Talep',
      status: 'Çözüldü',
      assignedTo: 'Akademik koordinatör',
      date: date(-4),
    },
  ]
  const schedule = []
  const monday = new Date(now)
  const weekday = monday.getUTCDay()
  monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7))
  monday.setUTCHours(6, 0, 0, 0)
  const usedSlots = new Set()
  for (let d = 0; d < 12; d++) {
    const day = new Date(monday)
    day.setUTCDate(day.getUTCDate() + d)
    if ([0, 6].includes(day.getUTCDay())) continue
    for (let period = 0; period < 6; period++)
      for (const [ci, c] of classes.entries()) {
        const options = assignments.filter((a) => a.classId === c.id)
        const rotated = [
          ...options.slice((ci + d + period) % options.length),
          ...options.slice(0, (ci + d + period) % options.length),
        ]
        const assignment = rotated.find((a) => !usedSlots.has(`${d}-${period}-${a.teacherId}`))
        if (!assignment) continue
        usedSlots.add(`${d}-${period}-${assignment.teacherId}`)
        const lessonDate = new Date(day)
        lessonDate.setUTCMinutes(period * 50 + (period >= 3 ? 40 : 0))
        schedule.push({
          id: `lesson-${c.id}-${d}-${period}`,
          classId: c.id,
          teacherId: assignment.teacherId,
          subjectId: assignment.subjectId,
          date: lessonDate.toISOString(),
          duration: 40,
          title: required(subjectById(assignment.subjectId), 'ders').name,
          room: c.room,
        })
      }
  }
  const availability = teachers.flatMap((t) =>
    [1, 2, 3, 4].map((d, n) => ({
      id: `slot-${t.id}-${n}`,
      teacherId: t.id,
      date: date(d, 13 + (n % 2)),
      duration: 30,
    })),
  )
  const state = {
    version: 3,
    createdAt: now.toISOString(),
    subjects: structuredClone(subjects),
    assignments,
    branches,
    teachers,
    classes,
    students,
    parents,
    grades,
    attendance,
    invoices,
    prospects,
    bank,
    quizzes,
    homework,
    submissions,
    questions,
    videos,
    videoProgress,
    materials,
    announcements,
    conversations,
    conversationMessages,
    appointments,
    requests,
    schedule,
    availability,
    quizAttempts,
    absences: [],
    contracts: students.map((s) => ({
      id: `contract-${s.id}`,
      studentId: s.id,
      date: s.joinedAt,
      amount: invoices.filter((x) => x.studentId === s.id).reduce((a, x) => a + x.amount, 0),
      title: 'Özel okul eğitim sözleşmesi',
    })),
    preferences: {},
    modules: { crm: true, finance: true, academic: true, learning: true, communication: true },
    audit: [],
  }
  const extensions = createSchoolWorkflows(state, date)
  const { workflowModules, ...records } = extensions
  const expanded = { ...state, ...records, modules: { ...state.modules, ...workflowModules } }
  return { ...expanded, ...createAssessmentAutomation(expanded) }
}

// State tipi örnek veri üreticisinden türetilir. Örnek veride boş başlayan koleksiyonlar ile
// işlemlerin sonradan eklediği isteğe bağlı alanlar burada tamamlanır.
type SeedState = ReturnType<typeof buildSeed>
type Patch<T, P> = Omit<T, keyof P> & P
type Item<K extends keyof SeedState> = SeedState[K] extends readonly (infer T)[] ? T : never
type Timestamps = { createdAt?: string; updatedAt?: string }
export type State = Omit<SeedState, keyof StatePatches> & StatePatches
type StatePatches = {
  // Arayüzden kaydedilen öğrenciye okul numarası verilmez.
  students: (Patch<Item<'students'>, { number?: string }> & { academicYear?: number })[]
  // Not girişinin alanları; örnek veri ve eski kayıtlar bunları taşımaz (lib/grades.ts).
  grades: (Item<'grades'> & Partial<OfficialGradeFields>)[]
  // Düzeltme geçmişi; ilk kez alınan yoklama ve örnek veri taşımaz (DOM-AKD-035).
  attendance: (Item<'attendance'> & { corrections?: AttendanceCorrection[] })[]
  invoices: (Item<'invoices'> & Timestamps & { contractId?: string; academicYear?: number })[]
  contracts: (Item<'contracts'> & {
    classId?: string
    academicYear?: number
    invoiceIds?: string[]
  })[]
  // İş akışıyla eklenen dersin adı ders listesinden okunur; listede yoksa boş kalır. Eski
  // kayıtlarda ders adı `subject` alanındadır.
  schedule: (Patch<Item<'schedule'>, { title?: string; subject?: string }> &
    Timestamps & {
      cancelledAt?: string
      originalTeacherId?: string
      substitutions?: LessonSubstitution[]
    })[]
  // Web bildirimi `status` ve `date` yazar; çevrimdışı telefon yalnız `createdAt` yazar. API
  // bildirimi (`lib/requests.ts`) ikisini ve bildiren kişiyi yazar.
  absences: {
    id: string
    studentId: string
    startDate: string
    endDate: string
    /** Tür etiketi; API bildirimi `reasonCategory` etiketini yazar, eski kayıt kendi metnini. */
    category: string
    // kvkk: Ç — genel gerekçe kategorisi (`lib/requests.ts`); eski kayıt ve telefon taşımaz.
    reasonCategory?: AbsenceReasonCategory
    // kvkk: Ö — eski kayıtların serbest açıklaması; API bildirimi yazmaz (DOM-ILT-053).
    // TODO(kvkk-mazeret-notu): Serbest açıklama F2'de şifreli ayrı tabloyla gelir.
    reason?: string
    status?: string
    date?: string
    createdAt?: string
    notifiedBy?: RequestActor
  }[]
  // Talep işlemlerinin alanları; örnek veri ve eski kayıtlar taşımaz (lib/requests.ts).
  requests: (Item<'requests'> & RequestFields)[]
  // Telefon yüklenen dosyanın cihazdaki yolunu da saklar; örnek veri ve web taşımaz.
  // Soru işlemlerinin alanları (kazanım, yanıtlayan, ek yanıtlar, geri çekme); örnek veri ve eski
  // kayıtlar taşımaz (lib/questions.ts).
  questions: (Item<'questions'> &
    QuestionFields & {
      // kvkk: Ç — öğrencinin yüklediği dosyanın yolu.
      fileUri?: string | null
    })[]
  submissions: (Item<'submissions'> & {
    // kvkk: Ç — öğrencinin yüklediği ödev dosyasının yolu.
    fileUri?: string | null
    // kvkk: Ç — öğrencinin öğretmene teslim notu.
    note?: string
  })[]
  materials: (Item<'materials'> & { fileUri?: string | null })[]
  // İletişim işlemlerinin alanları; örnek veri ve eski kayıtlar taşımaz (lib/communication.ts).
  announcements: (Item<'announcements'> & AnnouncementFields)[]
  conversations: (Patch<Item<'conversations'>, { lastMessageAt?: string }> & ConversationFields)[]
  conversationMessages: (Item<'conversationMessages'> & ConversationMessageFields)[]
  // Randevu işlemlerinin alanları (süre dakika); eski kayıtlar taşımaz (lib/appointments.ts).
  appointments: (Item<'appointments'> & AppointmentFields)[]
  preferences: Record<string, unknown>
  // Okul iş akışı modülleri kayıttan eklenir; anahtar kümesi derleme anında sabit değildir.
  modules: Record<string, boolean>
  audit: AuditEntry[]
  guidanceCases: Patch<Item<'guidanceCases'>, { notes: GuidanceNote[]; updatedAt?: string }>[]
  mockExams: (Item<'mockExams'> & { updatedAt?: string })[]
  mockResults: (Item<'mockResults'> & {
    source?: string
    evaluationId?: string | null
    updatedAt?: string
  })[]
  studentGoals: Patch<
    Item<'studentGoals'>,
    {
      reviewedAt?: string
      closedAt?: string
      steps: GoalStep[]
      comments: GoalComment[]
    }
  >[]
  renewals: Renewal[]
  enrollmentHistory: EnrollmentRecord[]
  studyTasks: (Item<'studyTasks'> & Timestamps & { completedAt?: string; reviewedAt?: string })[]
  schoolEvents: (Item<'schoolEvents'> & { teacherId?: string | null; updatedAt?: string })[]
  eventConsents: EventConsent[]
  transportRoutes: (Item<'transportRoutes'> & { updatedAt?: string })[]
  transportAssignments: (Item<'transportAssignments'> & { updatedAt?: string })[]
  mealMenus: (Item<'mealMenus'> & { updatedAt?: string })[]
  clubs: (Item<'clubs'> & { updatedAt?: string })[]
  clubMemberships: (Item<'clubMemberships'> & { updatedAt?: string })[]
  clubAttendance: ClubAttendanceRecord[]
  socialAchievements: (Item<'socialAchievements'> & { updatedAt?: string })[]
  opticalEvaluations: OpticalEvaluation[]
  tutorSessions: TutorSession[]
}

export function createSeed(now = new Date()): State {
  return buildSeed(now)
}
