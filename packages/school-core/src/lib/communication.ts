import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { requireAuthorized } from './authorize.ts'
import {
  isConversationParty,
  readerKeysFor,
  recipientCount,
  viewerOf,
} from './communication-access.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { scopeFor, type Actor, type Scope } from './scope.ts'

/**
 * İletişim: duyuru ve birebir mesaj (docs/domain/iletisim-ve-veli.md). Saf işlemler; önce bütün
 * kurallar denetlenir, sonra State değişir. Yetki `lib/authorize.ts` tablosundadır
 * (`announcement.*`, `conversation.*`, `message.*`; kararlar `lib/communication-access.ts`).
 *
 * Veri modeli `records` deposundadır (ADR 0004 onay bekliyor): duyuru `announcements`,
 * yazışma `conversations` kaydıdır; mesajlar ayrı `conversationMessages` kayıtlarıdır (mesaj
 * başına bir kayıt, `conversationId` ile; ADR 0005). Yazışma kaydı yalnız taraf bilgisini ve son
 * mesaj anını (`lastMessageAt`, liste sırası) taşır; okunmamış sayısı, son mesaj ve yanıt
 * bekleme mesajlardan hesaplanır (`digestMessages`). Mesaj eklenir, düzenlenmez ve silinmez
 * (DOM-ILT-012).
 *
 * Kişi kimliği: core aktörü kayıt bağlantılarını taşır (`Actor`); yayınlayan, gönderen ve
 * velinin yazışması için ayrıca kalıcı kişi kimliği gerekir (`Participant.userId`; API'de
 * kullanıcı kimliği, çevrimdışı demoda rol kimliği).
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`).
 */

z.config(z.locales.tr())

export type Participant = Actor & { userId: string }
export type CommunicationOptions = { institutionType?: InstitutionType }

// --- Duyuru ------------------------------------------------------------------------------

/** Duyurunun hedeflenebilen alıcı rolleri (DOM-ILT-001). */
export const ANNOUNCEMENT_AUDIENCE_ROLES = ['ogretmen', 'ogrenci', 'veli'] as const
export type AnnouncementAudienceRole = (typeof ANNOUNCEMENT_AUDIENCE_ROLES)[number]
/** Kategoriler; ön büro yalnız `İdari` yayınlar (DOM-ILT-002). */
export const ANNOUNCEMENT_CATEGORIES = ['Akademik', 'Etkinlik', 'Bilgilendirme', 'İdari'] as const

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const distinct = <T>(list: readonly T[]): T[] => [...new Set(list)]

/**
 * Hedef kitle (DOM-ILT-001): konum seçicilerinin (kampüs, düzey, CEFR seviyesi, sınıf)
 * birleşimi × alıcı rolleri. Konum seçicisi yoksa bütün kurumdur.
 */
export const announcementTargetSchema = z.object({
  branchIds: z.array(identifier).max(50).default([]).transform(distinct),
  grades: z.array(z.number().int().min(1).max(12)).max(12).default([]).transform(distinct),
  levels: z.array(z.string().trim().min(1).max(40)).max(20).default([]).transform(distinct),
  classIds: z.array(identifier).max(200).default([]).transform(distinct),
  roles: z
    .array(z.enum(ANNOUNCEMENT_AUDIENCE_ROLES))
    .min(1, 'En az bir alıcı grubu seçin.')
    .max(3)
    .transform(distinct),
})
export type AnnouncementTarget = z.output<typeof announcementTargetSchema>

const announcementTitle = z
  .string()
  .trim()
  .min(3, 'Başlık en az 3 karakter olmalıdır.')
  .max(160, 'Başlık en fazla 160 karakter olabilir.')
const announcementText = z
  .string()
  .trim()
  .min(1, 'Duyuru metnini yazın.')
  .max(5000, 'Duyuru metni en fazla 5000 karakter olabilir.')
const announcementCategory = z.enum(ANNOUNCEMENT_CATEGORIES, 'Kategori seçin.')

export const publishAnnouncementSchema = z.object({
  title: announcementTitle,
  text: announcementText,
  category: announcementCategory,
  target: announcementTargetSchema,
})
export type PublishAnnouncementInput = z.input<typeof publishAnnouncementSchema>

/** Düzeltme yalnız içeriği değiştirir; hedef kitle yayında sabitlenmiştir (DOM-ILT-001). */
export const reviseAnnouncementSchema = z
  .object({
    title: announcementTitle.optional(),
    text: announcementText.optional(),
    category: announcementCategory.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
    path: ['title'],
  })
export type ReviseAnnouncementInput = z.input<typeof reviseAnnouncementSchema>

