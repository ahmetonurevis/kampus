import {
  average,
  dateLabel,
  dayKey,
  homeworkStatus,
  invoiceStatus,
  money,
  slaLabel,
  slaStatus,
  timeLabel,
} from '@kampus/school-core/lib/format.ts'
import { navigation, roles } from '@kampus/school-core/modules/full-navigation.ts'
import { subjectsForGrade } from '@kampus/school-core/data/curriculum.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

type Elem<T> = T extends readonly (infer U)[] ? U : never
type Item<K extends keyof State> = Elem<State[K]>
// Adı olan koleksiyonlar (kampüs, sınıf, öğretmen, öğrenci, ders ...).
export type NamedCollection = {
  [K in keyof State]: [Item<K>] extends [never]
    ? never
    : Item<K> extends { id: string; name: string }
      ? K
      : never
}[keyof State]

// Liste satırının kaynağı: satır türüne göre ilgili kayıt.
type RowSources = {
  invoice: Item<'invoices'>
  contract: Item<'contracts'>
  branch: Item<'branches'>
  class: Item<'classes'>
  teacher: Item<'teachers'>
  prospect: Item<'prospects'>
  report: { id: string }
  student: Item<'students'>
  lesson: Item<'schedule'>
  grade: Item<'grades'>
  attendance: Item<'attendance'>
  question: Item<'questions'>
  homework: Item<'homework'>
  video: Item<'videos'>
  material: Item<'materials'>
  quiz: Item<'quizzes'>
  announcement: Item<'announcements'>
  appointment: Item<'appointments'>
  conversation: Item<'conversations'>
  request: Item<'requests'>
  absence: Item<'absences'>
  submission: Item<'submissions'>
}
export type RowKind = keyof RowSources
type RowOf<K extends RowKind> = {
  id: string
  title: string | undefined
  subtitle: string
  body: string
  status: string
  kind: K
  source: RowSources[K]
  meta: string[]
  subject: string
  class: string
  branch: string
}
export type Row<K extends RowKind = RowKind> = K extends RowKind ? RowOf<K> : never

// Sayfa yolundan satır türü; tanımsız sayfalar boş liste döner.
type PageKinds = {
  finans: 'invoice'
  'tahsilat-takip': 'invoice'
  odemelerim: 'invoice'
  'odeme-yap': 'invoice'
  dekontlar: 'invoice'
  sozlesmeler: 'contract'
  subeler: 'branch'
  classes: 'class'
  siniflarim: 'class'
  personel: 'teacher'
  'sla-raporu': 'teacher'
  adaylar: 'prospect'
  'deneme-dersi-takvimi': 'prospect'
  'kayit-raporlari': 'report'
  students: 'student'
  'risk-listesi': 'student'
  'ders-programi': 'lesson'
  notlarim: 'grade'
  devamsizlik: 'attendance'
  sorular: 'question'
  'soru-sor': 'question'
  odevler: 'homework'
  videolar: 'video'
  materyaller: 'material'
  'materyal-yukle': 'material'
  'soru-coz': 'quiz'
  'quiz-olustur': 'quiz'
  duyurular: 'announcement'
  randevular: 'appointment'
  'randevu-talep': 'appointment'
  'randevu-mesaj': 'appointment'
  mesajlar: 'conversation'
  talepler: 'request'
  'sikayet-talep': 'request'
  'devamsizlik-bildirimi': 'absence'
  'ogretmen-degerlendirmeleri': 'submission'
}
export type PageRow<P extends string> = Row<P extends keyof PageKinds ? PageKinds[P] : RowKind>

export { navigation, roles }
export const teacherId = 't1'
export const moduleNames = {
  academic: 'Akademik',
  finance: 'Finans',
  learning: 'Öğrenme',
  crm: 'Kayıt & Satış',
  communication: 'İletişim',
}
// Örnek veride tarih alanları dizi indeksinden gelir; tipi `string | undefined` kalır.
const byDate = (a: { date?: string }, b: { date?: string }) =>
  (a.date ?? '').localeCompare(b.date ?? '')
