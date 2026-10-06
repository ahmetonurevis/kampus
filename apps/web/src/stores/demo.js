import { reactive, ref, computed, watch } from 'vue'
import { createSnapshotWriter, restoreSnapshot } from '../lib/demo-persistence.js'
import { createSeed } from '../data/seed.js'
import { average } from '../lib/format.js'
import { roles } from '../modules/navigation.js'

export const STORAGE_KEY = 'kampus-private-school-v1'
export const logs = reactive([])
export const toasts = reactive([])
export function notify(message, type = 'success') {
  const id = crypto.randomUUID()
  toasts.push({ id, message, type })
  setTimeout(() => {
    const index = toasts.findIndex((t) => t.id === id)
    if (index >= 0) toasts.splice(index, 1)
  }, 5500)
}
export function logError(error, context = 'application', level = 'error') {
  logs.push({
    level,
    critical: level === 'error',
    context,
    message: String(error),
    date: new Date().toISOString(),
  })
  if (logs.length > 100) logs.shift()
}
function readPreference(storage, key, fallback) {
  try {
    return storage.getItem(key) || fallback
  } catch (error) {
    logError(error, 'preference-read', 'warn')
    return fallback
  }
}
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return restoreSnapshot(raw)
    }
  } catch (error) {
    logError(error, 'storage-read')
    notify('Kayıtlı demo verisi okunamadı. Başlangıç verileri yüklendi.', 'warning')
  }
  return createSeed()
}
export const state = reactive(readState())
const savedRole = readPreference(sessionStorage, 'kampus-role', '')
export const role = ref(Object.hasOwn(roles, savedRole) ? savedRole : '')
const savedChild = readPreference(sessionStorage, 'kampus-child', 's1')
export const selectedChildId = ref(
  state.parents[0].studentIds.includes(savedChild) ? savedChild : 's1',
)
export const studentId = computed(() => (role.value === 'veli' ? selectedChildId.value : 's1'))
export const currentStudent = computed(() => state.students.find((s) => s.id === studentId.value))
export const theme = ref(
  readPreference(localStorage, 'kampus-theme', 'light') === 'dark' ? 'dark' : 'light',
)
export const teacherId = 't1'
export const id = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 10)}`
let storageWarningShown = false
let lastPersisted = ''
let baselineDate = state.createdAt
let writeSnapshot = createSnapshotWriter(createSeed(new Date(baselineDate)))
watch(
  state,
  (value) => {
    try {
      if (baselineDate !== value.createdAt) {
        baselineDate = value.createdAt
        writeSnapshot = createSnapshotWriter(createSeed(new Date(baselineDate)))
      }
      const serialized = writeSnapshot(value)
      if (serialized !== lastPersisted) {
        localStorage.setItem(STORAGE_KEY, serialized)
        lastPersisted = serialized
      }
    } catch (error) {
      logError(error, 'storage-write')
      if (!storageWarningShown) {
        storageWarningShown = true
        notify('Tarayıcı depolaması dolu. Değişiklikler bu oturumda kullanılabilir.', 'warning')
      }
    }
  },
  { deep: true, immediate: true },
)
// Aynı tarayıcıdaki rol sekmeleri depolama olaylarıyla aynı veri kümesini görür.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue || event.newValue === lastPersisted) return
  try {
    const incoming = restoreSnapshot(event.newValue)
    if (
      incoming.version !== state.version ||
      !Array.isArray(incoming.students) ||
      !incoming.modules
    )
      return
    lastPersisted = event.newValue
    Object.assign(state, incoming)
  } catch (error) {
    logError(error, 'storage-sync', 'warn')
  }
})
watch(selectedChildId, (value) => {
  try {
    sessionStorage.setItem('kampus-child', value)
  } catch (error) {
    logError(error, 'child-preference', 'warn')
  }
})
watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value
    try {
      localStorage.setItem('kampus-theme', value)
    } catch (error) {
      logError(error, 'theme')
    }
  },
  { immediate: true },
)
export function setRole(value) {
  role.value = Object.hasOwn(roles, value) ? value : ''
  try {
    sessionStorage.setItem('kampus-role', role.value)
  } catch (error) {
    logError(error, 'role-preference', 'warn')
  }
}
export function resetDemo() {
  Object.assign(state, createSeed())
  selectedChildId.value = 's1'
  notify('Demo verileri başlangıç durumuna getirildi.')
}
export function action(callback, message) {
  try {
    const result = callback()
    state.audit.unshift({
      id: id('audit'),
      actor: role.value,
      action: message,
      date: new Date().toISOString(),
    })
    if (state.audit.length > 200) state.audit.pop()
    if (message) notify(message)
    return result ?? true
  } catch (error) {
    logError(error, 'action', 'warn')
    notify(
      error.issues?.[0]?.message || error.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      'error',
    )
    return false
  }
}
// Yeni iş akışlarında işlem ve kalıcılık birlikte başarılı olmalıdır.
export function transaction(mutate, message) {
  try {
    const next = JSON.parse(JSON.stringify(state))
    const result = mutate(next, id)
    next.audit.unshift({
      id: id('audit'),
      actor: role.value,
      action: message,
      date: new Date().toISOString(),
    })
    next.audit = next.audit.slice(0, 200)
    const serialized = writeSnapshot(next)
    localStorage.setItem(STORAGE_KEY, serialized)
    lastPersisted = serialized
    Object.assign(state, next)
    notify(message)
    return result ?? true
  } catch (error) {
    logError(error, 'workflow-transaction', 'warn')
    notify(
      error.issues?.[0]?.message ||
        (error.name === 'QuotaExceededError'
          ? 'Depolama alanı dolu. İşlem kaydedilmedi; yer açıp tekrar deneyin.'
          : error.name === 'Error'
            ? error.message
            : 'İşlem kaydedilemedi. Tarayıcı depolama izinlerini kontrol edip tekrar deneyin.') ||
        'İşlem kaydedilemedi.',
      'error',
    )
    return false
  }
}
export const studentById = (value) => state.students.find((s) => s.id === value)
export const classById = (value) => state.classes.find((c) => c.id === value)
export const teacherById = (value) => state.teachers.find((t) => t.id === value)
export const branchById = (value) => state.branches.find((b) => b.id === value)
export const gradesFor = (value) => state.grades.filter((g) => g.studentId === value)
export const gradeAverage = (value) => average(gradesFor(value).map((g) => g.score))
export const absentCount = (value) =>
  state.attendance.filter((a) => a.studentId === value && a.status === 'absent').length
export const teacherClasses = computed(() =>
  state.classes.filter(
    (c) =>
      c.isActive &&
      state.teachers.some((t) => t.id === teacherId && t.isActive) &&
      state.assignments.some((a) => a.classId === c.id && a.teacherId === teacherId),
  ),
)

export const assignmentsForClass = (classId) =>
  state.assignments.filter(
    (a) => a.classId === classId && state.teachers.some((t) => t.id === a.teacherId && t.isActive),
  )
