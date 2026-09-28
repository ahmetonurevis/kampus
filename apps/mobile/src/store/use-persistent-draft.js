import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createDraftRepository, draftKey } from '../model/drafts.js'
import { recordError, useSchool } from './SchoolProvider.jsx'

const repository = createDraftRepository(AsyncStorage)
export function usePersistentDraft(kind, recordId, initialValue, revision = '') {
  const { data, session, notify } = useSchool()
  const key = draftKey(data, session, kind, recordId)
  const identity = key + revision
  const [state, setState] = useState({ identity, value: initialValue, ready: false, status: '' })
  const active = useRef(identity),
    current = useRef(state),
    initial = useRef(initialValue)
  active.current = identity
  initial.current = initialValue
  const publish = (next) => {
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
      .catch((error) => {
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
  function change(valueOrUpdate) {
    if (current.current.identity !== identity || !current.current.ready) return
    const value =
      typeof valueOrUpdate === 'function' ? valueOrUpdate(current.current.value) : valueOrUpdate
    const next = { identity, value, ready: true, status: 'saving' }
    publish(next)
    repository
      .write(key, value, revision)
      .then(() => {
        if (active.current === identity && current.current.value === value)
          publish({ ...next, status: 'saved' })
      })
      .catch((error) => {
        recordError(error, 'draft-write')
        if (active.current === identity && current.current.value === value) {
          publish({ ...next, status: 'error' })
          notify('Taslak cihaza kaydedilemedi. Sayfadan çıkmadan yeniden deneyin.', 'error')
        }
      })
  }
  async function clear(nextValue = initial.current) {
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
  const visible =
    state.identity === identity ? state : { value: initialValue, ready: false, status: '' }
  return { ...visible, set: change, clear, retry: () => change(current.current.value) }
}
