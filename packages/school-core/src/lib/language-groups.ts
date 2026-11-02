import { z } from 'zod'

import type { CefrLevel } from '../content/taxonomy.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { ageOn, ADULT_AGE, isCalendarDay } from './age.ts'
import type { CoordinatorScope } from './coordinator-duties.ts'
import {
  assertCourseManager,
  COURSE_GROUP_CAPACITY_MAX,
  LESSON_HOUR_MINUTES,
  type Course,
  type CourseManager,
} from './courses.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Dil okulunda grup açma ve planlama (IST-077; docs/domain/dil-okulu.md DOM-DIL-003, -008,
 * -040…045).
 *
 * - Grup, etkin bir kurun (`courseId`) tarihli açılışıdır: ad, yaş bandı, öğretmen, derslik ya da
 *   çevrim içi, haftalık program kalıbı (gün + başlangıç saati), başlangıç tarihi ve kapasite
 *   (≤ 18, ≤ kurun en çok mevcudu). Seviye ve oturum uzunluğu kurdandır, grupta saklanmaz.
 * - Haftalık oturum sayısı kurun haftalık saatinden gelir (oturum 45 ya da 90 dk); bitiş tarihi
 *   kurun toplam saatinin oturumlara yayılmasıyla hesaplanır (`groupSessions`).
 * - Saklanan durum `planned` → `open`, ya da `cancelled`. `running` ve `completed` tarihten
 *   türetilir (`groupStatus`, Europe/Istanbul günü): hesaplanabilen değer saklanmaz.
 * - Öğretmen ve derslik, kurumun kapanmamış diğer gruplarıyla aynı gün ve saatte çakışamaz.
 * - Kursiyerin gruba yerleşmesi kayıt/satış akışıdır (ON-058): burada yalnız kural
 *   (`planGroupPlacement`) ve bekleme listesinden sıradaki teklifin önerisi
 *   (`suggestWaitlistOffers`) vardır.
 * - Yalnız `language_school` kurumunda bulunur; okulda her işlem 404 `module_unavailable_for_type`.
 *
 * Fonksiyonlar saftır, girdileri değiştirmez; `now` dışarıdan gelir. Kimlik üretimi, yükleme ve
 * yazma servistedir.
 */

z.config(z.locales.tr())

/** Saklanan yaşam döngüsü. */
export const GROUP_STATES = ['planned', 'open', 'cancelled'] as const
export type GroupState = (typeof GROUP_STATES)[number]

/** Görünen durum: `running` ve `completed` açık grubun tarihlerinden türetilir. */
export const GROUP_STATUSES = ['planned', 'open', 'running', 'completed', 'cancelled'] as const
export type GroupStatus = (typeof GROUP_STATUSES)[number]
export const GROUP_STATUS_LABELS = {
  planned: 'Planlandı',
  open: 'Açıldı',
  running: 'Devam ediyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
} as const satisfies Record<GroupStatus, string>

/** Yaş bandı (DOM-DIL-041): çocuk, genç 12–17, yetişkin 18+. */
export const GROUP_AGE_BANDS = ['child', 'teen', 'adult'] as const
export type GroupAgeBand = (typeof GROUP_AGE_BANDS)[number]
export const GROUP_AGE_BAND_LABELS = {
  child: 'Çocuk',
  teen: 'Genç (12–17)',
  adult: 'Yetişkin (18+)',
} as const satisfies Record<GroupAgeBand, string>
export const TEEN_MIN_AGE = 12

export const GROUP_DELIVERIES = ['in_person', 'online'] as const
export type GroupDelivery = (typeof GROUP_DELIVERIES)[number]

/** Haftanın günü ISO 8601: 1 Pazartesi … 7 Pazar. */
export const WEEKDAY_LABELS = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
} as const

/** Yasal çalışma aralığı (DOM-DIL-003, ÖÖKY md. 10/6-7), dakika: 07.00–23.00. */
export const LEGAL_DAY_START_MINUTES = 7 * 60
export const LEGAL_DAY_END_MINUTES = 23 * 60
/** Zorunlu eğitim çağındaki kursiyer varsa dersler 21.00'de biter (DOM-DIL-003). */
export const MINOR_DAY_END_MINUTES = 21 * 60
/** Bekleme listesi teklifinin geçerlilik süresi (DOM-DIL-043). */
export const WAITLIST_OFFER_HOURS = 48

export const GROUP_NAME_MAX = 120
export const GROUP_ROOM_MAX = 60
export const GROUP_REASON_MAX = 500

export type GroupSlot = { weekday: number; startTime: string }

export type LanguageGroup = {
  id: string
  courseId: string
  name: string
  ageBand: GroupAgeBand
  /** Öğretmenin kurumdaki üyeliği (`ogretmen`); planlamada boş olabilir, açılışta zorunlu. */
  teacherMembershipId: string | null
  delivery: GroupDelivery
  /** Derslik adı; çevrim içi grupta `null`, yüz yüzede açılışta zorunlu. */
  room: string | null
  /** Haftalık kalıp; gün ve saate göre sıralı. Saat Europe/Istanbul duvar saatidir. */
  schedule: readonly GroupSlot[]
  startDate: string
  /** Son oturumun günü; kurun toplam saatinden hesaplanır (`groupEndDate`). */
  endDate: string
  capacity: number
  state: GroupState
  openedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  /** Birleştirmede kapanan grubun kursiyerlerinin taşındığı grup (DOM-DIL-042). */
  mergedIntoGroupId: string | null
}

export const GROUP_MEMBER_STATUSES = ['active', 'frozen'] as const
export type GroupMemberStatus = (typeof GROUP_MEMBER_STATUSES)[number]

/** Grubun kursiyeri; kayıt `students` koleksiyonundaki öğrencidir. Dondurulan kapasiteye sayılmaz. */
export type GroupMember = {
  groupId: string
  // kvkk: K
  studentId: string
  status: GroupMemberStatus
  joinedAt: string
}

export const WAITLIST_STATUSES = ['waiting', 'offered', 'accepted', 'expired', 'withdrawn'] as const
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number]

/**
 * Bekleme sırası satırı (DOM-DIL-043): bir grubun (`groupId`) ya da kurun herhangi bir grubunun
 * (`groupId = null`) sırası. Bekleyen kayıtlı öğrenci ya da adaydır (tam biri). Teklif yapılınca
 * `offerGroupId` teklif edilen gruptur ve teklif `offerExpiresAt`'e kadar kapasiteye sayılır.
 */
export type WaitlistEntry = {
  id: string
  courseId: string
  groupId: string | null
  // kvkk: K
  studentId: string | null
  // kvkk: K
  prospectId: string | null
  requestedAt: string
  status: WaitlistStatus
  offerGroupId: string | null
  offeredAt: string | null
  offerExpiresAt: string | null
}

