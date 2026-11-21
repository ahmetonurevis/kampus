import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Kaza ve yaralanma tutanağı (docs/domain/finans.md DOM-FIN-146; ON-162; K-493…K-495). Okulda
 * yaralanan öğrenci (öğrenci kaydı) ya da personel (kurum üyeliği) için olayın günü ve saati,
 * yeri, türü, açıklaması, yaralanma bölgesi ve şiddeti, tanıklar, ilk müdahale, sevk ve sorumlu
 * personel tutulur. Tutanak taslak açılır, kesinleşince değişmez; sonraki düzeltme ek nottur ve
 * eski hâl korunur (K-493).
 *
 * Veli bildirimi yalnız kayıttır (zaman, kanal, bildiren); dış gönderim yoktur. Ağır yaralanan
 * öğrencinin tutanağı bildirim kaydı olmadan kesinleşmez (K-493).
 *
 * Erişim dar (K-494): tutanağı yönetici ve açan personel okur; sağlık grubu (bölge, şiddet,
 * yaralanma notu, ilk müdahale, sevk) açana yalnız taslakta, yöneticiye her zaman döner. Ek notlar
 * ve tutanak PDF'i yalnız yöneticidedir. Veli kendi çocuğunun kesinleşmiş tutanağının özetini görür
 * (K-495). Sağlık verisi öğrenci sağlık profilinden kopyalanmaz. Fonksiyonlar saftır; zaman `now`
 * ile gelir.
 */

/** Tutanak açan ve kendi tutanağını okuyan roller (K-494). */
export const FINANCE_INCIDENT_WRITE_ROLES = STAFF_ROLES satisfies readonly Role[]
/** Bütün tutanakları okuyan, ek not yazan ve PDF basan rol (K-494). */
export const FINANCE_INCIDENT_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Kendi çocuğunun kesinleşmiş tutanak özetini okuyan rol (K-495). */
export const FINANCE_INCIDENT_GUARDIAN_ROLES = ['veli'] as const satisfies readonly Role[]

export const INCIDENT_STATUSES = ['draft', 'finalized'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
export const INCIDENT_STATUS_LABELS = {
  draft: 'Taslak',
  finalized: 'Kesinleşti',
} as const satisfies Record<IncidentStatus, string>

export const INJURED_KINDS = ['student', 'staff'] as const
export type InjuredKind = (typeof INJURED_KINDS)[number]
export const INJURED_KIND_LABELS = {
  student: 'Öğrenci',
  staff: 'Personel',
} as const satisfies Record<InjuredKind, string>

export const INCIDENT_KINDS = ['fall', 'collision', 'sports', 'play', 'other'] as const
export type IncidentKind = (typeof INCIDENT_KINDS)[number]
export const INCIDENT_KIND_LABELS = {
  fall: 'Düşme',
  collision: 'Çarpma',
  sports: 'Spor',
  play: 'Oyun',
  other: 'Diğer',
} as const satisfies Record<IncidentKind, string>

export const INJURY_SEVERITIES = ['minor', 'moderate', 'severe'] as const
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number]
export const INJURY_SEVERITY_LABELS = {
  minor: 'Hafif',
  moderate: 'Orta',
  severe: 'Ağır',
} as const satisfies Record<InjurySeverity, string>

export const INJURY_BODY_PARTS = [
  'head',
  'face',
  'eye',
  'teeth',
  'neck',
  'shoulder',
  'arm',
  'hand',
  'chest',
  'back',
  'abdomen',
  'leg',
  'knee',
  'foot',
  'other',
] as const
export type InjuryBodyPart = (typeof INJURY_BODY_PARTS)[number]
export const INJURY_BODY_PART_LABELS = {
  head: 'Baş',
  face: 'Yüz',
  eye: 'Göz',
  teeth: 'Ağız ve diş',
  neck: 'Boyun',
  shoulder: 'Omuz',
  arm: 'Kol',
  hand: 'El ve parmak',
  chest: 'Göğüs',
  back: 'Sırt',
  abdomen: 'Karın',
  leg: 'Bacak',
  knee: 'Diz',
  foot: 'Ayak ve bilek',
  other: 'Diğer',
} as const satisfies Record<InjuryBodyPart, string>

