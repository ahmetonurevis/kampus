<script setup>
import { computed, watch } from 'vue'
import { useList } from '../lib/use-list.js'
import { hasFilter } from '../lib/list-query.js'
import Pagination from './Pagination.vue'
import ListFilters from './ListFilters.vue'
import Icon from './Icon.vue'
const props = defineProps({
  listKey: { type: String, required: true },
  presets: { type: Array, default: () => [] },
  rows: { type: Array, required: true },
  filters: { type: Array, default: () => [] },
  filterKey: { type: [String, Number, Array, Boolean], default: '' },
  pageSize: { type: Number, default: 6 },
  externalActive: Boolean,
  sortOptions: { type: Array, default: () => [] },
  searchLabel: { type: String, default: '' },
  searchKeys: { type: Array, default: () => ['title', 'text', 'description', 'subject', 'name'] },
  layout: { type: String, default: 'three-grid' },
})
const emit = defineEmits(['reset'])
const { query, values, page, size, filtered, clear, ordering, expanded } = useList(
  props,
  computed(() => props.filters),
  computed(() => props.searchKeys),
)
const sorted = computed(() => {
  const order = props.sortOptions.find((o) => o.value === ordering.value)
  return order
    ? [...filtered.value].sort(
        (a, b) =>
          String(a[order.key] || '').localeCompare(String(b[order.key] || ''), 'tr', {
            numeric: true,
          }) * (order.direction || 1),
      )
    : filtered.value
})
watch(ordering, () => {
  page.value = 1
})
const visible = computed(() =>
  sorted.value.slice((page.value - 1) * size.value, page.value * size.value),
)
const hasQuery = computed(
  () => props.externalActive || query.value || Object.values(values.value).some(hasFilter),
)
function reset() {
  clear()
  emit('reset')
}
</script>
<template>
  <section class="collection-list" aria-label="Kayıt listesi">
    <div v-if="presets.length" class="quick-filters" aria-label="Hazır filtreler">
      <button
        v-for="preset in presets"
        :key="preset.label"
        type="button"
        class="filter-chip"
        :aria-pressed="JSON.stringify(values) === JSON.stringify(preset.values)"
        @click="values = { ...preset.values }"
      >
        {{ preset.label }}
      </button>
    </div>
    <div v-if="searchLabel" class="collection-toolbar">
      <label v-if="searchLabel" class="search-field"
        ><Icon name="Search" :size="17" /><input
          v-model="query"
          :aria-label="searchLabel"
          :placeholder="searchLabel + '…'"
      /></label>
      <button v-if="hasQuery" class="text-link" @click="reset">
        Aramayı ve filtreleri temizle
      </button>
    </div>
    <ListFilters v-model="values" v-model:expanded="expanded" :rows="rows" :fields="filters"
      ><template v-if="sortOptions.length || (!searchLabel && hasQuery)" #actions>
        <select v-if="sortOptions.length" v-model="ordering" aria-label="Liste sıralaması">
          <option value="">Varsayılan sıralama</option>
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <button v-if="!searchLabel && hasQuery" class="text-link" @click="reset">
          Aramayı ve filtreleri temizle
        </button></template
      ></ListFilters
    >
    <div v-if="visible.length" :class="layout"><slot :items="visible" /></div>
    <div v-else class="panel empty-page">
      <Icon name="Search" :size="30" />
      <h2>Uygun kayıt bulunamadı.</h2>
      <p>Aramayı veya filtreleri değiştirerek yeniden deneyin.</p>
      <button class="btn" @click="reset">Aramayı ve filtreleri temizle</button>
    </div>
    <Pagination
      v-model:page="page"
      v-model:page-size="size"
      :total="filtered.length"
      :sizes="[6, 12, 24]"
    />
  </section>
</template>