export const withdrawAnnouncementSchema = z.object({
  // kvkk: K — serbest metin; loglanmaz, denetim kaydına yazılmaz.
  reason: z
    .string()
    .trim()
    .min(5, 'Geri çekme nedenini yazın.')
    .max(500, 'En fazla 500 karakter girebilirsiniz.'),
})

export type AnnouncementPublisher = {
  role: Role
  // kvkk: K
  userId: string
  teacherId?: string
}
/**
 * Yayın anında çözülen alıcılar (DOM-ILT-001). Veli alıcısı çocuğu üzerinden tutulur: okundu
 * bilgisi aile düzeyindedir ("bu öğrencinin velisi okudu mu").
 */
export type AnnouncementRecipients = {
  studentIds: string[]
  parentStudentIds: string[]
  teacherIds: string[]
}
export type AnnouncementRevision = {
  title: string
  text: string
  category: string
  /** Bu içeriğin yerini yenisinin aldığı an. */
  replacedAt: string
  replacedBy: { role: Role; userId: string }
}
/** İletişim işlemlerinin duyuruya eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type AnnouncementFields = {
  target?: AnnouncementTarget
  recipients?: AnnouncementRecipients
  /** Okuyucu anahtarı (`readerKey`) → ilk açılış anı (DOM-ILT-003). */
  reads?: Record<string, string>
  publishedBy?: AnnouncementPublisher
  revisions?: AnnouncementRevision[]
  revisedAt?: string
  withdrawnAt?: string
  withdrawnBy?: { role: Role; userId: string }
  // kvkk: K
  withdrawReason?: string
}
type Announcement = State['announcements'][number]

type RecipientSource = Pick<State, 'students' | 'classes' | 'teachers' | 'assignments'>

/**
 * Hedef kitleyi alıcı listesine çözer. Sınıf eşleşmesi konum seçicilerinin birleşimidir;
 * yalnız etkin öğrenci ve öğretmen alıcıdır. Kurum geneli öğretmen duyurusu bütün etkin
 * öğretmenlere, kampüs duyurusu kampüsün öğretmenlerine de gider.
 */
export function resolveRecipients(
  source: RecipientSource,
  target: AnnouncementTarget,
): AnnouncementRecipients {
  const anywhere =
    target.branchIds.length === 0 &&
    target.grades.length === 0 &&
    target.levels.length === 0 &&
    target.classIds.length === 0
  const classIds = new Set(
    source.classes
      .filter(
        (c) =>
          anywhere ||
          target.classIds.includes(c.id) ||
          target.grades.includes(c.grade) ||
          target.levels.includes(c.level) ||
          target.branchIds.includes(c.branchId),
      )
      .map((c) => c.id),
  )
  const students = source.students
    .filter((s) => s.isActive !== false && classIds.has(s.classId))
    .map((s) => s.id)
  const activeTeachers = source.teachers.filter((t) => t.isActive !== false && !t.deletedAt)
  let teacherIds: string[] = []
  if (target.roles.includes('ogretmen')) {
    const linked = new Set<string>()
    for (const a of source.assignments) if (classIds.has(a.classId)) linked.add(a.teacherId)
    for (const c of source.classes) if (classIds.has(c.id)) linked.add(c.teacherId)
    teacherIds = activeTeachers
      .filter((t) => anywhere || linked.has(t.id) || target.branchIds.includes(t.branchId))
      .map((t) => t.id)
  }
  return {
    studentIds: target.roles.includes('ogrenci') ? students : [],
    parentStudentIds: target.roles.includes('veli') ? students : [],
    teacherIds,
  }
}

function assertTargetKnown(
  source: Pick<State, 'branches' | 'classes'>,
  target: AnnouncementTarget,
) {
  const branches = new Set(source.branches.map((b) => b.id))
  const classes = new Set(source.classes.map((c) => c.id))
  const unknownBranch = target.branchIds.some((id) => !branches.has(id))
  const unknownClass = target.classIds.some((id) => !classes.has(id))
  if (unknownBranch || unknownClass)
    throw new DomainError('announcement_target_unknown', 'Seçilen kampüs veya sınıf bulunamadı.', {
      path: ['target', unknownBranch ? 'branchIds' : 'classIds'],
    })
}

const publisherOf = (by: Participant, scope: Scope): AnnouncementPublisher => ({
  role: by.role,
  userId: by.userId,
  ...(scope.teacher ? { teacherId: scope.teacher.id } : {}),
})

/**
 * Duyuru yayınlar (DOM-ILT-001, -002). Alıcı listesi yayın anında çözülür ve kaydedilir;
 * sonradan sınıfa katılan öğrenci eski duyuruyu görmez. Alıcısı olmayan duyuru yayınlanmaz.
 */
