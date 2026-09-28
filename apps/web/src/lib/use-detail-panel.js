import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// Listeyi yerinde tutarken detay bağlantısı ve tarayıcının geri/ileri davranışı korunur.
export function useDetailPanel(parameter) {
  const route = useRoute(),
    router = useRouter()
  const selectedId = computed(() =>
    typeof route.query[parameter] === 'string' ? route.query[parameter] : '',
  )
  function open(id) {
    return router.push({ query: { ...route.query, [parameter]: id }, hash: route.hash })
  }
  function close() {
    const query = { ...route.query }
    delete query[parameter]
    const target = { path: route.path, query, hash: route.hash }
    if (router.options.history.state.back === router.resolve(target).fullPath) router.back()
    else return router.replace(target)
  }
  return { selectedId, open, close }
}
