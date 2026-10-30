import { z } from 'zod'
import { subjects, subjectsForGrade } from '@kampus/school-core/data/curriculum.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  requiredText,
  prospectSchema,
  enrollProspect,
  payInvoice,
  type MakeId,
  type Session,
} from '@kampus/school-core/lib/domain.ts'
import type { DocumentType } from '@kampus/school-core/lib/document-data.ts'
import { dayKey, dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  saveBranch,
  saveTeacher,
  saveClass,
  archiveRecord,
  restoreRecord,
  type ArchiveKind,
} from '@kampus/school-core/lib/school-management.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'
import { context, nameOf, teacherId, type Row } from './school.ts'

export type OperationKind =
  | 'branch'
  | 'teacher'
  | 'class'
  | 'archive'
  | 'restore'
  | 'prospect'
  | 'note'
  | 'trial'
  | 'registration'
  | 'collect'
  | 'remind'
  | 'question'
  | 'answer'
  | 'homework'
  | 'submit'
  | 'grade'
  | 'material'
  | 'quiz'
  | 'appointment'
  | 'slot'
  | 'appointment-status'
  | 'message'
  | 'request'
  | 'request-status'
  | 'absence'

// Form değerleri kullanıcıdan ve taslak depodan gelir; bu yüzden kullanılmadan önce daraltılır.
export type FormValues = Record<string, unknown>
export type PickedFile = { name: string; size?: number; uri: string }
export type FieldOption = { value: string; label: string }
type FieldBase = {
  key: string
  label: string
  required: boolean
  multiline?: boolean
  keyboard?: 'email-address' | 'phone-pad' | 'number-pad'
  hint?: string
}
export type FormField =
  | (FieldBase & { type: 'text' | 'date' | 'time' | 'file' })
  | (FieldBase & { type: 'select' | 'multi'; options: FieldOption[] })
// İşlem yapılan kayıt; işleme göre ilgili alanlar dolu gelir (ör. arşivde `kind`).
export type OperationRecord = {
  id: string
  kind?: ArchiveKind
  [field: string]: unknown
}
export type OperationDefinition = {
  title: string
  fields: (values: FormValues) => FormField[]
  initial: FormValues
  run: (state: State, values: FormValues, makeId: MakeId) => void
}

export const str = (value: unknown) => (typeof value === 'string' ? value : '')
const isPickedFile = (value: unknown): value is PickedFile =>
  typeof value === 'object' &&
  value !== null &&
  'uri' in value &&
  typeof value.uri === 'string' &&
  'name' in value &&
  typeof value.name === 'string'
export const pickedFile = (value: unknown) => (isPickedFile(value) ? value : undefined)
// Kayıt bulunamazsa işlem anlaşılır bir hatayla durur.
const found = <T>(item: T | undefined, message: string): T => {
  if (item === undefined) throw new Error(message)
  return item
}
export const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

type TextExtra = Partial<Pick<FieldBase, 'required' | 'multiline' | 'keyboard' | 'hint'>> & {
  type?: 'text' | 'date' | 'time' | 'file'
}
const text = (key: string, label: string, extra: TextExtra = {}): FormField => ({
  key,
  label,
  type: 'text',
  required: true,
  ...extra,
})
const select = (
  key: string,
  label: string,
  options: FieldOption[],
  extra: Partial<Pick<FieldBase, 'required' | 'hint'>> = {},
): FormField => ({ key, label, type: 'select', required: true, options, ...extra })
const options = (list: readonly { id: string; name: string }[]) =>
  list.map((i) => ({ value: i.id, label: i.name }))
const enumOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }))
const active = <T extends { isActive: boolean }>(list: readonly T[]) =>
  list.filter((i) => i.isActive)
const at = (values: { date?: unknown; time?: unknown }) => {
  const day = str(values.date),
    time = str(values.time) || '09:00'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error('Geçerli tarih ve saat girin.')
  const date = new Date(`${day}T${time}:00+03:00`)
  if (Number.isNaN(+date) || dayKey(date) !== day) throw new Error('Geçerli bir tarih seçin.')
  return date.toISOString()
}
const future = (values: { date?: unknown; time?: unknown }) => {
  const date = at(values)
  if (+new Date(date) <= Date.now()) throw new Error('Gelecek bir tarih seçin.')
  return date
}
export const normalizeFields = (fields: readonly FormField[], values: FormValues) => {
  for (const field of fields) {
    const value = values[field.key]
    if (field.required && (value == null || String(value).trim() === ''))
      throw new Error(`${field.label} alanını doldurun.`)
    if (field.type === 'select' && value && !field.options.some((o) => o.value === value))
      throw new Error(`${field.label} için geçerli bir seçim yapın.`)
  }
  return values
}
const archiveCollections = { branch: 'branches', class: 'classes', teacher: 'teachers' } as const