export function publishAnnouncement(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: CommunicationOptions = {},
): Announcement {
  const data = publishAnnouncementSchema.parse(input)
  requireAuthorized(
    by,
    'announcement.publish',
    { target: data.target, category: data.category },
    state,
    options,
  )
  assertTargetKnown(state, data.target)
  const recipients = resolveRecipients(state, data.target)
  if (recipientCount(recipients) === 0)
    throw new DomainError('announcement_no_recipients', 'Seçilen hedef kitlede alıcı yok.', {
      path: ['target'],
    })
  const scope = scopeFor(state, by, options)
  const onlyClass =
    data.target.classIds.length === 1 &&
    data.target.branchIds.length === 0 &&
    data.target.grades.length === 0 &&
    data.target.levels.length === 0
  const announcement: Announcement = {
    id: makeId('ann'),
    title: data.title,
    text: data.text,
    date: now,
    // Eski istemciler (Vue, mobil demo) tek sınıf duyurusunu `classId` ile tanır.
    classId: onlyClass ? (data.target.classIds[0] ?? null) : null,
    category: data.category,
    target: data.target,
    recipients,
    reads: {},
    publishedBy: publisherOf(by, scope),
  }
  // TODO(notifications): alıcılara anlık bildirim (DOM-ILT-020, -021); şimdilik uygulama içi kayıt.
  state.announcements.unshift(announcement)
  return announcement
}

function findAnnouncement(state: State, id: string) {
  return state.announcements.find((a) => a.id === id)
}
function requireVisibleAnnouncement(
  state: State,
  by: Participant,
  announcement: Announcement | undefined,
  options: CommunicationOptions,
): Announcement {
  if (!announcement || !scopeFor(state, by, options).canRead('announcements', announcement))
    throw new DomainError('announcement_not_found', 'Duyuru bulunamadı.', { kind: 'not_found' })
  return announcement
}
/**
 * Düzeltme ve geri çekme yetkisi: önce rol ve modül, sonra görünürlük, en sonda yayıncılık.
 * Görmeye yetkisi olmayan duyuru olmayanla aynı 404'ü alır (varlık sızmaz); görüp yayıncı
 * olmayan 403 alır (DOM-ILT-004).
 */
function authorizeChange(
  state: State,
  by: Participant,
  action: 'announcement.revise' | 'announcement.withdraw',
  found: Announcement | undefined,
  options: CommunicationOptions,
): Announcement {
  requireAuthorized(by, action, { announcement: undefined }, state, options)
  const announcement = requireVisibleAnnouncement(state, by, found, options)
  requireAuthorized(by, action, { announcement }, state, options)
  return announcement
}
function requireNotWithdrawn(announcement: Announcement) {
  if (announcement.withdrawnAt)
    throw new DomainError('announcement_withdrawn', 'Duyuru geri çekilmiş.', { kind: 'conflict' })
}

/**
 * Duyuruyu düzeltir (DOM-ILT-004): önceki içerik `revisions` geçmişinde kalır, kayıt
 * `revisedAt` ile "Güncellendi" işareti taşır. Hedef kitle değişmez.
 */
export function reviseAnnouncement(
  state: State,
  by: Participant,
  announcementId: string,
  input: unknown,
  now: string,
  options: CommunicationOptions = {},
): Announcement {
  const data = reviseAnnouncementSchema.parse(input)
  const found = findAnnouncement(state, announcementId)
  const announcement = authorizeChange(state, by, 'announcement.revise', found, options)
  requireNotWithdrawn(announcement)
  const next = {
    title: data.title ?? announcement.title,
    text: data.text ?? announcement.text,
    category: data.category ?? announcement.category,
  }
  if (
    next.title === announcement.title &&
    next.text === announcement.text &&
    next.category === announcement.category
  )
    throw new DomainError('announcement_unchanged', 'Duyuruda değişiklik yok.', {
      kind: 'conflict',
    })
  const revision: AnnouncementRevision = {
    // Örnek verinin tipi alanları isteğe bağlı çıkarır; kayıtta her zaman doludur.
    title: announcement.title ?? '',
    text: announcement.text ?? '',
    category: announcement.category ?? '',
    replacedAt: now,
    replacedBy: { role: by.role, userId: by.userId },
  }
  announcement.revisions = [...(announcement.revisions ?? []), revision]
  Object.assign(announcement, next, { revisedAt: now })
  // TODO(notifications): esaslı değişiklikte (tarih, yer, ücret) alıcılara yeniden bildirim.
  return announcement
}

/**
 * Duyuruyu geri çeker (DOM-ILT-004): kayıt silinmez; alıcılara görünmez, içeriği yayınlayan ve
 * yönetici görür. Geri çekme geri alınmaz.
 */
