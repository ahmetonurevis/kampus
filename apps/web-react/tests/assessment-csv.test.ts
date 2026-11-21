import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import {
  exampleOpticalFile,
  keyHeader,
  parseAnswerKey,
  planTutoring,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { TutoringPlanPreview } from '@kampus/react-shared/use-assessment-commands.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { delimitedRows } from '@kampus/school-core/lib/delimited-input.ts'
import { toCsv } from '../src/lib/csv.ts'
import {
  answerKeyCsv,
  PLAN_CSV_COLUMNS,
  planCsvRows,
  RESULT_CSV_COLUMNS,
  resultCsvRows,
  TUTOR_CSV_COLUMNS,
  tutorCsvRows,
} from '../src/pages/assessment/assessment-csv.ts'
import { evaluationRows } from '../src/pages/assessment/optical-model.ts'
import { planView, tutorRows } from '../src/pages/assessment/tutoring-model.ts'

// DOM-DEG-… optik/etüt CSV'leri: ekrandaki kapsamla aynı satırlar, formül kaçışı, içe aktarma
// biçiminde cevap anahtarı şablonu.
const NOW = '2026-10-30T09:00:00.000Z'
const admin: Session = { role: 'yonetici' }
const student: Session = { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] }

let counter = 0
const makeId = (prefix: string) => `${prefix}-test-${++counter}`

function evaluated(): State {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const text = exampleOpticalFile(state, profile)
  runAssessment(state, admin, 'evaluate', { profileId: profile.id, text }, makeId, '', NOW)
  return state
}

const planInput = {
  examId: 'exam-7-1',
  threshold: 100,
  fromDate: '2026-10-30',
  toDate: '2026-11-20',
  duration: 30,
  maxGroupSize: 6,
  branchId: '',
  subjectId: '',
}

/** CSV metnini içe aktarma ayrıştırıcısıyla satırlara böler. */
const parse = (csv: string) => delimitedRows(csv)

test('sonuç CSV başlığı ve satırı Vue sütunlarıyla; her satır kayıtlı analizdir', () => {
  const state = evaluated()
  const rows = evaluationRows(state, admin)
  assert.ok(rows.length > 0)
  const parsed = parse(toCsv(RESULT_CSV_COLUMNS, resultCsvRows(rows)))
  assert.deepEqual(parsed[0], [
    'Öğrenci',
    'Deneme',
    'Ders',
    'Kitapçık',
    'Doğru',
    'Yanlış',
    'Boş',
    'Çoklu işaret',
    'İptal soru',
    'Net',
    'Durum',
    'Açıklama',
  ])
  assert.equal(parsed.length, rows.length + 1)
  const first = rows[0]
  assert.ok(first)
  assert.deepEqual(parsed[1]?.slice(0, 4), [
    first.student,
    first.exam,
    first.subject,
    first.booklet,
  ])
  assert.equal(parsed[1]?.[4], String(first.correct))
  assert.equal(parsed[1]?.[10], 'Güncel')
})

test('anahtarı değişen analiz CSV’de "Eski analiz" ve nedeniyle yazılır', () => {
  const state = evaluated()
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  profile.revision += 1
  const rows = resultCsvRows(evaluationRows(state, admin))
  assert.ok(rows.every((row) => row.status === 'Eski analiz'))
  assert.match(rows[0]?.reason ?? '', /Cevap anahtarı değişti/)
})

test('sonuç CSV hücreleri formül enjeksiyonuna karşı kaçılır', () => {
  const state = evaluated()
  const row = { ...evaluationRows(state, admin)[0]!, student: '=HYPERLINK("http://x")' }
  const csv = toCsv(RESULT_CSV_COLUMNS, resultCsvRows([row]))
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`))
  assert.ok(!csv.includes(`;"=HYPERLINK`))
})