export function operation(
  state: State,
  session: Session,
  kind: OperationKind,
  record: OperationRecord | null = null,
): OperationDefinition {
  const c = context(state, session)
  // Kayıt gerektiren işlemlerde kayıt verilmediyse işlem çalışırken hata verilir.
  const need = (): OperationRecord => {
    if (!record) throw new Error('İşlem için kayıt bulunamadı.')
    return record
  }
  const allowed: Record<OperationKind, readonly Role[]> = {
    branch: ['yonetici'],
    teacher: ['yonetici'],
    class: ['yonetici'],
    archive: ['yonetici'],
    restore: ['yonetici'],
    prospect: ['onburo'],
    note: ['onburo'],
    trial: ['onburo'],
    registration: ['onburo'],
    collect: ['yonetici', 'onburo', 'veli'],
    remind: ['yonetici', 'onburo'],
    question: ['ogrenci'],
    answer: ['ogretmen'],
    homework: ['ogretmen'],
    submit: ['ogrenci'],
    grade: ['ogretmen'],
    material: ['ogretmen'],
    quiz: ['ogretmen'],
    appointment: ['ogrenci', 'veli'],
    slot: ['ogretmen'],
    'appointment-status': ['ogretmen'],
    message: ['ogrenci', 'veli'],
    request: ['veli'],
    'request-status': ['onburo'],
    absence: ['veli'],
  }
  if (!allowed[kind]?.includes(session.role))
    throw new Error('Bu işlem seçili rol için kullanılamaz.')
  if (kind === 'collect' && session.role === 'veli' && record?.studentId !== c.student.id)
    throw new Error('Bu ödeme seçili çocuğunuza ait değil.')
  const now = () => new Date().toISOString()
  const ownClasses = c.teacher ? c.teacherClasses : active(state.classes)
  const branchOptions = options(active(state.branches))
  const teacherOptions = options(
    c.teacher ? state.teachers.filter((t) => t.id === teacherId) : c.recipients,
  )
  const config = (
    title: string,
    fields: FormField[] | ((values: FormValues) => FormField[]),
    initial: FormValues,
    run: OperationDefinition['run'],
  ): OperationDefinition => ({
    title,
    fields: typeof fields === 'function' ? fields : () => fields,
    initial,
    run,
  })
  if (kind === 'branch')
    return config(
      record ? 'Kampüsü düzenle' : 'Kampüs ekle',
      [text('name', 'Kampüs adı'), text('address', 'Adres', { multiline: true })],
      record || {},
      (s, v, id) => saveBranch(s, v, id, record?.id),
    )
  if (kind === 'teacher')
    return config(
      record ? 'Öğretmeni düzenle' : 'Öğretmen ekle',
      [
        text('name', 'Ad soyad'),
        text('email', 'E-posta', { keyboard: 'email-address' }),
        text('phone', 'Telefon', { keyboard: 'phone-pad' }),
        select('subjectId', 'Branş', options(subjects)),
        select('branchId', 'Kampüs', branchOptions),
      ],
      record || { branchId: branchOptions[0]?.value, subjectId: 'math' },
      (s, v, id) => saveTeacher(s, v, id, record?.id),
    )
  if (kind === 'class')
    return config(
      record ? 'Sınıfı düzenle' : 'Sınıf ekle',
      (v) => [
        select('grade', 'Sınıf düzeyi', enumOptions([5, 6, 7, 8, 9, 10, 11, 12].map(String))),
        text('section', 'Şube harfi'),
        select('branchId', 'Kampüs', branchOptions),
        text('capacity', 'Kontenjan', { keyboard: 'number-pad' }),
        text('room', 'Derslik'),
        select('teacherId', 'Sınıf danışmanı', options(active(state.teachers))),
        ...subjectsForGrade(Number(v.grade || 7)).map((subject) =>
          select(
            `assignment_${subject.id}`,
            `${subject.name} öğretmeni`,
            options(active(state.teachers).filter((t) => t.subjectId === subject.id)),
          ),
        ),
      ],
      {
        section: 'D',
        capacity: '24',
        room: '401',
        branchId: branchOptions[0]?.value,
        teacherId: 't1',
        ...record,
        grade: String(record?.grade || 7),
        ...Object.fromEntries(
          subjects.map((subject) => [
            `assignment_${subject.id}`,
            state.assignments.find((a) => a.classId === record?.id && a.subjectId === subject.id)
              ?.teacherId ||
              state.teachers.find(
                (t) =>
                  t.isActive &&
                  t.subjectId === subject.id &&
                  t.branchId === (record?.branchId || 'b1'),
              )?.id,
          ]),
        ),
      },
      (s, v, id) =>
        saveClass(
          s,
          v,
          Object.fromEntries(
            subjects.map((subject) => [subject.id, str(v[`assignment_${subject.id}`])]),
          ),
          id,
          record?.id,
        ),
    )
  if (kind === 'archive') {
    const archived = need()
    if (!archived.kind) throw new Error('Kayıt türü geçersiz.')
    const archiveKind = archived.kind
    const collection = archiveCollections[archiveKind]
    const pool: readonly {
      id: string
      name: string
      isActive: boolean
      subjectId?: string
      grade?: number
    }[] = state[collection]
    const targets = active(pool).filter(
      (i) =>
        i.id !== archived.id &&
        (archived.kind !== 'teacher' || i.subjectId === archived.subjectId) &&
        (archived.kind !== 'class' || i.grade === archived.grade),
    )
    return config(
      'Arşivle ve kayıtları aktar',
      [
        select('replacementId', 'Aktarım hedefi', options(targets), {
          required: false,
          hint: 'Bağlı kayıtlar varsa uygun bir hedef seçin. Geçmiş veriler korunur.',
        }),
      ],
      {},
      (s, v) => archiveRecord(s, archiveKind, archived.id, str(v.replacementId)),
    )
  }
  if (kind === 'restore')
    return config('Kaydı geri al', [], {}, (s) => {
      const target = need()
      if (!target.kind) throw new Error('Kayıt türü geçersiz.')
      restoreRecord(s, target.kind, target.id)
    })
  if (kind === 'prospect')
    return config(
      'Aday öğrenci ekle',
      [
        text('name', 'Ad soyad'),
        text('phone', 'Telefon', { keyboard: 'phone-pad' }),
        text('email', 'E-posta', { keyboard: 'email-address' }),
        select('branchId', 'Kampüs', branchOptions),
        select(
          'interest',
          'İlgilendiği sınıf',
          enumOptions([5, 6, 7, 8, 9, 10, 11, 12].map((n) => `${n}. Sınıf`)),
        ),
        select(
          'source',
          'Başvuru kaynağı',
          enumOptions([
            'Web sitesi',
            'Veli referansı',
            'Kampüs ziyareti',
            'Telefon',
            'Bursluluk sınavı',
          ]),
        ),
      ],
      { branchId: branchOptions[0]?.value, interest: '7. Sınıf', source: 'Telefon' },
      (s, v, id) => {
        const data = prospectSchema.parse(v)
        s.prospects.unshift({
          ...data,
          id: id('pr'),
          createdAt: now(),
          stage: 'Yeni aday',
          studentId: null,
          trialAt: null,
          notes: [],
        })
      },
    )
  if (kind === 'note')
    return config(
      'Görüşme notu',
      [
        text('text', 'Görüşme notu', { multiline: true }),
        select(
          'stage',
          'Aday aşaması',
          enumOptions([
            'Yeni aday',
            'İletişime geçildi',
            'Görüşme planlandı',
            'Teklif verildi',
            'Vazgeçti',
          ]),
        ),
      ],
      { stage: need().stage === 'Kayıt oldu' ? 'İletişime geçildi' : need().stage },
      (s, v, id) => {
        const p = found(
          s.prospects.find((i) => i.id === need().id),
          'Aday bulunamadı.',
        )
        p.notes.unshift({
          id: id('note'),
          text: requiredText.parse(v.text),
          date: now(),
          author: 'Büşra Aydın',
        })
        if (!p.studentId) p.stage = str(v.stage)
      },
    )
  if (kind === 'trial')
    return config(
      'Tanışma görüşmesi planla',
      [
        select('prospectId', 'Aday öğrenci', options(state.prospects.filter((p) => !p.studentId))),
        text('date', 'Görüşme tarihi', { type: 'date' }),
        text('time', 'Saat', { type: 'time' }),
      ],
      { prospectId: record?.id, date: dayKey(new Date(Date.now() + 86400000)), time: '14:00' },
      (s, v) => {
        const p = s.prospects.find((i) => i.id === v.prospectId && !i.studentId)
        if (!p) throw new Error('Aktif bir aday seçin.')
        p.trialAt = future(v)
        p.stage = 'Görüşme planlandı'
      },
    )
  if (kind === 'registration')
    return config(
      'Kesin kayıt',
      [
        select('prospectId', 'Aday öğrenci', options(state.prospects.filter((p) => !p.studentId))),
        select(
          'classId',
          'Sınıf',
          options(
            active(state.classes).map((i) => ({
              ...i,
              name: `${i.name} · ${nameOf(state, 'branches', i.branchId)}`,
            })),
          ),
        ),
        text('total', 'Toplam eğitim bedeli (₺)', { keyboard: 'number-pad' }),
        select(
          'count',
          'Taksit sayısı',
          enumOptions(Array.from({ length: 12 }, (_, i) => String(i + 1))),
        ),
        text('startDate', 'İlk taksit tarihi', { type: 'date' }),
      ],
      { prospectId: record?.id, classId: 'c1', total: '240000', count: '8', startDate: dayKey() },
      (s, v, id) => enrollProspect(s, v, id),
    )
  if (kind === 'collect')
    return config(
      c.institution ? 'Tahsilat kaydet' : 'Demo ödemeyi tamamla',
      [
        select(
          'method',
          'Ödeme yöntemi',
          enumOptions(
            c.institution ? ['Nakit', 'Banka havalesi', 'Kredi kartı'] : ['Kredi kartı (demo)'],
          ),
        ),
        text('note', 'Açıklama', {
          required: false,
          hint: 'Gerçek para çekilmez. Kart bilgisi girmeniz gerekmez.',
        }),
      ],
      { method: c.institution ? 'Nakit' : 'Kredi kartı (demo)' },
      (s, v) => {
        if (session.role === 'ogrenci') throw new Error('Ödeme işlemi için veli hesabını kullanın.')
        payInvoice(s, need().id, str(v.method))
      },
    )
  if (kind === 'remind')
    return config('Ödeme hatırlatması', [], {}, (s) => {
      const invoice = found(
        s.invoices.find((i) => i.id === need().id),
        'Taksit bulunamadı.',
      )
      if (invoice.paidAt) throw new Error('Ödenmiş taksit için hatırlatma gerekmez.')
      invoice.reminderAt = now()
    })
  if (kind === 'question')
    return config(
      'Öğretmenine sor',
      () => [
        select('teacherId', 'Branş öğretmeni', teacherOptions),
        text('title', 'Soru başlığı'),
        text('text', 'Sorunuzu açıklayın', { multiline: true }),
        text('file', 'Soru görseli / dosyası', { type: 'file', required: false }),
      ],
      { teacherId: teacherOptions[0]?.value },
      (s, v, id) => {
        const teacher = c.recipients.find((t) => t.id === v.teacherId)
        if (!teacher) throw new Error('Dersinize giren bir öğretmen seçin.')
        const file = pickedFile(v.file)
        // Telefon, soruya yüklenen dosyanın yolunu da saklar; ortak tipte bu alan yoktur.
        const asked = {
          id: id('ask'),
          studentId: c.student.id,
          teacherId: teacher.id,
          subjectId: teacher.subjectId,
          title: requiredText.parse(v.title),
          text: requiredText.parse(v.text),
          createdAt: now(),
          answeredAt: null,
          answer: '',
          fileName: file?.name || null,
          fileUri: file?.uri || null,
        }
        s.questions.unshift(asked)
      },
    )
  if (kind === 'answer')
    return config(
      'Soruyu yanıtla',
      [text('answer', 'Yanıtınız', { multiline: true })],
      { answer: need().answer },
      (s, v) => {
        const q = s.questions.find((i) => i.id === need().id && i.teacherId === teacherId)
        if (!q) throw new Error('Soru bulunamadı.')
        q.answer = requiredText.parse(v.answer)
        q.answeredAt = now()
      },
    )
  if (kind === 'homework')
    return config(
      'Ödev ata',
      [
        select('classId', 'Sınıf', options(ownClasses)),
        text('title', 'Ödev başlığı'),
        text('description', 'Açıklama', { multiline: true }),
        text('date', 'Son teslim tarihi', { type: 'date' }),
      ],
      { classId: ownClasses[0]?.id, date: dayKey(new Date(Date.now() + 7 * 86400000)) },
      (s, v, id) => {
        if (!ownClasses.some((i) => i.id === v.classId)) throw new Error('Kendi sınıfınızı seçin.')
        const teacher = found(
          s.teachers.find((t) => t.id === teacherId),
          'Öğretmen kaydı bulunamadı.',
        )
        s.homework.unshift({
          id: id('hw'),
          classId: str(v.classId),
          teacherId,
          subjectId: teacher.subjectId,
          subject: teacher.subject,
          title: requiredText.parse(v.title),
          description: requiredText.parse(v.description),
          dueDate: future({ ...v, time: '23:59' }),
          createdAt: now(),
        })
      },
    )
  if (kind === 'submit')
    return config(
      'Ödevini teslim et',
      [
        text('file', 'Ödev dosyası', { type: 'file' }),
        text('note', 'Öğretmene not', { multiline: true, required: false }),
      ],
      {},
      (s, v, id) => {
        if (need().classId !== c.student.classId) throw new Error('Ödev sınıfınıza ait değil.')
        const file = pickedFile(v.file)
        if (!file?.uri) throw new Error('Bir dosya seçin.')
        const existing = s.submissions.find(
          (i) => i.homeworkId === need().id && i.studentId === c.student.id,
        )
        if (existing?.score != null) throw new Error('Değerlendirilen ödev tekrar teslim edilemez.')
        const payload = {
          homeworkId: need().id,
          studentId: c.student.id,
          fileName: file.name,
          fileUri: file.uri,
          note: str(v.note) || '',
          submittedAt: now(),
          score: null,
          feedback: '',
        }
        if (existing) Object.assign(existing, payload)
        else s.submissions.push({ id: id('sub'), ...payload })
      },
    )
  if (kind === 'grade')
    return config(
      'Ödevi değerlendir',
      [
        text('score', 'Puan (0–100)', { keyboard: 'number-pad' }),
        text('feedback', 'Öğrenciye geri bildirim', { multiline: true }),
      ],
      { score: need().score == null ? '' : String(need().score), feedback: need().feedback },
      (s, v) => {
        const score = z.coerce
          .number({ error: 'Geçerli bir puan girin.' })
          .min(0, 'Puan 0 ile 100 arasında olmalıdır.')
          .max(100, 'Puan 0 ile 100 arasında olmalıdır.')
          .parse(v.score)
        const submission = found(
          s.submissions.find((i) => i.id === need().id),
          'Teslim kaydı bulunamadı.',
        )
        if (!s.homework.some((h) => h.id === submission.homeworkId && h.teacherId === teacherId))
          throw new Error('Ödev size ait değil.')
        submission.score = score
        submission.feedback = requiredText.parse(v.feedback)
      },
    )
  if (kind === 'material')
    return config(
      'Materyal yükle',
      [
        text('title', 'Materyal başlığı'),
        select('level', 'Sınıf düzeyi', enumOptions([...new Set(ownClasses.map((c) => c.level))])),
        text('file', 'Doküman', { type: 'file' }),
        text('content', 'Açıklama', { multiline: true }),
      ],
      { level: ownClasses[0]?.level },
      (s, v, id) => {
        const file = pickedFile(v.file)
        if (!file?.uri) throw new Error('Dosya seçin.')
        const t = found(
          s.teachers.find((t) => t.id === teacherId),
          'Öğretmen kaydı bulunamadı.',
        )
        // Telefon, materyalin dosya yolunu da saklar; ortak tipte bu alan yoktur.
        const material = {
          id: id('mat'),
          teacherId,
          subjectId: t.subjectId,
          subject: t.subject,
          title: requiredText.parse(v.title),
          level: str(v.level),
          fileName: file.name,
          fileUri: file.uri,
          size: `${Math.ceil((file.size || 0) / 1024)} KB`,
          type: 'Doküman',
          createdAt: now(),
          content: [requiredText.parse(v.content)],
        }
        s.materials.unshift(material)
      },
    )
  if (kind === 'quiz')
    return config(
      'Soru bankasından quiz oluştur',
      (v) => {
        const cls = state.classes.find((c) => c.id === v.classId)
        const subject = state.teachers.find((t) => t.id === teacherId)?.subjectId
        const bank = state.bank.filter(
          (q) =>
            q.subjectId === subject &&
            q.minGrade <= (cls?.grade || 7) &&
            q.maxGrade >= (cls?.grade || 7),
        )
        return [
          select('classId', 'Sınıf', options(ownClasses)),
          text('title', 'Quiz başlığı'),
          text('duration', 'Süre (dakika)', { keyboard: 'number-pad' }),
          {
            key: 'questionIds',
            label: 'Sorular',
            type: 'multi',
            required: true,
            options: bank.map((q) => ({ value: q.id, label: `${q.topic} · ${q.text}` })),
          },
        ]
      },
      {
        classId: ownClasses[0]?.id,
        title: 'Kazanım değerlendirme',
        duration: '20',
        questionIds: [],
      },
      (s, v, id) => {
        const cls = ownClasses.find((c) => c.id === v.classId)
        const t = found(
          s.teachers.find((t) => t.id === teacherId),
          'Öğretmen kaydı bulunamadı.',
        )
        const questionIds = stringList(v.questionIds)
        if (!cls || !questionIds.length) throw new Error('Sınıf ve en az bir soru seçin.')
        const valid = s.bank.filter(
          (q) => q.subjectId === t.subjectId && q.minGrade <= cls.grade && q.maxGrade >= cls.grade,
        )
        if (questionIds.some((id) => !valid.some((q) => q.id === id)))
          throw new Error('Sınıf düzeyine uygun sorular seçin.')
        s.quizzes.unshift({
          id: id('quiz'),
          classId: cls.id,
          teacherId,
          subjectId: t.subjectId,
          subject: t.subject,
          title: requiredText.parse(v.title),
          duration: z.coerce
            .number({ error: 'Geçerli bir sınav süresi girin.' })
            .int('Sınav süresini tam dakika olarak girin.')
            .min(1, 'Sınav süresi 1 ile 180 dakika arasında olmalıdır.')
            .max(180, 'Sınav süresi 1 ile 180 dakika arasında olmalıdır.')
            .parse(v.duration),
          questionIds: [...new Set(questionIds)],
          createdAt: now(),
        })
      },
    )
  if (kind === 'appointment')
    return config(
      'Randevu talep et',
      (v) => [
        select('teacherId', 'Öğretmen', teacherOptions),
        select(
          'slotId',
          'Müsait saat',
          state.availability
            .filter(
              (slot) =>
                slot.teacherId === v.teacherId &&
                +new Date(slot.date) > Date.now() &&
                !state.appointments.some(
                  (a) =>
                    a.teacherId === slot.teacherId &&
                    a.date === slot.date &&
                    a.status !== 'Reddedildi',
                ),
            )
            .map((slot) => ({
              value: slot.id,
              label: `${dateLabel(slot.date)} · ${timeLabel(slot.date)} · ${slot.duration} dk`,
            })),
        ),
        text('note', 'Görüşme konusu', { multiline: true }),
      ],
      { teacherId: teacherOptions[0]?.value },
      (s, v, id) => {
        const slot = s.availability.find((i) => i.id === v.slotId && i.teacherId === v.teacherId)
        if (!slot || +new Date(slot.date) <= Date.now())
          throw new Error('Gelecekteki bir saat seçin.')
        if (
          s.appointments.some(
            (a) =>
              a.date === slot.date &&
              (a.teacherId === slot.teacherId || a.studentId === c.student.id) &&
              a.status !== 'Reddedildi',
          )
        )
          throw new Error('Bu saatte başka randevu bulunuyor.')
        // Telefon randevuya süreyi de yazar; ortak randevu tipinde bu alan yoktur.
        const appointment = {
          id: id('apt'),
          studentId: c.student.id,
          teacherId: slot.teacherId,
          date: slot.date,
          duration: slot.duration,
          type: session.role === 'veli' ? 'Veli görüşmesi' : 'Bireysel etüt',
          note: requiredText.parse(v.note),
          status: 'Bekliyor',
        }
        s.appointments.unshift(appointment)
      },
    )
  if (kind === 'slot')
    return config(
      'Müsaitlik ekle',
      [
        text('date', 'Tarih', { type: 'date' }),
        text('time', 'Saat', { type: 'time' }),
        select('duration', 'Süre (dakika)', enumOptions(['15', '30', '45', '60'])),
      ],
      { date: dayKey(new Date(Date.now() + 86400000)), time: '16:00', duration: '30' },
      (s, v, id) => {
        const date = future(v),
          end = +new Date(date) + Number(v.duration) * 60000
        const existing = [
          ...s.availability,
          ...s.schedule,
          ...s.appointments.filter((a) => a.status !== 'Reddedildi'),
        ]
        if (
          existing.some(
            (a) =>
              a.teacherId === teacherId &&
              +new Date(a.date) < end &&
              +new Date(a.date) + (('duration' in a && a.duration) || 30) * 60000 > +new Date(date),
          )
        )
          throw new Error('Bu saat programınızla çakışıyor.')
        s.availability.push({ id: id('slot'), teacherId, date, duration: Number(v.duration) })
      },
    )
  if (kind === 'appointment-status')
    return config(
      'Randevuyu değerlendir',
      [select('status', 'Karar', enumOptions(['Onaylandı', 'Reddedildi']))],
      { status: 'Onaylandı' },
      (s, v) => {
        const a = s.appointments.find((a) => a.id === need().id && a.teacherId === teacherId)
        if (!a) throw new Error('Randevu bulunamadı.')
        if (
          v.status === 'Onaylandı' &&
          s.appointments.some(
            (x) =>
              x.id !== a.id &&
              x.teacherId === teacherId &&
              x.date === a.date &&
              x.status === 'Onaylandı',
          )
        )
          throw new Error('Bu saatte onaylı bir görüşme var.')
        a.status = str(v.status)
      },
    )
  if (kind === 'message')
    return config(
      'Yeni mesaj',
      [
        select('teacherId', 'Öğretmen', teacherOptions),
        text('text', 'Mesajınız', { multiline: true }),
      ],
      { teacherId: teacherOptions[0]?.value },
      (s, v, id) => {
        const audience = session.role === 'veli' ? 'parent' : 'student'
        let conversation = s.conversations.find(
          (i) =>
            i.studentId === c.student.id && i.audience === audience && i.teacherId === v.teacherId,
        )
        if (!conversation) {
          conversation = {
            id: id('conv'),
            studentId: c.student.id,
            teacherId: str(v.teacherId),
            audience,
            messages: [],
          }
          s.conversations.push(conversation)
        }
        conversation.messages.push({
          id: id('msg'),
          text: requiredText.parse(v.text),
          sender: audience,
          date: now(),
        })
      },
    )
  if (kind === 'request')
    return config(
      'Şikayet / talep gönder',
      [
        select('category', 'Konu türü', enumOptions(['Talep', 'Şikayet', 'Öneri'])),
        text('title', 'Başlık'),
        text('text', 'Açıklama', { multiline: true }),
      ],
      { category: 'Talep' },
      (s, v, id) =>
        s.requests.unshift({
          id: id('req'),
          studentId: c.student.id,
          title: requiredText.parse(v.title),
          text: requiredText.parse(v.text),
          category: str(v.category),
          status: 'Yeni',
          assignedTo: 'Ön büro',
          date: now(),
        }),
    )
  if (kind === 'request-status')
    return config(
      'Talebi yönlendir',
      [
        select('status', 'Durum', enumOptions(['Yeni', 'İnceleniyor', 'Çözüldü'])),
        select(
          'assignedTo',
          'Sorumlu birim',
          enumOptions(['Ön büro', 'Akademik koordinatör', 'Müdürlük', 'Finans']),
        ),
      ],
      need(),
      (s, v) =>
        Object.assign(
          found(
            s.requests.find((i) => i.id === need().id),
            'Talep bulunamadı.',
          ),
          { status: str(v.status), assignedTo: str(v.assignedTo) },
        ),
    )
  if (kind === 'absence')
    return config(
      'İzin / mazeret bildir',
      [
        text('startDate', 'Başlangıç', { type: 'date' }),
        text('endDate', 'Bitiş', { type: 'date' }),
        select('category', 'Mazeret türü', enumOptions(['Sağlık', 'Ailevi neden', 'Resmi izin'])),
        text('reason', 'Açıklama', { multiline: true }),
      ],
      { startDate: dayKey(), endDate: dayKey(), category: 'Sağlık' },
      (s, v, id) => {
        const start = at({ date: v.startDate }),
          end = at({ date: v.endDate })
        if (end < start) throw new Error('Bitiş tarihi başlangıçtan önce olamaz.')
        s.absences.unshift({
          id: id('absence'),
          studentId: c.student.id,
          startDate: start,
          endDate: end,
          category: str(v.category),
          reason: requiredText.parse(v.reason),
          createdAt: now(),
        })
      },
    )
  throw new Error('İşlem bulunamadı.')
}

