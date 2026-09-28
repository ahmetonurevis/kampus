<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { pageNumbers } from '../lib/list-query.js'
import { useMediaQuery } from '../lib/use-media-query.js'
const mobile = useMediaQuery('(max-width: 650px)')
const props = defineProps({
  total: { type: Number, required: true },
  page: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  sizes: { type: Array, default: () => [8, 16, 32, 64] },
})
const emit = defineEmits(['update:page', 'update:pageSize'])
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const sizes = computed(() => [...new Set([props.pageSize, ...props.sizes])].sort((a, b) => a - b))
</script>
<template>
  <div class="list-pagination">
    <div class="pagination-info">
      <span role="status" aria-live="polite" aria-atomic="true" class="result-count"
        >{{ total ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, total) }}
        <span>/ {{ total }} kayıt</span></span
      >
      <label class="page-size"
        >Sayfa başına<select
          :value="pageSize"
          aria-label="Sayfa başına kayıt"
          @change="emit('update:pageSize', Number($event.target.value))"
        >
          <option v-for="size in sizes" :key="size" :value="size">{{ size }}</option>
        </select></label
      >
    </div>
    <nav class="pagination" aria-label="Liste sayfaları">
      <button
        class="icon-button"
        aria-label="Önceki sayfa"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        <Icon name="ChevronLeft" :size="17" />
      </button>
      <template v-for="number in mobile ? [] : pageNumbers(page, pages)" :key="number">
        <span v-if="typeof number === 'string'" class="page-gap" aria-hidden="true">…</span>
        <button
          v-else
          class="page-number"
          :class="{
            active: page === number,
            nearby: number !== page && number !== 1 && number !== pages,
          }"
          :aria-current="page === number ? 'page' : undefined"
          :aria-label="`${number}. sayfa`"
          @click="emit('update:page', number)"
        >
          {{ number }}
        </button>
      </template>
      <button
        class="icon-button"
        aria-label="Sonraki sayfa"
        :disabled="page >= pages"
        @click="emit('update:page', page + 1)"
      >
        <Icon name="ChevronRight" :size="17" />
      </button>
    </nav>
  </div>
</template>
