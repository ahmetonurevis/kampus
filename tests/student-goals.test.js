import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.js'
import {
  runWorkflow,
  goalProgress,
  goalSeries,
  suggestGoalSteps,
} from '../packages/school-core/src/lib/school-workflows.js'
import {
  workflowRows,
  workflowDetails,
  workflowForm,
} from '../packages/school-core/src/lib/workflow-presentation.js'
import {
  createSnapshotWriter,
  restoreSnapshot,
} from '../packages/school-core/src/lib/demo-persistence.js'
import { navigation } from '../apps/web/src/modules/navigation.js'

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix) => `${prefix}-goal-test-${++sequence}`
const session = (role, childId = 's1') => ({ role, childId })
const run = (state, command, input = {}, recordId, role = 'yonetici', childId = 's1') =>
  runWorkflow(state, session(role, childId), command, input, id, recordId, now)
const scienceGoal = {
  studentId: 's1',
  subjectId: 'science',
  title: 'Fen netini yükseltmek',
  targetNet: 18,
  deadline: '2026-11-15',
  motivation: 'Deneylerde daha emin olmak istiyorum.',
}
function unchangedOnFailure(state, callback, pattern) {
  const before = JSON.stringify(state)
  assert.throws(callback, pattern)
  assert.equal(JSON.stringify(state), before)
}

test('Hedef modülü her rolde menüde görünür; örnek hedefin ilerlemesi deneme sonuçlarından hesaplanır', () => {
  const state = seed()
  for (const role of ['yonetici', 'ogretmen', 'ogrenci', 'veli'])
    assert.ok(navigation[role].some((p) => p.path === 'hedef-plani' && p.module === 'goals'))
  assert.ok(!navigation.onburo.some((p) => p.path === 'hedef-plani'))
  const goal = state.studentGoals.find((g) => g.id === 'goal-s1-math')
  assert.deepEqual(
    goalSeries(state, 's1', 'math').map((p) => p.net),
    [8.75, 12],
  )
  const progress = goalProgress(state, goal)
  assert.equal(progress.current, 12)
  assert.equal(progress.percent, 45)
  assert.equal(progress.achieved, false)
  assert.equal(progress.stepsDone, 1)
  const row = workflowRows(state, session('ogrenci'), 'hedef-plani')[0]
  assert.equal(row.status, 'Aktif')
  assert.match(row.body, /Hedef: 16 net · Güncel: 12 net · %45/)
})

test('Veli yalnızca seçili çocuğun hedefini görür ve yorum dışında işlem yapamaz', () => {
  const state = seed()
  const forDeniz = workflowRows(state, session('veli', 's1'), 'hedef-plani')
  const forEce = workflowRows(state, session('veli', 's2'), 'hedef-plani')
  assert.deepEqual(
    forDeniz.map((r) => r.id),
    ['goal-s1-math'],
  )
  assert.deepEqual(
    forEce.map((r) => r.id),
    ['goal-s2-total'],
  )
  const actions = workflowDetails(state, session('veli', 's1'), forDeniz[0]).actions
  assert.deepEqual(
    actions.map((a) => a.command),
    ['goal-comment'],
  )
  run(
    state,
    'goal-comment',
    { text: 'Hafta sonu birlikte tekrar yapacağız.' },
    'goal-s1-math',
    'veli',
  )
  assert.equal(state.studentGoals[0].comments.at(-1).actor, 'veli')
  unchangedOnFailure(
    state,
    () => run(state, 'goal-close', {}, 'goal-s1-math', 'veli'),
    /yetkisi yok/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal-comment', { text: 'Başka çocuk' }, 'goal-s2-total', 'veli', 's1'),
    /yetkiniz/,
  )
})

test('Öğrenci hedefi onay bekler; onaydan sonra adım tamamlanır, tekrar tamamlanamaz', () => {
  const state = seed()
  const goal = run(state, 'goal', scienceGoal, undefined, 'ogrenci')
  assert.equal(goal.status, 'Onay bekliyor')
  assert.equal(goal.baselineNet, 14)
  assert.equal(goal.deadline, '2026-11-15T09:00:00.000Z')
  run(
    state,
    'goal-step',
    { title: 'Hücre konusunu tekrar et', topic: '', dueDate: '2026-10-20' },
    goal.id,
    'ogrenci',
  )
  const stepId = goal.steps[0].id
  unchangedOnFailure(
    state,
    () => run(state, 'goal-step-done', { stepId }, goal.id, 'ogrenci'),
    /onaylandıktan sonra/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal-review', { status: 'Aktif' }, goal.id, 'ogrenci'),
    /yetkisi yok/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal-review', { status: 'Reddedildi', feedback: '' }, goal.id, 'yonetici'),
    /gerekçe/,
  )
  run(state, 'goal-review', { status: 'Aktif', feedback: 'Uygun.' }, goal.id, 'yonetici')
  assert.equal(goal.status, 'Aktif')
  run(state, 'goal-step-done', { stepId }, goal.id, 'ogrenci')
  assert.equal(goal.steps[0].done, true)
  unchangedOnFailure(
    state,
    () => run(state, 'goal-step-done', { stepId }, goal.id, 'ogrenci'),
    /zaten tamamlanmış/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal-review', { status: 'Aktif' }, goal.id, 'yonetici'),
    /onay bekleyen/,
  )
})

