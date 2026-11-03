import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import { GRADE_MESSAGES } from '../packages/react-shared/src/use-academic-commands.ts'
import {
  defaultGradeTerm,
  displayScore,
  evaluationProblem,
  existingGrades,
  gradeClassIds,
  gradeCreateInput,
  gradeFailureText,
  gradeTypeChoices,
  gradeUpdateInput,
  isUncertainFailure,
  knownEvaluations,
  parseScore,
  pinVersions,
  planGradeSave,
  saveSummary,
  teachingSubjectIds,
  withoutSaved,
  withPinnedVersions,
  type EvaluationKey,
  type ExistingGrade,
} from '../apps/mobile/src/api/grade-entry.ts'

const KEY: EvaluationKey = {
  classId: 'test-class-7a',
  subjectId: 'test-sub-mat',
  assessmentType: 'sinav',
  term: 1,
  date: '2026-11-03',
}

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message, requestId: 'test-req' })

type RowOverrides = Partial<{
  subjectId: string
  score: number
  date: string | undefined
  assessmentType: string | undefined
  term: number
  quizId: string
}>

const row = (id: string, studentId: string, overrides: RowOverrides = {}) => ({
  id,
  version: 3,
  record: {
    studentId,
    subjectId: 'test-sub-mat',
    score: 70,
    date: '2026-11-03T09:00:00.000Z' as string | undefined,
    assessmentType: 'sinav' as string | undefined,
    term: 1,
    ...overrides,
  },
})

const grade = (studentId: string, score: number, fromQuiz = false): ExistingGrade => ({
  id: `g-${studentId}`,
  version: 4,
  studentId,
  score,
  fromQuiz,
})

describe('OG-062 mobil not girişi: seçenekler', () => {
  const assignments = [
    { classId: 'test-class-7a', subjectId: 'test-sub-mat', teacherId: 'test-t-selin' },
    { classId: 'test-class-7a', subjectId: 'test-sub-fen', teacherId: 'test-t-selin' },
    { classId: 'test-class-7a', subjectId: 'test-sub-tur', teacherId: 'test-t-baska' },
    { classId: 'test-class-8b', subjectId: 'test-sub-mat', teacherId: 'test-t-baska' },
  ]

  test('DOM-AKD-054 yalnız ders verilen sınıf ve ders seçilebilir', () => {
    assert.deepEqual([...gradeClassIds(assignments, 'test-t-selin')], ['test-class-7a'])
    assert.deepEqual(teachingSubjectIds(assignments, 'test-t-selin', 'test-class-7a'), [
      'test-sub-mat',
      'test-sub-fen',
    ])
    assert.deepEqual(teachingSubjectIds(assignments, 'test-t-selin', 'test-class-8b'), [])
    assert.deepEqual(teachingSubjectIds(assignments, '', 'test-class-7a'), [])
    assert.equal(gradeClassIds(assignments, '').size, 0)
  })

  test('DOM-AKD-004 katılım puanı yalnız ortaokulda sunulur', () => {
    const values = (classGrade: number) => gradeTypeChoices(classGrade).map((item) => item.value)
    assert.ok(values(7).includes('katilim'))
    assert.ok(!values(10).includes('katilim'))
    assert.deepEqual(values(7).slice(0, 2), ['sinav', 'performans'])
    assert.equal(gradeTypeChoices(7)[0]?.label, 'Sınav')
  })

  test('dönem varsayılanı Eylül–Ocak 1., Şubat–Ağustos 2. dönemdir', () => {
    assert.equal(defaultGradeTerm('2026-11-03'), 1)
    assert.equal(defaultGradeTerm('2027-01-15'), 1)
    assert.equal(defaultGradeTerm('2027-03-01'), 2)
  })

  test('DOM-AKD-004 eksik seçim ve gelecek tarih pencereyi açmaz', () => {
    assert.equal(evaluationProblem({ date: '2026-11-03' }, '2026-11-03'), 'Sınıf seçin.')
    assert.equal(evaluationProblem({ ...KEY, subjectId: '' }, KEY.date), 'Ders seçin.')
    assert.equal(
      evaluationProblem({ ...KEY, date: '2026-11-04' }, '2026-11-03'),
      GRADE_MESSAGES.grade_future_date,
    )
    assert.equal(evaluationProblem({ ...KEY, date: 'bugün' }, KEY.date), 'Tarih seçin.')
    assert.equal(evaluationProblem(KEY, '2026-11-03'), null)
  })
})

