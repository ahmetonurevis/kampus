import test from 'node:test'
import assert from 'node:assert/strict'
import { narrow, resultOf, stringOf } from './support/result.ts'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import { runWorkflow, mayRun } from '../packages/school-core/src/lib/school-workflows.ts'
import { runAssessment } from '../packages/school-core/src/lib/assessment-automation.ts'
import { schoolModules } from '../packages/school-core/src/modules/school-workflows.ts'
import {
  workflowRows,
  workflowDetails,
  workflowForm,
  workflowCreateActions,
  workflowCsvReferences,
  workflowPageForKind,
  readFormValue,
  changeFormValue,
  normalizeWorkflowInput,
  csvTemplate,
  type WorkflowDetails,
  type FormValues,
  type WorkflowForm,
  type WorkflowRow,
} from '../packages/school-core/src/lib/workflow-presentation.ts'

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
const session = (role: Role, childId = 's1'): Session => ({ role, childId })
let sequence = 0
const id = (prefix: string) => `${prefix}-presentation-test-${++sequence}`
// İş akışı sonucu birleşim tipidir; testler kayıt alanlarını okuyabilsin diye ortak kayıt şekline daraltılır.
type RunResult = {
  id: string
  contractId: string
  teacherId: string
  originalTeacherId: string
  [field: string]: unknown
}
const run = (
  state: State,
  command: string,
  input: unknown = {},
  recordId?: string,
  role: Role = 'yonetici',
) => narrow<RunResult>(runWorkflow(state, session(role), command, input, id, recordId, now))
const find = (rows: WorkflowRow[], recordId: string) => rows.find((r) => r.id === recordId)
const titles = (details: WorkflowDetails) => details.sections.map((s) => s.title)
const commands = (details: WorkflowDetails) => details.actions.map((a) => a.command)
const section = (details: WorkflowDetails, title: string) =>
  details.sections.find((s) => s.title === title)?.lines || []
const workflowPaths = schoolModules
  .filter((m) => !['optical', 'tutoring'].includes(m.key))
  .map((m) => m.path)
const renewal = {
  studentId: 's1',
  targetClassId: 'c4',
  year: 2027,
  mode: 'renew',
  total: 28500,
  scholarship: 10,
  discount: 100,
  count: 4,
  startDate: '2027-01-31',
}

// Formun alan tanımı her seçenekte değer/etiket çifti taşımalı; bozuk tanım arayüzde boş alan üretir.
function assertForm(form: WorkflowForm) {
  assert.equal(typeof form.title, 'string')
  assert.ok(form.title.length)
  assert.equal(typeof form.hint, 'string')
  const fields = form.fields(form.initial)
  assert.ok(Array.isArray(fields))
  for (const f of fields) {
    assert.equal(typeof f.key, 'string')
    assert.equal(typeof f.label, 'string')
    assert.ok(
      [
        'text',
        'textarea',
        'number',
        'date',
        'datetime',
        'select',
        'multi',
        'checkbox',
        'tel',
      ].includes(f.type),
      `${form.title}: ${f.type}`,
    )
    if (f.type === 'select' || f.type === 'multi')
      for (const o of f.options!) {
        assert.equal(typeof o.label, 'string')
        assert.ok(['string', 'number'].includes(typeof o.value))
      }
  }
  return fields
}

test('Liste yalnızca modülün rollerinde ve modül açıkken döner; bilinmeyen sayfa boştur', () => {
  const state = seed()
  for (const definition of schoolModules)
    for (const role of roles) {
      const rows = workflowRows(state, session(role), definition.path)
      if (!definition.roles.includes(role)) assert.deepEqual(rows, [], `${role} ${definition.path}`)
      for (const r of rows) {
        assert.equal(r.id, r.source.id)
        assert.deepEqual(r.meta, [])
        assert.equal(workflowPageForKind(r.kind), definition.path)
        assert.ok(typeof r.title === 'string' && typeof r.body === 'string')
      }
    }
  assert.deepEqual(workflowRows(state, session('yonetici'), 'olmayan-sayfa'), [])
  for (const definition of schoolModules) state.modules[definition.key] = false
  for (const path of workflowPaths) {
    assert.deepEqual(workflowRows(state, session('yonetici'), path), [])
    assert.deepEqual(workflowCreateActions(state, session('yonetici'), path), [])
  }
  assert.deepEqual(workflowCreateActions(seed(), session('yonetici'), 'olmayan-sayfa'), [])
})

test('Oluşturma işlemleri rol yetkisine göre süzülür ve sabit etiket taşır', () => {
  const state = seed()
  const created = (role: Role, path: string) =>
    workflowCreateActions(state, session(role), path).map((a) => `${a.command}:${a.label}`)
  assert.deepEqual(created('yonetici', 'deneme-sinavlari'), [
    'exam:Deneme oluştur',
    'exam-result:Sonuç gir',
    'exam-import:CSV sonuç aktar',
  ])
  assert.deepEqual(created('veli', 'deneme-sinavlari'), [])
  assert.deepEqual(created('ogrenci', 'hedef-plani'), ['goal:Hedef belirle'])
  assert.deepEqual(created('veli', 'hedef-plani'), [])
  assert.deepEqual(created('onburo', 'okul-servisi'), [
    'route:Güzergâh ekle',
    'transport-assign:Öğrenci ata',
  ])
  assert.deepEqual(created('ogretmen', 'program-yonetimi'), [])
  assert.deepEqual(created('yonetici', 'program-yonetimi'), ['lesson:Ders planla'])
  assert.deepEqual(created('ogrenci', 'calisma-plani'), ['study-task:Çalışma görevi ekle'])
  assert.deepEqual(created('onburo', 'kayit-yenileme'), ['renewal:Kayıt yenile'])
  assert.deepEqual(created('ogretmen', 'okul-takvimi'), ['event:Etkinlik oluştur'])
  assert.deepEqual(created('onburo', 'yemek-menusu'), ['meal:Menü ekle'])
  assert.deepEqual(created('ogretmen', 'kulupler'), ['club:Kulüp oluştur'])
  assert.deepEqual(created('yonetici', 'rehberlik'), ['guidance:Takip dosyası aç'])
  for (const path of workflowPaths)
    for (const role of roles)
      for (const a of workflowCreateActions(state, session(role), path)) {
        assert.ok(mayRun(session(role), a.command))
        assert.equal(a.recordId, undefined)
      }
})

