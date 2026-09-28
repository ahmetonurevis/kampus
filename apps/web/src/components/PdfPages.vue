<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import Icon from './Icon.vue'
import { logError, notify } from '../stores/demo.js'

GlobalWorkerOptions.workerSrc = workerUrl
const props = defineProps({
  blob: { type: Blob, required: true },
  title: { type: String, required: true },
})
const emit = defineEmits(['ready'])
const canvas = ref(null)
const viewport = ref(null)
const currentPage = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const loading = ref(true)
const error = ref('')
const pageText = ref('')
let pdf
let loadingTask
let renderTask
let resizeObserver
let resizeFrame
let renderVersion = 0
let disposed = false
let printWindow

async function renderPage() {
  if (!pdf || disposed) return
  const version = ++renderVersion
  loading.value = true
  error.value = ''
  pageText.value = ''
  renderTask?.cancel()
  try {
    if (renderTask) await renderTask.promise.catch(() => {})
    if (version !== renderVersion || disposed) return
    const page = await pdf.getPage(currentPage.value)
    if (version !== renderVersion || disposed) return
    await nextTick()
    const natural = page.getViewport({ scale: 1 })
    const width = Math.min(viewport.value.clientWidth - 32, 820) * zoom.value
    const view = page.getViewport({ scale: width / natural.width })
    const density = Math.min(window.devicePixelRatio || 1, 2)
    canvas.value.width = Math.floor(view.width * density)
    canvas.value.height = Math.floor(view.height * density)
    canvas.value.style.width = `${view.width}px`
    canvas.value.style.height = `${view.height}px`
    renderTask = page.render({
      canvasContext: canvas.value.getContext('2d'),
      viewport: view,
      transform: density === 1 ? null : [density, 0, 0, density, 0, 0],
    })
    await renderTask.promise
    const content = await page.getTextContent()
    if (version !== renderVersion || disposed) return
    pageText.value = content.items.map((item) => item.str || '').join(' ')
    emit('ready', true)
  } catch (cause) {
    if (disposed || version !== renderVersion || cause.name === 'RenderingCancelledException')
      return
    error.value = 'Önizleme gösterilemedi. Yeniden deneyebilir veya PDF’yi indirebilirsiniz.'
    emit('ready', false)
    logError(cause, 'pdf-preview')
  } finally {
    if (version === renderVersion && !disposed) loading.value = false
  }
}

async function loadDocument() {
  loading.value = true
  error.value = ''
  emit('ready', false)
  try {
    const bytes = new Uint8Array(await props.blob.arrayBuffer())
    if (disposed) return
    loadingTask = getDocument({ data: bytes })
    pdf = await loadingTask.promise
    if (disposed) return
    pageCount.value = pdf.numPages
    await renderPage()
  } catch (cause) {
    if (disposed) return
    loading.value = false
    error.value = 'Önizleme gösterilemedi. Yeniden deneyebilir veya PDF’yi indirebilirsiniz.'
    logError(cause, 'pdf-preview-load')
  }
}

async function retry() {
  if (pdf) return renderPage()
  await loadingTask?.destroy()
  return loadDocument()
}

