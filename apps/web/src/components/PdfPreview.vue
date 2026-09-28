<script setup>
import { defineAsyncComponent, h, ref, watch } from 'vue'
import Modal from './Modal.vue'
import Icon from './Icon.vue'
import { pdfPreview, previewPdf, closePdfPreview, downloadPreview } from '../lib/download.js'
import { logError } from '../stores/demo.js'
const PdfPages = defineAsyncComponent({
  loader: () => import('./PdfPages.vue'),
  loadingComponent: {
    render: () => h('div', { class: 'document-loading', role: 'status' }, 'Önizleme yükleniyor…'),
  },
  errorComponent: {
    render: () =>
      h(
        'div',
        { class: 'document-loading', role: 'alert' },
        'Önizleme yüklenemedi. PDF’yi indirebilir veya pencereyi kapatıp yeniden açabilirsiniz.',
      ),
  },
  onError(error, retry, fail, attempts) {
    if (attempts < 2) retry()
    else {
      logError(error, 'pdf-viewer-load')
      fail()
    }
  },
})
const pages = ref(null)
const ready = ref(false)
const printing = ref(false)
watch(
  () => pdfPreview.value?.url,
  () => {
    ready.value = false
  },
)
function retry() {
  const { type, recordId, filename, studentId } = pdfPreview.value
  previewPdf(type, recordId, filename, studentId)
}
async function printDocument() {
  if (!ready.value || printing.value) return
  printing.value = true
  try {
    await pages.value?.print()
  } finally {
    printing.value = false
  }
}
</script>
<template>
  <Modal
    v-if="pdfPreview"
    :title="`${pdfPreview.title} · Önizleme`"
    wide
    document
    @close="closePdfPreview"
  >
    <div v-if="pdfPreview.loading" class="document-loading" role="status">
      <Icon name="RefreshCw" :size="28" class="spinning" />
      <p>Belgeniz hazırlanıyor…</p>
    </div>
    <div v-else-if="pdfPreview.error" class="document-loading" role="alert">
      <Icon name="FileText" :size="32" />
      <p>{{ pdfPreview.error }}</p>
      <button class="btn btn-primary" @click="retry">Yeniden dene</button>
    </div>
    <template v-else>
      <div class="document-toolbar">
        <div>
          <strong>{{ pdfPreview.filename }}</strong
          ><small>{{ pdfPreview.pages }} sayfa · PDF belgesi</small>
        </div>
        <div class="button-row">
          <button class="btn" :disabled="!ready || printing" @click="printDocument">
            <Icon name="Printer" :size="17" />{{ printing ? 'Hazırlanıyor…' : 'Yazdır' }}
          </button>
          <button class="btn btn-primary" @click="downloadPreview">
            <Icon name="Download" :size="17" />PDF’yi indir
          </button>
        </div>
      </div>
      <PdfPages
        ref="pages"
        :key="pdfPreview.url"
        :blob="pdfPreview.blob"
        :title="pdfPreview.title"
        @ready="ready = $event"
      />
      <p class="document-fallback">
        Belgeyi daha büyük görüntülemek veya yazdırmak için
        <a :href="pdfPreview.url" target="_blank" rel="noopener" class="text-link"
          >yeni sekmede aç<Icon name="ExternalLink" :size="14" /></a
        >.
      </p>
    </template>
  </Modal>
</template>
