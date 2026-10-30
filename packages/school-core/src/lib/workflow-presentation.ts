import type { State } from '../data/seed.ts'
import type { Role } from '../modules/navigation.ts'
import { workflowPage } from '../modules/school-workflows.ts'
import { currentEvaluations } from './assessment-automation.ts'
import type { Session } from './domain.ts'
import {
  workflowScope,
  mayRun,
  examNet,
  examProgress,
  eventStudents,
  goalProgress,
} from './school-workflows.ts'
import { dateLabel, money, timeLabel, dayKey } from './format.ts'
import { DEMO_TEACHER_ID, sessionTeacherId, type Redacted } from './scope.ts'
import { subjectsForGrade } from '../data/curriculum.ts'

type Goal = State['studentGoals'][number]
type GuidanceCase = State['guidanceCases'][number]
// İç notu görmeyen aktöre dönen rehberlik kaydında iç not alanları yoktur (`lib/scope.ts`).
type RedactedGuidanceCase = Redacted<GuidanceCase>
type NamedCollection = 'subjects' | 'students' | 'classes' | 'teachers' | 'branches'
type RowSource = {
  id: string
  dueDate?: string
  followUp?: string
  date?: string
  createdAt?: string
}
type Line = string | false | null | undefined
// Form değerleri arayüzden serbest gelir; yoklama işaretleri marks altında öğrenci kimliğiyle tutulur.
export type FormValues = { [key: string]: unknown; marks?: Record<string, unknown> }
export type FieldType =
  'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'multi' | 'checkbox' | 'tel'
export type FieldOption = { value: string; label: string }
type FieldExtra = {
  options?: FieldOption[]
  min?: number
  max?: number
  step?: number | string
  hint?: string
  maxLength?: number
}
export type WorkflowField = { key: string; label: string; type: FieldType } & FieldExtra
export type WorkflowForm = {
  title: string
  hint: string
  initial: FormValues
  fields: (values: FormValues) => WorkflowField[]
}
export type WorkflowAction = ReturnType<typeof action>
export type WorkflowSection = { title: string; lines: string[] }
export type WorkflowDocument = { type: 'contract'; id: string; studentId: string; title: string }
export type WorkflowDetails = {
  sections: WorkflowSection[]
  actions: WorkflowAction[]
  documents: WorkflowDocument[]
}
type RowOf<K extends string, T extends RowSource> = ReturnType<typeof row<K, T>>
export type WorkflowRow =
  | RowOf<'goal', Goal>
  | RowOf<'guidance', GuidanceCase | RedactedGuidanceCase>
  | RowOf<'exam', State['mockExams'][number]>
  | RowOf<'renewal', State['renewals'][number]>
  | RowOf<'lesson', State['schedule'][number]>
  | RowOf<'study-task', State['studyTasks'][number]>
  | RowOf<'event', State['schoolEvents'][number]>
  | RowOf<'route', State['transportRoutes'][number]>
  | RowOf<'meal', State['mealMenus'][number]>
  | RowOf<'club', State['clubs'][number]>

// Eski sürüm eksik kayıt veya değerde alan okurken TypeError fırlatıyordu; aynı hata türü korunur.
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new TypeError('Beklenen değer bulunamadı.')
  return value
}
const name = (state: State, collection: NamedCollection, id: string | null | undefined) => {
  const list: readonly { id: string; name: string }[] = state[collection]
  return list.find((r) => r.id === id)?.name || '—'
}
const subject = (state: State, id: string | null | undefined) => name(state, 'subjects', id)
const labelDate = (value: Parameters<typeof dateLabel>[0]) => dateLabel(value, { year: 'numeric' })
function row<K extends string, T extends RowSource>(
  source: T,
  // İş akışıyla eklenen dersin adı boş olabilir; satır başlığı da boş kalır.
  title: string | undefined,
  subtitle: string,
  body: string,
  status: string,
  kind: K,
): {
  id: string
  source: T
  title: string | undefined
  subtitle: string
  body: string
  status: string
  kind: K
  meta: string[]
  date: string | undefined
} {
  return {
    id: source.id,
    source,
    title,
    subtitle,
    body,
    status,
    kind,
    meta: [],
    date: source.dueDate || source.followUp || source.date || source.createdAt,
  }
}

// Formlar ve listeler işlemi yapan öğretmene göre kurulur; öğretmen olmayan rolde demo
// öğretmeni varsayılan seçimdir.
const teacherOf = (state: State, session: Session) =>
  sessionTeacherId(state, session) ?? DEMO_TEACHER_ID
const netLabel = (value: number) => value.toLocaleString('tr-TR')
// Branş öğretmeni yalnızca kendi dersinin ve genel net hedeflerini görür.
function goalVisibleToTeacher(state: State, session: Session, goal: Goal) {
  return (
    session.role !== 'ogretmen' ||
    !goal.subjectId ||
    goal.subjectId === state.teachers.find((t) => t.id === teacherOf(state, session))?.subjectId
  )
}
export function workflowCsvReferences(state: State, session: Session) {
  const scope = workflowScope(state, session)
  return [
    ...state.mockExams.map((e) => `examId: ${e.id} · ${e.title}`),
    ...scope.students.map(
      (s) => `studentId: ${s.id} · ${s.name} · ${name(state, 'classes', s.classId)}`,
    ),
    ...state.subjects
      .filter(
        (s) =>
          session.role !== 'ogretmen' ||
          s.id === state.teachers.find((t) => t.id === teacherOf(state, session))?.subjectId,
      )
      .map((s) => `subjectId: ${s.id} · ${s.name}`),
  ]
}