export function withdrawAnnouncement(
  state: State,
  by: Participant,
  announcementId: string,
  input: unknown,
  now: string,
  options: CommunicationOptions = {},
): Announcement {
  const data = withdrawAnnouncementSchema.parse(input)
  const found = findAnnouncement(state, announcementId)
  const announcement = authorizeChange(state, by, 'announcement.withdraw', found, options)
  requireNotWithdrawn(announcement)
  Object.assign(announcement, {
    withdrawnAt: now,
    withdrawnBy: { role: by.role, userId: by.userId },
    withdrawReason: data.reason,
  })
  return announcement
}

export type AnnouncementReadResult = {
  announcementId: string
  /** Aktörün ilk açılış anı; aktör alıcı değilse (yönetici, yayınlayan) `null`. */
  readAt: string | null
  changed: boolean
}

/**
 * Okundu işareti (DOM-ILT-003): alıcının ilk açılış anı bir kez yazılır; tekrar çağrı kaydı
 * değiştirmez. Alıcı olmayan ama duyuruyu gören (yönetici, yayınlayan) için işlem etkisizdir.
 */
export function markAnnouncementRead(
  state: State,
  by: Participant,
  announcementId: string,
  now: string,
  options: CommunicationOptions = {},
): AnnouncementReadResult {
  requireAuthorized(by, 'announcement.read', {}, state, options)
  const announcement = requireVisibleAnnouncement(
    state,
    by,
    findAnnouncement(state, announcementId),
    options,
  )
  requireNotWithdrawn(announcement)
  const keys = readerKeysFor(viewerOf(scopeFor(state, by, options)), announcement.recipients)
  if (keys.length === 0) return { announcementId, readAt: null, changed: false }
  const reads = announcement.reads ?? {}
  const unread = keys.filter((key) => reads[key] === undefined)
  if (unread.length > 0)
    announcement.reads = { ...reads, ...Object.fromEntries(unread.map((key) => [key, now])) }
  const readAt = keys.map((key) => announcement.reads?.[key] ?? now).sort()[0] ?? now
  return { announcementId, readAt, changed: unread.length > 0 }
}

// --- Birebir mesaj ------------------------------------------------------------------------

export const CONVERSATION_AUDIENCES = ['student', 'parent'] as const
export type ConversationAudience = (typeof CONVERSATION_AUDIENCES)[number]
export type MessageSender = 'teacher' | ConversationAudience

/** Mesaj üst sınırı; mesaj kaydı `records` belge sınırına (256 KB) rahatça sığar. */
export const MESSAGE_MAX_LENGTH = 2000

// kvkk: K — mesaj metni; loglanmaz, denetim kaydına yazılmaz, aramaya ve CSV'ye girmez (DOM-ILT-014).
const messageText = z
  .string()
  .trim()
  .min(1, 'Mesajınızı yazın.')
  .max(MESSAGE_MAX_LENGTH, `Mesaj en fazla ${MESSAGE_MAX_LENGTH} karakter olabilir.`)

export const sendMessageSchema = z.object({ text: messageText })
export type SendMessageInput = z.input<typeof sendMessageSchema>

/**
 * Yazışma başlatma. Öğretmen `studentId` + `audience` verir (veli yazışmasında velinin kullanıcı
 * kimliği `parentUserId`, öğrencinin tek veli hesabı varsa kendiliğinden seçilir); öğrenci ve
 * veli `studentId` + `teacherId` verir, hedef kitle rolden gelir. `text` verilirse ilk mesaj
 * olarak eklenir.
 */
export const startConversationSchema = z.object({
  studentId: identifier,
  teacherId: identifier.optional(),
  audience: z.enum(CONVERSATION_AUDIENCES, 'Yazışılacak kişiyi seçin.').optional(),
  // kvkk: K
  parentUserId: identifier.optional(),
  text: messageText.optional(),
})
export type StartConversationInput = z.input<typeof startConversationSchema>

/** Yöneticinin gerekçeli erişimi; gerekçe eksikse iş kuralı reddi (422, DOM-YTK-052). */
export const conversationAccessSchema = z.object({
  // kvkk: K — serbest metin; yalnız denetim kaydında tutulur.
  reason: z.string().trim().max(500, 'En fazla 500 karakter girebilirsiniz.').default(''),
})

/** Mesaja işlemlerin eklediği alanlar; örnek veri taşımaz. */
export type ConversationMessageFields = {
  // kvkk: K
  senderUserId?: string
  /** Karşı tarafın ilk görme anı (DOM-ILT-024). */
  readAt?: string
  /** Veli yazışmasında velinin kişi kimliği; yazışmanın kopyası (DOM-ILT-010). */
  // kvkk: K
  parentUserId?: string
}
/** Yazışmaya işlemlerin eklediği alanlar; örnek veri taşımaz. */
export type ConversationFields = {
  /** Veli yazışmasında velinin kişi kimliği (DOM-ILT-010); eski örnek kayıtta yok. */
  // kvkk: K
  parentUserId?: string
  createdAt?: string
  startedBy?: Role
}
type Conversation = State['conversations'][number]
export type ConversationMessage = State['conversationMessages'][number]
type Message = ConversationMessage
type MessageState = Pick<State, 'conversations' | 'conversationMessages'>