test('Her rolde listelenen kaydın ayrıntısı ve işlemlerinin formları geçerli alan tanımı üretir', () => {
  const state = seed()
  for (const role of roles)
    for (const path of workflowPaths) {
      const rows = workflowRows(state, session(role), path).slice(0, 4)
      for (const create of workflowCreateActions(state, session(role), path))
        assertForm(workflowForm(state, session(role), create.command))
      for (const r of rows) {
        const details = workflowDetails(state, session(role), r)
        for (const s of details.sections) assert.ok(s.lines.every(Boolean), s.title)
        for (const a of details.actions) {
          assert.ok(mayRun(session(role), a.command), `${role} ${a.command}`)
          const form = workflowForm(state, session(role), a.command, a.recordId, a.initial)
          assertForm(form)
          for (const [key, value] of Object.entries(a.initial || {}))
            assert.deepEqual(form.initial[key], value)
        }
      }
    }
})

test('Görünmeyen veya bilinmeyen kayıt ayrıntısı boş döner', () => {
  const state = seed()
  const empty = { sections: [], actions: [], documents: [] }
  assert.deepEqual(
    workflowDetails(state, session('veli'), { kind: 'guidance', id: 'guidance-s2' }),
    empty,
  )
  assert.deepEqual(workflowDetails(state, session('yonetici'), { kind: 'olmayan', id: 'x' }), empty)
  assert.deepEqual(
    workflowDetails(state, session('onburo'), { kind: 'exam', id: 'exam-7-1' }),
    empty,
  )
  assert.equal(workflowPageForKind('olmayan'), undefined)
  assert.deepEqual(
    [
      'goal',
      'guidance',
      'exam',
      'renewal',
      'lesson',
      'study-task',
      'event',
      'route',
      'meal',
      'club',
    ].map(workflowPageForKind),
    [
      'hedef-plani',
      'rehberlik',
      'deneme-sinavlari',
      'kayit-yenileme',
      'program-yonetimi',
      'calisma-plani',
      'okul-takvimi',
      'okul-servisi',
      'yemek-menusu',
      'kulupler',
    ],
  )
})

test('Hedef listesi son tarihe göre sıralanır; öğrenci adımı tamamlar, veli yalnız yorum yapar', () => {
  const state = seed()
  const admin = workflowRows(state, session('yonetici'), 'hedef-plani')
  assert.deepEqual(
    admin.map((r) => r.date),
    admin.map((r) => r.date).sort(),
  )
  for (const r of admin) {
    assert.equal(r.kind, 'goal')
    assert.equal(r.date, r.source.deadline)
    assert.match(r.body, /^Hedef: .* net · Güncel: .* · %\d+\nSon tarih: .* · Adım: \d+\/\d+$/)
  }
  const pending = admin.find((r) => r.status === 'Onay bekliyor')
  const pendingDetails = workflowDetails(state, session('yonetici'), pending!)
  assert.deepEqual(titles(pendingDetails), [
    'Hedef ve ilerleme',
    'Denemeler arası seyir',
    'Gelişim adımları',
    'Yorumlar',
  ])
  assert.ok(
    section(pendingDetails, 'Hedef ve ilerleme').includes(
      'Öğretmen veya yönetici onayı bekleniyor.',
    ),
  )
  assert.deepEqual(commands(pendingDetails), [
    'goal-review',
    'goal-step',
    'goal-suggest',
    'goal-close',
    'goal-comment',
  ])
  const own = workflowRows(state, session('ogrenci'), 'hedef-plani')
  assert.equal(own.length, 1)
  const studentDetails = workflowDetails(state, session('ogrenci'), own[0]!)
  const done = studentDetails.actions.filter((a) => a.command === 'goal-step-done')
  assert.equal(
    done.length,
    resultOf<{ steps: { done: boolean }[] }>(own[0]!.source).steps.filter((s) => !s.done).length,
  )
  for (const a of done) {
    assert.match(a.label, /^“.+” adımını tamamla$/)
    const form = workflowForm(state, session('ogrenci'), a.command, a.recordId, a.initial)
    assert.equal(form.initial.stepId, a.initial!.stepId)
    const options = form.fields(form.initial)[0]!.options
    assert.ok(options!.some((o) => o.value === a.initial!.stepId))
  }
  const parent = workflowRows(state, session('veli'), 'hedef-plani')
  assert.deepEqual(commands(workflowDetails(state, session('veli'), parent[0]!)), ['goal-comment'])
  run(state, 'goal-comment', { text: 'Takipteyiz.' }, parent[0]!.id, 'veli')
  const comments = section(workflowDetails(state, session('veli'), parent[0]!), 'Yorumlar')
  assert.ok(comments.at(-1)!.endsWith('Veli: Takipteyiz.'))
})

test('Hedef formu role göre kapsam ve ipucu verir', () => {
  const state = seed()
  const teacherSubject = state.teachers.find((t) => t.id === 't1')!.subjectId
  const teacherForm = workflowForm(state, session('ogretmen'), 'goal')
  assert.equal(teacherForm.initial.subjectId, teacherSubject)
  const teacherScope = teacherForm.fields(teacherForm.initial)[1]!.options
  assert.deepEqual(
    teacherScope!.map((o) => o.value),
    [teacherSubject],
  )
  const studentForm = workflowForm(state, session('ogrenci'), 'goal')
  assert.match(studentForm.hint, /onayladıktan sonra/)
  assert.equal(studentForm.initial.studentId, 's1')
  assert.equal(studentForm.initial.subjectId, '')
  assert.match(stringOf(studentForm.initial.deadline), /^\d{4}-\d{2}-\d{2}$/)
  const studentScope = studentForm.fields(studentForm.initial)[1]!.options
  assert.equal(studentScope![0]!.value, '')
  assert.ok(studentScope!.length > 1)
  assert.match(workflowForm(state, session('yonetici'), 'goal').hint, /onaylı olarak/)
  const review = workflowForm(state, session('yonetici'), 'goal-review')
  assert.deepEqual(review.initial, { status: 'Aktif', feedback: '' })
  assert.deepEqual(
    review.fields({}).map((f) => f.key),
    ['status', 'feedback'],
  )
  assert.match(workflowForm(state, session('ogrenci'), 'goal-suggest').hint, /dört haftalık/)
  assert.match(workflowForm(state, session('ogrenci'), 'goal-close').hint, /korunur/)
  assert.deepEqual(workflowForm(state, session('veli'), 'goal-comment').initial, { text: '' })
  assert.deepEqual(
    workflowForm(state, session('ogrenci'), 'goal-step-done').fields({})[0]!.options,
    [],
  )
})

