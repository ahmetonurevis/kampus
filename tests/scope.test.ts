import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import {
  COLLECTION_NAMES,
  type CollectionName,
} from '../packages/school-core/src/modules/collection-modules.ts'
import {
  DEMO_TEACHER_ID,
  ONUR_READ_RULES,
  SCOPE_SOURCE_COLLECTIONS,
  linkedRecordId,
  redactRecord,
  requireReadable,
  scopeFor,
  sessionActor,
  sessionTeacherId,
  visibleRecords,
  type Actor,
  type ActorLink,
} from '../packages/school-core/src/lib/scope.ts'
import { PLATFORM_READ_RULES } from '../packages/school-core/src/platform/scope.ts'
import { runWorkflow, workflowScope } from '../packages/school-core/src/lib/school-workflows.ts'
import { automationScope } from '../packages/school-core/src/lib/assessment-automation.ts'
import { resultOf } from './support/result.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-scope-test-${++sequence}`
const admin: Actor = { role: 'yonetici', links: [] }
const frontOffice: Actor = { role: 'onburo', links: [] }
const teacher = (recordId = 't1'): Actor => ({
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId }],
})
const student = (recordId = 's1'): Actor => ({
  role: 'ogrenci',
  links: [{ kind: 'student', recordId }],
})
const parent = (...ids: string[]): Actor => ({
  role: 'veli',
  links: ids.map((recordId) => ({ kind: 'child', recordId })),
})
// Koleksiyon adı birleşimi için satırlar ortak nesne şekline daraltılır.
const rowsOf = (state: State, name: CollectionName): readonly Record<string, unknown>[] =>
  state[name]
const ids = (rows: readonly { id: unknown }[]) => rows.map((r) => r.id)
const studentsOf = (rows: readonly { studentId?: unknown }[]) =>
  new Set(rows.map((r) => r.studentId))

test('Demo oturumu sabit demo kimliklerine, API oturumu kendi bağlantılarına eşlenir', () => {
  const state = seed()
  assert.deepEqual(sessionActor(state, { role: 'ogretmen' }), teacher(DEMO_TEACHER_ID))
  assert.deepEqual(sessionActor(state, { role: 'ogrenci' }), student('s1'))
  assert.deepEqual(sessionActor(state, { role: 'veli', childId: 's2' }), parent('s1', 's2'))
  assert.deepEqual(sessionActor(state, { role: 'yonetici' }), admin)
  assert.deepEqual(sessionActor(state, { role: 'onburo' }), frontOffice)
  // @ts-expect-error — bilinçli bilinmeyen rol
  assert.deepEqual(sessionActor(state, { role: 'olmayan' }), { role: 'olmayan', links: [] })
  const links: ActorLink[] = [{ kind: 'teacher', recordId: 't2' }]
  assert.deepEqual(sessionActor(state, { role: 'ogretmen', links }), { role: 'ogretmen', links })
  assert.equal(sessionTeacherId(state, { role: 'ogretmen', links }), 't2')
  assert.equal(sessionTeacherId(state, { role: 'yonetici' }), undefined)
  assert.equal(linkedRecordId(parent('s2'), 'child'), 's2')
  assert.equal(linkedRecordId(parent('s2'), 'teacher'), undefined)
  // Demo velisinin çocukları örnek veriden okunur; veli kaydı yoksa bağlantı da yoktur.
  state.parents = state.parents.filter((p) => p.id !== 'p1')
  assert.deepEqual(sessionActor(state, { role: 'veli' }), parent())
})

test('Kapsam kaynağı yalnız tanımlı koleksiyonlarla kurulabilir', () => {
  const state = seed()
  const source = Object.fromEntries(
    SCOPE_SOURCE_COLLECTIONS.map((name) => [name, rowsOf(state, name)]),
  )
  // @ts-expect-error — kaynak, tanımlı koleksiyon listesinden dinamik kurulur
  const scope = scopeFor({ ...source, modules: state.modules }, teacher())
  assert.ok(scope.studentIds.has('s1'))
  assert.deepEqual(
    ids(scope.read('grades', state.grades)),
    ids(visibleRecords(state, teacher(), 'grades')),
  )
})