describe('OG-062 mobil not girişi: puan doğrulama', () => {
  test('DOM-AKD-003 boş alan boştur, sınırlar 0 ve 100 dahildir', () => {
    assert.deepEqual(parseScore(''), { status: 'empty' })
    assert.deepEqual(parseScore('  '), { status: 'empty' })
    assert.deepEqual(parseScore('0'), { status: 'ok', score: 0 })
    assert.deepEqual(parseScore('100'), { status: 'ok', score: 100 })
    assert.deepEqual(parseScore(' 85 '), { status: 'ok', score: 85 })
  })

  test('DOM-AKD-003 sınır dışı, ondalık ve sayı olmayan değer core iletisiyle reddedilir', () => {
    const range = { status: 'invalid', message: 'Puan 0 ile 100 arasında olmalıdır.' }
    assert.deepEqual(parseScore('101'), range)
    assert.deepEqual(parseScore('-1'), range)
    assert.deepEqual(parseScore('85.5'), { status: 'invalid', message: 'Puan tam sayı olmalıdır.' })
    // Ondalık virgülle yazılan değer de sayı değildir; sessizce 0 ya da 85 yapılmaz.
    assert.equal(parseScore('85,5').status, 'invalid')
    assert.equal(parseScore('1e1').status, 'invalid')
    assert.equal(parseScore('abc').status, 'invalid')
  })
})

describe('OG-062 mobil not girişi: mevcut notlar', () => {
  test('yalnız aynı ders, tür, dönem ve gün eşlenir', () => {
    const map = existingGrades(
      [
        row('g1', 's1'),
        row('g2', 's2', { score: 55 }),
        row('g-ders', 's3', { subjectId: 'test-sub-fen' }),
        row('g-tur', 's4', { assessmentType: 'proje' }),
        row('g-donem', 's5', { term: 2 }),
        row('g-gun', 's6', { date: '2026-11-02T09:00:00.000Z' }),
        row('g-eski', 's7', { assessmentType: undefined }),
        row('g-tarihsiz', 's8', { date: undefined }),
        row('g-kopya', 's1', { score: 10 }),
      ],
      KEY,
    )
    assert.deepEqual([...map.keys()], ['s1', 's2'])
    assert.equal(map.get('s1')?.id, 'g1')
    assert.equal(map.get('s1')?.version, 3)
    assert.equal(map.get('s2')?.score, 55)
    assert.equal(map.get('s1')?.fromQuiz, false)
  })

  test('quizden aktarılan not işaretlenir', () => {
    assert.equal(existingGrades([row('g1', 's1', { quizId: 'q1' })], KEY).get('s1')?.fromQuiz, true)
  })

  test('Europe/Istanbul günü: gece yarısından sonra yazılan UTC tarihi ertesi güne eşlenir', () => {
    const map = existingGrades([row('g1', 's1', { date: '2026-11-02T22:30:00.000Z' })], KEY)
    assert.equal(map.size, 1)
  })

  test('girilmiş değerlendirmeler yeni tarihten eskiye, notu sayılarak gruplanır', () => {
    const list = knownEvaluations([
      row('a', 's1'),
      row('b', 's2'),
      row('c', 's1', { date: '2026-10-20T09:00:00.000Z', assessmentType: 'proje', term: 1 }),
      row('d', 's1', { assessmentType: 'bilinmeyen' }),
      row('e', 's1', { term: 3 }),
    ])
    assert.deepEqual(list, [
      { key: { assessmentType: 'sinav', term: 1, date: '2026-11-03' }, count: 2 },
      { key: { assessmentType: 'proje', term: 1, date: '2026-10-20' }, count: 1 },
    ])
  })

  test('alan metni: dokunulmuşsa yazılan, yoksa kayıtlı puan', () => {
    assert.equal(displayScore(grade('s1', 80), undefined), '80')
    assert.equal(displayScore(grade('s1', 80), '85'), '85')
    // Alanı temizleyen öğrencide boş kalır; kayıtlı puan geri gelmez.
    assert.equal(displayScore(grade('s1', 80), ''), '')
    assert.equal(displayScore(undefined, undefined), '')
  })
})

