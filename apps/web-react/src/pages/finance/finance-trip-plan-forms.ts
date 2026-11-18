// Gezi planı formlarının saf yardımcıları (DOM-FIN-111; ON-155). Form değerleri metindir; gövdeye
// çevrilirken boş isteğe bağlı alan `null`, öğrenci sayısı sayı, gün ve saat (Türkiye saati,
// `datetime-local`) ISO an olur. Kural metinleri core şemasındandır; sunucu aynı kuralları yeniden
// denetler.
import { z } from 'zod'
import type {
  CreateTripPlanBody,
  TripPlanDetail,
  UpdateTripPlanBody,
} from '@kampus/react-shared/use-finance-trip-plans.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  normalizeTripPlate,
  TRIP_CONTACTS_MAX,
  TRIP_PLAN_STATUS_LABELS,
  TRIP_RISKS_MAX,
  TRIP_STAFF_MAX,
  TRIP_STAFF_ROLES,
  TRIP_STOPS_MAX,
  TRIP_STUDENTS_MAX,
  TRIP_TRANSPORT_TYPES,
  tripPlanNoticeSchema,
  tripPlanReasonSchema,
  type TripPlanStatus,
} from '@kampus/school-core/lib/finance-trip-plans.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { istanbulToIso, isoToIstanbul } from '../../lib/istanbul-time.ts'

export const TRIP_PLAN_STATUS_VIEW: Record<TripPlanStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: TRIP_PLAN_STATUS_LABELS.draft, tone: 'gray' },
  submitted: { label: TRIP_PLAN_STATUS_LABELS.submitted, tone: 'amber' },
  approved: { label: TRIP_PLAN_STATUS_LABELS.approved, tone: 'green' },
  rejected: { label: TRIP_PLAN_STATUS_LABELS.rejected, tone: 'red' },
  completed: { label: TRIP_PLAN_STATUS_LABELS.completed, tone: 'purple' },
  cancelled: { label: TRIP_PLAN_STATUS_LABELS.cancelled, tone: 'gray' },
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())
const PHONE = /^0\d{10}$/
const compactPhone = (value: string) => value.replace(/[\s()-]+/g, '')
const PLATE = /^(0[1-9]|[1-7]\d|8[01])[A-Z]{1,3}\d{2,5}$/
const text = (min: number, max: number, message: string) =>
  z
    .string()
    .refine((value) => value.trim().length >= min, message)
    .refine(
      (value) => value.trim().length <= max,
      `En fazla ${String(max)} karakter girebilirsiniz.`,
    )
const optional = (max: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length <= max,
      `En fazla ${String(max)} karakter girebilirsiniz.`,
    )

