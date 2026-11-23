import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampPageIndex,
  EMPTY_LIST_STATE,
  withFilter,
  withSearch,
} from '../apps/mobile/src/api/list-state.ts'
import {
  childSkillAssignments,
  quizDetailView,
  quizRow,
  skillFacts,
  skillProgress,
  skillResultSource,
  skillRow,
  submissionVersions,
  type QuizDetailFields,
  type QuizItemFields,
  type SkillAssignmentFields,
} from '../apps/mobile/src/api/parent-learning.ts'
import {
  addDays,
  attendanceCounts,
  attendanceInRange,
  attendanceLabel,
  attendanceRangeFilters,
  attendanceRanges,
  attendanceView,
  decodeAttendanceFilter,
  encodeAttendanceFilter,
  isAttendanceStatus,
  isModuleOn,
  NO_REASON,
  presentedRanges,
  parentTabs,
  resolveAttendanceRange,
  resolveAttendanceView,
  resolveParentTab,
  tutoringView,
  weekDays,
  weekRange,
  weekSchedule,
  weekStart,
  weekTitle,
} from '../apps/mobile/src/api/parent-tracking.ts'
import { homeworkAudienceView, homeworkEmptyText } from '../apps/mobile/src/api/presentation.ts'

const names = {
  subjects: new Map([['mat', 'Matematik']]),
  teachers: new Map([
    ['t1', 'Selin Kaya'],
    ['t2', 'Mert Aydın'],
  ]),
}

type LessonInput = Parameters<typeof weekSchedule>[0][number]
const lesson = (id: string, overrides: Partial<LessonInput> = {}): LessonInput => ({
  id,
  subjectId: 'mat',
  title: null,
  teacherId: 't1',
  originalTeacherId: null,
  // Europe/Istanbul UTC+3: 06:00Z yerel 09:00.
  date: '2026-11-03T06:00:00.000Z',
  duration: 40,
  room: '101',
  status: 'planned',
  ...overrides,
})

