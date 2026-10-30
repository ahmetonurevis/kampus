import type { Role } from '../modules/navigation.ts'
import type {
  AnnouncementPublisher,
  AnnouncementRecipients,
  AnnouncementTarget,
  ConversationAudience,
} from './communication.ts'
import type { Scope, ScopeSource } from './scope.ts'

/**
 * İletişim modülünün yetki kararları (docs/domain/iletisim-ve-veli.md). `lib/authorize.ts`
 * eylem tablosu bu fonksiyonları çağırır; işlemler (`lib/communication.ts`) ve API yazışma
 * okuması (`isConversationParty`) aynı kararı kullanır. Burada yalnız karar verilir; red
 * `authorize.ts` tarafından `DomainError`'a çevrilir.
 */

export type CommunicationDenial = {
  code: string
  message: string
  rule: string
  kind?: 'forbidden' | 'not_found' | 'rule'
}

/** Yazışmanın taraf bilgisi; kayıt içeriği (mesajlar) kararda okunmaz. */
export type ConversationParties = {
  studentId: string
  teacherId: string
  audience: ConversationAudience | string
  parentUserId?: string | undefined
}

type Source = Pick<ScopeSource, 'students' | 'teachers' | 'classes'> & {
  assignments: readonly { classId: string; teacherId: string }[]
}
type PartyScope = Pick<Scope, 'actor' | 'teacher' | 'studentIds'>

const scopeDenied = (rule: string): CommunicationDenial => ({
  code: 'announcement_scope_denied',
  message: 'Bu hedef kitleye duyuru yayınlama yetkiniz bulunmuyor.',
  rule,
})

/**
 * Duyuru yayın yetkisi (DOM-ILT-002): yönetici her kapsamda; ön büro yalnız idari kategoride
 * kurum veya kampüs kapsamında; öğretmen yalnız ders verdiği/rehberi olduğu sınıfların öğrenci
 * ve velilerine. Öğrenci ve veli rol tablosunda yoktur.
 */
export function publishDecision(
  scope: Pick<Scope, 'actor' | 'teacher' | 'classIds'>,
  target: AnnouncementTarget,
  category: string,
): CommunicationDenial | null {
  switch (scope.actor.role) {
    case 'yonetici':
      return null
    case 'onburo':
      if (category !== 'İdari')
        return {
          code: 'announcement_category_forbidden',
          message: 'Ön büro yalnız idari duyuru yayınlayabilir.',
          rule: 'DOM-ILT-002',
        }
      return target.classIds.length > 0 || target.grades.length > 0 || target.levels.length > 0
        ? scopeDenied('DOM-ILT-002')
        : null
    case 'ogretmen': {
      const own =
        !!scope.teacher &&
        target.classIds.length > 0 &&
        target.branchIds.length === 0 &&
        target.grades.length === 0 &&
        target.levels.length === 0 &&
        target.classIds.every((id) => scope.classIds.has(id)) &&
        !target.roles.includes('ogretmen')
      return own ? null : scopeDenied('DOM-ILT-002')
    }
    default:
      return scopeDenied('DOM-ILT-002')
  }
}

/** Duyuruyu okuyan: rol, öğretmen kaydı ve kapsamdaki öğrenciler (`scopeFor` bağlamı). */
export type AnnouncementViewer = {
  role: Role | undefined
  userId?: string | undefined
  teacherId: string | undefined
  studentIds: ReadonlySet<string>
}
export function viewerOf(
  scope: Pick<Scope, 'actor' | 'teacher' | 'studentIds'>,
): AnnouncementViewer {
  return {
    role: scope.actor.role,
    userId: scope.actor.userId,
    teacherId: scope.teacher?.id,
    studentIds: scope.studentIds,
  }
}

/**
 * Duyuruyu yayınlayan bu aktör mü (DOM-ILT-004): öğretmen kendi kaydıyla, ön büro kişi
 * kimliğiyle (`publishedBy.userId`); ön büro rolü tek başına yayıncı sayılmaz. Kimliği bilinmeyen
 * aktör yayıncı değildir.
 */
