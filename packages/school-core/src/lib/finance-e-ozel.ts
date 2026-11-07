import { z } from 'zod'

import { PROGRESSION_OUTCOMES, type ProgressionOutcome } from '../cefr/progression.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { DomainError } from './errors.ts'
import { receiptNumberLabel } from './finance-receipt.ts'
import { dayKey } from './format.ts'

/**
 * e-Özel işlem listesi (IST-085, DOM-KAY-015): e-Özel'e elle girilecek kursiyer, ücret/dekont,
 * devamsızlık ve kurs sonu bilgisi tek listede görünür, işlendiği kim/ne zaman bilgisiyle
 * işaretlenir. Platform e-Özel'e bağlanmaz ve resmî alan listesi iddia etmez: satırdaki bilgiler
 * ister listesinin e-Özel kılavuzu özetindeki adlardır (kursiyer kimliği ve doğum tarihi; ücret
 * tutarı, tarihi, dekont no; ders bazında devamsızlık; kayıt ve kurs sonu durumu). Alanların
 * e-Özel ekranıyla birebir eşleşmesi **doğrulanmalı**.
 *
 * Kaynak satırlar servisten saf girdi olarak gelir; bu modül yalnız satır kurar, süzer, sıralar,
 * işaret kuralını uygular ve CSV yazar.
 *
 * Düzeltme durumu: işaret, satırın o anki `sourceParts` özetini (parmak izi) saklar. Kaynak sonradan
 * değişirse özet tutmaz, satır listeden düşmez ve "e-Özel'de düzeltilmeli" görünür; personel
 * düzeltmeyi e-Özel'de yapınca yeniden işaretler. `sourceParts` kişisel değer taşımaz: kimlik
 * numarası, doğum tarihi, ad ve havale referansı girdi değildir, kimlik satırının değişimi sürüm
 * numarasından anlaşılır. Özeti API üretir (`EOzelDigest`).
 */

export const E_OZEL_KINDS = ['learner', 'fee', 'attendance', 'course_end'] as const
export type EOzelKind = (typeof E_OZEL_KINDS)[number]

export const E_OZEL_KIND_LABELS: Record<EOzelKind, string> = {
  learner: 'Kursiyer',
  fee: 'Ücret/dekont',
  attendance: 'Devamsızlık',
  course_end: 'Kurs sonu',
}

/**
 * Ücret işareti tahsilatın kendi MEBBİS işaretidir (`payments.mebbis_recorded_at`, DOM-FIN-032):
 * aynı işlem iki yerde iki ayrı işaret olmaz. Diğer türler `e_ozel_records` tablosundadır.
 */
export const E_OZEL_STORED_KINDS = ['learner', 'attendance', 'course_end'] as const

/** Türün verisi `academic` modülündendir; modül kapalıysa satır üretilmez (DOM-YTK-040). */
export const E_OZEL_ACADEMIC_KINDS: readonly EOzelKind[] = ['attendance', 'course_end']

/** Süzgeç: `pending` iş bekleyenlerin tamamıdır (işlenmemiş ve düzeltilmeli). */
export const E_OZEL_STATUSES = ['pending', 'needs_correction', 'recorded', 'all'] as const
export type EOzelStatus = (typeof E_OZEL_STATUSES)[number]

/** Satırın durumu. */
export const E_OZEL_RECORD_STATUSES = ['pending', 'needs_correction', 'recorded'] as const
export type EOzelRecordStatus = (typeof E_OZEL_RECORD_STATUSES)[number]

export const E_OZEL_RECORD_STATUS_LABELS: Record<EOzelRecordStatus, string> = {
  pending: 'İşlenmedi',
  needs_correction: "e-Özel'de düzeltilmeli",
  recorded: 'İşlendi',
}

export const eOzelMarkSchema = z.strictObject({
  recorded: z.boolean('İşlendi bilgisini gönderin.'),
})
export type EOzelMarkInput = z.input<typeof eOzelMarkSchema>