describe('IST-124 mobil veli akademik takip', () => {
  test('IST-124 sekmeler web sırasındadır; kapalı modülün sekmesi çizilmez', () => {
    const all = parentTabs({ academic: true, planning: true, learning: true })
    assert.deepEqual(
      all.map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'program', 'odevler', 'quizler', 'gorevler'],
    )
    assert.deepEqual(
      parentTabs({ academic: true, planning: false, learning: true }).map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'odevler', 'quizler', 'gorevler'],
    )
    assert.deepEqual(
      parentTabs({ academic: true, learning: false }).map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'program'],
    )
    // Modül anahtarı listede yoksa açık sayılır (kapalı yalnız açıkça `false`).
    assert.equal(parentTabs({}).length, 6)
  })

  test('IST-124 modül kapanınca seçili sekme ilk görünen sekmeye düşer', () => {
    const tabs = parentTabs({ academic: true, planning: false, learning: true })
    assert.equal(resolveParentTab('program', tabs), 'notlar')
    assert.equal(resolveParentTab('odevler', tabs), 'odevler')
    assert.equal(resolveParentTab('notlar', []), 'notlar')
  })

  test('IST-124 devamsızlık özeti kayıtlardan hesaplanır, bilinmeyen durum sayılmaz', () => {
    assert.deepEqual(
      attendanceCounts([
        { status: 'present' },
        { status: 'present' },
        { status: 'absent' },
        { status: 'late' },
        { status: 'excused' },
        { status: 'bilinmeyen' },
        {},
      ]),
      { present: 2, absent: 1, late: 1, excused: 1 },
    )
    assert.deepEqual(attendanceCounts([]), { present: 0, absent: 0, late: 0, excused: 0 })
  })

  test('IST-124 durum etiketleri Türkçe, bilinmeyen durum olduğu gibi kalır', () => {
    assert.equal(attendanceLabel('absent'), 'Gelmedi')
    assert.equal(attendanceLabel('late'), 'Geç geldi')
    assert.equal(attendanceLabel('x'), 'x')
    // Nesne prototipindeki adlar durum sayılmaz, metin olduğu gibi döner.
    assert.equal(attendanceLabel('toString'), 'toString')
    assert.equal(isAttendanceStatus('constructor'), false)
    assert.equal(isAttendanceStatus('excused'), true)
    assert.equal(isAttendanceStatus(''), false)
  })

  test('DOM-AKD-036 geç kalma dakikası yalnız Geç geldi kaydında görünür', () => {
    const late = attendanceView({
      date: '2026-11-02T00:00:00.000Z',
      status: 'late',
      lateMinutes: 12,
      reason: ' Servis gecikti ',
    })
    assert.equal(late.status, 'Geç geldi')
    assert.equal(late.subtitle, '12 dk · Servis gecikti')
    assert.match(late.title, /2 Kas 2026/)
    assert.match(late.title, /Pazartesi/)
    const absent = attendanceView({ date: '2026-11-02', status: 'absent', lateMinutes: 5 })
    assert.equal(absent.subtitle, NO_REASON)
    assert.equal(attendanceView({ status: 'present' }).title, 'Ders günü')
  })

  test('hafta Europe/Istanbul takvimiyle pazartesi başlar', () => {
    assert.equal(weekStart('2026-11-03'), '2026-11-02')
    assert.equal(weekStart('2026-11-02'), '2026-11-02')
    // Pazar önceki pazartesinin haftasındadır.
    assert.equal(weekStart('2026-11-08'), '2026-11-02')
    assert.equal(weekStart('2026-11-09'), '2026-11-09')
    assert.equal(addDays('2026-11-02', -7), '2026-10-26')
    assert.equal(addDays('2026-12-28', 7), '2027-01-04')
    assert.deepEqual(weekRange('2026-11-02'), { dateFrom: '2026-11-02', dateTo: '2026-11-08' })
    assert.equal(weekDays('2026-11-02').length, 7)
    assert.equal(weekTitle('2026-11-02'), '2 Kasım – 8 Kasım 2026')
  })

  test('DOM-YTK-068 iptal edilen ders haftalık programda görünmez', () => {
    const days = weekSchedule(
      [lesson('a'), lesson('b', { status: 'cancelled', date: '2026-11-03T08:00:00.000Z' })],
      '2026-11-02',
      names,
    )
    assert.equal(days.length, 1)
    assert.deepEqual(
      days[0]?.lessons.map((item) => item.id),
      ['a'],
    )
  })

  test('hafta programı günlere ve saate göre sıralanır, boş gün listelenmez', () => {
    const days = weekSchedule(
      [
        lesson('geç', { date: '2026-11-03T10:00:00.000Z' }),
        lesson('erken', { date: '2026-11-03T06:00:00.000Z' }),
        lesson('çarşamba', { date: '2026-11-04T06:00:00.000Z' }),
        // Haftanın dışı.
        lesson('gelecek', { date: '2026-11-10T06:00:00.000Z' }),
      ],
      '2026-11-02',
      names,
    )
    assert.deepEqual(
      days.map((day) => day.day),
      ['2026-11-03', '2026-11-04'],
    )
    assert.deepEqual(
      days[0]?.lessons.map((item) => item.id),
      ['erken', 'geç'],
    )
    assert.match(days[0]?.label ?? '', /Salı/)
  })

  test('gün Europe/Istanbul takvimine göredir: 22:30Z ertesi günün 01:30 dersidir', () => {
    const days = weekSchedule(
      [lesson('gece', { date: '2026-11-03T22:30:00.000Z' })],
      '2026-11-02',
      names,
    )
    assert.equal(days[0]?.day, '2026-11-04')
    assert.equal(days[0]?.lessons[0]?.time, '01:30–02:10')
  })

  test('ders satırı saat aralığı, ders adı, öğretmen ve derslik taşır', () => {
    const [day] = weekSchedule([lesson('a')], '2026-11-02', names)
    assert.deepEqual(day?.lessons[0], {
      id: 'a',
      kind: 'lesson',
      title: 'Matematik',
      time: '09:00–09:40',
      subtitle: 'Selin Kaya · Derslik 101',
    })
    // Kaydın kendi başlığı ders adından önce gelir; ad bilinmiyorsa genel ad.
    const [titled] = weekSchedule([lesson('b', { title: 'Cebir' })], '2026-11-02', names)
    assert.equal(titled?.lessons[0]?.title, 'Cebir')
    const [unknown] = weekSchedule(
      [lesson('c', { subjectId: 'yok', teacherId: 'yok', room: '' })],
      '2026-11-02',
      names,
    )
    assert.equal(unknown?.lessons[0]?.title, 'Ders')
    assert.equal(unknown?.lessons[0]?.subtitle, '')
  })

  test('DOM-YTK-068 yedek öğretmen yazılır, gerekçe ya da asıl öğretmen gösterilmez', () => {
    const [day] = weekSchedule(
      [
        lesson('a', { teacherId: 't2', originalTeacherId: 't1', status: 'substituted' }),
        lesson('b', {
          teacherId: 'görünmeyen',
          originalTeacherId: 't1',
          status: 'substituted',
          date: '2026-11-03T08:00:00.000Z',
        }),
      ],
      '2026-11-02',
      names,
    )
    assert.equal(day?.lessons[0]?.subtitle, 'Yedek: Mert Aydın · Derslik 101')
    assert.equal(day?.lessons[1]?.subtitle, 'Yedek öğretmen atandı · Derslik 101')
    assert.doesNotMatch(JSON.stringify(day), /Selin/)
  })

  test('IST-124 ödev sekmesi etiketi web ile aynıdır', () => {
    const tab = parentTabs({}).find((item) => item.value === 'odevler')
    assert.equal(tab?.label, 'Ödev durumu')
  })

  test('DOM-AKD-074 velide teslim yönlendirmesi yok, başlık Teslim açıklaması', () => {
    const now = new Date('2026-11-03T09:00:00.000Z')
    const open = { dueDate: '2026-11-10T09:00:00.000Z', allowLate: false }
    const closed = { dueDate: '2026-11-01T09:00:00.000Z', allowLate: false }
    for (const homework of [open, closed]) {
      const parent = homeworkAudienceView('parent', homework, 'Bekliyor', now)
      assert.equal(parent.hint, null)
      assert.equal(parent.submissionTitle, 'Teslim açıklaması')
    }
    // Öğrencide yönlendirme sürer: açık ödev web'e, süresi dolan ödev kapalıya.
    assert.equal(homeworkAudienceView('student', open, 'Bekliyor', now).hint, 'submit')
    assert.equal(homeworkAudienceView('student', closed, 'Bekliyor', now).hint, 'closed')
    assert.equal(homeworkAudienceView('student', open, 'Bekliyor', now).submissionTitle, 'Teslimin')
    assert.notEqual(homeworkEmptyText('parent'), homeworkEmptyText('student'))
  })
})

