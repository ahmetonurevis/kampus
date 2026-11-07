// Ön büro Aday Öğrenciler ve Tanışma Görüşmeleri ekranlarının kayıt satırları (ON-122). Ekran kaydı
// (`screen-registry.ts`) ortak dosya önerisi #25 alan haritasına işlenene kadar Oğuzhan'ın alanındadır;
// satırlar orada `ONUR_SCREENS` dizisine `PROSPECTS_SCREEN` ve `PROSPECT_MEETINGS_SCREEN` olarak
// eklenir. Satırlar burada tutulur ki yerleşim kuralları (`screenRegistryIssues`) kayda girmeden önce
// birim testinde sınansın (`tests/prospect-mobile.test.ts`). `as const` ekran adını sabit tutar.
import type { MenuScreen, ScreenEntry } from './screen-registry.ts'

export const PROSPECTS_SCREEN = {
  screen: 'FrontOfficeProspects',
  // Kayıttaki gibi ilk açılışta `require` ile yüklenir (Node testi React Native'e bağlanmaz); kural
  // istisnası `eslint.config.js`'te yalnız `screen-registry.ts` içindir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/prospect-list.tsx').default,
  // Telefonda liste, aday kartı, aşama değiştirme ve görüşme notu vardır. Yeni aday, bilgi
  // düzeltme, görüşme/deneme dersi planlama ve kesin kayıt web'dedir.
  pages: [
    {
      role: 'onburo',
      path: 'adaylar',
      description: 'Adayları arayın, aşamasını güncelleyin, görüşme notu ekleyin.',
    },
  ],
} as const satisfies ScreenEntry

export const PROSPECT_MEETINGS_SCREEN = {
  screen: 'FrontOfficeMeetings',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/prospect-meetings.tsx').default,
  // Telefonda yaklaşan ve geçmiş görüşmeler listelenir; planlama ve haftalık takvim web'dedir.
  pages: [
    {
      role: 'onburo',
      path: 'deneme-dersi-takvimi',
      description: 'Yaklaşan tanışma görüşmelerini ve deneme derslerini görün.',
    },
  ],
} as const satisfies ScreenEntry
