import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { AppState } from 'react-native'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio'
import {
  canRerecord,
  canStart,
  initialRecorderState,
  recorderReducer,
  type SpeakingLimits,
} from '@kampus/react-shared/speaking-recorder-model.ts'
import {
  permissionBlock,
  phoneTake,
  type PhoneRecorderEvent,
  type PhoneRecordingMedia,
} from './student-speaking-task.ts'

/**
 * Konuşma kaydının telefon tarafı (OG-064; DOM-BEC-054): mikrofon izni, hazırlık ve süre sınırı
 * zamanlayıcıları, `expo-audio` kaydı. Geçişler ortak saf makinededir
 * (`@kampus/react-shared/speaking-recorder-model.ts`; web `use-speaking-recorder.ts` karşılığı).
 *
 * Ses yalnız cihazın önbelleğindeki kayıt dosyasındadır; AsyncStorage'a, loga ya da ağa kayıt
 * adresi yazılmaz. Mikrofon yalnız kayıt sürerken açıktır: kayıt bitince oturum kapatılır; ekran
 * kapanınca ya da uygulama arka plana geçince süren kayıt durdurulur.
 */
export function usePhoneRecorder(limits: SpeakingLimits) {
  const [state, dispatch] = useReducer(recorderReducer<PhoneRecordingMedia>, initialRecorderState)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [now, setNow] = useState(() => Date.now())
  const startedAt = useRef(0)
  const disposed = useRef(false)
  const { phase } = state
  const timed = phase.kind === 'preparing' || phase.kind === 'recording'
  const { preparationSeconds, speakingSeconds } = limits

  const send = useCallback((event: PhoneRecorderEvent) => {
    if (!disposed.current) dispatch(event)
  }, [])

  // Saat yalnız hazırlık ve kayıt sürerken işler.
  useEffect(() => {
    if (!timed) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [timed])

  const releaseSession = useCallback(() => {
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
  }, [])

  // Ekrandan çıkınca süren kayıt durur ve oturum kapanır; sonuç artık işlenmez.
  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      try {
        void recorder.stop().catch(() => {})
      } catch {
        // Kayıt nesnesi zaten bırakılmış olabilir.
      }
      releaseSession()
    }
  }, [recorder, releaseSession])

  // Mikrofon izni ve kayıt oturumu.
  useEffect(() => {
    if (phase.kind !== 'requesting') return
    let cancelled = false
    void (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync()
        if (cancelled) return
        const reason = permissionBlock(permission.granted)
        if (reason !== null) return send({ type: 'blocked', reason })
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        if (!cancelled) send({ type: 'granted', now: Date.now(), preparationSeconds })
      } catch {
        if (!cancelled) send({ type: 'blocked', reason: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase.kind, preparationSeconds, recorder, send])

  // Hazırlık bitince kayıt başlar (DOM-BEC-002).
  const preparationEndsAt = phase.kind === 'preparing' ? phase.endsAt : null
  useEffect(() => {
    if (preparationEndsAt === null) return
    const timer = setTimeout(
      () => send({ type: 'preparation_over' }),
      Math.max(0, preparationEndsAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [preparationEndsAt, send])

  // Kaydı başlatır; kayıt nesnesi evre değişince kapanmaz, durdurma olaylarıyla yürür.
  useEffect(() => {
    if (phase.kind !== 'starting') return
    try {
      recorder.record()
      startedAt.current = Date.now()
      send({ type: 'recorder_started', now: startedAt.current, speakingSeconds })
    } catch {
      releaseSession()
      send({ type: 'blocked', reason: 'failed' })
    }
  }, [phase.kind, recorder, releaseSession, send, speakingSeconds])

  // Süre sınırında kayıt kendiliğinden durur (IST-051); pay ortak makinededir.
  const stopAt = phase.kind === 'recording' && phase.stop === null ? phase.stopAt : null
  useEffect(() => {
    if (stopAt === null) return
    const timer = setTimeout(
      () => send({ type: 'stop', by: 'limit' }),
      Math.max(0, stopAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [stopAt, send])

  // Uygulama arka plana geçerken süren kayıt kullanıcı durdurması gibi biter.
  const recording = phase.kind === 'recording' && phase.stop === null
  useEffect(() => {
    if (!recording) return
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') send({ type: 'stop', by: 'user' })
    })
    return () => subscription.remove()
  }, [recording, send])

  const stopRequested = phase.kind === 'recording' && phase.stop !== null
  useEffect(() => {
    if (!stopRequested) return
    void (async () => {
      try {
        await recorder.stop()
        const uri = recorder.uri
        releaseSession()
        if (!uri) return send({ type: 'blocked', reason: 'failed' })
        send({ type: 'recorded', take: phoneTake(uri, Date.now() - startedAt.current) })
      } catch {
        releaseSession()
        send({ type: 'blocked', reason: 'failed' })
      }
    })()
  }, [stopRequested, recorder, releaseSession, send])

  return {
    state,
    now,
    dispatch: send,
    canStart: (remaining: number) => canStart(state, remaining),
    canRerecord: (remaining: number) => canRerecord(state, remaining),
  }
}
