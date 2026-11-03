// Öğretmen not girişi ekranının (`screens/teacher-grades.tsx`) saf karar ve dönüşümleri. Not
// kuralları, puan sınırları ve düzeltme gerekçesi core `lib/grades.ts` şemalarındandır; yetki
// sunucudadır (`grade.record`, `grade.update`, DOM-AKD-054). Buradaki süzgeçler yalnız seçilemeyecek
// ders ve türü göstermemek, hangi öğrencinin yeni not aldığını, hangisinin düzeltildiğini ve hangisinin
// değişmediğini belirlemek ve gönderimi web (`GradeEntryPanel`, `GradePanel`) ile aynı biçimde kurmak
// içindir (TODO(not-ortak-model): seçici hesapları `@kampus/react-shared`'e taşınınca kopya kalkar).
import type { ApiError } from '@kampus/api-client/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  GRADE_TYPE_LABELS,
  GRADE_TYPES,
  gradeUpdateSchema,
  type GradeType,
} from '@kampus/school-core/lib/grades.ts'
import { commandFeedback, keepsIdempotencyKey } from '@kampus/react-shared/commands.ts'
import {
  GRADE_MESSAGES,
  type RecordGradeInput,
  type UpdateGradeInput,
} from '@kampus/react-shared/use-academic-commands.ts'

/** Notun hangi değerlendirmeye ait olduğu: sınıf, ders, tür, dönem ve gün (aynı gün aynı tür tek nottur). */
export type EvaluationKey = {
  classId: string
  subjectId: string
  assessmentType: GradeType
  term: 1 | 2
  /** `YYYY-MM-DD` (Europe/Istanbul günü). */
  date: string
}

/** Ders atamasının ihtiyaç duyulan alanları. */
type Assignment = { classId: string; subjectId: string; teacherId: string }

/** Sunucudaki bir not kaydı; `version` düzeltmenin `If-Match` değeridir. */
export type ExistingGrade = {
  id: string
  version: number
  studentId: string
  score: number
  /** Quizden aktarılan notun puanı cevaplardan hesaplanır, düzeltilemez. */
  fromQuiz: boolean
}

type GradeRow = {
  id: string
  version: number
  record: {
    studentId: string
    subjectId: string
    score: number
    /** Eski kayıtta tarih olmayabilir; bu not hiçbir değerlendirmeye eşlenmez. */
    date?: string | undefined
    assessmentType?: string | undefined
    term?: number | undefined
    quizId?: string | undefined
  }
}

/** Eylül–Ocak 1. dönem, Şubat–Ağustos 2. dönem (web `defaultTerm` ile aynı varsayılan). */
export function defaultGradeTerm(day: string): 1 | 2 {
  const month = Number(day.slice(5, 7))
  return month >= 9 || month === 1 ? 1 : 2
}

/** Öğretmenin bir sınıfta okuttuğu dersler (tekrarsız); başka sınıf ve ders seçilemez. */
export function teachingSubjectIds(
  assignments: readonly Assignment[],
  teacherId: string,
  classId: string,
): string[] {
  if (!teacherId || !classId) return []
  return [
    ...new Set(
      assignments
        .filter((item) => item.teacherId === teacherId && item.classId === classId)
        .map((item) => item.subjectId),
    ),
  ]
}

/** Not girilebilecek sınıflar: yalnız ders verilen sınıflar (rehberi olduğu sınıf değil). */
export function gradeClassIds(
  assignments: readonly Assignment[],
  teacherId: string,
): ReadonlySet<string> {
  if (!teacherId) return new Set()
  return new Set(
    assignments.filter((item) => item.teacherId === teacherId).map((item) => item.classId),
  )
}

const upperFirst = (text: string) => text.charAt(0).toLocaleUpperCase('tr') + text.slice(1)

/** Ders etkinliklerine katılım puanı yalnız ortaokulda verilir (core `grade_kind_level_mismatch`). */
export function gradeTypeChoices(
  classGrade: number | undefined,
): { value: GradeType; label: string }[] {
  return GRADE_TYPES.filter((type) => type !== 'katilim' || (classGrade ?? 0) <= 8).map(
    (value) => ({ value, label: upperFirst(GRADE_TYPE_LABELS[value]) }),
  )
}

