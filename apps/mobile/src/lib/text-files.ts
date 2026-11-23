import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'
import { decodeText } from '@kampus/school-core/lib/text-decoding.ts'

export const MAX_TEXT_FILE_BYTES = 1024 * 1024

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
async function readBytes(uri: string) {
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer())
  return base64ToBytes(
    await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }),
  )
}

// CSV/DAT/TXT dosyası seçtirir ve belirtilen kodlamayla metne çevirir. Seçim iptal edilirse null döner.
export async function pickTextFile({
  extensions,
  encoding = 'utf-8',
}: {
  extensions: readonly string[]
  encoding?: string
}): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled) return null
  const file = result.assets[0]
  if (!file) throw new Error('Dosya seçilemedi.')
  const pattern = new RegExp(`\\.(${extensions.join('|')})$`, 'i')
  if (!pattern.test(file.name))
    throw new Error(`En fazla 1 MB boyutunda ${extensions.join(', ').toUpperCase()} dosyası seçin.`)
  const bytes = await readBytes(file.uri)
  if (bytes.length > MAX_TEXT_FILE_BYTES)
    throw new Error(`En fazla 1 MB boyutunda ${extensions.join(', ').toUpperCase()} dosyası seçin.`)
  try {
    return { name: file.name, text: decodeText(bytes, encoding) }
  } catch {
    throw new Error('Dosya okunamadı. Karakter kodlamasını kontrol edip tekrar deneyin.')
  }
}
