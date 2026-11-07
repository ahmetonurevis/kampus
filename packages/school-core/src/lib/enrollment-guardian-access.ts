import type { GuardianLink } from './guardianship.ts'

/**
 * Yetişkin kursiyerin veli erişimi (ON-129; DOM-KAY-012, DOM-ILT-070, DOM-ILT-074, DOM-YTK-057;
 * kullanıcı kararı 2 Kasım 2026). Kursta 18 yaş ve üstü kursiyerin velisi yoktur: kişisel verisinin
 * sahibi kendisidir. Bir yakına (çoğunlukla ödeyen anne ya da baba) veli erişimi açılacaksa bunu
 * kursiyer kendi hesabından, açık rızayla verir ve istediği an geri çeker.
 *
 * Kural bağı silmez, kapsamı daraltır: rızası olmayan yetişkin kursiyerin velayetli bağı (`full`,
 * `joint`) okuma kapsamında velayetsiz (`none`) sayılır. Böylece velayet bağlantısı (`child`) not,
 * devam, yazışma, bildirim ve rıza kapsamı vermez (core `guardedActorLinks`), ödeyicilik ise
 * velayetten bağımsız olduğu için sürer: ödeyici bağı finansı görmeye ve finans bildirimini almaya
 * devam eder (K-04, `payerActorLinks`). Rıza verilince bağın kayıtlı velayeti olduğu gibi geçerli
 * olur; geri çekilince bir sonraki istekte yeniden daralır.
 *
 * Okulda (her yaşta) ve kursta 18 yaş altında kural yoktur: velayet bağın kendisidir. Yaş servisin
 * kararıdır (`apps/api/src/services/notify.ts` `learnerMinor`, core `isMinorLearner`: okulda her
 * öğrenci 18 yaş altı sayılır, yaşı bilinmeyen kursiyer de); rıza geçerliliği core `hasValidConsent`.
 * Fonksiyonlar saftır.
 */

/** Bir öğrencinin erişim kararına giren olgular: 18 yaş altı mı, kursiyerin geçerli rızası var mı. */
export type LearnerAccessFacts = {
  /** Öğrenci 18 yaş altında mı (okulda her zaman `true`). */
  minor: boolean
  /** Yetişkin kursiyerin veli erişimine verdiği rıza geçerli mi (`hasValidConsent`). */
  consented: boolean
}

/** Velayetli bağın kapsam vermesi için kursiyerin rızası gerekir mi: yalnız yetişkin kursiyerde. */
export const learnerConsentRequired = (facts: Pick<LearnerAccessFacts, 'minor'>): boolean =>
  !facts.minor

/**
 * Bağın kapsamda geçerli velayeti: yetişkin kursiyer rıza vermediyse velayetli bağ velayetsiz
 * sayılır; öteki her durumda kayıtlı velayet. Ödeyici, iletişim kısıtı ve teslim yetkisi değişmez.
 */
export function effectiveCustody(
  link: Pick<GuardianLink, 'custody'>,
  facts: LearnerAccessFacts,
): GuardianLink['custody'] {
  if (link.custody === 'none') return 'none'
  return learnerConsentRequired(facts) && !facts.consented ? 'none' : link.custody
}

/**
 * Okuma kapsamına giren bağlar (`guardedActorLinks`, `scopedActorLinks` girdisi): yetişkin
 * kursiyerin rızasız velayetli bağı velayetsiz kopyaya döner, diğerleri olduğu gibi kalır. Olgusu
 * verilmeyen öğrencinin bağı değişmez; çağıran yalnız rıza arayan öğrencilerin olgusunu
 * (`studentsNeedingLearnerFacts`) yükler. Girdi değiştirilmez.
 */
export function withLearnerConsent<L extends Pick<GuardianLink, 'studentId' | 'custody'>>(
  links: readonly L[],
  factsOf: (studentId: string) => LearnerAccessFacts | undefined,
): L[] {
  return links.map((link) => {
    const facts = factsOf(link.studentId)
    if (facts === undefined) return link
    const custody = effectiveCustody(link, facts)
    return custody === link.custody ? link : { ...link, custody }
  })
}

/**
 * Olgusu okunması gereken öğrenciler: velayetli bağı olanlar (velayetsiz bağ zaten kapsam
 * vermez). Okul kurumunda boş: orada kural yoktur, yaş ve rıza okunmaz.
 */
export function studentsNeedingLearnerFacts(
  links: readonly Pick<GuardianLink, 'studentId' | 'custody'>[],
  institutionIsSchool: boolean,
): string[] {
  if (institutionIsSchool) return []
  const ids = new Set<string>()
  for (const link of links) if (link.custody !== 'none') ids.add(link.studentId)
  return [...ids].sort()
}