export const GRADE_TERM_CHOICES = [
  { value: '1', label: '1. dönem' },
  { value: '2', label: '2. dönem' },
] as const

const FUTURE_DATE_MESSAGE = GRADE_MESSAGES.grade_future_date

/** Pencere açılmadan önce değerlendirme seçimi: eksik alan ya da gelecek tarih `null` değil metin döner. */
export function evaluationProblem(
  key: Partial<Omit<EvaluationKey, 'date'>> & { date: string },
  today: string,
): string | null {
  if (!key.classId) return 'Sınıf seçin.'
  if (!key.subjectId) return 'Ders seçin.'
  if (!key.assessmentType) return 'Değerlendirme türünü seçin.'
  if (!key.term) return 'Dönem seçin.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key.date)) return 'Tarih seçin.'
  if (key.date > today) return FUTURE_DATE_MESSAGE
  return null
}

/** Seçili değerlendirmenin sunucudaki notları (öğrenci kimliği → kayıt); yalnız aynı ders, tür, dönem ve gün. */
export function existingGrades(
  rows: readonly GradeRow[],
  key: EvaluationKey,
): ReadonlyMap<string, ExistingGrade> {
  const result = new Map<string, ExistingGrade>()
  for (const { id, version, record } of rows) {
    if (
      record.date === undefined ||
      record.subjectId !== key.subjectId ||
      record.assessmentType !== key.assessmentType ||
      record.term !== key.term ||
      dayKey(record.date) !== key.date ||
      result.has(record.studentId)
    )
      continue
    result.set(record.studentId, {
      id,
      version,
      studentId: record.studentId,
      score: record.score,
      fromQuiz: record.quizId !== undefined,
    })
  }
  return result
}

/** Not kimliği → pencere açılırken okunan sürüm (`If-Match`). */
export type VersionPins = Readonly<Record<string, number>>

/** Listenin ilk yüklenişindeki not sürümleri; sonraki odak tazelemeleri onları değiştirmez. */
export function pinVersions(existing: ReadonlyMap<string, ExistingGrade>): VersionPins {
  return Object.fromEntries([...existing.values()].map((item) => [item.id, item.version]))
}

/**
 * Düzeltmenin göndereceği sürüm sabitlenen sürümdür. Aksi halde başka bir cihazın düzeltmesi sürümü
 * yükseltir, ekrandaki eski puan yeni sürümle 409 almadan üzerine yazılırdı (yoklamadaki
 * `pinnedClassVersion` ile aynı gerekçe). Sabitlemesi olmayan (sonradan görünen) not güncel sürümle kalır.
 */
export function withPinnedVersions(
  existing: ReadonlyMap<string, ExistingGrade>,
  pins: VersionPins | null,
): ReadonlyMap<string, ExistingGrade> {
  if (pins === null) return existing
  return new Map(
    [...existing].map(([studentId, item]) => [
      studentId,
      { ...item, version: pins[item.id] ?? item.version },
    ]),
  )
}

/** Dersin daha önce girilmiş değerlendirmeleri (en yeni üstte); dokununca seçim alanları dolar. */
export type KnownEvaluation = {
  key: Pick<EvaluationKey, 'assessmentType' | 'term' | 'date'>
  count: number
}

export function knownEvaluations(rows: readonly GradeRow[]): KnownEvaluation[] {
  const groups = new Map<string, KnownEvaluation>()
  for (const { record } of rows) {
    const type = GRADE_TYPES.find((item) => item === record.assessmentType)
    if (type === undefined || (record.term !== 1 && record.term !== 2) || !record.date) continue
    const date = dayKey(record.date)
    const id = `${type}|${record.term}|${date}`
    const group = groups.get(id)
    if (group) group.count += 1
    else groups.set(id, { key: { assessmentType: type, term: record.term, date }, count: 1 })
  }
  return [...groups.values()].sort(
    (left, right) =>
      right.key.date.localeCompare(left.key.date) ||
      left.key.assessmentType.localeCompare(right.key.assessmentType),
  )
}

