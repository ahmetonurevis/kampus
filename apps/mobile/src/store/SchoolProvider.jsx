import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { createSeed } from '@kampus/school-core/data/seed.js'
import { createSnapshotWriter, restoreSnapshot } from '@kampus/school-core/lib/demo-persistence.js'
import { prepareReferenceData, resolveTheme } from '../model/experience.js'
import { clone, roles } from '../model/school.js'

const DATA_KEY = 'kampus-mobile-data-v1',
  PREF_KEY = 'kampus-mobile-preferences-v1'
const Context = createContext(null)
export const logs = []
export function recordError(error, context, level = 'error') {
  logs.push({
    date: new Date().toISOString(),
    level,
    critical: level === 'error',
    context,
    message: String(error),
  })
  if (logs.length > 100) logs.shift()
}
export const makeId = (prefix) => `${prefix}-${randomUUID()}`
export function SchoolProvider({ children }) {
  const [data, setData] = useState(null),
    [session, setSession] = useState({ role: '', childId: 's1', theme: 'light' }),
    [error, setError] = useState(''),
    [toast, setToast] = useState(null),
    [busy, setBusy] = useState(false),
    [reduceMotion, setReduceMotion] = useState(false)
  const systemTheme = useColorScheme()
  const resolvedTheme = resolveTheme(session.theme, systemTheme)
  const current = useRef(null),
    preferences = useRef(session),
    lock = useRef(false),
    writer = useRef(null),
    toastTimer = useRef(null)
  function notify(message, type = 'success') {
    setToast({ message, type })
    AccessibilityInfo.announceForAccessibility(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }
  async function load() {
    setError('')
    try {
      const [raw, prefs] = await Promise.all([
        AsyncStorage.getItem(DATA_KEY),
        AsyncStorage.getItem(PREF_KEY),
      ])
      const next = raw ? restoreSnapshot(raw) : createSeed()
      const enhanced = prepareReferenceData(next)
      const saved = prefs ? JSON.parse(prefs) : {}
      const nextSession = {
        role: roles[saved.role] ? saved.role : '',
        childId: next.parents[0].studentIds.includes(saved.childId) ? saved.childId : 's1',
        theme: ['light', 'dark', 'system'].includes(saved.theme) ? saved.theme : 'light',
      }
      writer.current = createSnapshotWriter(createSeed(new Date(next.createdAt)))
      if (!raw || enhanced) await AsyncStorage.setItem(DATA_KEY, writer.current(next))
      current.current = next
      preferences.current = nextSession
      setData(next)
      setSession(nextSession)
    } catch (err) {
      recordError(err, 'storage-load')
      setError(
        'Kayıtlı veriler açılamadı. Yeniden deneyebilir veya demo verilerini sıfırlayabilirsiniz.',
      )
    }
  }
  useEffect(() => {
    load()
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      motion.remove()
      clearTimeout(toastTimer.current)
    }
  }, [])
  async function preference(changes) {
    try {
      const next = { ...preferences.current, ...changes }
      await AsyncStorage.setItem(PREF_KEY, JSON.stringify(next))
      preferences.current = next
      setSession(next)
      return true
    } catch (err) {
      recordError(err, 'preference-write')
      notify('Tercih kaydedilemedi. Lütfen yeniden deneyin.', 'error')
      return false
    }
  }
  async function commit(mutate, message = 'İşlem kaydedildi.') {
    if (lock.current) {
      notify('Önceki işlem tamamlanıyor.', 'warning')
      return false
    }
    lock.current = true
    setBusy(true)
    try {
      const next = clone(current.current)
      mutate(next, makeId)
      next.audit.unshift({
        id: makeId('audit'),
        actor: preferences.current.role,
        action: message,
        date: new Date().toISOString(),
      })
      next.audit = next.audit.slice(0, 200)
      try {
        await AsyncStorage.setItem(DATA_KEY, writer.current(next))
      } catch (err) {
        recordError(err, 'storage-write')
        notify(
          'Kayıt için yeterli alan olmayabilir. İşlem kaydedilmedi; yer açıp tekrar deneyin.',
          'error',
        )
        return false
      }
      current.current = next
      setData(next)
      if (message) notify(message)
      return true
    } catch (err) {
      recordError(err, 'operation', 'warn')
      notify(err.issues?.[0]?.message || err.message || 'İşlem tamamlanamadı.', 'error')
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function reset() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const raw = await AsyncStorage.getItem(DATA_KEY)
      if (raw) await AsyncStorage.setItem(DATA_KEY + '-recovery', raw)
      const next = createSeed()
      prepareReferenceData(next)
      writer.current = createSnapshotWriter(createSeed(new Date(next.createdAt)))
      await AsyncStorage.setItem(DATA_KEY, writer.current(next))
      current.current = next
      setData(next)
      setError('')
      await preference({ role: '', childId: 's1' })
      notify('Demo verileri yenilendi.')
    } catch (err) {
      recordError(err, 'reset')
      notify('Demo sıfırlanamadı. Depolama alanını kontrol edin.', 'error')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Context.Provider
      value={{
        data,
        session,
        resolvedTheme,
        preference,
        commit,
        notify,
        toast,
        setToast,
        busy,
        reduceMotion,
        error,
        load,
        reset,
      }}
    >
      {children}
    </Context.Provider>
  )
}
export const useSchool = () => useContext(Context)
