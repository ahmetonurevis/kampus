import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useSaveTaskAttemptAnswers,
  type TaskAttemptAnswers,
  type TaskAttemptDetail,
} from '@kampus/react-shared/use-task-attempts.ts'
import { answersFingerprint } from './student-task-model.ts'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const SAVE_DELAY_MS = 700

/**
 * Süren denemenin cevapları: yerel durum ekranın tek doğrusudur, değişiklikten kısa süre sonra
 * sunucuya kaydedilir (DOM-BEC-043: süre dolunca sunucudaki kayıtlı cevaplarla teslim sayılır).
 * Kayıtlar sıralıdır: sürüren kayıt bitmeden yenisi başlamaz; her kayıt bir öncekinin döndürdüğü
 * `rowVersion` ile gider (`If-Match`). `flush` bekleyen her şeyi yazar ve başarıyı bildirir; teslimden
 * önce çağrılır. Başarısız kayıt yerel cevabı silmez, bir sonraki değişiklik ya da `flush` yeniden dener.
 */
export function useAttemptAnswers(attempt: TaskAttemptDetail) {
  const save = useSaveTaskAttemptAnswers()
  const saveRef = useRef(save)
  const [answers, setAnswers] = useState<TaskAttemptAnswers>(attempt.answers)
  const [state, setState] = useState<SaveState>('saved')
  const latest = useRef(answers)
  const version = useRef(attempt.rowVersion)
  const saved = useRef(answersFingerprint(attempt.answers))
  const running = useRef<Promise<boolean> | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    saveRef.current = save
  })
  // Başka yerden gelen güncel sürüm (409 sonrası tazeleme) bir sonraki kaydın başlığı olur.
  useEffect(() => {
    version.current = attempt.rowVersion
  }, [attempt.rowVersion])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const writeOnce = useCallback(async (): Promise<boolean> => {
    const current = latest.current
    setState('saving')
    const outcome = await saveRef.current.submit({
      attemptId: attempt.id,
      version: version.current,
      answers: current,
    })
    if (outcome.status !== 'success') {
      setState('error')
      return false
    }
    version.current = outcome.data.data.rowVersion
    saved.current = answersFingerprint(current)
    setState(answersFingerprint(latest.current) === saved.current ? 'saved' : 'dirty')
    return true
  }, [attempt.id])

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    for (;;) {
      if (running.current) {
        if (!(await running.current)) return false
        continue
      }
      if (answersFingerprint(latest.current) === saved.current) return true
      const pending = writeOnce()
      running.current = pending
      const ok = await pending.finally(() => {
        running.current = null
      })
      if (!ok) return false
    }
  }, [writeOnce])

  const setAnswer = useCallback(
    (questionVersionId: string, response: TaskAttemptAnswers[string]) => {
      const next = { ...latest.current, [questionVersionId]: response }
      latest.current = next
      setAnswers(next)
      setState('dirty')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  return {
    answers,
    setAnswer,
    flush,
    state,
    /** Teslimde `If-Match` olarak gidecek, son yazmanın döndürdüğü sürüm. */
    currentVersion: () => version.current,
  } as const
}