export const INCIDENT_REFERRALS = ['none', 'infirmary', 'hospital', 'emergency_112'] as const
export type IncidentReferral = (typeof INCIDENT_REFERRALS)[number]
export const INCIDENT_REFERRAL_LABELS = {
  none: 'Sevk yok',
  infirmary: 'Revir',
  hospital: 'Hastane',
  emergency_112: '112 acil',
} as const satisfies Record<IncidentReferral, string>

export const INCIDENT_NOTIFICATION_CHANNELS = ['phone', 'in_person', 'message'] as const
export type IncidentNotificationChannel = (typeof INCIDENT_NOTIFICATION_CHANNELS)[number]
export const INCIDENT_NOTIFICATION_CHANNEL_LABELS = {
  phone: 'Telefon',
  in_person: 'Yüz yüze',
  message: 'Mesaj',
} as const satisfies Record<IncidentNotificationChannel, string>

export const INCIDENT_LOCATION_MIN = 2
export const INCIDENT_LOCATION_MAX = 200
export const INCIDENT_DESCRIPTION_MIN = 10
export const INCIDENT_DESCRIPTION_MAX = 4000
export const INCIDENT_NOTE_MAX = 1000
export const INCIDENT_FIRST_AID_MIN = 2
export const INCIDENT_BODY_PARTS_MAX = 6
export const INCIDENT_WITNESSES_MAX = 20
export const INCIDENT_NOTIFICATIONS_MAX = 10
export const INCIDENT_ADDENDUM_MIN = 5
export const INCIDENT_ADDENDUM_MAX = 2000
export const INCIDENT_ADDENDA_MAX = 50
/** Unutulan tutanak en çok bu kadar gün geriye açılır (K-493). */
export const INCIDENT_BACKDATE_DAYS = 30
const DAY_MS = 86_400_000

// --- Şemalar -------------------------------------------------------------------------------------

const instant = (message: string) => z.iso.datetime({ offset: true, error: message })

const memberId = (message: string) => z.string(message).trim().min(1, message)

const injuredSchema = z
  .discriminatedUnion(
    'kind',
    [
      z.strictObject({
        kind: z.literal('student'),
        studentId: memberId('Yaralanan öğrenciyi seçin.').describe('Öğrenci kaydı'),
      }),
      z.strictObject({
        kind: z.literal('staff'),
        membershipId: memberId('Yaralanan personeli seçin.').describe('Personelin kurum üyeliği'),
      }),
    ],
    { error: 'Yaralananı seçin.' },
  )
  .describe('Yaralanan: `student` öğrenci kaydı ya da `staff` personel üyeliği')
export type IncidentInjured = z.output<typeof injuredSchema>

const locationSchema = z
  .string('Olay yerini yazın.')
  .trim()
  .min(INCIDENT_LOCATION_MIN, `Olay yeri en az ${String(INCIDENT_LOCATION_MIN)} karakter olmalı.`)
  .max(
    INCIDENT_LOCATION_MAX,
    `Olay yeri en çok ${String(INCIDENT_LOCATION_MAX)} karakter olabilir.`,
  )

// kvkk: Ç — serbest metin; şifreli saklanır, denetime ve loga yazılmaz.
const descriptionSchema = z
  .string('Olayı anlatın.')
  .trim()
  .min(
    INCIDENT_DESCRIPTION_MIN,
    `Açıklama en az ${String(INCIDENT_DESCRIPTION_MIN)} karakter olmalı.`,
  )
  .max(
    INCIDENT_DESCRIPTION_MAX,
    `Açıklama en çok ${String(INCIDENT_DESCRIPTION_MAX)} karakter olabilir.`,
  )

const bodyPartsSchema = z
  .array(z.enum(INJURY_BODY_PARTS, 'Yaralanma bölgesini seçin.'), 'Yaralanma bölgesini seçin.')
  .min(1, 'En az bir yaralanma bölgesi seçin.')
  .max(
    INCIDENT_BODY_PARTS_MAX,
    `En çok ${String(INCIDENT_BODY_PARTS_MAX)} yaralanma bölgesi seçilir.`,
  )
  .refine((parts) => new Set(parts).size === parts.length, 'Aynı bölge iki kez seçilmiş.')