test('Yönetici kurum geneli okur; birebir yazışma ve bildirim dışındaki her koleksiyon açıktır', () => {
  const state = seed()
  const scope = scopeFor(state, admin)
  assert.equal(scope.studentIds.size, state.students.length)
  assert.equal(scope.classIds.size, state.classes.length)
  assert.equal(scope.teacher, undefined)
  for (const name of COLLECTION_NAMES) {
    // Bildirim öğrenci ve veliye aittir; yöneticinin bildirimi yoktur (lib/notifications.ts).
    const expected = ![
      'conversations',
      'conversationMessages',
      'notifications',
      'notificationReads',
    ].includes(name)
    assert.equal(scope.access(name).allowed, expected, name)
    assert.equal(
      scope.read(name, rowsOf(state, name)).length,
      expected ? rowsOf(state, name).length : 0,
      name,
    )
  }
  assert.deepEqual(scope.access('conversations'), { allowed: false, reason: 'role_denied' })
  assert.equal(scope.redact('students', state.students[0]!).progress, state.students[0]!.progress)
})

test('Yazışma mesajı ayrı kayıttır: yalnız yazışmanın tarafı okur; kişi kimlikleri ayıklanır (DOM-YTK-052, DOM-ILT-010)', () => {
  const state = seed()
  const messages = state.conversationMessages
  const conversationsOf = (rows: readonly { conversationId: string }[]) =>
    [...new Set(rows.map((m) => m.conversationId))].sort()
  // Öğretmen kendi yazışmalarını, öğrenci kendi öğrenci yazışmalarını görür.
  assert.deepEqual(
    conversationsOf(scopeFor(state, teacher('t1')).read('conversationMessages', messages)),
    ['conv1', 'conv2', 'conv3'],
  )
  assert.deepEqual(
    conversationsOf(scopeFor(state, student('s1')).read('conversationMessages', messages)),
    ['conv1', 'conv4'],
  )
  // Veli yalnız kendi kullanıcı kimliğiyle açılmış veli yazışmasını görür.
  const mother: Actor = { ...parent('s1', 's2'), userId: 'p1' }
  assert.deepEqual(
    conversationsOf(scopeFor(state, mother).read('conversationMessages', messages)),
    ['conv2', 'conv3'],
  )
  const other: Actor = { ...parent('s1', 's2'), userId: 'u-baska-veli' }
  assert.deepEqual(scopeFor(state, other).read('conversationMessages', messages), [])
  assert.deepEqual(scopeFor(state, parent('s1')).read('conversationMessages', messages), [])
  // Yönetici ve ön büro taraf değildir; okuma gerekçeli ayrı işlemdir.
  for (const actor of [admin, frontOffice])
    assert.deepEqual(scopeFor(state, actor).access('conversationMessages'), {
      allowed: false,
      reason: 'role_denied',
    })
  const own = scopeFor(state, mother).read('conversationMessages', messages)
  assert.ok(own.length > 0)
  assert.ok(own.every((m) => !('parentUserId' in m) && !('senderUserId' in m)))
  assert.deepEqual(scopeFor(state, teacher('t1')).hiddenFields('conversationMessages'), [
    'senderUserId',
    'parentUserId',
  ])
  // Modül kapalıysa mesajlar da kapalıdır.
  state.modules.communication = false
  assert.deepEqual(scopeFor(state, teacher('t1')).access('conversationMessages'), {
    allowed: false,
    reason: 'module_disabled',
  })
})

test('Ön büro idari koleksiyonları okur; akademik veri ve ilerleme kapalıdır (DOM-YTK-021)', () => {
  const state = seed()
  const scope = scopeFor(state, frontOffice)
  for (const name of ['students', 'parents', 'invoices', 'contracts', 'prospects', 'renewals'])
    assert.ok(scope.access(name).allowed, name)
  for (const name of [
    'grades',
    'attendance',
    'mockResults',
    'guidanceCases',
    'studentGoals',
    'tutorSessions',
    'studyTasks',
    'teachers',
    'audit',
    'quizAttempts',
  ])
    assert.deepEqual(scope.access(name), { allowed: false, reason: 'role_denied' }, name)
  const students = scope.read('students', state.students)
  assert.equal(students.length, state.students.length)
  assert.ok(students.every((s) => !('progress' in s) && s.name && s.classId))
  assert.deepEqual(scope.hiddenFields('students'), ['progress'])
  assert.deepEqual(scope.read('grades', state.grades), [])
})

