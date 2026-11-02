import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import {
  runWorkflow,
  examNet,
  renewalQuote,
  examProgress,
  workflowScope,
  mayRun,
} from '../packages/school-core/src/lib/school-workflows.ts'
import {
  workflowRows,
  workflowDetails,
  workflowForm,
  csvTemplate,
  changeFormValue,
} from '../packages/school-core/src/lib/workflow-presentation.ts'
import { schoolModules } from '../packages/school-core/src/modules/school-workflows.ts'
import { navigation } from '../apps/web/src/modules/navigation.js'
import {
  createSnapshotWriter,
  restoreSnapshot,
} from '../packages/school-core/src/lib/demo-persistence.ts'
import { archiveRecord } from '../packages/school-core/src/lib/school-management.ts'
import { workflowSchemas } from '../packages/school-core/src/lib/school-workflows.ts'
import { documentData } from '../packages/school-core/src/lib/document-data.ts'
import { resultOf } from './support/result.ts'
import { isDomainError } from './support/domain-error.ts'
// Sözleşme belgesi verisi (ödeme planı alanlarıyla) birleşim tipinden daraltılır.
function contractDoc(state: State, recordId: string) {
  const data = documentData(state, 'contract', recordId)
  if (!('invoices' in data)) throw new Error('Sözleşme verisi bekleniyordu.')
  return data
}
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-workflow-test-${++sequence}`
const session = (role: Role, childId = 's1'): Session => ({ role, childId })
// İş akışı sonucu birleşim tipidir; testler kayıt alanlarını okuyabilsin diye ortak kayıt şekline daraltılır.
type WorkflowRow = {
  id: string
  status: string
  targetClassId: string
  contractId: string
  cancelledAt?: string
  [field: string]: unknown
}
const run = (
  state: State,
  command: string,
  input: unknown = {},
  recordId?: string,
  role: Role = 'yonetici',
  childId = 's1',
) => runWorkflow(state, session(role, childId), command, input, id, recordId, now) as WorkflowRow
const renewal = {
  studentId: 's1',
  targetClassId: 'c4',
  year: 2027,
  mode: 'renew',
  total: 28500.01,
  scholarship: 15,
  discount: 100.02,
  count: 7,
  startDate: '2027-01-31',
}
function unchangedOnFailure(
  state: State,
  callback: () => unknown,
  pattern?: RegExp | ((error: unknown) => boolean),
) {
  const before = JSON.stringify(state)
  if (pattern) assert.throws(callback, pattern)
  else assert.throws(callback)
  assert.equal(JSON.stringify(state), before)
}

test('CSV 2000 karakteri aşan toplu sonuçları kabul eder; geçersiz takvim günü programda reddedilir', () => {
  const state = seed()
  const students = state.students.filter((s) => s.classId === 'c1')
  const csv =
    csvTemplate.split('\n')[0] +
    '\n' +
    students.map((s) => `exam-7-1;${s.id};math;12;5;3;${'Denklemler '.repeat(25)}`).join('\n')
  assert.ok(csv.length > 2000)
  run(state, 'exam-import', { csv })
  assert.equal(
    state.mockResults.filter((r) => r.examId === 'exam-7-1' && r.subjectId === 'math').length,
    students.length,
  )
  const lesson = state.schedule[0]
  unchangedOnFailure(
    state,
    () => run(state, 'lesson', { ...lesson, date: '2027-02-31T09:00:00Z' }),
    /tarih/,
  )
  assert.equal(workflowSchemas['exam-import'].safeParse({ csv: 'ş'.repeat(600000) }).success, false)
})

test('Öğretmen ve sınıf aktarımı açık takip/çalışma dosyalarını devreder; geçmiş kulüp kayıtları korunur', () => {
  const state = seed()
  state.teachers.push({ ...state.teachers[0]!, id: 'backup', email: 'backup@example.test' })
  archiveRecord(state, 'teacher', 't1', 'backup', now)
  assert.equal(state.guidanceCases.find((g) => g.studentId === 's1')!.teacherId, 'backup')
  assert.equal(state.studyTasks.find((t) => t.studentId === 's1')!.teacherId, 'backup')
  assert.equal(state.clubs.find((c) => c.id === 'club-science')!.teacherId, 'backup')
  const target = state.classes.find((c) => c.grade === 7 && c.branchId !== 'b1')
  target!.capacity = 40
  const history = JSON.stringify(state.socialAchievements)
  archiveRecord(state, 'class', 'c1', target!.id, now)
  assert.equal(state.students[0]!.classId, target!.id)
  assert.equal(
    state.transportAssignments.some((a) => a.studentId === 's1'),
    false,
  )
  assert.equal(state.clubMemberships.find((m) => m.studentId === 's1')!.status, 'Ayrıldı')
  assert.equal(JSON.stringify(state.socialAchievements), history)
  assert.equal(
    state.studyTasks.find((t) => t.studentId === 's1')!.teacherId,
    state.assignments.find((a) => a.classId === target!.id && a.subjectId === 'math')!.teacherId,
  )
})

test('Yenileme hedef sınıfı arşivlenirse sözleşme yeni hedefi izler; kampüs aktarımı menü çakışmasında atomiktir', () => {
  const state = seed(),
    entry = run(state, 'renewal', renewal)
  const target = state.classes.find((c) => c.grade === 8 && c.id !== 'c4')
  target!.capacity = 40
  archiveRecord(state, 'class', 'c4', target!.id, now)
  assert.equal(entry.targetClassId, target!.id)
  assert.equal(contractDoc(state, entry.contractId).classroom!.id, target!.id)
  run(state, 'renewal-activate', {}, entry.id)
  assert.equal(state.students[0]!.classId, target!.id)
  assert.equal(
    state.studyTasks.find((t) => t.studentId === 's1')!.teacherId,
    state.assignments.find((a) => a.classId === target!.id && a.subjectId === 'math')!.teacherId,
  )

  const campus = { ...state.branches[0]!, id: 'new-campus', name: 'Yeni kampüs' }
  state.branches.push(campus)
  const menu = state.mealMenus.find((m) => m.date > now)
  state.mealMenus.push({ ...menu!, id: 'conflicting-menu', branchId: campus.id })
  unchangedOnFailure(
    state,
    () => archiveRecord(state, 'branch', 'b1', campus.id, now),
    /yemek menüsü/,
  )
  state.mealMenus = state.mealMenus.filter((m) => m.id !== 'conflicting-menu')
  archiveRecord(state, 'branch', 'b1', campus.id, now)
  assert.equal(state.clubs[0]!.branchId, campus.id)
  assert.equal(state.transportRoutes[0]!.branchId, campus.id)
  assert.equal(state.schoolEvents[0]!.branchId, campus.id)
  assert.equal(menu!.branchId, campus.id)
})

test('Dokuz bağımsız modül ilgili rollerde görünür; kapalı modül işlem ve veri erişimini kapatır', () => {
  const state = seed()
  for (const module of schoolModules) {
    for (const role of module.roles)
      assert.ok(navigation[role].some((p) => p.path === module.path && p.module === module.key))
    state.modules[module.key] = false
    assert.deepEqual(workflowRows(state, session(module.roles[0]!), module.path), [])
  }
  unchangedOnFailure(state, () => run(state, 'guidance', { studentId: 's1' }), /kapalı/)
  assert.ok(!navigation.onburo.some((p) => p.path === 'rehberlik'))
})
test('Rehberlik iç notları veli/öğrencide gizlidir; öğretmen sınıfı ve sorumlusu doğrulanır', () => {
  const state = seed(),
    row = workflowRows(state, session('veli'), 'rehberlik')[0]
  assert.equal(resultOf(row!.source).internalNote, undefined)
  assert.equal(resultOf(row!.source).notes, undefined)
  assert.ok(
    !JSON.stringify(workflowDetails(state, session('veli'), row!)).includes('İlk görüşmede'),
  )
  unchangedOnFailure(
    state,
    () =>
      run(
        state,
        'guidance',
        {
          studentId: 's9',
          teacherId: 't1',
          title: 'Takip dosyası',
          plan: 'Birlikte tekrar',
          followUp: '2026-10-10',
        },
        undefined,
        'ogretmen',
      ),
    /yetkiniz/,
  )
  run(
    state,
    'guidance-note',
    {
      text: 'Gelişim olumlu.',
      sharedNote: 'Düzenli çalışma tamamlandı.',
      followUp: '2026-10-12',
      status: 'Tamamlandı',
    },
    'guidance-s1',
    'ogretmen',
  )
  assert.equal(state.guidanceCases[0]!.status, 'Tamamlandı')
  assert.equal(
    resultOf(workflowRows(state, session('veli', 's2'), 'rehberlik')[0]!.source).studentId,
    's2',
  )
})
test('Deneme neti negatif değeri korur; CSV tüm satırları doğrular, yinelenen sonucu çoğaltmaz', () => {
  const state = seed(),
    count = state.mockResults.length
  assert.equal(examNet({ correct: 0, wrong: 5 }, { wrongPenalty: 4 }), -1.25)
  assert.equal(examNet({ correct: 3, wrong: 5 }, { wrongPenalty: 0 }), 3)
  run(state, 'exam-import', { csv: csvTemplate })
  assert.equal(state.mockResults.length, count)
  assert.equal(
    state.mockResults.find(
      (r) => r.examId === 'exam-7-1' && r.studentId === 's1' && r.subjectId === 'math',
    )!.correct,
    12,
  )
  const invalid = csvTemplate + '\nexam-7-1;s2;math;15;2;3;Denklemler'
  unchangedOnFailure(state, () => run(state, 'exam-import', { csv: invalid }), /sınıf düzeyi/)
  unchangedOnFailure(
    state,
    () => run(state, 'exam-import', { csv: csvTemplate + '\n' + csvTemplate.split('\n')[1] }),
    /yinelenen/,
  )
  unchangedOnFailure(
    state,
    () =>
      run(
        state,
        'exam-result',
        {
          examId: 'exam-7-1',
          studentId: 's1',
          subjectId: 'science',
          correct: 5,
          wrong: 2,
          blank: 1,
          weakTopics: '',
        },
        undefined,
        'ogretmen',
      ),
    /branş/,
  )
  assert.equal(examProgress(state, 's1').length, 2)
})
test('Kayıt yenileme kuruş kaybetmez; eski sözleşme yeni taksitleri içermez ve sınıf ayrı onayla değişir', () => {
  const state = seed(),
    oldInvoices = structuredClone(state.invoices.filter((i) => i.studentId === 's1')),
    oldGrades = JSON.stringify(state.grades),
    oldAttendance = JSON.stringify(state.attendance)
  const quote = renewalQuote(renewal),
    entry = run(state, 'renewal', renewal)
  assert.equal(
    quote.installments.reduce((sum, v) => sum + v, 0),
    quote.amount,
  )
  assert.equal(state.students[0]!.classId, 'c1')
  const contract = contractDoc(state, entry.contractId)
  assert.equal(contract.total, quote.amount)
  assert.equal(contract.invoices.length, 7)
  assert.equal(contract.classroom!.id, 'c4')
  assert.equal(contract.invoices[1]!.dueDate.slice(0, 10), '2027-02-28')
  assert.equal(contractDoc(state, 'contract-s1').invoices.length, 8)
  unchangedOnFailure(state, () => run(state, 'renewal', renewal), /zaten/)
  unchangedOnFailure(
    state,
    () => run(state, 'renewal', { ...renewal, studentId: 's2', targetClassId: 'c4' }),
    /üst sınıf/,
  )
  run(state, 'renewal-activate', {}, entry.id)
  assert.equal(state.students[0]!.classId, 'c4')
  assert.equal(JSON.stringify(state.grades), oldGrades)
  assert.equal(JSON.stringify(state.attendance), oldAttendance)
  assert.deepEqual(
    state.invoices.filter((i) => i.studentId === 's1' && !i.contractId),
    oldInvoices,
  )
  assert.ok(
    workflowRows(state, session('veli'), 'deneme-sinavlari').some((r) => r.id === 'exam-7-1'),
  )
  unchangedOnFailure(state, () => run(state, 'renewal-activate', {}, entry.id), /zaten/)
  assert.ok(state.audit.some((a) => a.table_name === 'renewals' && a.old_value && a.user_id))
})
test('Yenileme geçersiz tarih, fazla indirim ve dolu sınıfta hiçbir kayıt oluşturmaz', () => {
  const state = seed()
  for (const changes of [
    { startDate: '2027-02-31' },
    { startDate: '2027-99-01' },
    { discount: 50000 },
    { discount: 0.001 },
  ])
    unchangedOnFailure(state, () => run(state, 'renewal', { ...renewal, ...changes }))
  state.classes.find((c) => c.id === 'c4')!.capacity = 1
  unchangedOnFailure(state, () => run(state, 'renewal', renewal), /kontenjan/)
})
test('Mezuniyet finans kaydı eklemeden geçmişi ve veli görünümünü korur', () => {
  const state = seed(),
    student = state.students.find(
      (s) => state.classes.find((c) => c.id === s.classId)!.grade === 12,
    )
  const count = state.invoices.length,
    entry = run(state, 'renewal', {
      ...renewal,
      studentId: student!.id,
      mode: 'graduate',
      targetClassId: '',
    })
  run(state, 'renewal-activate', {}, entry.id)
  assert.equal(student!.isActive, false)
  assert.equal(state.invoices.length, count)
  assert.equal(entry.status, 'Mezun')
})
test('Program öğretmen, sınıf, derslik ve görüşme çakışmasını atomik engeller; geçici görev kalıcı atamayı bozmaz', () => {
  const state = seed(),
    lesson = state.schedule.find((l) => l.classId === 'c1' && l.subjectId === 'math'),
    input = {
      classId: lesson!.classId,
      teacherId: lesson!.teacherId,
      subjectId: lesson!.subjectId,
      date: lesson!.date,
      duration: lesson!.duration,
      room: lesson!.room,
    }
  unchangedOnFailure(state, () => run(state, 'lesson', input), /bu saatte/)
  const replacement = {
    ...state.teachers[0]!,
    id: 'teacher-backup',
    name: 'Yedek Matematik Öğretmeni',
  }
  state.teachers.push(replacement)
  const assignments = JSON.stringify(state.assignments)
  run(state, 'substitute', { teacherId: replacement.id, reason: 'Öğretmen izinli.' }, lesson!.id)
  assert.equal(lesson!.teacherId, replacement.id)
  assert.equal(JSON.stringify(state.assignments), assignments)
  const entry = run(state, 'lesson', { ...input, date: '2026-10-18T06:00:00Z', teacherId: 't1' })
  run(state, 'lesson-cancel', {}, entry.id)
  assert.equal(entry.cancelledAt, now)
  const appointment = state.appointments.find(
    (a) => a.teacherId === 't1' && a.status !== 'Reddedildi',
  )
  unchangedOnFailure(
    state,
    () => run(state, 'lesson', { ...input, date: appointment!.date }),
    /randevusu/,
  )
})
test('Çalışma planı öğrenci önerisi → öğretmen onayı → teslim → değerlendirme akışını uygular', () => {
  const state = seed(),
    entry = run(
      state,
      'study-task',
      {
        studentId: 's1',
        subjectId: 'math',
        topic: 'Denklemler',
        title: 'Haftalık tekrar',
        instructions: 'Beş soru çöz.',
        dueDate: '2026-10-12',
        minutes: 30,
      },
      undefined,
      'ogrenci',
    )
  assert.equal(entry.status, 'Onay bekliyor')
  unchangedOnFailure(
    state,
    () => run(state, 'study-complete', { completionNote: 'Çözdüm.' }, entry.id, 'ogrenci'),
    /onaylanmış/,
  )
  run(state, 'study-review', { status: 'Onaylandı', feedback: 'Plan uygun.' }, entry.id, 'ogretmen')
  run(state, 'study-complete', { completionNote: 'Beş soruyu çözdüm.' }, entry.id, 'ogrenci')
  run(
    state,
    'study-review',
    { status: 'Tamamlandı', feedback: 'Çözüm adımları doğru.' },
    entry.id,
    'ogretmen',
  )
  assert.equal(entry.status, 'Tamamlandı')
  assert.ok(workflowRows(state, session('veli'), 'calisma-plani').some((r) => r.id === entry.id))
  unchangedOnFailure(
    state,
    () => run(state, 'study-complete', { completionNote: 'Çözdüm.' }, 'study-s2', 'ogrenci'),
    /yetkiniz/,
  )
})
test('Veli onayı seçili çocuk ve süreyi doğrular; tekrar onay aynı kaydı günceller', () => {
  const state = seed()
  run(state, 'consent', { decision: 'Onaylandı', note: 'Katılabilir.' }, 'event-science', 'veli')
  run(state, 'consent', { decision: 'Reddedildi', note: 'Katılamayacak.' }, 'event-science', 'veli')
  assert.equal(state.eventConsents.length, 1)
  assert.equal(state.eventConsents[0]!.decision, 'Reddedildi')
  unchangedOnFailure(
    state,
    () => run(state, 'consent', { decision: 'Onaylandı' }, 'event-science', 'veli', 's3'),
    /yetkiniz/,
  )
  state.schoolEvents[0]!.consentDeadline = '2026-10-05T09:00:00.000Z'
  unchangedOnFailure(
    state,
    () => run(state, 'consent', { decision: 'Onaylandı' }, 'event-science', 'veli'),
    /süresi/,
  )
  unchangedOnFailure(
    state,
    () =>
      run(state, 'event', {
        title: 'Gezi',
        classId: 'c9',
        branchId: 'b1',
        date: '2026-10-12T09:00Z',
        endDate: '2026-10-12T11:00Z',
        location: 'Müze',
        description: 'Bilim gezisi',
        requiresConsent: true,
        consentDeadline: '2026-10-10',
      }),
    /aynı/,
  )
})
test('DOM-ILT-074 OG-032 kapsam dışı çocuk için veli onayı kayıt durumunu sızdırmaz: pasif, etkin ve olmayan öğrenci aynı 403', () => {
  const state = seed()
  const scopeDenied = isDomainError('student_scope_denied', 'forbidden')
  const consent = (childId: string) =>
    run(state, 'consent', { decision: 'Onaylandı' }, 'event-science', 'veli', childId)
  // Kapsam dışı s3 etkinken ve pasifken, olmayan öğrenci de: hep 403, asla 422/404.
  unchangedOnFailure(state, () => consent('s3'), scopeDenied)
  const outside = state.students.find((student) => student.id === 's3')!
  outside.isActive = false
  unchangedOnFailure(state, () => consent('s3'), scopeDenied)
  unchangedOnFailure(state, () => consent('olmayan-ogrenci'), scopeDenied)
  // Kapsamdaki pasif çocuk kayıt durumunu görür (kendi çocuğu): 422 record_inactive.
  const own = state.students.find((student) => student.id === 's1')!
  own.isActive = false
  unchangedOnFailure(state, () => consent('s1'), isDomainError('record_inactive'))
  // Yönetici kurumun bütün kayıtlarını görür; olmayan öğrenci 404 kalır.
  unchangedOnFailure(
    state,
    () =>
      run(state, 'transport-assign', {
        studentId: 'olmayan-ogrenci',
        routeId: 'route-b1',
        stop: 'Bahariye',
      }),
    isDomainError('record_not_found', 'not_found'),
  )
})
test('Servis ataması çoğalmaz; kapasite, durak ve kampüs denetlenir; dolu güzergâh arşivlenmez', () => {
  const state = seed(),
    input = { studentId: 's1', routeId: 'route-b1', stop: 'Bahariye' }
  run(state, 'transport-assign', input)
  run(state, 'transport-assign', input)
  assert.equal(state.transportAssignments.length, 2)
  unchangedOnFailure(
    state,
    () => run(state, 'transport-assign', { ...input, stop: 'Olmayan durak' }),
    /durak/,
  )
  unchangedOnFailure(
    state,
    () => run(state, 'transport-assign', { ...input, routeId: 'route-b2', stop: 'Çarşı' }),
    /aynı kampüs/,
  )
  unchangedOnFailure(state, () => run(state, 'route-archive', {}, 'route-b1'), /Önce/)
  state.transportRoutes[0]!.capacity = 2
  unchangedOnFailure(
    state,
    () => run(state, 'transport-assign', { ...input, studentId: 's3' }),
    /kontenjan/,
  )
})
test('Yemek menüsü kampüs/gün bazında tekildir; alerjen ve düzenleme diğer rollere yansır', () => {
  const state = seed(),
    input = {
      branchId: 'b1',
      date: '2026-10-06',
      title: 'Çorba ve pilav',
      allergens: 'Gluten, süt',
      description: 'Yeni menü',
    }
  unchangedOnFailure(state, () => run(state, 'meal', input), /zaten var/)
  run(state, 'meal', input, 'meal-0')
  assert.ok(
    workflowRows(state, session('veli'), 'yemek-menusu').some((r) =>
      r.body.includes('Gluten, süt'),
    ),
  )
})
test('Kulüp üyeliği, yoklama ve başarı kayıtları tekrar işlemde çoğalmaz; arşiv geçmişi korur', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => run(state, 'club-enroll', { studentId: 's1' }, 'club-science', 'ogrenci'),
    /zaten/,
  )
  run(state, 'club-enroll', { studentId: 's1' }, 'club-art', 'ogrenci')
  const marks = { s1: 'Geldi', s2: 'İzinli' }
  run(state, 'club-attendance', { date: '2026-10-06', marks }, 'club-science', 'ogretmen')
  run(
    state,
    'club-attendance',
    { date: '2026-10-06', marks: { ...marks, s1: 'Gelmedi' } },
    'club-science',
    'ogretmen',
  )
  assert.equal(state.clubAttendance.length, 2)
  unchangedOnFailure(
    state,
    () =>
      run(
        state,
        'club-attendance',
        { date: '2026-10-06', marks: { s1: 'Geldi' } },
        'club-science',
        'ogretmen',
      ),
    /Tüm aktif/,
  )
  run(
    state,
    'achievement',
    {
      studentId: 's1',
      clubId: 'club-science',
      title: 'Robotik proje',
      description: 'Takım çalışması.',
      date: '2026-10-06',
    },
    undefined,
    'ogretmen',
  )
  run(state, 'club-archive', {}, 'club-science', 'ogretmen')
  assert.equal(state.socialAchievements.length, 3)
  assert.equal(state.clubAttendance.length, 2)
  assert.ok(
    state.clubMemberships
      .filter((m) => m.clubId === 'club-science')
      .every((m) => m.status === 'Ayrıldı'),
  )
})
test('Eski snapshot kayıt ve kapalı modülleri korur; yeni kayıtlar kalıcı biçimden kayıpsız döner', () => {
  const state = seed(),
    oldSeed = structuredClone(state)
  for (const module of schoolModules) delete oldSeed.modules[module.key]
  const snapshot = {
    format: 'school-delta-v1',
    version: 3,
    createdAt: now,
    changes: { modules: { kind: 'value', value: { ...oldSeed.modules, finance: false } } },
  }
  const restored = restoreSnapshot(snapshot)
  assert.equal(restored.modules.finance, false)
  assert.equal(restored.modules.guidance, true)
  run(state, 'renewal', renewal)
  const next = restoreSnapshot(createSnapshotWriter(seed())(state))
  assert.deepEqual(next.renewals, state.renewals)
  assert.deepEqual(next.invoices, state.invoices)
  assert.equal(workflowScope(state, session('veli', 's3')).studentIds.size, 0)
  const form = workflowForm(state, session('yonetici'), 'renewal')
  assert.ok(form.fields(form.initial).some((f) => f.key === 'targetClassId'))
  assert.deepEqual(changeFormValue({ marks: { s1: 'Geldi' } }, 'marks.s1', 'Gelmedi').marks, {
    s1: 'Gelmedi',
  })
})

test('İş akışı reddi DomainError, kod ve tür taşır: kapalı modül, bulunamayan kayıt', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => run(state, 'renewal', { ...renewal, studentId: 'yok' }),
    isDomainError('record_not_found', 'not_found'),
  )
  state.modules.guidance = false
  unchangedOnFailure(
    state,
    () => run(state, 'guidance', { studentId: 's1' }),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('Yerleşik nesne özelliği adı geçen komut TypeError değil unknown_command verir', () => {
  const state = seed()
  for (const command of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'bilinmeyen']) {
    assert.equal(mayRun(session('yonetici'), command), false)
    unchangedOnFailure(state, () => run(state, command), isDomainError('unknown_command'))
  }
})
