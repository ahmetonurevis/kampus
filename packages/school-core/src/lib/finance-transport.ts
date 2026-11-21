import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { normalizeTripPlate, tripPlateLabel, TRIP_PLATE_PATTERN } from './finance-trip-plans.ts'
import { maskPhone } from './parent-contact.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Servis güzergâhı ve öğrenci–durak ataması (docs/domain/finans.md DOM-FIN-142; ON-098; IST-099).
 * Araç plaka, kapasite, sürücü adı ve telefonu ile isteğe bağlı rehber personel (kurum üyeliği)
 * taşır; sürücü telefonu yalnız yazılır, her yanıtta maskeli döner (K-481). Güzergâh bir yönde
 * (sabah ya da akşam) bir araçla gider; duraklar sıralıdır ve durak adı ya da semtiyle saat taşır,
 * açık adres alınmaz (KVKK en az veri; K-481, H-105). Öğrenci bir durağa atanır: aynı yönde tek
 * güzergâhta olur ve güzergâhın araç kapasitesi aşılamaz (409; K-482).
 *
 * Kurumun eski iş akışı koleksiyonları (`transportRoutes`, `transportAssignments`; Oğuzhan'ın okul
 * yaşamı ekranı) bu modelden ayrıdır ve değişmez; modül anahtarı (`transport`) ve rol kapsamı
 * (`transportAssignments`) ortaktır. Fonksiyonlar saftır.
 */

/** Araç, güzergâh ve atama okuma ve yazma: yönetici ve ön büro (K-482). */
export const FINANCE_TRANSPORT_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Kendi (çocuğunun) servis bilgisini okuyan roller; kapsam sunucuda daralır (K-482). */
export const FINANCE_TRANSPORT_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]

export const TRANSPORT_DIRECTIONS = ['morning', 'evening'] as const
export type TransportDirection = (typeof TRANSPORT_DIRECTIONS)[number]
export const TRANSPORT_DIRECTION_LABELS = {
  morning: 'Sabah',
  evening: 'Akşam',
} as const satisfies Record<TransportDirection, string>

export const TRANSPORT_VEHICLE_CAPACITY_MAX = 80
export const TRANSPORT_DRIVER_NAME_MAX = 120
export const TRANSPORT_ROUTE_NAME_MAX = 120
export const TRANSPORT_STOP_NAME_MAX = 80
export const TRANSPORT_ROUTE_STOPS_MAX = 40
export const TRANSPORT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const TRANSPORT_PHONE_PATTERN = /^0\d{10}$/

// --- Şemalar -------------------------------------------------------------------------------------

const maxMessage = (max: number) => `En çok ${String(max)} karakter girebilirsiniz.`
const nameSchema = (missing: string, max: number) =>
  z.string(missing).trim().min(2, 'En az 2 karakter girin.').max(max, maxMessage(max))
const idSchema = (missing: string) => z.string(missing).trim().min(1, missing).max(100)

const plateSchema = z
  .string('Plakayı girin.')
  .transform(normalizeTripPlate)
  .pipe(z.string().regex(TRIP_PLATE_PATTERN, 'Plakayı 34 ABC 123 biçiminde girin.'))
  .describe('Araç plakası (34 ABC 123); boşluksuz büyük harfle saklanır, kurumda tekildir')

const capacitySchema = z
  .number('Kapasiteyi girin.')
  .int('Kapasite tam sayı olmalı.')
  .min(1, 'Kapasite en az 1 olmalı.')
  .max(
    TRANSPORT_VEHICLE_CAPACITY_MAX,
    `Kapasite en çok ${String(TRANSPORT_VEHICLE_CAPACITY_MAX)} olabilir.`,
  )
  .describe('Öğrenci koltuk sayısı (1–80); güzergâh başına aşılamaz')