/** Alan metninin sonucu: boş, geçerli puan ya da core'un Türkçe hata iletisi. */
export type ScoreParse =
  { status: 'empty' } | { status: 'ok'; score: number } | { status: 'invalid'; message: string }

const scoreSchema = gradeUpdateSchema.shape.score

/**
 * Puan alanını çözer. Sınırlar (0–100, tam sayı) core şemasındandır; ileti de oradandır. Yalnız
 * ondalık yazım sayıdır ("1e1", "0x10" değil); virgül yazılan "85,5" tam sayı hatası alır.
 */
export function parseScore(raw: string): ScoreParse {
  const text = raw.trim()
  if (text === '') return { status: 'empty' }
  const parsed = scoreSchema.safeParse(/^[-+]?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN)
  if (parsed.success) return { status: 'ok', score: parsed.data }
  return {
    status: 'invalid',
    message: parsed.error.issues[0]?.message ?? 'Geçerli bir puan girin.',
  }
}

/** Alanda gösterilen metin: dokunulmuşsa yazılan, yoksa kayıtlı puan, o da yoksa boş. */
export function displayScore(
  existing: ExistingGrade | undefined,
  edit: string | undefined,
): string {
  if (edit !== undefined) return edit
  return existing ? String(existing.score) : ''
}

/** Bir öğrencinin gönderim kararı. */
export type GradeSaveItem =
  | { kind: 'create'; studentId: string; score: number }
  | { kind: 'update'; studentId: string; score: number; gradeId: string; version: number }
  /** Boş alan ya da kayıtlı puanla aynı değer: istek atılmaz. */
  | { kind: 'unchanged'; studentId: string }
  /** Gönderilemez: puan geçersiz, kayıtlı puan boşaltılmış ya da quiz notu. */
  | { kind: 'invalid'; studentId: string; message: string }

export type GradeSavePlan = {
  items: GradeSaveItem[]
  created: number
  updated: number
  invalid: number
  /** En az bir düzeltme varken gerekçe geçersizse core iletisi; düzeltme yoksa `null`. */
  reasonError: string | null
  /** Gönderilecek en az bir not var ve hiçbir engel yok. */
  ready: boolean
}

const reasonSchema = gradeUpdateSchema.shape.reason

/**
 * Kaydet kararı. Dokunulmayan öğrenci ve kayıtlı puanla aynı değer `unchanged` olur (istek atılmaz,
 * kayıtlı nota dokunulmaz); kayıtsız öğrencide dolu alan yeni not, kayıtlıda farklı puan düzeltmedir.
 * Düzeltme gerekçe ister (DOM-AKD-051) ve quizden aktarılan not düzeltilemez; kayıtlı puan boşaltılamaz.
 * Herhangi bir engel varsa hiçbir not gönderilmez ki ekrandaki liste yarım gitmesin.
 */
export function planGradeSave(input: {
  studentIds: readonly string[]
  existing: ReadonlyMap<string, ExistingGrade>
  edits: Readonly<Record<string, string>>
  reason: string
}): GradeSavePlan {
  const items = input.studentIds.map((studentId): GradeSaveItem => {
    const current = input.existing.get(studentId)
    const edit = input.edits[studentId]
    if (edit === undefined) return { kind: 'unchanged', studentId }
    const parsed = parseScore(edit)
    if (parsed.status === 'invalid') return { kind: 'invalid', studentId, message: parsed.message }
    if (parsed.status === 'empty')
      return current
        ? {
            kind: 'invalid',
            studentId,
            message: 'Kayıtlı puan boş bırakılamaz; düzeltmek için yeni puan girin.',
          }
        : { kind: 'unchanged', studentId }
    if (!current) return { kind: 'create', studentId, score: parsed.score }
    if (parsed.score === current.score) return { kind: 'unchanged', studentId }
    if (current.fromQuiz)
      return { kind: 'invalid', studentId, message: GRADE_MESSAGES.grade_score_from_quiz }
    return {
      kind: 'update',
      studentId,
      score: parsed.score,
      gradeId: current.id,
      version: current.version,
    }
  })
  const created = items.filter((item) => item.kind === 'create').length
  const updated = items.filter((item) => item.kind === 'update').length
  const invalid = items.filter((item) => item.kind === 'invalid').length
  const reason = updated > 0 ? reasonSchema.safeParse(input.reason) : undefined
  const reasonError =
    reason && !reason.success
      ? (reason.error.issues[0]?.message ?? 'Düzeltme için gerekçe yazın.')
      : null
  return {
    items,
    created,
    updated,
    invalid,
    reasonError,
    ready: created + updated > 0 && invalid === 0 && reasonError === null,
  }
}