const SIDES: Partial<Record<Role, MessageSender>> = {
  ogretmen: 'teacher',
  ogrenci: 'student',
  veli: 'parent',
}
/** Rolün yazışmadaki tarafı; taraf olamayan rol `null`. */
export function senderSide(role: Role): MessageSender | null {
  return SIDES[role] ?? null
}

export type StartConversationOptions = CommunicationOptions & {
  /** Öğrencinin veli hesapları (API: öğrenciye `child` bağlantılı üyelikler). */
  parentUserIds?: readonly string[]
}
export type StartConversationResult = {
  conversation: Conversation
  created: boolean
  message: Message | null
}

function parentUserFor(
  by: Participant,
  audience: ConversationAudience,
  requested: string | undefined,
  candidates: readonly string[],
): string | undefined {
  if (audience !== 'parent') return undefined
  if (by.role === 'veli') return by.userId
  if (requested !== undefined) {
    if (!candidates.includes(requested))
      throw new DomainError('parent_account_not_found', 'Velinin hesabı bulunamadı.', {
        path: ['parentUserId'],
      })
    return requested
  }
  const [only, ...rest] = candidates
  if (only === undefined)
    throw new DomainError(
      'parent_account_not_found',
      'Öğrencinin platformda veli hesabı bulunmuyor.',
      { path: ['parentUserId'] },
    )
  if (rest.length > 0)
    throw new DomainError('parent_choice_required', 'Yazışılacak veliyi seçin.', {
      path: ['parentUserId'],
    })
  return only
}

/** Eklenecek mesajın kendi alanları; taraf anahtarları yazışmadan kopyalanır. */
export type NewMessage = Pick<Message, 'id' | 'text' | 'sender' | 'date'> &
  Pick<ConversationMessageFields, 'senderUserId'>

/**
 * Mesajı ayrı kayıt olarak ekler (ADR 0005) ve yazışmanın son mesaj anını günceller. Mesaj
 * yazışmanın taraf anahtarlarını taşır: kapsam kuralı (`lib/scope.ts`) ve depo süzgeci mesajın
 * kendisinden karar verir; taraflar yazışma açıldıktan sonra değişmez. Doğrulama ve yetki
 * çağıranındır (`sendMessage`, `startConversation`); çevrimdışı demolar yalnız bu şekli kullanır.
 */
export function addConversationMessage(
  state: Pick<State, 'conversationMessages'>,
  conversation: Conversation,
  input: NewMessage,
): Message {
  const message: Message = {
    id: input.id,
    conversationId: conversation.id,
    studentId: conversation.studentId,
    teacherId: conversation.teacherId,
    audience: conversation.audience,
    ...(conversation.parentUserId === undefined ? {} : { parentUserId: conversation.parentUserId }),
    text: input.text,
    sender: input.sender,
    ...(input.senderUserId === undefined ? {} : { senderUserId: input.senderUserId }),
    date: input.date,
  }
  state.conversationMessages.push(message)
  conversation.lastMessageAt = message.date
  return message
}

function appendMessage(
  state: MessageState,
  conversation: Conversation,
  by: Participant,
  side: MessageSender,
  text: string,
  makeId: MakeId,
  now: string,
): Message {
  return addConversationMessage(state, conversation, {
    id: makeId('msg'),
    text,
    sender: side,
    senderUserId: by.userId,
    date: now,
  })
}

/** Yazışmanın mesajları, eklenme sırasıyla (bellekteki State; API mesajları SQL'de süzer). */
export function messagesOf(
  state: Pick<State, 'conversationMessages'>,
  conversationId: string,
): Message[] {
  return state.conversationMessages.filter((m) => m.conversationId === conversationId)
}

/**
 * Yazışma başlatır (DOM-ILT-010, -011). Aynı öğrenci, öğretmen, hedef kitle ve veli için tek
 * yazışma vardır: varsa yenisi açılmaz, ilk mesaj var olan yazışmaya eklenir (`created: false`).
 * Tekillik yalnız aynı öğrencinin yazışmalarına bakar; API yalnız onları yükler.
 */