const isAnswered = <T extends { answeredAt?: string | null }>(
  question: T,
): question is T & { answeredAt: string } => Boolean(question.answeredAt)
// JSON kopyası kaydın tipini korur; okul verisi yalnızca JSON değerlerinden oluşur.
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function context(state: State, session: Session) {
  const studentId = session.role === 'veli' ? session.childId : 's1'
  const student = state.students.find((s) => s.id === studentId) || state.students[0]
  if (!student) throw new Error('Öğrenci kaydı bulunamadı.')
  // Ekranlar sınıf adını doğrudan okur; sınıfsız öğrenci tutarsız veridir.
  const classroom = state.classes.find((c) => c.id === student.classId)
  if (!classroom) throw new Error('Öğrencinin sınıf kaydı bulunamadı.')
  const assignedClasses = new Set<string>(),
    assignedTeachers = new Set<string>()
  for (const assignment of state.assignments) {
    if (assignment.teacherId === teacherId) assignedClasses.add(assignment.classId)
    if (assignment.classId === student.classId) assignedTeachers.add(assignment.teacherId)
  }
  const teacherClasses = state.classes.filter((c) => c.isActive && assignedClasses.has(c.id))
  const recipients = state.teachers.filter((t) => t.isActive && assignedTeachers.has(t.id))
  return {
    student,
    classroom,
    teacherClasses,
    recipients,
    teacher: session.role === 'ogretmen',
    institution: ['yonetici', 'onburo'].includes(session.role),
  }
}
export const nameOf = (state: State, collection: NamedCollection, id: string) => {
  const list: readonly { id: string; name: string }[] = state[collection]
  return list.find((item) => item.id === id)?.name || 'Kayıt bulunamadı'
}
export const gradeAverage = (state: State, id: string) =>
  average(state.grades.filter((g) => g.studentId === id).map((g) => g.score))
export const absentCount = (state: State, id: string) =>
  state.attendance.filter((a) => a.studentId === id && a.status === 'absent').length