export const tripPlanFormSchema = z
  .object({
    name: text(3, 120, 'Adı en az 3 karakterle yazın (ör. Anıtkabir gezisi).'),
    purpose: text(10, 2000, 'Amacı ve kazanımı en az 10 karakterle yazın.'),
    departureAt: z.string().min(1, 'Çıkış gün ve saatini seçin.'),
    returnAt: z.string().min(1, 'Dönüş gün ve saatini seçin.'),
    expectedStudentCount: z
      .string()
      .refine(
        (value) =>
          /^\d{1,4}$/.test(value.trim()) &&
          Number(value) >= 1 &&
          Number(value) <= TRIP_STUDENTS_MAX,
        `Öğrenci sayısını 1–${String(TRIP_STUDENTS_MAX)} arası girin.`,
      ),
    stops: z
      .array(
        z.object({
          place: text(2, 120, 'Yeri en az 2 karakterle yazın.'),
          note: optional(300),
        }),
      )
      .min(1, 'Güzergâha en az bir durak ekleyin.')
      .max(TRIP_STOPS_MAX, `En fazla ${String(TRIP_STOPS_MAX)} durak eklenebilir.`),
    staff: z
      .array(
        z.object({
          membershipId: z.string().min(1, 'Öğretmen seçin.'),
          role: z.enum(TRIP_STAFF_ROLES, 'Görevi seçin.'),
        }),
      )
      .min(1, 'En az bir görevli öğretmen ekleyin.')
      .max(TRIP_STAFF_MAX, `En fazla ${String(TRIP_STAFF_MAX)} görevli eklenebilir.`),
    transportType: z.enum(TRIP_TRANSPORT_TYPES, 'Ulaşım türünü seçin.'),
    company: optional(120),
    plate: z
      .string()
      .refine(
        (value) => value.trim() === '' || PLATE.test(normalizeTripPlate(value)),
        'Plakayı 34 ABC 123 biçiminde girin.',
      ),
    driverName: optional(120),
    driverPhone: z
      .string()
      .refine(
        (value) => value.trim() === '' || PHONE.test(compactPhone(value)),
        'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
      ),
    risks: z
      .array(
        z.object({
          risk: text(3, 300, 'Riski en az 3 karakterle yazın.'),
          measure: text(3, 500, 'Önlemi en az 3 karakterle yazın.'),
        }),
      )
      .max(TRIP_RISKS_MAX, `En fazla ${String(TRIP_RISKS_MAX)} risk maddesi eklenebilir.`),
    contacts: z
      .array(
        z.object({
          name: text(2, 120, 'Adı en az 2 karakterle yazın.'),
          phone: z
            .string()
            .refine(
              (value) => PHONE.test(compactPhone(value)),
              'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
            ),
          relation: optional(80),
        }),
      )
      .max(TRIP_CONTACTS_MAX, `En fazla ${String(TRIP_CONTACTS_MAX)} kişi eklenebilir.`),
    paidActivityId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.departureAt !== '' && value.returnAt !== '' && value.returnAt <= value.departureAt)
      context.addIssue({
        code: 'custom',
        path: ['returnAt'],
        message: 'Dönüş anı çıkıştan sonra olmalıdır.',
      })
    const seen = new Set<string>()
    value.staff.forEach((member, index) => {
      if (member.membershipId !== '' && seen.has(member.membershipId))
        context.addIssue({
          code: 'custom',
          path: ['staff', index, 'membershipId'],
          message: 'Aynı öğretmen iki kez eklenemez.',
        })
      seen.add(member.membershipId)
    })
    if (value.staff.length > 0 && !value.staff.some((member) => member.role === 'lead'))
      context.addIssue({
        code: 'custom',
        path: ['staff', 0, 'role'],
        message: 'En az bir sorumlu öğretmen seçin.',
      })
  })
export type TripPlanFormValues = z.input<typeof tripPlanFormSchema>

/** Yeni planda çıkış iki hafta sonra 08:00, dönüş aynı gün 18:00; düzeltmede planın değerleri. */
export function tripPlanDefaults(today: string, plan?: TripPlanDetail): TripPlanFormValues {
  if (!plan) {
    const day = dayKey(Date.parse(`${today}T09:00:00.000Z`) + 14 * 86_400_000)
    return {
      name: '',
      purpose: '',
      departureAt: `${day}T08:00`,
      returnAt: `${day}T18:00`,
      expectedStudentCount: '',
      stops: [{ place: '', note: '' }],
      staff: [{ membershipId: '', role: 'lead' }],
      transportType: 'bus',
      company: '',
      plate: '',
      driverName: '',
      driverPhone: '',
      risks: [],
      contacts: [],
      paidActivityId: '',
    }
  }
  return {
    name: plan.name,
    purpose: plan.purpose,
    departureAt: isoToIstanbul(plan.departureAt),
    returnAt: isoToIstanbul(plan.returnAt),
    expectedStudentCount: String(plan.expectedStudentCount),
    stops: plan.stops.map((stop) => ({ place: stop.place, note: stop.note ?? '' })),
    staff: plan.staff.map((member) => ({ membershipId: member.membershipId, role: member.role })),
    transportType: plan.transport.type,
    company: plan.transport.company ?? '',
    plate: plan.transport.plate ?? '',
    driverName: plan.transport.driverName ?? '',
    driverPhone: plan.transport.driverPhone ?? '',
    risks: plan.risks.map((item) => ({ risk: item.risk, measure: item.measure })),
    contacts: plan.emergencyContacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      relation: contact.relation ?? '',
    })),
    paidActivityId: plan.paidActivity?.id ?? '',
  }
}