test('Rehberlik iç notu yalnız rehberlik görevli öğretmende görünür; görüşme formu kaydın değerleriyle açılır', () => {
  const state = seed()
  const teacherRow = find(workflowRows(state, session('ogretmen'), 'rehberlik'), 'guidance-s1')
  assert.equal(resultOf(teacherRow!.source).internalNote, state.guidanceCases[0]!.internalNote)
  const teacherDetails = workflowDetails(state, session('ogretmen'), teacherRow!)
  assert.deepEqual(titles(teacherDetails), ['Paylaşılan destek planı', 'Kurum içi görüşme notları'])
  assert.deepEqual(commands(teacherDetails), ['guidance-note'])
  // Yönetici paylaşılan planı görür; iç not ve görüşme kaydı varsayılan olarak kapalıdır.
  const adminRow = find(workflowRows(state, session('yonetici'), 'rehberlik'), 'guidance-s1')
  assert.ok(!('internalNote' in adminRow!.source))
  assert.ok(!('notes' in adminRow!.source))
  assert.match(adminRow!.body, /\nTakip: /)
  const adminDetails = workflowDetails(state, session('yonetici'), adminRow!)
  assert.deepEqual(titles(adminDetails), ['Paylaşılan destek planı'])
  assert.deepEqual(commands(adminDetails), [])
  for (const role of ['veli', 'ogrenci'] as const) {
    const rows = workflowRows(state, session(role), 'rehberlik')
    assert.deepEqual(
      rows.map((r) => r.id),
      ['guidance-s1'],
    )
    assert.equal(resultOf(rows[0]!.source).internalNote, undefined)
    assert.equal(resultOf(rows[0]!.source).notes, undefined)
    const details = workflowDetails(state, session(role), rows[0]!)
    assert.deepEqual(titles(details), ['Paylaşılan destek planı'])
    assert.deepEqual(details.actions, [])
  }
  run(
    state,
    'guidance-note',
    {
      text: 'Veliyle görüşüldü.',
      sharedNote: 'Düzenli çalışıyor.',
      followUp: '2026-10-20',
      status: 'Takipte',
    },
    'guidance-s1',
    'ogretmen',
  )
  const notes = section(
    workflowDetails(state, session('ogretmen'), { kind: 'guidance', id: 'guidance-s1' }),
    'Kurum içi görüşme notları',
  )
  assert.ok(notes.at(-1)!.endsWith('Veliyle görüşüldü.'))
  const form = workflowForm(state, session('ogretmen'), 'guidance-note', 'guidance-s1')
  assert.deepEqual(form.initial, {
    text: '',
    sharedNote: 'Düzenli çalışıyor.',
    followUp: '2026-10-20',
    status: 'Takipte',
  })
  const open = workflowForm(state, session('ogretmen'), 'guidance')
  const teacherChoices = open.fields({})[1]!.options
  assert.deepEqual(
    teacherChoices!.map((o) => o.value),
    ['t1'],
  )
  assert.ok(open.fields({}).some((f) => f.key === 'internalNote'))
  const adminForm = workflowForm(state, session('yonetici'), 'guidance')
  assert.ok(adminForm.fields({})[1]!.options!.length > 1)
  assert.ok(!adminForm.fields({}).some((f) => f.key === 'internalNote'))
})

test('Deneme listesi yeni tarihten eskiye sıralanır; net hesabı, öneri ve gelişim ayrıntıları döner', () => {
  const state = seed()
  const rows = workflowRows(state, session('yonetici'), 'deneme-sinavlari')
  assert.deepEqual(
    rows.map((r) => r.date),
    rows
      .map((r) => r.date)
      .sort()
      .reverse(),
  )
  const upcoming = find(rows, 'exam-8-1')
  assert.equal(upcoming!.status, 'Sonuç bekleniyor')
  assert.match(upcoming!.body, /Henüz sonuç girilmedi\.$/)
  assert.match(upcoming!.subtitle, /^LGS · 8\. sınıf · /)
  const examDetails = workflowDetails(state, session('yonetici'), upcoming!)
  assert.match(section(examDetails, 'Net hesabı')[0]!, /^Net = doğru − yanlış \/ 3\./)
  assert.deepEqual(examDetails.actions, [
    {
      command: 'exam-result',
      label: 'Sonuç gir',
      recordId: 'exam-8-1',
      initial: { examId: 'exam-8-1' },
    },
  ])
  const done = find(rows, 'exam-7-1')
  assert.equal(done!.status, 'Sonuç girildi')
  assert.match(done!.body, /: -?[\d,]+ net/)
  const details = workflowDetails(state, session('yonetici'), done!)
  assert.ok(section(details, 'Ders sonuçları').length > 0)
  const plans = details.actions.filter((a) => a.command === 'study-task')
  assert.ok(plans.length > 0)
  for (const plan of plans) {
    assert.match(plan.label, / çalışma planı$/)
    assert.match(stringOf(plan.initial!.title), / konu tekrarı$/)
    assert.ok(stringOf(plan.initial!.topic).length)
  }
  const teacherSubject = state.teachers.find((t) => t.id === 't1')!.subjectId
  const teacherPlans = workflowDetails(state, session('ogretmen'), done!).actions.filter(
    (a) => a.command === 'study-task',
  )
  assert.ok(teacherPlans.every((a) => a.initial!.subjectId === teacherSubject))
  const student = workflowDetails(state, session('ogrenci'), done!)
  assert.ok(titles(student).includes('Denemeler arası gelişim'))
  assert.ok(section(student, 'Denemeler arası gelişim').length > 0)
  assert.equal(titles(details).includes('Denemeler arası gelişim'), false)
  assert.deepEqual(
    workflowRows(state, session('ogrenci'), 'deneme-sinavlari').map((r) => r.id),
    ['exam-7-2', 'exam-7-1'],
  )
  state.modules.study = false
  assert.equal(
    commands(workflowDetails(state, session('yonetici'), done!)).includes('study-task'),
    false,
  )
  const created = run(state, 'exam', {
    title: 'Cezasız deneme',
    type: 'Okul denemesi',
    grade: 7,
    wrongPenalty: 0,
    date: '2026-10-09',
    subjectIds: ['math'],
  })
  assert.equal(
    section(
      workflowDetails(state, session('yonetici'), { kind: 'exam', id: created.id }),
      'Net hesabı',
    )[0],
    'Yanlışlar doğru sayısını azaltmaz.',
  )
})

