// @ts-nocheck — TODO(ts): test tipleri dosya dosya tamamlanacak
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { scopeFor, visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import {
  workflowDetails,
  workflowRows,
} from '../packages/school-core/src/lib/workflow-presentation.ts'
import { isDomainError } from './support/domain-error.ts'

// Rehberlik gizliliği: DOM-ILT-040, DOM-ILT-041, DOM-YTK-020, DOM-YTK-021, DOM-YTK-026.
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix) => `${prefix}-guidance-test-${++sequence}`
const INTERNAL = 'İlk görüşmede çalışma ortamı ve zaman yönetimi konuşuldu.'
const SECRET_NOTE = 'Gizli görüşme ayrıntısı guidance-test.'
const admin = { role: 'yonetici', links: [] }
const frontOffice = { role: 'onburo', links: [] }
const teacher = (recordId = 't1') => ({ role: 'ogretmen', links: [{ kind: 'teacher', recordId }] })
const student = (recordId = 's1') => ({ role: 'ogrenci', links: [{ kind: 'student', recordId }] })
const parent = (...ids) => ({
  role: 'veli',
  links: ids.map((recordId) => ({ kind: 'child', recordId })),
})
const note = {
  text: SECRET_NOTE,
  sharedNote: 'Düzenli çalışıyor.',
  followUp: '2026-10-20',
  status: 'Takipte',
}
const opening = {
  studentId: 's1',
  teacherId: 't1',
  title: 'Gizlilik takibi',
  plan: 'Haftalık görüşme planı.',
  sharedNote: 'Paylaşılan plan notu.',
  followUp: '2026-10-20',
}
function unchangedOnFailure(state, callback, matcher) {
  const before = JSON.stringify(state)
  assert.throws(callback, matcher)
  assert.equal(JSON.stringify(state), before)
}
// Rehberlik görevi olmayan, dosyanın sorumlusu olan öğretmen: demo öğretmeninin görevi alınır.
function withoutCounselor(state) {
  state.teachers.find((t) => t.id === 't1').guidanceCounselor = false
  return state
}

test('Örnek veride rehberlik görevi yalnız demo öğretmenindedir', () => {
  const state = seed()
  assert.deepEqual(
    state.teachers.filter((t) => t.guidanceCounselor).map((t) => t.id),
    ['t1'],
  )
  assert.ok(state.teachers.every((t) => typeof t.guidanceCounselor === 'boolean'))
})

test('Rehberlik görevli öğretmen kurumun bütün dosyalarını iç notlarıyla görür', () => {
  const state = seed()
  state.guidanceCases.push({
    ...structuredClone(state.guidanceCases[0]),
    id: 'guidance-other-campus',
    studentId: 's9',
    teacherId: 't20',
  })
  const scope = scopeFor(state, teacher())
  assert.equal(scope.counselor, true)
  const rows = scope.read('guidanceCases', state.guidanceCases)
  assert.deepEqual(
    rows.map((r) => r.id),
    state.guidanceCases.map((r) => r.id),
  )
  assert.equal(rows[0].internalNote, INTERNAL)
  assert.deepEqual(rows[0].notes, [])
  assert.deepEqual(scope.hiddenFields('guidanceCases'), [])
})

test('Yönetici, görevsiz öğretmen, öğrenci ve veli iç notu görmez; ön büro dosyayı hiç görmez', () => {
  const state = withoutCounselor(seed())
  const cases = [
    [admin, ['guidance-s1', 'guidance-s2']],
    [teacher(), ['guidance-s1', 'guidance-s2']],
    [student(), ['guidance-s1']],
    [student('s2'), ['guidance-s2']],
    [parent('s1', 's2'), ['guidance-s1', 'guidance-s2']],
    [parent('s3'), []],
  ]
  for (const [actor, expected] of cases) {
    const scope = scopeFor(state, actor)
    assert.equal(scope.counselor, false)
    const rows = scope.read('guidanceCases', state.guidanceCases)
    assert.deepEqual(
      rows.map((r) => r.id),
      expected,
      actor.role,
    )
    for (const row of rows) {
      assert.ok(!('internalNote' in row) && !('notes' in row), actor.role)
      assert.ok(row.plan && row.sharedNote, 'paylaşılan plan görünür')
    }
    assert.deepEqual(scope.hiddenFields('guidanceCases'), ['internalNote', 'notes'])
  }
  // Dosyada görevli olmayan ve sınıfında öğrencisi olmayan öğretmen dosyayı görmez.
  const stranger = state.teachers.find((t) => t.branchId === 'b2' && !t.guidanceCounselor)
  assert.deepEqual(
    scopeFor(state, teacher(stranger.id)).read('guidanceCases', state.guidanceCases),
    [],
  )
  assert.deepEqual(scopeFor(state, frontOffice).access('guidanceCases'), {
    allowed: false,
    reason: 'role_denied',
  })
  assert.deepEqual(visibleRecords(state, frontOffice, 'guidanceCases'), [])
})