/** Form değerleri ve ulaşım belgesi → plan gövdesi. */
export function tripPlanBody(
  values: TripPlanFormValues,
  documentFileId: string | null,
): CreateTripPlanBody {
  const plate = normalizeTripPlate(values.plate)
  const phone = compactPhone(values.driverPhone)
  return {
    name: values.name.trim(),
    purpose: values.purpose.trim(),
    departureAt: istanbulToIso(values.departureAt),
    returnAt: istanbulToIso(values.returnAt),
    expectedStudentCount: Number(values.expectedStudentCount.trim()),
    stops: values.stops.map((stop) => ({ place: stop.place.trim(), note: blankToNull(stop.note) })),
    staff: values.staff.map((member) => ({ membershipId: member.membershipId, role: member.role })),
    transport: {
      type: values.transportType,
      company: blankToNull(values.company),
      plate: plate === '' ? null : plate,
      driverName: blankToNull(values.driverName),
      driverPhone: phone === '' ? null : phone,
      documentFileId,
    },
    risks: values.risks.map((item) => ({ risk: item.risk.trim(), measure: item.measure.trim() })),
    emergencyContacts: values.contacts.map((contact) => ({
      name: contact.name.trim(),
      phone: compactPhone(contact.phone),
      relation: blankToNull(contact.relation),
    })),
    paidActivityId: values.paidActivityId === '' ? null : values.paidActivityId,
  }
}

/** Düzeltmede yalnız değişen alanlar gider; değişiklik yoksa boş nesne. */
export function tripPlanChanges(
  values: TripPlanFormValues,
  documentFileId: string | null,
  plan: TripPlanDetail,
): UpdateTripPlanBody {
  const next = tripPlanBody(values, documentFileId)
  const before = tripPlanBody(tripPlanDefaults(dayKey(), plan), plan.transport.documentFileId)
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof CreateTripPlanBody)[])
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) changes[key] = next[key]
  return changes as UpdateTripPlanBody
}

const FIELD_OF: Record<string, keyof TripPlanFormValues> = {
  emergencyContacts: 'contacts',
  transport: 'transportType',
}

/**
 * Sunucu hata yolunu form alanına çevirir: `staff.0.membershipId` → `staff.0.membershipId`,
 * `transport.plate` → `plate`, `emergencyContacts.1.phone` → `contacts.1.phone`. Bilinmeyen yol
 * `undefined` (kök hata).
 */
export function tripPlanFormField(name: string): string | undefined {
  const parts = name.split('.')
  const [first, ...rest] = parts
  if (first === undefined) return undefined
  if (first === 'transport') {
    const field = rest[0]
    if (field === 'type') return 'transportType'
    if (
      field === 'company' ||
      field === 'plate' ||
      field === 'driverName' ||
      field === 'driverPhone'
    )
      return field
    return 'transportType'
  }
  const mapped = FIELD_OF[first] ?? first
  if (!(mapped in tripPlanFormSchema.shape)) return undefined
  return [mapped, ...rest].join('.')
}

export const reasonFormSchema = tripPlanReasonSchema
export type ReasonFormValues = z.input<typeof tripPlanReasonSchema>

export const noticeFormSchema = z.object({
  notifiedOn: tripPlanNoticeSchema.shape.notifiedOn,
  reference: z.string().max(60, 'En fazla 60 karakter girebilirsiniz.'),
})
export type NoticeFormValues = z.input<typeof noticeFormSchema>

export const noticeBody = (values: NoticeFormValues) => ({
  notifiedOn: values.notifiedOn,
  reference: blankToNull(values.reference),
})