describe('OG-062 mobil not girişi: sürüm sabitleme', () => {
  test('düzeltme sabitlenen sürümle gider; sonradan değişen sürüm onu değiştirmez', () => {
    const opened = new Map([['s1', grade('s1', 60)]])
    const pins = pinVersions(opened)
    assert.deepEqual(pins, { 'g-s1': 4 })
    // Başka cihaz notu düzeltti: canlı sürüm 5, ekran hâlâ 4 ile gider ve sunucu 409 verir.
    const live = new Map([['s1', { ...grade('s1', 65), version: 5 }]])
    assert.equal(withPinnedVersions(live, pins).get('s1')?.version, 4)
    const plan = planGradeSave({
      studentIds: ['s1'],
      existing: withPinnedVersions(live, pins),
      edits: { s1: '90' },
      reason: 'Kâğıt yeniden okundu',
    })
    assert.equal(plan.items[0]?.kind === 'update' && plan.items[0].version, 4)
  })

  test('sabitleme yokken ve sonradan görünen notta güncel sürüm kullanılır', () => {
    const live = new Map([['s1', grade('s1', 60)]])
    assert.equal(withPinnedVersions(live, null), live)
    assert.equal(withPinnedVersions(live, {}).get('s1')?.version, 4)
  })
})

describe('OG-062 mobil not girişi: kaydet kararı', () => {
  const studentIds = ['s1', 's2', 's3', 's4']

  test('DOM-AKD-004 kayıtsız öğrencide dolu alan yeni not, boş alan değişmeyendir', () => {
    const plan = planGradeSave({
      studentIds,
      existing: new Map(),
      edits: { s1: '90', s2: '', s3: '  ' },
      reason: '',
    })
    assert.deepEqual(
      plan.items.map((item) => [item.studentId, item.kind]),
      [
        ['s1', 'create'],
        ['s2', 'unchanged'],
        ['s3', 'unchanged'],
        ['s4', 'unchanged'],
      ],
    )
    assert.equal(plan.created, 1)
    assert.equal(plan.updated, 0)
    assert.equal(plan.reasonError, null)
    assert.equal(plan.ready, true)
  })

  test('DOM-AKD-051 kayıtlıda farklı puan düzeltmedir ve gerekçe ister; aynı puan değişmeyendir', () => {
    const existing = new Map([
      ['s1', grade('s1', 60)],
      ['s2', grade('s2', 70)],
      ['s3', grade('s3', 80)],
    ])
    const input = { studentIds, existing, edits: { s1: '75', s2: '70' } }
    const withoutReason = planGradeSave({ ...input, reason: '' })
    assert.deepEqual(
      withoutReason.items.map((item) => item.kind),
      ['update', 'unchanged', 'unchanged', 'unchanged'],
    )
    assert.equal(withoutReason.reasonError, 'Düzeltme için gerekçe yazın.')
    assert.equal(withoutReason.ready, false)
    const planned = planGradeSave({ ...input, reason: 'Kâğıt yeniden okundu' })
    assert.equal(planned.ready, true)
    assert.deepEqual(planned.items[0], {
      kind: 'update',
      studentId: 's1',
      score: 75,
      gradeId: 'g-s1',
      version: 4,
    })
  })

  test('düzeltme yoksa gerekçe istenmez', () => {
    const plan = planGradeSave({ studentIds, existing: new Map(), edits: { s1: '50' }, reason: '' })
    assert.equal(plan.reasonError, null)
  })

  test('geçersiz puan, boşaltılmış kayıtlı puan ve quiz notu hiçbir isteği göndermez', () => {
    const existing = new Map([
      ['s1', grade('s1', 60)],
      ['s2', grade('s2', 70, true)],
    ])
    const plan = planGradeSave({
      studentIds,
      existing,
      edits: { s1: '', s2: '90', s3: '120', s4: '55' },
      reason: 'gerekçe yazıldı',
    })
    assert.deepEqual(
      plan.items.map((item) => item.kind),
      ['invalid', 'invalid', 'invalid', 'create'],
    )
    assert.equal(plan.invalid, 3)
    assert.equal(plan.ready, false)
    const messages = plan.items.flatMap((item) => (item.kind === 'invalid' ? [item.message] : []))
    assert.ok(messages.includes(GRADE_MESSAGES.grade_score_from_quiz))
    assert.ok(messages.includes('Puan 0 ile 100 arasında olmalıdır.'))
  })

  test('hiç değişiklik yoksa kayda hazır değildir', () => {
    const plan = planGradeSave({
      studentIds,
      existing: new Map([['s1', grade('s1', 60)]]),
      edits: { s1: '60' },
      reason: '',
    })
    assert.equal(plan.ready, false)
    assert.equal(plan.created + plan.updated + plan.invalid, 0)
  })

  test('gönderim yükü: tek öğrenci, konu boşsa gönderilmez, gerekçe kırpılır', () => {
    assert.deepEqual(gradeCreateInput(KEY, { kind: 'create', studentId: 's1', score: 88 }, ' '), {
      studentId: 's1',
      subjectId: 'test-sub-mat',
      term: 1,
      assessmentType: 'sinav',
      date: '2026-11-03',
      score: 88,
    })
    assert.equal(
      gradeCreateInput(KEY, { kind: 'create', studentId: 's1', score: 88 }, ' Kesirler ').topic,
      'Kesirler',
    )
    assert.deepEqual(
      gradeUpdateInput(
        { kind: 'update', studentId: 's1', score: 75, gradeId: 'g1', version: 4 },
        '  Kâğıt yeniden okundu ',
      ),
      { gradeId: 'g1', score: 75, reason: 'Kâğıt yeniden okundu', gradeVersion: 4 },
    )
  })
})