const TERM = { startDate: '2026-09-14', endDate: '2027-01-22' }

describe('IST-124 devamsızlık tarih aralığı', () => {
  test('Son 30 gün bugünü ve önceki 29 günü kapsar (Europe/Istanbul günü)', () => {
    assert.deepEqual(attendanceRangeFilters('last30', '2026-11-03', TERM), {
      dateFrom: '2026-10-05',
      dateTo: '2026-11-03',
    })
  })

  test('Bu dönem günün dönemidir; dönem yoksa ve Tümü süzgeçsizdir', () => {
    assert.deepEqual(attendanceRangeFilters('term', '2026-11-03', TERM), {
      dateFrom: '2026-09-14',
      dateTo: '2027-01-22',
    })
    assert.deepEqual(attendanceRangeFilters('term', '2026-11-03', null), {})
    assert.deepEqual(attendanceRangeFilters('all', '2026-11-03', TERM), {})
  })

  test('Bu dönem yalnız dönem varken sunulur; kalkarsa Tümü değerine dönülür', () => {
    assert.deepEqual(attendanceRanges(TERM), ['term', 'last30', 'all'])
    assert.deepEqual(attendanceRanges(null), ['last30', 'all'])
    assert.equal(resolveAttendanceRange('term', null), 'all')
    assert.equal(resolveAttendanceRange('last30', null), 'last30')
  })

  test('durum ve aralık tek süzgeç alanında taşınır; bozuk değer varsayılana düşer', () => {
    assert.equal(encodeAttendanceFilter({ status: '', range: 'all' }), '')
    assert.equal(encodeAttendanceFilter({ status: 'absent', range: 'last30' }), 'absent|last30')
    assert.deepEqual(decodeAttendanceFilter('absent|last30'), { status: 'absent', range: 'last30' })
    assert.deepEqual(decodeAttendanceFilter(''), { status: '', range: 'all' })
    assert.deepEqual(decodeAttendanceFilter('toString|constructor'), { status: '', range: 'all' })
  })

  test('süzgeç değişince sayfa sıfırlanır, aynı süzgeçte korunur', () => {
    const page3 = { ...EMPTY_LIST_STATE, index: 3 }
    const next = withFilter(page3, encodeAttendanceFilter({ status: '', range: 'term' }))
    assert.equal(next.index, 0)
    assert.equal(withFilter({ ...next, index: 2 }, next.filter).index, 2)
    // Veri azalınca geçersiz sayfada kalınmaz.
    assert.equal(clampPageIndex(3, 12), 1)
  })
})