export function startConversation(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: StartConversationOptions = {},
): StartConversationResult {
  const data = startConversationSchema.parse(input)
  const side = senderSide(by.role)
  const scope = scopeFor(state, by, options)
  const audience: ConversationAudience | undefined =
    side === 'teacher' ? data.audience : (side ?? undefined)
  const teacherId = side === 'teacher' ? (scope.teacher?.id ?? '') : (data.teacherId ?? '')
  // Önce rol, modül ve taraf ilişkisi (403); eksik hedef kitle ancak yetkili aktöre bildirilir.
  // Öğretmenin öğrenciyle ilişkisi iki hedef kitlede aynıdır.
  requireAuthorized(
    by,
    'conversation.start',
    { studentId: data.studentId, teacherId, audience: audience ?? 'student' },
    state,
    options,
  )
  if (!side || !audience)
    throw new DomainError('conversation_audience_required', 'Yazışılacak kişiyi seçin.', {
      path: ['audience'],
    })
  const parentUserId = parentUserFor(by, audience, data.parentUserId, options.parentUserIds ?? [])
  let conversation = state.conversations.find(
    (c) =>
      c.studentId === data.studentId &&
      c.teacherId === teacherId &&
      c.audience === audience &&
      c.parentUserId === parentUserId,
  )
  const created = !conversation
  if (!conversation) {
    conversation = {
      id: makeId('conv'),
      studentId: data.studentId,
      teacherId,
      audience,
      ...(parentUserId === undefined ? {} : { parentUserId }),
      createdAt: now,
      startedBy: by.role,
    }
    state.conversations.push(conversation)
  }
  const message =
    data.text === undefined
      ? null
      : appendMessage(state, conversation, by, side, data.text, makeId, now)
  return { conversation, created, message }
}

function requireConversation(conversation: Conversation | undefined): Conversation {
  if (!conversation)
    throw new DomainError('conversation_not_found', 'Yazışma bulunamadı.', { kind: 'not_found' })
  return conversation
}

/**
 * Mesaj gönderir (DOM-ILT-012): yalnız taraf gönderir; mesaj eklenir, değiştirilmez. Var olan
 * mesajları okumaz; API mesaj koleksiyonundan hiçbir kayıt yüklemez.
 */
export function sendMessage(
  state: State,
  by: Participant,
  conversationId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: CommunicationOptions = {},
): Message {
  const data = sendMessageSchema.parse(input)
  const found = state.conversations.find((c) => c.id === conversationId)
  requireAuthorized(by, 'message.send', { conversation: found, userId: by.userId }, state, options)
  const conversation = requireConversation(found)
  const side = senderSide(by.role)
  if (!side)
    throw new DomainError('conversation_not_found', 'Yazışma bulunamadı.', { kind: 'not_found' })
  // TODO(notifications): karşı tarafa bildirim; sessiz saat (DOM-ILT-021) bildirim katmanında.
  return appendMessage(state, conversation, by, side, data.text, makeId, now)
}

export type MessagesReadResult = { conversationId: string; count: number }

/**
 * Karşı tarafın okunmamış mesajlarını okundu işaretler (DOM-ILT-024); ilk görme anı bir kez
 * yazılır. Yöneticinin gerekçeli okuması taraf okuması değildir, okundu üretmez. Yalnız bu
 * yazışmanın karşı taraf mesajlarına bakar; API yalnız onların okunmamışlarını yükler.
 */
export function markMessagesRead(
  state: State,
  by: Participant,
  conversationId: string,
  now: string,
  options: CommunicationOptions = {},
): MessagesReadResult {
  const found = state.conversations.find((c) => c.id === conversationId)
  requireAuthorized(by, 'message.read', { conversation: found, userId: by.userId }, state, options)
  const conversation = requireConversation(found)
  const side = senderSide(by.role)
  let count = 0
  for (const message of state.conversationMessages)
    if (message.conversationId === conversation.id && message.sender !== side && !message.readAt) {
      message.readAt = now
      count += 1
    }
  return { conversationId, count }
}

/** Gerekçeli erişimin geçerlik süresi (dakika); süre bitince yeniden gerekçe istenir. */
export const CONVERSATION_ACCESS_MINUTES = 30

export type ConversationAccess = { conversationId: string; reason: string; expiresAt: string }

/**
 * Yöneticinin yazışmayı gerekçeyle açması (DOM-YTK-052, DOM-ILT-011). State değişmez; erişim
 * kaydı çağıranındır (API `audit_log`). Gerekçe yoksa 422, yazışma yoksa 404.
 */
export function openConversationAccess(
  state: State,
  actor: Actor,
  conversationId: string,
  input: unknown,
  now: string,
  options: CommunicationOptions = {},
): ConversationAccess {
  const { reason } = conversationAccessSchema.parse(input)
  const found = state.conversations.find((c) => c.id === conversationId)
  requireAuthorized(actor, 'conversation.access', { reason, conversation: found }, state, options)
  requireConversation(found)
  const expiresAt = new Date(Date.parse(now) + CONVERSATION_ACCESS_MINUTES * 60_000).toISOString()
  return { conversationId, reason, expiresAt }
}