// --- Şemalar ------------------------------------------------------------------------------

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const name = z
  .string()
  .trim()
  .min(1, 'Grup adını yazın.')
  .max(GROUP_NAME_MAX, `Grup adı en çok ${GROUP_NAME_MAX} karakter.`)
const ageBand = z.enum(GROUP_AGE_BANDS, { error: 'Bir yaş bandı seçin.' })
const membershipRef = z.string().trim().min(1, 'Öğretmen seçin.').max(100)
const delivery = z.enum(GROUP_DELIVERIES, { error: 'Yüz yüze ya da çevrim içi seçin.' })
const room = z
  .string()
  .trim()
  .min(1, 'Derslik adını yazın.')
  .max(GROUP_ROOM_MAX, `Derslik adı en çok ${GROUP_ROOM_MAX} karakter.`)
const day = z.string().refine(isCalendarDay, 'Tarih YYYY-AA-GG biçiminde gerçek bir gün olmalı.')
export const groupSlotSchema = z.strictObject({
  weekday: z
    .number({ error: 'Gün seçin.' })
    .int('Gün seçin.')
    .min(1, 'Gün seçin.')
    .max(7, 'Gün seçin.'),
  startTime: z.string().regex(TIME_PATTERN, 'Saat SS:DD biçiminde olmalı.'),
})
const schedule = z
  .array(groupSlotSchema)
  .min(1, 'Haftalık programa en az bir ders ekleyin.')
  .max(40)
const capacity = z
  .number({ error: 'Kapasite sayı olmalı.' })
  .int('Kapasite tam sayı olmalı.')
  .min(1, 'Kapasite en az 1 olmalı.')
  .max(COURSE_GROUP_CAPACITY_MAX, `Kapasite en çok ${COURSE_GROUP_CAPACITY_MAX} olabilir.`)
const reason = z
  .string()
  .trim()
  .min(1, 'Gerekçe yazın.')
  .max(GROUP_REASON_MAX, `Gerekçe en çok ${GROUP_REASON_MAX} karakter.`)

export const createGroupSchema = z.strictObject({
  courseId: z.uuid('Geçerli bir kur seçin.'),
  name,
  ageBand,
  teacherMembershipId: membershipRef.nullable().optional(),
  delivery,
  room: room.nullable().optional(),
  schedule,
  startDate: day,
  capacity,
})
export type CreateGroupInput = z.infer<typeof createGroupSchema>

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((item) => item !== undefined)

export const updateGroupSchema = z
  .strictObject({
    name: name.optional(),
    ageBand: ageBand.optional(),
    teacherMembershipId: membershipRef.nullable().optional(),
    delivery: delivery.optional(),
    room: room.nullable().optional(),
    schedule: schedule.optional(),
    startDate: day.optional(),
    capacity: capacity.optional(),
  })
  .refine(atLeastOne, 'Değiştirilecek bir alan gönderin.')
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>

export const cancelGroupSchema = z.strictObject({ reason })
export const mergeGroupSchema = z.strictObject({
  sourceGroupId: z.uuid('Birleştirilecek grubu seçin.'),
  /** Kaynak grubun okunan sürümü (`rowVersion`); bayatsa birleştirme 409 (API). */
  sourceVersion: z.number().int().min(1),
  /** Gün/saat farklıysa kursiyerlerin onayı alındı mı (DOM-DIL-042). */
  learnersConsented: z.boolean().optional(),
})

/** Yerleştirme istisnaları (DOM-DIL-041): alt/üst kura öğretmen gerekçesi, yaş bandına yönetici onayı. */
export const groupPlacementSchema = z.strictObject({
  studentId: z.string().trim().min(1, 'Kursiyer seçin.').max(100),
  levelReason: reason.optional(),
  ageReason: reason.optional(),
})
export type GroupPlacementInput = z.infer<typeof groupPlacementSchema>

// --- Yardımcılar --------------------------------------------------------------------------

/** Ad tekilliği anahtarı (kurun `courseNameKey` yöntemi); `language_groups.name_key`. */
export const groupNameKey = (value: string) =>
  value.normalize('NFC').trim().toLocaleLowerCase('tr-TR')
/** Derslik çakışma anahtarı; `language_groups.room_key`. */
export const groupRoomKey = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const DAY_MS = 24 * 60 * 60 * 1000
const dateAt = (value: string) => Date.parse(`${value}T00:00:00.000Z`)
const addDays = (value: string, days: number) =>
  new Date(dateAt(value) + days * DAY_MS).toISOString().slice(0, 10)