// Yazdırmada da önizlenen PDF'nin sayfaları kullanılır; tarayıcının PDF eklentisine ihtiyaç duyulmaz.
async function print() {
  if (!pdf || disposed) return
  const popup = window.open('', '_blank')
  if (!popup) {
    notify(
      'Yazdırma penceresi açılamadı. Tarayıcıdan açılır pencerelere izin verin veya PDF’yi indirin.',
      'warning',
    )
    return
  }
  printWindow = popup
  popup.opener = null
  popup.document.title = `${props.title} · Yazdır`
  popup.document.documentElement.lang = 'tr'
  const style = popup.document.createElement('style')
  style.textContent =
    '@page{size:A4;margin:0}body{margin:0;background:#eee}p{padding:24px;font:16px sans-serif}img{display:block;width:210mm;max-width:100%;height:auto;margin:0 auto 16px;background:white;break-after:page}img:last-child{break-after:auto}@media print{body{background:white}p{display:none}img{width:210mm;max-width:none;margin:0}}'
  popup.document.head.append(style)
  const message = popup.document.createElement('p')
  message.textContent = 'Yazdırma hazırlanıyor…'
  popup.document.body.append(message)
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      if (disposed || popup.closed) {
        popup.close()
        return
      }
      const page = await pdf.getPage(index)
      const view = page.getViewport({ scale: 2 })
      const sheet = document.createElement('canvas')
      sheet.width = Math.ceil(view.width)
      sheet.height = Math.ceil(view.height)
      await page.render({ canvasContext: sheet.getContext('2d'), viewport: view }).promise
      if (disposed || popup.closed) {
        popup.close()
        return
      }
      const image = popup.document.createElement('img')
      image.alt = `${props.title}, sayfa ${index}`
      image.src = sheet.toDataURL('image/png')
      sheet.width = sheet.height = 0
      popup.document.body.append(image)
      await image.decode()
    }
    if (disposed || popup.closed) {
      popup.close()
      return
    }
    message.textContent =
      'Belge hazır. Yeniden yazdırmak için tarayıcının Yazdır seçeneğini kullanabilirsiniz.'
    popup.focus()
    popup.print()
  } catch (cause) {
    popup.close()
    if (!disposed) {
      logError(cause, 'pdf-print')
      notify('Yazdırma hazırlanamadı. PDF’yi indirerek yeniden deneyin.', 'error')
    }
  } finally {
    printWindow = null
  }
}
defineExpose({ print })

watch([currentPage, zoom], () => {
  viewport.value?.scrollTo({ top: 0, left: 0 })
  renderPage()
})
onMounted(() => {
  let previousWidth = 0
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width)
    if (previousWidth === width) return
    previousWidth = width
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(renderPage)
  })
  resizeObserver.observe(viewport.value)
  loadDocument()
})
onBeforeUnmount(() => {
  disposed = true
  renderVersion++
  resizeObserver?.disconnect()
  cancelAnimationFrame(resizeFrame)
  renderTask?.cancel()
  printWindow?.close()
  loadingTask?.destroy().catch((cause) => logError(cause, 'pdf-preview-cleanup', 'warn'))
})
</script>

<template>
  <div class="pdf-pages">
    <div v-if="pageCount" class="pdf-page-controls">
      <div class="button-row">
        <button
          class="btn btn-icon"
          aria-label="Önceki PDF sayfası"
          :disabled="currentPage === 1"
          @click="currentPage--"
        >
          <Icon name="ChevronLeft" :size="18" />
        </button>
        <span role="status">Sayfa {{ currentPage }} / {{ pageCount }}</span>
        <button
          class="btn btn-icon"
          aria-label="Sonraki PDF sayfası"
          :disabled="currentPage === pageCount"
          @click="currentPage++"
        >
          <Icon name="ChevronRight" :size="18" />
        </button>
      </div>
      <select v-model.number="zoom" aria-label="PDF yakınlaştırma">
        <option :value="1">Genişliğe sığdır</option>
        <option :value="1.25">%125</option>
        <option :value="1.5">%150</option>
        <option :value="2">%200</option>
      </select>
    </div>
    <div
      ref="viewport"
      class="pdf-viewport"
      :aria-busy="loading"
      tabindex="0"
      aria-label="PDF sayfa görünümü"
    >
      <div v-if="error" class="document-loading" role="alert">
        <p>{{ error }}</p>
        <button class="btn" @click="retry">Önizlemeyi yeniden dene</button>
      </div>
      <p v-else-if="loading" class="pdf-render-status" role="status">Sayfa hazırlanıyor…</p>
      <canvas
        v-show="!error"
        ref="canvas"
        :class="{ 'pdf-rendering': loading }"
        role="img"
        :aria-label="`${title}, sayfa ${currentPage}`"
      ></canvas>
      <p class="sr-only">{{ pageText }}</p>
    </div>
  </div>
</template>