/** Liste ve dosya süzgeci; varsayılan iş bekleyen kayıtlardır (IST-085). */
export const eOzelFilterShape = {
  kind: z.enum(E_OZEL_KINDS).optional().describe('Yalnız bu tür'),
  status: z
    .enum(E_OZEL_STATUSES)
    .default('pending')
    .describe(
      '`pending` işlenmemiş ve düzeltilmeli (varsayılan), `needs_correction` yalnız düzeltilmeli, `recorded` işlenmiş, `all` hepsi',
    ),
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Kursiyer adı, dekont no veya işlem referansı'),
  dateFrom: z.iso
    .date()
    .optional()
    .describe('Satır günü (Europe/Istanbul) için başlangıç (`YYYY-MM-DD`, dahil)'),
  dateTo: z.iso
    .date()
    .optional()
    .describe('Satır günü (Europe/Istanbul) için bitiş (`YYYY-MM-DD`, dahil)'),
}

/** Ters gün aralığı 400 olur. */
export const eOzelDateRangeRule = {
  check: (query: { dateFrom?: string | undefined; dateTo?: string | undefined }) =>
    !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo,
  options: { path: ['dateTo'], message: 'Bitiş günü başlangıç gününden önce olamaz.' },
}

export const eOzelFilterSchema = z
  .strictObject(eOzelFilterShape)
  .refine(eOzelDateRangeRule.check, eOzelDateRangeRule.options)
export type EOzelFilter = z.output<typeof eOzelFilterSchema>

/** Kayıt durumu (e-Özel kılavuzu: aktif, kayıt iptal; "devamsızlıktan kaldı" kurs sonu satırıdır). */
export type EOzelLearnerStatus = 'active' | 'cancelled'

export interface EOzelLearnerFields {
  identityKind: string | null
  /** Numara listede ve dosyada yalnız maskelidir; tam numara satır başına ayrı uçtan okunur. */
  maskedIdentity: string | null
  birthDate: string | null
  status: EOzelLearnerStatus
}
export interface EOzelFeeFields {
  amountCents: number
  /** Kurum dekont numarası (`2026-12`). */
  receipt: string
  method: string
  reference: string | null
}
export interface EOzelAttendanceFields {
  /** Kur grubu ya da sınıf adı. */
  groupName: string | null
  courseName: string | null
  /** Ders saati kimliği; gün bazlı yoklamada boş. */
  lessonHourId: string | null
  excused: boolean
}
export interface EOzelCourseEndFields {
  outcome: ProgressionOutcome
  groupName: string | null
  courseName: string | null
  /** MEBBİS belge izi varsa belge no (DOM-DIL-080); yalnız okunur. */
  certificateNumber: string | null
}

/** İşaret: işlenmediyse alanlar boştur. */
export interface EOzelMark {
  recordedAt: string | null
  recordedByUserId: string | null
  version: number
  /**
   * İşaretlendiği anki parmak izi. Tahsilatın MEBBİS ucundan yazılan işarette boştur (DOM-FIN-032):
   * tahsilatın alanları değişmez, o satırda yalnız iptal ayrışır.
   */
  fingerprint: string | null
}

export type EOzelSourcePart = string | number | boolean | null

export interface EOzelItem extends EOzelMark {
  kind: EOzelKind
  sourceId: string
  recordStatus: EOzelRecordStatus
  /**
   * Kaynak artık listeye girmiyor (tahsilat iptal edildi, yoklama düzeltildi): satır yalnız işaretli
   * olduğu için görünür, işareti kaldırılamaz.
   */
  sourceRemoved: boolean
  /** Parmak izinin kişisel olmayan girdileri; istemciye dönmez. */
  sourceParts: readonly EOzelSourcePart[]
  learnerId: string
  learnerName: string
  /** Satır günü (`YYYY-MM-DD`, Europe/Istanbul); kimlik kaydı olmayan kursiyerde boş. */
  date: string | null
  learner: EOzelLearnerFields | null
  fee: EOzelFeeFields | null
  attendance: EOzelAttendanceFields | null
  courseEnd: EOzelCourseEndFields | null
}

const NO_FIELDS = { learner: null, fee: null, attendance: null, courseEnd: null }

/** İşareti henüz olmayan satırın sürümü: `If-Match` 1'den başlar, ilk işaret satırı 2 yazar. */
export const E_OZEL_INITIAL_VERSION = 1
const UNMARKED = {
  recordedAt: null,
  recordedByUserId: null,
  version: E_OZEL_INITIAL_VERSION,
  fingerprint: null,
  recordStatus: 'pending',
  sourceRemoved: false,
} as const

