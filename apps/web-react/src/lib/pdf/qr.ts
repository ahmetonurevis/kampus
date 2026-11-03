// QR kodu matrisi: `qr` (paulmillr; MIT/Apache-2.0, bağımlılıksız) yalnız bu modülde yüklenir.
// Modül yalnız dinamik `import()` ile çağrılır (`use-document-pdf.ts`); ilk JS paketine ve sayfa
// parçasına girmez. Şablon matrisi PDF yerleşiminde dikdörtgenlerle çizer
// (`DocumentLayout.qrCode`, sessiz bölgeyi kendisi bırakır); görüntü yok.
import encodeQR from 'qr'
import type { QrModules } from './layout.ts'

/** Metnin QR matrisi; düzeltme düzeyi M (%15 kayıp; basılı belgede leke ve kırışığa dayanır). */
export function qrMatrix(text: string): QrModules {
  // Paket sessiz bölgesiz çıktı vermez; en ince (1 modül) kenarla üretilip halka kesilir.
  const bordered = encodeQR(text, 'raw', { ecc: 'medium', border: 1 })
  const dark = bordered.slice(1, -1).map((row) => row.slice(1, -1))
  return { size: dark.length, dark }
}