test('Optik değerlendirme deneme ayrıntısında kazanım ve soru satırları üretir; anahtar revizyonu uyarı verir', () => {
  const state = seed(),
    admin = session('yonetici')
  runAssessment(
    state,
    admin,
    'evaluate',
    { profileId: 'optical-exam-7-1', text: 'student;booklet;answers\n2026001;A;BBBDABCDABCD' },
    id,
    '',
    now,
  )
  const entry = { kind: 'exam', id: 'exam-7-1' }
  const details = workflowDetails(state, admin, entry)
  const topics = section(details, 'Optik kazanım analizi')
  assert.ok(topics.length > 0)
  assert.ok(topics.every((line) => / · Kitapçık A$/.test(line)))
  const questions = section(details, 'Optik soru ayrıntıları')
  assert.ok(questions.some((line) => /\. soru: Yanlış · Cevap B \/ Anahtar /.test(line)))
  assert.ok(questions.some((line) => /\. soru: Doğru · /.test(line)))
  assert.equal(titles(details).includes('Değerlendirme durumu'), false)
  state.opticalProfiles[0]!.revision += 1
  assert.deepEqual(section(workflowDetails(state, admin, entry), 'Değerlendirme durumu'), [
    'Cevap anahtarı değişmiş. Kazanım analizi için optik dosyayı yeniden değerlendirin.',
  ])
  state.modules.optical = false
  assert.equal(
    titles(workflowDetails(state, admin, entry)).includes('Optik kazanım analizi'),
    false,
  )
})

test('Deneme ve sonuç formları düzeye ve branşa göre seçenek üretir', () => {
  const state = seed()
  const exam = workflowForm(state, session('yonetici'), 'exam')
  assert.deepEqual(
    { ...exam.initial, date: undefined },
    {
      title: '',
      type: 'Okul denemesi',
      grade: 7,
      wrongPenalty: 4,
      date: undefined,
      subjectIds: ['math'],
    },
  )
  const subjects = (grade: number) =>
    exam.fields({ ...exam.initial, grade }).find((f) => f.key === 'subjectIds')!.options
  assert.ok(subjects(7)!.length > 0)
  assert.notDeepEqual(subjects(5), subjects(12))
  const result = workflowForm(state, session('yonetici'), 'exam-result', 'exam-7-1')
  assert.equal(result.initial.examId, 'exam-7-1')
  const fields = result.fields(result.initial)
  assert.deepEqual(
    fields.map((f) => f.key),
    ['examId', 'studentId', 'subjectId', 'correct', 'wrong', 'blank', 'weakTopics'],
  )
  assert.deepEqual(
    fields[2]!.options!.map((o) => o.value),
    ['math', 'turkish', 'science'].filter((s) => state.subjects.some((x) => x.id === s)),
  )
  const grade7 = new Set(state.classes.filter((c) => c.grade === 7).map((c) => c.id))
  assert.ok(
    fields[1]!.options!.every((o) =>
      grade7.has(state.students.find((s) => s.id === o.value)!.classId),
    ),
  )
  const teacher = workflowForm(state, session('ogretmen'), 'exam-result', 'exam-7-1')
  const teacherSubject = state.teachers.find((t) => t.id === 't1')!.subjectId
  assert.deepEqual(
    teacher.fields(teacher.initial)[2]!.options!.map((o) => o.value),
    [teacherSubject],
  )
  assert.equal(workflowForm(state, session('yonetici'), 'exam-result').initial.examId, 'exam-7-1')
  const empty = workflowForm(state, session('yonetici'), 'exam-result', '', { examId: 'yok' })
  assert.deepEqual(empty.fields(empty.initial)[1]!.options, [])
  const csv = workflowForm(state, session('yonetici'), 'exam-import')
  assert.equal(csv.initial.csv, csvTemplate)
  assert.equal(csv.fields({})[0]!.maxLength, 1024 * 1024)
  assert.equal(
    csvTemplate.split('\n')[0],
    'examId;studentId;subjectId;correct;wrong;blank;weakTopics',
  )
})

test('Kayıt yenileme satırı, sözleşme belgesi, taksitler ve dönem geçişi işlemi gösterilir', () => {
  const state = seed()
  const entry = run(state, 'renewal', renewal)
  const rows = workflowRows(state, session('yonetici'), 'kayit-yenileme')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.subtitle, `2027–2028 · ${state.classes.find((c) => c.id === 'c4')!.name}`)
  assert.match(rows[0]!.body, / → .*\n.*₺/)
  assert.equal(rows[0]!.status, 'Planlandı')
  const details = workflowDetails(state, session('onburo'), rows[0]!)
  assert.deepEqual(details.documents, [
    { type: 'contract', id: entry.contractId, studentId: 's1', title: 'Yeni dönem sözleşmesi' },
  ])
  assert.match(section(details, 'Dönem geçişi')[2]!, /^Brüt: .* · Burs: .* · İndirim: .* · Net: /)
  assert.equal(section(details, 'Yeni dönem taksitleri').length, 4)
  assert.ok(section(details, 'Yeni dönem taksitleri').every((l) => /Bekliyor$/.test(l)))
  assert.deepEqual(commands(details), ['renewal-activate'])
  assert.deepEqual(
    workflowRows(state, session('veli'), 'kayit-yenileme').map((r) => r.id),
    [entry.id],
  )
  assert.deepEqual(commands(workflowDetails(state, session('veli'), rows[0]!)), [])
  assert.deepEqual(workflowRows(state, session('veli', 's2'), 'kayit-yenileme'), [])
  run(state, 'renewal-activate', {}, entry.id)
  const activated = workflowDetails(state, session('yonetici'), rows[0]!)
  assert.equal(section(activated, 'Dönem geçişi').at(-1), 'Dönem geçişi uygulanmış.')
  assert.deepEqual(commands(activated), [])
  const graduate = state.students.find(
    (s) => state.classes.find((c) => c.id === s.classId)!.grade === 12,
  )
  const grad = run(state, 'renewal', {
    ...renewal,
    studentId: graduate!.id,
    mode: 'graduate',
    targetClassId: '',
  })
  const gradRow = find(workflowRows(state, session('yonetici'), 'kayit-yenileme'), grad.id)
  assert.match(gradRow!.subtitle, / · Mezuniyet$/)
  assert.match(gradRow!.body, / → Mezun\n/)
  const gradLines = section(workflowDetails(state, session('yonetici'), gradRow!), 'Dönem geçişi')
  assert.match(gradLines[1]!, / → Mezuniyet$/)
  assert.equal(gradLines.length, 3)
})

