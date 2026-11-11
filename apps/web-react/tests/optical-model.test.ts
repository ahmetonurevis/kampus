import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import {
  automationSchemas,
  exampleOpticalFile,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import {
  answerFileProblem,
  answerTextProblem,
  decodeAnswerFile,
  formFieldOf,
  evaluationRows,
  examsWithoutProfile,
  profileFormDefaults,
  profileGaps,
  profileRows,
} from '../src/pages/assessment/optical-model.ts'

const NOW = '2026-10-30T09:00:00.000Z'
const admin: Session = { role: 'yonetici' }

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

test('UTF-8 dosya olduğu gibi, Windows-1254 dosya Türkçe karakterleri bozmadan çözülür', () => {
  const utf8 = new TextEncoder().encode('student;booklet;answers\n2026001;A;şğı')
  assert.deepEqual(decodeAnswerFile(utf8), {
    text: 'student;booklet;answers\n2026001;A;şğı',
    encoding: 'utf-8',
  })
  // Windows-1254: ş=0xFE, ğ=0xF0, ı=0xFD (geçerli UTF-8 değildir).
  const legacy = Uint8Array.from([0x41, 0x3b, 0xfe, 0xf0, 0xfd])
  assert.deepEqual(decodeAnswerFile(legacy), { text: 'A;şğı', encoding: 'windows-1254' })
  // UTF-8 BOM metne karışmaz.
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])
  assert.equal(decodeAnswerFile(bom).text, 'A')
})

test('yapıştırılan metin 1 MB üstündeyse reddedilir (bayt olarak ölçülür)', () => {
  assert.equal(answerTextProblem('a'.repeat(1024 * 1024)), null)
  assert.match(answerTextProblem('a'.repeat(1024 * 1024 + 1)) ?? '', /1 MB/)
  // Çok baytlı karakterler karakter sayısıyla değil bayt sayısıyla sayılır.
  assert.match(answerTextProblem('ş'.repeat(600_000)) ?? '', /1 MB/)
})

test('profil formu varsayılanları: yeni profil CSV ve okul numarası, düzenleme kayıttan', () => {
  const state = fresh()
  const created = profileFormDefaults(undefined, 'exam-8-1')
  assert.equal(created.examId, 'exam-8-1')
  assert.equal(created.format, 'csv')
  assert.equal(created.identifier, 'number')
  assert.match(String(created.keyCsv), /^booklet;question;subjectId;topic;answer/)
  const profile = profileOf(state)
  const edited = profileFormDefaults(profile, 'baska')
  assert.equal(edited.examId, profile.examId)
  assert.equal(edited.title, profile.title)
  assert.equal(edited.keyCsv, profile.keyCsv)
  // Varsayılan değerler core profil şemasından geçer (ek alan istenmez).
  const parsed = automationSchemas.profile.safeParse({ ...created, title: 'Yeni profil' })
  assert.ok(parsed.success)
})

test('sunucu alan yolu forma tek alan olarak bağlanır', () => {
  assert.equal(formFieldOf('keyCsv.line.4'), 'keyCsv')
  assert.equal(formFieldOf('title'), 'title')
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