test('cevap anahtarı şablonu ham alan adlarıyla başlar ve içe aktarma ayrıştırıcısı onu okur', () => {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const csv = answerKeyCsv(profile)
  assert.equal(csv.split('\r\n')[0], keyHeader.map((name) => `"${name}"`).join(';'))
  const parsed = parse(csv)
  assert.deepEqual(parsed[0], [...keyHeader])
  const questions = profile.keys.flatMap((key) => key.questions.map((q) => ({ key, q })))
  assert.equal(parsed.length, questions.length + 1)
  assert.deepEqual(parsed[1], [
    questions[0]!.key.booklet,
    String(questions[0]!.q.number),
    questions[0]!.q.subjectId,
    questions[0]!.q.topic,
    questions[0]!.q.answer,
  ])
})

test('indirilen cevap anahtarı değişmeden yeniden içe aktarılır (iptal soru dahil)', () => {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const exam = state.mockExams.find((item) => item.id === profile.examId)
  assert.ok(exam)
  // Her kitapçıkta aynı ders/kazanımlı bir soru iptal edilir; `-` kaçış almadan yazılmalıdır.
  const [a, b] = profile.keys
  assert.ok(a && b)
  const first = a.questions[0]!
  const twin = b.questions.find((q) => q.subjectId === first.subjectId && q.topic === first.topic)
  assert.ok(twin)
  first.answer = '-'
  twin.answer = '-'
  const csv = answerKeyCsv(profile)
  assert.ok(!csv.includes(`'-`))
  const imported = parseAnswerKey(state, exam, csv)
  assert.deepEqual(imported, profile.keys, 'şablon asıl anahtarla aynı yapıyı üretir')
  assert.equal(imported[0]?.questions[0]?.answer, '-')
})

test('Türkçe karakterli ve ayraçlı kazanım içe aktarmada bozulmaz', () => {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const exam = state.mockExams.find((item) => item.id === profile.examId)
  assert.ok(exam)
  const oldTopic = profile.keys[0]!.questions[1]!.topic
  const topic = 'Üslü "ifadeler"; Çarpanlara ayırma'
  for (const key of profile.keys)
    for (const question of key.questions) if (question.topic === oldTopic) question.topic = topic
  const imported = parseAnswerKey(state, exam, answerKeyCsv(profile))
  assert.deepEqual(imported, profile.keys)
  assert.equal(imported[0]?.questions[1]?.topic, topic)
})

test('indirilen dosyadaki UTF-8 BOM içe aktarmayı bozmaz', () => {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const bom = String.fromCharCode(0xfeff)
  assert.deepEqual(delimitedRows(`${bom}${answerKeyCsv(profile)}`), parse(answerKeyCsv(profile)))
})

test('kazanım metnindeki formül karakteri kaçışla yazılır', () => {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  profile.keys[0]!.questions[0]!.topic = '=1+1'
  const row = parse(answerKeyCsv(profile))[1]
  assert.equal(row?.[3], "'=1+1")
})

test('etüt CSV’si ekrandaki satırları ve rol kapsamını izler', () => {
  const state = evaluated()
  runAssessment(state, admin, 'plan', planInput, makeId, '', NOW)
  const all = tutorRows(state, admin, NOW)
  assert.ok(all.length > 0)
  const parsed = parse(toCsv(TUTOR_CSV_COLUMNS, tutorCsvRows(all)))
  assert.deepEqual(parsed[0], [
    'Etüt / Kazanım',
    'Öğretmen',
    'Kampüs',
    'Tarih',
    'Derslik',
    'Öğrenciler',
    'Durum',
  ])
  assert.equal(parsed.length, all.length + 1)
  assert.equal(parsed[1]?.[1], all[0]?.teacher)
  assert.equal(parsed[1]?.[2], all[0]?.campus)
  assert.notEqual(parsed[1]?.[2], '—')

  // Öğrenci yalnız kendi adını içeren satırları indirir: başkasının adı CSV'ye girmez.
  const own = tutorRows(state, student, NOW)
  const ownCsv = toCsv(TUTOR_CSV_COLUMNS, tutorCsvRows(own))
  assert.equal(parse(ownCsv).length, own.length + 1)
  const others = state.students.filter((item) => item.id !== 's1').map((item) => item.name)
  for (const name of others) assert.ok(!ownCsv.includes(name), name)
})