export const eOzelKey = (kind: EOzelKind, sourceId: string) => `${kind}:${sourceId}`

export function maskIdentityNumber(value: string): string {
  return `*******${value.slice(-4)}`
}

/**
 * Kayıt iptali de kaynak değişikliğidir: işlenmiş kursiyer ayrılınca satır "düzeltilmeli" olur,
 * işlenmemişse "Kayıt iptal" bilgisiyle işlenmemiş kalır. Ad özete girmez: e-Özel'e kursiyer kimlik
 * ve doğum tarihiyle eklenir (`docs/urun/ister-listesi.md`). `showIdentity: false` (`crm` kapalı)
 * kimliği satırdan çıkarır, kimlik sürümü özette kalır: modül kapatmak satırı düzeltilmeli yapmaz.
 */
export function eOzelLearnerItems(
  students: readonly { id: string; name: string; isActive?: boolean | undefined }[],
  identities: ReadonlyMap<
    string,
    { kind: string; number: string; birthDate: string; createdAt: Date | string; version: number }
  >,
  options: { showIdentity?: boolean } = {},
): EOzelItem[] {
  const showIdentity = options.showIdentity ?? true
  return students.map((student) => {
    const stored = identities.get(student.id)
    const identity = showIdentity ? stored : undefined
    const status: EOzelLearnerStatus = student.isActive === false ? 'cancelled' : 'active'
    return {
      ...NO_FIELDS,
      ...UNMARKED,
      kind: 'learner',
      sourceId: student.id,
      sourceParts: [status, stored?.version ?? null],
      learnerId: student.id,
      learnerName: student.name,
      date: identity === undefined ? null : dayKey(identity.createdAt),
      learner: {
        identityKind: identity?.kind ?? null,
        maskedIdentity: identity === undefined ? null : maskIdentityNumber(identity.number),
        birthDate: identity?.birthDate ?? null,
        status,
      },
    }
  })
}

/**
 * İşlenmemiş iptal tahsilat listeye girmez; işlenmiş tahsilat iptal edilirse e-Özel'de de düzeltilmesi
 * gerektiği için satırda kalır (DOM-FIN-032, DOM-FIN-033).
 */
export function eOzelFeeItems(
  payments: readonly {
    id: string
    studentId: string
    studentName: string | null
    amountCents: number
    method: string
    reference: string | null
    paidAt: Date | string
    receiptYear: number
    receiptNumber: number
    reversedAt: Date | string | null
    mebbisRecordedAt: Date | string | null
    mebbisRecordedByUserId: string | null
    mebbisFingerprint: string | null
    version: number
  }[],
): EOzelItem[] {
  return payments.flatMap((payment) => {
    const reversed = payment.reversedAt !== null
    if (reversed && payment.mebbisRecordedAt === null) return []
    const date = dayKey(payment.paidAt)
    const receipt = receiptNumberLabel(payment)
    const item: EOzelItem = {
      ...NO_FIELDS,
      kind: 'fee',
      sourceId: payment.id,
      recordStatus: payment.mebbisRecordedAt === null ? 'pending' : 'recorded',
      sourceRemoved: reversed,
      sourceParts: [payment.amountCents, date, receipt, payment.method],
      fingerprint: payment.mebbisFingerprint,
      learnerId: payment.studentId,
      learnerName: payment.studentName ?? '',
      date,
      recordedAt:
        payment.mebbisRecordedAt === null ? null : new Date(payment.mebbisRecordedAt).toISOString(),
      recordedByUserId: payment.mebbisRecordedByUserId,
      version: payment.version,
      fee: {
        amountCents: payment.amountCents,
        receipt,
        method: payment.method,
        reference: payment.reference,
      },
    }
    return [item]
  })
}

/**
 * Ders bazında devamsızlık: dil okulunda ders saati satırı (DOM-DIL-061; `gelmedi`), kurs ve eski
 * kayıtta gün bazlı yoklama. Geç gelen katılmış sayılır, satır üretmez; özürlü devamsızlık da
 * devamsızlıktır (DOM-DIL-060). Ders saati satırında ders günü tutulmaz: satır günü yoklamanın
 * yazıldığı gündür (ders günü ders saati yoklamasıyla gelir; **doğrulanmalı**). `marked` işaretli
 * kaynaklardır: devamsızlığı kalkmış (düzeltilmiş ya da arşivlenmiş) yoklama yalnız işaretliyse
 * satır olur.
 */
