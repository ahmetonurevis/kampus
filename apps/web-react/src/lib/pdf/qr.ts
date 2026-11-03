// QR kodu matrisi: `uqr` (MIT, bağımlılıksız) yalnız bu modülde yüklenir. Modül yalnız dinamik
// `import()` ile çağrılır (`use-document-pdf.ts`); ilk JS paketine ve sayfa parçasına girmez.
// Şablon matrisi PDF yerleşiminde dikdörtgenlerle çizer (`DocumentLayout.qrCode`); görüntü yok.
import { encode } from 'uqr'
import type { QrModules } from './layout.ts'

/** Metnin QR matrisi; düzeltme düzeyi M (%15 kayıp; basılı belgede leke ve kırışığa dayanır). */
export function qrMatrix(text: string): QrModules {
  const { size, data } = encode(text, { ecc: 'M', border: 0 })
  return { size, dark: data }
}