/** Aktöre görünen yazışmalar (taraf olduğu); yönetici ve ön büro için boş. */
export function conversationsFor(
  state: Pick<State, 'conversations'>,
  scope: Pick<Scope, 'actor' | 'teacher' | 'studentIds'>,
  userId: string,
): Conversation[] {
  return state.conversations.filter((c) => isConversationParty(scope, userId, c))
}

// --- Okuma görünümü -----------------------------------------------------------------------

export type MessageView = {
  id: string
  // kvkk: K
  text: string
  sender: string
  sentAt: string
  readAt: string | null
  fromMe: boolean
}
export function messageView(message: Message, side: MessageSender | null): MessageView {
  return {
    id: message.id,
    text: message.text,
    sender: message.sender,
    sentAt: message.date,
    readAt: message.readAt ?? null,
    fromMe: side !== null && message.sender === side,
  }
}

export type MessagePage = { items: MessageView[]; nextCursor: string | null }

/**
 * Mesaj sayfası: en yeniden geriye. `messages` tek yazışmanın mesajlarıdır, eklenme sırasıyla
 * (`messagesOf`). `cursor` önceki sayfanın en eski mesajının kimliğidir (mesajlar değişmediği ve
 * silinmediği için kararlıdır); sayfa içinde sıra eskiden yeniye. Geçersiz imleç `null` döner
 * (API 400). API aynı sözleşmeyi SQL'de uygular (`services/communication.ts`).
 */
export function messagePage(
  messages: readonly Message[],
  side: MessageSender | null,
  { cursor, limit }: { cursor?: string | undefined; limit: number },
): MessagePage | null {
  let end = messages.length
  if (cursor !== undefined) {
    end = messages.findIndex((m) => m.id === cursor)
    if (end < 0) return null
  }
  const start = Math.max(0, end - limit)
  return {
    items: messages.slice(start, end).map((m) => messageView(m, side)),
    nextCursor: start > 0 ? (messages[start]?.id ?? null) : null,
  }
}

// --- Yanıt süresi (DOM-ILT-013) -----------------------------------------------------------

/**
 * Kurumun çalışma takvimi: ISO hafta günleri (1 pazartesi … 7 pazar), günün başlangıç ve bitiş
 * dakikası (Europe/Istanbul) ve resmî tatil günleri (`YYYY-MM-DD`). Sessiz saatler çalışma
 * saatlerinin dışındadır.
 */
