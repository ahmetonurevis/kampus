import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  ASSESSMENT_COMMANDS,
  ONUR_OPERATION_COMMANDS,
  ONUR_WORKFLOW_COMMANDS,
  OPERATION_COMMANDS,
  WORKFLOW_COMMANDS,
  commandSpec,
  isAssessmentCommand,
  isOperationCommand,
  isWorkflowCommand,
  type CommandSpec,
} from '../packages/school-core/src/modules/commands.ts'
import {
  PLATFORM_OPERATION_COMMANDS,
  PLATFORM_WORKFLOW_COMMANDS,
} from '../packages/school-core/src/platform/commands.ts'
import {
  COLLECTION_NAMES,
  MODULE_KEYS,
} from '../packages/school-core/src/modules/collection-modules.ts'
import { SCOPE_SOURCE_COLLECTIONS, type Actor } from '../packages/school-core/src/lib/scope.ts'
import { WRITE_ACTIONS, requireAuthorized } from '../packages/school-core/src/lib/authorize.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import { runAssessment } from '../packages/school-core/src/lib/assessment-automation.ts'
import { recordAttendance } from '../packages/school-core/src/lib/domain.ts'
import { payInvoice } from '../packages/school-core/src/lib/payments-demo.ts'
import { enrollProspect } from '../packages/school-core/src/lib/enrollment.ts'
import { recordGrade, updateGrade } from '../packages/school-core/src/lib/grades.ts'
import {
  archiveRecord,
  createClass,
  restoreRecord,
  saveBranch,
  saveTeacher,
  updateBranch,
  updateClass,
  updateTeacher,
} from '../packages/school-core/src/lib/school-management.ts'
import {
  markAnnouncementRead,
  markMessagesRead,
  openConversationAccess,
  publishAnnouncement,
  reviseAnnouncement,
  sendMessage,
  startConversation,
  withdrawAnnouncement,
} from '../packages/school-core/src/lib/communication.ts'
import {
  notifyAbsence,
  openRequest,
  updateRequest,
} from '../packages/school-core/src/lib/requests.ts'
import {
  bookableSlots,
  bookAppointment,
  updateAppointment,
} from '../packages/school-core/src/lib/appointments.ts'
import {
  answerQuestion,
  askQuestion,
  withdrawQuestion,
} from '../packages/school-core/src/lib/questions.ts'
import {
  archiveHomework,
  assignHomework,
  gradeSubmission,
  submitHomework,
  updateHomework,
} from '../packages/school-core/src/lib/homework.ts'
import {
  archivePermissionForm,
  cancelPermissionForm,
  closePermissionForm,
  createPermissionForm,
  decidePermission,
  updatePermissionForm,
} from '../packages/school-core/src/lib/permission-forms.ts'
import {
  addProspectNote,
  changeProspectStage,
  createProspect,
  scheduleProspectMeeting,
  scheduleTrialLesson,
} from '../packages/school-core/src/lib/prospects.ts'
import {
  archiveQuiz,
  createQuiz,
  startQuiz,
  submitQuiz,
  updateQuiz,
} from '../packages/school-core/src/lib/quiz.ts'
import { csvTemplate } from '../packages/school-core/src/lib/workflow-presentation.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import { isDomainError } from './support/domain-error.ts'
import { resultOf } from './support/result.ts'

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-command-test-${++sequence}`
const admin: Session = { role: 'yonetici', childId: 's1' }
const STATE_KEYS = new Set(Object.keys(seed()))

/**
 * API'nin State görünümü gibi: yalnız komut tablosundaki anahtarlar yüklenir; başka State
 * anahtarını okumak veya yazmak hemen hata verir. Denetim listesi her zaman boş verilir.
 */
function guarded(state: State, spec: CommandSpec): State {
  const target: Record<string, unknown> = { audit: [] }
  for (const key of [...spec.collections, ...spec.scalars]) target[key] = state[key]
  const fail = (key: PropertyKey) => {
    throw new Error(`Komut tablosunda olmayan State anahtarı: ${String(key)}`)
  }
  return new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === 'string' && !Object.hasOwn(object, key) && STATE_KEYS.has(key)) fail(key)
      return Reflect.get(object, key, receiver)
    },
    set(object, key, value, receiver) {
      if (typeof key !== 'string' || !Object.hasOwn(object, key)) fail(key)
      // Diziyi yeniden atayan işlemin sonucu sonraki komutlar için asıl State'e de yazılır.
      if (key !== 'audit') Reflect.set(state, key, value)
      return Reflect.set(object, key, value, receiver)
    },
  }) as unknown as State
}
const workflow = (
  state: State,
  command: string,
  input: unknown,
  recordId?: string,
  session = admin,
) => {
  const spec = commandSpec('workflow', command)
  assert.ok(spec, command)
  return runWorkflow(guarded(state, spec), session, command, input, id, recordId, now)
}
const assessment = (
  state: State,
  command: string,
  input: Record<string, unknown>,
  recordId = '',
  session = admin,
) => {
  const spec = commandSpec('assessment', command)
  assert.ok(spec, command)
  return runAssessment(guarded(state, spec), session, command, input, id, recordId, now)
}
const operation = (state: State, command: string) => {
  const spec = commandSpec('operation', command)
  assert.ok(spec, command)
  return guarded(state, spec)
}

test('Komut tabloları geçerli modül ve koleksiyon adlarını, kapsam kaynağını içerir', () => {
  const tables = { ...WORKFLOW_COMMANDS, ...ASSESSMENT_COMMANDS, ...OPERATION_COMMANDS }
  for (const [command, spec] of Object.entries(tables)) {
    assert.ok(spec.module === null || MODULE_KEYS.includes(spec.module), command)
    for (const collection of spec.collections)
      assert.ok(COLLECTION_NAMES.includes(collection), `${command}: ${collection}`)
    for (const collection of SCOPE_SOURCE_COLLECTIONS)
      assert.ok(spec.collections.includes(collection), `${command}: ${collection}`)
    assert.ok(!spec.collections.includes('audit'), command)
    assert.equal(new Set(spec.collections).size, spec.collections.length, command)
    assert.ok(spec.scalars.includes('modules'), command)
  }
  assert.deepEqual(Object.keys(OPERATION_COMMANDS), [...WRITE_ACTIONS])
  assert.equal(OPERATION_COMMANDS['record.archive'].module, null)
  assert.equal(OPERATION_COMMANDS['invoice.pay'].module, 'finance')
})

test('Komut adı iki kaynakta (platform ve Onur bloğu) birden bulunmaz; birleşik tablo ikisinin toplamıdır', () => {
  const pairs = [
    ['iş akışı', PLATFORM_WORKFLOW_COMMANDS, ONUR_WORKFLOW_COMMANDS, WORKFLOW_COMMANDS],
    ['işlem', PLATFORM_OPERATION_COMMANDS, ONUR_OPERATION_COMMANDS, OPERATION_COMMANDS],
  ] as const
  for (const [ad, platform, onur, merged] of pairs) {
    const shared = Object.keys(platform).filter((name) => Object.hasOwn(onur, name))
    assert.deepEqual(shared, [], `${ad} komutu iki kaynakta: ${shared.join(', ')}`)
    assert.equal(
      Object.keys(merged).length,
      Object.keys(platform).length + Object.keys(onur).length,
      ad,
    )
  }
})

test('Komut adı yerleşik özellik olduğunda tanınmaz; yürütücü adı ayırır', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'yok']) {
    assert.equal(isWorkflowCommand(name), false)
    assert.equal(isAssessmentCommand(name), false)
    assert.equal(isOperationCommand(name), false)
    assert.equal(commandSpec('workflow', name), undefined)
  }
  assert.equal(isAssessmentCommand('attendance'), true)
  assert.equal(isWorkflowCommand('attendance'), false)
  assert.equal(commandSpec('assessment', 'attendance')?.module, 'tutoring')
  assert.equal(commandSpec('operation', 'attendance.record')?.module, 'academic')
})

test('Her iş akışı komutu tablodaki modül kapalıyken reddedilir', () => {
  for (const [command, spec] of Object.entries(WORKFLOW_COMMANDS)) {
    const state = seed()
    state.modules[spec.module] = false
    assert.throws(
      () => runWorkflow(state, admin, command, {}, id, undefined, now),
      isDomainError('module_disabled', 'forbidden'),
      command,
    )
  }
})

test('İş akışı komutları yalnız tablodaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const goal = resultOf<{ id: string }>(
    workflow(state, 'goal', {
      studentId: 's1',
      subjectId: 'science',
      title: 'Fen netini yükseltmek',
      targetNet: 18,
      deadline: '2026-11-15',
      motivation: 'Deneylerde daha emin olmak istiyorum.',
    }),
  )
  workflow(state, 'goal-suggest', {}, goal.id)
  workflow(state, 'goal-step', { title: 'Tekrar', topic: '', dueDate: '2026-10-20' }, goal.id)
  workflow(state, 'goal-comment', { text: 'Destekliyoruz.' }, goal.id, {
    role: 'veli',
    childId: 's1',
  })
  workflow(state, 'goal-close', { status: 'Tamamlandı', note: 'Hedefe ulaşıldı.' }, goal.id)
  workflow(
    state,
    'guidance',
    {
      studentId: 's1',
      teacherId: 't1',
      title: 'Tablo takibi',
      plan: 'Haftalık görüşme planı.',
      sharedNote: '',
      followUp: '2026-10-20',
    },
    undefined,
    { role: 'ogretmen' },
  )
  workflow(state, 'exam-import', { csv: csvTemplate })
  workflow(state, 'exam-result', {
    examId: 'exam-7-1',
    studentId: 's1',
    subjectId: 'math',
    correct: 10,
    wrong: 5,
    blank: 5,
    weakTopics: 'Denklemler',
  })
  const lesson = state.schedule.find((l) => l.classId === 'c1' && l.subjectId === 'math')!
  const created = resultOf<{ id: string }>(
    workflow(state, 'lesson', {
      classId: lesson.classId,
      teacherId: 't1',
      subjectId: lesson.subjectId,
      date: '2026-10-18T06:00:00Z',
      duration: lesson.duration,
      room: lesson.room,
    }),
  )
  workflow(state, 'lesson-cancel', { reason: 'Okul gezisi.' }, created.id)
  workflow(
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
    { role: 'ogrenci' },
  )
  workflow(state, 'consent', { decision: 'Onaylandı', note: 'Katılabilir.' }, 'event-science', {
    role: 'veli',
    childId: 's1',
  })
  // İptal edilen etkinliğe onay verilemez; iptal onaydan sonra çalışır.
  workflow(state, 'event-cancel', {}, 'event-science')
  // `transport-assign` güzergâhı döndürür; atama kaydı State'ten okunur.
  workflow(state, 'transport-assign', { studentId: 's1', routeId: 'route-b1', stop: 'Bahariye' })
  const assigned = state.transportAssignments.find((a) => a.studentId === 's1')
  assert.ok(assigned)
  workflow(state, 'transport-remove', {}, assigned.id)
  workflow(
    state,
    'meal',
    {
      branchId: 'b1',
      date: '2026-10-06',
      title: 'Çorba ve pilav',
      allergens: 'Gluten, süt',
      description: 'Yeni menü',
    },
    'meal-0',
  )
  workflow(state, 'club-enroll', { studentId: 's1' }, 'club-art', { role: 'ogrenci' })
  workflow(
    state,
    'club-attendance',
    { date: '2026-10-06', marks: { s1: 'Geldi', s2: 'İzinli' } },
    'club-science',
    {
      role: 'ogretmen',
    },
  )
  workflow(state, 'club-archive', {}, 'club-science', { role: 'ogretmen' })
  const renewal = resultOf<{ id: string }>(
    workflow(state, 'renewal', {
      studentId: 's1',
      targetClassId: 'c4',
      year: 2027,
      mode: 'renew',
      total: 28500.01,
      scholarship: 15,
      discount: 100.02,
      count: 7,
      startDate: '2027-01-31',
    }),
  )
  workflow(state, 'renewal-activate', {}, renewal.id)
})

test('Optik ve etüt komutları yalnız tablodaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const text =
    'student;booklet;answers\n2026001;A;BBBDABCDABCD\n2026025;A;BBBDABCDABCD\n2026049;A;BBBDABCDABCD'
  assessment(state, 'evaluate', { profileId: 'optical-exam-7-1', text })
  const plan = {
    examId: 'exam-7-1',
    threshold: 70,
    fromDate: '2026-10-07',
    toDate: '2026-10-20',
    duration: 30,
    maxGroupSize: 12,
    branchId: '',
    subjectId: '',
  }
  assessment(state, 'plan', plan)
  const session = state.tutorSessions.at(-1)
  assert.ok(session)
  assessment(state, 'cancel', { reason: 'Öğretmen izinli.' }, session.id)
  const slot = resultOf<{ id: string }>(
    assessment(state, 'slot', { teacherId: 't1', date: '2026-10-21T13:00:00.000Z', duration: 30 }),
  )
  assessment(state, 'slot-remove', {}, slot.id)
})

test('Temel yazma işlemleri yetkiyle birlikte yalnız tablodaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const teacher: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }
  const director: Actor = { role: 'yonetici', links: [] }
  const invoice = state.invoices.find((i) => i.studentId === 's1' && !i.paidAt)!
  const pay = operation(state, 'invoice.pay')
  requireAuthorized(director, 'invoice.pay', { studentId: 's1' }, pay)
  payInvoice(pay, invoice.id, 'Banka havalesi', now)
  // Çevrim içi ödeme henüz işlem çağırmaz; yetkisi tablodaki kaynakla çözülür.
  const parent: Actor = { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] }
  requireAuthorized(
    parent,
    'invoice.payOnline',
    { studentId: 's1' },
    operation(state, 'invoice.payOnline'),
  )
  const marks = Object.fromEntries(
    state.students.filter((s) => s.classId === 'c1' && s.isActive).map((s) => [s.id, 'present']),
  )
  const attendance = operation(state, 'attendance.record')
  requireAuthorized(teacher, 'attendance.record', { classId: 'c1', date: now }, attendance, { now })
  recordAttendance(attendance, 'c1', now, marks, now)
  const quiz = state.quizzes.find((q) => q.classId === 'c1' && q.subjectId === 'math')!
  const grade = recordGrade(
    operation(state, 'grade.record'),
    teacher,
    {
      studentId: 's1',
      subjectId: 'math',
      term: 1,
      assessmentType: 'performans',
      date: '2026-10-05',
      quizId: quiz.id,
    },
    id,
    now,
  )
  const graded = recordGrade(
    operation(state, 'grade.record'),
    teacher,
    {
      studentId: 's1',
      subjectId: 'math',
      term: 1,
      assessmentType: 'sinav',
      date: '2026-10-05',
      score: 70,
    },
    id,
    now,
  )
  assert.ok(grade.quizId)
  updateGrade(
    operation(state, 'grade.update'),
    teacher,
    graded.id,
    { score: 72, reason: 'Toplama' },
    now,
  )
  const replacement = state.classes.find((c) => c.id !== 'c1' && c.grade === 7 && c.isActive)!
  const archive = operation(state, 'record.archive')
  requireAuthorized(director, 'record.archive', { kind: 'class' }, archive)
  archiveRecord(archive, 'class', 'c1', replacement.id, now)
  const restore = operation(state, 'record.restore')
  requireAuthorized(director, 'record.restore', { kind: 'class' }, restore)
  restoreRecord(restore, 'class', 'c1')
  const branch = operation(state, 'branch.save')
  requireAuthorized(director, 'branch.save', {}, branch)
  const branchId = saveBranch(branch, { name: 'Tablo Kampüsü', address: 'Adres' }, id)
  updateBranch(operation(state, 'branch.save'), branchId, { address: 'Yeni adres' }, id)
  const teacherSave = operation(state, 'teacher.save')
  requireAuthorized(director, 'teacher.save', {}, teacherSave)
  const teacherId = saveTeacher(
    teacherSave,
    {
      name: 'Tablo Öğretmeni',
      email: 'tablo@kampus.example',
      phone: '05559990003',
      subjectId: 'math',
      branchId: 'b1',
    },
    id,
    null,
    now,
  )
  updateTeacher(operation(state, 'teacher.save'), teacherId, { branchId: branchId }, id, now)
  const classSave = operation(state, 'class.save')
  requireAuthorized(director, 'class.save', {}, classSave)
  const subjectTeachers = Object.fromEntries(
    state.assignments.filter((a) => a.classId === 'c1').map((a) => [a.subjectId, a.teacherId]),
  )
  const classId = createClass(
    classSave,
    {
      grade: 7,
      section: 'T',
      branchId: 'b1',
      teacherId: 't1',
      capacity: 20,
      room: 'T1',
      subjectTeachers,
    },
    id,
    now,
  )
  // Var olan sınıfın düzenlemesi program, etüt ve açık işleri de okur.
  updateClass(operation(state, 'class.save'), 'c1', { room: 'T2' }, id, now)
  updateClass(operation(state, 'class.save'), classId, { capacity: 22 }, id, now)
})

test('İletişim işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const director = { role: 'yonetici' as const, links: [], userId: 'u-admin' }
  const teacher = {
    role: 'ogretmen' as const,
    links: [{ kind: 'teacher' as const, recordId: 't2' }],
    userId: 'u-t2',
  }
  const parent = {
    role: 'veli' as const,
    links: [{ kind: 'child' as const, recordId: 's1' }],
    userId: 'u-veli',
  }
  const published = publishAnnouncement(
    operation(state, 'announcement.publish'),
    teacher,
    {
      title: 'Kitap listesi',
      text: 'Okuma listesi panoda.',
      category: 'Akademik',
      target: { classIds: ['c1'], roles: ['veli'] },
    },
    id,
    now,
  )
  reviseAnnouncement(
    operation(state, 'announcement.revise'),
    teacher,
    published.id,
    { title: 'Güncel kitap listesi' },
    now,
  )
  markAnnouncementRead(operation(state, 'announcement.read'), parent, published.id, now)
  withdrawAnnouncement(
    operation(state, 'announcement.withdraw'),
    director,
    published.id,
    { reason: 'Yanlış sınıf' },
    now,
  )
  const { conversation } = startConversation(
    operation(state, 'conversation.start'),
    parent,
    { studentId: 's1', teacherId: 't2', text: 'Merhaba' },
    id,
    now,
  )
  sendMessage(
    operation(state, 'message.send'),
    teacher,
    conversation.id,
    { text: 'Merhaba' },
    id,
    now,
  )
  markMessagesRead(operation(state, 'message.read'), parent, conversation.id, now)
  // Gerekçeli erişim yalnız öğrenci–öğretmen yazışmasındadır (DOM-ILT-011).
  const pupil = {
    role: 'ogrenci' as const,
    links: [{ kind: 'student' as const, recordId: 's1' }],
    userId: 'u-s1',
  }
  const pupilConversation = startConversation(
    operation(state, 'conversation.start'),
    pupil,
    { studentId: 's1', teacherId: 't2', text: 'Merhaba hocam' },
    id,
    now,
  ).conversation
  openConversationAccess(
    operation(state, 'conversation.access'),
    director,
    pupilConversation.id,
    { reason: 'Şikâyet dilekçesi incelemesi' },
    now,
  )
})

test('Talep ve izin/mazeret işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const parent = {
    role: 'veli' as const,
    links: [{ kind: 'child' as const, recordId: 's1' }],
    userId: 'u-veli',
  }
  const front = { role: 'onburo' as const, links: [], userId: 'u-front' }
  const opened = openRequest(
    operation(state, 'request.open'),
    parent,
    { studentId: 's1', category: 'Talep', title: 'Servis', text: 'Servis saati değişsin.' },
    id,
    now,
  )
  updateRequest(
    operation(state, 'request.update'),
    front,
    opened.id,
    { status: 'Çözüldü', reply: 'Saat güncellendi.' },
    id,
    now,
  )
  notifyAbsence(
    operation(state, 'absence.notify'),
    parent,
    {
      studentId: 's1',
      startDate: '2026-10-08',
      endDate: '2026-10-08',
      reasonCategory: 'health',
    },
    id,
    now,
  )
})

test('Randevu işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır (DOM-ILT-100, DOM-ILT-102)', () => {
  const state = seed()
  const parent = {
    role: 'veli' as const,
    links: [{ kind: 'child' as const, recordId: 's1' }],
    userId: 'u-veli',
  }
  const teacher = {
    role: 'ogretmen' as const,
    links: [{ kind: 'teacher' as const, recordId: 't1' }],
    userId: 'u-t1',
  }
  const booked = bookAppointment(
    operation(state, 'appointment.book'),
    parent,
    { studentId: 's1', slotId: 'slot-t1-0', note: 'Matematik ödevlerini konuşalım.' },
    id,
    now,
  )
  const approved = updateAppointment(
    operation(state, 'appointment.update'),
    teacher,
    booked.id,
    { status: 'Onaylandı' },
    now,
  )
  assert.equal(approved.status, 'Onaylandı')
  // DOM-ILT-105: saat listesi kampüs ve ders adını da okur.
  const slots = bookableSlots(
    operation(state, 'appointment.slots'),
    parent,
    { studentId: 's1' },
    now,
  )
  assert.ok(slots.some((slot) => slot.campusName && slot.subjectNames.length > 0))
})

test('Öğretmenime Sor işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const student = {
    role: 'ogrenci' as const,
    links: [{ kind: 'student' as const, recordId: 's1' }],
    userId: 'u-s1',
  }
  const teacher = {
    role: 'ogretmen' as const,
    links: [{ kind: 'teacher' as const, recordId: 't1' }],
    userId: 'u-t1',
  }
  const asked = askQuestion(
    operation(state, 'question.ask'),
    student,
    {
      subjectId: 'math',
      topic: 'Denklemler',
      title: 'Denklem',
      text: 'Eşitliğin iki tarafına neden aynı işlemi yapıyoruz?',
    },
    id,
    now,
  )
  answerQuestion(
    operation(state, 'question.answer'),
    teacher,
    asked.id,
    { text: 'Denge.' },
    id,
    now,
  )
  withdrawQuestion(operation(state, 'question.withdraw'), student, 'ask1', { withdrawn: true }, now)
})

test('Ödev işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır (DOM-AKD-070…073)', () => {
  const state = seed()
  const student = {
    role: 'ogrenci' as const,
    links: [{ kind: 'student' as const, recordId: 's1' }],
    userId: 'u-s1',
  }
  const teacher = {
    role: 'ogretmen' as const,
    links: [{ kind: 'teacher' as const, recordId: 't1' }],
    userId: 'u-t1',
  }
  const homework = assignHomework(
    operation(state, 'homework.assign'),
    teacher,
    {
      classId: 'c1',
      title: 'Denklem',
      description: 'Soruları çözün.',
      dueDate: '2026-12-01T20:59:00.000Z',
    },
    id,
    now,
  )
  updateHomework(operation(state, 'homework.update'), teacher, 'hw1', { title: 'Yeni' }, now)
  const { submission } = submitHomework(
    operation(state, 'homework.submit'),
    student,
    'hw1',
    { note: 'Çözümler.' },
    id,
    now,
  )
  gradeSubmission(
    operation(state, 'homework.grade'),
    teacher,
    'hw1',
    submission.id,
    { score: 90, feedback: 'İyi.' },
    now,
  )
  archiveHomework(operation(state, 'homework.archive'), teacher, homework.id)
})

test('İzin formu işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır (DOM-ILT-036…038)', () => {
  const state = seed()
  const teacher = {
    role: 'ogretmen' as const,
    links: [{ kind: 'teacher' as const, recordId: 't1' }],
    userId: 'u-t1',
  }
  const parent = {
    role: 'veli' as const,
    links: [{ kind: 'child' as const, recordId: 's1' }],
    userId: 'u-p1',
  }
  const input = {
    topic: 'trip',
    title: 'Müze gezisi',
    description: 'Cuma günü müze gezisi.',
    deadline: '2026-10-09',
    classIds: ['c1'],
  }
  const form = createPermissionForm(
    operation(state, 'permissionForm.create'),
    teacher,
    input,
    id,
    now,
  )
  const spare = createPermissionForm(
    operation(state, 'permissionForm.create'),
    teacher,
    input,
    id,
    now,
  )
  updatePermissionForm(
    operation(state, 'permissionForm.update'),
    teacher,
    form.id,
    { title: 'Yeni' },
    now,
  )
  decidePermission(
    operation(state, 'permissionForm.decide'),
    parent,
    form.id,
    { studentId: 's1', decision: 'approved' },
    id,
    now,
  )
  closePermissionForm(operation(state, 'permissionForm.close'), teacher, form.id, now)
  cancelPermissionForm(operation(state, 'permissionForm.cancel'), teacher, form.id, now)
  archivePermissionForm(operation(state, 'permissionForm.archive'), teacher, spare.id)
})

test('Aday/CRM işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır', () => {
  const state = seed()
  const front = { role: 'onburo' as const, links: [], userId: 'u-front' }
  const language = { institutionType: 'language_school' } as const
  const created = createProspect(
    operation(state, 'prospect.create'),
    front,
    {
      name: 'Komut Aday',
      phone: '05559998001',
      branchId: 'b1',
      interest: 'B1 · Genel İngilizce',
      source: 'Telefon',
      minor: true,
      guardianName: 'Komut Veli',
      privacyNoticeVersion: 'aydinlatma-2026-1',
    },
    id,
    now,
    language,
  )
  changeProspectStage(
    operation(state, 'prospect.stage'),
    front,
    created.id,
    { stage: 'İletişime geçildi' },
    now,
    language,
  )
  addProspectNote(
    operation(state, 'prospect.note'),
    front,
    created.id,
    { text: 'Aradım.' },
    id,
    now,
  )
  scheduleProspectMeeting(
    operation(state, 'prospect.meeting'),
    front,
    created.id,
    { date: '2026-10-10T10:00:00.000Z', room: 'Görüşme odası', teacherId: 't1' },
    now,
    language,
  )
  const lesson = state.schedule.find(
    (l) => l.classId === 'c1' && Date.parse(l.date) > Date.parse(now),
  )!
  scheduleTrialLesson(
    operation(state, 'prospect.trial'),
    front,
    created.id,
    { lessonId: lesson.id, guardianConsent: true },
    now,
    language,
  )
  changeProspectStage(
    operation(state, 'prospect.stage'),
    front,
    created.id,
    { stage: 'Vazgeçti', lostReason: 'price' },
    now,
    language,
  )
  enrollProspect(
    operation(state, 'prospect.enroll'),
    { prospectId: 'pr1', classId: 'c1', total: 120000, count: 3, startDate: '2026-11-01' },
    id,
    now,
  )
})

test('Quiz işlemleri yalnız komut tablosundaki koleksiyonlarla çalışır (DOM-AKD-075…078)', () => {
  const state = seed()
  const student = {
    role: 'ogrenci' as const,
    links: [{ kind: 'student' as const, recordId: 's1' }],
    userId: 'u-s1',
  }
  const teacher = {
    role: 'ogretmen' as const,
    links: [{ kind: 'teacher' as const, recordId: 't1' }],
    userId: 'u-t1',
  }
  const input = { classId: 'c1', title: 'Denklem', duration: 15, questionIds: ['q-math-7-0'] }
  const quiz = createQuiz(operation(state, 'quiz.create'), teacher, input, id, now)
  updateQuiz(operation(state, 'quiz.update'), teacher, quiz.id, { title: 'Yeni' }, now)
  const { attempt } = startQuiz(operation(state, 'quiz.start'), student, quiz.id, id, now)
  submitQuiz(
    operation(state, 'quiz.submit'),
    student,
    quiz.id,
    { answers: { 'q-math-7-0': 0 } },
    now,
  )
  assert.equal(attempt.status, 'completed')
  const spare = createQuiz(operation(state, 'quiz.create'), teacher, input, id, now)
  archiveQuiz(operation(state, 'quiz.archive'), teacher, spare.id)
})