describe('IST-096 veli programında kazanım etütleri', () => {
  const tutor = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    date: '2026-11-03T11:00:00.000Z',
    duration: 40,
    subjectId: 'mat',
    topic: 'Üslü sayılar',
    teacherId: 't1',
    room: '204',
    status: 'Planlandı',
    studentIds: ['deniz', 'ece'],
    ...overrides,
  })

  test('etüt "Etüt · ders · konu" ve "1 öğrenci · Derslik x" olarak çıkar', () => {
    const view = tutoringView(tutor('e1'), 'deniz', names)
    assert.equal(view?.title, 'Etüt · Matematik · Üslü sayılar')
    assert.equal(view?.subtitle, '1 öğrenci · Derslik 204')
    assert.equal(view?.time, '14:00–14:40')
    assert.equal(view?.tutoring?.teacher, 'Selin Kaya')
  })

  test('iptal edilen etüt ve çocuğu içermeyen etüt görünmez', () => {
    assert.equal(tutoringView(tutor('e1', { status: 'İptal' }), 'deniz', names), null)
    assert.equal(tutoringView(tutor('e2', { studentIds: ['ece'] }), 'deniz', names), null)
  })

  test('etüt aynı günde dersle saate göre karışık sıralanır, yalnız etütlü gün de listelenir', () => {
    const days = weekSchedule(
      [lesson('d1'), lesson('d2', { date: '2026-11-03T12:00:00.000Z' })],
      '2026-11-02',
      names,
      {
        sessions: [tutor('e1'), tutor('e9', { date: '2026-11-05T07:00:00.000Z' })],
        studentId: 'deniz',
      },
    )
    assert.deepEqual(
      days.map((day) => day.lessons.map((row) => row.kind)),
      [['lesson', 'tutoring', 'lesson'], ['tutoring']],
    )
  })
})

describe('IST-095 veli quiz sonuçları', () => {
  const result = {
    score: 80,
    correctCount: 4,
    total: 5,
    topicScores: [{ topic: 'Üslü', score: 60 }],
  }
  const attempt = (studentId: string, overrides: Record<string, unknown> = {}) => ({
    studentId,
    status: 'completed' as const,
    submittedAt: '2026-11-02T09:00:00.000Z',
    expiresAt: null,
    result,
    ...overrides,
  })
  const quiz: QuizItemFields = {
    id: 'q1',
    title: 'Üslü sayılar',
    subject: 'Matematik',
    questionCount: 5,
    duration: 20,
    dueDate: null,
    attempts: [attempt('ece', { result: { ...result, score: 20 } }), attempt('deniz')],
  }

  test('DOM-AKD-079 satır yalnız seçili çocuğun denemesinden kurulur', () => {
    const row = quizRow(quiz, 'deniz')
    assert.equal(row.score, '%80')
    assert.equal(row.status, 'Çözüldü')
    assert.equal(row.subtitle, 'Matematik · 5 soru · 20 dk · Süresiz açık')
    assert.equal(quizRow(quiz, 'baska').status, 'Henüz çözülmedi')
    assert.equal(quizRow(quiz, 'baska').score, undefined)
  })

  test('DOM-AKD-078 cevaplar gelmediyse konu ve cevap bölümü kilitli metin alır', () => {
    const detail: QuizDetailFields = { ...quiz, questions: null }
    const locked = quizDetailView(detail, 'deniz')
    assert.equal(locked.result?.correct, '4 / 5')
    assert.equal(locked.review, null)
    assert.equal(locked.reviewLocked, true)
  })

  test('DOM-AKD-078 inceleme açıksa konu yüzdeleri ve verilen cevaplar çıkar, doğru şık yok', () => {
    const detail: QuizDetailFields = {
      ...quiz,
      questions: [
        { id: 's1', text: '2^3 kaçtır?', topic: 'Üslü', options: ['6', '8'] },
        { id: 's2', text: '3^2 kaçtır?', topic: 'Üslü', options: ['9', '6'] },
      ],
      attempts: [attempt('deniz', { answers: { s1: 1 } })],
    }
    const view = quizDetailView(detail, 'deniz')
    assert.deepEqual(view.review?.topics, [{ topic: 'Üslü', score: '%60' }])
    assert.deepEqual(
      view.review?.answers?.map((answer) => answer.detail),
      ['Üslü · Verilen cevap: B) 8', 'Üslü · Verilen cevap: Boş bırakıldı'],
    )
    assert.equal(view.reviewLocked, false)
  })

  test('çözülmemiş ve süren quizde sonuç yok, durum notu var', () => {
    const none = quizDetailView({ ...quiz, questions: null, attempts: [] }, 'deniz')
    assert.equal(none.result, null)
    assert.equal(none.note, 'Bu quiz henüz çözülmedi.')
    const running = quizDetailView(
      {
        ...quiz,
        questions: null,
        attempts: [attempt('deniz', { status: 'in_progress', result: null, submittedAt: null })],
      },
      'deniz',
    )
    assert.match(running.note ?? '', /şu an çözülüyor/)
  })

  test('süresi dolan denemede boş cevap notu ve süre bitişi yazılır', () => {
    const view = quizDetailView(
      {
        ...quiz,
        questions: null,
        attempts: [
          attempt('deniz', {
            status: 'expired',
            submittedAt: null,
            expiresAt: '2026-11-02T09:20:00.000Z',
          }),
        ],
      },
      'deniz',
    )
    assert.match(view.result?.stamp ?? '', /^Süre bitişi: /)
    assert.match(view.result?.expiredNote ?? '', /boş cevaplı/)
  })
})

