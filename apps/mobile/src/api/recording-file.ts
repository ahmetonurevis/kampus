// Konuşma kaydı dosyasının silinmesi (OG-064; DOM-BEC-054, KVKK): `expo-audio` kaydı uygulamanın
// önbellek klasörüne yazar; atılan ya da teslim edilen kaydın dosyası cihazda kalmaz.
import * as FileSystem from 'expo-file-system/legacy'
import { recordError } from '../lib/error-log.ts'

/**
 * Kayıt dosyasını siler; dosya yoksa hata sayılmaz. Silinemezse günlüğe yalnız bağlam yazılır
 * (kayıt adresi ya da içeriği yazılmaz) ve akış kesilmez: dosya işletim sisteminin önbellek
 * temizliğine kalır.
 */
export function discardRecording(uri: string): void {
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {
    recordError('Konuşma kaydı dosyası silinemedi.', 'konusma-kaydi', 'warn')
  })
}
