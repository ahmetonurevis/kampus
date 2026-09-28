<script setup>
import { computed, ref, useId } from 'vue'
const props = defineProps({
  value: { type: String, default: '' },
  label: { type: String, default: 'kayıt' },
})
const expanded = ref(false)
const id = useId()
const items = computed(() =>
  props.value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)
</script>
<template>
  <div class="compact-list">
    <span>{{ items.slice(0, 2).join(', ') || '—' }}</span>
    <button
      v-if="items.length > 2"
      type="button"
      class="text-link"
      :aria-expanded="expanded"
      :aria-controls="id"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Daralt' : `+${items.length - 2} ${label}` }}
    </button>
    <span v-if="expanded" :id="id" class="compact-list-more">{{ items.slice(2).join(', ') }}</span>
  </div>
</template>