test('etüt CSV hücreleri formül enjeksiyonuna karşı kaçılır', () => {
  const state = evaluated()
  runAssessment(state, admin, 'plan', planInput, makeId, '', NOW)
  const row = { ...tutorRows(state, admin, NOW)[0]!, room: '@SUM(A1)', title: '+90 555' }
  const csv = toCsv(TUTOR_CSV_COLUMNS, tutorCsvRows([row]))
  assert.ok(csv.includes(`"'@SUM(A1)"`))
  assert.ok(csv.includes(`"'+90 555"`))
})

test('plan önizleme CSV’si planlanabilir etütleri yerleşimle yazar', () => {
  const state = evaluated()
  const view = planView(serverPreview(state), state)
  assert.ok(view.sessions.length > 0)
  const rows = planCsvRows(view)
  assert.equal(rows.length, view.sessions.length + view.unresolved.length)
  const parsed = parse(toCsv(PLAN_CSV_COLUMNS, rows))
  assert.deepEqual(parsed[0], [
    'Etüt / Kazanım',
    'Öğretmen',
    'Kampüs',
    'Tarih',
    'Derslik',
    'Öğrenciler',
    'Durum',
    'Açıklama',
  ])
  assert.equal(parsed.length, rows.length + 1)
  const planned = view.sessions[0]!
  assert.deepEqual(parsed[1]?.slice(0, 6), [
    planned.title,
    planned.teacher,
    planned.campus,
    planned.when,
    planned.room,
    planned.students,
  ])
  assert.notEqual(planned.campus, planned.title)
  assert.match(parsed[1]?.[6] ?? '', /^Planlanabilir/)
})

test('uygunluk saati yokken gerçek plan yerleşemeyen grupları neden ve kampüsle yazar', () => {
  const state = evaluated()
  state.availability = []
  const view = planView(serverPreview(state), state)
  assert.ok(view.unresolved.length > 0)
  const parsed = parse(toCsv(PLAN_CSV_COLUMNS, planCsvRows(view)))
  assert.equal(parsed.length, view.unresolved.length + 1)
  for (const row of parsed.slice(1)) {
    assert.equal(row[6], 'Yerleştirilemedi')
    assert.ok((row[7] ?? '').length > 0)
    assert.ok(!/^branch-/.test(row[2] ?? ''))
  }
})

test('yerleşemeyen grup CSV’de neden ve boş yerleşimle yazılır', () => {
  const rows = planCsvRows({
    sessions: [],
    unresolved: [
      {
        key: 'k',
        title: 'Matematik · Denklemler',
        campus: 'Merkez Kampüs',
        students: 'Deniz Yılmaz',
        studentCount: 1,
        reason: 'Uygun öğretmen saati yok.',
      },
    ],
  })
  const parsed = parse(toCsv(PLAN_CSV_COLUMNS, rows))
  assert.deepEqual(parsed[1], [
    'Matematik · Denklemler',
    '—',
    'Merkez Kampüs',
    '—',
    '—',
    'Deniz Yılmaz',
    'Yerleştirilemedi',
    'Uygun öğretmen saati yok.',
  ])
})

function serverPreview(state: State): TutoringPlanPreview {
  const plan = planTutoring(state, admin, planInput, NOW)
  return {
    ...plan,
    summary: {
      sessionCount: plan.sessions.length,
      plannedStudentCount: 0,
      unresolvedGroupCount: plan.unresolved.length,
      unresolvedStudentCount: 0,
      coveredCount: plan.covered.length,
    },
    expectedPlan: '',
  } as TutoringPlanPreview
}
