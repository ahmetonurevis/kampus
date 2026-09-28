import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { selectedChildId, logError, state } from '../stores/demo.js'

const prefix = 'kampus-view-v1:'
const memory = new Map()
let storageReported = false
function storageError(error) {
  if (!storageReported) logError(error, 'view-preferences', 'warn')
  storageReported = true
}
export function readView(key, fallback) {
  try {
    const stored = memory.get(key) ?? JSON.parse(sessionStorage.getItem(prefix + key) || 'null')
    return stored === null ? fallback : stored
  } catch (error) {
    storageError(error)
    return fallback
  }
}
export function writeView(key, value) {
  memory.set(key, value)
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify(value))
  } catch (error) {
    storageError(error)
  }
}
export function viewScope(path, childId = selectedChildId.value) {
  return `${state.createdAt}:${path}:${path.startsWith('/veli/') ? childId : ''}`
}
export function useViewMemory() {
  const route = useRoute()
  // Capture the owning page. A departing page must never write into the next route.
  const scope = viewScope(route.path)
  return (name, initial) => {
    const key = `${scope}:${name}`
    const stored = readView(key, initial)
    const valid =
      initial !== null && typeof initial === 'object'
        ? stored !== null &&
          typeof stored === 'object' &&
          Array.isArray(stored) === Array.isArray(initial)
        : typeof stored === typeof initial
    const value = ref(valid ? structuredClone(stored) : initial)
    watch(value, (next) => writeView(key, JSON.parse(JSON.stringify(next))), {
      deep: true,
      flush: 'sync',
    })
    return value
  }
}
