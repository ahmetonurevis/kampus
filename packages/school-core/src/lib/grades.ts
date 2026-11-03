import { z } from 'zod'
import { subjectById, subjectsForGrade } from '../data/curriculum.ts'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { requireAuthorized } from './authorize.ts'
import { daySchema, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { average, dayKey } from './format.ts'
import { isScoredAttempt } from './quiz.ts'
import { linkedRecordId, requireReadable, scopeFor, type Actor } from './scope.ts'

/**
 * Resmî not girişi ve düzeltmesi (docs/domain/akademik-olcme.md). Not kaydı öğrenci, ders, dönem,
 * tür, aynı türdeki sıra, tarih, puan ve giren öğretmeni taşır (DOM-AKD-004). Dönem/yılsonu
 * ortalaması saklanmaz; kayıtlardan hesaplanır. Deneme ve quiz sonucu kendiliğinden not olmaz;
 * öğretmen notlu quizi açıkça ve tek kayıt olarak aktarır, ilk tamamlanan deneme sayılır
 * (DOM-AKD-060).
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`).
 */

z.config(z.locales.tr())

/** Resmî not türleri; `katilim` yalnız ortaokulda (DOM-AKD-004). */
export const GRADE_TYPES = ['sinav', 'performans', 'proje', 'katilim'] as const
export type GradeType = (typeof GRADE_TYPES)[number]
export const GRADE_TYPE_LABELS = {
  sinav: 'sınav',
  performans: 'performans çalışması',
  proje: 'proje',
  katilim: 'ders etkinliklerine katılım',
} as const satisfies Record<GradeType, string>

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.')
const day = daySchema
// Puan 0–100 tam sayıdır (DOM-AKD-003); form değeri metin gelebilir.
const score = z.coerce
  .number({ error: 'Geçerli bir puan girin.' })
  .int('Puan tam sayı olmalıdır.')
  .min(0, 'Puan 0 ile 100 arasında olmalıdır.')
  .max(100, 'Puan 0 ile 100 arasında olmalıdır.')

export const gradeRecordSchema = z
  .object({
    studentId: identifier,
    subjectId: identifier,
    term: z.coerce.number().int().min(1, 'Dönem seçin.').max(2, 'Dönem seçin.'),
    assessmentType: z.enum(GRADE_TYPES, 'Not türünü seçin.'),
    date: day,
    // kvkk: K
    score: score.optional(),
    /** Notlu quiz aktarımı: puan ilk tamamlanan denemeden hesaplanır, elle girilmez. */
    quizId: identifier.optional(),
    topic: z.string().trim().max(200).default(''),
  })
  .superRefine((data, context) => {
    if (data.quizId === undefined && data.score === undefined)
      context.addIssue({ code: 'custom', path: ['score'], message: 'Puanı girin.' })
    if (data.quizId !== undefined && data.score !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['score'],
        message: 'Quiz notu cevaplardan hesaplanır; puan girmeyin.',
      })
    if (data.quizId !== undefined && data.assessmentType !== 'performans')
      context.addIssue({
        code: 'custom',
        path: ['assessmentType'],
        message: 'Quiz yalnız performans notu olarak aktarılır.',
      })
  })
export type GradeRecordInput = z.input<typeof gradeRecordSchema>

export const gradeUpdateSchema = z.object({
  // kvkk: K
  score,
  // kvkk: K — serbest metin; loglanmaz.
  reason: z
    .string()
    .trim()
    .min(2, 'Düzeltme için gerekçe yazın.')
    .max(500, 'En fazla 500 karakter girebilirsiniz.'),
})
export type GradeUpdateInput = z.input<typeof gradeUpdateSchema>

/** Düzeltmede eski puan saklanır (DOM-AKD-051); kayıt üzerine iz bırakmadan yazılmaz. */
export type GradeCorrection = {
  previousScore: number
  score: number
  // kvkk: K
  reason: string
  actor: Role
  userId: string
  date: string
}
/** Not girişinin eklediği alanlar; örnek veri ve eski kayıtlar bunları taşımayabilir. */
export type OfficialGradeFields = {
  /** Notun verildiği sınıf; düzeltme yetkisi buna göre verilir (öğrenci sonra sınıf değiştirebilir). */
  classId: string
  assessmentType: GradeType
  term: number
  sequence: number
  teacherId: string
  quizId: string
  createdAt: string
  updatedAt: string
  corrections: GradeCorrection[]
}