export function eOzelAttendanceItems(input: {
  names: ReadonlyMap<string, string>
  lessonHours: readonly {
    id: string
    learnerId: string
    lessonHourId: string
    status: string
    excused: boolean
    recordedAt: Date | string
    groupName: string | null
    courseName: string | null
    archived?: boolean
  }[]
  days: readonly {
    id: string
    studentId: string
    date: string
    status: string
    className: string | null
    archived?: boolean
  }[]
  marked?: ReadonlySet<string>
}): EOzelItem[] {
  const shown = (id: string, absent: boolean) => absent || input.marked?.has(id) === true
  const fromHours = input.lessonHours.flatMap((row): EOzelItem[] => {
    const absent = row.status === 'absent' && row.archived !== true
    if (!shown(row.id, absent)) return []
    return [
      {
        ...NO_FIELDS,
        ...UNMARKED,
        kind: 'attendance',
        sourceId: row.id,
        sourceRemoved: !absent,
        sourceParts: [row.lessonHourId, row.status, row.excused],
        learnerId: row.learnerId,
        learnerName: input.names.get(row.learnerId) ?? '',
        date: dayKey(row.recordedAt),
        attendance: {
          groupName: row.groupName,
          courseName: row.courseName,
          lessonHourId: row.lessonHourId,
          excused: row.excused,
        },
      },
    ]
  })
  const fromDays = input.days.flatMap((row): EOzelItem[] => {
    const absent = (row.status === 'absent' || row.status === 'excused') && row.archived !== true
    if (!shown(row.id, absent)) return []
    const date = dayKey(row.date)
    return [
      {
        ...NO_FIELDS,
        ...UNMARKED,
        kind: 'attendance',
        sourceId: row.id,
        sourceRemoved: !absent,
        sourceParts: [date, row.status],
        learnerId: row.studentId,
        learnerName: input.names.get(row.studentId) ?? '',
        date,
        attendance: {
          groupName: row.className,
          courseName: null,
          lessonHourId: null,
          excused: row.status === 'excused',
        },
      },
    ]
  })
  return [...fromHours, ...fromDays]
}

/**
 * Kur sonu: kaydın geçerli onaylı kararı (`effectiveProgressionDecision` sonucu) satır olur. Satır
 * kayda (`enrollmentId`) bağlıdır: düzeltme kararı onaylanınca aynı satırın sonucu değişir ve işaretli
 * satır düzeltilmeli olur. Belge numarası özete girmez: MEBBİS'ten gelen izdir.
 */
export function eOzelCourseEndItems(input: {
  names: ReadonlyMap<string, string>
  decisions: readonly {
    enrollmentId: string
    learnerId: string
    outcome: ProgressionOutcome
    decidedAt: Date | string
    reviewedAt: Date | string | null
    groupName: string | null
    courseName: string | null
    certificateNumber: string | null
  }[]
}): EOzelItem[] {
  return input.decisions.map((row) => ({
    ...NO_FIELDS,
    ...UNMARKED,
    kind: 'course_end',
    sourceId: row.enrollmentId,
    sourceParts: [row.outcome],
    learnerId: row.learnerId,
    learnerName: input.names.get(row.learnerId) ?? '',
    date: dayKey(row.reviewedAt ?? row.decidedAt),
    courseEnd: {
      outcome: row.outcome,
      groupName: row.groupName,
      courseName: row.courseName,
      certificateNumber: row.certificateNumber,
    },
  }))
}

/** İşaretli (işareti kaldırılmamış) kaynak kimlikleri; işaretsiz kaynak satır üretmez. */
export function eOzelMarkedIds(
  marks: ReadonlyMap<string, EOzelMark>,
  kind: EOzelKind,
): ReadonlySet<string> {
  const prefix = eOzelKey(kind, '')
  const ids = new Set<string>()
  for (const [key, mark] of marks)
    if (mark.recordedAt !== null && key.startsWith(prefix)) ids.add(key.slice(prefix.length))
  return ids
}

/** Özet işlevi API'dedir: core saftır, `node:crypto` almaz. Aynı metin aynı özeti verir. */
export type EOzelDigest = (canonical: string) => string