const optionalNote = (label: string) =>
  z
    .string(`${label} metin olmalı.`)
    .trim()
    .max(INCIDENT_NOTE_MAX, `${label} en çok ${String(INCIDENT_NOTE_MAX)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const firstAidSchema = z
  .strictObject({
    byMembershipId: memberId('İlk müdahaleyi yapanı seçin.')
      .nullable()
      .default(null)
      .describe('Müdahaleyi yapan personel üyeliği; kurum dışından biriyse boş'),
    // kvkk: Ö — sağlık; şifreli saklanır.
    action: z
      .string('Yapılan müdahaleyi yazın.')
      .trim()
      .min(INCIDENT_FIRST_AID_MIN, 'Yapılan müdahaleyi yazın.')
      .max(INCIDENT_NOTE_MAX, `Müdahale en çok ${String(INCIDENT_NOTE_MAX)} karakter olabilir.`)
      .describe('Ne yapıldı (2–1000; şifreli)'),
  })
  .nullable()
  .describe('İlk müdahale; yapılmadıysa `null`')

const witnessesSchema = z
  .array(memberId('Tanığı seçin.'), 'Tanıkları seçin.')
  .max(INCIDENT_WITNESSES_MAX, `En çok ${String(INCIDENT_WITNESSES_MAX)} tanık eklenir.`)
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı tanık iki kez seçilmiş.')

const fields = {
  occurredAt: instant('Olayın gün ve saatini girin.').describe(
    'Olay anı (ISO 8601); gelecekte ve 30 günden eski olamaz',
  ),
  location: locationSchema.describe('Olay yeri (2–200)'),
  kind: z
    .enum(INCIDENT_KINDS, 'Olay türünü seçin.')
    .describe('`fall` düşme, `collision` çarpma, `sports` spor, `play` oyun, `other` diğer'),
  description: descriptionSchema.describe('Olayın anlatımı (10–4000; şifreli)'),
  // kvkk: Ö — sağlık grubu (bölge, şiddet, not, ilk müdahale, sevk); şifreli saklanır.
  bodyParts: bodyPartsSchema.describe('Yaralanma bölgeleri (1–6)'),
  severity: z
    .enum(INJURY_SEVERITIES, 'Yaralanmanın şiddetini seçin.')
    .describe('`minor` hafif, `moderate` orta, `severe` ağır'),
  injuryNote: optionalNote('Yaralanma notu').describe('Yaralanmanın kısa tarifi (≤ 1000; şifreli)'),
  firstAid: firstAidSchema,
  referral: z
    .enum(INCIDENT_REFERRALS, 'Sevk durumunu seçin.')
    .describe('`none` yok, `infirmary` revir, `hospital` hastane, `emergency_112` 112'),
  witnessMembershipIds: witnessesSchema.describe('Tanık personel üyelikleri (0–20)'),
  responsibleMembershipId: memberId('Sorumlu personeli seçin.').describe(
    'Olaydan sorumlu personel (nöbetçi ya da derse giren; etkin personel)',
  ),
}

export const incidentReportInputSchema = z.strictObject({
  injured: injuredSchema,
  ...fields,
  injuryNote: fields.injuryNote.default(null),
  firstAid: fields.firstAid.default(null),
  witnessMembershipIds: fields.witnessMembershipIds.default([]),
})
export type IncidentReportInput = z.input<typeof incidentReportInputSchema>
export type IncidentReportFields = z.output<typeof incidentReportInputSchema>

/** Taslak düzeltmesi: verilmeyen alan değişmez; yaralanan değişmez (yanlışsa yeni tutanak). */
export const incidentReportUpdateSchema = z
  .strictObject({
    occurredAt: fields.occurredAt.optional(),
    location: fields.location.optional(),
    kind: fields.kind.optional(),
    description: fields.description.optional(),
    bodyParts: fields.bodyParts.optional(),
    severity: fields.severity.optional(),
    injuryNote: fields.injuryNote.optional(),
    firstAid: fields.firstAid.optional(),
    referral: fields.referral.optional(),
    witnessMembershipIds: fields.witnessMembershipIds.optional(),
    responsibleMembershipId: fields.responsibleMembershipId.optional(),
  })
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'En az bir alanı değiştirin.',
  )
export type IncidentReportPatch = z.output<typeof incidentReportUpdateSchema>

export const incidentNotificationSchema = z.strictObject({
  notifiedAt: instant('Bildirim saatini girin.')
    .nullable()
    .default(null)
    .describe('Veliye bildirildiği an (ISO 8601); boşsa şimdi. Olaydan önce ve gelecekte olamaz'),
  channel: z
    .enum(INCIDENT_NOTIFICATION_CHANNELS, 'Bildirim kanalını seçin.')
    .describe('`phone` telefon, `in_person` yüz yüze, `message` mesaj'),
  notifiedByMembershipId: memberId('Bildireni seçin.')
    .nullable()
    .default(null)
    .describe('Veliye bildiren personel üyeliği; boşsa kaydeden'),
})
export type IncidentNotificationFields = z.output<typeof incidentNotificationSchema>

export const incidentAddendumSchema = z.strictObject({
  // kvkk: Ö — düzeltme sağlık bilgisi taşıyabilir; şifreli saklanır.
  note: z
    .string('Ek notu yazın.')
    .trim()
    .min(INCIDENT_ADDENDUM_MIN, `Ek not en az ${String(INCIDENT_ADDENDUM_MIN)} karakter olmalı.`)
    .max(INCIDENT_ADDENDUM_MAX, `Ek not en çok ${String(INCIDENT_ADDENDUM_MAX)} karakter olabilir.`)
    .describe('Kesinleşmiş tutanağa düzeltme ya da ek bilgi (5–2000; şifreli)'),
})
export type IncidentAddendumFields = z.output<typeof incidentAddendumSchema>

// --- İçerik --------------------------------------------------------------------------------------

/** Şifreli sağlık grubu (K-494). */
export interface IncidentHealth {
  bodyParts: InjuryBodyPart[]
  severity: InjurySeverity
  injuryNote: string | null
  firstAidAction: string | null
  referral: IncidentReferral
}

export const incidentHealthSchema = z.strictObject({
  bodyParts: z.array(z.enum(INJURY_BODY_PARTS)).min(1).max(INCIDENT_BODY_PARTS_MAX),
  severity: z.enum(INJURY_SEVERITIES),
  injuryNote: z.string().max(INCIDENT_NOTE_MAX).nullable(),
  firstAidAction: z.string().max(INCIDENT_NOTE_MAX).nullable(),
  referral: z.enum(INCIDENT_REFERRALS),
}) satisfies z.ZodType<IncidentHealth>

/** Taslakta düzeltilebilen bütün değerler (şifreli olanlar dahil, yalnız bellekte). */
export interface IncidentValues {
  occurredAt: string
  location: string
  kind: IncidentKind
  description: string
  health: IncidentHealth
  firstAidByMembershipId: string | null
  witnessMembershipIds: string[]
  responsibleMembershipId: string
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })

export type IncidentStaffMember = { role: string; active: boolean } | null

/** Kişi kurumun etkin personeli mi; değilse ön ekli 422 (`incident_<önek>_not_found` …). */
function assertStaff(
  member: IncidentStaffMember | undefined,
  prefix: string,
  label: string,
  path: string[],
  requireActive = true,
) {
  if (member === null || member === undefined)
    throw ruleError(`incident_${prefix}_not_found`, `${label} bulunamadı.`, path)
  if (!(STAFF_ROLES as readonly string[]).includes(member.role))
    throw ruleError(`incident_${prefix}_not_staff`, `${label} kurum personeli olmalı.`, path)
  if (requireActive && !member.active)
    throw ruleError(`incident_${prefix}_inactive`, `${label} hesabı pasif.`, path)
}

function assertOccurredAt(occurredAt: string, now: Date) {
  const at = Date.parse(occurredAt)
  if (at > now.getTime())
    throw ruleError('incident_occurred_in_future', 'Olay anı şimdiden sonra olamaz.', [
      'occurredAt',
    ])
  if (now.getTime() - at > INCIDENT_BACKDATE_DAYS * DAY_MS)
    throw ruleError(
      'incident_occurred_too_old',
      `Tutanak en çok ${String(INCIDENT_BACKDATE_DAYS)} gün geriye açılır.`,
      ['occurredAt'],
    )
}

export interface IncidentPeopleChecks {
  /** Üyelik kimliği → kurumdaki üyelik (yoksa `null`). */
  members: ReadonlyMap<string, IncidentStaffMember>
}

function assertPeople(
  values: Pick<
    IncidentValues,
    'firstAidByMembershipId' | 'witnessMembershipIds' | 'responsibleMembershipId'
  >,
  injuredMembershipId: string | null,
  checks: IncidentPeopleChecks,
) {
  const member = (id: string) => checks.members.get(id) ?? null
  assertStaff(member(values.responsibleMembershipId), 'responsible', 'Sorumlu personel', [
    'responsibleMembershipId',
  ])
  for (const [index, id] of values.witnessMembershipIds.entries()) {
    const path = ['witnessMembershipIds', String(index)]
    assertStaff(member(id), 'witness', 'Tanık', path)
    if (id === injuredMembershipId)
      throw ruleError('incident_witness_is_injured', 'Yaralanan kişi tanık olamaz.', path)
  }
  if (values.firstAidByMembershipId !== null)
    assertStaff(member(values.firstAidByMembershipId), 'first_aid_by', 'Müdahaleyi yapan', [
      'firstAid',
      'byMembershipId',
    ])
}

const healthOf = (input: {
  bodyParts: InjuryBodyPart[]
  severity: InjurySeverity
  injuryNote: string | null
  firstAid: { action: string } | null
  referral: IncidentReferral
}): IncidentHealth => ({
  bodyParts: input.bodyParts,
  severity: input.severity,
  injuryNote: input.injuryNote,
  firstAidAction: input.firstAid?.action ?? null,
  referral: input.referral,
})

export interface IncidentReportChecks extends IncidentPeopleChecks {
  now: Date
  /** Yaralanan öğrenci kurumda var mı (öğrencide). */
  studentExists?: boolean | undefined
  /** Yaralanan personelin üyeliği (personelde; pasif de olabilir). */
  injuredMember?: IncidentStaffMember | undefined
}

/**
 * Tutanak açma kuralı (K-493): olay anı gelecekte ve 30 günden eski olamaz; yaralanan öğrenci
 * kurumda, yaralanan personel kurumun personeli (pasif olabilir); sorumlu, tanık ve müdahaleyi
 * yapan kurumun etkin personeli; yaralanan personel tanık olamaz.
 */
export function planIncidentReport(
  input: IncidentReportFields,
  checks: IncidentReportChecks,
): IncidentValues {
  assertOccurredAt(input.occurredAt, checks.now)
  if (input.injured.kind === 'student' && checks.studentExists !== true)
    throw ruleError('incident_student_not_found', 'Öğrenci bulunamadı.', ['injured', 'studentId'])
  if (input.injured.kind === 'staff')
    assertStaff(
      checks.injuredMember,
      'injured',
      'Yaralanan personel',
      ['injured', 'membershipId'],
      false,
    )
  const values: IncidentValues = {
    occurredAt: new Date(input.occurredAt).toISOString(),
    location: input.location,
    kind: input.kind,
    description: input.description,
    health: healthOf(input),
    firstAidByMembershipId: input.firstAid?.byMembershipId ?? null,
    witnessMembershipIds: input.witnessMembershipIds,
    responsibleMembershipId: input.responsibleMembershipId,
  }
  assertPeople(values, input.injured.kind === 'staff' ? input.injured.membershipId : null, checks)
  return values
}

/** Kesinleşmiş tutanak değişmez (409; veritabanında tetikleyici de korur). */
export function assertIncidentDraft(status: IncidentStatus) {
  if (status === 'finalized')
    throw new DomainError(
      'incident_report_finalized',
      'Kesinleşmiş tutanak değiştirilemez; düzeltmeyi ek not olarak yazın.',
      { kind: 'conflict', path: [] },
    )
}

/**
 * Taslak düzeltmesi (K-493): verilen alanlar birleşir ve açılış kurallarından geçer; olay anı
 * yalnız değiştiyse yeniden denetlenir ve kayıtlı ilk bildirimden sonraya alınamaz. Değişiklik
 * yoksa 422. Değişen alan adları döner (denetim için; değer yok).
 */
export function planIncidentReportUpdate(
  current: IncidentValues & { status: IncidentStatus; injuredMembershipId: string | null },
  patch: IncidentReportPatch,
  checks: IncidentPeopleChecks & { now: Date; firstNotifiedAt: string | null },
): { values: IncidentValues; changed: string[] } {
  assertIncidentDraft(current.status)
  const firstAid =
    patch.firstAid === undefined
      ? current.health.firstAidAction === null
        ? null
        : { byMembershipId: current.firstAidByMembershipId, action: current.health.firstAidAction }
      : patch.firstAid
  const values: IncidentValues = {
    occurredAt:
      patch.occurredAt === undefined
        ? current.occurredAt
        : new Date(patch.occurredAt).toISOString(),
    location: patch.location ?? current.location,
    kind: patch.kind ?? current.kind,
    description: patch.description ?? current.description,
    health: healthOf({
      bodyParts: patch.bodyParts ?? current.health.bodyParts,
      severity: patch.severity ?? current.health.severity,
      injuryNote: patch.injuryNote === undefined ? current.health.injuryNote : patch.injuryNote,
      firstAid,
      referral: patch.referral ?? current.health.referral,
    }),
    firstAidByMembershipId: firstAid?.byMembershipId ?? null,
    witnessMembershipIds: patch.witnessMembershipIds ?? current.witnessMembershipIds,
    responsibleMembershipId: patch.responsibleMembershipId ?? current.responsibleMembershipId,
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const changed = [
    ...(values.occurredAt === current.occurredAt ? [] : ['occurredAt']),
    ...(values.location === current.location ? [] : ['location']),
    ...(values.kind === current.kind ? [] : ['kind']),
    ...(values.description === current.description ? [] : ['description']),
    ...(same(values.health.bodyParts, current.health.bodyParts) ? [] : ['bodyParts']),
    ...(values.health.severity === current.health.severity ? [] : ['severity']),
    ...(values.health.injuryNote === current.health.injuryNote ? [] : ['injuryNote']),
    ...(values.health.firstAidAction === current.health.firstAidAction &&
    values.firstAidByMembershipId === current.firstAidByMembershipId
      ? []
      : ['firstAid']),
    ...(values.health.referral === current.health.referral ? [] : ['referral']),
    ...(same(values.witnessMembershipIds, current.witnessMembershipIds)
      ? []
      : ['witnessMembershipIds']),
    ...(values.responsibleMembershipId === current.responsibleMembershipId
      ? []
      : ['responsibleMembershipId']),
  ]
  if (changed.length === 0)
    throw ruleError('incident_report_unchanged', 'Tutanakta değişiklik yok.', [])
  if (changed.includes('occurredAt')) {
    assertOccurredAt(values.occurredAt, checks.now)
    if (checks.firstNotifiedAt !== null && values.occurredAt > checks.firstNotifiedAt)
      throw ruleError(
        'incident_occurred_after_notification',
        'Olay anı kayıtlı veli bildiriminden sonra olamaz.',
        ['occurredAt'],
      )
  }
  assertPeople(values, current.injuredMembershipId, checks)
  return { values, changed }
}

/** Ağır yaralanan öğrencinin tutanağı veli bildirimi olmadan kesinleşmez (K-493). */
export const incidentNotificationRequired = (injuredKind: InjuredKind, severity: InjurySeverity) =>
  injuredKind === 'student' && severity === 'severe'

/** Kesinleştirme kuralı (K-493): taslak olmalı; ağır öğrenci olayında bildirim kaydı zorunlu. */
export function assertIncidentFinalize(input: {
  status: IncidentStatus
  injuredKind: InjuredKind
  severity: InjurySeverity
  notificationCount: number
}) {
  assertIncidentDraft(input.status)
  if (
    incidentNotificationRequired(input.injuredKind, input.severity) &&
    input.notificationCount === 0
  )
    throw ruleError(
      'incident_notification_required',
      'Ağır yaralanmada veliye bildirim kaydedilmeden tutanak kesinleşmez.',
      [],
    )
}

/**
 * Veli bildirimi (K-493): yalnız öğrencinin tutanağında; an olaydan önce ve şimdiden sonra olamaz;
 * bildiren kurumun etkin personeli; bir tutanakta en çok 10 bildirim. Dış gönderim yoktur.
 */
export function planIncidentNotification(
  report: { injuredKind: InjuredKind; occurredAt: string; notificationCount: number },
  input: IncidentNotificationFields,
  checks: { now: Date; notifiedBy: IncidentStaffMember },
): { notifiedAt: string } {
  if (report.injuredKind !== 'student')
    throw ruleError(
      'incident_notification_not_student',
      'Veli bildirimi yalnız öğrencinin tutanağına kaydedilir.',
      [],
    )
  if (report.notificationCount >= INCIDENT_NOTIFICATIONS_MAX)
    throw ruleError(
      'incident_notification_limit',
      `Bir tutanağa en çok ${String(INCIDENT_NOTIFICATIONS_MAX)} bildirim kaydedilir.`,
      [],
    )
  const at = input.notifiedAt === null ? checks.now : new Date(input.notifiedAt)
  if (at.getTime() > checks.now.getTime())
    throw ruleError('incident_notification_in_future', 'Bildirim anı şimdiden sonra olamaz.', [
      'notifiedAt',
    ])
  if (at.getTime() < Date.parse(report.occurredAt))
    throw ruleError('incident_notification_before_incident', 'Bildirim anı olaydan önce olamaz.', [
      'notifiedAt',
    ])
  assertStaff(checks.notifiedBy, 'notified_by', 'Bildiren', ['notifiedByMembershipId'])
  return { notifiedAt: at.toISOString() }
}

/** Ek not (K-493): yalnız kesinleşmiş tutanağa; taslak doğrudan düzeltilir. En çok 50 not. */
export function assertIncidentAddendum(report: { status: IncidentStatus; addendumCount: number }) {
  if (report.status !== 'finalized')
    throw ruleError(
      'incident_addendum_draft',
      'Taslak tutanak doğrudan düzeltilir; ek not kesinleşmiş tutanağa yazılır.',
      [],
    )
  if (report.addendumCount >= INCIDENT_ADDENDA_MAX)
    throw ruleError(
      'incident_addendum_limit',
      `Bir tutanağa en çok ${String(INCIDENT_ADDENDA_MAX)} ek not yazılır.`,
      [],
    )
}

// --- Erişim --------------------------------------------------------------------------------------

export interface IncidentAccess {
  /** Tutanağı okur (yönetici ya da açan). */
  read: boolean
  /** Sağlık grubunu okur (K-494). */
  health: boolean
  /** Taslağı düzeltir ve kesinleştirir. */
  edit: boolean
  /** Veli bildirimi kaydeder. */
  notify: boolean
  /** Ek notları okur ve yazar, tutanak PDF'ini basar. */
  manage: boolean
}

/**
 * Erişim matrisi (K-494): yönetici her tutanakta her şeyi; açan personel (öğretmen, ön büro) kendi
 * tutanağını okur, bildirim kaydeder, taslağı düzeltip kesinleştirir; sağlık grubunu yalnız taslakta
 * görür. Başkasının tutanağı ona yoktur (404). Ek not ve PDF yalnız yöneticidedir.
 */
export function incidentAccess(
  actor: { role: string; userId: string },
  report: { createdByUserId: string; status: IncidentStatus },
): IncidentAccess {
  if (actor.role === 'yonetici')
    return { read: true, health: true, edit: report.status === 'draft', notify: true, manage: true }
  const own =
    (STAFF_ROLES as readonly string[]).includes(actor.role) &&
    report.createdByUserId === actor.userId
  if (!own) return { read: false, health: false, edit: false, notify: false, manage: false }
  const draft = report.status === 'draft'
  return { read: true, health: draft, edit: draft, notify: true, manage: false }
}

/**
 * Veli özeti (K-495): yalnız kesinleşmiş öğrenci tutanağından olay anı, yer, tür, yaralanma
 * bölgesi, şiddet, yapılan ilk müdahale, sevk ve bildirimler. Açıklama (başka öğrencileri
 * anabilir), tanıklar, sorumlu, yaralanma notu ve ek notlar veliye gitmez.
 */
export function guardianIncidentSummary<
  N extends { notifiedAt: string; channel: IncidentNotificationChannel },
>(report: {
  id: string
  studentId: string
  occurredAt: string
  location: string
  kind: IncidentKind
  health: IncidentHealth
  finalizedAt: string
  notifications: readonly N[]
}) {
  return {
    id: report.id,
    studentId: report.studentId,
    occurredAt: report.occurredAt,
    location: report.location,
    kind: report.kind,
    bodyParts: report.health.bodyParts,
    severity: report.health.severity,
    firstAidAction: report.health.firstAidAction,
    referral: report.health.referral,
    finalizedAt: report.finalizedAt,
    notifications: report.notifications.map(({ notifiedAt, channel }) => ({ notifiedAt, channel })),
  }
}
