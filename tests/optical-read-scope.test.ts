import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import { runAssessment } from '../packages/school-core/src/lib/assessment-automation.ts'
import { scopeFor, type Actor } from '../packages/school-core/src/lib/scope.ts'
import {
  workflowDetails,
  workflowRows,
} from '../packages/school-core/src/lib/workflow-presentation.ts'

const now = '2026-10-06T10:00:00.000Z'
const admin: Session = { role: 'yonetici', childId: 's1' }
let serial = 0
const id = (prefix: string) => `${prefix}-optical-read-${++serial}`

// s1 ve s25 aynı sınıfta (7-A); iki öğrencinin optik sonucu vardır.
function evaluated(): State {
  const state = createSeed(new Date(now))
  runAssessment(
    state,
    admin,
    'evaluate',
    {
      profileId: 'optical-exam-7-1',
      text: 'student;booklet;answers\n2026001;A;BBBDABCDABCD\n2026025;A;ABCDABCDABCD',
    },
    id,
    '',
    now,
  )
  return state
}

const actors: Record<string, Actor> = {
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
  veli: { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
  yabanciOgrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's2' }] },
  onburo: { role: 'onburo', links: [] },
}

test('Öğrenci ve veli optik analizde yalnız kendi/bağlı çocuğunun satırını okur', () => {
  const state = evaluated()
  assert.ok(state.opticalEvaluations.some((e) => e.studentId === 's25'))
  for (const key of ['ogrenci', 'veli']) {
    const scope = scopeFor(state, actors[key]!)
    assert.deepEqual(scope.access('opticalEvaluations'), { allowed: true }, key)
    const rows = scope.read('opticalEvaluations', state.opticalEvaluations)
    assert.ok(rows.length > 0, key)
    assert.ok(
      rows.every((row) => row.studentId === 's1'),
      `${key} başkasının sonucunu görmemeli`,
    )
  }
  // Başka sınıftaki öğrenci hiçbir satır görmez.
  const stranger = scopeFor(state, actors.yabanciOgrenci!)
  assert.deepEqual(stranger.read('opticalEvaluations', state.opticalEvaluations), [])
})

test('Öğrenci ve veli profili okur ama cevap anahtarı alanları gelmez; kaynak kayıt korunur', () => {
  const state = evaluated()
  for (const key of ['ogrenci', 'veli']) {
    const scope = scopeFor(state, actors[key]!)
    assert.deepEqual(scope.access('opticalProfiles'), { allowed: true })
    assert.deepEqual(scope.hiddenFields('opticalProfiles'), ['keyCsv', 'keys'])
    const [profile] = scope.read('opticalProfiles', state.opticalProfiles)
    assert.ok(profile)
    assert.equal(profile.revision, 1)
    assert.equal('keyCsv' in profile, false)
    assert.equal('keys' in profile, false)
  }
  assert.ok(state.opticalProfiles[0]!.keyCsv.length > 0)
  // Yönetici ve öğretmen anahtarı görmeye devam eder.
  const teacher = scopeFor(state, {
    role: 'ogretmen',
    links: [{ kind: 'teacher', recordId: 't1' }],
  })
  assert.deepEqual(teacher.hiddenFields('opticalProfiles'), [])
  assert.deepEqual(
    scopeFor(state, { role: 'yonetici', links: [] }).hiddenFields('opticalProfiles'),
    [],
  )
})

test('Ön büro optik koleksiyonları okuyamaz; kapalı modül öğrenciye de kapalıdır', () => {
  const state = evaluated()
  for (const name of ['opticalEvaluations', 'opticalProfiles'])
    assert.deepEqual(scopeFor(state, actors.onburo!).access(name), {
      allowed: false,
      reason: 'role_denied',
    })
  state.modules.optical = false
  for (const key of ['ogrenci', 'veli'])
    assert.deepEqual(scopeFor(state, actors[key]!).access('opticalEvaluations'), {
      allowed: false,
      reason: 'module_disabled',
    })
})