/** ISO hafta günü: 1 Pazartesi … 7 Pazar. */
export const isoWeekday = (value: string) => {
  const weekday = new Date(dateAt(value)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

/** Bir oturumdaki ders saati: 45 dk 1, 90 dk 2 (DOM-DIL-002). */
const hoursPerSession = (course: Pick<Course, 'sessionMinutes'>) =>
  course.sessionMinutes / LESSON_HOUR_MINUTES

/** Haftalık oturum sayısı: haftalık ders saati ÷ oturumdaki saat (kurda tam bölünür). */
export const sessionsPerWeek = (course: Pick<Course, 'weeklyHours' | 'sessionMinutes'>) =>
  course.weeklyHours / hoursPerSession(course)

/** Toplam oturum sayısı: toplam ders saati ÷ oturumdaki saat. */
export const totalSessions = (course: Pick<Course, 'totalHours' | 'sessionMinutes'>) =>
  course.totalHours / hoursPerSession(course)

export const sortedSchedule = (slots: readonly GroupSlot[]): GroupSlot[] =>
  [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))

export type GroupSession = { date: string; startTime: string; endTime: string }

/**
 * Grubun bütün oturumları (IST-077 "grubun tüm oturumları takvime düşer"): başlangıç gününden
 * itibaren haftalık kalıptaki günlere, kurun toplam oturum sayısı dolana kadar. Tatil günleri henüz
 * atlanmaz (`TODO(tatil-takvimi)`: kurum tatil takvimi yok; DOM-DIL-003 tatile denk gelen ders).
 */
export function groupSessions(
  group: Pick<LanguageGroup, 'schedule' | 'startDate'>,
  course: Pick<Course, 'totalHours' | 'sessionMinutes'>,
): GroupSession[] {
  const slots = sortedSchedule(group.schedule)
  const count = totalSessions(course)
  const sessions: GroupSession[] = []
  if (slots.length === 0) return sessions
  for (let date = group.startDate; sessions.length < count; date = addDays(date, 1)) {
    const weekday = isoWeekday(date)
    for (const slot of slots) {
      if (slot.weekday !== weekday || sessions.length >= count) continue
      const start = minutesOf(slot.startTime)
      sessions.push({
        date,
        startTime: slot.startTime,
        endTime: timeOf(start + course.sessionMinutes),
      })
    }
  }
  return sessions
}

/** Son oturumun günü; saklanır ama her yazmada buradan yeniden hesaplanır. */
export function groupEndDate(
  group: Pick<LanguageGroup, 'schedule' | 'startDate'>,
  course: Pick<Course, 'totalHours' | 'sessionMinutes'>,
): string {
  return groupSessions(group, course).at(-1)?.date ?? group.startDate
}

/** Görünen durum (Europe/Istanbul günü): açık grup başlangıçta `running`, bitişten sonra `completed`. */
export function groupStatus(
  group: Pick<LanguageGroup, 'state' | 'startDate' | 'endDate'>,
  now: string,
): GroupStatus {
  if (group.state !== 'open') return group.state
  const today = dayKey(now)
  if (today > group.endDate) return 'completed'
  return today >= group.startDate ? 'running' : 'open'
}

/** Tamamlanan ya da iptal edilen grup kapanmıştır: değişmez, çakışmaya ve kapasiteye girmez. */
export const isGroupClosed = (status: GroupStatus) =>
  status === 'completed' || status === 'cancelled'

/** Yaş bandı (DOM-DIL-041), Europe/Istanbul gününe göre tam yaş. */
export function ageBandOf(birthDate: string, now: string): GroupAgeBand {
  const age = ageOn(birthDate, now)
  if (age >= ADULT_AGE) return 'adult'
  return age >= TEEN_MIN_AGE ? 'teen' : 'child'
}

// --- Doğrulama ----------------------------------------------------------------------------

/** Grup yalnız dil okulunda bulunur (DOM-DIL-008); okulda yok sayılır (404, DOM-YTK-012). */
export function assertLanguageSchoolGroups(institutionType: InstitutionType): void {
  if (institutionType !== 'language_school')
    throw new DomainError(
      'module_unavailable_for_type',
      'Grup planlama yalnız dil okulunda kullanılır.',
      { kind: 'not_found' },
    )
}

const slotLabel = (slot: GroupSlot) =>
  `${WEEKDAY_LABELS[slot.weekday as keyof typeof WEEKDAY_LABELS]} ${slot.startTime}`

/**
 * Haftalık kalıp (DOM-DIL-002, -003): oturum sayısı kurun haftalık saatine eşittir, oturumlar
 * birbirine binmez, her oturum 07.00–23.00 içindedir; çocuk ve genç grubunda 21.00'de biter.
 */
function assertSchedule(group: LanguageGroup, course: Course) {
  const expected = sessionsPerWeek(course)
  if (group.schedule.length !== expected)
    throw new DomainError(
      'group_schedule_mismatch',
      `Kurun haftalık ${course.weeklyHours} ders saati için haftada ${expected} oturum (${course.sessionMinutes} dk) planlayın.`,
      { path: ['schedule'] },
    )
  const slots = sortedSchedule(group.schedule)
  slots.forEach((slot, index) => {
    const start = minutesOf(slot.startTime)
    const end = start + course.sessionMinutes
    const path = ['schedule', String(index)]
    if (start < LEGAL_DAY_START_MINUTES || end > LEGAL_DAY_END_MINUTES)
      throw new DomainError(
        'group_outside_legal_hours',
        `${slotLabel(slot)} oturumu 07.00–23.00 dışına taşıyor.`,
        { path },
      )
    if (group.ageBand !== 'adult' && end > MINOR_DAY_END_MINUTES)
      throw new DomainError(
        'group_minor_late',
        `Çocuk ve genç gruplarında dersler 21.00'de biter; ${slotLabel(slot)} oturumu taşıyor.`,
        { path },
      )
    const previous = slots[index - 1]
    if (
      previous !== undefined &&
      previous.weekday === slot.weekday &&
      minutesOf(previous.startTime) + course.sessionMinutes > start
    )
      throw new DomainError(
        'group_schedule_overlap',
        `${slotLabel(previous)} ve ${slotLabel(slot)} oturumları çakışıyor.`,
        { path },
      )
  })
}

/** Aralıktaki günlerden biri bu hafta gününe düşüyor mu. */
function weekdayWithin(weekday: number, from: string, to: string) {
  if (from > to) return false
  for (let date = from, steps = 0; date <= to && steps < 7; date = addDays(date, 1), steps += 1)
    if (isoWeekday(date) === weekday) return true
  return false
}

/** İki grubun ortak tarihte aynı gün ve saate binen ilk oturumu; yoksa `null`. */
export function overlappingSlot(
  a: Pick<LanguageGroup, 'schedule' | 'startDate' | 'endDate'>,
  aMinutes: number,
  b: Pick<LanguageGroup, 'schedule' | 'startDate' | 'endDate'>,
  bMinutes: number,
): GroupSlot | null {
  const from = a.startDate > b.startDate ? a.startDate : b.startDate
  const to = a.endDate < b.endDate ? a.endDate : b.endDate
  if (from > to) return null
  for (const left of sortedSchedule(a.schedule))
    for (const right of b.schedule) {
      if (left.weekday !== right.weekday) continue
      const leftStart = minutesOf(left.startTime)
      const rightStart = minutesOf(right.startTime)
      if (leftStart < rightStart + bMinutes && rightStart < leftStart + aMinutes)
        if (weekdayWithin(left.weekday, from, to)) return left
    }
  return null
}

export type GroupPlanningContext = {
  institutionType: InstitutionType
  manager: CourseManager
  courses: readonly Course[]
  /** Kurumun grupları (kapanmışlar dahil olabilir; çakışmada süzülür). */
  groups: readonly LanguageGroup[]
  /** Grupların kursiyerleri (dondurulmuşlar dahil). */
  members: readonly GroupMember[]
  waitlist: readonly WaitlistEntry[]
  /** Kurumun `ogretmen` rolündeki üyelikleri. */
  teacherMembershipIds: readonly string[]
  now: string
}

/**
 * Öğretmen ve derslik çakışması (IST-077): kurumun kapanmamış diğer gruplarıyla ortak tarihte aynı
 * gün ve saate binen oturum reddedilir (422 `group_teacher_conflict`, `group_room_conflict`).
 * Çevrim içi grubun dersliği yoktur.
 */
function assertNoConflicts(ctx: GroupPlanningContext, group: LanguageGroup, course: Course) {
  const courses = new Map(ctx.courses.map((item) => [item.id, item]))
  const roomKey = group.room === null ? null : groupRoomKey(group.room)
  for (const other of ctx.groups) {
    if (other.id === group.id || isGroupClosed(groupStatus(other, ctx.now))) continue
    const sameTeacher =
      group.teacherMembershipId !== null && other.teacherMembershipId === group.teacherMembershipId
    const sameRoom =
      group.delivery === 'in_person' &&
      other.delivery === 'in_person' &&
      roomKey !== null &&
      other.room !== null &&
      groupRoomKey(other.room) === roomKey
    if (!sameTeacher && !sameRoom) continue
    const otherCourse = courses.get(other.courseId)
    if (otherCourse === undefined) continue
    const slot = overlappingSlot(group, course.sessionMinutes, other, otherCourse.sessionMinutes)
    if (slot === null) continue
    if (sameTeacher)
      throw new DomainError(
        'group_teacher_conflict',
        `Öğretmenin ${slotLabel(slot)} saatinde "${other.name}" grubunda dersi var.`,
        { path: ['teacherMembershipId'] },
      )
    throw new DomainError(
      'group_room_conflict',
      `Derslik ${slotLabel(slot)} saatinde "${other.name}" grubunda kullanılıyor.`,
      { path: ['room'] },
    )
  }
}

/** Ad kurumun iptal edilmemiş gruplarında tekildir (409 `group_name_exists`). */
function assertUniqueName(groups: readonly LanguageGroup[], group: LanguageGroup) {
  const key = groupNameKey(group.name)
  if (
    groups.some(
      (other) =>
        other.id !== group.id && other.state !== 'cancelled' && groupNameKey(other.name) === key,
    )
  )
    throw new DomainError('group_name_exists', 'Bu adla tanımlı bir grup var.', {
      kind: 'conflict',
      path: ['name'],
    })
}

function requireGroup(groups: readonly LanguageGroup[], groupId: string): LanguageGroup {
  const group = groups.find((item) => item.id === groupId)
  if (!group) throw new DomainError('group_not_found', 'Grup bulunamadı.', { kind: 'not_found' })
  return group
}

function courseOf(courses: readonly Course[], courseId: string, path = 'courseId'): Course {
  const course = courses.find((item) => item.id === courseId)
  if (!course) throw new DomainError('group_course_not_found', 'Kur bulunamadı.', { path: [path] })
  return course
}

/** Grup yalnız etkin kurdan açılır ve planlanır (DOM-DIL-008). */
function assertActiveCourse(course: Course) {
  if (course.status !== 'active')
    throw new DomainError('group_course_inactive', 'Grup yalnız etkin kurdan planlanır.', {
      path: ['courseId'],
    })
}

function assertNotClosed(group: LanguageGroup, now: string) {
  if (isGroupClosed(groupStatus(group, now)))
    throw new DomainError('group_closed', 'Tamamlanan ya da iptal edilen grup değişmez.', {
      kind: 'conflict',
    })
}

/** Teklifi süresi dolmamış bekleme satırı (DOM-DIL-043). */
export const isLiveOffer = (entry: WaitlistEntry, now: string) =>
  entry.status === 'offered' && entry.offerExpiresAt !== null && entry.offerExpiresAt > now

/**
 * Doluluk (DOM-DIL-040): aktif (dondurulmamış) kursiyer + süresi dolmamış teklif. Deneme
 * katılımcısı ders anına özgüdür ve CRM'de denetlenir (`DOM-KAY-034`); bekleyen kapasiteye sayılmaz.
 */
export function groupOccupancy(
  group: Pick<LanguageGroup, 'id' | 'capacity'>,
  members: readonly GroupMember[],
  waitlist: readonly WaitlistEntry[],
  now: string,
) {
  const own = members.filter((member) => member.groupId === group.id)
  const active = own.filter((member) => member.status === 'active').length
  const offers = waitlist.filter(
    (entry) => entry.offerGroupId === group.id && isLiveOffer(entry, now),
  ).length
  return {
    active,
    frozen: own.length - active,
    offers,
    free: Math.max(0, group.capacity - active - offers),
  }
}

/**
 * Kapasite (DOM-DIL-008, -040): 1–18 (şema), kurun en çok mevcudundan büyük olamaz (yalnız
 * kapasite yazılırken), dolu yerden
 * (aktif kursiyer + süresi dolmamış teklif) az olamaz.
 */
function assertCapacity(
  ctx: GroupPlanningContext,
  group: LanguageGroup,
  course: Course,
  capacityChanged: boolean,
) {
  // Kurun mevcudu grup kapasitesinin altına inemez (`planCourseUpdate`); yine de eski grup
  // kapasitesine dokunmayan değişiklik bu yüzden kilitlenmesin diye yalnız kapasite değişince bakılır.
  if (capacityChanged && group.capacity > course.maxLearners)
    throw new DomainError(
      'group_capacity_exceeds_course',
      `Kapasite kurun en çok mevcudunu (${course.maxLearners}) aşamaz.`,
      { path: ['capacity'] },
    )
  const occupancy = groupOccupancy(group, ctx.members, ctx.waitlist, ctx.now)
  if (group.capacity < occupancy.active + occupancy.offers)
    throw new DomainError(
      'group_capacity_below_members',
      `Kapasite gruptaki kursiyer ve açık teklif sayısından (${occupancy.active + occupancy.offers}) az olamaz.`,
      { path: ['capacity'] },
    )
}

/** Öğretmen kurumun `ogretmen` üyeliğidir; yüz yüze grupta derslik, çevrim içide derslik yok. */
function assertStaffing(ctx: GroupPlanningContext, group: LanguageGroup) {
  if (
    group.teacherMembershipId !== null &&
    !ctx.teacherMembershipIds.includes(group.teacherMembershipId)
  )
    throw new DomainError('group_teacher_invalid', 'Öğretmen kurumda bulunamadı.', {
      path: ['teacherMembershipId'],
    })
  if (group.delivery === 'online' && group.room !== null)
    throw new DomainError('group_room_online', 'Çevrim içi grubun dersliği olmaz.', {
      path: ['room'],
    })
}

/** Açılmış grupta öğretmen ve (yüz yüzede) derslik zorunludur (DOM-DIL-042). */
function assertStaffed(group: LanguageGroup) {
  if (group.teacherMembershipId === null)
    throw new DomainError('group_teacher_required', 'Açılan grubun öğretmeni olmalı.', {
      path: ['teacherMembershipId'],
    })
  if (group.delivery === 'in_person' && group.room === null)
    throw new DomainError('group_room_required', 'Yüz yüze açılan grubun dersliği olmalı.', {
      path: ['room'],
    })
}

function assertStartNotPassed(group: LanguageGroup, now: string) {
  if (group.startDate < dayKey(now))
    throw new DomainError('group_start_passed', 'Başlangıç tarihi geçmiş olamaz.', {
      path: ['startDate'],
    })
}

function assertGroup(
  ctx: GroupPlanningContext,
  group: LanguageGroup,
  course: Course,
  capacityChanged: boolean,
) {
  assertSchedule(group, course)
  assertStaffing(ctx, group)
  if (group.state === 'open') assertStaffed(group)
  assertCapacity(ctx, group, course, capacityChanged)
  assertUniqueName(ctx.groups, group)
  assertNoConflicts(ctx, group, course)
}

// --- İşlemler -----------------------------------------------------------------------------

/**
 * Yeni grup (IST-077; DOM-DIL-003, -008, -040): `planned` açılır, bitiş tarihi kurdan hesaplanır.
 * Yönetici ya da kurun seviyesinin akademik koordinatörü (403 `course_coordinator_required`).
 * Kur etkin olmalı, başlangıç geçmiş olamaz, kalıp kurun haftalık saatine uymalı, öğretmen ve
 * derslik çakışmamalı (422); ad tekil (409).
 */
export function planGroupCreation(
  ctx: GroupPlanningContext & { input: unknown; groupId: string },
): LanguageGroup {
  assertLanguageSchoolGroups(ctx.institutionType)
  const data = createGroupSchema.parse(ctx.input)
  const course = courseOf(ctx.courses, data.courseId)
  assertCourseManager(ctx.manager, [course.level])
  assertActiveCourse(course)
  const schedule = sortedSchedule(data.schedule)
  const group: LanguageGroup = {
    id: ctx.groupId,
    courseId: course.id,
    name: data.name,
    ageBand: data.ageBand,
    teacherMembershipId: data.teacherMembershipId ?? null,
    delivery: data.delivery,
    room: data.room ?? null,
    schedule,
    startDate: data.startDate,
    endDate: groupEndDate({ schedule, startDate: data.startDate }, course),
    capacity: data.capacity,
    state: 'planned',
    openedAt: null,
    cancelledAt: null,
    cancelReason: null,
    mergedIntoGroupId: null,
  }
  assertStartNotPassed(group, ctx.now)
  assertGroup(ctx, group, course, true)
  return group
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Kursiyeri olan ya da başlamış grupta kalıp, başlangıç ve yaş bandı değişmez (DOM-DIL-042). */
const SCHEDULE_FIELDS = ['schedule', 'startDate', 'ageBand'] as const

/**
 * Grubu değiştirir (IST-077). Kapanmış grup 409 `group_closed`. Başlamış ya da kursiyeri olan
 * grupta gün/saat, başlangıç ve yaş bandı değişmez (422 `group_schedule_locked`): tarih ve saat
 * sözleşmenin esasıdır, değişiklik kursiyer onayıyla birleştirme ya da yeni grupla yapılır
 * (DOM-DIL-042). Kur değişmez (gövdede yoktur). Açılmış grupta öğretmen ve (yüz yüzede) derslik
 * boşaltılamaz (422 `group_teacher_required`, `group_room_required`). Başlangıcı geçmiş, hiç
 * açılmamış ve kursiyersiz `planned` grup ileri bir başlangıca alınabilir. Yanıt yeni grup ve
 * gerçekten değişen alanlardır (denetim).
 */
export function planGroupUpdate(ctx: GroupPlanningContext & { groupId: string; input: unknown }): {
  group: LanguageGroup
  fields: string[]
} {
  assertLanguageSchoolGroups(ctx.institutionType)
  const data = updateGroupSchema.parse(ctx.input)
  const current = requireGroup(ctx.groups, ctx.groupId)
  const course = courseOf(ctx.courses, current.courseId)
  assertCourseManager(ctx.manager, [course.level])
  assertNotClosed(current, ctx.now)
  const delivery = data.delivery ?? current.delivery
  const schedule = data.schedule === undefined ? current.schedule : sortedSchedule(data.schedule)
  const startDate = data.startDate ?? current.startDate
  const next: LanguageGroup = {
    ...current,
    name: data.name ?? current.name,
    ageBand: data.ageBand ?? current.ageBand,
    teacherMembershipId:
      data.teacherMembershipId === undefined
        ? current.teacherMembershipId
        : data.teacherMembershipId,
    delivery,
    // Çevrim içine geçen grubun dersliği düşer; yüz yüzeye geçende verilen derslik kullanılır.
    room: data.room === undefined ? (delivery === 'online' ? null : current.room) : data.room,
    schedule,
    startDate,
    endDate: groupEndDate({ schedule, startDate }, course),
    capacity: data.capacity ?? current.capacity,
  }
  const fields = (Object.keys(next) as (keyof LanguageGroup)[]).filter(
    (field) => field !== 'endDate' && !sameValue(next[field], current[field]),
  )
  const locked = fields.filter((field) => (SCHEDULE_FIELDS as readonly string[]).includes(field))
  const started = groupStatus(current, ctx.now) === 'running'
  const occupancy = groupOccupancy(current, ctx.members, ctx.waitlist, ctx.now)
  if (locked.length > 0 && (started || occupancy.active + occupancy.frozen > 0))
    throw new DomainError(
      'group_schedule_locked',
      'Kursiyeri olan ya da başlamış grubun gün/saati, başlangıcı ve yaş bandı değişmez.',
      { path: [locked[0] ?? 'schedule'] },
    )
  if (fields.includes('startDate')) assertStartNotPassed(next, ctx.now)
  assertGroup(ctx, next, course, fields.includes('capacity'))
  return { group: next, fields: next.endDate === current.endDate ? fields : [...fields, 'endDate'] }
}

/**
 * Grubu açar (DOM-DIL-042): yalnız `planned` (409 `group_not_planned`), kur etkin, başlangıç
 * geçmemiş, öğretmen ve (yüz yüzede) derslik atanmış, aktif kursiyer kurun en az mevcuduna
 * (açılış sayısı) ulaşmış olmalı (422). Çakışma güncel gruplarla yeniden denetlenir.
 */
export function planGroupOpen(ctx: GroupPlanningContext & { groupId: string }): LanguageGroup {
  assertLanguageSchoolGroups(ctx.institutionType)
  const group = requireGroup(ctx.groups, ctx.groupId)
  const course = courseOf(ctx.courses, group.courseId)
  assertCourseManager(ctx.manager, [course.level])
  if (group.state !== 'planned')
    throw new DomainError('group_not_planned', 'Yalnız planlanan grup açılır.', {
      kind: 'conflict',
    })
  assertActiveCourse(course)
  assertStartNotPassed(group, ctx.now)
  assertStaffed(group)
  const { active } = groupOccupancy(group, ctx.members, ctx.waitlist, ctx.now)
  if (active < course.minLearners)
    throw new DomainError(
      'group_below_minimum',
      `Grup en az ${course.minLearners} kursiyerle açılır; şu an ${active} kursiyer var.`,
      { path: ['members'] },
    )
  assertGroup(ctx, group, course, false)
  return { ...group, state: 'open', openedAt: ctx.now }
}

/** Grubun 21.00 sonrasına taşan oturumu var mı (DOM-DIL-003). */
const runsLate = (group: Pick<LanguageGroup, 'schedule'>, course: Course) =>
  group.schedule.some(
    (slot) => minutesOf(slot.startTime) + course.sessionMinutes > MINOR_DAY_END_MINUTES,
  )

/** Kursiyerin kapanmamış gruplarındaki satırları; `ignore` gruplar hariç. */
function learnerMemberships(
  groups: readonly LanguageGroup[],
  members: readonly GroupMember[],
  studentId: string,
  now: string,
  ignore: ReadonlySet<string> = new Set(),
): GroupMember[] {
  const statusOf = new Map(groups.map((item) => [item.id, groupStatus(item, now)]))
  return members.filter(
    (member) =>
      member.studentId === studentId &&
      !ignore.has(member.groupId) &&
      !isGroupClosed(statusOf.get(member.groupId) ?? 'cancelled'),
  )
}

/** Kursiyerin diğer gruplarıyla saat çakışması (422 `learner_schedule_conflict`). */
function assertLearnerSchedule(
  input: { courses: readonly Course[]; groups: readonly LanguageGroup[] },
  group: LanguageGroup,
  course: Course,
  memberships: readonly GroupMember[],
  path: string[],
) {
  const courses = new Map(input.courses.map((item) => [item.id, item]))
  const byId = new Map(input.groups.map((item) => [item.id, item]))
  for (const member of memberships) {
    const other = byId.get(member.groupId)
    const otherCourse = other === undefined ? undefined : courses.get(other.courseId)
    if (other === undefined || otherCourse === undefined) continue
    const slot = overlappingSlot(group, course.sessionMinutes, other, otherCourse.sessionMinutes)
    if (slot !== null)
      throw new DomainError(
        'learner_schedule_conflict',
        `Kursiyerin ${slotLabel(slot)} saatinde "${other.name}" grubunda dersi var.`,
        { path },
      )
  }
}

/**
 * Grubu iptal eder (DOM-DIL-042): kapanmamış grup gerekçeyle `cancelled` olur. Kursiyerlerin
 * seçenekleri (başka gruba geçiş, bekleme, tam iade) kayıt ve finans akışındadır (ON-058).
 */
export function planGroupCancellation(
  ctx: GroupPlanningContext & { groupId: string; input: unknown },
): LanguageGroup {
  assertLanguageSchoolGroups(ctx.institutionType)
  const data = cancelGroupSchema.parse(ctx.input)
  const group = requireGroup(ctx.groups, ctx.groupId)
  const course = courseOf(ctx.courses, group.courseId)
  assertCourseManager(ctx.manager, [course.level])
  assertNotClosed(group, ctx.now)
  return { ...group, state: 'cancelled', cancelledAt: ctx.now, cancelReason: data.reason }
}

/**
 * İki grubu birleştirir (DOM-DIL-042): kaynak grubun kursiyerleri hedefe taşınır, kaynak iptal
 * edilir (`mergedIntoGroupId`). Gruplar farklı ve kapanmamış (422 `group_merge_same`, 409
 * `group_closed`), aynı kur (dolayısıyla aynı seviye) ve aynı yaş bandında (422
 * `group_merge_mismatch`) olmalı; taşınan aktif kursiyer + hedefin doluluğu hedefin kapasitesini
 * (≤ 18) aşamaz (422 `group_merge_capacity`). Gün/saat ya da başlangıç farklıysa kursiyer onayı
 * beyan edilmeli (422 `group_merge_consent_required`). Hedefte zaten olan kursiyer taşınmaz.
 * Taşınan her kursiyer yerleştirme gibi denetlenir: diğer gruplarıyla saat çakışması (422
 * `learner_schedule_conflict`) ve hedef 21.00 sonrasına taşıyorsa 18 yaş altı (422
 * `group_minor_late`; doğum tarihi bilinmiyorsa 422 `learner_birth_date_required`).
 */
export function planGroupMerge(
  ctx: GroupPlanningContext & {
    groupId: string
    input: unknown
    /** Kaynak grubun kursiyerlerinin doğum tarihi (bilinmiyorsa `null`); 21.00 sınırı için. */
    learnerBirthDates: Readonly<Record<string, string | null>>
  },
): {
  target: LanguageGroup
  source: LanguageGroup
  movedStudentIds: string[]
} {
  assertLanguageSchoolGroups(ctx.institutionType)
  const data = mergeGroupSchema.parse(ctx.input)
  const target = requireGroup(ctx.groups, ctx.groupId)
  if (data.sourceGroupId === target.id)
    throw new DomainError('group_merge_same', 'Grup kendisiyle birleştirilemez.', {
      path: ['sourceGroupId'],
    })
  const source = requireGroup(ctx.groups, data.sourceGroupId)
  const course = courseOf(ctx.courses, target.courseId)
  assertCourseManager(ctx.manager, [course.level])
  assertNotClosed(target, ctx.now)
  assertNotClosed(source, ctx.now)
  if (source.courseId !== target.courseId || source.ageBand !== target.ageBand)
    throw new DomainError(
      'group_merge_mismatch',
      'Yalnız aynı kurun ve aynı yaş bandının grupları birleştirilir.',
      { path: ['sourceGroupId'] },
    )
  const inTarget = new Set(
    ctx.members.filter((member) => member.groupId === target.id).map((m) => m.studentId),
  )
  const moving = ctx.members.filter(
    (member) => member.groupId === source.id && !inTarget.has(member.studentId),
  )
  const occupancy = groupOccupancy(target, ctx.members, ctx.waitlist, ctx.now)
  const incoming = moving.filter((member) => member.status === 'active').length
  if (occupancy.active + occupancy.offers + incoming > target.capacity)
    throw new DomainError(
      'group_merge_capacity',
      `Birleşen grup kapasiteyi (${target.capacity}) aşar: ${occupancy.active + occupancy.offers + incoming} kursiyer.`,
      { path: ['sourceGroupId'] },
    )
  const sameTime =
    source.startDate === target.startDate &&
    sameValue(sortedSchedule(source.schedule), sortedSchedule(target.schedule))
  if (!sameTime && moving.length > 0 && data.learnersConsented !== true)
    throw new DomainError(
      'group_merge_consent_required',
      'Gün/saati farklı gruba taşıma için kursiyerlerin onayını alın ve işaretleyin.',
      { path: ['learnersConsented'] },
    )
  const late = runsLate(target, course)
  const ignore = new Set([source.id, target.id])
  for (const member of moving) {
    if (late) {
      const birthDate = ctx.learnerBirthDates[member.studentId] ?? null
      if (birthDate === null)
        throw new DomainError(
          'learner_birth_date_required',
          "Hedef grubun dersi 21.00'den sonra bitiyor; taşınan kursiyerlerin doğum tarihi gerekli.",
          { path: ['sourceGroupId'] },
        )
      if (ageBandOf(birthDate, ctx.now) !== 'adult')
        throw new DomainError(
          'group_minor_late',
          "Taşınan bir kursiyer 18 yaş altında; dersleri 21.00'de biter, hedef grubun dersi daha geç.",
          { path: ['sourceGroupId'] },
        )
    }
    assertLearnerSchedule(
      ctx,
      target,
      course,
      learnerMemberships(ctx.groups, ctx.members, member.studentId, ctx.now, ignore),
      ['sourceGroupId'],
    )
  }
  return {
    target,
    source: {
      ...source,
      state: 'cancelled',
      cancelledAt: ctx.now,
      cancelReason: `"${target.name}" grubuyla birleştirildi.`,
      mergedIntoGroupId: target.id,
    },
    movedStudentIds: moving.map((member) => member.studentId),
  }
}

/** Seviye istisnasının gerekçesini yazabilen roller (DOM-DIL-041: öğretmen gerekçesi). */
const LEVEL_REASON_ROLES: readonly Role[] = ['ogretmen', 'yonetici']

/** Kursiyerin yerleştirmede bilinen bilgisi (kayıt akışı yükler). */
export type PlacementLearner = {
  studentId: string
  // kvkk: K
  birthDate: string | null
  /** Seviye tespitiyle belirlenen seviye (DOM-DIL-010); yoksa `null`. */
  placementLevel: CefrLevel | null
}

/**
 * Kursiyeri gruba yerleştirme kuralı (DOM-DIL-040, -041, -045, -003). Uç ve yazma kayıt ve satış
 * akışındadır (ON-058); bu fonksiyon yeni üyeliği döndürür ya da reddeder:
 * - grup kapanmamış ve kur etkin (409 `group_closed`, 422 `group_course_inactive`);
 * - kursiyer bu grupta (409 `group_member_exists`) ya da aynı kurun kapanmamış başka grubunda
 *   (409 `group_member_same_course`) değil;
 * - boş yer var (422 `group_full`; kursiyerin kendi süresi dolmamış teklifi yer sayılır);
 * - seviye kurun seviyesi; değilse öğretmen ya da yönetici gerekçesi (`levelReason`, `actorRole`
 *   `ogretmen`/`yonetici`; 422 `group_level_mismatch`);
 * - yaş bandı grubunki (çocuk < 12, genç 12–17, yetişkin 18+); istisna yalnız 18 yaş altının
 *   yetişkin grubuna, yetişkinin genç grubuna yönetici gerekçesiyle girmesidir (`ageReason`, 422
 *   `group_age_band_mismatch`); doğum tarihi zorunlu (422 `learner_birth_date_required`);
 * - 18 yaş altı kursiyer 21.00 sonrasına taşan gruba girmez (422 `group_minor_late`);
 * - kursiyerin kapanmamış diğer gruplarıyla saat çakışması yok (422 `learner_schedule_conflict`).
 */
export function planGroupPlacement(input: {
  institutionType: InstitutionType
  actorRole: Role
  courses: readonly Course[]
  groups: readonly LanguageGroup[]
  members: readonly GroupMember[]
  waitlist: readonly WaitlistEntry[]
  groupId: string
  learner: PlacementLearner
  input: unknown
  now: string
}): GroupMember {
  assertLanguageSchoolGroups(input.institutionType)
  const data = groupPlacementSchema.parse(input.input)
  const group = requireGroup(input.groups, input.groupId)
  const course = courseOf(input.courses, group.courseId)
  assertNotClosed(group, input.now)
  assertActiveCourse(course)
  const { learner, now } = input
  const own = learnerMemberships(input.groups, input.members, learner.studentId, now)
  if (own.some((member) => member.groupId === group.id))
    throw new DomainError('group_member_exists', 'Kursiyer zaten bu grupta.', { kind: 'conflict' })
  const byId = new Map(input.groups.map((item) => [item.id, item]))
  if (own.some((member) => byId.get(member.groupId)?.courseId === group.courseId))
    throw new DomainError(
      'group_member_same_course',
      'Kursiyer bu kurun başka bir grubunda kayıtlı.',
      { kind: 'conflict' },
    )
  const ownOffer = input.waitlist.some(
    (entry) =>
      entry.offerGroupId === group.id &&
      entry.studentId === learner.studentId &&
      isLiveOffer(entry, now),
  )
  const occupancy = groupOccupancy(group, input.members, input.waitlist, now)
  if (occupancy.free === 0 && !ownOffer)
    throw new DomainError('group_full', 'Grup dolu; kursiyeri bekleme listesine alın.', {
      path: ['groupId'],
    })
  if (
    learner.placementLevel !== course.level &&
    (data.levelReason === undefined || !LEVEL_REASON_ROLES.includes(input.actorRole))
  )
    throw new DomainError(
      'group_level_mismatch',
      'Kursiyerin seviyesi kurun seviyesinden farklı; öğretmen ya da yönetici gerekçeyle yerleştirir.',
      { path: ['levelReason'] },
    )
  if (learner.birthDate === null)
    throw new DomainError('learner_birth_date_required', 'Kursiyerin doğum tarihi gerekli.', {
      path: ['studentId'],
    })
  const band = ageBandOf(learner.birthDate, now)
  const minor = band !== 'adult'
  if (band !== group.ageBand) {
    // DOM-DIL-041 istisnaları: 18 yaş altı yetişkin grubuna, yetişkin genç grubuna yönetici
    // gerekçesiyle girer; çocuk–genç geçişi ve yetişkinin çocuk grubu hiç yoktur.
    const exception =
      (minor && group.ageBand === 'adult') || (band === 'adult' && group.ageBand === 'teen')
    if (!exception || data.ageReason === undefined || input.actorRole !== 'yonetici')
      throw new DomainError(
        'group_age_band_mismatch',
        !exception
          ? `Kursiyerin yaş bandı (${GROUP_AGE_BAND_LABELS[band]}) grubunkiyle uyuşmuyor.`
          : minor
            ? '18 yaş altı kursiyer yetişkin grubuna yalnız yönetici onayı ve gerekçeyle girer.'
            : 'Yetişkin kursiyer genç grubuna yalnız yönetici onayı ve gerekçeyle girer.',
        { path: ['ageReason'] },
      )
  }
  // TODO(zorunlu-egitim-cagi): zorunlu eğitim çağı 18 yaş altıyla yaklaşık alınır (DOM-DIL-003).
  if (minor && runsLate(group, course))
    throw new DomainError(
      'group_minor_late',
      "18 yaş altı kursiyerin dersleri 21.00'de biter; bu grubun dersi daha geç.",
      { path: ['groupId'] },
    )
  assertLearnerSchedule(input, group, course, own, ['groupId'])
  return { groupId: group.id, studentId: learner.studentId, status: 'active', joinedAt: now }
}

/**
 * Bekleme sırası (DOM-DIL-043): grubun kendi sırası ve kurun grupsuz sırası, istek anına göre
 * (eşitlikte kimlik). Yalnız `waiting` satırlar; teklif ve kapanmış satırlar sırada değildir.
 */
export function waitlistQueue(
  group: Pick<LanguageGroup, 'id' | 'courseId'>,
  waitlist: readonly WaitlistEntry[],
): WaitlistEntry[] {
  return waitlist
    .filter(
      (entry) =>
        entry.status === 'waiting' &&
        (entry.groupId === group.id ||
          (entry.groupId === null && entry.courseId === group.courseId)),
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id))
}

/**
 * Yer açılınca sıradakine teklif önerisi (DOM-DIL-043). Süresi dolmuş teklifler `expire` listesine
 * düşer ve yer kaplamaz; boş yer kadar sıradaki satıra 48 saat geçerli teklif önerilir. Kapanmış ya
 * da iptal edilmiş grupta öneri yoktur. Saftır: yazma kayıt akışındadır (ON-058).
 */
export function suggestWaitlistOffers(input: {
  group: LanguageGroup
  members: readonly GroupMember[]
  waitlist: readonly WaitlistEntry[]
  now: string
}): { expire: string[]; offers: { entryId: string; offerExpiresAt: string }[] } {
  const { group, now } = input
  const expire = input.waitlist
    .filter(
      (entry) =>
        entry.offerGroupId === group.id && entry.status === 'offered' && !isLiveOffer(entry, now),
    )
    .map((entry) => entry.id)
  if (isGroupClosed(groupStatus(group, now))) return { expire, offers: [] }
  const { free } = groupOccupancy(group, input.members, input.waitlist, now)
  const offerExpiresAt = new Date(Date.parse(now) + WAITLIST_OFFER_HOURS * 3600_000).toISOString()
  return {
    expire,
    offers: waitlistQueue(group, input.waitlist)
      .slice(0, free)
      .map((entry) => ({ entryId: entry.id, offerExpiresAt })),
  }
}

// --- Okuma --------------------------------------------------------------------------------

/** Okuyanın grup kapsamı: öğretmende kendi üyeliği ve koordinatör seviyeleri, öğrenci/velide öğrenciler. */
export type GroupReader = {
  role: Role
  membershipId: string
  coordination: CoordinatorScope
  /** Öğrencide kendisi, velide bağlı çocukları (`membership_links`). */
  studentIds: readonly string[]
}

/**
 * Grubu okuyabilir mi (IST-077): yönetici ve ön büro hepsini; öğretmen kendi grubunu ve akademik
 * koordinatörü olduğu seviyenin gruplarını; öğrenci ve veli yalnız kendisinin/çocuğunun kursiyer
 * olduğu grubu (iptal edilmişse de, geçmiş için).
 */
export function canReadGroup(
  reader: GroupReader,
  group: Pick<LanguageGroup, 'id' | 'teacherMembershipId'>,
  course: Pick<Course, 'level'>,
  members: readonly GroupMember[],
): boolean {
  switch (reader.role) {
    case 'yonetici':
    case 'onburo':
      return true
    case 'ogretmen':
      return (
        group.teacherMembershipId === reader.membershipId ||
        reader.coordination.cefrLevels.includes(course.level)
      )
    case 'ogrenci':
    case 'veli':
      return members.some(
        (member) => member.groupId === group.id && reader.studentIds.includes(member.studentId),
      )
    default:
      return reader.role satisfies never
  }
}

const isLearner = (role: Role) => role === 'ogrenci' || role === 'veli'

/**
 * Okuma görünümü (IST-077). Personel bütün alanları, doluluğu ve hesaplanan bitişi görür. Öğrenci
 * ve veli yalnız takvim alanlarını görür: öğretmen kimliği, kapasite, doluluk, iptal gerekçesi,
 * birleştirme ve işlem anları dönmez. Seviye ve oturum uzunluğu kurdandır.
 */
export function groupView(
  group: LanguageGroup,
  course: Course,
  role: Role,
  members: readonly GroupMember[],
  waitlist: readonly WaitlistEntry[],
  now: string,
) {
  const base = {
    id: group.id,
    courseId: group.courseId,
    courseName: course.name,
    level: course.level,
    name: group.name,
    ageBand: group.ageBand,
    delivery: group.delivery,
    room: group.room,
    schedule: sortedSchedule(group.schedule).map((slot) => ({ ...slot })),
    sessionMinutes: course.sessionMinutes,
    startDate: group.startDate,
    endDate: group.endDate,
    status: groupStatus(group, now),
  }
  if (isLearner(role)) return base
  const occupancy = groupOccupancy(group, members, waitlist, now)
  return {
    ...base,
    teacherMembershipId: group.teacherMembershipId,
    capacity: group.capacity,
    activeLearners: occupancy.active,
    frozenLearners: occupancy.frozen,
    openOffers: occupancy.offers,
    freeSeats: occupancy.free,
    openedAt: group.openedAt,
    cancelledAt: group.cancelledAt,
    cancelReason: group.cancelReason,
    mergedIntoGroupId: group.mergedIntoGroupId,
  }
}

/**
 * Kurun kapanmamış grupları (DOM-DIL-008): planlanan (başlangıcı geçmiş olsa da), açık ya da devam
 * eden grup kuru kullanır. Kur arşivi (`planCourseArchive`) bunları `openGroups` olarak alır ve
 * reddeder; kur değişikliği (`planCourseUpdate`) en çok mevcudu bunların kapasitesinin altına
 * indirmez. Başlangıcı geçmiş `planned` grup ileri tarihe alınır ya da iptal edilir.
 */
export function groupsBlockingCourseArchive(
  groups: readonly LanguageGroup[],
  courseId: string,
  now: string,
): { courseId: string; name: string; capacity: number }[] {
  return groups
    .filter((group) => group.courseId === courseId && !isGroupClosed(groupStatus(group, now)))
    .map((group) => ({ courseId: group.courseId, name: group.name, capacity: group.capacity }))
}