test('Öğretmen kendi sınıfları ve branşıyla sınırlıdır (DOM-YTK-022)', () => {
  const state = seed()
  const scope = scopeFor(state, teacher())
  const me = state.teachers.find((t) => t.id === 't1')
  assert.equal(scope.teacher!.id, 't1')
  const taught = new Set(
    state.assignments.filter((a) => a.teacherId === 't1').map((a) => a.classId),
  )
  assert.deepEqual(new Set(scope.classIds), taught)
  assert.deepEqual(
    new Set(scope.studentIds),
    new Set(state.students.filter((s) => taught.has(s.classId)).map((s) => s.id)),
  )
  assert.ok(!scope.studentIds.has('s9'))
  const grades = scope.read('grades', state.grades)
  assert.ok(grades.length > 0)
  const homeroom = new Set(state.classes.filter((c) => c.teacherId === 't1').map((c) => c.id))
  const classOf = new Map(state.students.map((s) => [s.id, s.classId]))
  for (const g of grades) {
    assert.ok(scope.studentIds.has(g.studentId))
    assert.ok(g.subjectId === me!.subjectId || homeroom.has(classOf.get(g.studentId)!))
  }
  // Rehberi olmadığı lise sınıfında yalnız kendi dersinin notu görünür.
  const highSchool = grades.filter((g) => !homeroom.has(classOf.get(g.studentId)!))
  assert.ok(highSchool.length > 0)
  assert.ok(highSchool.every((g) => g.subjectId === me!.subjectId))
  assert.ok(grades.some((g) => g.subjectId !== me!.subjectId))
  assert.deepEqual(
    ids(scope.read('teachers', state.teachers)),
    ['t1'],
    'öğretmen yalnız kendi kaydını görür',
  )
  assert.ok(scope.read('conversations', state.conversations).every((c) => c.teacherId === 't1'))
  assert.ok(scope.read('studyTasks', state.studyTasks).every((t) => t.teacherId === 't1'))
  assert.ok(scope.read('schedule', state.schedule).every((l) => l.teacherId === 't1'))
  assert.ok(
    scope
      .read('studentGoals', state.studentGoals)
      .every((g) => !g.subjectId || g.subjectId === me!.subjectId),
  )
  assert.deepEqual(scope.access('invoices'), { allowed: false, reason: 'role_denied' })
  // Modül kaydı yemek ve servis modülünü öğretmene açmaz.
  assert.deepEqual(scope.access('mealMenus'), { allowed: false, reason: 'role_denied' })
  assert.deepEqual(scope.access('transportRoutes'), { allowed: false, reason: 'role_denied' })
  const events = scope.read('schoolEvents', state.schoolEvents)
  assert.ok(
    events.every((e) => (e.classId ? scope.classIds.has(e.classId) : e.branchId === me!.branchId)),
  )
  assert.ok(scope.read('clubs', state.clubs).every((c) => c.teacherId === 't1'))
  const clubIds = new Set(scope.read('clubs', state.clubs).map((c) => c.id))
  assert.ok(
    scope.read('clubMemberships', state.clubMemberships).every((m) => clubIds.has(m.clubId)),
  )
})

test('Pasif öğretmen kaydı ve başka kişinin bağlantısı kapsam vermez', () => {
  const state = seed()
  state.teachers.find((t) => t.id === 't1')!.isActive = false
  const scope = scopeFor(state, teacher())
  assert.equal(scope.teacher, undefined)
  assert.equal(scope.studentIds.size, 0)
  assert.deepEqual(scope.read('grades', state.grades), [])
  // Öğretmen rolü öğrenci bağlantısıyla öğrenci kapsamı kazanmaz (DOM-YTK-003).
  const mixed = scopeFor(state, { role: 'ogretmen', links: [{ kind: 'student', recordId: 's1' }] })
  assert.equal(mixed.studentIds.size, 0)
  assert.deepEqual(automationScope(state, { role: 'ogretmen' }).students, [])
})

