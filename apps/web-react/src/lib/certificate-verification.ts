// Kurum başarı belgesinin kimliksiz doğrulama rotası (OG-088; DOM-DIL-082). Rota tanımı
// (`routes.tsx`), PDF'teki QR adresi ve doğrulama sayfası bu sabitleri kullanır; QR'ın ürettiği
// adres her zaman bu rotaya çözülür (`tests/certificate-verification.test.ts`).

/** Doğrulama sayfasının yol parçası. */
export const VERIFICATION_PATH = 'belge-dogrula'

/** Router yolu: kod isteğe bağlıdır; kodsuz adres yalnız kod girme formunu gösterir. */
export const VERIFICATION_ROUTE = `${VERIFICATION_PATH}/:code?`

/**
 * Router `basename`'i Vite `BASE_URL`'inden (`/`, `/app/`): sondaki eğik çizgi atılır, kökte `/`.
 * Uygulama alt yolda yayınlandığında QR adresi ile rota aynı kökü paylaşır.
 */
export function routerBasename(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.startsWith('/') ? trimmed || '/' : `/${trimmed}`
}

/**
 * Doğrulama adresi: kök adres uygulamanın yayınlandığı yerden gelir (`origin` + Vite `BASE_URL`);
 * sabit alan adı yazılmaz. Kod tirelidir; yol parçası olarak kaçışlanır.
 */
export function certificateVerificationUrl(base: string, code: string): string {
  return new URL(`${VERIFICATION_PATH}/${encodeURIComponent(code)}`, base).href
}

/** Uygulama içi bağlantı (`basename`'e göreli): kod girilince adres koda taşınır. */
export function verificationHref(code?: string): string {
  return code ? `/${VERIFICATION_PATH}/${encodeURIComponent(code)}` : `/${VERIFICATION_PATH}`
}