/** Satırın şu anki parmak izi; işaret yazılırken saklanır, listede saklananla karşılaştırılır. */
export function eOzelFingerprint(
  item: Pick<EOzelItem, 'kind' | 'sourceId' | 'sourceRemoved' | 'sourceParts'>,
  digest: EOzelDigest,
): string {
  return digest(JSON.stringify([item.kind, item.sourceId, item.sourceRemoved, item.sourceParts]))
}

function recordStatusOf(item: EOzelItem, digest: EOzelDigest): EOzelRecordStatus {
  if (item.recordedAt === null) return 'pending'
  const changed =
    item.fingerprint === null
      ? item.sourceRemoved
      : item.fingerprint !== eOzelFingerprint(item, digest)
  return changed ? 'needs_correction' : 'recorded'
}

/**
 * Tabloda işareti olan satırların işaretini ve sürümünü yerleştirir (ücret kendi satırındadır) ve
 * satırın durumunu parmak iziyle belirler.
 */
export function applyEOzelMarks(
  items: readonly EOzelItem[],
  marks: ReadonlyMap<string, EOzelMark>,
  digest: EOzelDigest,
): EOzelItem[] {
  return items.map((item) => {
    const mark = item.kind === 'fee' ? undefined : marks.get(eOzelKey(item.kind, item.sourceId))
    const merged = mark === undefined ? item : { ...item, ...mark }
    return { ...merged, recordStatus: recordStatusOf(merged, digest) }
  })
}

