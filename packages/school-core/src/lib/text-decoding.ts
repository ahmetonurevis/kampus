import { DomainError } from './errors.ts'

// Optik/CSV dosyaları için bayt dizisini metne çevirir. Windows-1254 el ile çözülür;
// böylece Node, tarayıcı ve telefon motorlarında aynı sonuç alınır.
// 0x80–0x9F aralığı Windows-1254 tablosuna göre eşlenir; tanımsız baytlar
// (0x81, 0x8D, 0x8E, 0x8F, 0x90, 0x9D, 0x9E) WHATWG kuralındaki gibi aynı kod noktasına döner.
const WINDOWS_1254_C1: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9f: 'Ÿ',
}
// Latin-1'den farklı olan altı Türkçe harf.
const WINDOWS_1254_TURKISH: Record<number, string> = {
  0xd0: 'Ğ',
  0xdd: 'İ',
  0xde: 'Ş',
  0xf0: 'ğ',
  0xfd: 'ı',
  0xfe: 'ş',
}

export const textEncodings = ['utf-8', 'windows-1254']

export function decodeText(bytes: Uint8Array, encoding = 'utf-8') {
  if (!textEncodings.includes(encoding))
    throw new DomainError('unsupported_encoding', 'Desteklenmeyen karakter kodlaması.')
  if (encoding === 'utf-8') return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  let text = ''
  for (const byte of bytes)
    text += WINDOWS_1254_TURKISH[byte] ?? WINDOWS_1254_C1[byte] ?? String.fromCharCode(byte)
  return text
}
