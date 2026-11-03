import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNow } from '@/hooks/use-now.ts'
import {
  canRerecord,
  canStart,
  initialRecorderState,
  recorderReducer,
  type RecorderEvent,
  type SpeakingLimits,
} from '@kampus/react-shared/speaking-recorder-model.ts'
import {
  mediaErrorReason,
  pickRecordingMime,
  recordingFileName,
} from './speaking-recorder-model.ts'

/** Tarayıcı kayıt yapabiliyor mu ve hangi biçimde (güvenli bağlam, mikrofon, MediaRecorder). */
function recordingMime(): string | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function')
    return null
  return pickRecordingMime((type) => MediaRecorder.isTypeSupported(type))
}

const stopStream = (stream: MediaStream | null) => {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

/**
 * Konuşma kaydının tarayıcı tarafı (IST-051; DOM-BEC-054): mikrofon izni, hazırlık ve süre sınırı
 * zamanlayıcıları, MediaRecorder. Geçişler `speaking-recorder-model.ts`'teki saf makinededir.
 *
 * Ses yalnız bellekte tutulur (`File`; localStorage/IndexedDB'ye yazılmaz, loglanmaz). Mikrofon
 * yalnız kayıt sürerken açıktır: kayıt bitince, izin isteği yarıda kalınca ve sayfadan çıkınca
 * izler kapatılır. Kayıt `File` olarak üretilir; aynı kaydın yeniden yüklenmesi aynı
 * `Idempotency-Key`'i alsın diye adı ve zamanı kayda özgüdür (`fileIdentity`).
 */
export function useSpeakingRecorder(limits: SpeakingLimits) {
  const [state, dispatch] = useReducer(recorderReducer, initialRecorderState)
  const [mimeType] = useState(recordingMime)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const startedAt = useRef(0)
  const disposed = useRef(false)
  const { phase } = state
  const timed = phase.kind === 'preparing' || phase.kind === 'recording'
  const now = useNow(timed, 250)
  const { preparationSeconds, speakingSeconds } = limits

  const send = useCallback((event: RecorderEvent) => {
    if (!disposed.current) dispatch(event)
  }, [])

  // Sayfadan çıkınca kayıt ve mikrofon kapanır; sonuç artık işlenmez.
  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      const current = recorder.current
      if (current && current.state !== 'inactive') current.stop()
      recorder.current = null
      stopStream(stream.current)
      stream.current = null
    }
  }, [])

  // Mikrofon izni.
  useEffect(() => {
    if (phase.kind !== 'requesting') return
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((granted) => {
        if (cancelled || disposed.current) {
          stopStream(granted)
          return
        }
        stream.current = granted
        send({ type: 'granted', now: Date.now(), preparationSeconds })
      })
      .catch((error: unknown) => {
        if (!cancelled) send({ type: 'blocked', reason: mediaErrorReason(error) })
      })
    return () => {
      cancelled = true
    }
  }, [phase.kind, preparationSeconds, send])

  // Hazırlık bitince kayıt başlar (DOM-BEC-002).
  const preparationEndsAt = phase.kind === 'preparing' ? phase.endsAt : null
  useEffect(() => {
    if (preparationEndsAt === null) return
    const timer = window.setTimeout(
      () => send({ type: 'preparation_over' }),
      Math.max(0, preparationEndsAt - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [preparationEndsAt, send])

  // Kaydı başlatır. Kayıt nesnesi evre değişince kapanmaz; durdurma ve bitiş olaylarıyla yürür.
  useEffect(() => {
    if (phase.kind !== 'starting') return
    const input = stream.current
    if (!input || mimeType === null) {
      send({ type: 'blocked', reason: 'failed' })
      return
    }
    let media: MediaRecorder
    try {
      media = new MediaRecorder(input, { mimeType })
    } catch {
      stopStream(input)
      stream.current = null
      send({ type: 'blocked', reason: 'failed' })
      return
    }
    const chunks: Blob[] = []
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    media.onstart = () => {
      startedAt.current = Date.now()
      send({ type: 'recorder_started', now: startedAt.current, speakingSeconds })
    }
    media.onstop = () => {
      const stoppedAt = Date.now()
      stopStream(stream.current)
      stream.current = null
      recorder.current = null
      const type = media.mimeType || mimeType
      const file = new File(chunks, recordingFileName(type), { type, lastModified: stoppedAt })
      send({
        type: 'recorded',
        take: { blob: file, durationMs: stoppedAt - startedAt.current, mimeType: type },
      })
    }
    media.onerror = () => {
      stopStream(stream.current)
      stream.current = null
      recorder.current = null
      send({ type: 'blocked', reason: 'failed' })
    }
    recorder.current = media
    media.start()
  }, [phase.kind, mimeType, speakingSeconds, send])

  // Süre sınırında kayıt kendiliğinden durur (IST-051).
  const stopAt = phase.kind === 'recording' && phase.stop === null ? phase.stopAt : null
  useEffect(() => {
    if (stopAt === null) return
    const timer = window.setTimeout(
      () => send({ type: 'stop', by: 'limit' }),
      Math.max(0, stopAt - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [stopAt, send])

  const stopRequested = phase.kind === 'recording' && phase.stop !== null
  useEffect(() => {
    if (!stopRequested) return
    const current = recorder.current
    if (current && current.state !== 'inactive') current.stop()
  }, [stopRequested])

  return {
    state,
    now,
    supported: mimeType !== null,
    dispatch: send,
    canStart: (remaining: number) => mimeType !== null && canStart(state, remaining),
    canRerecord: (remaining: number) => canRerecord(state, remaining),
  }
}

/**
 * Bellekteki kaydı `<audio>`'ya bağlayan ref: geçici adres öğe bağlanınca üretilir, öğe kalkınca
 * ya da kayıt değişince bırakılır (`revokeObjectURL`; React 19 ref temizliği).
 */
export function useObjectUrlSource(blob: Blob | null) {
  return useCallback(
    (node: HTMLAudioElement | null) => {
      if (!node || !blob) return
      const url = URL.createObjectURL(blob)
      node.src = url
      return () => {
        node.removeAttribute('src')
        URL.revokeObjectURL(url)
      }
    },
    [blob],
  )
}