const FOLD: Readonly<Record<string, string>> = { ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c' }
/** Türkçe harf ve büyük/küçük harf duyarsız arama anahtarı. */
const folded = (value: string) =>
  value.toLocaleLowerCase('tr-TR').replace(/[ığüşöç]/g, (char) => FOLD[char] ?? char)

function matchesFilter(item: EOzelItem, filter: Partial<EOzelFilter>, query: string | null) {
  if (filter.kind !== undefined && item.kind !== filter.kind) return false
  const status = filter.status ?? 'pending'
  if (status === 'pending' && item.recordStatus === 'recorded') return false
  if (status === 'needs_correction' && item.recordStatus !== 'needs_correction') return false
  if (status === 'recorded' && item.recordStatus !== 'recorded') return false
  if (filter.dateFrom !== undefined && (item.date === null || item.date < filter.dateFrom))
    return false
  if (filter.dateTo !== undefined && (item.date === null || item.date > filter.dateTo)) return false
  if (query === null) return true
  return [item.learnerName, item.fee?.receipt, item.fee?.reference].some(
    (text) => typeof text === 'string' && folded(text).includes(query),
  )
}

const KIND_ORDER = new Map(E_OZEL_KINDS.map((kind, index) => [kind, index]))

/** Süzer ve sıralar: en yeni gün önce, günü olmayan sonda; sıra deterministiktir. */
export function selectEOzelItems(
  items: readonly EOzelItem[],
  filter: Partial<EOzelFilter>,
): EOzelItem[] {
  const query = filter.q === undefined ? null : folded(filter.q)
  return items
    .filter((item) => matchesFilter(item, filter, query))
    .sort(
      (a, b) =>
        (b.date ?? '').localeCompare(a.date ?? '') ||
        (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) ||
        a.learnerName.localeCompare(b.learnerName, 'tr-TR') ||
        a.sourceId.localeCompare(b.sourceId),
    )
}

/**
 * İşaret kuralı (IST-085): işlenmiş satır yeniden işlenmez, ilk işleyenin kim/ne zaman bilgisi
 * ezilmez; işlenmemiş satırın işareti kaldırılmaz. Geri alma işareti boşaltır, satır yeniden
 * işlenmemiş görünür. Düzeltilmeli satır yeniden işaretlenir: düzeltmeyi yapan yazılır, parmak izi
 * yenilenir. Kaynağı kalkmış satırda işaret kaldırılamaz: satır bir daha görünmez, e-Özel'deki
 * kayıt izsiz kalırdı.
 */
export function planEOzelMark(input: {
  recorded: boolean
  current: { recordStatus: EOzelRecordStatus; sourceRemoved: boolean }
}): { recorded: boolean } {
  const { recordStatus, sourceRemoved } = input.current
  if (input.recorded && recordStatus === 'recorded')
    throw new DomainError('e_ozel_already_recorded', 'Bu kayıt zaten işlendi olarak işaretli.', {
      kind: 'conflict',
    })
  if (!input.recorded && recordStatus === 'pending')
    throw new DomainError('e_ozel_not_recorded', 'Bu kayıt işlendi olarak işaretli değil.', {
      kind: 'conflict',
    })
  if (!input.recorded && sourceRemoved)
    throw new DomainError(
      'e_ozel_source_removed',
      "Kaynağı değişmiş kaydın işareti kaldırılamaz; düzeltmeyi e-Özel'de yapıp işaretleyin.",
      { kind: 'conflict' },
    )
  return { recorded: input.recorded }
}

/** Kaynakta ne değiştiğinin kısa açıklaması; değişiklik yoksa boş. */
export function eOzelChangeNote(
  item: Pick<EOzelItem, 'kind' | 'recordStatus' | 'sourceRemoved'>,
): string | null {
  if (item.sourceRemoved)
    return item.kind === 'fee' ? 'Tahsilat iptal edildi' : 'Yoklama düzeltildi, devamsızlık kalktı'
  if (item.recordStatus !== 'needs_correction') return null
  switch (item.kind) {
    case 'learner':
      return 'Kayıt durumu ya da kimlik bilgisi değişti'
    case 'fee':
      return 'Tahsilat bilgisi değişti'
    case 'attendance':
      return 'Yoklama bilgisi değişti'
    case 'course_end':
      return 'Kur sonu kararı değişti'
    default:
      return item.kind satisfies never
  }
}

const LEARNER_STATUS_LABELS: Record<EOzelLearnerStatus, string> = {
  active: 'Aktif',
  cancelled: 'Kayıt iptal',
}
export const eOzelLearnerStatusLabel = (status: EOzelLearnerStatus) => LEARNER_STATUS_LABELS[status]

const CSV_HEADER = [
  'Tür',
  'Kursiyer',
  'Gün',
  'Kimlik türü',
  'Kimlik no (maskeli)',
  'Doğum tarihi',
  'Kayıt durumu',
  'Tutar',
  'Dekont no',
  'Ödeme yöntemi',
  'İşlem referansı',
  'Grup / sınıf',
  'Kur',
  'Ders saati',
  'Özürlü',
  'Kurs sonu',
  'Belge no',
  'e-Özel durumu',
  'Kaynakta değişiklik',
  'İşaretlenen an',
  'İşaretleyen',
] as const

/**
 * Elle işleme listesi; `names` işaretleyen adlarıdır. Her metin hücresi formül kaçışlıdır
 * (`csvCell`); tutar sistem üretimi sayıdır. Tam kimlik numarası dosyaya yazılmaz.
 */
export function eOzelCsv(
  items: readonly EOzelItem[],
  names: ReadonlyMap<string, string> = new Map(),
): string {
  const rows = items.map((item) => {
    const place = item.attendance ?? item.courseEnd
    return [
      csvCell(E_OZEL_KIND_LABELS[item.kind]),
      csvCell(item.learnerName),
      csvCell(item.date),
      csvCell(item.learner?.identityKind),
      csvCell(item.learner?.maskedIdentity),
      csvCell(item.learner?.birthDate),
      csvCell(item.learner === null ? '' : LEARNER_STATUS_LABELS[item.learner.status]),
      item.fee === null ? '""' : csvAmount(item.fee.amountCents),
      csvCell(item.fee?.receipt),
      csvCell(item.fee?.method),
      csvCell(item.fee?.reference),
      csvCell(place?.groupName),
      csvCell(place?.courseName),
      csvCell(item.attendance?.lessonHourId),
      csvCell(item.attendance === null ? '' : item.attendance.excused ? 'Evet' : 'Hayır'),
      csvCell(item.courseEnd === null ? '' : PROGRESSION_OUTCOMES[item.courseEnd.outcome].label),
      csvCell(item.courseEnd?.certificateNumber),
      csvCell(E_OZEL_RECORD_STATUS_LABELS[item.recordStatus]),
      csvCell(eOzelChangeNote(item) ?? ''),
      csvCell(item.recordedAt),
      csvCell(item.recordedByUserId === null ? '' : names.get(item.recordedByUserId)),
    ]
  })
  return [CSV_HEADER.map(csvCell), ...rows].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