describe('IST-051 veli beceri görevleri', () => {
  const task = (
    id: string,
    overrides: Partial<SkillAssignmentFields> = {},
  ): SkillAssignmentFields => ({
    id,
    title: 'Okuma görevi',
    contentType: 'reading_passage',
    scoringMode: 'auto',
    kind: 'evaluation',
    deadline: { dueAt: '2026-11-10T20:59:00.000Z', lateAcceptanceDays: 0 },
    timeLimitMinutes: 15,
    submission: null,
    learnerIds: ['deniz'],
    progress: [
      {
        learnerId: 'deniz',
        status: 'submitted',
        resubmissionRequested: false,
        attemptId: 'a1',
        submissionId: null,
        used: 1,
        limit: 2,
        score: { percent: 90 },
      },
    ],
    ...overrides,
  })
  const NOW = new Date('2026-11-03T09:00:00.000Z')
  const baseProgress = () => {
    const [first] = task('x').progress
    if (!first) throw new Error('özet yok')
    return first
  }

  test('görevler yalnız seçili çocuğa hedeflenenlerle daraltılır', () => {
    const items = [task('g1'), task('g2', { learnerIds: ['ece'] })]
    assert.deepEqual(
      childSkillAssignments(items, 'deniz').map((item) => item.id),
      ['g1'],
    )
    assert.deepEqual(childSkillAssignments(items, ''), [])
  })

  test('otomatik puanlı görevde durum, hak ve açılmış puan özetten gelir', () => {
    assert.deepEqual(skillProgress(task('g1'), 'deniz', NOW), {
      status: 'Tamamlandı',
      rights: '1 / 2 deneme',
      score: '90 / 100',
    })
    const row = skillRow(task('g1'), 'deniz', NOW)
    assert.match(row.subtitle, /^Okuma parçası · Değerlendirme · Son teslim: /)
    assert.equal(row.score, '90 / 100')
  })

  test('DOM-BEC-045 puan açılmadıysa ya da deneme sürüyorsa çizgi gösterilir', () => {
    const open = task('g2', { progress: [{ ...baseProgress(), score: null }] })
    assert.equal(skillProgress(open, 'deniz', NOW).score, '—')
    const running = task('g3', { progress: [{ ...baseProgress(), status: 'in_progress' }] })
    const view = skillProgress(running, 'deniz', NOW)
    assert.equal(view.status, 'Sürüyor')
    assert.equal(view.score, '—')
  })

  test('özeti olmayan çocuk Okunamadı görür; süresi geçen başlanmamış görev Teslim edilmedi olur', () => {
    assert.equal(skillProgress(task('g1'), 'ece', NOW).status, 'Okunamadı')
    const pending = task('g4', {
      progress: [{ ...baseProgress(), status: 'pending', score: null }],
    })
    assert.equal(skillProgress(pending, 'deniz', NOW).status, 'Başlanmadı')
    assert.equal(
      skillProgress(pending, 'deniz', new Date('2026-12-01T00:00:00.000Z')).status,
      'Teslim edilmedi',
    )
  })

  test('öğretmen puanlı konuşma görevi deneme hakkı yazar, teslim sürümleri okunur', () => {
    const speaking = task('g5', {
      scoringMode: 'teacher',
      contentType: 'audio',
      submission: { submissionKind: 'audio' },
      progress: [
        { ...baseProgress(), submissionId: 's1', attemptId: null, resubmissionRequested: true },
      ],
    })
    assert.equal(skillRow(speaking, 'deniz', NOW).subtitle.includes('Konuşma görevi'), true)
    assert.equal(skillProgress(speaking, 'deniz', NOW).status, 'Yeniden teslim istendi')
    assert.equal(skillFacts(speaking, 'deniz', NOW)[2]?.label, 'Deneme hakkı')
    assert.deepEqual(skillResultSource(speaking, speaking.progress[0]), {
      kind: 'submission',
      submissionId: 's1',
    })
    assert.deepEqual(skillResultSource(task('g1'), task('g1').progress[0]), { kind: 'none' })
  })

  test('DOM-BEC-045 sürümlerde yalnız kesinleşmiş puan ve geri bildirim görünür', () => {
    const versions = submissionVersions([
      {
        id: 'v1',
        number: 1,
        submittedAt: '2026-11-02T09:00:00.000Z',
        late: false,
        body: 'My text',
        score: null,
      },
      {
        id: 'v2',
        number: 2,
        submittedAt: '2026-11-03T09:00:00.000Z',
        late: true,
        body: null,
        score: {
          settled: true,
          percent: 75,
          overallComment: 'İyi',
          criteria: [{ criterionId: 'c1', band: 3, comment: 'Akıcı' }],
        },
      },
    ])
    assert.deepEqual(
      versions.map((version) => version.title),
      ['2. sürüm', '1. sürüm'],
    )
    assert.equal(versions[0]?.score, 'Puan 75 / 100')
    assert.deepEqual(versions[0]?.criteria, ['1. kriter: 3. bant · Akıcı'])
    assert.equal(versions[1]?.score, null)
    assert.equal(versions[1]?.comment, null)
  })
})

