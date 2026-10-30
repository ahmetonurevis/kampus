import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createDraftRepository, draftKey, type DraftValue } from '../model/drafts.ts'
import { recordError, useSchool } from './SchoolProvider.tsx'

export type DraftStatus = '' | 'restored' | 'saving' | 'saved' | 'error' | 'read-error'
type DraftState<T> = { identity: string; value: T; ready: boolean; status: DraftStatus }

const repository = createDraftRepository(AsyncStorage)
const isUpdater = <T>(value: T | ((current: T) => T)): value is (current: T) => T =>
  typeof value === 'function'

export function usePersistentDraft<T extends DraftValue>(
  kind: string,
  recordId: string | undefined,
  initialValue: T,
  revision = '',
) {
  const { data, session, notify } = useSchool()
  if (!data) throw new Error('Taslak, okul verisi yüklenmeden kullanılamaz.')
  const key = draftKey(data, session, kind, recordId)
  const identity = key + revision
  const [state, setState] = useState<DraftState<T>>({
    identity,
    value: initialValue,
    ready: false,
    status: '',
  })
  const active = useRef(identity),
    current = useRef(state),
    initial = useRef(initialValue)
  active.current = identity
  initial.current = initialValue
  const publish = (next: DraftState<T>) => {
    current.current = next
    setState(next)
  }
  useEffect(() => {
    let live = true
    const value = initial.current
    publish({ identity, value, ready: false, status: '' })
    repository
      .read(key, revision)
      .then((saved) => {
        if (live)
          publish({
            identity,
            value: saved ? { ...value, ...saved } : value,
            ready: true,
            status: saved ? 'restored' : '',
          })
      })
      .catch((error: unknown) => {
        recordError(error, 'draft-read')
        if (live) {
          publish({ identity, value, ready: false, status: 'read-error' })
          notify('Taslak açılamadı. Yeniden deneyin veya bu taslağı temizleyin.', 'error')
        }
      })
    return () => {
      live = false
    }
    // initialValue her renderda yeniden oluşabilir; yalnızca kayıt/ana veri sürümü değişince yüklenir.
  }, [identity])
  function change(valueOrUpdate: T | ((current: T) => T)) {
    if (current.current.identity !== identity || !current.current.ready) return
    const value = isUpdater(valueOrUpdate) ? valueOrUpdate(current.current.value) : valueOrUpdate
    const next: DraftState<T> = { identity, value, ready: true, status: 'saving' }
    publish(next)
    repository
      .write(key, value, revision)
      .then(() => {
        if (active.current === identity && current.current.value === value)
          publish({ ...next, status: 'saved' })
      })
      .catch((error: unknown) => {
        recordError(error, 'draft-write')
        if (active.current === identity && current.current.value === value) {
          publish({ ...next, status: 'error' })
          notify('Taslak cihaza kaydedilemedi. Sayfadan çıkmadan yeniden deneyin.', 'error')
        }
      })
  }
  async function clear(nextValue: T = initial.current) {
    try {
      await repository.clear(key)
      if (active.current === identity)
        publish({ identity, value: nextValue, ready: true, status: '' })
      return true
    } catch (error) {
      recordError(error, 'draft-clear')
      if (active.current === identity)
        notify('Taslak temizlenemedi. Lütfen yeniden deneyin.', 'error')
      return false
    }
  }
  const visible: Pick<DraftState<T>, 'value' | 'ready' | 'status'> = state.identity === identity
    ? state
    : { value: initialValue, ready: false, status: '' }
  return { ...visible, set: change, clear, retry: () => change(current.current.value) }
}