test('Başka öğretmenin bağlantısı kendi sınıflarını verir', () => {
  const state = seed()
  const other = state.teachers.find((t) => t.branchId === 'b2')
  const scope = scopeFor(state, teacher(other!.id))
  assert.ok(scope.studentIds.size > 0)
  assert.ok(!scope.studentIds.has('s1'))
  assert.ok(
    [...scope.classIds].every((c) => state.classes.find((x) => x.id === c)!.branchId === 'b2'),
  )
})

test('Öğrenci yalnız kendi kayıtlarını görür (DOM-YTK-024)', () => {
  const state = seed()
  const scope = scopeFor(state, student())
  assert.deepEqual([...scope.studentIds], ['s1'])
  for (const name of [
    'grades',
    'attendance',
    'invoices',
    'quizAttempts',
    'submissions',
    'mockResults',
  ] as const)
    assert.deepEqual([...studentsOf(scope.read(name, rowsOf(state, name)))], ['s1'], name)
  assert.deepEqual(ids(scope.read('students', state.students)), ['s1'])
  assert.deepEqual(scope.access('contracts'), { allowed: false, reason: 'role_denied' })
  assert.deepEqual(scope.access('prospects'), { allowed: false, reason: 'role_denied' })
  assert.deepEqual(scope.access('bank'), { allowed: false, reason: 'role_denied' })
  const conversations = scope.read('conversations', state.conversations)
  assert.ok(conversations.length > 0)
  assert.ok(conversations.every((c) => c.studentId === 's1' && c.audience === 'student'))
  // Sınıfında ders veren öğretmenler iletişim ve performans alanları olmadan görünür.
  const teachers = scope.read('teachers', state.teachers)
  const classId = state.students.find((s) => s.id === 's1')!.classId
  assert.deepEqual(
    new Set(ids(teachers)),
    new Set(state.assignments.filter((a) => a.classId === classId).map((a) => a.teacherId)),
  )
  for (const t of teachers)
    for (const field of ['email', 'phone', 'attendanceRate', 'homeworkRate'])
      assert.ok(!(field in t))
  assert.ok(teachers.every((t) => t.name && t.subjectId))
  const grade = state.classes.find((c) => c.id === classId)!.grade
  assert.ok(scope.read('mockExams', state.mockExams).every((e) => e.grade === grade))
  assert.deepEqual(ids(scope.read('classes', state.classes)), [classId])
  assert.ok(
    scope
      .read('announcements', state.announcements)
      .every((a) => !a.classId || a.classId === classId),
  )
  const level = state.classes.find((c) => c.id === classId)!.level
  assert.ok(scope.read('materials', state.materials).every((m) => m.level === level))
})

test('Öğrenci etüt grubunda yalnız kendi satırını görür', () => {
  const state = seed()
  const session = {
    id: 'tutor-scope-test',
    teacherId: 't1',
    studentIds: ['s1', 's9'],
    scores: [
      { studentId: 's1', percent: 40 },
      { studentId: 's9', percent: 20 },
    ],
    attendance: { s1: 'Geldi', s9: 'Gelmedi' },
  }
  const [own] = scopeFor(state, student()).read('tutorSessions', [session])
  assert.deepEqual(own!.studentIds, ['s1'])
  assert.deepEqual(own!.scores, [{ studentId: 's1', percent: 40 }])
  assert.deepEqual(own!.attendance, { s1: 'Geldi' })
  assert.deepEqual(session.studentIds, ['s1', 's9'], 'kaynak kayıt değişmez')
  const [full] = scopeFor(state, teacher()).read('tutorSessions', [session])
  assert.deepEqual(full!.studentIds, ['s1', 's9'])
  assert.deepEqual(scopeFor(state, student('s3')).read('tutorSessions', [session]), [])
  // Alanları eksik JSON kaydı da güvenle daraltılır.
  const [bare] = scopeFor(state, student()).read('tutorSessions', [
    { id: 'bare', studentIds: ['s1', 7] },
  ])
  assert.deepEqual(bare, { id: 'bare', studentIds: ['s1'] })
})

