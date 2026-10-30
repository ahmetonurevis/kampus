import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { exampleOpticalFile, runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import {
  answerFileProblem,
  evaluationRows,
  examsWithoutProfile,
  previewAnswerFile,
  previewSummary,
  profileGaps,
  profileRows,
} from '../src/pages/assessment/optical-model.ts'

const NOW = '2026-10-30T09:00:00.000Z'
const admin: Session = { role: 'yonetici' }
const teacher: Session = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }

const fresh = (): State => structuredClone(createSeed(new Date(NOW)))
let counter = 0
const makeId = (prefix: string) => `${prefix}-test-${++counter}`

function profileOf(state: State) {
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  return profile
}

test('cevap dosyası türü ve boyutu denetlenir', () => {
  assert.equal(answerFileProblem({ name: 'cevaplar.csv', size: 10 }), null)
  assert.equal(answerFileProblem({ name: 'okuyucu.DAT', size: 10 }), null)
  assert.equal(answerFileProblem({ name: 'okuyucu.txt', size: 1024 * 1024 }), null)
  assert.match(answerFileProblem({ name: 'cevaplar.pdf', size: 10 }) ?? '', /CSV, DAT veya TXT/)
  assert.match(answerFileProblem({ name: 'cevaplar.csv', size: 1024 * 1024 + 1 }) ?? '', /1 MB/)
})

test('profil satırı kitapçıkları, soru sayısını ve eksikleri gösterir', () => {
  const state = fresh()
  const [row] = profileRows(state)
  assert.equal(row?.examId, 'exam-7-1')
  assert.equal(row?.format, 'CSV')
  assert.equal(row?.identifier, 'Okul numarası')
  assert.equal(row?.questionCount, 12)
  assert.equal(row?.booklets, 'A, B')
  assert.deepEqual(row?.gaps, profileGaps(state, profileOf(state)))
})

test('anahtarında dersi olmayan veya kazanımı boş profil eksik raporlanır', () => {
  const state = fresh()
  const profile = profileOf(state)
  const exam = state.mockExams.find((item) => item.id === profile.examId)
  assert.ok(exam)
  const covered = new Set(profile.keys.flatMap((key) => key.questions.map((q) => q.subjectId)))
  for (const subjectId of exam.subjectIds)
    if (!covered.has(subjectId))
      assert.ok(profileGaps(state, profile).some((gap) => gap.includes('anahtar sorusu yok')))
  const first = profile.keys[0]?.questions[0]
  assert.ok(first)
  first.topic = ' '
  assert.ok(profileGaps(state, profile).includes('Kazanımı boş soru var.'))
  state.mockExams = []
  assert.deepEqual(profileGaps(state, profile), ['Profilin denemesi bulunamadı.'])
})

test('profili olmayan denemeler yöneticide listelenir', () => {
  const state = fresh()
  const ids = examsWithoutProfile(state, admin).map((exam) => exam.id)
  assert.ok(!ids.includes('exam-7-1'))
  assert.ok(ids.includes('exam-8-1'))
})

test('geçerli dosya önizlenir; kayıt oluşmaz ve özet sayıları doğrudur', () => {
  const state = fresh()
  const before = JSON.stringify(state)
  const text = exampleOpticalFile(state, profileOf(state))
  const preview = previewAnswerFile(state, admin, profileOf(state).id, text)
  assert.ok(preview.ok)
  assert.equal(JSON.stringify(state), before)
  assert.equal(preview.summary.students, 3)
  assert.equal(preview.summary.results, preview.rows.length)
  assert.deepEqual(preview.summary, previewSummary(preview.rows))
})

test('ön kontrol hataları satır numarasıyla bildirilir', () => {
  const state = fresh()
  const id = profileOf(state).id
  const head = 'student;booklet;answers\n'
  const unmatched = previewAnswerFile(state, admin, id, `${head}9999999;A;BBBDABCDABCD\n`)
  assert.ok(!unmatched.ok)
  assert.equal(unmatched.code, 'optical_student_unmatched')
  assert.match(unmatched.message, /2\. satırdaki öğrenci tekil eşleşmedi: 9999999/)

  const short = previewAnswerFile(state, admin, id, `${head}2026001;A;BBB\n`)
  assert.ok(!short.ok)
  assert.equal(short.code, 'optical_answer_count_mismatch')
  assert.match(short.message, /2\. satırda 12 cevap bekleniyor/)

  assert.ok(!previewAnswerFile(state, admin, id, 'ad;puan\n2026001;5\n').ok)

  const row = '2026001;A;BBBDABCDABCD\n'
  const duplicate = previewAnswerFile(state, admin, id, `${head}${row}${row}`)
  assert.ok(!duplicate.ok)
  assert.match(duplicate.message, /3\. satırda öğrenci yineleniyor/)

  assert.ok(!previewAnswerFile(state, admin, id, '').ok)
})

test('bilinmeyen profil hata olur; öğretmen yalnız kendi dersini görür', () => {
  const state = fresh()
  const profile = profileOf(state)
  const missing = previewAnswerFile(state, admin, 'yok', 'student;booklet;answers\n')
  assert.ok(!missing.ok)
  assert.equal(missing.code, 'record_not_found')
  const text = exampleOpticalFile(state, profile, teacher)
  const own = previewAnswerFile(state, teacher, profile.id, text)
  if (own.ok) assert.ok(own.rows.every((row) => row.subjectId === 'math'))
})

test('kayıtlı analiz güncelken kullanılabilir; anahtar veya sonuç değişince eski sayılır', () => {
  const state = fresh()
  const profile = profileOf(state)
  const text = exampleOpticalFile(state, profile)
  runAssessment(state, admin, 'evaluate', { profileId: profile.id, text }, makeId, '', NOW)
  const rows = evaluationRows(state, admin)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((row) => row.current && row.staleReason === ''))

  const afterKey = structuredClone(state)
  const changed = afterKey.opticalProfiles[0]
  assert.ok(changed)
  changed.revision += 1
  const keyRows = evaluationRows(afterKey, admin)
  assert.ok(keyRows.every((row) => !row.current && /anahtarı değişti/.test(row.staleReason)))

  const afterResult = structuredClone(state)
  for (const result of afterResult.mockResults) if (result.evaluationId) result.evaluationId = null
  const resultRows = evaluationRows(afterResult, admin)
  assert.ok(resultRows.every((row) => !row.current && /sonucu değişti/.test(row.staleReason)))
})