export type GradeOptions = { institutionType?: InstitutionType }

export type SubjectAverage = { subjectId: string; name: string; average: number; count: number }

/**
 * Ders bazında ortalama (`average`, tam sayıya yuvarlanır); ders adına göre Türkçe sıralı. Notu
 * olmayan ders yer almaz. Saklanmaz, notlardan hesaplanır; ders adı kaydın `subject` alanındandır.
 */
export function subjectAverages(
  grades: readonly { subjectId: string; subject: string; score: number }[],
): SubjectAverage[] {
  const groups = new Map<string, { name: string; scores: number[] }>()
  for (const grade of grades) {
    const group = groups.get(grade.subjectId)
    if (group) group.scores.push(grade.score)
    else groups.set(grade.subjectId, { name: grade.subject, scores: [grade.score] })
  }
  return [...groups]
    .map(([subjectId, { name, scores }]) => ({
      subjectId,
      name,
      average: average(scores),
      count: scores.length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'tr'))
}

/**
 * `subjectAverages` sonucunda ders adını güncel ders kaydından gösterir (ders sonradan yeniden
 * adlandırıldıysa not kaydındaki eski ad yerine); eşlemede yoksa kaydın adı kalır. Ad
 * değişebildiği için sıra yeniden Türkçe ad sırasına konur. Web ve mobil aynı eşlemeyi kullanır.
 */
export function withSubjectNames(
  averages: readonly SubjectAverage[],
  subjects: ReadonlyMap<string, { name: string }>,
): SubjectAverage[] {
  return averages
    .map((item) => ({ ...item, name: subjects.get(item.subjectId)?.name ?? item.name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'tr'))
}

function requireSchool(options: GradeOptions) {
  if ((options.institutionType ?? 'school') !== 'school')
    throw new DomainError(
      'official_grades_school_only',
      'Resmî not girişi yalnız okul türündeki kurumlarda kullanılır.',
    )
}
function actorUserId(actor: Actor) {
  return linkedRecordId(actor, 'teacher') ?? `role-${actor.role}`
}

/**
 * Resmî not girer. Yetki: yalnız öğrencinin sınıfında o dersin atanmış öğretmeni (DOM-AKD-054).
 * Öğrencinin o anki sınıfı notta saklanır (`classId`); sonraki düzeltme yetkisi ona bağlıdır.
 * Önce bütün kurallar denetlenir, sonra tek kayıt eklenir; hata olursa State değişmez.
 */
export function recordGrade(
  state: State,
  actor: Actor,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
  options: GradeOptions = {},
) {
  const data = gradeRecordSchema.parse(input)
  requireAuthorized(
    actor,
    'grade.record',
    { studentId: data.studentId, subjectId: data.subjectId },
    state,
    options,
  )
  requireSchool(options)
  const student = state.students.find((s) => s.id === data.studentId && s.isActive)
  const classroom = state.classes.find((c) => c.id === student?.classId)
  if (!student || !classroom)
    throw new DomainError('student_not_found', 'Öğrenci kaydı bulunamadı.', { kind: 'not_found' })
  const subject = subjectById(data.subjectId)
  if (!subject || !subjectsForGrade(classroom.grade).some((s) => s.id === subject.id))
    throw new DomainError(
      'grade_subject_level_mismatch',
      'Ders öğrencinin sınıf düzeyinde okutulmuyor.',
    )
  if (data.assessmentType === 'katilim' && classroom.grade > 8)
    throw new DomainError(
      'grade_kind_level_mismatch',
      'Ders etkinliklerine katılım puanı yalnız ortaokulda verilir.',
    )
  if (data.date > dayKey(now))
    throw new DomainError('grade_future_date', 'Gelecek tarihli not girilemez.')
  let gradeScore = data.score
  if (data.quizId !== undefined) {
    const quiz = state.quizzes.find(
      (q) =>
        q.id === data.quizId && q.classId === student.classId && q.subjectId === data.subjectId,
    )
    if (!quiz) throw new DomainError('quiz_not_found', 'Quiz bulunamadı.', { kind: 'not_found' })
    if (state.grades.some((g) => g.studentId === student.id && g.quizId === quiz.id))
      throw new DomainError('quiz_already_graded', 'Bu quiz zaten not olarak aktarıldı.', {
        kind: 'conflict',
      })
    // Tekrar çözmek alıştırmadır; ilk tamamlanan deneme sayılır (DOM-AKD-060). Süresi işleyen
    // deneme henüz sonuçlanmamıştır; süresi dolmuş deneme boş cevaplı sonucuyla sayılır
    // (DOM-AKD-077).
    const [first] = state.quizAttempts
      .filter((a) => a.quizId === quiz.id && a.studentId === student.id && isScoredAttempt(a, now))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (!first) throw new DomainError('quiz_not_attempted', 'Öğrenci bu quizi henüz tamamlamadı.')
    gradeScore = first.score
  }
  if (gradeScore === undefined)
    throw new DomainError('grade_score_required', 'Puanı girin.', { path: ['score'] })
  const sameKind = state.grades.filter(
    (g) =>
      g.studentId === student.id &&
      g.subjectId === subject.id &&
      g.term === data.term &&
      g.assessmentType === data.assessmentType,
  )
  if (sameKind.some((g) => g.date && dayKey(g.date) === data.date))
    throw new DomainError(
      'grade_duplicate',
      'Bu öğrenciye aynı gün aynı türde not zaten girilmiş.',
      { kind: 'conflict' },
    )
  const sequence = sameKind.reduce((max, g) => Math.max(max, g.sequence ?? 0), 0) + 1
  const grade: State['grades'][number] = {
    id: makeId('g'),
    studentId: student.id,
    subjectId: subject.id,
    subject: subject.name,
    classId: classroom.id,
    title: `${subject.name} · ${data.term}. dönem ${sequence}. ${GRADE_TYPE_LABELS[data.assessmentType]}`,
    topic: data.topic,
    score: gradeScore,
    date: `${data.date}T09:00:00.000Z`,
    assessmentType: data.assessmentType,
    term: data.term,
    sequence,
    teacherId: actorUserId(actor),
    ...(data.quizId !== undefined ? { quizId: data.quizId } : {}),
    createdAt: now,
    updatedAt: now,
  }
  state.grades.push(grade)
  return grade
}

/**
 * Not puanını gerekçeyle düzeltir; eski puan `corrections` geçmişine yazılır (DOM-AKD-051).
 * Yetki: notun verildiği sınıfta (`classId`) o dersin atanmış öğretmeni veya gerekçeyle yönetici.
 * Sınıfı saklanmamış eski notta öğrencinin güncel sınıfı kullanılır. Aktörün göremediği not
 * bulunamadı sayılır (DOM-YTK-002: varlık sızdırılmaz).
 */
export function updateGrade(
  state: State,
  actor: Actor,
  gradeId: string,
  input: unknown,
  now = new Date().toISOString(),
  options: GradeOptions = {},
) {
  const data = gradeUpdateSchema.parse(input)
  // Modül kapalıysa veya rol notları hiç okuyamıyorsa önce o ret döner (DOM-YTK-040).
  const scope = scopeFor(state, actor, options)
  requireReadable(scope, 'grades')
  const grade = state.grades.find((g) => g.id === gradeId)
  if (!grade || !scope.canRead('grades', grade))
    throw new DomainError('grade_not_found', 'Not kaydı bulunamadı.', { kind: 'not_found' })
  requireAuthorized(
    actor,
    'grade.update',
    {
      studentId: grade.studentId,
      subjectId: grade.subjectId,
      ...(grade.classId === undefined ? {} : { classId: grade.classId }),
      reason: data.reason,
    },
    state,
    options,
  )
  requireSchool(options)
  if (grade.quizId !== undefined)
    throw new DomainError(
      'grade_score_from_quiz',
      'Quizden aktarılan notun puanı cevaplardan hesaplanır; düzeltilemez.',
    )
  if (grade.score === data.score)
    throw new DomainError('grade_unchanged', 'Not zaten bu puanda.', { kind: 'conflict' })
  const correction: GradeCorrection = {
    previousScore: grade.score,
    score: data.score,
    reason: data.reason,
    actor: actor.role,
    userId: actorUserId(actor),
    date: now,
  }
  grade.corrections = [...(grade.corrections ?? []), correction]
  grade.score = data.score
  grade.updatedAt = now
  return grade
}
