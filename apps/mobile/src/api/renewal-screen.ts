// Yönetici ve ön büro Kayıt Yenileme ekranının kayıt satırı (ON-122, IST-100). Ekran kaydı
// (`screen-registry.ts`) ortak dosya önerisi #25 alan haritasına işlenene kadar Oğuzhan'ın alanındadır;
// satır orada `ONUR_SCREENS` dizisine `RENEWALS_SCREEN` olarak eklenir. Satır burada tutulur ki
// yerleşim kuralları (`screenRegistryIssues`) kayda girmeden önce birim testinde sınansın
// (`tests/renewal-mobile.test.ts`). `as const` ekran adını sabit tutar.
import type { MenuScreen, ScreenEntry } from './screen-registry.ts'

export const RENEWALS_SCREEN = {
  screen: 'StaffRenewals',
  // Kayıttaki gibi ilk açılışta `require` ile yüklenir (Node testi React Native'e bağlanmaz); kural
  // istisnası `eslint.config.js`'te yalnız `screen-registry.ts` içindir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/renewal-list.tsx').default,
  // Telefonda yenileme planları listelenir ve ayrıntısı okunur; plan, toplu yenileme, dönem geçişi
  // ve sözleşme PDF'i web'dedir. Veli yenilemesi telefonda yoktur.
  pages: [
    {
      role: 'yonetici',
      path: 'kayit-yenileme',
      description: 'Yenileme planlarını ve yeni dönem ücretlerini görün.',
    },
    {
      role: 'onburo',
      path: 'kayit-yenileme',
      description: 'Yenileme planlarını ve yeni dönem ücretlerini görün.',
    },
  ],
} as const satisfies ScreenEntry