test('Kayıt yenileme formu bir üst sınıfı önerir; mezuniyette ücret alanları gizlenir', () => {
  const state = seed()
  const form = workflowForm(state, session('yonetici'), 'renewal')
  assert.equal(form.initial.year, state.academicYear + 1)
  assert.equal(form.initial.studentId, state.students.find((s) => s.isActive)!.id)
  const fields = form.fields(form.initial)
  assert.deepEqual(
    fields.map((f) => f.key),
    [
      'studentId',
      'mode',
      'year',
      'targetClassId',
      'total',
      'scholarship',
      'discount',
      'count',
      'startDate',
    ],
  )
  const grade = state.classes.find(
    (c) => c.id === state.students.find((s) => s.id === form.initial.studentId)!.classId,
  )!.grade
  assert.ok(
    fields[3]!.options!.every(
      (o) => state.classes.find((c) => c.id === o.value)!.grade === grade + 1,
    ),
  )
  assert.deepEqual(
    form.fields({ ...form.initial, mode: 'graduate' }).map((f) => f.key),
    ['studentId', 'mode', 'year'],
  )
  assert.match(workflowForm(state, session('yonetici'), 'renewal-activate').hint, /servis ataması/)
  assert.deepEqual(
    workflowForm(state, session('yonetici'), 'renewal', undefined, { studentId: 's2' }).initial
      .studentId,
    's2',
  )
})

test('Program satırları geçici görev ve iptal durumunu gösterir; iptal dersinde işlem yoktur', () => {
  const state = seed()
  const lesson = state.schedule.find((l) => l.classId === 'c1' && l.subjectId === 'math')
  const replacement = { ...state.teachers[0]!, id: 'teacher-backup', name: 'Yedek Öğretmen' }
  state.teachers.push(replacement)
  run(state, 'substitute', { teacherId: replacement.id, reason: 'İzinli.' }, lesson!.id)
  const teacherRows = workflowRows(state, session('ogretmen'), 'program-yonetimi')
  const moved = find(teacherRows, lesson!.id)
  assert.equal(moved!.status, 'Geçici görev')
  assert.match(moved!.body, /^Yedek Öğretmen · Derslik /)
  const lines = section(workflowDetails(state, session('yonetici'), moved!), 'Ders bilgileri')
  assert.ok(lines.at(-1)!.endsWith('→ Yedek Öğretmen · İzinli.'))
  assert.deepEqual(commands(workflowDetails(state, session('yonetici'), moved!)), [
    'lesson',
    'substitute',
    'lesson-cancel',
  ])
  assert.deepEqual(commands(workflowDetails(state, session('ogretmen'), moved!)), [])
  run(state, 'lesson-cancel', {}, lesson!.id)
  const cancelled = find(workflowRows(state, session('yonetici'), 'program-yonetimi'), lesson!.id)
  assert.equal(cancelled!.status, 'İptal')
  assert.deepEqual(workflowDetails(state, session('yonetici'), cancelled!).actions, [])
  const admin = workflowRows(state, session('yonetici'), 'program-yonetimi')
  assert.deepEqual(
    admin.map((r) => r.date),
    admin.map((r) => r.date).sort(),
  )
  assert.ok(teacherRows.length < admin.length)
  assert.ok(
    teacherRows.every(
      (r) => resultOf(r.source).teacherId === 't1' || resultOf(r.source).originalTeacherId === 't1',
    ),
  )
})

test('Ders formları kayıt değerlerini ve sınıfın kampüsündeki branş öğretmenlerini kullanır', () => {
  const state = seed()
  const lesson = state.schedule.find((l) => l.classId === 'c1' && l.subjectId === 'math')
  const edit = workflowForm(state, session('yonetici'), 'lesson', lesson!.id)
  assert.equal(edit.title, 'Dersi düzenle')
  assert.deepEqual(edit.initial, {
    classId: lesson!.classId,
    teacherId: lesson!.teacherId,
    subjectId: lesson!.subjectId,
    date: lesson!.date,
    duration: lesson!.duration,
    room: lesson!.room,
  })
  const branchId = state.classes.find((c) => c.id === lesson!.classId)!.branchId
  const teacherOptions = edit.fields(edit.initial).find((f) => f.key === 'teacherId')!.options
  assert.ok(
    teacherOptions!.every((o) => {
      const t = state.teachers.find((x) => x.id === o.value)
      return t!.subjectId === lesson!.subjectId && t!.branchId === branchId && t!.isActive
    }),
  )
  const create = workflowForm(state, session('yonetici'), 'lesson')
  assert.equal(create.title, 'Ders planla')
  assert.match(stringOf(create.initial.date), /^\d{4}-\d{2}-\d{2}T09:00:00\.000Z$/)
  assert.equal(create.initial.classId, 'c1')
  assert.equal(create.initial.duration, 40)
  state.teachers.push({ ...state.teachers[0]!, id: 'teacher-backup', name: 'Yedek' })
  const substitute = workflowForm(state, session('yonetici'), 'substitute', lesson!.id)
  assert.deepEqual(
    substitute.fields({})[0]!.options!.map((o) => o.value),
    ['teacher-backup'],
  )
  assert.match(workflowForm(state, session('yonetici'), 'lesson-cancel').hint, /iptal kaydı/)
})