export type WorkingCalendar = {
  weekdays: readonly number[]
  startMinute: number
  endMinute: number
  holidays: readonly string[]
}
// TODO(institution-settings): takvim ve hedef süre kurum ayarına taşınınca oradan okunur.
export const DEFAULT_WORKING_CALENDAR: WorkingCalendar = {
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 8 * 60,
  endMinute: 17 * 60,
  holidays: [],
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// Türkiye 2016'dan beri yaz saati uygulamaz; Europe/Istanbul sabit UTC+3'tür.
const ISTANBUL_OFFSET = 3 * 60 * MINUTE
// Takvimde iş günü kalmamışsa döngü sonsuza gitmez.
const MAX_DAYS = 3700

function assertCalendar(calendar: WorkingCalendar) {
  if (
    calendar.weekdays.length === 0 ||
    calendar.startMinute < 0 ||
    calendar.endMinute > 24 * 60 ||
    calendar.endMinute <= calendar.startMinute
  )
    throw new DomainError('working_calendar_invalid', 'Çalışma takvimi geçersiz.')
}

/** Yerel günün çalışma aralığı (yerel ms); iş günü değilse `null`. */
function workingWindow(day: number, calendar: WorkingCalendar): [number, number] | null {
  const start = day * DAY
  const date = new Date(start)
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  if (!calendar.weekdays.includes(weekday)) return null
  if (calendar.holidays.includes(date.toISOString().slice(0, 10))) return null
  return [start + calendar.startMinute * MINUTE, start + calendar.endMinute * MINUTE]
}

const local = (instant: string | number | Date) => new Date(instant).getTime() + ISTANBUL_OFFSET

/** İki an arasındaki çalışma dakikası (aşağı yuvarlanır). */
export function businessMinutesBetween(
  from: string | Date,
  to: string | Date,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): number {
  assertCalendar(calendar)
  const start = local(from),
    end = local(to)
  if (!(end > start)) return 0
  let total = 0
  const lastDay = Math.floor(end / DAY)
  for (let day = Math.floor(start / DAY); day <= lastDay; day += 1) {
    const window = workingWindow(day, calendar)
    if (!window) continue
    const overlap = Math.min(end, window[1]) - Math.max(start, window[0])
    if (overlap > 0) total += overlap
  }
  return Math.floor(total / MINUTE)
}

/** Varsayılan hedef: bir iş günü (takvimin günlük çalışma süresi). */
export function oneBusinessDay(calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR) {
  return calendar.endMinute - calendar.startMinute
}

/** `from` anından `targetMinutes` çalışma dakikası sonraki an (ISO UTC). */
export function responseDueAt(
  from: string | Date,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
  targetMinutes = oneBusinessDay(calendar),
): string {
  assertCalendar(calendar)
  let remaining = Math.max(0, targetMinutes) * MINUTE
  let cursor = local(from)
  const firstDay = Math.floor(cursor / DAY)
  for (let day = firstDay; day < firstDay + MAX_DAYS; day += 1) {
    const window = workingWindow(day, calendar)
    if (!window) continue
    const start = Math.max(cursor, window[0])
    if (start >= window[1]) continue
    if (remaining <= window[1] - start)
      return new Date(start + remaining - ISTANBUL_OFFSET).toISOString()
    remaining -= window[1] - start
    cursor = window[1]
  }
  throw new DomainError('working_calendar_invalid', 'Çalışma takvimi geçersiz.')
}

export type AwaitingReply = { since: string; dueAt: string; overdue: boolean }

/**
 * Yazışmanın mesajlarından hesaplanan özet (saklanmaz). API aynı değerleri SQL'de, yalnız
 * sayfadaki yazışmaların mesajları üzerinden hesaplar; testler iki tarafın aynı olduğunu
 * doğrular.
 * - `unreadCount`: bakan tarafın okumadığı karşı taraf mesajları; taraf değilse 0.
 * - `firstUnanswered`: öğretmenin son mesajından sonraki ilk mesaj; son mesaj öğretmenin veya
 *   mesaj yoksa `null` (DOM-ILT-013).
 */
export type MessageDigest = {
  messageCount: number
  lastMessage: Message | null
  unreadCount: number
  firstUnanswered: Pick<Message, 'date'> | null
}

/** Tek yazışmanın mesajlarından (eklenme sırasıyla) özet. */
export function digestMessages(
  messages: readonly Message[],
  side: MessageSender | null,
): MessageDigest {
  let index = messages.length
  while (index > 0 && messages[index - 1]?.sender !== 'teacher') index -= 1
  return {
    messageCount: messages.length,
    lastMessage: messages.at(-1) ?? null,
    unreadCount: side === null ? 0 : messages.filter((m) => m.sender !== side && !m.readAt).length,
    firstUnanswered: index < messages.length ? (messages[index] ?? null) : null,
  }
}

/**
 * Öğretmenin yanıt beklemesi (DOM-ILT-013): son mesaj öğrenci veya velidense, karşı tarafın
 * yanıtsız ilk mesajından (`firstUnanswered`) itibaren hedef süre. Yanıt verilmişse veya bakan
 * öğretmen değilse `null`.
 */
export function awaitingReply(
  digest: Pick<MessageDigest, 'firstUnanswered'>,
  side: MessageSender | null,
  now: string,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
  targetMinutes = oneBusinessDay(calendar),
): AwaitingReply | null {
  // Hedef süre öğrenci sorusu ve veli mesajı içindir; öğretmenin mesajı süre başlatmaz.
  if (side !== 'teacher') return null
  const first = digest.firstUnanswered
  if (!first) return null
  const dueAt = responseDueAt(first.date, calendar, targetMinutes)
  return { since: first.date, dueAt, overdue: Date.parse(now) > Date.parse(dueAt) }
}

export type ConversationSummary = {
  id: string
  studentId: string
  teacherId: string
  audience: string
  messageCount: number
  lastMessage: MessageView | null
  unreadCount: number
  awaitingReply: AwaitingReply | null
}

/** Liste satırı: son mesaj, okunmamış sayısı ve yanıt bekleme durumu (taraf görünümü). */
export function conversationSummary(
  conversation: Pick<Conversation, 'id' | 'studentId' | 'teacherId' | 'audience'>,
  digest: MessageDigest,
  side: MessageSender | null,
  now: string,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): ConversationSummary {
  const last = digest.lastMessage
  return {
    id: conversation.id,
    studentId: conversation.studentId,
    teacherId: conversation.teacherId,
    audience: conversation.audience,
    messageCount: digest.messageCount,
    lastMessage: last && side !== null ? messageView(last, side) : null,
    unreadCount: side === null ? 0 : digest.unreadCount,
    awaitingReply: awaitingReply(digest, side, now, calendar),
  }
}

/** Liste sırası anahtarı: son mesaj anı, yoksa açılış anı (azalan sıralanır). */
export function lastActivityOf(
  conversation: Partial<Pick<Conversation, 'lastMessageAt' | 'createdAt'>>,
): string {
  return conversation.lastMessageAt ?? conversation.createdAt ?? ''
}
