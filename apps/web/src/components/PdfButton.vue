<script setup>
import { computed } from 'vue'
import { previewPdf, pendingDocuments } from '../lib/download.js'
import Icon from './Icon.vue'
const props = defineProps({
  type: { type: String, required: true },
  recordId: { type: String, required: true },
  studentId: { type: String, default: undefined },
  filename: { type: String, default: undefined },
})
const busy = computed(() => pendingDocuments.has(`${props.type}:${props.recordId}`))
</script>
<template>
  <button
    type="button"
    class="btn"
    :disabled="busy"
    :aria-busy="busy"
    @click="previewPdf(type, recordId, filename, studentId)"
  >
    <Icon :name="busy ? 'RefreshCw' : 'Download'" :size="17" :class="{ spinning: busy }" />
    <span v-if="busy">PDF hazırlanıyor…</span><slot v-else>PDF önizle</slot>
  </button>
</template>