// Telefonda gösterilmeyen sayfalar (web menüsünde bulunmaya devam eder).
const hiddenOnMobile: Partial<Record<Role, readonly string[]>> = { ogrenci: ['odemelerim'] }
export function availablePages(state: State, role: Role) {
  return (navigation[role] || []).filter(
    (p) => (!p.module || state.modules[p.module]) && !hiddenOnMobile[role]?.includes(p.path),
  )
}
export function rowsFor<P extends string>(
  state: State,
  session: Session,
  page: P,
  options?: { limit?: number; overdueOnly?: boolean },
): PageRow<P>[]
export function rowsFor(
  state: State,
  session: Session,
  page: string,
  { limit = Infinity, overdueOnly = false }: { limit?: number; overdueOnly?: boolean } = {},
): Row[] {
  const c = context(state, session)
  const today = dayKey()
  const names: Partial<Record<NamedCollection, Map<string, string>>> = {}
  const lookupName = (collection: NamedCollection, id: string | null | undefined) => {
    const list: readonly { id: string; name: string }[] = state[collection]
    const known = (names[collection] ||= new Map(list.map((item) => [item.id, item.name])))
    return (id == null ? undefined : known.get(id)) || 'Kayıt bulunamadı'
  }
  const own = (item: { teacherId?: string; studentId?: string }) =>
    c.teacher ? item.teacherId === teacherId : item.studentId === c.student.id
  const className = (id: string | null | undefined) => lookupName('classes', id)
  const studentName = (id: string | null | undefined) => lookupName('students', id)
  const teacherName = (id: string | null | undefined) => lookupName('teachers', id)
  const row = <K extends RowKind>(
    item: RowSources[K] & { subject?: string; classId?: string | null; branchId?: string },
    title: string | undefined,
    subtitle: string,
    body: string | undefined = '',
    status: string | undefined = '',
    kind: K,
  ): RowOf<K> => ({
    id: item.id,
    title,
    subtitle,
    body,
    status,
    kind,
    source: item,
    meta: [],
    subject: item.subject || '',
    class: className(item.classId),
    branch: item.branchId ? nameOf(state, 'branches', item.branchId) : '',
  })
  if (['finans', 'tahsilat-takip', 'odemelerim', 'odeme-yap', 'dekontlar'].includes(page)) {
    const invoices = []
    // Dashboard yalnızca üç kaydı gösterir; kalan binlerce satır hazırlanmamalı.
    for (const invoice of state.invoices) {
      if (invoices.length >= limit) break
      if (!c.institution && invoice.studentId !== c.student.id) continue
      if (page === 'dekontlar' && !invoice.paidAt) continue
      if (page === 'odeme-yap' && invoice.paidAt) continue
      if (overdueOnly && (invoice.paidAt || dayKey(invoice.dueDate) >= today)) continue
      invoices.push(invoice)
    }
    return invoices.map((i) =>
      row(
        i,
        money(i.amount),
        `${studentName(i.studentId)} · ${i.installment}. taksit`,
        `Vade: ${dateLabel(i.dueDate, { year: 'numeric' })}${i.paidAt ? '\nÖdeme: ' + dateLabel(i.paidAt) + ' · ' + i.method : ''}`,
        invoiceStatus(i, today),
        'invoice',
      ),
    )
  }
  if (page === 'sozlesmeler')
    return state.contracts
      .filter(own)
      .map((i) =>
        row(
          i,
          i.title,
          studentName(i.studentId),
          `${dateLabel(i.date, { year: 'numeric' })} · ${money(i.amount)}`,
          'İmzalandı',
          'contract',
        ),
      )
  if (page === 'subeler')
    return state.branches.map((i) =>
      row(
        i,
        i.name,
        i.address,
        `${state.classes.filter((x) => x.branchId === i.id && x.isActive).length} sınıf · ${state.teachers.filter((x) => x.branchId === i.id && x.isActive).length} öğretmen`,
        i.isActive ? 'Aktif' : 'Arşiv',
        'branch',
      ),
    )
  if (page === 'classes')
    return state.classes
      .filter((i) => !c.teacher || c.teacherClasses.some((own) => own.id === i.id))
      .map((i) =>
        row(
          i,
          i.name,
          `${nameOf(state, 'branches', i.branchId)} · ${i.level}`,
          `${state.students.filter((s) => s.classId === i.id && s.isActive).length} / ${i.capacity} öğrenci · Derslik ${i.room}`,
          i.isActive ? 'Aktif' : 'Arşiv',
          'class',
        ),
      )
  if (page === 'personel' || page === 'sla-raporu')
    return state.teachers.map((i) => {
      const questions = state.questions.filter((q) => q.teacherId === i.id)
      const breaches = questions.filter((q) =>
        q.answeredAt
          ? +new Date(q.answeredAt) - +new Date(q.createdAt) > 86400000
          : slaStatus(q) === 'Süre aşıldı',
      ).length
      const answered = questions.filter(isAnswered)
      return row(
        i,
        i.name,
        `${i.subject} · ${nameOf(state, 'branches', i.branchId)}`,
        page === 'sla-raporu'
          ? `${questions.filter((q) => !q.answeredAt).length} yanıt bekliyor · ${breaches} ihlal\n${answered.length ? average(answered.map((q) => (+new Date(q.answeredAt) - +new Date(q.createdAt)) / 3600000)) + ' saat ortalama yanıt' : 'Henüz yanıt yok'}`
          : `Yoklama %${i.attendanceRate} · Ödev takibi %${i.homeworkRate}`,
        !i.isActive ? 'Arşiv' : breaches ? 'Süre aşıldı' : 'Aktif',
        'teacher',
      )
    })
  if (page === 'adaylar' || page === 'deneme-dersi-takvimi')
    return state.prospects
      .filter((i) => page === 'adaylar' || i.trialAt)
      .map((i) =>
        row(
          i,
          i.name,
          `${i.interest} · ${nameOf(state, 'branches', i.branchId)}`,
          page === 'adaylar'
            ? `${i.phone}\n${i.notes.at(-1)?.text || ''}`
            : `${dateLabel(i.trialAt)} · ${i.trialAt ? timeLabel(i.trialAt) : ''}\n${i.notes.at(-1)?.text || ''}`,
          i.stage,
          'prospect',
        ),
      )
  if (page === 'kayit-raporlari')
    return [...new Set(state.prospects.map((i) => i.source))].map((source) => {
      const list = state.prospects.filter((i) => i.source === source)
      const count = list.filter((i) => i.stage === 'Kayıt oldu').length
      return row(
        { id: source ?? '' },
        source,
        `${list.length} aday · ${count} kesin kayıt`,
        `Dönüşüm oranı %${Math.round((count / list.length) * 100)}`,
        '',
        'report',
      )
    })
  if (page === 'siniflarim')
    return c.teacherClasses.map((i) =>
      row(
        i,
        i.name,
        `${nameOf(state, 'branches', i.branchId)} · ${i.level}`,
        `${state.students.filter((s) => s.classId === i.id && s.isActive).length} öğrenci · Derslik ${i.room}`,
        'Aktif',
        'class',
      ),
    )
  if (page === 'students' || page === 'risk-listesi') {
    const scores = new Map<string, { sum: number; count: number }>(),
      absences = new Map<string, number>()
    for (const grade of state.grades) {
      const total = scores.get(grade.studentId) || { sum: 0, count: 0 }
      total.sum += grade.score
      total.count++
      scores.set(grade.studentId, total)
    }
    for (const mark of state.attendance) {
      if (mark.status === 'absent')
        absences.set(mark.studentId, (absences.get(mark.studentId) || 0) + 1)
    }
    const averageFor = (id: string) => {
      const total = scores.get(id)
      return total ? Math.round(total.sum / total.count) : 0
    }
    const absentFor = (id: string) => absences.get(id) || 0
    return state.students
      .filter(
        (s) =>
          s.isActive &&
          (!c.teacher || c.teacherClasses.some((x) => x.id === s.classId)) &&
          (page !== 'risk-listesi' || absentFor(s.id) >= 6 || averageFor(s.id) < 65),
      )
      .map((i) =>
        row(
          i,
          i.name,
          `${className(i.classId)} · No: ${i.number || 'Yeni kayıt'}`,
          `Ortalama ${averageFor(i.id)} · ${absentFor(i.id)} gün devamsızlık`,
          page === 'risk-listesi'
            ? absentFor(i.id) >= 8 || averageFor(i.id) < 55
              ? 'Yüksek risk'
              : 'Takip önerilir'
            : '',
          'student',
        ),
      )
  }
  if (page === 'ders-programi')
    return state.schedule
      .filter((l) => (c.teacher ? l.teacherId === teacherId : l.classId === c.student.classId))
      .sort((a, b) => byDate(a, b))
      .map((i) =>
        row(
          i,
          i.title,
          `${dateLabel(i.date, { weekday: 'short' })} · ${timeLabel(i.date)} · ${i.duration} dk`,
          `${className(i.classId)} · Derslik ${i.room}\n${teacherName(i.teacherId)}`,
          '',
          'lesson',
        ),
      )
  if (page === 'notlarim')
    return state.grades
      .filter(own)
      .sort((a, b) => byDate(b, a))
      .map((i) =>
        row(
          i,
          i.title,
          `${dateLabel(i.date)} · ${i.topic}`,
          `${i.score} / 100`,
          i.score >= 70 ? 'Başarılı' : 'Tekrar önerilir',
          'grade',
        ),
      )
  if (page === 'devamsizlik')
    return state.attendance
      .filter(own)
      .sort((a, b) => byDate(b, a))
      .map((i) =>
        row(
          i,
          dateLabel(i.date, { weekday: 'long', year: 'numeric' }),
          className(i.classId),
          i.reason,
          { present: 'Geldi', absent: 'Gelmedi', late: 'Geç geldi', excused: 'Mazeretli' }[
            i.status
          ],
          'attendance',
        ),
      )
  if (['sorular', 'soru-sor'].includes(page))
    return state.questions
      .filter(own)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((i) =>
        row(
          i,
          i.title,
          `${c.teacher ? studentName(i.studentId) : teacherName(i.teacherId)} · ${slaLabel(i)}`,
          i.text,
          slaStatus(i),
          'question',
        ),
      )
  if (page === 'odevler')
    return state.homework
      .filter((i) => (c.teacher ? i.teacherId === teacherId : i.classId === c.student.classId))
      .map((i) =>
        row(
          i,
          i.title,
          `${className(i.classId)} · Son teslim ${dateLabel(i.dueDate)}`,
          i.description,
          c.teacher
            ? `${state.submissions.filter((s) => s.homeworkId === i.id && s.score == null).length} değerlendirme bekliyor`
            : homeworkStatus(i, state.submissions, c.student.id),
          'homework',
        ),
      )
  if (page === 'videolar')
    return state.videos.map((i) => {
      const progress =
        state.videoProgress.find((p) => p.videoId === i.id && p.studentId === c.student.id)
          ?.progress || 0
      return row(
        i,
        i.title,
        `${i.subject} · ${i.level}`,
        i.description,
        progress >= 95 ? 'Tamamlandı' : progress ? `%${progress} izlendi` : 'Başlanmadı',
        'video',
      )
    })
  if (page === 'materyaller' || page === 'materyal-yukle')
    return state.materials
      .filter((i) => {
        if (c.teacher) return i.teacherId === teacherId
        return i.level === c.classroom.level
      })
      .map((i) =>
        row(
          i,
          i.title,
          `${i.subject} · ${i.level}`,
          `${i.fileName} · ${dateLabel(i.createdAt)}`,
          'Doküman',
          'material',
        ),
      )
  if (page === 'soru-coz' || page === 'quiz-olustur')
    return state.quizzes
      .filter((i) => (c.teacher ? i.teacherId === teacherId : i.classId === c.student.classId))
      .map((i) => {
        const result = state.quizAttempts
          .filter((a) => a.quizId === i.id && a.studentId === c.student.id)
          .at(-1)
        return row(
          i,
          i.title,
          `${i.questionIds.length} soru · ${i.duration} dakika`,
          `${className(i.classId)} · ${teacherName(i.teacherId)}`,
          result ? `Son sonuç: ${result.score}` : 'Hazır',
          'quiz',
        )
      })
  if (page === 'duyurular')
    return state.announcements
      .filter((a) => !a.classId || a.classId === c.student.classId)
      .map((i) =>
        row(
          i,
          i.title,
          `${dateLabel(i.date)} · ${i.classId ? 'Sınıfa özel' : 'Genel duyuru'}`,
          i.text,
          i.category,
          'announcement',
        ),
      )
  if (['randevular', 'randevu-talep', 'randevu-mesaj'].includes(page))
    return state.appointments
      .filter(own)
      .sort((a, b) => byDate(b, a))
      .map((i) =>
        row(
          i,
          i.type,
          `${dateLabel(i.date)} · ${timeLabel(i.date)}`,
          `${c.teacher ? studentName(i.studentId) : teacherName(i.teacherId)}\n${i.note}`,
          i.status,
          'appointment',
        ),
      )
  if (page === 'mesajlar') {
    // Mesajlar ayrı koleksiyondadır; son mesaj yazışma başına bir kez indekslenir.
    const lastMessage = new Map<string, State['conversationMessages'][number]>()
    for (const message of state.conversationMessages)
      lastMessage.set(message.conversationId, message)
    return state.conversations
      .filter((i) =>
        c.teacher
          ? i.teacherId === teacherId
          : i.studentId === c.student.id &&
            i.audience === (session.role === 'veli' ? 'parent' : 'student'),
      )
      .map((i) =>
        row(
          i,
          c.teacher
            ? studentName(i.studentId) + (i.audience === 'parent' ? ' · Velisi' : '')
            : teacherName(i.teacherId),
          dateLabel(lastMessage.get(i.id)?.date),
          lastMessage.get(i.id)?.text,
          '',
          'conversation',
        ),
      )
  }
  if (page === 'talepler' || page === 'sikayet-talep')
    return state.requests
      .filter((i) => session.role === 'onburo' || own(i))
      .map((i) =>
        row(i, i.title, `${studentName(i.studentId)} · ${i.category}`, i.text, i.status, 'request'),
      )
  if (page === 'devamsizlik-bildirimi')
    return state.absences
      .filter(own)
      .map((i) =>
        row(
          i,
          `${dateLabel(i.startDate)} – ${dateLabel(i.endDate)}`,
          i.category,
          i.reason,
          'Bildirildi',
          'absence',
        ),
      )
  if (page === 'ogretmen-degerlendirmeleri')
    return state.submissions
      .filter((i) => i.studentId === c.student.id && i.feedback)
      .map((i) => {
        const h = state.homework.find((h) => h.id === i.homeworkId)
        if (!h) throw new Error('Ödev kaydı bulunamadı.')
        return row(
          i,
          h.title,
          teacherName(h.teacherId),
          i.feedback,
          `${i.score} / 100`,
          'submission',
        )
      })
  return []
}