/** `POST /grades` gövdesi; tek öğrenci, tek istek. Konu boşsa gönderilmez. */
export function gradeCreateInput(
  key: EvaluationKey,
  item: Extract<GradeSaveItem, { kind: 'create' }>,
  topic: string,
): RecordGradeInput {
  const text = topic.trim()
  return {
    studentId: item.studentId,
    subjectId: key.subjectId,
    term: key.term,
    assessmentType: key.assessmentType,
    date: key.date,
    score: item.score,
    ...(text ? { topic: text } : {}),
  }
}

/** `PATCH /grades/:gradeId` yükü; `gradeVersion` okunan sürümdür (`If-Match`). */
export function gradeUpdateInput(
  item: Extract<GradeSaveItem, { kind: 'update' }>,
  reason: string,
): UpdateGradeInput {
  return {
    gradeId: item.gradeId,
    score: item.score,
    reason: reason.trim(),
    gradeVersion: item.version,
  }
}

/** Pencere içinde gösterilecek Türkçe hata; oturum hatasında (401) `null` (giriş ekranına düşülür). */
export function gradeFailureText(error: ApiError): string | null {
  return commandFeedback(error, GRADE_MESSAGES).message
}

/**
 * Kayıt sonucu belirsiz mi (ağ koptu, 5xx): istek sunucuda işlenmiş olabilir. Bu durumda sıradaki
 * öğrencilere geçilmez; aynı anahtar ve gövdeyle yeniden denemek tek kayıt üretir.
 */
export function isUncertainFailure(error: ApiError): boolean {
  return keepsIdempotencyKey(error)
}

/** Öğrenci başına kayıt sonucu; ekran yalnız sunucu yanıtından sonra yazar. */
export type GradeSaveResult =
  | { status: 'saved'; kind: 'create' | 'update' }
  | { status: 'failed'; message: string }
  /** Önceki öğrencide belirsiz hata olduğundan gönderilmedi. */
  | { status: 'skipped' }

export const SKIPPED_MESSAGE = 'Bağlantı sorunu nedeniyle gönderilmedi; yeniden deneyin.'

/** Kayıt turunun özet cümlesi; boşsa `null`. */
export function saveSummary(results: Readonly<Record<string, GradeSaveResult>>): string | null {
  const values = Object.values(results)
  const created = values.filter((item) => item.status === 'saved' && item.kind === 'create').length
  const updated = values.filter((item) => item.status === 'saved' && item.kind === 'update').length
  const parts = [
    created > 0 ? `${created} not kaydedildi` : '',
    updated > 0 ? `${updated} not düzeltildi` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join(', ')}.` : null
}

/**
 * Başarıyla kaydedilen öğrencilerin işaretini (`edits`) düşürür; başarısızlar ve gönderilmeyenler
 * girilen puanla kalır. Sunucu yeni değeri döndürüp liste tazelendikten sonra çağrılır.
 */
export function withoutSaved(
  edits: Readonly<Record<string, string>>,
  results: Readonly<Record<string, GradeSaveResult>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(edits).filter(([studentId]) => results[studentId]?.status !== 'saved'),
  )
}
