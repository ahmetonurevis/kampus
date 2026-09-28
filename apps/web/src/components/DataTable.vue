<script setup>
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Pagination from './Pagination.vue'
import ListFilters from './ListFilters.vue'
import { columnFilters } from '../lib/list-query.js'
import { useList } from '../lib/use-list.js'
import { useMediaQuery } from '../lib/use-media-query.js'
import { useViewMemory } from '../lib/view-memory.js'
const props = defineProps({
  listKey: { type: String, required: true },
  mobileColumns: { type: Array, default: () => [] },
  rows: { type: Array, required: true },
  columns: { type: Array, required: true },
  search: { type: Boolean, default: true },
  pageSize: { type: Number, default: 8 },
  empty: { type: String, default: 'Aramanızla eşleşen kayıt bulunamadı.' },
  filters: { type: Array, default: () => [] },
  excludeFilters: { type: Array, default: () => [] },
  externalActive: Boolean,
  externalLabel: { type: String, default: 'Seçili filtreler' },
  filterKey: { type: [String, Number, Array, Boolean], default: '' },
  searchKeys: { type: Array, default: () => ['phone', 'email'] },
})
const emit = defineEmits(['reset'])
const fields = computed(() => [
  ...new Map(
    [
      ...columnFilters(props.columns).filter((f) => !props.excludeFilters.includes(f.key)),
      ...props.filters,
    ].map((field) => [field.key, field]),
  ).values(),
])
const keys = computed(() => [
  ...props.columns.filter((c) => c.key !== 'actions').map((c) => c.key),
  ...props.searchKeys,
])
const { query, values, page, size, filtered, clear, sortKey, sortDirection, expanded } = useList(
  props,
  fields,
  keys,
)
const mobile = useMediaQuery('(max-width: 650px)')
const scrollRegion = ref(null)
const remember = useViewMemory()
const scrollPosition = remember(`${props.listKey}:scroll`, { top: 0, left: 0 })
watch(
  scrollRegion,
  (element) => {
    if (!element) return
    const { top, left } = scrollPosition.value
    element.scrollTo({
      top: Number.isFinite(top) ? Math.max(0, top) : 0,
      left: Number.isFinite(left) ? Math.max(0, left) : 0,
    })
  },
  { flush: 'post' },
)
function rememberScroll(event) {
  scrollPosition.value = {
    top: event.currentTarget.scrollTop,
    left: event.currentTarget.scrollLeft,
  }
}
watch(
  [page, size, query, values, sortKey, sortDirection, () => props.filterKey],
  () => {
    scrollPosition.value = { ...scrollPosition.value, top: 0 }
    if (scrollRegion.value) scrollRegion.value.scrollTop = 0
  },
  { deep: true, flush: 'post' },
)
const titleColumn = computed(() => props.columns.find((column) => column.key !== 'actions'))
const cardColumns = computed(() =>
  props.columns.filter(
    (column) => column.key !== titleColumn.value?.key && column.key !== 'actions',
  ),
)
const mainColumns = computed(() =>
  props.mobileColumns.length
    ? cardColumns.value.filter((column) => props.mobileColumns.includes(column.key))
    : cardColumns.value.slice(0, 3),
)
const detailColumns = computed(() =>
  cardColumns.value.filter((column) => !mainColumns.value.includes(column)),
)
const sorted = computed(() =>
  !sortKey.value
    ? filtered.value
    : [...filtered.value].sort((a, b) => {
        const left = a[sortKey.value],
          right = b[sortKey.value]
        if (left == null) return right == null ? 0 : 1
        if (right == null) return -1
        return (
          (typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), 'tr', { numeric: true })) *
          sortDirection.value
        )
      }),
)
const visible = computed(() =>
  sorted.value.slice((page.value - 1) * size.value, page.value * size.value),
)
const hasQuery = computed(() => props.externalActive || query.value)
watch([sortKey, sortDirection], () => {
  page.value = 1
})
function sort(key) {
  if (sortKey.value === key && sortDirection.value === -1) {
    sortKey.value = ''
    sortDirection.value = 1
  } else if (sortKey.value === key) sortDirection.value = -1
  else {
    sortKey.value = key
    sortDirection.value = 1
  }
}
function reset() {
  clear()
  emit('reset')
}
function changeMobileSort(event) {
  const [key, direction] = event.target.value.split(':')
  sortKey.value = key
  sortDirection.value = Number(direction) || 1
}
function clearSort() {
  sortKey.value = ''
  sortDirection.value = 1
}
defineExpose({ filteredRows: sorted, reset })
</script>
<template>
  <div class="data-table">
    <div v-if="search || (!mobile && $slots.filters)" class="table-toolbar">
      <label v-if="search" class="search-field"
        ><Icon name="Search" :size="17" /><input
          v-model="query"
          aria-label="Tabloda ara"
          placeholder="Listede ara..."
      /></label>
      <button
        v-if="mobile && hasQuery"
        class="icon-button"
        aria-label="Aramayı ve filtreleri temizle"
        @click="reset"
      >
        <Icon name="X" :size="17" />
      </button>
      <div v-if="!mobile" class="toolbar-filters">
        <slot name="filters" /><button v-if="hasQuery" class="btn btn-sm" @click="reset">
          <Icon name="X" :size="15" />Aramayı ve filtreleri temizle
        </button>
      </div>
    </div>
    <slot v-if="!mobile" name="presets" />
    <ListFilters
      v-model="values"
      v-model:expanded="expanded"
      :fields="fields"
      :rows="rows"
      :external-active="mobile && externalActive"
      :external-label="externalLabel"
      @reset="emit('reset')"
    >
      <template v-if="mobile && sortKey" #actions>
        <button class="filter-chip" aria-label="Sıralamayı kaldır" @click="clearSort">
          <Icon :name="sortDirection === 1 ? 'ArrowUp' : 'ArrowDown'" :size="14" />
          {{ columns.find((column) => column.key === sortKey)?.label }}
          <Icon name="X" :size="13" />
        </button>
      </template>
      <template v-if="mobile" #before-fields>
        <div v-if="$slots.presets" class="filter-presets"><slot name="presets" /></div>
        <div v-if="$slots.filters" class="filter-external-controls"><slot name="filters" /></div>
        <label class="filter-control mobile-sort">
          Sıralama
          <select
            :value="sortKey ? `${sortKey}:${sortDirection}` : ''"
            aria-label="Kayıt sıralaması"
            @change="changeMobileSort"
          >
            <option value="">Varsayılan sıralama</option>
            <template
              v-for="column in columns.filter((c) => c.key !== 'actions')"
              :key="column.key"
            >
              <option :value="`${column.key}:1`">{{ column.label }} · Artan</option>
              <option :value="`${column.key}:-1`">{{ column.label }} · Azalan</option>
            </template>
          </select>
        </label>
      </template>
    </ListFilters>
    <div
      v-if="!mobile"
      ref="scrollRegion"
      class="table-scroll"
      tabindex="0"
      role="region"
      aria-label="Kayıt tablosu; tüm kayıt ve sütunlar için kaydırın"
      @scroll.passive="rememberScroll"
    >
      <table>
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              :class="{ 'sticky-actions': column.key === 'actions' }"
              :aria-sort="
                sortKey === column.key ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'
              "
            >
              <button v-if="column.key !== 'actions'" class="table-sort" @click="sort(column.key)">
                {{ column.label
                }}<Icon
                  :name="
                    sortKey === column.key
                      ? sortDirection === 1
                        ? 'ArrowUp'
                        : 'ArrowDown'
                      : 'ArrowUpDown'
                  "
                  :size="12"
                /></button
              ><span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id">
            <td
              v-for="column in columns"
              :key="column.key"
              :class="{ 'sticky-actions': column.key === 'actions' }"
            >
              <slot :name="column.key" :row="row" :value="row[column.key]">{{
                row[column.key] ?? '—'
              }}</slot>
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td :colspan="columns.length" class="empty-cell">
              <Icon name="Search" :size="28" />
              <p>{{ empty }}</p>
              <button class="btn btn-sm" @click="reset">Aramayı ve filtreleri temizle</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="mobile-records">
      <article
        v-for="row in visible"
        :key="row.id"
        class="mobile-record"
        :aria-label="String(row[titleColumn.key] || 'Kayıt')"
      >
        <header>
          <slot :name="titleColumn.key" :row="row" :value="row[titleColumn.key]">{{
            row[titleColumn.key] ?? '—'
          }}</slot>
        </header>
        <dl class="record-fields">
          <div v-for="column in mainColumns" :key="column.key">
            <dt>{{ column.label }}</dt>
            <dd>
              <slot :name="column.key" :row="row" :value="row[column.key]">{{
                row[column.key] ?? '—'
              }}</slot>
            </dd>
          </div>
        </dl>
        <details v-if="detailColumns.length" class="record-details">
          <summary>Diğer bilgiler</summary>
          <dl class="record-fields">
            <div v-for="column in detailColumns" :key="column.key">
              <dt>{{ column.label }}</dt>
              <dd>
                <slot :name="column.key" :row="row" :value="row[column.key]">{{
                  row[column.key] ?? '—'
                }}</slot>
              </dd>
            </div>
          </dl>
        </details>
        <footer v-if="$slots.actions" class="record-actions">
          <slot name="actions" :row="row" :value="row.actions" />
        </footer>
      </article>
      <div v-if="!visible.length" class="empty-cell">
        <Icon name="Search" :size="28" />
        <p>{{ empty }}</p>
        <button class="btn btn-sm" @click="reset">Aramayı ve filtreleri temizle</button>
      </div>
    </div>
    <Pagination v-model:page="page" v-model:page-size="size" :total="sorted.length" />
  </div>
</template>