const phoneSchema = z
  .string('Sürücü telefonunu girin.')
  .transform((value) => value.replace(/[\s()-]+/g, ''))
  .pipe(
    z.string().regex(TRANSPORT_PHONE_PATTERN, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.'),
  )

const guideSchema = idSchema('Rehber personeli seçin.')
  .nullable()
  .describe(
    'Rehber personelin kurum üyeliği (isteğe bağlı; etkin yönetici, öğretmen ya da ön büro)',
  )

export const transportVehicleCreateSchema = z.strictObject({
  plate: plateSchema,
  capacity: capacitySchema,
  // kvkk: K (sürücü kimliği)
  driverName: nameSchema('Sürücünün adını girin.', TRANSPORT_DRIVER_NAME_MAX).describe(
    'Sürücünün adı soyadı (2–120)',
  ),
  // kvkk: K (sürücü iletişimi)
  driverPhone: phoneSchema.describe(
    'Sürücü telefonu (0XXXXXXXXXX); yalnız yazılır, yanıtlarda maskeli döner (K-481)',
  ),
  guideMembershipId: guideSchema.default(null),
})
export type TransportVehicleCreateInput = z.input<typeof transportVehicleCreateSchema>
export type TransportVehicleCreateFields = z.output<typeof transportVehicleCreateSchema>

export const transportVehicleUpdateSchema = z
  .strictObject({
    plate: plateSchema.optional(),
    capacity: capacitySchema.optional(),
    driverName: nameSchema('Sürücünün adını girin.', TRANSPORT_DRIVER_NAME_MAX)
      .optional()
      .describe('Sürücünün adı soyadı (2–120)'),
    driverPhone: phoneSchema
      .optional()
      .describe('Yeni sürücü telefonu; gönderilmezse değişmez (tam numara okunmaz, K-481)'),
    guideMembershipId: guideSchema.optional(),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((field) => field === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type TransportVehicleUpdateFields = z.output<typeof transportVehicleUpdateSchema>

const stopSchema = z.strictObject({
  id: z
    .uuid('Durak geçersiz.')
    .optional()
    .describe('Var olan durak (düzenlemede); yoksa yeni durak açılır'),
  name: nameSchema('Durak adını girin.', TRANSPORT_STOP_NAME_MAX).describe(
    'Durak adı ya da semt (2–80); açık adres yazılmaz (K-481)',
  ),
  time: z
    .string('Durak saatini girin.')
    .regex(TRANSPORT_TIME_PATTERN, 'Saati SS:DD biçiminde girin.')
    .describe('Duraktan geçiş saati (SS:DD, Europe/Istanbul)'),
})
export type TransportStopInput = z.output<typeof stopSchema>

const stopsSchema = z
  .array(stopSchema, 'Durakları girin.')
  .min(1, 'En az bir durak girin.')
  .max(
    TRANSPORT_ROUTE_STOPS_MAX,
    `Güzergâhta en çok ${String(TRANSPORT_ROUTE_STOPS_MAX)} durak olur.`,
  )
  .superRefine((stops, context) => {
    const names = new Set<string>()
    const ids = new Set<string>()
    stops.forEach((stop, index) => {
      const key = stop.name.toLocaleLowerCase('tr-TR')
      if (names.has(key))
        context.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'Aynı durak iki kez yazılmış.',
        })
      names.add(key)
      if (stop.id !== undefined) {
        if (ids.has(stop.id))
          context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Durak yinelenmiş.' })
        ids.add(stop.id)
      }
      const previous = stops[index - 1]
      if (previous !== undefined && stop.time < previous.time)
        context.addIssue({
          code: 'custom',
          path: [index, 'time'],
          message: 'Durak saatleri sırayla ilerlemeli; bu saat önceki duraktan önce.',
        })
    })
  })
  .describe('Sıralı duraklar (1–40); saatler sırayla ilerler, ad güzergâhta tekildir')

const routeNameSchema = nameSchema('Güzergâh adını girin.', TRANSPORT_ROUTE_NAME_MAX).describe(
  'Güzergâh adı (2–120); aynı yönde kurumda tekil',
)
const vehicleIdSchema = z.uuid('Aracı seçin.').describe('Güzergâhın aracı')

export const transportRouteCreateSchema = z.strictObject({
  name: routeNameSchema,
  direction: z
    .enum(TRANSPORT_DIRECTIONS, 'Yönü seçin.')
    .describe('`morning` sabah (evden okula), `evening` akşam (okuldan eve); sonradan değişmez'),
  vehicleId: vehicleIdSchema,
  stops: stopsSchema.refine(
    (stops) => stops.every((stop) => stop.id === undefined),
    'Yeni güzergâhın durağında kimlik olmaz.',
  ),
})
export type TransportRouteCreateFields = z.output<typeof transportRouteCreateSchema>

export const transportRouteUpdateSchema = z
  .strictObject({
    name: routeNameSchema.optional(),
    vehicleId: vehicleIdSchema.optional(),
    stops: stopsSchema
      .optional()
      .describe(
        'Bütün durak listesi, yeni sırasıyla; var olan durak `id` ile korunur, listede olmayan kaldırılır',
      ),
  })
  .superRefine((value, context) => {
    if (value.name === undefined && value.vehicleId === undefined && value.stops === undefined)
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type TransportRouteUpdateFields = z.output<typeof transportRouteUpdateSchema>

export const transportAssignSchema = z.strictObject({
  studentId: idSchema('Öğrenciyi seçin.').describe('Öğrencinin kaydı'),
  stopId: z.uuid('Durağı seçin.').describe('Güzergâhtaki durak'),
})
export type TransportAssignFields = z.output<typeof transportAssignSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflict = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

/** Seçilen üyelik: seçilmediyse `undefined`, kurumda yoksa `null`. */
export type MemberCheck = { role: string; active: boolean } | null | undefined

/** Rehber personel kurumun etkin personeli olmalı (K-481). */
export function assertTransportGuide(guide: MemberCheck): void {
  if (guide === undefined) return
  const path = ['guideMembershipId']
  if (guide === null)
    throw ruleError('transport_guide_not_found', 'Rehber personel bulunamadı.', path)
  if (!isStaffRole(guide.role))
    throw ruleError('transport_guide_not_staff', 'Rehber kurum personeli olmalı.', path)
  if (!guide.active)
    throw ruleError('transport_guide_inactive', 'Rehber personelin hesabı pasif.', path)
}

const plateTakenError = () =>
  conflict('transport_plate_taken', 'Bu plaka başka bir araçta kayıtlı.', ['plate'])

/** Yeni araç (K-481): plaka kurumda tekil (409), rehber etkin personel. */
export function planTransportVehicle(checks: { plateTaken: boolean; guide: MemberCheck }): void {
  if (checks.plateTaken) throw plateTakenError()
  assertTransportGuide(checks.guide)
}

export interface StoredVehicleFields {
  plate: string
  capacity: number
  driverName: string
  driverPhone: string
  guideMembershipId: string | null
}

/**
 * Araç düzenleme (K-481, K-482): plaka tekil kalır; kapasite aracın herhangi bir güzergâhındaki
 * atanmış öğrenci sayısının altına inemez. Değişen alan adları döner; değişiklik yoksa 422.
 */
export function planTransportVehicleUpdate(
  current: StoredVehicleFields,
  input: TransportVehicleUpdateFields,
  checks: { plateTaken: boolean; guide: MemberCheck; maxRouteLoad: number },
): { next: StoredVehicleFields; changed: (keyof StoredVehicleFields)[] } {
  const next: StoredVehicleFields = {
    plate: input.plate ?? current.plate,
    capacity: input.capacity ?? current.capacity,
    driverName: input.driverName ?? current.driverName,
    driverPhone: input.driverPhone ?? current.driverPhone,
    guideMembershipId:
      input.guideMembershipId === undefined ? current.guideMembershipId : input.guideMembershipId,
  }
  const changed = (Object.keys(next) as (keyof StoredVehicleFields)[]).filter(
    (key) => next[key] !== current[key],
  )
  if (changed.length === 0) throw ruleError('transport_vehicle_unchanged', 'Araçta değişiklik yok.')
  if (changed.includes('plate') && checks.plateTaken) throw plateTakenError()
  if (changed.includes('guideMembershipId')) assertTransportGuide(checks.guide)
  if (next.capacity < checks.maxRouteLoad)
    throw ruleError(
      'transport_capacity_below_load',
      `Kapasite atanmış öğrenci sayısının (${String(checks.maxRouteLoad)}) altına inemez.`,
      ['capacity'],
    )
  return { next, changed }
}

/** Araç arşivi (K-482): etkin güzergâhta kullanılan araç arşivlenmez. */
export function assertTransportVehicleArchivable(activeRoutes: number): void {
  if (activeRoutes > 0)
    throw ruleError(
      'transport_vehicle_in_use',
      'Araç etkin bir güzergâhta kullanılıyor; önce güzergâhın aracını değiştirin ya da güzergâhı arşivleyin.',
    )
}

/** Güzergâhın aracı: kurumda ve arşivlenmemiş (`null` değilse). */
export type VehicleCheck = { capacity: number } | null

function assertVehicle(vehicle: VehicleCheck): asserts vehicle is { capacity: number } {
  if (vehicle === null)
    throw ruleError('transport_vehicle_not_found', 'Araç bulunamadı.', ['vehicleId'])
}

const routeNameTaken = () =>
  conflict('transport_route_name_taken', 'Bu yönde aynı adlı bir güzergâh var.', ['name'])

/** Yeni güzergâh (K-481): araç kurumda olmalı, ad aynı yönde tekil (409). */
export function planTransportRoute(checks: { vehicle: VehicleCheck; nameTaken: boolean }): void {
  assertVehicle(checks.vehicle)
  if (checks.nameTaken) throw routeNameTaken()
}

export interface StoredStop {
  id: string
  name: string
  time: string
  position: number
}

export interface StopPlan {
  insert: { name: string; time: string; position: number }[]
  update: StoredStop[]
  archive: string[]
}

/**
 * Durak listesinin yeni hâli (K-481, K-482): gelen sıra konumdur (1'den). Kimlikli durak
 * güzergâhın etkin durağı olmalı (422); listeden çıkan durakta atanmış öğrenci varsa 422.
 * Değişmeyen durak güncellenmez.
 */
export function planTransportStops(
  existing: readonly StoredStop[],
  input: readonly TransportStopInput[],
  assignedStopIds: ReadonlySet<string>,
): StopPlan {
  const byId = new Map(existing.map((stop) => [stop.id, stop]))
  const plan: StopPlan = { insert: [], update: [], archive: [] }
  input.forEach((stop, index) => {
    const position = index + 1
    if (stop.id === undefined) {
      plan.insert.push({ name: stop.name, time: stop.time, position })
      return
    }
    const current = byId.get(stop.id)
    if (current === undefined)
      throw ruleError('transport_stop_not_found', 'Durak bu güzergâhta bulunamadı.', [
        'stops',
        String(index),
        'id',
      ])
    if (current.name !== stop.name || current.time !== stop.time || current.position !== position)
      plan.update.push({ id: current.id, name: stop.name, time: stop.time, position })
  })
  const kept = new Set(input.flatMap((stop) => (stop.id === undefined ? [] : [stop.id])))
  for (const stop of existing) {
    if (kept.has(stop.id)) continue
    if (assignedStopIds.has(stop.id))
      throw ruleError(
        'transport_stop_has_students',
        `"${stop.name}" durağında atanmış öğrenci var; önce atamaları kaldırın.`,
        ['stops'],
      )
    plan.archive.push(stop.id)
  }
  return plan
}

/**
 * Güzergâh düzenleme (K-481, K-482): yön değişmez; yeni araç kurumda olmalı ve kapasitesi
 * güzergâhtaki atanmış öğrenci sayısından az olamaz; ad aynı yönde tekil kalır.
 */
export function planTransportRouteUpdate(
  input: TransportRouteUpdateFields,
  checks: { vehicle: VehicleCheck | undefined; nameTaken: boolean; load: number },
): void {
  if (input.vehicleId !== undefined) {
    const vehicle = checks.vehicle ?? null
    assertVehicle(vehicle)
    if (vehicle.capacity < checks.load)
      throw ruleError(
        'transport_capacity_below_load',
        `Aracın kapasitesi (${String(vehicle.capacity)}) güzergâhtaki öğrenci sayısından (${String(checks.load)}) az.`,
        ['vehicleId'],
      )
  }
  if (input.name !== undefined && checks.nameTaken) throw routeNameTaken()
}

/** Güzergâh arşivi (K-482): atanmış öğrencisi olan güzergâh arşivlenmez. */
export function assertTransportRouteArchivable(load: number): void {
  if (load > 0)
    throw ruleError(
      'transport_route_has_students',
      'Güzergâhta atanmış öğrenci var; önce atamaları kaldırın.',
    )
}

/** Atanacak öğrenci: kurumda yoksa `null`. */
export type StudentCheck = { active: boolean } | null

export function assertActiveStudent(student: StudentCheck, prefix: string): void {
  if (student === null)
    throw ruleError(`${prefix}_student_not_found`, 'Öğrenci bulunamadı.', ['studentId'])
  if (!student.active)
    throw ruleError(`${prefix}_student_inactive`, 'Öğrencinin kaydı etkin değil.', ['studentId'])
}

export interface TransportAssignChecks {
  student: StudentCheck
  stopOnRoute: boolean
  /** Güzergâhtaki etkin atama sayısı (kurum kilidi altında). */
  load: number
  capacity: number
  /** Öğrencinin aynı yöndeki etkin ataması; yoksa `null`. */
  sameDirection: { routeId: string } | null
  routeId: string
}

/**
 * Öğrenci–durak ataması (K-482): kurumun etkin öğrencisi; durak güzergâhta olmalı; aynı yönde
 * ikinci güzergâh ya da aynı güzergâha ikinci atama 409; araç kapasitesi dolu 409.
 */
export function planTransportAssignment(checks: TransportAssignChecks): void {
  assertActiveStudent(checks.student, 'transport')
  if (!checks.stopOnRoute)
    throw ruleError('transport_stop_not_on_route', 'Durak bu güzergâhta bulunmuyor.', ['stopId'])
  if (checks.sameDirection !== null)
    throw checks.sameDirection.routeId === checks.routeId
      ? conflict('transport_student_already_assigned', 'Öğrenci bu güzergâha zaten atanmış.', [
          'studentId',
        ])
      : conflict(
          'transport_student_direction_taken',
          'Öğrenci bu yönde başka bir güzergâhta; önce o atamayı kaldırın.',
          ['studentId'],
        )
  if (checks.load >= checks.capacity)
    throw conflict(
      'transport_capacity_full',
      `Araç kapasitesi dolu (${String(checks.load)}/${String(checks.capacity)}).`,
    )
}

// --- Görünüm -------------------------------------------------------------------------------------

/** Sürücü telefonu yalnız maskeli gösterilir (K-481): `0532 *** ** 67`. */
export const maskDriverPhone = (phone: string) => maskPhone(phone)

/** Saklanan plakayı okunur yazar: `34ABC123` → `34 ABC 123`. */
export const transportPlateLabel = (plate: string) => tripPlateLabel(plate)

/** Doluluk metni: `12/16`. */
export const transportLoadLabel = (load: number, capacity: number) =>
  `${String(load)}/${String(capacity)}`
