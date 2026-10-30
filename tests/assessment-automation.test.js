import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  previewOptical,
  runAssessment,
  prepareProfile,
  planTutoring,
  currentEvaluations,
  tutoringSessions,
  exampleOpticalFile,
} from '../packages/school-core/src/lib/assessment-automation.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import { archiveRecord, saveTeacher } from '../packages/school-core/src/lib/school-management.ts'
import {
  createSnapshotWriter,
  restoreSnapshot,
} from '../packages/school-core/src/lib/demo-persistence.ts'
const now = '2026-10-06T10:00:00.000Z',
  seed = () => createSeed(new Date(now))
const admin = { role: 'yonetici', childId: 's1' },
  teacher = { role: 'ogretmen', childId: 's1' }
let serial = 0
const id = (prefix) => `${prefix}-auto-test-${++serial}`
const responses = (value = 'BBBDABCDABCD', student = '2026001', booklet = 'A') =>
  `student;booklet;answers\n${student};${booklet};${value}`
const evaluate = (state, text = responses(), session = admin) =>
  runAssessment(state, session, 'evaluate', { profileId: 'optical-exam-7-1', text }, id, '', now)
const input = {
  examId: 'exam-7-1',
  threshold: 70,
  fromDate: '2026-10-07',
  toDate: '2026-10-20',
  duration: 30,
  maxGroupSize: 12,
  branchId: '',
  subjectId: '',
}
function failsUnchanged(state, callback, pattern) {
  const previous = JSON.stringify(state)
  assert.throws(callback, pattern)
  assert.equal(JSON.stringify(state), previous)
}
const keyCsv = (profile, transform = (q) => q) =>
  [
    'booklet;question;subjectId;topic;answer',
    ...profile.keys.flatMap((k) =>
      k.questions.map((original) => {
        const q = transform(original)
        return `${k.booklet};${q.number};${q.subjectId};${q.topic};${q.answer}`
      }),
    ),
  ].join('\n')