export function isPublisher(
  viewer: Pick<AnnouncementViewer, 'role' | 'teacherId'> & { userId?: string | undefined },
  publishedBy:
    | (Pick<AnnouncementPublisher, 'role' | 'teacherId'> & { userId?: string | undefined })
    | undefined,
): boolean {
  if (!publishedBy) return false
  if (viewer.role === 'ogretmen')
    return viewer.teacherId !== undefined && publishedBy.teacherId === viewer.teacherId
  return (
    viewer.role === 'onburo' &&
    publishedBy.role === 'onburo' &&
    viewer.userId !== undefined &&
    publishedBy.userId === viewer.userId
  )
}

/** Okundu anahtarı: öğrenci ve öğretmen kendisi, veli çocuğu üzerinden (aile düzeyi). */
export function readerKey(kind: 'student' | 'parent' | 'teacher', recordId: string) {
  return `${kind}:${recordId}`
}

/** Okuyucunun bu duyurudaki anahtarları; alıcı değilse boş. */
export function readerKeysFor(
  viewer: AnnouncementViewer,
  recipients: AnnouncementRecipients | undefined,
): string[] {
  if (!recipients) return []
  switch (viewer.role) {
    case 'ogrenci':
      return recipients.studentIds
        .filter((id) => viewer.studentIds.has(id))
        .map((id) => readerKey('student', id))
    case 'veli':
      return recipients.parentStudentIds
        .filter((id) => viewer.studentIds.has(id))
        .map((id) => readerKey('parent', id))
    case 'ogretmen':
      return viewer.teacherId !== undefined && recipients.teacherIds.includes(viewer.teacherId)
        ? [readerKey('teacher', viewer.teacherId)]
        : []
    default:
      return []
  }
}

/** Alıcı sayısı (okundu oranının paydası). */
export function recipientCount(recipients: AnnouncementRecipients | undefined) {
  return recipients
    ? recipients.studentIds.length +
        recipients.parentStudentIds.length +
        recipients.teacherIds.length
    : 0
}

// Satırlar API'den gelen JSON da olabilir; alanlar okunurken türü daraltılır.
const field = (row: object, key: string): unknown =>
  Object.hasOwn(row, key) ? Reflect.get(row, key) : undefined
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const textOf = (row: object, key: string) => {
  const value = field(row, key)
  return typeof value === 'string' ? value : undefined
}

function recipientsOf(row: object): AnnouncementRecipients | undefined {
  const value = field(row, 'recipients')
  if (typeof value !== 'object' || value === null) return undefined
  return {
    studentIds: strings(field(value, 'studentIds')),
    parentStudentIds: strings(field(value, 'parentStudentIds')),
    teacherIds: strings(field(value, 'teacherIds')),
  }
}
function publisherOf(
  row: object,
): (Pick<AnnouncementPublisher, 'role' | 'teacherId'> & { userId?: string }) | undefined {
  const value = field(row, 'publishedBy')
  if (typeof value !== 'object' || value === null) return undefined
  const role = textOf(value, 'role')
  const teacherId = textOf(value, 'teacherId')
  const userId = textOf(value, 'userId')
  if (role === undefined) return undefined
  return {
    role: role as Role,
    ...(teacherId === undefined ? {} : { teacherId }),
    ...(userId === undefined ? {} : { userId }),
  }
}

/** Okundu sayısını ve geçmişi gören: yönetici veya yayınlayan (DOM-ILT-003, -004). */
function privileged(viewer: AnnouncementViewer, row: object) {
  return viewer.role === 'yonetici' || isPublisher(viewer, publisherOf(row))
}

/**
 * Duyuru görünürlüğü (DOM-ILT-001, -004). Alıcı listesi olan duyuruyu alıcılar, yayınlayan,
 * yönetici ve ön büro görür. Geri çekilen duyuru aynı kişilere "Geri çekildi" olarak görünmeye
 * devam eder; içeriğini `narrowAnnouncement` yalnız yayınlayan ve yöneticiye bırakır. Alıcı
 * listesi olmayan eski kayıtta karar `legacy` kuralınındır (sınıfa özel veya genel).
 */
export function announcementVisible(
  viewer: AnnouncementViewer,
  row: object,
  legacy: () => boolean,
): boolean {
  const recipients = recipientsOf(row)
  if (!recipients) return legacy()
  if (privileged(viewer, row) || viewer.role === 'onburo') return true
  return readerKeysFor(viewer, recipients).length > 0
}