type Stat = { label: string; value: string | number }
export function dashboard(state: State, session: Session): Stat[] {
  const c = context(state, session)
  if (session.role === 'yonetici') {
    const month = dayKey().slice(0, 7)
    const paid = state.invoices.filter((i) => i.paidAt && dayKey(i.paidAt).slice(0, 7) === month)
    return [
      { label: 'Aktif öğrenci', value: state.students.filter((s) => s.isActive).length },
      { label: 'Bu ay tahsilat', value: money(paid.reduce((sum, i) => sum + i.amount, 0)) },
      { label: 'Aktif kampüs', value: state.branches.filter((b) => b.isActive).length },
      {
        label: 'SLA ihlali',
        value: state.questions.filter((q) => slaStatus(q) === 'Süre aşıldı').length,
      },
    ]
  }
  if (session.role === 'onburo')
    return [
      { label: 'Aday öğrenci', value: state.prospects.filter((p) => !p.studentId).length },
      {
        label: 'Bu ay kayıt',
        value: state.students.filter((s) => dayKey(s.joinedAt).slice(0, 7) === dayKey().slice(0, 7))
          .length,
      },
      {
        label: 'Bugün görüşme',
        value: state.prospects.filter((p) => p.trialAt && dayKey(p.trialAt) === dayKey()).length,
      },
      { label: 'Açık talep', value: state.requests.filter((r) => r.status !== 'Çözüldü').length },
    ]
  if (c.teacher)
    return [
      { label: 'Sınıflarım', value: c.teacherClasses.length },
      {
        label: 'Bugün ders',
        value: state.schedule.filter(
          (s) => s.teacherId === teacherId && dayKey(s.date) === dayKey(),
        ).length,
      },
      {
        label: 'Yanıt bekleyen',
        value: state.questions.filter((q) => q.teacherId === teacherId && !q.answeredAt).length,
      },
      {
        label: 'Değerlendirilecek',
        value: state.submissions.filter(
          (s) =>
            s.score == null &&
            state.homework.some((h) => h.id === s.homeworkId && h.teacherId === teacherId),
        ).length,
      },
    ]
  return [
    { label: 'Not ortalaması', value: gradeAverage(state, c.student.id) },
    { label: 'Devamsızlık', value: `${absentCount(state, c.student.id)} gün` },
    {
      label: 'Bekleyen ödev',
      value: state.homework.filter(
        (h) =>
          h.classId === c.student.classId &&
          !state.submissions.some((s) => s.homeworkId === h.id && s.studentId === c.student.id),
      ).length,
    },
    {
      label: session.role === 'veli' ? 'Güncel bakiye' : 'Son quiz',
      value:
        session.role === 'veli'
          ? money(
              state.invoices
                .filter((i) => i.studentId === c.student.id && !i.paidAt)
                .reduce((s, i) => s + i.amount, 0),
            )
          : `${state.quizAttempts.filter((a) => a.studentId === c.student.id).at(-1)?.score ?? '—'} / 100`,
    },
  ]
}
export function analysis(state: State, session: Session, classId: string, subjectId?: string) {
  const c = context(state, session)
  const students = c.teacher ? state.students.filter((s) => s.classId === classId) : [c.student]
  const grades = state.grades.filter(
    (g) => students.some((s) => s.id === g.studentId) && (!subjectId || g.subjectId === subjectId),
  )
  const names = [...new Set(grades.map((g) => (subjectId ? g.topic : g.subject)))]
  return names.map((title) => ({
    title,
    score: average(
      grades.filter((g) => (subjectId ? g.topic : g.subject) === title).map((g) => g.score),
    ),
  }))
}
export function classSubjects(state: State, id: string) {
  return subjectsForGrade(state.classes.find((c) => c.id === id)?.grade || 7)
}

