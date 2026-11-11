// Veli Sözleşmeler ekranının kayıt satırı (ON-041, IST-092). Ekran kaydı (`screen-registry.ts`)
// Oğuzhan'ın alanındadır (ortak dosya önerisi #25); satır orada `ONUR_SCREENS` dizisine
// `CONTRACT_APPROVAL_SCREEN` olarak eklenir. Satır burada tutulur ki yerleşim kuralları
// (`screenRegistryIssues`) kayda girmeden önce birim testinde sınansın
// (`tests/contract-approval-mobile.test.ts`). `as const` ekran adını sabit tutar; kayıttaki
// `ApiScreen` tipi bu adı içerir.
import type { MenuScreen, ScreenEntry } from './screen-registry.ts'

export const CONTRACT_APPROVAL_SCREEN = {
  screen: 'ParentContracts',
  // Kayıttaki gibi ilk açılışta `require` ile yüklenir (Node testi React Native'e bağlanmaz); kural
  // istisnası `eslint.config.js`'te yalnız `screen-registry.ts` içindir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/contract-approval.tsx').default,
  // Telefonda sözleşme sürümleri, plan ve PDF vardır; onay taze oturum istediği için web'dedir.
  pages: [
    {
      role: 'veli',
      path: 'sozlesmeler',
      description: 'Sözleşmeleri ve ödeme planını görün; onay bekleyen sürümü inceleyin.',
    },
  ],
} as const satisfies ScreenEntry