test('Geçersiz hedefler hiçbir kayıt oluşturmaz: geçmiş tarih, düşük net, mükerrer kapsam, uygunsuz ders', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => run(state, 'goal', { ...scienceGoal, deadline: '2026-10-05' }, undefined, 'ogrenci'),
    /geçmişte/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal', { ...scienceGoal, targetNet: 14 }, undefined, 'ogrenci'),
    /üzerinde olmalıdır/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal', { ...scienceGoal, targetNet: 17.555 }, undefined, 'ogrenci'),
    /iki ondalık/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal', { ...scienceGoal, subjectId: 'math' }, undefined, 'ogrenci'),
    /açık bir hedef zaten var/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal', { ...scienceGoal, subjectId: 'physics' }, undefined, 'ogrenci'),
    /sınıf düzeyine uygun değil/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal', { ...scienceGoal, studentId: 's2' }, undefined, 'ogrenci'),
    /yetkiniz/,
  )
})

test('Öğretmen yalnızca kendi branşında hedef belirler ve başka branş hedefini yönetemez', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => run(state, 'goal', scienceGoal, undefined, 'ogretmen'),
    /kendi dersiniz/,
  )
  run(state, 'goal-close', {}, 'goal-s1-math', 'ogretmen')
  const created = run(
    state,
    'goal',
    { ...scienceGoal, subjectId: 'math', targetNet: 16 },
    undefined,
    'ogretmen',
  )
  assert.equal(created.status, 'Aktif')
  const science = run(state, 'goal', scienceGoal, undefined, 'yonetici')
  assert.ok(
    !workflowRows(state, session('ogretmen'), 'hedef-plani').some((r) => r.id === science.id),
  )
  unchangedOnFailure(
    state,
    () => run(state, 'goal-comment', { text: 'Not' }, science.id, 'ogretmen'),
    /başka bir branşa/,
  )
})

test('Otomatik öneri zayıf konulardan haftalık adım üretir; ikinci çalıştırmada kopya oluşturmaz', () => {
  const state = seed()
  const goal = state.studentGoals.find((g) => g.id === 'goal-s1-math')
  const suggestions = suggestGoalSteps(state, goal, now)
  assert.deepEqual(suggestions, [])
  unchangedOnFailure(
    state,
    () => run(state, 'goal-suggest', {}, 'goal-s1-math', 'ogrenci'),
    /Önerilecek yeni zayıf konu bulunamadı/,
  )
  goal.steps.length = 0
  run(state, 'goal-suggest', {}, 'goal-s1-math', 'ogrenci')
  assert.equal(goal.steps.length, 1)
  assert.equal(goal.steps[0].source, 'auto')
  assert.ok(goal.steps[0].dueDate <= goal.deadline)
  unchangedOnFailure(
    state,
    () => run(state, 'goal-suggest', {}, 'goal-s1-math', 'ogrenci'),
    /Önerilecek yeni zayıf konu bulunamadı/,
  )
})

test('Reddedilen veya kapatılan hedefe adım eklenemez; kapatma geçmişi korur', () => {
  const state = seed()
  run(
    state,
    'goal-review',
    { status: 'Reddedildi', feedback: 'Hedef çok yüksek.' },
    'goal-s2-total',
    'yonetici',
  )
  const rejected = state.studentGoals.find((g) => g.id === 'goal-s2-total')
  assert.equal(rejected.status, 'Reddedildi')
  unchangedOnFailure(
    state,
    () =>
      run(
        state,
        'goal-step',
        { title: 'Yeni adım', topic: '', dueDate: '2026-10-10' },
        'goal-s2-total',
        'yonetici',
      ),
    /Reddedilmiş veya kapatılmış/,
  )
  run(state, 'goal-close', {}, 'goal-s1-math', 'ogrenci')
  const closed = state.studentGoals.find((g) => g.id === 'goal-s1-math')
  assert.equal(closed.status, 'Kapatıldı')
  assert.equal(closed.steps.length, 2)
  assert.equal(closed.comments.length, 1)
  unchangedOnFailure(
    state,
    () => run(state, 'goal-close', {}, 'goal-s1-math', 'ogrenci'),
    /Reddedilmiş veya kapatılmış/,
  )
})

test('Kapalı modül hedef verisini ve işlemleri kapatır; form ve denetim kaydı çalışır', () => {
  const state = seed()
  const form = workflowForm(state, session('ogrenci'), 'goal-step-done', 'goal-s1-math', {
    stepId: 'step-s1-2',
  })
  assert.equal(form.initial.stepId, 'step-s1-2')
  assert.deepEqual(
    form
      .fields({})
      .find((f) => f.key === 'stepId')
      .options.map((o) => o.value),
    ['step-s1-2'],
  )
  run(state, 'goal-step-done', { stepId: 'step-s1-2' }, 'goal-s1-math', 'ogrenci')
  const audit = state.audit[0]
  assert.equal(audit.action, 'goal-step-done')
  assert.equal(audit.table_name, 'studentGoals')
  assert.equal(audit.old_value.steps[1].done, false)
  assert.equal(audit.new_value.steps[1].done, true)
  state.modules.goals = false
  assert.deepEqual(workflowRows(state, session('ogrenci'), 'hedef-plani'), [])
  unchangedOnFailure(state, () => run(state, 'goal', scienceGoal, undefined, 'ogrenci'), /kapalı/)
})

test('Hedefler snapshot üzerinden kayıpsız döner', () => {
  const original = seed()
  const write = createSnapshotWriter(seed())
  const goal = run(original, 'goal', scienceGoal, undefined, 'ogrenci')
  run(original, 'goal-review', { status: 'Aktif', feedback: 'Uygun.' }, goal.id, 'yonetici')
  const restored = restoreSnapshot(write(original))
  assert.deepEqual(restored.studentGoals, original.studentGoals)
  assert.equal(restored.modules.goals, true)
})