export function workflowRows(
  state: State,
  session: Session,
  page: string | undefined,
  now = new Date().toISOString(),
): WorkflowRow[] {
  const definition = workflowPage(page)
  if (!definition || !definition.roles.includes(session.role) || !state.modules[definition.key])
    return []
  const scope = workflowScope(state, session),
    own = (r: { studentId: string }) => scope.studentIds.has(r.studentId)
  const studentClass = state.classes.find((c) => c.id === scope.student?.classId)
  const allowedBranch = (id: string | null | undefined) =>
    scope.institution ||
    (session.role === 'ogretmen'
      ? state.teachers.find((t) => t.id === teacherOf(state, session))?.branchId === id
      : studentClass?.branchId === id)
  if (definition.key === 'goals')
    return state.studentGoals
      .filter((r) => own(r) && goalVisibleToTeacher(state, session, r))
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .map((r) => {
        const progress = goalProgress(state, r)
        return {
          ...row(
            r,
            r.title,
            `${name(state, 'students', r.studentId)} · ${r.subjectId ? subject(state, r.subjectId) : 'Genel net'}`,
            `Hedef: ${netLabel(r.targetNet)} net · Güncel: ${progress.current === null ? 'deneme sonucu yok' : `${netLabel(progress.current)} net`} · %${progress.percent}\nSon tarih: ${labelDate(r.deadline)} · Adım: ${progress.stepsDone}/${progress.stepsTotal}`,
            progress.achieved && r.status === 'Aktif' ? 'Ulaşıldı' : r.status,
            'goal',
          ),
          date: r.deadline,
        }
      })
  if (definition.key === 'guidance')
    return state.guidanceCases
      .filter(
        (r) => own(r) && (session.role !== 'ogretmen' || r.teacherId === teacherOf(state, session)),
      )
      .map((r) => {
        const source: GuidanceCase | RedactedGuidanceCase = scope.scope.redact('guidanceCases', r)
        return row(
          source,
          r.title,
          `${name(state, 'students', r.studentId)} · ${name(state, 'teachers', r.teacherId)}`,
          `${r.plan}\n${r.sharedNote}\nTakip: ${labelDate(r.followUp)}`,
          r.status,
          'guidance',
        )
      })
  if (definition.key === 'exams')
    return state.mockExams
      .filter(
        (e) =>
          scope.institution ||
          state.mockResults.some((r) => r.examId === e.id && own(r)) ||
          scope.students.some(
            (s) => state.classes.find((c) => c.id === s.classId)?.grade === e.grade,
          ),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => {
        const results = state.mockResults.filter((r) => r.examId === e.id && own(r))
        const nets = [...new Set(results.map((r) => r.studentId))].map(
          (id) =>
            `${name(state, 'students', id)}: ${results
              .filter((r) => r.studentId === id)
              .reduce((sum, r) => sum + examNet(r, e), 0)
              .toLocaleString('tr-TR', { maximumFractionDigits: 2 })} net`,
        )
        return row(
          e,
          e.title,
          `${e.type} · ${e.grade}. sınıf · ${labelDate(e.date)}`,
          `${e.subjectIds.map((id) => subject(state, id)).join(', ')}\n${nets.join('\n') || 'Henüz sonuç girilmedi.'}`,
          results.length ? 'Sonuç girildi' : 'Sonuç bekleniyor',
          'exam',
        )
      })
  if (definition.key === 'renewal')
    return state.renewals
      .filter(own)
      .map((r) =>
        row(
          r,
          name(state, 'students', r.studentId),
          `${r.year}–${r.year + 1} · ${r.mode === 'graduate' ? 'Mezuniyet' : name(state, 'classes', r.targetClassId)}`,
          `${name(state, 'classes', r.fromClassId)} → ${r.mode === 'graduate' ? 'Mezun' : name(state, 'classes', r.targetClassId)}\n${money(r.amount)}`,
          r.status,
          'renewal',
        ),
      )
  if (definition.key === 'planning')
    return state.schedule
      .filter(
        (l) =>
          scope.institution ||
          l.teacherId === teacherOf(state, session) ||
          l.originalTeacherId === teacherOf(state, session),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) =>
        row(
          l,
          l.title,
          `${name(state, 'classes', l.classId)} · ${labelDate(l.date)} ${timeLabel(l.date)}`,
          `${name(state, 'teachers', l.teacherId)} · Derslik ${l.room} · ${l.duration} dk`,
          l.cancelledAt ? 'İptal' : l.originalTeacherId ? 'Geçici görev' : 'Planlandı',
          'lesson',
        ),
      )
  if (definition.key === 'study')
    return state.studyTasks
      .filter(
        (r) => own(r) && (session.role !== 'ogretmen' || r.teacherId === teacherOf(state, session)),
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((r) =>
        row(
          r,
          r.title,
          `${name(state, 'students', r.studentId)} · ${subject(state, r.subjectId)}`,
          `${r.topic} · ${r.minutes} dk\n${r.instructions}\nSon tarih: ${labelDate(r.dueDate)}`,
          r.status,
          'study-task',
        ),
      )
  if (definition.key === 'calendar')
    return state.schoolEvents
      .filter(
        (e) =>
          scope.institution ||
          (session.role === 'ogretmen'
            ? e.classId
              ? scope.classIds.has(e.classId)
              : allowedBranch(e.branchId)
            : eventStudents(state, e).some((s) => s.id === scope.student?.id)),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => {
        const consent = state.eventConsents.find(
          (c) => c.eventId === e.id && c.studentId === scope.student?.id,
        )
        return row(
          e,
          e.title,
          `${labelDate(e.date)} ${timeLabel(e.date)} · ${e.location}`,
          `${e.description}\n${e.requiresConsent ? `Veli onayı · Son gün: ${labelDate(e.consentDeadline)}` : 'Veli onayı gerekmiyor.'}`,
          e.status === 'İptal'
            ? 'İptal'
            : !scope.institution && session.role !== 'ogretmen' && e.requiresConsent
              ? consent?.decision || 'Onay bekliyor'
              : e.status,
          'event',
        )
      })
  if (definition.key === 'transport')
    return state.transportRoutes
      .filter(
        (r) =>
          scope.institution || state.transportAssignments.some((a) => a.routeId === r.id && own(a)),
      )
      .map((r) => {
        const assignments = state.transportAssignments.filter(
          (a) => a.routeId === r.id && (scope.institution || own(a)),
        )
        return row(
          r,
          r.title,
          `${name(state, 'branches', r.branchId)} · ${r.plate}`,
          `${r.driver} · ${r.phone}\nDuraklar: ${r.stops.join(' → ')}\n${assignments.map((a) => `${name(state, 'students', a.studentId)} · ${a.stop}`).join('\n')}`,
          r.status,
          'route',
        )
      })
  if (definition.key === 'meals')
    return state.mealMenus
      .filter((m) => allowedBranch(m.branchId))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) =>
        row(
          m,
          m.title,
          `${labelDate(m.date)} · ${name(state, 'branches', m.branchId)}`,
          `Alerjenler: ${m.allergens}\n${m.description}`,
          dayKey(m.date) === dayKey(now) ? 'Bugün' : 'Menü',
          'meal',
        ),
      )
  if (definition.key === 'clubs')
    return state.clubs
      .filter(
        (c) =>
          (allowedBranch(c.branchId) ||
            state.clubMemberships.some((m) => m.clubId === c.id && own(m))) &&
          (session.role !== 'ogretmen' || c.teacherId === teacherOf(state, session)),
      )
      .map((c) => {
        const count = state.clubMemberships.filter(
          (m) => m.clubId === c.id && m.status === 'Aktif',
        ).length
        const ownMember = state.clubMemberships.some(
          (m) => m.clubId === c.id && own(m) && m.status === 'Aktif',
        )
        return row(
          c,
          c.title,
          `${name(state, 'teachers', c.teacherId)} · ${name(state, 'branches', c.branchId)}`,
          `${c.description}\n${c.meeting}\n${count} / ${c.capacity} üye`,
          c.status === 'Arşiv'
            ? 'Arşiv'
            : !scope.institution && session.role !== 'ogretmen' && ownMember
              ? 'Kayıtlı'
              : 'Aktif',
          'club',
        )
      })
  return []
}
const action = (command: string, label: string, recordId?: string, initial?: FormValues) => ({
  command,
  label,
  recordId,
  initial,
})
export function workflowCreateActions(
  state: State,
  session: Session,
  page: string | undefined,
): WorkflowAction[] {
  const definition = workflowPage(page)
  if (!definition || !state.modules[definition.key]) return []
  const candidates: Partial<Record<string, readonly (readonly [string, string])[]>> = {
    goals: [['goal', 'Hedef belirle']],
    guidance: [['guidance', 'Takip dosyası aç']],
    exams: [
      ['exam', 'Deneme oluştur'],
      ['exam-result', 'Sonuç gir'],
      ['exam-import', 'CSV sonuç aktar'],
    ],
    renewal: [['renewal', 'Kayıt yenile']],
    planning: [['lesson', 'Ders planla']],
    study: [['study-task', 'Çalışma görevi ekle']],
    calendar: [['event', 'Etkinlik oluştur']],
    transport: [
      ['route', 'Güzergâh ekle'],
      ['transport-assign', 'Öğrenci ata'],
    ],
    meals: [['meal', 'Menü ekle']],
    clubs: [['club', 'Kulüp oluştur']],
  }
  // Optik değerlendirme ve otomatik etüt gibi kendi ekranında işlem yapan modüllerin tabloda karşılığı yoktur.
  return (candidates[definition.key] ?? [])
    .filter(([cmd]) => mayRun(session, cmd))
    .map(([cmd, label]) => action(cmd, label))
}
const commentActors: Partial<Record<Role, string>> = {
  veli: 'Veli',
  ogretmen: 'Öğretmen',
  yonetici: 'Yönetici',
}
export function workflowDetails(
  state: State,
  session: Session,
  entry: { kind: string; id: string },
): WorkflowDetails {
  const visible = workflowRows(state, session, workflowPageForKind(entry.kind)).find(
    (r) => r.id === entry.id,
  )
  if (!visible) return { sections: [], actions: [], documents: [] }
  // Türün sayfasındaki satırların hepsi o türdendir; satırın türü kayıt tipini daraltır.
  const { kind, source: record } = visible
  const scope = workflowScope(state, session),
    actions: WorkflowAction[] = [],
    sections: WorkflowSection[] = [],
    documents: WorkflowDocument[] = []
  const add = (
    command: string,
    label: string,
    recordId: string | null | undefined = record.id,
    initial?: FormValues,
  ) => {
    // `null`: kimliksiz oluşturma komutu (API `:recordId` kabul etmez); konu kayıt `initial` taşır.
    if (mayRun(session, command))
      actions.push(action(command, label, recordId ?? undefined, initial))
  }
  const section = (title: string, lines: readonly Line[]) =>
    sections.push({ title, lines: lines.filter((line): line is string => Boolean(line)) })
  if (kind === 'goal') {
    const progress = goalProgress(state, record)
    section('Hedef ve ilerleme', [
      `${record.subjectId ? subject(state, record.subjectId) : 'Genel net (tüm dersler)'} · Hedef ${netLabel(record.targetNet)} net`,
      `Başlangıç: ${netLabel(record.baselineNet)} net · Güncel: ${progress.current === null ? 'deneme sonucu yok' : `${netLabel(progress.current)} net`} · İlerleme %${progress.percent}`,
      progress.achieved ? 'Hedef net değerine ulaşıldı.' : '',
      `Son tarih: ${labelDate(record.deadline)}`,
      record.motivation && `Öğrencinin notu: ${record.motivation}`,
      record.status === 'Onay bekliyor' && 'Öğretmen veya yönetici onayı bekleniyor.',
      record.feedback && `Değerlendirme: ${record.feedback}`,
    ])
    section(
      'Denemeler arası seyir',
      progress.series.map(
        (point) => `${labelDate(point.date)} · ${point.title}: ${netLabel(point.net)} net`,
      ),
    )
    section(
      'Gelişim adımları',
      record.steps.map(
        (step) =>
          `${step.done ? '✓' : '○'} ${step.title} · ${labelDate(step.dueDate)}${step.source === 'auto' ? ' · Öneri' : ''}${step.done ? ` · Tamamlandı ${labelDate(step.doneAt)}` : ''}`,
      ),
    )
    section(
      'Yorumlar',
      record.comments.map(
        (c) => `${labelDate(c.date)} · ${commentActors[c.actor] || c.actor}: ${c.text}`,
      ),
    )
    if (record.status === 'Onay bekliyor') add('goal-review', 'Hedefi değerlendir')
    if (['Onay bekliyor', 'Aktif'].includes(record.status)) {
      add('goal-step', 'Gelişim adımı ekle')
      add('goal-suggest', 'Zayıf konulardan adım öner')
      if (record.status === 'Aktif')
        for (const step of record.steps.filter((s) => !s.done))
          add('goal-step-done', `“${step.title}” adımını tamamla`, record.id, { stepId: step.id })
      add('goal-close', 'Hedefi kapat')
    }
    add('goal-comment', 'Yorum ekle')
  }
  if (kind === 'guidance') {
    section('Paylaşılan destek planı', [
      record.plan,
      record.sharedNote,
      `Sonraki takip: ${labelDate(record.followUp)}`,
    ])
    if (scope.scope.counselor) {
      section('Kurum içi görüşme notları', [
        record.internalNote,
        ...present(record.notes).map((n) => `${labelDate(n.date)} · ${n.text}`),
      ])
      add('guidance-note', 'Görüşme / sonuç kaydet')
    }
  }
  if (kind === 'exam') {
    section('Net hesabı', [
      record.wrongPenalty
        ? `Net = doğru − yanlış / ${record.wrongPenalty}. Bu oran kurumun bu deneme için tanımladığı kuraldır.`
        : 'Yanlışlar doğru sayısını azaltmaz.',
      'Her derste doğru + yanlış + boş toplamı kaydedilir. Karşılaştırmalarda ders kapsamını kontrol edin.',
    ])
    const results = state.mockResults.filter(
      (r) => r.examId === record.id && scope.studentIds.has(r.studentId),
    )
    section(
      'Ders sonuçları',
      results.map(
        (r) =>
          `${name(state, 'students', r.studentId)} · ${subject(state, r.subjectId)}: ${r.correct} doğru / ${r.wrong} yanlış / ${r.blank} boş · ${examNet(r, record).toLocaleString('tr-TR')} net${r.weakTopics.length ? ` · Eksik konular: ${r.weakTopics.join(', ')}` : ''}`,
      ),
    )
    if (state.modules.optical) {
      const evaluated = currentEvaluations(state, record.id, session)
      section(
        'Optik kazanım analizi',
        evaluated.flatMap((evaluation) =>
          evaluation.topicScores.map(
            (topic) =>
              `${name(state, 'students', evaluation.studentId)} · ${subject(state, evaluation.subjectId)} · ${topic.topic}: ${topic.total ? `%${topic.percent} (${topic.correct}/${topic.total})` : 'Tüm sorular iptal'} · Kitapçık ${evaluation.booklet}`,
          ),
        ),
      )
      section(
        'Optik soru ayrıntıları',
        evaluated.flatMap((evaluation) =>
          evaluation.questionResults.map((question) => {
            const status = {
              correct: 'Doğru',
              wrong: 'Yanlış',
              blank: 'Boş',
              multiple: 'Çoklu işaret',
              cancelled: 'İptal',
            }[question.outcome]
            return `${name(state, 'students', evaluation.studentId)} · ${subject(state, evaluation.subjectId)} · ${question.number}. soru: ${status} · Cevap ${present(question.response).trim() || 'boş'} / Anahtar ${question.answer} · ${question.topic}`
          }),
        ),
      )
      const profile = state.opticalProfiles.find((p) => p.examId === record.id)
      if (
        state.opticalEvaluations.some(
          (e) =>
            e.examId === record.id &&
            scope.studentIds.has(e.studentId) &&
            e.keyRevision !== profile?.revision,
        )
      )
        section('Değerlendirme durumu', [
          'Cevap anahtarı değişmiş. Kazanım analizi için optik dosyayı yeniden değerlendirin.',
        ])
    }
    if (!scope.institution && session.role !== 'ogretmen')
      section(
        'Denemeler arası gelişim',
        examProgress(state, present(scope.student).id).map(
          (e) =>
            `${labelDate(e.date)} · ${e.title}: ${e.net.toLocaleString('tr-TR')} net${e.complete ? '' : ' (ders sonuçları eksik)'}`,
        ),
      )
    add('exam-result', 'Sonuç gir', null, { examId: record.id })
    if (state.modules.study)
      for (const result of results.filter(
        (r) =>
          r.weakTopics.length &&
          (session.role !== 'ogretmen' ||
            r.subjectId ===
              state.teachers.find((t) => t.id === teacherOf(state, session))?.subjectId),
      )) {
        if (mayRun(session, 'study-task'))
          actions.push(
            action(
              'study-task',
              `${name(state, 'students', result.studentId)} · ${subject(state, result.subjectId)} çalışma planı`,
              undefined,
              {
                studentId: result.studentId,
                subjectId: result.subjectId,
                topic: result.weakTopics.join(', '),
                title: `${subject(state, result.subjectId)} konu tekrarı`,
              },
            ),
          )
      }
  }
  if (kind === 'renewal') {
    section('Dönem geçişi', [
      `${record.year}–${record.year + 1}`,
      `${name(state, 'classes', record.fromClassId)} → ${record.mode === 'graduate' ? 'Mezuniyet' : name(state, 'classes', record.targetClassId)}`,
      record.mode === 'renew'
        ? `Brüt: ${money(record.gross)} · Burs: ${money(record.scholarshipAmount)} · İndirim: ${money(record.discountAmount)} · Net: ${money(record.amount)}`
        : '',
      record.status === 'Planlandı'
        ? 'Yeni dönem başlatılınca sınıf değişir; geçmiş not, yoklama ve tahsilatlar korunur.'
        : 'Dönem geçişi uygulanmış.',
    ])
    if (record.contractId) {
      documents.push({
        type: 'contract',
        id: record.contractId,
        studentId: record.studentId,
        title: 'Yeni dönem sözleşmesi',
      })
      section(
        'Yeni dönem taksitleri',
        state.invoices
          .filter((i) => i.contractId === record.contractId)
          .map(
            (i) =>
              `${i.installment}. taksit · ${labelDate(i.dueDate)} · ${money(i.amount)} · ${i.paidAt ? 'Ödendi' : 'Bekliyor'}`,
          ),
      )
    }
    if (record.status === 'Planlandı') add('renewal-activate', 'Dönem geçişini uygula')
  }
  if (kind === 'lesson') {
    section('Ders bilgileri', [
      `${name(state, 'classes', record.classId)} · ${record.title}`,
      `${labelDate(record.date)} ${timeLabel(record.date)} · ${record.duration} dk`,
      `${name(state, 'teachers', record.teacherId)} · Derslik ${record.room}`,
      ...(record.substitutions || []).map(
        (s) =>
          `${name(state, 'teachers', s.fromTeacherId)} → ${name(state, 'teachers', s.toTeacherId)} · ${s.reason}`,
      ),
    ])
    if (!record.cancelledAt) {
      add('lesson', 'Dersi düzenle')
      add('substitute', 'Geçici öğretmen ata')
      add('lesson-cancel', 'Dersi iptal et')
    }
  }
  if (kind === 'study-task') {
    section('Çalışma ve geri bildirim', [
      record.instructions,
      `Öğretmen: ${name(state, 'teachers', record.teacherId)}`,
      `Son tarih: ${labelDate(record.dueDate)} · ${record.minutes} dakika`,
      record.completionNote && `Öğrenci: ${record.completionNote}`,
      record.feedback && `Öğretmen: ${record.feedback}`,
    ])
    if (['Onaylandı', 'Tekrar çalışılacak'].includes(record.status))
      add('study-complete', 'Çalışmayı teslim et')
    if (['Onay bekliyor', 'Değerlendirme bekliyor'].includes(record.status))
      add(
        'study-review',
        record.status === 'Onay bekliyor' ? 'Planı onayla' : 'Çalışmayı değerlendir',
      )
  }
  if (kind === 'event') {
    section('Etkinlik', [
      record.description,
      `${labelDate(record.date)} ${timeLabel(record.date)} – ${timeLabel(record.endDate)}`,
      record.location,
      record.requiresConsent
        ? `Veli onayı son günü: ${labelDate(record.consentDeadline)}`
        : 'Veli onayı gerekmiyor.',
    ])
    const students = eventStudents(state, record).filter((s) => scope.studentIds.has(s.id)),
      consents = state.eventConsents.filter((c) => c.eventId === record.id)
    section(
      'Veli onayları',
      students.map((s) => {
        const consent = consents.find((c) => c.studentId === s.id)
        return `${s.name}: ${record.requiresConsent ? consent?.decision || 'Onay bekliyor' : 'Onay gerekmiyor'}${consent?.note ? ` · ${consent.note}` : ''}`
      }),
    )
    if (record.status !== 'İptal') {
      if (record.requiresConsent) add('consent', 'Veli onayı ver / güncelle')
      if (session.role !== 'ogretmen' || record.teacherId === teacherOf(state, session))
        add('event-cancel', 'Etkinliği iptal et')
    }
  }
  if (kind === 'route') {
    section('Servis bilgileri', [
      `${record.plate} · ${record.driver} · ${record.phone}`,
      `Duraklar: ${record.stops.join(' → ')}`,
      `Kapasite: ${record.capacity}`,
    ])
    const assignments = state.transportAssignments.filter(
      (a) => a.routeId === record.id && (scope.institution || scope.studentIds.has(a.studentId)),
    )
    section(
      'Öğrenci atamaları',
      assignments.map((a) => `${name(state, 'students', a.studentId)} · ${a.stop}`),
    )
    if (record.status === 'Aktif') {
      add('route', 'Güzergâhı düzenle')
      add('transport-assign', 'Bu servise öğrenci ata', null, { routeId: record.id })
      add('route-archive', 'Güzergâhı arşivle')
    }
    for (const assignment of assignments)
      add(
        'transport-remove',
        `${name(state, 'students', assignment.studentId)} atamasını kaldır`,
        assignment.id,
      )
  }
  if (kind === 'meal') {
    section('Menü', [record.title, `Alerjenler: ${record.allergens}`, record.description])
    add('meal', 'Menüyü düzenle')
  }
  if (kind === 'club') {
    const members = state.clubMemberships.filter(
        (m) => m.clubId === record.id && m.status === 'Aktif',
      ),
      visibleMembers = members.filter((m) => scope.studentIds.has(m.studentId))
    section('Kulüp', [
      record.description,
      record.meeting,
      `Sorumlu: ${name(state, 'teachers', record.teacherId)}`,
      `${members.length} / ${record.capacity} üye`,
    ])
    section(
      'Üyeler',
      visibleMembers.map((m) => name(state, 'students', m.studentId)),
    )
    section(
      'Projeler ve başarılar',
      state.socialAchievements
        .filter((a) => a.clubId === record.id && scope.studentIds.has(a.studentId))
        .map(
          (a) =>
            `${name(state, 'students', a.studentId)} · ${a.title} · ${labelDate(a.date)}\n${a.description}`,
        ),
    )
    section(
      'Kulüp yoklaması',
      state.clubAttendance
        .filter((a) => a.clubId === record.id && scope.studentIds.has(a.studentId))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((a) => `${labelDate(a.date)} · ${name(state, 'students', a.studentId)} · ${a.status}`),
    )
    if (record.status === 'Aktif') {
      add('club-enroll', 'Kulübe kaydol / öğrenci ekle')
      add('club-attendance', 'Kulüp yoklaması al')
      add('achievement', 'Proje / başarı kaydet', null, { clubId: record.id })
      add('club-archive', 'Kulübü arşivle')
    }
    for (const member of visibleMembers)
      add(
        'club-leave',
        `${name(state, 'students', member.studentId)} üyeliğini sonlandır`,
        member.id,
      )
  }
  return { sections, actions, documents }
}
export function workflowPageForKind(kind: string) {
  const pages: Partial<Record<string, string>> = {
    goal: 'hedef-plani',
    guidance: 'rehberlik',
    exam: 'deneme-sinavlari',
    renewal: 'kayit-yenileme',
    lesson: 'program-yonetimi',
    'study-task': 'calisma-plani',
    event: 'okul-takvimi',
    route: 'okul-servisi',
    meal: 'yemek-menusu',
    club: 'kulupler',
  }
  return pages[kind]
}

