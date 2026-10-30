/**
 * Yaygın parola listesi (küçük harf). Parola dış servise gönderilmez; liste depoda tutulur.
 * 12 karakter alt sınırının üstündeki yaygın kalıplara odaklanır.
 */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456123456',
  '111111111111',
  '000000000000',
  'qwertyuiop12',
  'qwertyuiopasdf',
  'qwerty123456',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'asdfghjkl123',
  'password1234',
  'password12345',
  'passwordpassword',
  'iloveyou1234',
  'abcdefghijkl',
  'abc123abc123',
  'welcome12345',
  'letmein12345',
  'administrator',
  'administrator1',
  'sifre1234567',
  'sifresifre12',
  'parola123456',
  'parolaparola',
  'galatasaray1905',
  'fenerbahce1907',
  'besiktas1903',
  'trabzonspor1967',
  'mustafakemal',
  'ataturk19381',
  'istanbul1234',
  'ankara123456',
  'turkiye12345',
  'okulokulokul',
  'ogretmen1234',
  'ogrenci12345',
])

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('ı', 'i')
    .replace(/[^a-z0-9]/g, '')
}

export interface PasswordContext {
  email?: string | null | undefined
  institutionNames?: readonly string[]
}

/**
 * Yaygın parola, e-postanın kendisi/yerel kısmı, kurum adı ve `kampus` türevleri reddedilir.
 * Türev: normalleştirilmiş parola bu sözcüklerden birini içeriyorsa (en az 5 harf; "özel", "dil" gibi kısa genel sözcükler sayılmaz).
 */
export function isWeakPassword(password: string, context: PasswordContext = {}): boolean {
  const normalized = normalize(password)
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || COMMON_PASSWORDS.has(normalized)) return true
  const email = context.email?.toLowerCase() ?? ''
  const words = [
    'kampus',
    email,
    email.split('@')[0] ?? '',
    ...(context.institutionNames ?? []).flatMap((name) => [name, ...name.split(/\s+/)]),
  ]
    .map(normalize)
    .filter((word) => word.length >= 5)
  return words.some((word) => normalized.includes(word))
}
