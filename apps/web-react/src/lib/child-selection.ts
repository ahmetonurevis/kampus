// Velinin görüntülediği çocuk. Seçim adreste (`?cocuk=<öğrenci kimliği>`) tutulur: bağlantı
// paylaşılır, yenileme ve geri/ileri korunur. Adreste yoksa son seçim (yalnız bellekte; kişisel
// veri depoya yazılmaz) ve en son ilk çocuk kullanılır. Oturum kapanınca görünüm belleği silinir.
import type { SessionChild } from '../auth/auth-port.ts'

export const CHILD_VIEW_KEY = 'selected-child'
export const CHILD_PARAM = 'cocuk'

/** Adayların ilk geçerlisi (hesabın çocuğu); hiçbiri geçerli değilse ilk çocuk, çocuk yoksa boş. */
export function resolveChildFrom(
  children: readonly SessionChild[],
  candidates: readonly unknown[],
): string {
  for (const candidate of candidates)
    if (typeof candidate === 'string' && children.some((child) => child.id === candidate))
      return candidate
  return children[0]?.id ?? ''
}

/** Kayıtlı seçim hâlâ bu hesabın çocuğuysa korunur, değilse ilk çocuk; çocuk yoksa boş. */
export function resolveChild(children: readonly SessionChild[], stored: unknown): string {
  return resolveChildFrom(children, [stored])
}

/** Kaydırma ve liste belleği kapsamı: veli için yol + çocuk, diğer rollerde yalnız yol. */
export function childScrollKey(pathname: string, childId: string): string {
  return `scroll:${pathname}:${childId}`
}

/** Arama dizgisine seçili çocuğu yazar; diğer parametreler (liste durumu, filtre) korunur. */
export function withChildParam(search: string, childId: string): string {
  const params = new URLSearchParams(search)
  params.set(CHILD_PARAM, childId)
  return `?${params.toString()}`
}

/**
 * Çocuğa bağlı kaydı açan sağ panel ve form parametreleri (`useDetailPanel` adları): veli
 * sayfalarında seçili çocuğun ödevi, notu, randevusu vb. gösterir. Çocuk değişince açık kalırsa
 * panel öncekinin kaydını yeni çocuğun başlığı altında gösterirdi; bu yüzden geçişte silinir.
 * Çocuktan bağımsız paneller (yazışma, duyuru) ve süzgeç olarak da kullanılan adlar (`ders`)
 * listede yoktur ve korunur.
 */
export const CHILD_SCOPED_PANEL_PARAMS = [
  'randevu',
  'randevu-form',
  'odev',
  'quiz',
  'kayit',
  'not',
  'bildirim',
  'bildirim-form',
  'talep',
  'talep-form',
  'detay',
  'tahsilat',
  'materyal',
  'video',
] as const

/**
 * Çocuk değiştirilirken yeni arama dizgisi: çocuk yazılır, çocuğa bağlı açık paneller kapanır;
 * liste durumu ve süzgeçler (`q`, `sayfa`, …) korunur. Menü ve kabuk adresi tamamlaması
 * (`withChildParam`) panele dokunmaz; yalnız kullanıcının çocuk değiştirmesi panelleri kapatır.
 */
export function withChildSwitch(search: string, childId: string): string {
  const params = new URLSearchParams(search)
  for (const name of CHILD_SCOPED_PANEL_PARAMS) params.delete(name)
  params.set(CHILD_PARAM, childId)
  return `?${params.toString()}`
}

/**
 * `/me` bağlantıları yalnız kayıt kimliğidir; adlar veli kapsamlı `students` okumasından gelir.
 * Kapsamda olmayan kimliğe ad uydurulmaz: adı gelmeyen çocuk adsız kalır (seçici yükleniyor).
 */
export function withChildNames(
  children: readonly SessionChild[],
  students: ReadonlyArray<{ id: string; name: string }>,
): SessionChild[] {
  const names = new Map(students.map((student) => [student.id, student.name]))
  return children.map((child) => {
    const name = names.get(child.id)
    return name ? { id: child.id, name } : { id: child.id }
  })
}
