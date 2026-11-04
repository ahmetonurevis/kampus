import { NOTICE_AUDIENCES, type PublishPrivacyNoticeInput } from './privacy-notices.ts'

/**
 * Çocuğa uygun aydınlatma şablonu (IST-018; DOM-YTK-056; KVKK md. 10): 10–14 yaş arası öğrenci için
 * sade dilli, kısa cümleli ve her başlığı bir simgeyle desteklenen bilgilendirme. Şablon yönetici
 * öğrenci kitlesine metin yayımlarken taslak olarak önerilir ve web'de öğrenci kitlesi için henüz
 * metin yayımlanmamışken gösterilir. Hukuki geçerliliği olan metin yine yöneticinin yayımladığı
 * sürümdür; şablon yalnız başlangıç noktasıdır ve gösterimi gösterim kaydı (`acknowledge`) açmaz.
 *
 * Saf veridir; simgeler web simge setinden seçilmiş adlardır (`apps/web-react` `Icon`).
 */
export const CHILD_NOTICE_AGE_RANGE = { min: 10, max: 14 } as const

export const CHILD_NOTICE_TOPICS = ['ne', 'neden', 'kim', 'koruma', 'haklar', 'kime'] as const
export type ChildNoticeTopic = (typeof CHILD_NOTICE_TOPICS)[number]

export type ChildNoticeSection = {
  topic: ChildNoticeTopic
  /** Web `Icon` bileşeninin simge adı. */
  icon: string
  heading: string
  /** Kısa cümleler; her biri tek bir fikir taşır. */
  lines: readonly string[]
}

export const CHILD_NOTICE_TITLE = 'Bilgilerin nasıl kullanılıyor?'

/** Şablonun bölümleri; `{kurum}` yerine kurum adı yazılır (`childNoticeSections`). */
const TEMPLATE: readonly ChildNoticeSection[] = [
  {
    topic: 'ne',
    icon: 'ClipboardCheck',
    heading: 'Hangi bilgilerini kullanıyoruz?',
    lines: [
      '{kurum} senin hakkında bazı bilgiler tutar.',
      'Adın, sınıfın ve doğum tarihin bunlardan bazılarıdır.',
      'Derse gelip gelmediğini, notlarını ve ödevlerini de kaydederiz.',
    ],
  },
  {
    topic: 'neden',
    icon: 'Target',
    heading: 'Neden kullanıyoruz?',
    lines: [
      'Seni tanımak ve sana iyi ders vermek için.',
      'Ödevlerini ve gelişimini takip etmek için.',
      'Okulun işleri düzgün yürüsün diye.',
    ],
  },
  {
    topic: 'kim',
    icon: 'Eye',
    heading: 'Bilgilerini kim görebilir?',
    lines: [
      'Öğretmenlerin ve okulun görevli çalışanları.',
      'Velin, yani annen, baban ya da bakım veren kişi.',
      'Başka biri, yasanın izin vermediği hiçbir durumda göremez.',
    ],
  },
  {
    topic: 'koruma',
    icon: 'Lock',
    heading: 'Bilgilerini nasıl koruyoruz?',
    lines: [
      'Bilgilerin korumalı bir sistemde durur.',
      'Yalnız işi gereği görmesi gereken kişiler bakabilir.',
      'Gerekmeyince bilgilerini saklamayız.',
    ],
  },
  {
    topic: 'haklar',
    icon: 'ShieldCheck',
    heading: 'Senin haklarını biliyor musun?',
    lines: [
      'Hangi bilgilerinin tutulduğunu öğrenebilirsin.',
      'Yanlış bir bilgi varsa düzeltilmesini isteyebilirsin.',
      'Bazı bilgilerin silinmesini isteyebilirsin.',
      'Bu istekleri velinle birlikte de yapabilirsin.',
    ],
  },
  {
    topic: 'kime',
    icon: 'MessageCircleQuestion',
    heading: 'Aklına takılırsa kime soracaksın?',
    lines: [
      'Önce öğretmenine ya da velinle konuşabilirsin.',
      'Okul yönetimi de sana yardım eder.',
      'Soru sormak her zaman serbest.',
    ],
  },
]

const fill = (text: string, institutionName: string) => text.replaceAll('{kurum}', institutionName)

/** Şablonun bölümleri, kurum adı doldurulmuş olarak. Boş ad "Okulumuz" olur. */
export function childNoticeSections(institutionName: string): ChildNoticeSection[] {
  const name = institutionName.trim() || 'Okulumuz'
  return TEMPLATE.map((section) => ({
    ...section,
    heading: fill(section.heading, name),
    lines: section.lines.map((line) => fill(line, name)),
  }))
}

/** Bölümleri düz metne çevirir (yayımlanacak gövde; başlık satırı, ardından cümleler). */
export function childNoticeBody(institutionName: string): string {
  return childNoticeSections(institutionName)
    .map((section) => [section.heading, ...section.lines].join('\n'))
    .join('\n\n')
}

/**
 * Yönetici öğrenci kitlesine metin yayımlarken önerilen taslak; `publishPrivacyNoticeSchema`
 * girdisidir, yönetici düzenleyip yayımlar.
 */
export function childNoticeDraft(
  institutionName: string,
): Extract<PublishPrivacyNoticeInput, { kind: 'notice' }> {
  return {
    kind: 'notice',
    audience: 'ogrenci' satisfies keyof typeof NOTICE_AUDIENCES,
    title: CHILD_NOTICE_TITLE,
    body: childNoticeBody(institutionName),
  }
}
