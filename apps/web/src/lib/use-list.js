import { computed, watch } from 'vue'
import { filterRows } from './list-query.js'
import { useViewMemory } from './view-memory.js'

export function useList(props, fields, searchKeys) {
  const remember = useViewMemory()
  const key = props.listKey
  const query = remember(`${key}:query`, ''),
    values = remember(`${key}:filters`, {}),
    page = remember(`${key}:page`, 1),
    size = remember(`${key}:size`, props.pageSize),
    sortKey = remember(`${key}:sort`, ''),
    sortDirection = remember(`${key}:direction`, 1),
    ordering = remember(`${key}:ordering`, ''),
    expanded = remember(`${key}:expanded`, false)
  if (!Number.isInteger(size.value) || size.value < 1 || size.value > 100)
    size.value = props.pageSize
  if (!Number.isInteger(page.value) || page.value < 1) page.value = 1
  const filtered = computed(() =>
    filterRows(props.rows, query.value, fields.value, values.value, searchKeys.value),
  )
  const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)))
  watch(
    [query, values, size, () => JSON.stringify(props.filterKey)],
    () => {
      page.value = 1
    },
    { deep: true },
  )
  watch(
    pages,
    (count) => {
      page.value = Math.min(page.value, count)
    },
    { immediate: true },
  )
  function clear() {
    query.value = ''
    values.value = {}
    page.value = 1
  }
  return { query, values, page, size, filtered, clear, sortKey, sortDirection, ordering, expanded }
}