export function homeSummary(data: State, session: Session) {
  const scope = context(data, session)
  const stats = dashboard(data, session)
  const now = Date.now()
  const lessons = scope.institution
    ? []
    : rowsFor(data, session, 'ders-programi')
        .filter((r) => +new Date(r.source.date) + r.source.duration * 60000 > now)
        .slice(0, 3)
  const important =
    session.role === 'yonetici'
      ? rowsFor(data, session, 'finans', { limit: 3, overdueOnly: true })
      : session.role === 'onburo'
        ? rowsFor(data, session, 'adaylar')
            .filter((r) => r.status === 'Görüşme planlandı')
            .slice(0, 3)
        : scope.teacher
          ? rowsFor(data, session, 'sorular')
              .filter((r) => !r.source.answeredAt)
              .slice(0, 3)
          : rowsFor(data, session, 'odevler')
              .filter((r) => ['Bekliyor', 'Gecikmiş'].includes(r.status))
              .slice(0, 3)
  const trend =
    session.role !== 'yonetici' || !data.modules.finance
      ? []
      : Array.from({ length: 6 }, (_, i) => {
          const d = new Date()
          d.setUTCDate(1)
          d.setUTCMonth(d.getUTCMonth() - 5 + i)
          const key = d.toISOString().slice(0, 7)
          return data.invoices
            .filter((inv) => inv.paidAt?.slice(0, 7) === key)
            .reduce((sum, inv) => sum + inv.amount, 0)
        })
  return { scope, stats, lessons, important, trend }
}