test('Veli yalnız bağlı çocuklarını görür; bağlı olmayan çocuk sızmaz (DOM-YTK-025)', () => {
  const state = seed()
  const scope = scopeFor(state, parent('s1', 's2', 'olmayan-ogrenci'))
  assert.deepEqual(new Set(scope.studentIds), new Set(['s1', 's2']))
  for (const name of ['grades', 'attendance', 'invoices', 'contracts', 'mockResults'] as const) {
    const visible = studentsOf(scope.read(name, rowsOf(state, name)))
    assert.ok(!visible.has('s3'), name)
    assert.ok(
      [...visible].every((s) => s === 's1' || s === 's2'),
      name,
    )
  }
  assert.deepEqual(new Set(studentsOf(scope.read('grades', state.grades))), new Set(['s1', 's2']))
  assert.ok(scope.read('conversations', state.conversations).every((c) => c.audience === 'parent'))
  assert.deepEqual(ids(scope.read('parents', state.parents)), ['p1'])
  const other = scopeFor(state, parent('s3'))
  assert.deepEqual(studentsOf(other.read('grades', state.grades)), new Set(['s3']))
  assert.deepEqual(scopeFor(state, parent()).read('grades', state.grades), [])
  assert.equal(
    redactRecord(
      state,
      parent('s1'),
      'grades',
      state.grades.find((g) => g.studentId === 's3')!,
    ),
    undefined,
  )
})

test('Bilinmeyen koleksiyon ve rol en dar varsayılandır', () => {
  const state = seed()
  const scope = scopeFor(state, admin)
  for (const name of ['olmayan', 'toString', '__proto__', 'modules', 'preferences']) {
    assert.deepEqual(scope.access(name), { allowed: false, reason: 'unknown_collection' }, name)
    assert.deepEqual(scope.read(name, [{ id: 'x' }]), [])
    assert.equal(scope.canRead(name, { id: 'x' }), false)
    assert.deepEqual(scope.hiddenFields(name), [])
    assert.throws(
      () => requireReadable(scope, name),
      isDomainError('collection_not_found', 'not_found'),
    )
  }
  // @ts-expect-error — bilinçli bilinmeyen koleksiyon
  assert.deepEqual(visibleRecords(state, admin, 'olmayan'), [])
  const stranger = scopeFor(state, {
    // @ts-expect-error — bilinçli bilinmeyen rol
    role: 'misafir',
    links: [{ kind: 'student', recordId: 's1' }],
  })
  assert.equal(stranger.studentIds.size, 0)
  for (const name of COLLECTION_NAMES)
    assert.deepEqual(stranger.access(name), { allowed: false, reason: 'role_denied' }, name)
  assert.throws(
    () => requireReadable(stranger, 'subjects'),
    isDomainError('permission_denied', 'forbidden'),
  )
})

test('Modül kapalıyken veya kurum türünde yokken koleksiyon okunmaz (DOM-YTK-012, -040)', () => {
  const state = seed()
  state.modules.exams = false
  for (const actor of [admin, teacher(), student(), parent('s1')]) {
    const scope = scopeFor(state, actor)
    assert.deepEqual(scope.access('mockResults'), { allowed: false, reason: 'module_disabled' })
    assert.deepEqual(scope.read('mockResults', state.mockResults), [])
    assert.throws(
      () => requireReadable(scope, 'mockExams'),
      isDomainError('module_disabled', 'forbidden'),
    )
  }
  delete state.modules.finance
  assert.deepEqual(scopeFor(state, admin).access('invoices'), {
    allowed: false,
    reason: 'module_disabled',
  })
  assert.ok(scopeFor(state, admin).access('students').allowed, 'çekirdek koleksiyon kapanmaz')
  const language = scopeFor(seed(), admin, { institutionType: 'language_school' })
  assert.equal(language.institutionType, 'language_school')
  assert.deepEqual(language.access('guidanceCases'), {
    allowed: false,
    reason: 'module_unavailable',
  })
  assert.throws(
    () => requireReadable(language, 'guidanceCases'),
    isDomainError('collection_not_found', 'not_found'),
  )
  assert.ok(language.access('homework').allowed)
  assert.doesNotThrow(() => requireReadable(language, 'homework'))
})