test('Çalışma planı onay, teslim ve değerlendirme aşamalarında doğru işlemi ve formu sunar', () => {
  const state = seed()
  const entry = run(
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
  const ref = { kind: 'study-task', id: entry.id }
  const rows = workflowRows(state, session('ogrenci'), 'calisma-plani')
  assert.deepEqual(
    rows.map((r) => r.date),
    rows.map((r) => r.date).sort(),
  )
  assert.equal(find(rows, entry.id)!.status, 'Onay bekliyor')
  assert.match(find(rows, entry.id)!.body, /^Denklemler · 30 dk\nBeş soru çöz\.\nSon tarih: /)
  const pending = workflowDetails(state, session('ogretmen'), ref)
  assert.deepEqual(
    pending.actions.map((a) => `${a.command}:${a.label}`),
    ['study-review:Planı onayla'],
  )
  const approve = workflowForm(state, session('ogretmen'), 'study-review', entry.id)
  assert.equal(approve.title, 'Planı onayla')
  assert.equal(approve.initial.status, 'Onaylandı')
  assert.deepEqual(
    approve.fields({})[0]!.options!.map((o) => o.value),
    ['Onaylandı'],
  )
  assert.deepEqual(commands(workflowDetails(state, session('ogrenci'), ref)), [])
  run(state, 'study-review', { status: 'Onaylandı', feedback: 'Uygun.' }, entry.id, 'ogretmen')
  assert.deepEqual(commands(workflowDetails(state, session('ogrenci'), ref)), ['study-complete'])
  assert.deepEqual(workflowForm(state, session('ogrenci'), 'study-complete', entry.id).initial, {
    completionNote: '',
  })
  run(state, 'study-complete', { completionNote: 'Çözdüm.' }, entry.id, 'ogrenci')
  const review = workflowDetails(state, session('yonetici'), ref)
  assert.deepEqual(
    review.actions.map((a) => a.label),
    ['Çalışmayı değerlendir'],
  )
  assert.ok(section(review, 'Çalışma ve geri bildirim').includes('Öğrenci: Çözdüm.'))
  assert.ok(section(review, 'Çalışma ve geri bildirim').includes('Öğretmen: Uygun.'))
  const grade = workflowForm(state, session('ogretmen'), 'study-review', entry.id)
  assert.equal(grade.title, 'Çalışmayı değerlendir')
  assert.equal(grade.initial.status, 'Tamamlandı')
  assert.deepEqual(
    grade.fields({})[0]!.options!.map((o) => o.value),
    ['Tamamlandı', 'Tekrar çalışılacak'],
  )
  assert.match(workflowForm(state, session('ogrenci'), 'study-task').hint, /onayladıktan sonra/)
  const teacherTask = workflowForm(state, session('ogretmen'), 'study-task')
  assert.match(teacherTask.hint, /veli ekranına/)
  assert.deepEqual(
    teacherTask.fields(teacherTask.initial)[1]!.options!.map((o) => o.value),
    [state.teachers.find((t) => t.id === 't1')!.subjectId],
  )
})

test('Takvim veli onayını seçili çocuk için gösterir; iptal edilen etkinlikte işlem kalmaz', () => {
  const state = seed()
  const parentRows = workflowRows(state, session('veli'), 'okul-takvimi')
  const event = find(parentRows, 'event-science')
  assert.equal(event!.status, 'Onay bekliyor')
  assert.match(event!.body, /\nVeli onayı · Son gün: /)
  const parentDetails = workflowDetails(state, session('veli'), event!)
  assert.deepEqual(commands(parentDetails), ['consent'])
  assert.deepEqual(workflowForm(state, session('veli'), 'consent', 'event-science').initial, {
    decision: 'Onaylandı',
    note: '',
  })
  run(state, 'consent', { decision: 'Reddedildi', note: 'Katılamayacak.' }, 'event-science', 'veli')
  assert.equal(
    find(workflowRows(state, session('veli'), 'okul-takvimi'), 'event-science')!.status,
    'Reddedildi',
  )
  assert.deepEqual(workflowForm(state, session('veli'), 'consent', 'event-science').initial, {
    decision: 'Reddedildi',
    note: 'Katılamayacak.',
  })
  const consentLines = section(workflowDetails(state, session('yonetici'), event!), 'Veli onayları')
  assert.ok(consentLines.some((l) => l.endsWith(': Reddedildi · Katılamayacak.')))
  const adminRow = find(workflowRows(state, session('yonetici'), 'okul-takvimi'), 'event-science')
  assert.notEqual(adminRow!.status, 'Reddedildi')
  const teacherRows = workflowRows(state, session('ogretmen'), 'okul-takvimi')
  for (const r of teacherRows) {
    const actions = commands(workflowDetails(state, session('ogretmen'), r))
    assert.equal(actions.includes('event-cancel'), resultOf(r.source).teacherId === 't1')
  }
  run(state, 'event-cancel', {}, 'event-science')
  const cancelled = find(workflowRows(state, session('veli'), 'okul-takvimi'), 'event-science')
  assert.equal(cancelled!.status, 'İptal')
  assert.deepEqual(workflowDetails(state, session('yonetici'), cancelled!).actions, [])
  const sorted = workflowRows(state, session('yonetici'), 'okul-takvimi').map((r) => r.date)
  assert.deepEqual(sorted, [...sorted].sort())
})

test('Etkinlik formu kampüse göre sınıf seçer; onay gerekmiyorsa son gün alanı çıkar', () => {
  const state = seed()
  const admin = workflowForm(state, session('yonetici'), 'event')
  assert.match(stringOf(admin.initial.date), /T09:00:00\.000Z$/)
  assert.match(stringOf(admin.initial.endDate), /T11:00:00\.000Z$/)
  const fields = admin.fields(admin.initial)
  const classes = fields.find((f) => f.key === 'classId')!.options
  assert.deepEqual(classes![0], { value: '', label: 'Kampüsün tüm sınıfları' })
  assert.ok(
    classes!.slice(1).every((o) => state.classes.find((c) => c.id === o.value)!.branchId === 'b1'),
  )
  assert.equal(fields.at(-1)!.key, 'consentDeadline')
  assert.equal(
    admin
      .fields({ ...admin.initial, requiresConsent: false })
      .some((f) => f.key === 'consentDeadline'),
    false,
  )
  const teacher = workflowForm(state, session('ogretmen'), 'event')
  const teacherClasses = teacher.fields(teacher.initial).find((f) => f.key === 'classId')!.options
  const own = new Set(state.assignments.filter((a) => a.teacherId === 't1').map((a) => a.classId))
  assert.ok(teacherClasses!.every((o) => own.has(o.value)))
  assert.match(workflowForm(state, session('yonetici'), 'event-cancel').hint, /korunur/)
})

test('Servis listesi veliye yalnız çocuğunun atamasını gösterir; yönetici atama ve arşiv işlemlerini görür', () => {
  const state = seed()
  const admin = workflowRows(state, session('yonetici'), 'okul-servisi')
  assert.ok(admin.length >= 2)
  for (const r of admin) assert.match(r.body, /\nDuraklar: .+ → /)
  const parent = workflowRows(state, session('veli'), 'okul-servisi')
  assert.equal(parent.length, 1)
  const parentDetails = workflowDetails(state, session('veli'), parent[0]!)
  assert.deepEqual(parentDetails.actions, [])
  const visible = section(parentDetails, 'Öğrenci atamaları')
  const own = state.transportAssignments.filter(
    (a) => a.routeId === parent[0]!.id && a.studentId === 's1',
  )
  assert.equal(visible.length, own.length)
  const adminDetails = workflowDetails(state, session('yonetici'), find(admin, parent[0]!.id)!)
  const assignments = state.transportAssignments.filter((a) => a.routeId === parent[0]!.id)
  assert.deepEqual(commands(adminDetails), [
    'route',
    'transport-assign',
    'route-archive',
    ...assignments.map(() => 'transport-remove'),
  ])
  assert.deepEqual(adminDetails.actions.find((a) => a.command === 'transport-assign')!.initial, {
    routeId: parent[0]!.id,
  })
  assert.deepEqual(
    adminDetails.actions.filter((a) => a.command === 'transport-remove').map((a) => a.recordId),
    assignments.map((a) => a.id),
  )
  const route = state.transportRoutes.find((r) => r.id === parent[0]!.id)
  const edit = workflowForm(state, session('yonetici'), 'route', route!.id)
  assert.equal(edit.title, 'Güzergâhı düzenle')
  assert.equal(edit.initial.stops, route!.stops.join(', '))
  const create = workflowForm(state, session('yonetici'), 'route')
  assert.equal(create.title, 'Güzergâh ekle')
  assert.deepEqual(create.initial, {
    title: '',
    branchId: 'b1',
    plate: '',
    driver: '',
    phone: '',
    capacity: 20,
    stops: '',
  })
  const assign = workflowForm(state, session('yonetici'), 'transport-assign')
  assert.equal(assign.initial.routeId, state.transportRoutes[0]!.id)
  assert.deepEqual(
    assign.fields(assign.initial)[2]!.options!.map((o) => o.value),
    state.transportRoutes[0]!.stops,
  )
  assert.deepEqual(assign.fields({ ...assign.initial, routeId: 'yok' })[2]!.options, [])
  assert.match(workflowForm(state, session('yonetici'), 'route-archive').hint, /arşivlenemez/)
  assert.match(workflowForm(state, session('yonetici'), 'transport-remove').hint, /kaldırılır/)
})

test('Yemek menüsü kampüs kapsamında listelenir ve düzenleme formu kaydı doldurur', () => {
  const state = seed()
  const rows = workflowRows(state, session('ogrenci'), 'yemek-menusu')
  assert.ok(rows.length > 0)
  const branch = state.classes.find(
    (c) => c.id === state.students.find((s) => s.id === 's1')!.classId,
  )!.branchId
  assert.ok(rows.every((r) => resultOf(r.source).branchId === branch))
  assert.ok(rows.every((r) => ['Bugün', 'Menü'].includes(r.status)))
  assert.deepEqual(
    rows.map((r) => r.date),
    rows.map((r) => r.date).sort(),
  )
  assert.ok(workflowRows(state, session('yonetici'), 'yemek-menusu').length >= rows.length)
  const details = workflowDetails(state, session('onburo'), rows[0]!)
  assert.deepEqual(
    section(details, 'Menü')[1],
    `Alerjenler: ${resultOf(rows[0]!.source).allergens}`,
  )
  assert.deepEqual(commands(details), ['meal'])
  assert.deepEqual(commands(workflowDetails(state, session('ogrenci'), rows[0]!)), [])
  const edit = workflowForm(state, session('yonetici'), 'meal', rows[0]!.id)
  assert.equal(edit.title, 'Menüyü düzenle')
  assert.equal(edit.initial.date, stringOf(resultOf(rows[0]!.source).date).slice(0, 10))
  assert.equal(edit.initial.allergens, resultOf(rows[0]!.source).allergens)
  const create = workflowForm(state, session('yonetici'), 'meal')
  assert.equal(create.title, 'Menü ekle')
  assert.match(stringOf(create.initial.date), /^\d{4}-\d{2}-\d{2}$/)
})

test('Kulüpler öğrencinin üyeliğini gösterir; arşivlenen kulüpte yalnız geçmiş kalır', () => {
  const state = seed()
  const student = workflowRows(state, session('ogrenci'), 'kulupler')
  assert.equal(find(student, 'club-science')!.status, 'Kayıtlı')
  assert.ok(student.some((r) => r.status === 'Aktif'))
  assert.match(find(student, 'club-science')!.body, /\n\d+ \/ \d+ üye$/)
  const adminDetails = workflowDetails(state, session('yonetici'), find(student, 'club-science')!)
  assert.deepEqual(titles(adminDetails), [
    'Kulüp',
    'Üyeler',
    'Projeler ve başarılar',
    'Kulüp yoklaması',
  ])
  const members = state.clubMemberships.filter(
    (m) => m.clubId === 'club-science' && m.status === 'Aktif',
  )
  assert.equal(section(adminDetails, 'Üyeler').length, members.length)
  assert.deepEqual(
    adminDetails.actions.filter((a) => a.command === 'club-leave').map((a) => a.recordId),
    members.map((m) => m.id),
  )
  assert.deepEqual(adminDetails.actions.find((a) => a.command === 'achievement')!.initial, {
    clubId: 'club-science',
  })
  const studentDetails = workflowDetails(state, session('ogrenci'), find(student, 'club-science')!)
  assert.equal(section(studentDetails, 'Üyeler').length, 1)
  assert.deepEqual(commands(studentDetails), ['club-enroll', 'club-leave'])
  const teacher = workflowRows(state, session('ogretmen'), 'kulupler')
  assert.ok(teacher.every((r) => resultOf(r.source).teacherId === 't1'))
  run(
    state,
    'club-attendance',
    { date: '2026-10-06', marks: Object.fromEntries(members.map((m) => [m.studentId, 'Geldi'])) },
    'club-science',
    'ogretmen',
  )
  run(
    state,
    'achievement',
    {
      studentId: 's1',
      clubId: 'club-science',
      title: 'Robot',
      description: 'Takım çalışması.',
      date: '2026-10-06',
    },
    undefined,
    'ogretmen',
  )
  const withHistory = workflowDetails(state, session('veli'), { kind: 'club', id: 'club-science' })
  assert.ok(section(withHistory, 'Kulüp yoklaması').some((l) => l.endsWith(' · Geldi')))
  assert.ok(
    section(withHistory, 'Projeler ve başarılar').some((l) =>
      /· Robot · .*\nTakım çalışması\.$/.test(l),
    ),
  )
  run(state, 'club-archive', {}, 'club-science', 'ogretmen')
  const archived = find(workflowRows(state, session('yonetici'), 'kulupler'), 'club-science')
  assert.equal(archived!.status, 'Arşiv')
  const archivedDetails = workflowDetails(state, session('yonetici'), archived!)
  assert.deepEqual(archivedDetails.actions, [])
  assert.ok(section(archivedDetails, 'Kulüp yoklaması').length > 0)
})

test('Kulüp formları kampüs, üyelik ve yoklama listesini kayıttan üretir', () => {
  const state = seed()
  const create = workflowForm(state, session('ogretmen'), 'club')
  assert.deepEqual(
    create
      .fields(create.initial)
      .find((f) => f.key === 'teacherId')!
      .options!.map((o) => o.value),
    ['t1'],
  )
  const adminCreate = workflowForm(state, session('yonetici'), 'club')
  assert.ok(
    adminCreate
      .fields(adminCreate.initial)
      .find((f) => f.key === 'teacherId')!
      .options!.every((o) => state.teachers.find((t) => t.id === o.value)!.branchId === 'b1'),
  )
  const enroll = workflowForm(state, session('yonetici'), 'club-enroll', 'club-science')
  const club = state.clubs.find((c) => c.id === 'club-science')
  assert.ok(
    enroll
      .fields({})[0]!
      .options!.every(
        (o) =>
          state.classes.find((c) => c.id === state.students.find((s) => s.id === o.value)!.classId)!
            .branchId === club!.branchId,
      ),
  )
  const members = state.clubMemberships.filter(
    (m) => m.clubId === 'club-science' && m.status === 'Aktif',
  )
  const attendance = workflowForm(state, session('ogretmen'), 'club-attendance', 'club-science')
  assert.deepEqual(
    attendance.initial.marks,
    Object.fromEntries(members.map((m) => [m.studentId, 'Geldi'])),
  )
  const keys = attendance.fields({}).map((f) => f.key)
  assert.deepEqual(keys, ['date', ...members.map((m) => `marks.${m.studentId}`)])
  const achievement = workflowForm(state, session('yonetici'), 'achievement', undefined, {
    clubId: 'club-science',
  })
  assert.equal(achievement.initial.clubId, 'club-science')
  const achievementFields = achievement.fields(achievement.initial)
  assert.deepEqual(
    achievementFields[1]!.options!.map((o) => o.value).sort(),
    members.map((m) => m.studentId).sort(),
  )
  assert.ok(
    achievementFields[0]!.options!.every(
      (o) => state.clubs.find((c) => c.id === o.value)!.status === 'Aktif',
    ),
  )
  assert.match(workflowForm(state, session('ogrenci'), 'club-leave').hint, /pasife/)
  assert.match(workflowForm(state, session('ogretmen'), 'club-archive').hint, /sonlandırılır/)
})

test('Bilinmeyen komut varsayılan onay formunu döner; geçersiz kayıt kimliği form oluşturmayı bozmaz', () => {
  const state = seed()
  const form = workflowForm(state, session('yonetici'), 'olmayan-komut', undefined, { x: 1 })
  assert.equal(form.title, 'İşlemi onayla')
  assert.equal(form.hint, 'Bu işlem yerel okul kaydını günceller.')
  assert.deepEqual(form.initial, { x: 1 })
  assert.deepEqual(form.fields({}), [])
  const missing = workflowForm(state, session('yonetici'), 'meal', 'yok')
  assert.equal(missing.title, 'Menü ekle')
})

test('CSV başvuru listesi rol kapsamındaki öğrenci ve dersleri içerir', () => {
  const state = seed()
  const admin = workflowCsvReferences(state, session('yonetici'))
  assert.equal(admin.filter((l) => l.startsWith('examId: ')).length, state.mockExams.length)
  assert.equal(admin.filter((l) => l.startsWith('subjectId: ')).length, state.subjects.length)
  assert.equal(
    admin.filter((l) => l.startsWith('studentId: ')).length,
    state.students.filter((s) => s.isActive).length,
  )
  assert.ok(admin.includes(`examId: exam-7-1 · ${state.mockExams[0]!.title}`))
  const teacher = workflowCsvReferences(state, session('ogretmen'))
  const subjectId = state.teachers.find((t) => t.id === 't1')!.subjectId
  assert.deepEqual(
    teacher.filter((l) => l.startsWith('subjectId: ')),
    [`subjectId: ${subjectId} · ${state.subjects.find((s) => s.id === subjectId)!.name}`],
  )
  assert.ok(teacher.filter((l) => l.startsWith('studentId: ')).length < state.students.length)
})

test('Form değerleri yoklama alanlarını ayrı okur; bağımlı alan değişince alt seçim sıfırlanır', () => {
  const values: FormValues = {
    grade: 7,
    subjectIds: ['math'],
    studentId: 's1',
    targetClassId: 'c4',
    routeId: 'r1',
    stop: 'A',
    branchId: 'b1',
    classId: 'c1',
    marks: { s1: 'Geldi' },
  }
  assert.equal(readFormValue(values, 'marks.s1'), 'Geldi')
  assert.equal(readFormValue(values, 'marks.s9'), undefined)
  assert.equal(readFormValue({}, 'marks.s1'), undefined)
  assert.equal(readFormValue(values, 'grade'), 7)
  const marked = changeFormValue(values, 'marks.s2', 'İzinli')
  assert.deepEqual(marked.marks, { s1: 'Geldi', s2: 'İzinli' })
  assert.deepEqual(values.marks, { s1: 'Geldi' })
  assert.deepEqual(changeFormValue(values, 'grade', 8).subjectIds, [])
  assert.equal(changeFormValue(values, 'studentId', 's2').targetClassId, '')
  assert.equal(changeFormValue(values, 'routeId', 'r2').stop, '')
  assert.equal(changeFormValue(values, 'branchId', 'b2').classId, '')
  const plain = changeFormValue(values, 'title', 'Yeni')
  assert.equal(plain.title, 'Yeni')
  assert.equal(plain.classId, 'c1')
  assert.equal(plain.stop, 'A')
  assert.equal(values.title, undefined)
})

test('Tarih-saat alanı İstanbul yerel değerinden ISO UTC değerine çevrilir; diğer alanlar korunur', () => {
  const definition = {
    fields: () => [
      { key: 'date', type: 'datetime' },
      { key: 'endDate', type: 'datetime' },
      { key: 'bad', type: 'datetime' },
      { key: 'title', type: 'text' },
    ],
  }
  const values = {
    date: '2026-10-12T09:00',
    endDate: '2026-10-12T08:00:00.000Z',
    bad: 'geçersiz',
    title: '2026-10-12T09:00',
  }
  assert.deepEqual(normalizeWorkflowInput(definition, values), {
    date: '2026-10-12T06:00:00.000Z',
    endDate: '2026-10-12T08:00:00.000Z',
    bad: 'geçersiz',
    title: '2026-10-12T09:00',
  })
  assert.equal(values.date, '2026-10-12T09:00')
  const state = seed()
  const lesson = workflowForm(state, session('yonetici'), 'lesson')
  const normalized = normalizeWorkflowInput(lesson, { ...lesson.initial, date: '2026-11-02T10:30' })
  assert.equal(normalized.date, '2026-11-02T07:30:00.000Z')
})

test('Oluşturma eylemi tablosunda karşılığı olmayan modüller boş liste döner', () => {
  const state = seed()
  for (const path of ['optik-degerlendirme', 'otomatik-etut'])
    for (const role of ['yonetici', 'ogretmen', 'ogrenci', 'veli'] as const)
      assert.deepEqual(workflowCreateActions(state, session(role), path), [], `${role} ${path}`)
})
