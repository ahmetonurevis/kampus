import type { ModuleKey } from '../modules/collection-modules.ts'

/**
 * Açık rıza amaçları (docs/muhendislik/guvenlik-kvkk.md §9; docs/domain/yetki-ve-kapsam.md
 * DOM-YTK-056…). Amaç kodu veritabanında (`consents.purpose`, `privacy_notices.purpose`) saklanır;
 * değiştirilmez, yalnız yenisi eklenir.
 *
 * - `subject`: veri sahibi. `student` öğrenci kaydıdır; rızayı 18 yaş altında doğrulanmış velayet
 *   sahibi veli, 18 ve üstünde öğrencinin kendisi verir (DOM-YTK-057). `user` hesabın kendisidir
 *   (veli ya da 18 yaşını doldurmuş öğrenci); rızayı yalnız kendisi verir.
 * - `objectable`: 18 yaş altı öğrenci velinin rızasına itiraz edebilir; itiraz varken rıza geçersizdir
 *   (DOM-ILT-033).
 * - `validity`: `academic_year` rızası en geç eğitim yılı sonunda biter ve her yıl yenilenir
 *   (DOM-ILT-033); `until_withdrawn` geri çekilene kadar sürer.
 * - `module` ve `opens`: rızanın açtığı işlem; o işlem `hasValidConsent` ile denetlenir.
 */
export const CONSENT_PURPOSES = {
  // DOM-ILT-033 (a): kurum içi platform ve sınıf panosu; bülten fotoğrafları (IST-068).
  photo_video_sharing: {
    label: 'Fotoğraf ve video: kurum içi platform ve sınıf panosu',
    subject: 'student',
    objectable: true,
    validity: 'academic_year',
    module: 'communication',
    opens: 'Bülten, duyuru ve sınıf panosunda öğrencinin tanınabilir fotoğrafı veya videosu',
  },
  // DOM-ILT-033 (b)
  photo_video_website: {
    label: 'Fotoğraf ve video: kurum web sitesi',
    subject: 'student',
    objectable: true,
    validity: 'academic_year',
    module: 'communication',
    opens: 'Kurum web sitesinde öğrencinin tanınabilir fotoğrafı veya videosu',
  },
  // DOM-ILT-033 (c)
  photo_video_social_media: {
    label: 'Fotoğraf ve video: sosyal medya',
    subject: 'student',
    objectable: true,
    validity: 'academic_year',
    module: 'communication',
    opens: 'Kurumun sosyal medya hesaplarında öğrencinin tanınabilir fotoğrafı veya videosu',
  },
  // DOM-ILT-033 (d)
  photo_video_print: {
    label: 'Fotoğraf ve video: basılı tanıtım ve reklam',
    subject: 'student',
    objectable: true,
    validity: 'academic_year',
    module: 'communication',
    opens: 'Broşür, afiş ve basılı reklamda öğrencinin tanınabilir fotoğrafı veya videosu',
  },
  // Tanıtım iletisi alıcının kendi kararıdır; adayın kanal bazlı ticari ileti onayı ayrıdır
  // (DOM-KAY-004, `prospects.ts` `marketingConsent`).
  promotional_messages: {
    label: 'Tanıtım iletileri',
    subject: 'user',
    objectable: false,
    validity: 'until_withdrawn',
    module: 'communication',
    opens: 'Kampanya, indirim ve bursluluk sınavı duyurusu gibi tanıtım amaçlı iletiler',
  },
  // ADR 0003 karar 9, DOM-BEC-050: konuşma görevi ses kaydı (`files` amacı `speaking_recording`).
  speaking_recording: {
    label: 'Konuşma görevi ses kaydı',
    subject: 'student',
    objectable: false,
    validity: 'until_withdrawn',
    module: 'learning',
    opens: 'Konuşma görevinde ses kaydı yükleme; rıza yoksa görev yüz yüze değerlendirilir',
  },
} as const satisfies Record<
  string,
  {
    label: string
    subject: 'student' | 'user'
    objectable: boolean
    validity: 'academic_year' | 'until_withdrawn'
    module: ModuleKey
    opens: string
  }
>

export type ConsentPurpose = keyof typeof CONSENT_PURPOSES
export const CONSENT_PURPOSE_KEYS = Object.keys(CONSENT_PURPOSES) as [
  ConsentPurpose,
  ...ConsentPurpose[],
]
export type ConsentSubjectKind = (typeof CONSENT_PURPOSES)[ConsentPurpose]['subject']
export const CONSENT_SUBJECT_KINDS = ['student', 'user'] as const satisfies ConsentSubjectKind[]

/** Rızanın ya da itirazın verildiği kanal (DOM-ILT-034). Islak imza taraması henüz yok. */
export const CONSENT_CHANNELS = ['web', 'mobile'] as const
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number]
