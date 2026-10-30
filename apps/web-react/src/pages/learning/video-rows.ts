// Ders Videoları saf hesapları (Vue `Learning.vue` `videolar`): kapsamdaki video kayıtları ve
// öğrencinin kendi izleme ilerlemesi. Kapsamı sunucu uygular (öğrenci yalnız kendi düzeyinin
// videolarını ve kendi ilerlemesini okur); ilerleme yüzdesi ve durum kayıtlardan türetilir.
import type { CoreRow } from '@/hooks/use-core-collection.ts'

/** `videoProgress` kaydı: core örnek verisinde kimlik yoktur, anahtar öğrenci + video çiftidir. */
export type VideoProgress = { studentId: string; videoId: string; progress: number }

export type WatchState = 'completed' | 'started' | 'new'

export type VideoRow = {
  id: string
  title: string
  subject: string
  level: string
  topic: string
  teacher: string
  /** Süre (dakika). */
  duration: number
  /** İzleme yüzdesi (0–100). */
  progress: number
  watch: WatchState
  /** Oynatılabilir dosya adresi; yoksa kayıt yalnız künyedir. */
  src: string | null
  poster: string | null
  /** Altyazı dosyası; yoksa video altyazısız sunulur. */
  captions: string | null
}

const clampProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0

export function watchState(progress: number): WatchState {
  return progress >= 100 ? 'completed' : progress > 0 ? 'started' : 'new'
}

/** Kart ve panelde ilerleme metni: "Tamamlandı", "%35 izlendi · Devam et" ya da "Henüz izlenmedi". */
export function progressText(progress: number): string {
  const state = watchState(progress)
  if (state === 'completed') return 'Tamamlandı'
  return state === 'started' ? `%${progress} izlendi · Devam et` : 'Henüz izlenmedi'
}

/** Kart eylem metni: izlenmişse "Devam et", değilse "Dersi izle". */
export const watchAction = (progress: number) => (progress > 0 ? 'Devam et' : 'Dersi izle')

/** Video → öğrencinin ilerlemesi eşlemesi; aynı video için en yüksek kayıt geçerlidir. */
export function progressByVideo(progress: readonly VideoProgress[]): Map<string, number> {
  const byVideo = new Map<string, number>()
  for (const entry of progress) {
    const value = clampProgress(entry.progress)
    byVideo.set(entry.videoId, Math.max(byVideo.get(entry.videoId) ?? 0, value))
  }
  return byVideo
}

export function videoRow(
  item: CoreRow<'videos'>,
  progress: ReadonlyMap<string, number>,
  teachers: ReadonlyMap<string, string>,
): VideoRow {
  const video = item.record
  const watched = progress.get(video.id) ?? 0
  return {
    id: video.id,
    title: video.title,
    subject: video.subject,
    level: video.level,
    topic: video.topic,
    teacher: teachers.get(video.teacherId) ?? '—',
    duration: video.duration,
    progress: watched,
    watch: watchState(watched),
    src: video.src ?? null,
    poster: video.poster ?? null,
    captions: video.captions ?? null,
  }
}