const field = (
  key: string,
  label: string,
  type: FieldType = 'text',
  extra: FieldExtra = {},
): WorkflowField => ({ key, label, type, ...extra })
function options<T extends { id: string; name: string }>(items: readonly T[]): FieldOption[]
function options<T extends { id: string }>(
  items: readonly T[],
  label: (item: T) => string,
): FieldOption[]
function options(
  items: readonly { id: string; name?: string }[],
  label = (r: { name?: string }) => r.name,
) {
  return items.map((r) => ({ value: r.id, label: label(r) }))
}
const choice = (key: string, label: string, items: FieldOption[]) =>
  field(key, label, 'select', { options: items })
export const csvTemplate =
  'examId;studentId;subjectId;correct;wrong;blank;weakTopics\nexam-7-1;s1;math;12;5;3;Denklemler'
export function workflowForm(
  state: State,
  session: Session,
  command: string,
  recordId?: string,
  overrides: FormValues = {},
  now = new Date().toISOString(),
): WorkflowForm {
  // Varsayılan tarihler işlem anından türetilir; testler `now` ile sabitler.
  const daysLater = (days: number) =>
    new Date(Date.parse(now) + days * 86400000).toISOString().slice(0, 10)
  const scope = workflowScope(state, session),
    today = dayKey(now),
    future = daysLater(7)
  const studentOptions = options(
      scope.students,
      (s) => `${s.name} · ${name(state, 'classes', s.classId)}`,
    ),
    teachers = state.teachers.filter((t) => t.isActive),
    branches = state.branches.filter((b) => b.isActive)
  const initialStudent = overrides.studentId || scope.students[0]?.id || ''
  const teacherSubjectId =
    state.teachers.find((t) => t.id === teacherOf(state, session))?.subjectId || ''
  // Kayıt yalnız onu kullanan komutun koleksiyonunda aranır; kimlik yoksa null, bulunamazsa undefined.
  const recordIn = <T extends { id: string }>(list: readonly T[] | undefined) =>
    recordId ? list?.find((r) => r.id === recordId) : null
  const form: WorkflowForm = {
    title: 'İşlemi onayla',
    hint: 'Bu işlem yerel okul kaydını günceller.',
    initial: {},
    fields: () => [],
  }
  const assignForm = (patch: Partial<WorkflowForm>) => Object.assign(form, patch)
  if (command === 'goal')
    assignForm({
      title: 'Hedef belirle',
      hint:
        session.role === 'ogrenci'
          ? 'Hedefiniz öğretmeniniz veya yönetici onayladıktan sonra aktif olur.'
          : 'Hedef onaylı olarak açılır ve öğrenci ile veli ekranına yansır.',
      initial: {
        studentId: initialStudent,
        subjectId: session.role === 'ogretmen' ? teacherSubjectId : '',
        title: '',
        targetNet: '',
        deadline: daysLater(30),
        motivation: '',
      },
      fields: (values) => {
        const student = state.students.find((s) => s.id === values.studentId),
          classroom = state.classes.find((c) => c.id === student?.classId)
        const subjectChoices = subjectsForGrade(classroom?.grade || 7).filter(
          (s) => session.role !== 'ogretmen' || s.id === teacherSubjectId,
        )
        return [
          choice('studentId', 'Öğrenci', studentOptions),
          choice('subjectId', 'Hedef kapsamı', [
            ...(session.role === 'ogretmen'
              ? []
              : [{ value: '', label: 'Genel net (tüm dersler toplamı)' }]),
            ...options(subjectChoices),
          ]),
          field('title', 'Hedef başlığı'),
          field('targetNet', 'Hedef net', 'number', { min: 1, max: 500, step: 0.25 }),
          field('deadline', 'Hedef son tarihi', 'date'),
          field('motivation', 'Hedefin nedeni / öğrenci notu', 'textarea'),
        ]
      },
    })
  if (command === 'goal-review')
    assignForm({
      title: 'Hedefi değerlendir',
      initial: { status: 'Aktif', feedback: '' },
      fields: () => [
        choice('status', 'Karar', [
          { value: 'Aktif', label: 'Onayla' },
          { value: 'Reddedildi', label: 'Reddet' },
        ]),
        field('feedback', 'Geri bildirim (reddetmede zorunlu)', 'textarea'),
      ],
    })
  if (command === 'goal-step')
    assignForm({
      title: 'Gelişim adımı ekle',
      initial: {
        title: '',
        topic: '',
        dueDate: daysLater(7),
      },
      fields: () => [
        field('title', 'Adım başlığı'),
        field('topic', 'Konu (isteğe bağlı)'),
        field('dueDate', 'Son tarih', 'date'),
      ],
    })
  if (command === 'goal-step-done') {
    const record = recordIn(state.studentGoals)
    assignForm({
      title: 'Adımı tamamla',
      initial: { stepId: '' },
      fields: () => [
        choice(
          'stepId',
          'Tamamlanan adım',
          options(
            (record?.steps || []).filter((s) => !s.done),
            (s) => s.title,
          ),
        ),
      ],
    })
  }
  if (command === 'goal-suggest')
    assignForm({
      title: 'Zayıf konulardan adım öner',
      hint: 'Deneme sonuçlarındaki eksik konulardan en fazla dört haftalık adım eklenir. Mevcut adımlar değişmez.',
    })
  if (command === 'goal-comment')
    assignForm({
      title: 'Yorum ekle',
      initial: { text: '' },
      fields: () => [field('text', 'Yorumunuz', 'textarea')],
    })
  if (command === 'goal-close')
    assignForm({
      title: 'Hedefi kapat',
      hint: 'Kapatılan hedef üzerinde yeni adım eklenemez. Geçmiş ilerleme ve yorumlar korunur.',
    })
  if (command === 'guidance')
    assignForm({
      title: 'Takip dosyası aç',
      initial: {
        studentId: initialStudent,
        teacherId: teacherOf(state, session),
        title: '',
        plan: '',
        sharedNote: '',
        internalNote: '',
        followUp: future,
      },
      fields: () => [
        choice('studentId', 'Öğrenci', studentOptions),
        choice(
          'teacherId',
          'Sorumlu öğretmen',
          options(
            session.role === 'ogretmen'
              ? teachers.filter((t) => t.id === teacherOf(state, session))
              : teachers,
          ),
        ),
        field('title', 'Takip başlığı'),
        field('plan', 'Destek planı', 'textarea'),
        field('sharedNote', 'Veli ve öğrenciyle paylaşılan not', 'textarea'),
        // İç notu yalnız rehberlik görevli öğretmen yazar (DOM-ILT-040).
        ...(scope.scope.counselor ? [field('internalNote', 'Kurum içi not', 'textarea')] : []),
        field('followUp', 'Sonraki takip tarihi', 'date'),
      ],
    })
  if (command === 'guidance-note') {
    const record = present(recordIn(state.guidanceCases))
    assignForm({
      title: 'Görüşme / sonuç kaydet',
      initial: {
        text: '',
        sharedNote: record.sharedNote,
        followUp: record.followUp.slice(0, 10),
        status: record.status,
      },
      fields: () => [
        field('text', 'Kurum içi görüşme notu', 'textarea'),
        field('sharedNote', 'Paylaşılan gelişim notu', 'textarea'),
        field('followUp', 'Sonraki takip tarihi', 'date'),
        choice(
          'status',
          'Takip durumu',
          ['Takipte', 'Tamamlandı'].map((value) => ({ value, label: value })),
        ),
      ],
    })
  }
  if (command === 'exam')
    assignForm({
      title: 'Deneme oluştur',
      hint: 'Deneme türü ve yanlış götürme oranı kurum tarafından tanımlanır. Resmî sınav puanı hesaplanmaz.',
      initial: {
        title: '',
        type: 'Okul denemesi',
        grade: 7,
        wrongPenalty: 4,
        date: today,
        subjectIds: ['math'],
      },
      fields: (values) => [
        field('title', 'Deneme adı'),
        choice(
          'type',
          'Deneme türü',
          ['LGS', 'YKS', 'Okul denemesi'].map((value) => ({ value, label: value })),
        ),
        field('grade', 'Sınıf düzeyi', 'number', { min: 5, max: 12 }),
        field('wrongPenalty', 'Bir doğruyu götüren yanlış sayısı', 'number', {
          min: 0,
          max: 10,
          hint: '0: yanlışlar doğruyu azaltmaz.',
        }),
        field('date', 'Sınav tarihi', 'date'),
        field('subjectIds', 'Sınav dersleri', 'multi', {
          options: options(subjectsForGrade(Number(values.grade))),
        }),
      ],
    })
  if (command === 'exam-result')
    assignForm({
      title: 'Ders sonucu gir',
      initial: {
        examId: recordId || state.mockExams[0]?.id || '',
        studentId: initialStudent,
        subjectId: 'math',
        correct: 0,
        wrong: 0,
        blank: 0,
        weakTopics: '',
      },
      fields: (values) => {
        const exam = state.mockExams.find((e) => e.id === values.examId)
        return [
          choice(
            'examId',
            'Deneme',
            options(state.mockExams, (e) => `${e.title} · ${e.grade}. sınıf`),
          ),
          choice(
            'studentId',
            'Öğrenci',
            options(
              scope.students.filter(
                (s) => state.classes.find((c) => c.id === s.classId)?.grade === exam?.grade,
              ),
            ),
          ),
          choice(
            'subjectId',
            'Ders',
            options(
              state.subjects.filter(
                (s) =>
                  exam?.subjectIds.includes(s.id) &&
                  (session.role !== 'ogretmen' ||
                    s.id ===
                      state.teachers.find((t) => t.id === teacherOf(state, session))?.subjectId),
              ),
            ),
          ),
          field('correct', 'Doğru', 'number', { min: 0, max: 200 }),
          field('wrong', 'Yanlış', 'number', { min: 0, max: 200 }),
          field('blank', 'Boş', 'number', { min: 0, max: 200 }),
          field('weakTopics', 'Eksik konular', 'textarea', { hint: 'Konuları virgülle ayırın.' }),
        ]
      },
    })
  if (command === 'exam-import')
    assignForm({
      title: 'CSV sonuç aktar',
      hint: 'Excel tablonuzu UTF-8 CSV olarak kaydedin. Yedi sütun, şablondaki sırayla olmalıdır. Mevcut aynı ders sonuçları güncellenir; tüm satırlar doğrulanmadan kayıt yapılmaz.',
      initial: { csv: csvTemplate },
      fields: () => [field('csv', 'CSV içeriği', 'textarea', { maxLength: 1024 * 1024 })],
    })
  if (command === 'renewal')
    assignForm({
      title: 'Kayıt yenile',
      hint: 'Burs brüt eğitim bedelinden, sabit indirim burs sonrası tutardan düşülür. Onaydan sonra yeni sözleşme ve taksitler oluşur. Sınıf değişimi ayrı dönem geçişi işlemiyle uygulanır.',
      initial: {
        studentId: initialStudent,
        targetClassId: '',
        year: state.academicYear + 1,
        mode: 'renew',
        total: 28500,
        scholarship: 0,
        discount: 0,
        count: 8,
        startDate: future,
      },
      fields: (values) => {
        const student = state.students.find((s) => s.id === values.studentId),
          grade = state.classes.find((c) => c.id === student?.classId)?.grade
        return [
          choice('studentId', 'Öğrenci', studentOptions),
          choice('mode', 'Geçiş türü', [
            { value: 'renew', label: 'Bir üst sınıfa kayıt yenile' },
            { value: 'graduate', label: '12. sınıf mezuniyeti' },
          ]),
          field('year', 'Yeni eğitim yılı başlangıcı', 'number', {
            min: state.academicYear + 1,
            max: 2100,
          }),
          ...(values.mode === 'graduate'
            ? []
            : [
                choice(
                  'targetClassId',
                  'Yeni sınıf',
                  options(
                    state.classes.filter(
                      (c) => c.isActive && grade !== undefined && c.grade === grade + 1,
                    ),
                    (c) => `${c.name} · ${name(state, 'branches', c.branchId)}`,
                  ),
                ),
                field('total', 'Brüt eğitim bedeli (₺)', 'number', {
                  min: 100,
                  max: 1000000,
                  step: '0.01',
                }),
                field('scholarship', 'Burs oranı (%)', 'number', { min: 0, max: 100 }),
                field('discount', 'Ek indirim (₺)', 'number', {
                  min: 0,
                  max: 1000000,
                  step: '0.01',
                }),
                field('count', 'Taksit sayısı', 'number', { min: 1, max: 12 }),
                field('startDate', 'İlk taksit tarihi', 'date'),
              ]),
        ]
      },
    })
  if (command === 'renewal-activate')
    assignForm({
      title: 'Dönem geçişini uygula',
      hint: 'Öğrencinin güncel sınıfı değişir veya mezuniyeti işlenir. Kampüs değişirse eski servis ataması kaldırılır ve eski kampüs kulüp üyeliği sonlandırılır; geçmiş kayıtlar korunur.',
    })
  if (command === 'lesson') {
    const record = recordIn(state.schedule)
    assignForm({
      title: record ? 'Dersi düzenle' : 'Ders planla',
      initial: {
        classId: record?.classId || 'c1',
        teacherId: record?.teacherId || teacherOf(state, session),
        subjectId: record?.subjectId || 'math',
        date: record?.date || `${future}T09:00:00.000Z`,
        duration: record?.duration || 40,
        room: record?.room || '101',
      },
      fields: (values) => {
        const classroom = state.classes.find((c) => c.id === values.classId)
        return [
          choice(
            'classId',
            'Sınıf',
            options(
              state.classes.filter((c) => c.isActive),
              (c) => `${c.name} · ${name(state, 'branches', c.branchId)}`,
            ),
          ),
          choice('subjectId', 'Ders', options(subjectsForGrade(classroom?.grade || 7))),
          choice(
            'teacherId',
            'Öğretmen',
            options(
              teachers.filter(
                (t) => t.subjectId === values.subjectId && t.branchId === classroom?.branchId,
              ),
            ),
          ),
          field('date', 'Ders başlangıcı', 'datetime'),
          field('duration', 'Süre (dakika)', 'number', { min: 10, max: 180 }),
          field('room', 'Derslik'),
        ]
      },
    })
  }
  if (command === 'substitute') {
    const record = recordIn(state.schedule)
    assignForm({
      title: 'Geçici öğretmen ata',
      hint: 'Bu dersin öğretmeni değişir. Kalıcı branş ataması korunur. Uygun yedek yoksa önce Eğitim Kadrosu ekranından aynı branş ve kampüste öğretmen ekleyin.',
      initial: { teacherId: '', reason: '' },
      fields: () => [
        choice(
          'teacherId',
          'Geçici öğretmen',
          options(
            teachers.filter((t) => {
              const lesson = present(record)
              return (
                t.id !== lesson.teacherId &&
                t.subjectId === lesson.subjectId &&
                t.branchId === state.classes.find((c) => c.id === lesson.classId)?.branchId
              )
            }),
          ),
        ),
        field('reason', 'Görevlendirme nedeni', 'textarea'),
      ],
    })
  }
  if (command === 'lesson-cancel')
    assignForm({
      title: 'Dersi iptal et',
      hint: 'Ders günlük programlardan kaldırılır. Yönetim ekranında iptal kaydı korunur.',
    })
  if (command === 'study-task')
    assignForm({
      title: 'Çalışma görevi ekle',
      hint:
        session.role === 'ogrenci'
          ? 'Planınızı öğretmeniniz onayladıktan sonra çalışmayı teslim edebilirsiniz.'
          : 'Görev öğrencinin planına ve veli ekranına yansır.',
      initial: {
        studentId: initialStudent,
        subjectId: 'math',
        topic: '',
        title: '',
        instructions: '',
        dueDate: future,
        minutes: 30,
      },
      fields: (values) => {
        const student = state.students.find((s) => s.id === values.studentId),
          classroom = state.classes.find((c) => c.id === student?.classId)
        return [
          choice('studentId', 'Öğrenci', studentOptions),
          choice(
            'subjectId',
            'Ders',
            options(
              subjectsForGrade(classroom?.grade || 7).filter(
                (s) =>
                  session.role !== 'ogretmen' ||
                  s.id ===
                    state.teachers.find((t) => t.id === teacherOf(state, session))?.subjectId,
              ),
            ),
          ),
          field('topic', 'Çalışılacak konular'),
          field('title', 'Görev başlığı'),
          field('instructions', 'Çalışma yönergesi', 'textarea'),
          field('dueDate', 'Son tarih', 'date'),
          field('minutes', 'Hedef süre (dakika)', 'number', { min: 5, max: 240 }),
        ]
      },
    })
  if (command === 'study-complete')
    assignForm({
      title: 'Çalışmayı teslim et',
      initial: { completionNote: '' },
      fields: () => [field('completionNote', 'Çalışma sonucu / öğrenci notu', 'textarea')],
    })
  if (command === 'study-review') {
    const record = present(recordIn(state.studyTasks))
    assignForm({
      title: record.status === 'Onay bekliyor' ? 'Planı onayla' : 'Çalışmayı değerlendir',
      initial: {
        feedback: '',
        status: record.status === 'Onay bekliyor' ? 'Onaylandı' : 'Tamamlandı',
      },
      fields: () => [
        choice(
          'status',
          'Değerlendirme sonucu',
          (record.status === 'Onay bekliyor'
            ? ['Onaylandı']
            : ['Tamamlandı', 'Tekrar çalışılacak']
          ).map((value) => ({ value, label: value })),
        ),
        field('feedback', 'Öğretmen geri bildirimi', 'textarea'),
      ],
    })
  }
  if (command === 'event')
    assignForm({
      title: 'Etkinlik oluştur',
      initial: {
        title: '',
        classId: '',
        branchId: 'b1',
        date: `${future}T09:00:00.000Z`,
        endDate: `${future}T11:00:00.000Z`,
        location: '',
        description: '',
        requiresConsent: true,
        consentDeadline: today,
      },
      fields: (values) => [
        field('title', 'Etkinlik adı'),
        choice('branchId', 'Kampüs', options(branches)),
        choice('classId', 'Sınıf kapsamı', [
          ...(scope.institution ? [{ value: '', label: 'Kampüsün tüm sınıfları' }] : []),
          ...options(
            state.classes.filter(
              (c) =>
                c.isActive &&
                c.branchId === values.branchId &&
                (scope.institution || scope.classIds.has(c.id)),
            ),
          ),
        ]),
        field('date', 'Başlangıç', 'datetime'),
        field('endDate', 'Bitiş', 'datetime'),
        field('location', 'Yer'),
        field('description', 'Etkinlik açıklaması', 'textarea'),
        field('requiresConsent', 'Veli onayı gerekli', 'checkbox'),
        ...(values.requiresConsent ? [field('consentDeadline', 'Onay son günü', 'date')] : []),
      ],
    })
  if (command === 'consent') {
    const old = state.eventConsents.find(
      (c) => c.eventId === recordId && c.studentId === present(scope.student).id,
    )
    assignForm({
      title: 'Veli onayı ver / güncelle',
      initial: { decision: old?.decision || 'Onaylandı', note: old?.note || '' },
      fields: () => [
        choice(
          'decision',
          'Katılım izni',
          ['Onaylandı', 'Reddedildi'].map((value) => ({ value, label: value })),
        ),
        field('note', 'Veli notu', 'textarea'),
      ],
    })
  }
  if (command === 'event-cancel')
    assignForm({
      title: 'Etkinliği iptal et',
      hint: 'Etkinlik iptal olarak görünür. Daha önce verilen veli onayları geçmişte korunur.',
    })
  if (command === 'route') {
    const record = recordIn(state.transportRoutes)
    assignForm({
      title: record ? 'Güzergâhı düzenle' : 'Güzergâh ekle',
      initial: {
        title: record?.title || '',
        branchId: record?.branchId || 'b1',
        plate: record?.plate || '',
        driver: record?.driver || '',
        phone: record?.phone || '',
        capacity: record?.capacity || 20,
        stops: record?.stops.join(', ') || '',
      },
      fields: () => [
        field('title', 'Güzergâh adı'),
        choice('branchId', 'Kampüs', options(branches)),
        field('plate', 'Araç plakası'),
        field('driver', 'Sürücü adı'),
        field('phone', 'Sürücü telefonu', 'tel'),
        field('capacity', 'Öğrenci kapasitesi', 'number', { min: 1, max: 100 }),
        field('stops', 'Duraklar', 'textarea', {
          hint: 'Durakları yolculuk sırasıyla, virgülle ayırın.',
        }),
      ],
    })
  }
  if (command === 'transport-assign')
    assignForm({
      title: 'Servise öğrenci ata',
      initial: { studentId: initialStudent, routeId: state.transportRoutes[0]?.id || '', stop: '' },
      fields: (values) => [
        choice('studentId', 'Öğrenci', studentOptions),
        choice(
          'routeId',
          'Güzergâh',
          options(
            state.transportRoutes.filter((r) => r.status === 'Aktif'),
            (r) => `${r.title} · ${r.plate}`,
          ),
        ),
        choice(
          'stop',
          'Biniş durağı',
          (state.transportRoutes.find((r) => r.id === values.routeId)?.stops || []).map(
            (value) => ({ value, label: value }),
          ),
        ),
      ],
    })
  if (command === 'route-archive')
    assignForm({
      title: 'Güzergâhı arşivle',
      hint: 'Üzerinde öğrenci ataması bulunan güzergâh arşivlenemez.',
    })
  if (command === 'transport-remove')
    assignForm({
      title: 'Servis atamasını kaldır',
      hint: 'Öğrencinin güncel servis ataması kaldırılır; işlem geçmişine kaydedilir.',
    })
  if (command === 'meal') {
    const record = recordIn(state.mealMenus)
    assignForm({
      title: record ? 'Menüyü düzenle' : 'Menü ekle',
      initial: {
        branchId: record?.branchId || 'b1',
        date: record?.date.slice(0, 10) || today,
        title: record?.title || '',
        allergens: record?.allergens || '',
        description: record?.description || '',
      },
      fields: () => [
        choice('branchId', 'Kampüs', options(branches)),
        field('date', 'Menü günü', 'date'),
        field('title', 'Yemekler', 'textarea'),
        field('allergens', 'Alerjen bilgisi', 'textarea', {
          hint: 'İçerik bilgisini açıkça yazın; bulunmuyorsa “Yok” olarak belirtin.',
        }),
        field('description', 'Menü açıklaması', 'textarea'),
      ],
    })
  }
  if (command === 'club')
    assignForm({
      title: 'Kulüp oluştur',
      initial: {
        title: '',
        branchId: 'b1',
        teacherId: teacherOf(state, session),
        capacity: 20,
        description: '',
        meeting: '',
      },
      fields: (values) => [
        field('title', 'Kulüp adı'),
        choice('branchId', 'Kampüs', options(branches)),
        choice(
          'teacherId',
          'Kulüp sorumlusu',
          options(
            teachers.filter(
              (t) =>
                t.branchId === values.branchId &&
                (session.role !== 'ogretmen' || t.id === teacherOf(state, session)),
            ),
          ),
        ),
        field('capacity', 'Üye kapasitesi', 'number', { min: 1, max: 100 }),
        field('description', 'Kulüp açıklaması', 'textarea'),
        field('meeting', 'Toplantı günü / saati / yeri'),
      ],
    })
  if (command === 'club-enroll') {
    const record = recordIn(state.clubs)
    assignForm({
      title: 'Kulübe kaydol / öğrenci ekle',
      initial: { studentId: initialStudent },
      fields: () => [
        choice(
          'studentId',
          'Öğrenci',
          options(
            scope.students.filter(
              (s) =>
                state.classes.find((c) => c.id === s.classId)?.branchId ===
                present(record).branchId,
            ),
          ),
        ),
      ],
    })
  }
  if (command === 'club-leave')
    assignForm({
      title: 'Kulüp üyeliğini sonlandır',
      hint: 'Üyelik pasife alınır; geçmiş yoklama ve başarı kayıtları korunur.',
    })
  if (command === 'club-attendance') {
    const members = state.clubMemberships.filter(
      (m) => m.clubId === recordId && m.status === 'Aktif',
    )
    assignForm({
      title: 'Kulüp yoklaması al',
      initial: {
        date: today,
        marks: Object.fromEntries(members.map((m) => [m.studentId, 'Geldi'])),
      },
      fields: () => [
        field('date', 'Yoklama tarihi', 'date'),
        ...members.map((m) =>
          choice(
            `marks.${m.studentId}`,
            name(state, 'students', m.studentId),
            ['Geldi', 'Gelmedi', 'İzinli'].map((value) => ({ value, label: value })),
          ),
        ),
      ],
    })
  }
  if (command === 'achievement')
    assignForm({
      title: 'Proje / başarı kaydet',
      initial: {
        studentId: initialStudent,
        clubId: state.clubs[0]?.id || '',
        title: '',
        description: '',
        date: today,
      },
      fields: (values) => [
        choice(
          'clubId',
          'Kulüp',
          options(
            state.clubs.filter(
              (c) =>
                c.status === 'Aktif' &&
                (session.role !== 'ogretmen' || c.teacherId === teacherOf(state, session)),
            ),
            (c) => c.title,
          ),
        ),
        choice(
          'studentId',
          'Öğrenci',
          options(
            scope.students.filter((s) =>
              state.clubMemberships.some(
                (m) => m.clubId === values.clubId && m.studentId === s.id && m.status === 'Aktif',
              ),
            ),
          ),
        ),
        field('title', 'Proje / başarı başlığı'),
        field('description', 'Çalışma ve kazanımlar', 'textarea'),
        field('date', 'Tarih', 'date'),
      ],
    })
  if (command === 'club-archive')
    assignForm({
      title: 'Kulübü arşivle',
      hint: 'Aktif üyelikler sonlandırılır; yoklama, proje ve başarı geçmişi korunur.',
    })
  form.initial = { ...form.initial, ...overrides }
  return form
}
export function readFormValue(values: FormValues, key: string) {
  return key.startsWith('marks.') ? values.marks?.[key.slice(6)] : values[key]
}
export function changeFormValue(values: FormValues, key: string, value: unknown) {
  const next: FormValues = { ...values }
  if (key.startsWith('marks.')) next.marks = { ...values.marks, [key.slice(6)]: value }
  else next[key] = value
  if (key === 'grade') next.subjectIds = []
  if (key === 'studentId') next.targetClassId = ''
  if (key === 'routeId') next.stop = ''
  if (key === 'branchId') next.classId = ''
  return next
}
export function normalizeWorkflowInput(
  definition: { fields: (values: FormValues) => readonly { key: string; type: string }[] },
  values: FormValues,
) {
  const input: FormValues = { ...values }
  for (const field of definition.fields(values)) {
    // TODO(ts): datetime alanı formdan metin gelir; Date.parse ve Date kurucusu eski sürümdeki gibi değeri olduğu gibi alır.
    const value = input[field.key] as string
    if (field.type === 'datetime' && Number.isFinite(Date.parse(value)))
      input[field.key] = new Date(
        /^[0-9-]+T\d{2}:\d{2}$/.test(value) ? `${value}:00+03:00` : value,
      ).toISOString()
  }
  return input
}