test('Optik CSV soru bazında değerlendirir; önizleme veri değiştirmez, kitapçık B kendi anahtarını kullanır', () => {
  const state = seed(),
    before = JSON.stringify(state)
  const rows = previewOptical(state, admin, { profileId: 'optical-exam-7-1', text: responses() })
  assert.equal(JSON.stringify(state), before)
  assert.deepEqual([rows[0].correct, rows[0].wrong, rows[0].blank, rows[0].net], [2, 2, 0, 1.5])
  assert.equal(rows[0].topicScores[0].percent, 50)
  assert.equal(rows[0].questionResults[0].outcome, 'wrong')
  const alternate = previewOptical(state, admin, {
    profileId: 'optical-exam-7-1',
    text: responses('DCBADC BADCBA'.replace(' ', ''), '2026001', 'B'),
  })
  assert.ok(alternate.every((r) => r.correct === 4 && r.net === 4))
})
test('Boş, çoklu işaret ve iptal soru ayrı değerlendirilir; iptal sorular kazanım oranına girmez', () => {
  const state = seed(),
    profile = state.opticalProfiles[0]
  runAssessment(
    state,
    admin,
    'profile',
    {
      ...profile,
      keyCsv: keyCsv(profile, (q) =>
        q.subjectId === 'math' && q.answer === 'A' ? { ...q, answer: '-' } : q,
      ),
    },
    id,
    profile.id,
    now,
  )
  const row = previewOptical(state, admin, {
    profileId: profile.id,
    text: responses('-* DABCDABCD'),
  })[0]
  assert.deepEqual(
    [row.correct, row.wrong, row.blank, row.multiple, row.cancelled, row.net],
    [1, 1, 1, 1, 1, 0.75],
  )
  assert.deepEqual(row.topicScores, [{ topic: 'Denklemler', total: 3, correct: 1, percent: 33 }])
})
test('Alan konumlarıyla DAT/TXT okuma başlıkları atlar; boş cevap alanları korunur', () => {
  const state = seed(),
    profile = state.opticalProfiles[0]
  const data = {
    ...profile,
    format: 'fixed',
    headerLines: 1,
    studentStart: 3,
    studentLength: 7,
    bookletStart: 11,
    bookletLength: 1,
    answersStart: 13,
    answersLength: 12,
  }
  runAssessment(state, admin, 'profile', data, id, profile.id, now)
  const text = 'Başlık\r\n  2026001 A BBBDABCDABCD'
  const rows = previewOptical(state, admin, { profileId: profile.id, text })
  assert.equal(rows[0].net, 1.5)
  assert.ok(exampleOpticalFile(state, state.opticalProfiles[0]).startsWith('Örnek optik dosyası'))
  failsUnchanged(
    state,
    () =>
      runAssessment(
        state,
        admin,
        'evaluate',
        { profileId: profile.id, text: 'Başlık\n2026001' },
        id,
        '',
        now,
      ),
    /uzun değil/,
  )
  failsUnchanged(
    state,
    () => runAssessment(state, admin, 'profile', { ...data, bookletStart: 4 }, id, profile.id, now),
    /çakışmamalı/,
  )
})
test('Optik aktarım hatalı kimlik, tekrar, kitapçık, cevap ve kapsam durumlarında atomik reddedilir', () => {
  const state = seed()
  for (const text of [
    responses('ABC'),
    responses('ZZZZABCDABCD'),
    responses('ABCDABCDABCD', 'bulunamayan'),
    responses('ABCDABCDABCD', '2026002'),
    responses('ABCDABCDABCD', '2026001', 'Z'),
    responses() + '\n2026001;A;ABCDABCDABCD',
    responses() + '\nunknown;A;ABCDABCDABCD',
  ])
    failsUnchanged(state, () => evaluate(state, text))
  state.students[1].number = '2026001'
  failsUnchanged(state, () => evaluate(state), /tekil/)
  state.students[1].number = '2026002'
  state.students[0].isActive = false
  failsUnchanged(state, () => evaluate(state), /pasif/)
})
test('Öğretmen yalnızca kendi sınıf ve branş sonuçlarını yazar; örnek dosya kapsamına uygundur', () => {
  const state = seed(),
    oldTurkish = structuredClone(
      state.mockResults.find(
        (r) => r.studentId === 's1' && r.examId === 'exam-7-1' && r.subjectId === 'turkish',
      ),
    )
  evaluate(state, responses(), teacher)
  assert.equal(state.opticalEvaluations.length, 1)
  assert.deepEqual(
    state.mockResults.find((r) => r.id === oldTurkish.id),
    oldTurkish,
  )
  failsUnchanged(
    state,
    () => evaluate(state, responses('ABCDABCDABCD', '2026009'), teacher),
    /kapsam/,
  )
  assert.equal(
    previewOptical(state, teacher, {
      profileId: state.opticalProfiles[0].id,
      text: exampleOpticalFile(state, state.opticalProfiles[0], teacher),
    }).length,
    3,
  )
  failsUnchanged(
    state,
    () => prepareProfile(state, teacher, state.opticalProfiles[0], state.opticalProfiles[0].id),
    /yönetici/,
  )
  failsUnchanged(
    state,
    () => evaluate(state, responses(), { role: 'veli', childId: 's1' }),
    /yetkiniz/,
  )
})
test('Tekrar değerlendirme sonucu çoğaltmaz; anahtar ve manuel sonuç değişince eski kazanım analizi kullanılmaz', () => {
  const state = seed()
  evaluate(state)
  evaluate(state, responses('ABCDABCDABCD'))
  assert.equal(state.opticalEvaluations.length, 3)
  assert.equal(currentEvaluations(state, 'exam-7-1', admin)[0].correct, 4)
  const profile = state.opticalProfiles[0]
  runAssessment(
    state,
    admin,
    'profile',
    {
      ...profile,
      keyCsv: keyCsv(profile, (q) => ({ ...q, answer: q.answer === 'A' ? 'B' : q.answer })),
    },
    id,
    profile.id,
    now,
  )
  assert.equal(currentEvaluations(state, 'exam-7-1', admin).length, 0)
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 0)
  evaluate(state)
  runWorkflow(
    state,
    admin,
    'exam-result',
    {
      examId: 'exam-7-1',
      studentId: 's1',
      subjectId: 'math',
      correct: 1,
      wrong: 1,
      blank: 2,
      weakTopics: 'Denklemler',
    },
    id,
    undefined,
    now,
  )
  assert.equal(
    currentEvaluations(state, 'exam-7-1', admin).some((e) => e.subjectId === 'math'),
    false,
  )
})
test('Hatalı cevap anahtarı yeni profil veya kısmi anahtar oluşturmaz', () => {
  const state = seed(),
    profile = state.opticalProfiles[0]
  for (const keyCsv of [
    'booklet;question;subjectId;topic;answer\nA;1;math;Kazanım;Z',
    profile.keyCsv.replace('A;1;math', 'A;2;math'),
    profile.keyCsv.replace('B;12;math;Denklemler;A', 'B;12;math;Farklı kazanım;A'),
  ])
    failsUnchanged(state, () =>
      runAssessment(state, admin, 'profile', { ...profile, keyCsv }, id, profile.id, now),
    )
})
test('Etütler kazanım/kampüs/düzey bazında gruplanır, kapasiteye göre bölünür ve tekrar oluşturulmaz', () => {
  const state = seed()
  evaluate(state, responses() + '\n2026025;A;BBBDABCDABCD\n2026049;A;BBBDABCDABCD')
  const before = JSON.stringify(state)
  const plan = planTutoring(state, admin, { ...input, maxGroupSize: 2 }, now)
  assert.equal(plan.sessions.length, 2)
  assert.equal(plan.unresolved.length, 0)
  assert.ok(
    plan.sessions.every(
      (s) => s.subjectId === 'math' && s.topic === 'Denklemler' && s.studentIds.length <= 2,
    ),
  )
  assert.equal(new Set(plan.sessions.flatMap((s) => s.studentIds)).size, 3)
  assert.equal(JSON.stringify(state), before)
  runAssessment(
    state,
    admin,
    'plan',
    { ...input, maxGroupSize: 2, expectedPlan: JSON.stringify(plan) },
    id,
    '',
    now,
  )
  assert.equal(state.tutorSessions.length, 2)
  const parentGroup = tutoringSessions(state, { role: 'veli', childId: 's1' })[0]
  assert.deepEqual(parentGroup.studentIds, ['s1'])
  assert.deepEqual(
    parentGroup.scores.map((score) => score.studentId),
    ['s1'],
  )
  const repeated = planTutoring(state, admin, input, now)
  assert.equal(repeated.sessions.length, 0)
  assert.equal(repeated.covered.length, 3)
  failsUnchanged(state, () => runAssessment(state, admin, 'plan', input, id, '', now), /etüt yok/)
})
test('Etüt başarı eşiği yuvarlanmamış oranı kullanır; eşiğe eşit oran etüde alınmaz', () => {
  const state = seed(),
    profile = state.opticalProfiles[0]
  runAssessment(
    state,
    admin,
    'profile',
    {
      ...profile,
      keyCsv:
        'booklet;question;subjectId;topic;answer\nA;1;math;Denklemler;A\nA;2;math;Denklemler;B\nA;3;math;Denklemler;C\nA;4;turkish;Sözcükte anlam;A\nA;5;science;Hücre;A',
    },
    id,
    profile.id,
    now,
  )
  evaluate(state, responses('ABDAA'))
  assert.equal(currentEvaluations(state, input.examId, admin)[0].topicScores[0].percent, 67)
  assert.equal(planTutoring(state, admin, { ...input, threshold: 67 }, now).sessions.length, 1)
  assert.equal(planTutoring(state, admin, { ...input, threshold: 66 }, now).sessions.length, 0)
  // İki sorudan biri doğruysa oran tam %50'dir.
  runAssessment(
    state,
    admin,
    'profile',
    {
      ...profile,
      keyCsv:
        'booklet;question;subjectId;topic;answer\nA;1;math;Denklemler;A\nA;2;math;Denklemler;B\nA;3;turkish;Sözcükte anlam;A\nA;4;science;Hücre;A',
    },
    id,
    profile.id,
    now,
  )
  evaluate(state, responses('BBAA'))
  assert.equal(planTutoring(state, admin, { ...input, threshold: 50 }, now).sessions.length, 0)
})
test('Etüt planlayıcı öğretmen/öğrenci/derslik/randevu ve etkinlik çakışmalarını aşamaz', () => {
  const state = seed()
  evaluate(state)
  state.availability = [
    { id: 'only-slot', teacherId: 't1', date: '2026-10-07T13:00:00Z', duration: 30 },
  ]
  const initial = planTutoring(state, admin, input, now)
  assert.equal(initial.sessions.length, 1)
  const appointment = {
    id: 'blocking',
    studentId: 's2',
    teacherId: 't1',
    date: '2026-10-07T13:15:00Z',
    status: 'Bekliyor',
  }
  state.appointments.push(appointment)
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 0)
  state.appointments.pop()
  state.schedule.push({
    id: 'blocking-class',
    classId: 'c1',
    teacherId: 't3',
    subjectId: 'science',
    room: 'başka derslik',
    date: '2026-10-07T13:00:00Z',
    duration: 30,
  })
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 0)
  state.schedule.pop()
  for (const classroom of state.classes.filter((c) => c.branchId === 'b1'))
    state.schedule.push({
      id: `block-${classroom.id}`,
      classId: classroom.id,
      teacherId: 't14',
      room: classroom.room,
      date: '2026-10-07T13:00:00Z',
      duration: 30,
    })
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 0)
  state.schedule = state.schedule.filter((s) => !s.id.startsWith('block-'))
  state.schoolEvents.push({
    id: 'event-block',
    branchId: 'b1',
    classId: 'c1',
    date: '2026-10-07T13:00:00Z',
    endDate: '2026-10-07T14:00:00Z',
    location: 'Bahçe',
    status: 'Planlandı',
  })
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 0)
})
test('Yerleşmeyen etüt grupları açıklanır; son onay güncel verileri ve eski önizlemeyi denetler', () => {
  const state = seed()
  evaluate(state)
  const plan = planTutoring(state, admin, input, now)
  state.availability = []
  const blocked = planTutoring(state, admin, input, now)
  assert.equal(blocked.unresolved.length, 1)
  assert.match(blocked.unresolved[0].reason, /uygunluk/)
  failsUnchanged(
    state,
    () =>
      runAssessment(
        state,
        admin,
        'plan',
        { ...input, expectedPlan: JSON.stringify(plan) },
        id,
        '',
        now,
      ),
    /değişmiş/,
  )
  failsUnchanged(
    state,
    () => planTutoring(state, admin, { ...input, fromDate: '2026-02-31' }, now),
    /tarih/,
  )
  failsUnchanged(
    state,
    () => planTutoring(state, admin, { ...input, toDate: '2026-12-01' }, now),
    /aralığı/,
  )
})
test('Etüt iptali ve yoklaması geçmişi korur; öğretmen ve veli kapsamları ayrıdır', () => {
  const state = seed()
  evaluate(state)
  runAssessment(state, admin, 'plan', input, id, '', now)
  const entry = state.tutorSessions[0]
  assert.equal(tutoringSessions(state, { role: 'veli', childId: 's1' }).length, 1)
  assert.equal(tutoringSessions(state, { role: 'veli', childId: 's2' }).length, 0)
  assert.equal(tutoringSessions(state, { role: 'veli', childId: 's9' }).length, 0)
  failsUnchanged(
    state,
    () =>
      runAssessment(state, teacher, 'attendance', { marks: { s1: 'Geldi' } }, id, entry.id, now),
    /Gelecek/,
  )
  failsUnchanged(
    state,
    () =>
      runAssessment(state, teacher, 'attendance', { marks: {} }, id, entry.id, '2026-10-20T10:00Z'),
    /tüm/,
  )
  runAssessment(
    state,
    teacher,
    'attendance',
    { marks: { s1: 'Geldi' } },
    id,
    entry.id,
    '2026-10-20T10:00Z',
  )
  runAssessment(
    state,
    teacher,
    'attendance',
    { marks: { s1: 'İzinli' } },
    id,
    entry.id,
    '2026-10-20T10:00Z',
  )
  assert.equal(entry.attendance.s1, 'İzinli')
  assert.equal(state.tutorSessions.length, 1)
  failsUnchanged(
    state,
    () => runAssessment(state, teacher, 'cancel', { reason: 'İzin' }, id, entry.id, now),
    /Tamamlanmış/,
  )
})
test('Etüt iptali rezervasyonu kaldırır; yeniden plan, uygunluk UTC kaydı ve modül sınırları çalışır', () => {
  const state = seed()
  evaluate(state)
  runAssessment(state, admin, 'plan', input, id, '', now)
  const entry = state.tutorSessions[0]
  runAssessment(state, teacher, 'cancel', { reason: 'Öğretmen izinli.' }, id, entry.id, now)
  assert.equal(entry.status, 'İptal')
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 1)
  const slot = runAssessment(
    state,
    teacher,
    'slot',
    { teacherId: 't1', date: '2026-10-20T16:00:00+03:00', duration: 30 },
    id,
    '',
    now,
  )
  assert.equal(slot.date, '2026-10-20T13:00:00.000Z')
  runAssessment(state, teacher, 'slot-remove', {}, id, slot.id, now)
  assert.ok(!state.availability.some((s) => s.id === slot.id))
  state.modules.optical = false
  failsUnchanged(state, () => evaluate(state), /kapalı/)
  assert.equal(planTutoring(state, admin, input, now).sessions.length, 1)
  state.modules.tutoring = false
  failsUnchanged(state, () => planTutoring(state, admin, input, now), /kapalı/)
  assert.deepEqual(tutoringSessions(state, admin), [])
})
test('Yeni ders ve arşiv işlemleri planlanmış etütlerle çakışamaz; kayıtlar snapshot üzerinden korunur', () => {
  const state = seed()
  evaluate(state)
  runAssessment(state, admin, 'plan', input, id, '', now)
  const entry = state.tutorSessions[0]
  failsUnchanged(
    state,
    () =>
      runWorkflow(
        state,
        admin,
        'lesson',
        {
          classId: 'c1',
          teacherId: entry.teacherId,
          subjectId: 'math',
          date: entry.date,
          duration: 30,
          room: 'yeni derslik',
        },
        id,
        undefined,
        now,
      ),
    /etüdü/,
  )
  failsUnchanged(
    state,
    () => archiveRecord(state, 'teacher', entry.teacherId, 't17', now),
    /gelecek etüt/,
  )
  failsUnchanged(
    state,
    () =>
      saveTeacher(
        state,
        { ...state.teachers.find((t) => t.id === entry.teacherId), branchId: 'b2' },
        id,
        entry.teacherId,
        now,
      ),
    /ileri tarihli etüt/,
  )
  state.appointments = []
  state.schedule = [
    {
      id: 'incoming-overlap',
      classId: 'c1',
      teacherId: 't17',
      subjectId: 'math',
      date: entry.date,
      duration: 30,
      room: '102',
    },
  ]
  failsUnchanged(state, () => archiveRecord(state, 'teacher', 't17', entry.teacherId, now), /etüdü/)
  failsUnchanged(
    state,
    () =>
      runWorkflow(
        state,
        admin,
        'event',
        {
          title: 'Sınıf etkinliği',
          branchId: entry.branchId,
          classId: 'c1',
          date: entry.date,
          endDate: new Date(Date.parse(entry.date) + 3600000).toISOString(),
          location: 'Bahçe',
          description: 'Sınıf ortak etkinliği',
          requiresConsent: false,
          consentDeadline: '2026-10-06',
        },
        id,
        '',
        now,
      ),
    /etüdü/,
  )
  state.renewals.push({
    id: 'graduate-blocked',
    studentId: 's1',
    fromClassId: 'c1',
    status: 'Planlandı',
    mode: 'graduate',
  })
  failsUnchanged(
    state,
    () => runWorkflow(state, admin, 'renewal-activate', {}, id, 'graduate-blocked', now),
    /ileri tarihli etüt/,
  )
  failsUnchanged(
    state,
    () => archiveRecord(state, 'class', entry.roomClassId, 'c9', now),
    /gelecek etüt/,
  )
  const restored = restoreSnapshot(createSnapshotWriter(seed())(state))
  assert.deepEqual(restored.opticalEvaluations, state.opticalEvaluations)
  assert.deepEqual(restored.tutorSessions, state.tutorSessions)
})