test('Her rol ve koleksiyon için okuma hata vermez, yalnız izinli satırları döndürür', () => {
  const state = seed()
  for (const actor of [admin, frontOffice, teacher(), student(), parent('s1', 's2')]) {
    const scope = scopeFor(state, actor)
    for (const name of COLLECTION_NAMES) {
      const rows = scope.read(name, rowsOf(state, name))
      assert.ok(rows.length <= rowsOf(state, name).length, `${actor.role}/${name}`)
      if (!scope.access(name).allowed) assert.equal(rows.length, 0)
    }
  }
})

test('Demo iş akışı kapsamı bugünkü davranışını korur', () => {
  const state = seed()
  const veli = workflowScope(state, { role: 'veli', childId: 's2' })
  assert.deepEqual([...veli.studentIds], ['s2'])
  assert.equal(veli.student!.id, 's2')
  assert.equal(workflowScope(state, { role: 'veli', childId: 's3' }).studentIds.size, 0)
  assert.equal(workflowScope(state, { role: 'veli' }).studentIds.size, 0)
  const ogrenci = workflowScope(state, { role: 'ogrenci' })
  assert.deepEqual([...ogrenci.studentIds], ['s1'])
  assert.equal(workflowScope(state, { role: 'yonetici' }).institution, true)
  assert.equal(workflowScope(state, { role: 'onburo' }).institution, true)
  assert.equal(workflowScope(state, { role: 'ogretmen' }).teacher!.id, 't1')
  assert.equal(automationScope(state, { role: 'onburo' }).studentIds.size, 0)
  assert.deepEqual([...automationScope(state, { role: 'veli', childId: 's2' }).studentIds], ['s2'])
  assert.equal(automationScope(state, { role: 'veli', childId: 's3' }).studentIds.size, 0)
  assert.equal(automationScope(state, { role: 'yonetici' }).students.length, state.students.length)
})

test('API oturumu bağlantılarıyla iş akışı başka öğretmen adına çalışır', () => {
  const state = seed()
  const classId = state.students.find((s) => s.id === 's9')!.classId
  const assignment = state.assignments.find((a) => a.classId === classId && a.teacherId !== 't1')
  const session: Session = {
    role: 'ogretmen',
    links: [{ kind: 'teacher', recordId: assignment!.teacherId }],
  }
  const task = resultOf<{ teacherId: string }>(
    runWorkflow(
      state,
      session,
      'study-task',
      {
        studentId: 's9',
        subjectId: assignment!.subjectId,
        topic: 'Konu tekrarı',
        title: 'Haftalık tekrar',
        instructions: 'Örnek soruları çöz.',
        dueDate: '2026-10-20',
        minutes: 30,
      },
      id,
      undefined,
      now,
    ),
  )
  assert.equal(task.teacherId, assignment!.teacherId)
  assert.equal(state.audit[0]!.user_id, assignment!.teacherId)
  // Aynı öğrenci demo öğretmeninin kapsamında değildir.
  assert.ok(!workflowScope(state, { role: 'ogretmen' }).studentIds.has('s9'))
  const parentSession: Session = {
    role: 'veli',
    childId: 's9',
    links: [{ kind: 'child', recordId: 's9' }],
  }
  assert.deepEqual([...workflowScope(state, parentSession).studentIds], ['s9'])
})