type RecordAction = {
  label: string
  operation?: OperationKind
  document?: DocumentType
  id?: string
}
const run = (label: string, operation: OperationKind): RecordAction => ({ label, operation })
const open = (label: string, document: DocumentType, id?: string): RecordAction =>
  id === undefined ? { label, document } : { label, document, id }

export function recordActions(row: Row, session: Session): RecordAction[] {
  const c = session.role
  if (row.kind === 'invoice')
    return [
      ...(row.source.paidAt
        ? [open('Dekont', 'receipt')]
        : c === 'ogrenci'
          ? []
          : [run(c === 'veli' ? 'Ödeme yap' : 'Tahsil et', 'collect')]),
      ...((c === 'yonetici' || c === 'onburo') && !row.source.paidAt
        ? [run('Hatırlat', 'remind')]
        : []),
      open('Ödeme planı', 'payment-plan', row.source.studentId),
    ]
  if (row.kind === 'contract')
    return [
      open('Sözleşme PDF', 'contract'),
      open('Taksit planı', 'payment-plan', row.source.studentId),
    ]
  if ((row.kind === 'branch' || row.kind === 'class' || row.kind === 'teacher') && c === 'yonetici')
    return row.source.isActive
      ? [run('Düzenle', row.kind), run('Arşivle', 'archive')]
      : [run('Geri al', 'restore')]
  if (row.kind === 'prospect')
    return [
      run('Görüşme notu', 'note'),
      ...(!row.source.studentId
        ? [run('Randevu planla', 'trial'), run('Kesin kayıt', 'registration')]
        : []),
    ]
  if (row.kind === 'question' && c === 'ogretmen')
    return [run(row.source.answer ? 'Yanıtı düzenle' : 'Yanıtla', 'answer')]
  if (row.kind === 'homework')
    return [
      open('Ödev PDF', 'homework'),
      ...(c === 'ogrenci' ? [run('Dosya teslim et', 'submit')] : []),
    ]
  if (row.kind === 'material') return [open('Dosyayı paylaş', 'material')]
  if (row.kind === 'submission') return [open('Değerlendirme PDF', 'submission')]
  if (row.kind === 'appointment' && c === 'ogretmen')
    return [run('Onay / ret', 'appointment-status')]
  if (row.kind === 'request' && c === 'onburo') return [run('Yönlendir', 'request-status')]
  return []
}
export const createActions: Partial<Record<string, readonly [label: string, kind: OperationKind]>> =
  {
    subeler: ['Kampüs ekle', 'branch'],
    classes: ['Sınıf ekle', 'class'],
    personel: ['Öğretmen ekle', 'teacher'],
    adaylar: ['Aday ekle', 'prospect'],
    'deneme-dersi-takvimi': ['Görüşme planla', 'trial'],
    'kayit-islemleri': ['Kesin kayıt', 'registration'],
    'soru-sor': ['Soru sor', 'question'],
    'materyal-yukle': ['Materyal yükle', 'material'],
    'quiz-olustur': ['Quiz oluştur', 'quiz'],
    'randevu-talep': ['Randevu talep et', 'appointment'],
    'randevu-mesaj': ['Randevu talep et', 'appointment'],
    randevular: ['Müsaitlik ekle', 'slot'],
    mesajlar: ['Yeni mesaj', 'message'],
    'sikayet-talep': ['Talep gönder', 'request'],
    'devamsizlik-bildirimi': ['Mazeret bildir', 'absence'],
  }
