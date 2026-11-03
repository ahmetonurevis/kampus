import { useCallback, useEffect, useRef, useState } from 'react'
import { createDraftSaver } from './draft-autosave-model.ts'
import { useSaveTaskDraft, type TaskDraft } from './use-task-submissions.ts'

export type DraftSaveState = 'idle' | 'saving' | 'saved' | 'error'

type Options = {
  assignmentId: string
  draft: TaskDraft | null
  /** Editörün açılış metni; taslak yoksa "kaydedilmiş" sayılır (boşuna kayıt atılmaz). */
  initialBody: string
  body: string
  /** `false` iken (teslim kapalı ya da teslim sürüyor) otomatik kayıt yapılmaz. */
  enabled: boolean
  /** Başka pencerenin taslağı ekrana alınır (ekranda kaydedilmemiş değişiklik yokken). */
  onAdopt: (body: string) => void
}

/**
 * Yazma taslağının otomatik kaydı (IST-047): metin değişince kısa süre sonra kaydedilir. Mantık
 * `draft-autosave-model.ts`'tedir (sıralı kayıt, revizyon doğrulamalı kısayol, çakışma). Taslak
 * sorgusu tazelenince (başka pencerede kayıt): ekranda kaydedilmemiş değişiklik yoksa ekran sunucu
 * metnine geçer; varsa `conflict` açılır ve ilk teslim basışı kayıt atmadan uyarır.
 * Zamanlayıcı da modeldedir (`schedule`/`cancel`); bekleyen değişiklik unmount'ta kaydedilir.
 * Web ve mobil ortaktır (IST-124); mobil uygulama arka plana geçerken `saveNow` çağırır.
 */
export function useDraftAutosave({
  assignmentId,
  draft,
  initialBody,
  body,
  enabled,
  onAdopt,
}: Options) {
  const saveDraft = useSaveTaskDraft()
  const [state, setState] = useState<DraftSaveState>(draft ? 'saved' : 'idle')
  const [savedAt, setSavedAt] = useState<string | null>(draft?.savedAt ?? null)
  const [conflict, setConflict] = useState(false)
  const bodyRef = useRef(body)
  const adoptRef = useRef(onAdopt)
  const enabledRef = useRef(enabled)
  // Saver ekran açılışında bir kez kurulur (ekran görev başına `key`lidir); sonraki taslak
  // değişimleri `sync` ile, her çizimin kayıt komutu `setSubmit` ile işlenir.
  const [saver] = useState(() =>
    createDraftSaver({
      draft: draft ? { revision: draft.revision, body: draft.body, savedAt: draft.savedAt } : null,
      initialBody,
    }),
  )

  useEffect(() => {
    bodyRef.current = body
    adoptRef.current = onAdopt
    enabledRef.current = enabled
    saver.setSubmit(async (input) => {
      setState('saving')
      const outcome = await saveDraft.submit({ assignmentId, ...input })
      if (outcome.status !== 'success' || !outcome.data.data) {
        setState('error')
        return { ok: false }
      }
      setSavedAt(outcome.data.data.savedAt ?? null)
      setState('saved')
      setConflict(false)
      return {
        ok: true,
        revision: outcome.data.data.revision,
        savedAt: outcome.data.data.savedAt ?? null,
      }
    })
  })

  useEffect(() => {
    if (!draft) return
    const outcome = saver.sync(
      { revision: draft.revision, body: draft.body, savedAt: draft.savedAt },
      bodyRef.current,
    )
    if (outcome.kind === 'adopt') {
      adoptRef.current(outcome.body)
      setSavedAt(outcome.savedAt)
      setState('saved')
    } else if (outcome.kind === 'conflict') {
      setConflict(saver.hasConflict())
    }
  }, [draft, saver])

  useEffect(() => {
    if (!enabled || conflict) {
      saver.cancel()
      return
    }
    saver.schedule(body)
    return () => saver.cancel()
  }, [body, enabled, conflict, saver])

  /**
   * Bekleyen değişikliği zamanlayıcıyı beklemeden kaydeder (unmount ile aynı kural): kayıt kapalıyken
   * ya da çakışmada yazılmaz, kirli olmayan ve boş metin kaydedilmez. Bileşen kalkarken ve mobil
   * uygulama arka plana geçerken çağrılır.
   */
  const saveNow = useCallback(() => {
    const text = bodyRef.current
    if (!enabledRef.current || saver.hasConflict()) return
    saver.cancel()
    if (saver.isDirty(text) && text.trim() !== '') void saver.save(text)
  }, [saver])

  useEffect(
    () => () => {
      // Seçilen davranış: kaldırılırken bekleyen değişiklik hemen kaydedilir (bildirim değil).
      // Editör panel kapanınca, teslimden sonra ya da sayfa değişince kaldırılır; öğrenciye
      // "kaybolacak" uyarısı göstermek yazdığını sormadan kaydetmekten daha kötü bir deneyimdir ve
      // kayıt zaten geri alınabilir bir taslaktır. Kayıt komutu bileşenden bağımsız sürer; hatası
      // komutun toast'ıyla bildirilir. Çakışmada (başka pencerenin kaydı onaylanmadı) yazılmaz:
      // öğrenci görmeden başka pencerenin metninin üstüne yazmak veri kaybıdır.
      saver.cancel()
      saveNow()
    },
    [saver, saveNow],
  )

  /** Bekleyen kaydı hemen tamamlar; kaydedilen taslağın revizyonu ya da teslim edilemezse `null`. */
  const flush = useCallback(
    async (text: string): Promise<number | null> => {
      const revision = await saver.flush(text)
      setConflict(saver.hasConflict())
      return revision
    },
    [saver],
  )

  return { state, savedAt, conflict, flush, saveNow }
}
