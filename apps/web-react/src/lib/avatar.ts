import { initials as coreInitials } from '@kampus/school-core/lib/format.js'

// Avatar rengi normalleştirilmiş tam addan türetilir; Vue `Avatar.vue` ile aynı algoritmadır.
export const AVATAR_TONE_COUNT = 5

export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
}

export function avatarTone(name: string): number {
  let hash = 0
  for (const character of normalizeName(name))
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0
  return hash % AVATAR_TONE_COUNT
}

// Baş harfler school-core kuralından gelir (ilk iki kelime).
export function initials(name: string): string {
  return String(coreInitials(name))
}