test('Kapsamdan okunan State ile deneme ayrıntısı öğrencinin kendi analizini gösterir', () => {
  const full = evaluated()
  const actor = actors.ogrenci!
  const scope = scopeFor(full, actor)
  // API'deki gibi: koleksiyonlar kapsamdan geçmiş, anahtar alanları ayıklanmış olarak kurulur.
  const read = {
    ...full,
    opticalProfiles: scope.read('opticalProfiles', full.opticalProfiles),
    opticalEvaluations: scope.read('opticalEvaluations', full.opticalEvaluations),
  } as unknown as State
  const session: Session = { role: 'ogrenci', childId: 's1' }
  const [exam] = workflowRows(read, session, 'deneme-sinavlari', now).filter(
    (row) => row.id === 'exam-7-1',
  )
  assert.ok(exam)
  const details = workflowDetails(read, session, exam)
  const titles = details.sections.map((section) => section.title)
  assert.ok(titles.includes('Optik kazanım analizi'))
  assert.ok(titles.includes('Optik soru ayrıntıları'))
  assert.equal(titles.includes('Değerlendirme durumu'), false, 'anahtar eşleşir, uyarı çıkmaz')
  const text = JSON.stringify(details.sections)
  assert.ok(text.includes('Deniz Yılmaz'))
  assert.equal(text.includes(full.students.find((s) => s.id === 's25')!.name), false)
})

// Başka düzeyin denemesine ait profil başlığı, yerleşimi ve revizyonu da öğrenci/veliye kapalıdır.
function withForeignProfiles(): State {
  const state = evaluated()
  const base = state.opticalProfiles[0]!
  for (const examId of ['exam-5-1', 'exam-8-1'])
    state.opticalProfiles.push({
      ...base,
      id: `optical-${examId}`,
      examId,
      title: `Profil ${examId}`,
    })
  return state
}

test('Öğrenci ve veli yalnız kendi düzeyindeki denemenin profilini görür; liste tam okunmaz', () => {
  const state = withForeignProfiles()
  for (const key of ['ogrenci', 'veli']) {
    const scope = scopeFor(state, actors[key]!)
    assert.equal(scope.readsWhole('opticalProfiles'), false, `${key} süzgeçsiz tam okuma yapmaz`)
    const rows = scope.read('opticalProfiles', state.opticalProfiles)
    assert.deepEqual(
      rows.map((row) => row.examId),
      ['exam-7-1'],
      key,
    )
    for (const foreign of state.opticalProfiles.filter((p) => p.examId !== 'exam-7-1'))
      assert.equal(scope.canRead('opticalProfiles', foreign), false, `${key} ${foreign.examId}`)
  }
  // 5. sınıf öğrencisi kendi düzeyinin profilini görür, 7. sınıfınkini görmez.
  const fifth = scopeFor(state, actors.yabanciOgrenci!)
  assert.deepEqual(
    fifth.read('opticalProfiles', state.opticalProfiles).map((row) => row.examId),
    ['exam-5-1'],
  )
  // Yönetici ve öğretmen kuralı değişmedi: tamamını okur.
  for (const actor of [
    { role: 'yonetici', links: [] },
    { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
  ] as Actor[]) {
    const scope = scopeFor(state, actor)
    assert.equal(scope.read('opticalProfiles', state.opticalProfiles).length, 3, actor.role)
  }
  assert.equal(scopeFor(state, { role: 'yonetici', links: [] }).readsWhole('opticalProfiles'), true)
})

test('Denemesi bulunamayan optik profil öğrenci ve veliye görünmez', () => {
  const state = withForeignProfiles()
  state.mockExams = state.mockExams.filter((exam) => exam.id !== 'exam-7-1')
  for (const key of ['ogrenci', 'veli'])
    assert.deepEqual(
      scopeFor(state, actors[key]!).read('opticalProfiles', state.opticalProfiles),
      [],
    )
})