describe('OG-063 veli takibi: saf mantık dalları', () => {
  const tutor = (id: string, date: string, overrides: Record<string, unknown> = {}) => ({
    id,
    date,
    duration: 40,
    subjectId: 'mat',
    topic: 'Üslü sayılar',
    teacherId: 't1',
    room: '204',
    status: 'Planlandı',
    studentIds: ['deniz'],
    ...overrides,
  })

  test('etüt modülü yalnız açıkça true ise açıktır; kapalıyken ve anahtar yokken istek gitmez', () => {
    assert.equal(isModuleOn({ tutoring: true }, 'tutoring'), true)
    assert.equal(isModuleOn({ tutoring: false }, 'tutoring'), false)
    assert.equal(isModuleOn({}, 'tutoring'), false)
  })

  test('pazar 21:30Z İstanbul pazartesi 00:30: etüt yeni haftaya düşer, önceki haftada görünmez', () => {
    const sunday = tutor('e1', '2026-11-01T21:30:00.000Z')
    const input = { sessions: [sunday], studentId: 'deniz' }
    const next = weekSchedule([], '2026-11-02', names, input)
    assert.deepEqual(
      next.map((day) => day.day),
      ['2026-11-02'],
    )
    assert.equal(next[0]?.lessons[0]?.time, '00:30–01:10')
    assert.deepEqual(weekSchedule([], '2026-10-26', names, input), [])
    // Bir saat önce (20:30Z = pazar 23:30) hâlâ önceki haftanın pazarıdır.
    const late = { sessions: [tutor('e2', '2026-11-01T20:30:00.000Z')], studentId: 'deniz' }
    assert.deepEqual(
      weekSchedule([], '2026-10-26', names, late).map((day) => day.day),
      ['2026-11-01'],
    )
    assert.deepEqual(weekRange('2026-11-02'), { dateFrom: '2026-11-02', dateTo: '2026-11-08' })
  })

  test('ders adı okunamayan etüt ham ders kimliğini göstermez', () => {
    const view = tutoringView(
      tutor('e1', '2026-11-03T11:00:00.000Z', { subjectId: 'ham-id-1' }),
      'deniz',
      names,
    )
    assert.equal(view?.title, 'Etüt · Ders · Üslü sayılar')
    assert.equal(view?.tutoring?.subject, 'Ders')
  })

  test('DOM-BEC-045 settled:false puan yüzdesi dolu olsa da gösterilmez, geri bildirim gelmez', () => {
    const [version] = submissionVersions([
      {
        id: 'v1',
        number: 1,
        submittedAt: '2026-11-02T09:00:00.000Z',
        late: false,
        body: 'Metin',
        score: {
          settled: false,
          percent: 88,
          overallComment: 'Gizli yorum',
          criteria: [{ criterionId: 'c1', band: 4, comment: 'Gizli' }],
        },
      },
    ])
    assert.equal(version?.score, null)
    assert.equal(version?.comment, null)
    assert.deepEqual(version?.criteria, [])
  })

  test('arama ve süzgeç değişince sayfa sıfırlanır; aynı değerde korunur', () => {
    const page3 = { ...EMPTY_LIST_STATE, index: 3 }
    assert.equal(withSearch(page3, 'üslü').index, 0)
    assert.equal(withSearch(page3, '').index, 3)
    assert.equal(withFilter(page3, 'absent|all').index, 0)
  })

  test('dönem yüklenirken ve hatada Bu dönem bekletilir, Tümü ya da Son 30 gün beklemez', () => {
    assert.deepEqual(resolveAttendanceView('term', 'loading', null), {
      range: 'term',
      wait: 'loading',
    })
    assert.deepEqual(resolveAttendanceView('term', 'error', null), { range: 'term', wait: 'error' })
    assert.deepEqual(resolveAttendanceView('all', 'loading', null), { range: 'all', wait: null })
    assert.deepEqual(resolveAttendanceView('last30', 'error', null), {
      range: 'last30',
      wait: null,
    })
    assert.deepEqual(resolveAttendanceView('term', 'ready', TERM), { range: 'term', wait: null })
    // Dönem bilgisi geldi ve dönem yok: gerçekten varsayılana dönülür.
    assert.deepEqual(resolveAttendanceView('term', 'ready', null), { range: 'all', wait: null })
    assert.deepEqual(presentedRanges('loading', null), ['term', 'last30', 'all'])
    assert.deepEqual(presentedRanges('ready', null), ['last30', 'all'])
  })

  test('durum sayıları seçili tarih aralığındaki kayıtlardan hesaplanır (kart liste ile çelişmez)', () => {
    const records = [
      { date: '2026-11-03T06:00:00.000Z', status: 'absent' },
      { date: '2026-10-01T06:00:00.000Z', status: 'absent' },
      { date: '2026-09-01T06:00:00.000Z', status: 'late' },
      // Europe/Istanbul: 22:00Z ertesi günün 01:00'idir (2026-10-05).
      { date: '2026-10-04T22:00:00.000Z', status: 'present' },
    ]
    const last30 = attendanceRangeFilters('last30', '2026-11-03', TERM)
    assert.deepEqual(attendanceCounts(attendanceInRange(records, last30)), {
      present: 1,
      absent: 1,
      late: 0,
      excused: 0,
    })
    assert.equal(attendanceInRange(records, {}).length, 4)
    const term = attendanceRangeFilters('term', '2026-11-03', TERM)
    assert.equal(attendanceInRange(records, term).length, 3)
  })

  test('quiz ayrıntısı son tarihi yazar; son tarihsiz quiz süresiz açıktır', () => {
    const detail: QuizDetailFields = {
      title: 'Üslü sayılar',
      subject: 'Matematik',
      questionCount: 5,
      duration: 20,
      dueDate: null,
      questions: null,
      attempts: [],
    }
    assert.equal(quizDetailView(detail, 'deniz').due, 'Süresiz açık')
    assert.match(
      quizDetailView({ ...detail, dueDate: '2026-11-10T20:59:00.000Z' }, 'deniz').due,
      /10 Kas 2026 23:59/,
    )
  })
})
