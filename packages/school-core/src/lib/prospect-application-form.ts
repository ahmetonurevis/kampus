import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  buildProspect,
  createProspectSchema,
  findProspectDuplicate,
  PROSPECT_NOTE_LIMIT,
  requireValidNewProspect,
  type ProspectDuplicate,
  type ProspectNote,
  type ProspectSource,
} from './prospects.ts'

/**
 * Kurum sitesine gömülen ön başvuru formu (ON-133; docs/domain/kayit-ve-crm.md DOM-KAY-002, -003,
 * -004, -007, -009; IST-145). Başvuran oturum açmaz: kurum, kurumun iptal edilebilir form
 * anahtarından çözülür, gövdede kurum kimliği yoktur. Saf kurallar burada; anahtar üretimi,
 * yükleme ve yazma API'dedir.
 *
 * - Form yalnız ön büro formunun en az verisini alır: T.C. kimlik no, doğum tarihi, adres, kaynak,
 *   referans ve kardeş alanı yoktur; bilinmeyen alan 400. Kaynak sunucuda `Web sitesi`dir.
 * - Aydınlatma sürümü güncel yayımlı sürüm olmalıdır: başvuran başka bir metni görmüş kaydedilmez.
 * - Yanıt kişi varlığını belli etmez: aynı iletişimli açık adayda yeni kayıt açılmaz, adayın kartına
 *   sınırlı temas notu düşülür (DOM-KAY-002) ve dışarıya aynı başarı yanıtı döner. Mükerrer
 *   başvurunun ticari ileti onayı yazılmaz: doğrulanmamış bir gönderim başkasının onayını açamaz.
 * - Yeni adayın formda işaretlediği kanal `verified: false` yazılır ve onay sayılmaz: formu kimin
 *   doldurduğu bilinmez. Personel kişiyle konuşup doğrularsa işaret kalkar (DOM-KAY-004).
 * - Gizli alan (`website`) dolu gönderim hiçbir şey yazmaz, yine aynı yanıtı alır.
 * - Kurum tavanı doluyken başvuru alınmaz ve başvurana söylenir; tavan söylenmez, yöneticiye uyarı
 *   çıkar (DOM-KAY-002, K-23). Denetim mükerrer aramasından öncedir: yanıt kişi varlığını belli etmez.
 */

z.config(z.locales.tr())

/** Formdan açılan adayın kaynağı (DOM-KAY-007); başvuran seçmez. */
export const APPLICATION_FORM_SOURCE = 'Web sitesi' satisfies ProspectSource
/** Forma düşen temas notunun gösterilen yazarı; notu yazan kullanıcı yoktur. */
export const APPLICATION_NOTE_AUTHOR = 'Web sitesi formu'
/** Bir adaya bu süre içinde ikinci form notu düşmez; metne bakılmaz, metni başvuran belirler. */
export const APPLICATION_NOTE_REPEAT_MS = 24 * 60 * 60 * 1000
/** `APPLICATION_NOTE_LIMIT`'in sayıldığı pencere: eski notlar gerçek başvuruyu susturmaz. */
export const APPLICATION_NOTE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
/** Pencere içinde bir adayda en çok form notu. */
export const APPLICATION_NOTE_LIMIT = 20
/** Kartta en çok form notu: gönderimler ön büronun not payını dolduramaz (`PROSPECT_NOTE_LIMIT`). */
export const APPLICATION_NOTE_TOTAL_LIMIT = 100
/** Nottaki ad ve ilginin en fazla uzunluğu: başvuran kartta uzun serbest metin bırakamaz. */
export const APPLICATION_NOTE_FIELD_MAX = 40
/**
 * Bir kurumda formdan bir günde (Europe/Istanbul) açılabilecek en çok aday. IP sınırı proxy havuzuna
 * karşı yetmez; tavan sahte aday yığılmasını ve kurum kilidinde beklemeyi sınırlar.
 */
