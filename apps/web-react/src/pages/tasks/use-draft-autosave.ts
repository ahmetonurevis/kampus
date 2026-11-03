import { useCallback, useEffect, useRef, useState } from 'react'
import { useSaveTaskDraft, type TaskDraft } from '@kampus/react-shared/use-task-submissions.ts'

const DRAFT_DELAY_MS = 1500

export type DraftSaveState = 'idle' | 'saving' | 'saved' | 'error'

type Options = {
  assignmentId: string
  draft: TaskDraft | null
  /** Editörün açılış metni; taslak yoksa "kaydedilmiş" sayılır (boşuna kayıt atılmaz). */
  initialBody: string
  body: string
  /** `false` iken (teslim kapalı ya da teslim sürüyor) otomatik kayıt yapılmaz. */
  enabled: boolean
}

/**
 * Yazma taslağının otomatik kaydı (IST-047): metin değişince kısa süre sonra kaydedilir. Kayıtlar
 * sıralıdır; süren kayıt bitmeden ikincisi başlamaz (komut kilidi ikinci isteği düşürürdü).
 * `flush` teslimden önce bekleyen kaydı hemen tamamlar ve kaydedilen revizyonu döndürür; böylece
 * teslim edilen metin kaydedilen revizyondur. Taslağın `revision`'ı sonraki kaydın `If-Match`'idir;
 * başka pencerede kaydedilen taslak (409/400 sonrası tazeleme) revizyonu günceller.
 */
export function useDraftAutosave({ assignmentId, draft, initialBody, body, enabled }: Options) {
  const saveDraft = useSaveTaskDraft()
  const saveRef = useRef(saveDraft)
  const [state, setState] = useState<DraftSaveState>(draft ? 'saved' : 'idle')
  const [savedAt, setSavedAt] = useState<string | null>(draft?.savedAt ?? null)
  const revision = useRef<number | null>(draft?.revision ?? null)
  const savedBody = useRef(draft?.body ?? initialBody)
  const running = useRef<Promise<boolean> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const latestRevision = draft?.revision

  useEffect(() => {
    if (latestRevision !== undefined) revision.current = latestRevision
  }, [latestRevision])

  useEffect(() => {
    saveRef.current = saveDraft
  })

  /** Metni kaydeder; zaten kayıtlıysa istek atmaz. Başarıda `true`. */
  const save = useCallback(
    async (text: string): Promise<boolean> => {
      if (running.current) await running.current
      if (text === savedBody.current && revision.current !== null) return true
      const run = (async () => {
        setState('saving')
        const outcome = await saveRef.current.submit({
          assignmentId,
          revision: revision.current,
          body: text,
        })
        if (outcome.status !== 'success') {
          setState('error')
          return false
        }
        revision.current = outcome.data.data?.revision ?? revision.current
        savedBody.current = text
        setSavedAt(outcome.data.data?.savedAt ?? null)
        setState('saved')
        return true
      })()
      running.current = run
      try {
        return await run
      } finally {
        if (running.current === run) running.current = null
      }
    },
    [assignmentId],
  )

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!enabled || body === savedBody.current || body.trim() === '') return
    timer.current = window.setTimeout(() => void save(body), DRAFT_DELAY_MS)
    return () => window.clearTimeout(timer.current)
  }, [body, enabled, save])

  /** Bekleyen kaydı hemen tamamlar; kaydedilen taslağın revizyonu ya da kayıt olmadıysa `null`. */
  const flush = useCallback(
    async (text: string): Promise<number | null> => {
      window.clearTimeout(timer.current)
      return (await save(text)) ? revision.current : null
    },
    [save],
  )

  return { state, savedAt, flush }
}