test('İç not arama, liste ve ayrıntı çıktısına sızmaz', () => {
  const state = seed()
  runWorkflow(state, { role: 'ogretmen' }, 'guidance-note', note, id, 'guidance-s1', now)
  const counselorRows = workflowRows(state, { role: 'ogretmen' }, 'rehberlik')
  assert.ok(JSON.stringify(counselorRows).includes(SECRET_NOTE), 'görevli öğretmen görür')
  const search = (rows, term) => rows.filter((row) => JSON.stringify(row).includes(term))
  for (const actor of [admin, student(), parent('s1', 's2')]) {
    const rows = visibleRecords(state, actor, 'guidanceCases')
    assert.ok(rows.length > 0)
    assert.deepEqual(search(rows, SECRET_NOTE), [], actor.role)
    assert.deepEqual(search(rows, INTERNAL), [], actor.role)
    assert.equal(search(rows, 'Düzenli çalışıyor').length, 1, 'paylaşılan not aranabilir')
  }
  for (const session of [
    { role: 'yonetici' },
    { role: 'ogrenci' },
    { role: 'veli', childId: 's1' },
    { role: 'veli', childId: 's2' },
  ]) {
    const rows = workflowRows(state, session, 'rehberlik')
    assert.ok(rows.length > 0, session.role)
    const details = rows.map((row) => workflowDetails(state, session, row))
    for (const output of [rows, details]) {
      const text = JSON.stringify(output)
      assert.ok(!text.includes(SECRET_NOTE) && !text.includes(INTERNAL), session.role)
    }
  }
  // Görevi alınan öğretmen kendi dosyasının iç notunu da artık görmez.
  withoutCounselor(state)
  const rows = workflowRows(state, { role: 'ogretmen' }, 'rehberlik')
  assert.ok(rows.length > 0)
  assert.ok(!JSON.stringify(rows).includes(SECRET_NOTE))
  assert.deepEqual(
    workflowDetails(state, { role: 'ogretmen' }, rows[0]).sections.map((s) => s.title),
    ['Paylaşılan destek planı'],
  )
})

test('Denetim kaydı iç not içeriğini değil yalnız alan adını yazar (DOM-ILT-041)', () => {
  const state = seed()
  runWorkflow(state, { role: 'ogretmen' }, 'guidance-note', note, id, 'guidance-s1', now)
  const [noteEntry] = state.audit
  assert.equal(noteEntry.table_name, 'guidanceCases')
  assert.deepEqual(noteEntry.masked_fields, ['notes'])
  assert.ok(!JSON.stringify(noteEntry).includes(SECRET_NOTE))
  assert.ok(!JSON.stringify(noteEntry).includes(INTERNAL))
  assert.ok(!('internalNote' in noteEntry.old_value) && !('notes' in noteEntry.new_value))
  assert.equal(noteEntry.new_value.sharedNote, 'Düzenli çalışıyor.')
  assert.equal(
    noteEntry.old_value.sharedNote,
    'Kısa ve düzenli tekrarlar üzerinde birlikte çalışacağız.',
  )
  // Kayıt kendisi iç notu korur; yalnız denetim çıktısı maskelenir.
  assert.equal(state.guidanceCases[0].notes.at(-1).text, SECRET_NOTE)
  runWorkflow(
    state,
    { role: 'ogretmen' },
    'guidance',
    { ...opening, internalNote: 'Açılış iç notu guidance-test.' },
    id,
    undefined,
    now,
  )
  const [openEntry] = state.audit
  assert.deepEqual(openEntry.masked_fields, ['internalNote', 'notes'])
  assert.equal(openEntry.old_value, null)
  assert.ok(!JSON.stringify(openEntry).includes('Açılış iç notu'))
  // Gizli alanı olmayan koleksiyonda denetim kaydı değişmez.
  runWorkflow(
    state,
    { role: 'yonetici' },
    'goal-comment',
    { text: 'Yorum' },
    id,
    state.studentGoals[0].id,
    now,
  )
  assert.ok(!('masked_fields' in state.audit[0]))
  assert.equal(state.audit[0].new_value.comments.at(-1).text, 'Yorum')
})

test('İç notu yalnız rehberlik görevli öğretmen yazar; başarısızlıkta kayıt değişmez', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => runWorkflow(state, { role: 'yonetici' }, 'guidance-note', note, id, 'guidance-s1', now),
    isDomainError('permission_denied', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () =>
      runWorkflow(
        state,
        { role: 'yonetici' },
        'guidance',
        { ...opening, internalNote: 'Yönetici notu.' },
        id,
        undefined,
        now,
      ),
    isDomainError('guidance_counselor_only', 'forbidden'),
  )
  const opened = runWorkflow(state, { role: 'yonetici' }, 'guidance', opening, id, undefined, now)
  assert.equal(opened.internalNote, '')
  withoutCounselor(state)
  unchangedOnFailure(
    state,
    () => runWorkflow(state, { role: 'ogretmen' }, 'guidance-note', note, id, 'guidance-s1', now),
    isDomainError('guidance_counselor_only', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () =>
      runWorkflow(
        state,
        { role: 'ogretmen' },
        'guidance',
        { ...opening, internalNote: 'Görevsiz öğretmen notu.' },
        id,
        undefined,
        now,
      ),
    isDomainError('guidance_counselor_only', 'forbidden'),
  )
})

test('Rehberlik modülü kapalıyken görevli öğretmen de dosya okuyamaz', () => {
  const state = seed()
  state.modules.guidance = false
  const scope = scopeFor(state, teacher())
  assert.deepEqual(scope.access('guidanceCases'), { allowed: false, reason: 'module_disabled' })
  assert.deepEqual(scope.read('guidanceCases', state.guidanceCases), [])
})