export const APPLICATION_DAILY_PROSPECT_LIMIT = 200
/**
 * Bir kurumda bir günde sayılan en çok alınamayan başvuru (K-23). Sayım denetim satırıdır ve tavan
 * doluyken gönderim sürer; üst sınır, proxy havuzunun `audit_log`'u şişirmesini önler.
 */
export const APPLICATION_DAILY_REJECTED_LIMIT = 1000

/** Form anahtarının biçimi: 24 rastgele baytın base64url karşılığı. */
const FORM_KEY = /^[A-Za-z0-9_-]{32}$/
export const isApplicationFormKey = (value: string) => FORM_KEY.test(value)

/**
 * Yalnız kök adres (`https://okul.example`): `frame-ancestors` başlığına yazıldığı için joker,
 * yol ve başlığı bölebilecek karakter kabul edilmez.
 */
const SITE_ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/
const SITE_ORIGIN_MESSAGE = 'Kurum sitesinin adresini https://okul.example biçiminde girin.'

export const siteOriginSchema = z
  .string(SITE_ORIGIN_MESSAGE)
  .trim()
  .max(255, SITE_ORIGIN_MESSAGE)
  .transform((value, context) => {
    const url = URL.canParse(value) ? new URL(value) : null
    const bare =
      url !== null &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      SITE_ORIGIN.test(url.origin)
    if (!bare) {
      context.addIssue({ code: 'custom', message: SITE_ORIGIN_MESSAGE })
      return z.NEVER
    }
    return url.origin
  })

/** Yöneticinin form ayarı; en az bir alan gönderilir. */
export const updateApplicationFormSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    /** `null` adresi kaldırır: form gömülemez, yalnız doğrudan bağlantıyla açılır. */
    siteOrigin: siteOriginSchema.nullable().optional(),
  })
  .refine((data) => data.enabled !== undefined || data.siteOrigin !== undefined, {
    message: 'Değiştirilecek bir ayar seçin.',
  })
export type UpdateApplicationFormInput = z.input<typeof updateApplicationFormSchema>

const { shape } = createProspectSchema

/**
 * Başvuru gövdesi (DOM-KAY-009). Alan kuralları ve iletileri ön büro formuyla aynıdır; kaynak,
 * referans ve kardeş alanı dışarıdan alınmaz. Ad ve iletişim sınıfları `createProspectSchema`'dadır.
 */
export const prospectApplicationSchema = z.strictObject({
  name: shape.name,
  phone: shape.phone,
  email: shape.email,
  branchId: shape.branchId,
  interest: shape.interest,
  minor: shape.minor,
  guardianName: shape.guardianName,
  privacyNoticeVersion: shape.privacyNoticeVersion,
  marketingConsent: shape.marketingConsent,
  /** Gizli alan: insana görünmez, doldurulmuş gönderim yazılmaz ve saklanmaz. */
  website: z.string().max(500).optional(),
})
export type ProspectApplicationInput = z.input<typeof prospectApplicationSchema>

export const isHoneypotFilled = (website: string | undefined) => (website ?? '').trim() !== ''

/** Sürüm `privacy_notices.notice_version`'dan metne çevrilip aday kaydına yazılır (DOM-KAY-003). */
export const applicationNoticeVersion = (version: number) => String(version)

/** Başvurunun gördüğü State: yalnız kampüsler ve adaylar; API de yalnız bunları yükler. */
export type ProspectApplicationState = Pick<State, 'branches' | 'prospects'>

export type ProspectApplicationOutcome =
  | { kind: 'created'; prospectId: string }
  | { kind: 'noted'; prospectId: string }
  | { kind: 'ignored' }

export interface ProspectApplicationOptions {
  institutionType: InstitutionType
  /** Kurumun `aday` kitlesine yayımladığı güncel aydınlatma sürümü. */
  noticeVersion: number
  makeId: MakeId
  now: string
}

/** Kod noktasına göre kırpar: Türkçe harf ve emoji ortasından bölünmez. */
function clipNoteField(value: string): string {
  const characters = [...value]
  return characters.length > APPLICATION_NOTE_FIELD_MAX
    ? `${characters.slice(0, APPLICATION_NOTE_FIELD_MAX).join('')}…`
    : value
}