describe('OG-062 mobil not girişi: hata eşleme ve sonuç', () => {
  test('koda özgü Türkçe iletiler, olmayan kodda sunucu iletisi', () => {
    assert.equal(
      gradeFailureText(apiError(403, 'grade_assignment_forbidden')),
      GRADE_MESSAGES.grade_assignment_forbidden,
    )
    assert.equal(
      gradeFailureText(apiError(409, 'version_conflict')),
      GRADE_MESSAGES.version_conflict,
    )
    assert.equal(gradeFailureText(apiError(409, 'grade_duplicate')), GRADE_MESSAGES.grade_duplicate)
    assert.equal(gradeFailureText(apiError(404, 'not_found')), GRADE_MESSAGES.not_found)
    assert.equal(
      gradeFailureText(apiError(422, 'baska_kural', 'Türkçe sunucu iletisi')),
      'Türkçe sunucu iletisi',
    )
  })

  test('oturum hatasında (401) ileti yoktur; giriş ekranına düşülür', () => {
    assert.equal(gradeFailureText(apiError(401, 'unauthorized')), null)
  })

  test('yalnız ağ ve sunucu (5xx) hatası belirsizdir; kural hatası kesindir', () => {
    assert.equal(isUncertainFailure(apiError(503, 'unavailable')), true)
    assert.equal(isUncertainFailure(apiError(409, 'version_conflict')), false)
    assert.equal(isUncertainFailure(apiError(422, 'grade_future_date')), false)
  })

  test('özet kaydedilen ve düzeltilen notları sayar; başarısız ve atlananı saymaz', () => {
    assert.equal(
      saveSummary({
        s1: { status: 'saved', kind: 'create', score: 80 },
        s2: { status: 'saved', kind: 'create', score: 80 },
        s3: { status: 'saved', kind: 'update', score: 80 },
        s4: { status: 'failed', message: 'x', conflict: false },
        s5: { status: 'skipped' },
      }),
      '2 not kaydedildi, 1 not düzeltildi.',
    )
    assert.equal(saveSummary({ s1: { status: 'failed', message: 'x', conflict: false } }), null)
  })

  test('başarılı öğrencinin işareti düşer; başarısız ve atlanan girilen puanla kalır', () => {
    const edits = { s1: '90', s2: '80', s3: '70', s4: '60' }
    assert.deepEqual(
      withoutSaved(edits, {
        s1: { status: 'saved', kind: 'create', score: 80 },
        s2: { status: 'failed', message: 'x', conflict: false },
        s3: { status: 'skipped' },
      }),
      { s2: '80', s3: '70', s4: '60' },
    )
  })
})