/** Okundu ayrıntısı ve alıcı listesi hiçbir role ham dönmez; sayı olarak verilir. */
export const ANNOUNCEMENT_HIDDEN_FIELDS: readonly string[] = ['reads', 'recipients']
// Yalnız yayınlayan ve yöneticinin gördüğü alanlar.
const PRIVILEGED_FIELDS = ['revisions', 'withdrawReason', 'withdrawnBy']
/**
 * Geri çekilen duyuruda alıcıdan ayıklanan içerik (DOM-ILT-004). Başlık, kategori, tarih ve
 * `withdrawnAt` kalır: alıcı hangi duyurunun geri çekildiğini görür, metnini görmez.
 */
export const WITHDRAWN_CONTENT_FIELDS: readonly string[] = ['text']

/**
 * Duyurunun role göre biçimi: yönetici ve yayınlayan okundu ve alıcı sayısını
 * (`readCount`, `recipientCount`), diğer okuyucular kendi ilk açılış anını (`myReadAt`) alır;
 * düzeltme geçmişi, geri çekme gerekçesi ve yayınlayanın kişi kimliği yalnız yetkiliye döner.
 * Geri çekilen duyurunun metni (`WITHDRAWN_CONTENT_FIELDS`) yetkili olmayana dönmez
 * (DOM-ILT-004). Geri çekilmemiş eski kayıt (alıcı listesi yok) değişmeden döner.
 */
export function narrowAnnouncement(
  viewer: AnnouncementViewer,
  original: object,
  copy: Record<string, unknown>,
): Record<string, unknown> {
  const recipients = recipientsOf(original)
  const withdrawn = textOf(original, 'withdrawnAt') !== undefined
  if (!recipients && !withdrawn) return copy
  const value = field(original, 'reads')
  const reads: Record<string, unknown> =
    typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
  if (privileged(viewer, original))
    return recipients
      ? {
          ...copy,
          readCount: Object.keys(reads).length,
          recipientCount: recipientCount(recipients),
        }
      : copy
  const hidden = withdrawn ? [...PRIVILEGED_FIELDS, ...WITHDRAWN_CONTENT_FIELDS] : PRIVILEGED_FIELDS
  const narrowed = Object.fromEntries(Object.entries(copy).filter(([key]) => !hidden.includes(key)))
  if (!recipients) return narrowed
  const mine = readerKeysFor(viewer, recipients)
    .map((key) => reads[key])
    .filter((at): at is string => typeof at === 'string')
    .sort()
  const publisher = publisherOf(original)
  return {
    ...narrowed,
    ...(publisher ? { publishedBy: { role: publisher.role } } : {}),
    myReadAt: mine[0] ?? null,
  }
}

/**
 * Düzeltme ve geri çekme (DOM-ILT-004): yönetici veya yayınlayan. Yayınlayanı bilinmeyen eski
 * duyuruyu yalnız yönetici değiştirir. Kayıt bulunmazsa karar işleme bırakılır (404).
 */
export function publisherDecision(
  scope: Pick<Scope, 'actor' | 'teacher' | 'studentIds'>,
  announcement: { publishedBy?: AnnouncementPublisher | undefined } | undefined,
): CommunicationDenial | null {
  if (!announcement || scope.actor.role === 'yonetici') return null
  return isPublisher(viewerOf(scope), announcement.publishedBy)
    ? null
    : {
        code: 'announcement_publisher_only',
        message: 'Duyuruyu yalnız yayınlayan veya yönetici değiştirebilir.',
        rule: 'DOM-ILT-004',
      }
}

/** Aktör yazışmanın tarafı mı. Yönetici ve ön büro taraf değildir (DOM-YTK-052). */
export function isConversationParty(
  scope: PartyScope,
  userId: string,
  conversation: ConversationParties,
): boolean {
  switch (scope.actor.role) {
    case 'ogretmen':
      return !!scope.teacher && conversation.teacherId === scope.teacher.id
    case 'ogrenci':
      return conversation.audience === 'student' && scope.studentIds.has(conversation.studentId)
    case 'veli':
      // Her velinin yazışması ayrıdır (DOM-ILT-010). Veli kimliği olmayan eski kayıt kapalı
      // başarısızdır: hiçbir veliye açılmaz (öğretmen ve yönetici kuralları değişmez).
      return (
        conversation.audience === 'parent' &&
        scope.studentIds.has(conversation.studentId) &&
        conversation.parentUserId !== undefined &&
        conversation.parentUserId === userId
      )
    default:
      return false
  }
}