function repeatNoteText(
  duplicate: ProspectDuplicate,
  data: { name: string; interest: string },
): string {
  return duplicate.kind === 'same'
    ? 'Web sitesi formundan yeniden başvuru alındı.'
    : `Web sitesi formundan aynı iletişimle başka bir ad için başvuru alındı: ${clipNoteField(data.name)} · ${clipNoteField(data.interest)}`
}

/**
 * Temas notu (DOM-KAY-002); yinelenen gönderim ve sınır aşımı sessizce hiçbir şey yazmaz. Sınırlar
 * metne bakmaz: paylaşılan iletişimde metni başvuran belirlediği için farklı adlarla aşılırdı.
 */
function addRepeatNote(
  prospect: State['prospects'][number],
  text: string,
  { makeId, now }: ProspectApplicationOptions,
): boolean {
  const own = prospect.notes.filter((note) => note.author === APPLICATION_NOTE_AUTHOR)
  const age = (note: ProspectNote) => Date.parse(now) - Date.parse(note.date ?? '')
  if (
    own.some((note) => age(note) < APPLICATION_NOTE_REPEAT_MS) ||
    own.filter((note) => age(note) < APPLICATION_NOTE_WINDOW_MS).length >= APPLICATION_NOTE_LIMIT ||
    own.length >= APPLICATION_NOTE_TOTAL_LIMIT ||
    prospect.notes.length >= PROSPECT_NOTE_LIMIT
  )
    return false
  const note: ProspectNote = {
    id: makeId('note'),
    text,
    date: now,
    author: APPLICATION_NOTE_AUTHOR,
  }
  prospect.notes = [note, ...prospect.notes]
  prospect.updatedAt = now
  return true
}

/**
 * Başvuruyu işler (DOM-KAY-002, -003, -009). Yetki denetimi yoktur: yetki form anahtarıdır ve API'de
 * çözülür. Reddedilen her durum yalnız girdiye ve kuruma bakar; aynı iletişimli adayın varlığı hiçbir
 * zaman ret ya da farklı sonuç olarak dışarı çıkmaz (sonucun türü yalnız denetim ve testler içindir).
 */
export function submitProspectApplication(
  state: ProspectApplicationState,
  input: unknown,
  options: ProspectApplicationOptions,
): ProspectApplicationOutcome {
  const { website, ...fields } = prospectApplicationSchema.parse(input)
  if (isHoneypotFilled(website)) return { kind: 'ignored' }
  if (fields.privacyNoticeVersion !== applicationNoticeVersion(options.noticeVersion))
    throw new DomainError(
      'notice_outdated',
      'Aydınlatma metni güncellendi; lütfen güncel metni okuyun.',
      { kind: 'conflict', path: ['privacyNoticeVersion'] },
    )
  const data = createProspectSchema.parse({ ...fields, source: APPLICATION_FORM_SOURCE })
  // Formda referans alanı yoktur; kural öğrenci listesine hiç bakmaz.
  const { minor, email } = requireValidNewProspect(
    { branches: state.branches, students: [] },
    data,
    options.institutionType,
  )
  const duplicate = findProspectDuplicate(state.prospects, { ...data, email })
  if (duplicate !== null) {
    const prospect = state.prospects.find((item) => item.id === duplicate.prospectId)
    if (prospect === undefined) return { kind: 'ignored' }
    return addRepeatNote(prospect, repeatNoteText(duplicate, data), options)
      ? { kind: 'noted', prospectId: prospect.id }
      : { kind: 'ignored' }
  }
  const prospect = buildProspect(data, { minor, email }, options.makeId, options.now)
  state.prospects.unshift(prospect)
  return { kind: 'created', prospectId: prospect.id }
}

/**
 * Formun gömülebileceği üst pencere (`frame-ancestors` değeri). Site adresi yoksa form hiçbir yere
 * gömülmez; kapalı form ve geçersiz anahtar da aynı değeri alır.
 */
export const applicationFrameAncestors = (siteOrigin: string | null | undefined) =>
  siteOrigin ?? "'none'"
