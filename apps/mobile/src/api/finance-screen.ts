// Yönetici ve ön büro Finans & Tahsilat ekranının kayıt satırı (ON-123, ON-079). Ekran kaydı
// (`screen-registry.ts`) ortak dosya önerisi #25 alan haritasına işlenene kadar Oğuzhan'ın alanındadır;
// satır orada `ONUR_SCREENS` dizisine `FINANCE_STAFF_SCREEN` olarak eklenir. Satır burada tutulur ki
// yerleşim kuralları (`screenRegistryIssues`) kayda girmeden önce birim testinde sınansın
// (`tests/finance-staff-mobile.test.ts`). `as const` ekran adını sabit tutar.
import type { MenuScreen, ScreenEntry } from './screen-registry.ts'

export const FINANCE_STAFF_SCREEN = {
  screen: 'FinanceStaff',
  // Kayıttaki gibi ilk açılışta `require` ile yüklenir (Node testi React Native'e bağlanmaz); kural
  // istisnası `eslint.config.js`'te yalnız `screen-registry.ts` içindir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/finance-staff.tsx').default,
  // İki rolde aynı ekran (web `FinancePage` gibi): özet, taksitler, tahsilatlar ve sözleşmeler.
  // Tarife, burs, ayrılış-iade ve muhasebe aktarımı web'dedir; öğrenciye kaydedilmez.
  pages: [
    {
      role: 'yonetici',
      path: 'finans',
      description: 'Finans özetini, taksitleri, tahsilatları ve sözleşmeleri takip edin.',
    },
    {
      role: 'onburo',
      path: 'tahsilat-takip',
      description: 'Taksitleri takip edin, tahsilat kaydedin, sözleşmeleri görün.',
    },
  ],
} as const satisfies ScreenEntry

// Veli Finans & Ödeme Planı ve Dekontlar ekranlarının kayıt satırları (ON-078, IST-107, IST-124).
// Kayıtta `ONUR_SCREENS` dizisine `PARENT_FINANCE_SCREEN` ve `PARENT_RECEIPTS_SCREEN` olarak eklenir.
// Veli Sözleşmeler ekranı ayrıdır (`contract-screen.ts`, ON-041). "Ödeme Yap" (`veli/odeme-yap`)
// kaydedilmez: çevrim içi ödeme yoktur; sıradaki taksit ve okulda ödeme bilgisi Finans ekranındadır.
// Öğrenciye kaydedilmez (öğrenci ödemeleri telefonda gösterilmez).
export const PARENT_FINANCE_SCREEN = {
  screen: 'ParentFinance',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/finance-parent.tsx').default,
  pages: [
    {
      role: 'veli',
      path: 'finans',
      description: 'Bakiyeyi, taksitleri ve cari ekstreyi görün.',
    },
  ],
} as const satisfies ScreenEntry

export const PARENT_RECEIPTS_SCREEN = {
  screen: 'ParentReceipts',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getComponent: (): MenuScreen => require('./screens/finance-parent-receipts.tsx').default,
  pages: [
    {
      role: 'veli',
      path: 'dekontlar',
      description: 'Tahsilatları ve dekont numaralarını görün.',
    },
  ],
} as const satisfies ScreenEntry