test('guvenlik-kvkk §8, DOM-KAY-012: öğrencinin kimlik nosu yalnız yönetici ve ön büroya maskeli döner; doğum tarihini öğretmen görmez; ikisi aranmaz', () => {
  const state = seed()
  const found = state.students.find((s) => s.id === 's1')
  assert.ok(found)
  // Kimlik `student_identities` tablosundadır, State'te yoktur; maske ve arama dışı bırakma,
  // alan bir kayda yine de düşerse diye savunma olarak sınanır.
  const target: typeof found & { nationalId?: string; birthDate?: string } = Object.assign(found, {
    nationalId: '10000000146',
    birthDate: '2013-04-12',
  })
  const rowOf = (actor: Actor) => {
    const row = visibleRecords(state, actor, 'students').find((s) => s.id === 's1')
    assert.ok(row, actor.role)
    return row as Record<string, unknown>
  }
  const teacherId = state.classes.find((c) => c.id === target.classId)?.teacherId
  assert.ok(teacherId)
  for (const actor of [admin, frontOffice]) {
    const row = rowOf(actor)
    assert.equal(row.nationalId, '*******0146', actor.role)
    assert.equal(row.birthDate, '2013-04-12', actor.role)
  }
  const teacherRow = rowOf(teacher(teacherId))
  assert.equal('nationalId' in teacherRow, false)
  assert.equal('birthDate' in teacherRow, false)
  for (const actor of [student('s1'), parent('s1')]) {
    const row = rowOf(actor)
    assert.equal('nationalId' in row, false, actor.role)
    assert.equal(row.birthDate, '2013-04-12', actor.role)
  }
  // Ham kayıt değişmez; tam değer hiçbir okumada dönmez.
  assert.equal(target.nationalId, '10000000146')
  const redacted = redactRecord(state, admin, 'students', target) as Record<string, unknown> | null
  assert.equal(redacted?.nationalId, '*******0146')
  for (const actor of [admin, frontOffice, teacher(teacherId), student('s1'), parent('s1')]) {
    const excluded = scopeFor(state, actor).searchExcludedFields('students')
    assert.ok(excluded.includes('nationalId') && excluded.includes('birthDate'), actor.role)
    assert.equal(new Set(excluded).size, excluded.length, actor.role)
  }
  assert.deepEqual(scopeFor(state, frontOffice).searchExcludedFields('students'), [
    'progress',
    'nationalId',
    'birthDate',
  ])
  assert.deepEqual(scopeFor(state, admin).searchExcludedFields('grades'), [])
  // Kimlik nosu olmayan eski kayıt olduğu gibi döner.
  assert.equal('nationalId' in rowOf(admin), true)
  const other = visibleRecords(state, admin, 'students').find((s) => s.id === 's2')
  assert.equal(other && 'nationalId' in other, false)
})

// TODO(#10): veli de iletişimi görmemeli (DOM-ILT-073); kayıt testi değişince `parent('s1')`
// öğrenci döngüsüne taşınır.
test('DOM-KAY-003, DOM-YTK-020, DOM-YTK-055: yakınlık öğretmen ve öğrenciye dönmez; öğretmen iletişimi maskeli görür, öğrenci hiç görmez; veli ve personel görür', () => {
  const state = seed()
  const target = state.parents.find((p) => p.id === 'p1')
  assert.ok(target)
  Object.assign(target, {
    phone: '05551234567',
    email: 'veli@kampus.example',
    relationship: 'mother',
  })
  const teacherId = state.classes.find(
    (c) => c.id === state.students.find((s) => s.id === 's1')?.classId,
  )?.teacherId
  assert.ok(teacherId)
  const fromStudent = visibleRecords(state, student('s1'), 'parents').find((p) => p.id === 'p1') as
    Record<string, unknown> | undefined
  assert.ok(fromStudent)
  for (const field of ['phone', 'email', 'relationship'])
    assert.equal(field in fromStudent, false, `ogrenci ${field}`)
  const fromTeacher = visibleRecords(state, teacher(teacherId), 'parents').find(
    (p) => p.id === 'p1',
  ) as Record<string, unknown> | undefined
  assert.ok(fromTeacher)
  assert.equal('relationship' in fromTeacher, false)
  assert.equal(fromTeacher.phone, '0555 *** ** 67')
  assert.equal(fromTeacher.email, 'v***@kampus.example')
  for (const actor of [admin, frontOffice, parent('s1')]) {
    const row = visibleRecords(state, actor, 'parents').find((p) => p.id === 'p1') as
      Record<string, unknown> | undefined
    assert.equal(row?.email, 'veli@kampus.example', actor.role)
    assert.equal(row?.phone, '05551234567', actor.role)
  }
})

test('Okuma kuralı iki kaynakta (platform ve Onur bloğu) birden bulunmaz; birleşim her koleksiyonu kapsar (IST-004)', () => {
  const shared = Object.keys(PLATFORM_READ_RULES).filter((name) =>
    Object.hasOwn(ONUR_READ_RULES, name),
  )
  assert.deepEqual(shared, [], `koleksiyon iki kaynakta: ${shared.join(', ')}`)
  assert.deepEqual(
    [...Object.keys(PLATFORM_READ_RULES), ...Object.keys(ONUR_READ_RULES)].sort(),
    [...COLLECTION_NAMES].sort(),
  )
})