const roleAudience: Partial<Record<Role, ConversationAudience>> = {
  ogrenci: 'student',
  veli: 'parent',
}

/**
 * Öğretmen–öğrenci ilişkisi: öğretmen öğrencinin sınıfına ders veriyor, sınıfın rehber
 * öğretmeni ya da kurumun rehberlik görevlisi (DOM-ILT-010, DOM-ILT-011). Pasif kayıt ilişki
 * vermez.
 */
function related(source: Source, studentId: string, teacherId: string): boolean {
  const student = source.students.find((s) => s.id === studentId)
  const teacher = source.teachers.find(
    (t) => t.id === teacherId && t.isActive !== false && !t.deletedAt,
  )
  if (!student || !teacher || ('isActive' in student && student.isActive === false)) return false
  if (teacher.guidanceCounselor === true) return true
  if (source.assignments.some((a) => a.classId === student.classId && a.teacherId === teacherId))
    return true
  return source.classes.some((c) => c.id === student.classId && c.teacherId === teacherId)
}

const partyDenied: CommunicationDenial = {
  code: 'conversation_party_forbidden',
  message: 'Bu kişiyle yazışma başlatamazsınız.',
  rule: 'DOM-ILT-010',
}

/**
 * Yazışma başlatma (DOM-ILT-010, -011): öğretmen yalnız kendi öğrencisi veya onun velisiyle;
 * öğrenci kendi öğretmeniyle (öğrenci–öğrenci yok); veli yalnız çocuğunun öğretmeniyle. Hedef
 * kitle rolden gelir; öğrenci veli yazışması, veli öğrenci yazışması açamaz.
 */
export function startDecision(
  scope: PartyScope,
  source: Source,
  parties: ConversationParties,
): CommunicationDenial | null {
  const role = scope.actor.role
  if (role === 'ogretmen') {
    if (!scope.teacher || parties.teacherId !== scope.teacher.id) return partyDenied
    if (parties.audience !== 'student' && parties.audience !== 'parent') return partyDenied
  } else {
    const audience = roleAudience[role]
    if (!audience || parties.audience !== audience) return partyDenied
    if (!scope.studentIds.has(parties.studentId)) return partyDenied
  }
  return related(source, parties.studentId, parties.teacherId) ? null : partyDenied
}

/**
 * Mesaj gönderme: yalnız taraf (taraf olmayana yazışma yoktur, 404). Öğretmenin ders ilişkisi
 * bittiyse yazışma okunur ama yeni mesaj gönderilmez (atama bitince yetki biter).
 */
export function sendDecision(
  scope: PartyScope,
  source: Source,
  userId: string,
  conversation: ConversationParties | undefined,
): CommunicationDenial | null {
  if (!conversation) return null
  if (!isConversationParty(scope, userId, conversation))
    return {
      code: 'conversation_not_found',
      message: 'Yazışma bulunamadı.',
      rule: 'DOM-YTK-052',
      kind: 'not_found',
    }
  return related(source, conversation.studentId, conversation.teacherId)
    ? null
    : {
        code: 'conversation_relationship_ended',
        message: 'Bu öğrenciyle ders ilişkiniz sona erdiği için yeni mesaj gönderemezsiniz.',
        rule: 'DOM-ILT-010',
      }
}

/** Okundu işareti: yalnız taraf; yöneticinin gerekçeli okuması okundu üretmez (DOM-ILT-024). */
export function readDecision(
  scope: PartyScope,
  userId: string,
  conversation: ConversationParties | undefined,
): CommunicationDenial | null {
  if (!conversation || isConversationParty(scope, userId, conversation)) return null
  return {
    code: 'conversation_not_found',
    message: 'Yazışma bulunamadı.',
    rule: 'DOM-YTK-052',
    kind: 'not_found',
  }
}

/** Yöneticinin gerekçeli erişimi (DOM-YTK-052, DOM-ILT-011): gerekçe en az 10 karakter. */
export const ACCESS_REASON_MIN_LENGTH = 10
export function accessDecision(reason: string): CommunicationDenial | null {
  return reason.trim().length >= ACCESS_REASON_MIN_LENGTH
    ? null
    : {
        code: 'access_reason_required',
        message: 'Yazışmayı açmak için şikâyet veya soruşturma gerekçesini yazın.',
        rule: 'DOM-YTK-052',
        kind: 'rule',
      }
}
