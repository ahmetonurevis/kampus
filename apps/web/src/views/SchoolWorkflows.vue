<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { state, role, selectedChildId, transaction, notify, logError } from '../stores/demo.js'
import { workflowPage } from '@kampus/school-core/modules/school-workflows.js'
import {
  runWorkflow,
  workflowSchemas,
  renewalQuote,
} from '@kampus/school-core/lib/school-workflows.js'
import {
  workflowRows,
  workflowDetails,
  workflowCreateActions,
  workflowForm,
  readFormValue,
  changeFormValue,
  normalizeWorkflowInput,
  csvTemplate,
  workflowCsvReferences,
} from '@kampus/school-core/lib/workflow-presentation.js'
import { money, dayKey, timeLabel, dateLabel } from '../lib/format.js'
import { exportCsv } from '../lib/download.js'
import { useDetailPanel } from '../lib/use-detail-panel.js'
import { useFormErrors } from '../lib/use-form-errors.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import Modal from '../components/Modal.vue'
import Badge from '../components/Badge.vue'
import Icon from '../components/Icon.vue'
import PdfButton from '../components/PdfButton.vue'
const route = useRoute(),
  panel = useDetailPanel('kayit'),
  table = ref(null),
  formElement = ref(null)
const session = computed(() => ({ role: role.value, childId: selectedChildId.value }))
const definition = computed(() => workflowPage(route.meta.path))
const allowed = computed(
  () => definition.value?.roles.includes(role.value) && state.modules[definition.value.key],
)
const rows = computed(() => workflowRows(state, session.value, route.meta.path))
const selected = computed(() => rows.value.find((r) => r.id === panel.selectedId.value))
const detail = computed(() =>
  selected.value ? workflowDetails(state, session.value, selected.value) : null,
)
const createActions = computed(() => workflowCreateActions(state, session.value, route.meta.path))
const columns = [
  { key: 'title', label: 'Kayıt' },
  { key: 'subtitle', label: 'Kapsam / Tarih' },
  { key: 'body', label: 'Özet' },
  { key: 'status', label: 'Durum' },
  { key: 'date', label: 'Tarih' },
  { key: 'actions', label: 'İşlemler' },
]
const descriptor = ref(null),
  values = ref({}),
  busy = ref(false),
  reviewing = ref(false),
  importBusy = ref(false)
const formDefinition = computed(() =>
  descriptor.value
    ? workflowForm(
        state,
        session.value,
        descriptor.value.command,
        descriptor.value.recordId,
        descriptor.value.initial,
      )
    : null,
)
const fields = computed(() => formDefinition.value?.fields(values.value) || [])
const formErrors = useFormErrors(formElement),
  errors = formErrors.errors
const quote = computed(() => {
  if (descriptor.value?.command !== 'renewal' || values.value.mode !== 'renew') return null
  try {
    return renewalQuote(values.value)
  } catch {
    return null
  }
})
const preview = computed(() =>
  fields.value.map((f) => {
    const value = readFormValue(values.value, f.key)
    return {
      label: f.label,
      value:
        f.type === 'select'
          ? f.options.find((o) => String(o.value) === String(value))?.label || 'Seçilmedi'
          : f.type === 'multi'
            ? f.options
                .filter((o) => value?.includes(o.value))
                .map((o) => o.label)
                .join(', ')
            : f.type === 'checkbox'
              ? value
                ? 'Evet'
                : 'Hayır'
              : value,
    }
  }),
)
watch([() => route.path, selectedChildId, allowed], () => {
  descriptor.value = null
  reviewing.value = false
})
function openForm(item) {
  descriptor.value = item
  values.value = JSON.parse(
    JSON.stringify(
      workflowForm(state, session.value, item.command, item.recordId, item.initial).initial,
    ),
  )
  reviewing.value = false
  formErrors.clear()
}
watch(
  () => route.query.ogrenci,
  (studentId) => {
    if (
      route.meta.path === 'rehberlik' &&
      typeof studentId === 'string' &&
      createActions.value.some((a) => a.command === 'guidance')
    )
      openForm({ command: 'guidance', initial: { studentId } })
  },
  { immediate: true },
)
function change(key, value) {
  values.value = changeFormValue(values.value, key, value)
  formErrors.clear()
  reviewing.value = false
}
function toggleMulti(key, value) {
  const old = values.value[key] || []
  change(key, old.includes(value) ? old.filter((v) => v !== value) : [...old, value])
}
function localDateTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(+date)) return value || ''
  return `${dayKey(value)}T${timeLabel(value)}`
}
async function readCsv(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 1024 * 1024 || !/\.csv$/i.test(file.name)) {
    notify('En fazla 1 MB boyutunda CSV dosyası seçin.', 'error')
    event.target.value = ''
    return
  }
  importBusy.value = true
  try {
    change('csv', await file.text())
  } catch (error) {
    logError(error, 'exam-csv-read', 'warn')
    notify('CSV okunamadı. UTF-8 olarak kaydedip tekrar deneyin.', 'error')
  } finally {
    importBusy.value = false
    event.target.value = ''
  }
}
function downloadTemplate() {
  exportCsv(
    'deneme-sonuc-sablonu',
    csvTemplate
      .split('\n')[0]
      .split(';')
      .map((key) => ({ key, label: key })),
    [
      {
        examId: 'exam-7-1',
        studentId: 's1',
        subjectId: 'math',
        correct: 12,
        wrong: 5,
        blank: 3,
        weakTopics: 'Denklemler',
      },
    ],
  )
}
function submit() {
  if (busy.value || importBusy.value || !allowed.value) return
  const input = normalizeWorkflowInput(formDefinition.value, values.value),
    schema = workflowSchemas[descriptor.value.command]
  if (schema && !formErrors.validate(schema, input)) return
  if (!reviewing.value) {
    reviewing.value = true
    return
  }
  busy.value = true
  const item = descriptor.value,
    result = transaction(
      (next, id) => runWorkflow(next, session.value, item.command, input, id, item.recordId),
      `${formDefinition.value.title}: işlem kaydedildi.`,
    )
  busy.value = false
  if (result !== false) {
    descriptor.value = null
    reviewing.value = false
  }
}
function csvExport() {
  exportCsv(
    route.meta.path,
    [{ key: 'id', label: 'id' }, ...columns.filter((c) => c.key !== 'actions')],
    table.value?.filteredRows || rows.value,
  )
}
</script>
<template>
  <PageHeading
    ><button
      v-for="(item, index) in createActions"
      :key="item.command"
      class="btn"
      :class="{ 'btn-primary': index === 0 }"
      @click="openForm(item)"
    >
      <Icon name="Plus" :size="17" />{{ item.label }}
    </button></PageHeading
  >
  <section v-if="allowed" class="panel">
    <div class="panel-heading">
      <div>
        <h2>{{ definition.title }}</h2>
        <p>
          {{ rows.length }} kayıt ·
          {{
            role === 'veli'
              ? 'Seçili çocuğunuzun kayıtları'
              : role === 'ogretmen'
                ? 'Görev kapsamınızdaki kayıtlar'
                : 'Okul iş akışları'
          }}
        </p>
      </div>
      <button class="btn" @click="csvExport"><Icon name="Download" :size="17" />CSV indir</button>
    </div>
    <DataTable
      :key="`${route.path}-${selectedChildId}`"
      ref="table"
      :list-key="`workflow-${route.path}-${selectedChildId}`"
      :rows="rows"
      :columns="columns"
      :mobile-columns="['subtitle', 'status']"
      empty="Henüz kayıt yok. Yetkili rolden yeni kayıt ekleyebilirsiniz."
    >
      <template #title="{ row }"
        ><button class="text-link" @click="panel.open(row.id)">{{ row.title }}</button></template
      >
      <template #body="{ value }"
        ><span class="workflow-summary">{{ value }}</span></template
      >
      <template #status="{ value }"><Badge :text="value" /></template>
      <template #date="{ value }">{{ dateLabel(value) }}</template>
      <template #actions="{ row }"
        ><button class="btn btn-sm" @click="panel.open(row.id)">Ayrıntılar</button></template
      >
    </DataTable>
  </section>
  <section v-else class="panel">
    <h2>Modül kullanıma kapalı</h2>
    <p>Yönetici modül ayarlarını değiştirebilir.</p>
  </section>
  <Modal
    v-if="panel.selectedId.value && allowed"
    :title="selected?.title || 'Kayıt bulunamadı'"
    drawer
    @close="panel.close"
  >
    <template v-if="selected"
      ><Badge :text="selected.status" />
      <section v-for="section in detail.sections" :key="section.title" class="workflow-section">
        <h3>{{ section.title }}</h3>
        <p v-if="!section.lines.length">Henüz kayıt yok.</p>
        <p v-for="(line, index) in section.lines" :key="index">{{ line }}</p>
      </section>
      <div class="workflow-actions">
        <PdfButton
          v-for="doc in detail.documents"
          :key="doc.id"
          :type="doc.type"
          :record-id="doc.id"
          :student-id="doc.studentId"
          >{{ doc.title }}</PdfButton
        ><button
          v-for="(item, index) in detail.actions"
          :key="`${item.command}-${item.recordId}-${index}`"
          class="btn"
          @click="openForm(item)"
        >
          {{ item.label }}
        </button>
      </div>
    </template>
    <p v-else>Kayıt mevcut rol veya çocuk kapsamında bulunamadı. Listeye dönüp yeniden seçin.</p>
  </Modal>
  <Modal
    v-if="descriptor && allowed"
    :title="formDefinition.title"
    :wide="fields.length > 6"
    @close="!busy && (descriptor = null)"
  >
    <form ref="formElement" class="workflow-form" novalidate @submit.prevent="submit">
      <p>{{ formDefinition.hint }}</p>
      <template v-if="!reviewing">
        <div v-if="descriptor.command === 'exam-import'" class="workflow-section">
          <button type="button" class="btn" @click="downloadTemplate">CSV şablonunu indir</button
          ><label
            >CSV dosyası seç<input
              type="file"
              accept=".csv,text/csv"
              :disabled="importBusy"
              @change="readCsv"
          /></label>
          <p>
            Aşağıdaki eşleştirme listesinden sınav, öğrenci ve ders kimliklerini kullanabilirsiniz.
          </p>
          <details>
            <summary>CSV kimlik eşleştirme listesi</summary>
            <p v-for="line in workflowCsvReferences(state, session)" :key="line">{{ line }}</p>
          </details>
        </div>
        <div class="workflow-fields">
          <div
            v-for="field in fields"
            :key="field.key"
            class="workflow-field"
            :class="{ 'full-field': ['textarea', 'multi'].includes(field.type) }"
          >
            <fieldset v-if="field.type === 'multi'">
              <legend>{{ field.label }}</legend>
              <label v-for="option in field.options" :key="option.value" class="workflow-check"
                ><input
                  type="checkbox"
                  :checked="values[field.key]?.includes(option.value)"
                  @change="toggleMulti(field.key, option.value)"
                />{{ option.label }}</label
              >
            </fieldset>
            <label v-else :for="`workflow-${field.key}`"
              >{{ field.label }}
              <select
                v-if="field.type === 'select'"
                :id="`workflow-${field.key}`"
                v-bind="formErrors.field(field.key, field.label)"
                :value="readFormValue(values, field.key)"
                @change="change(field.key, $event.target.value)"
              >
                <option v-if="!field.options.some((o) => o.value === '')" value="">Seçin</option>
                <option v-for="option in field.options" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <textarea
                v-else-if="field.type === 'textarea'"
                :id="`workflow-${field.key}`"
                v-bind="formErrors.field(field.key, field.label)"
                :value="readFormValue(values, field.key)"
                :maxlength="field.maxLength || 2000"
                rows="4"
                @input="change(field.key, $event.target.value)"
              />
              <input
                v-else-if="field.type === 'checkbox'"
                :id="`workflow-${field.key}`"
                type="checkbox"
                :checked="values[field.key]"
                @change="change(field.key, $event.target.checked)"
              />
              <input
                v-else
                :id="`workflow-${field.key}`"
                v-bind="formErrors.field(field.key, field.label)"
                :type="field.type === 'datetime' ? 'datetime-local' : field.type"
                :value="
                  field.type === 'datetime'
                    ? localDateTime(values[field.key])
                    : readFormValue(values, field.key)
                "
                :min="field.min"
                :max="field.max"
                :step="field.step || 1"
                @input="change(field.key, $event.target.value)"
              /> </label
            ><small v-if="field.hint">{{ field.hint }}</small>
            <p
              v-if="errors[field.key]"
              :id="formErrors.errorId(field.key)"
              role="alert"
              class="workflow-error"
            >
              {{ errors[field.key] }}
            </p>
          </div>
        </div>
      </template>
      <section v-else class="workflow-section">
        <h3>Kaydetmeden önce kontrol edin</h3>
        <dl class="workflow-review">
          <div v-for="item in preview" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </section>
      <section v-if="quote" class="workflow-section">
        <h3>Yeni dönem ödeme özeti</h3>
        <p>
          Brüt {{ money(quote.gross) }} · Burs {{ money(quote.scholarshipAmount) }} · Ek indirim
          {{ money(quote.discountAmount) }}
        </p>
        <strong>Net eğitim bedeli: {{ money(quote.amount) }}</strong>
        <p>{{ quote.installments.length }} taksit · Toplam {{ money(quote.amount) }}</p>
      </section>
      <footer class="workflow-actions">
        <button
          v-if="reviewing && fields.length"
          type="button"
          class="btn"
          :disabled="busy"
          @click="reviewing = false"
        >
          Düzenlemeye dön</button
        ><button type="submit" class="btn btn-primary" :disabled="busy || importBusy">
          {{ busy ? 'Kaydediliyor…' : reviewing ? 'Onayla ve kaydet' : 'Kontrol et' }}</button
        ><button type="button" class="btn" :disabled="busy" @click="descriptor = null">
          Vazgeç
        </button>
      </footer>
    </form>
  </Modal>
</template>
<style scoped>
.workflow-summary {
  white-space: pre-line;
  display: block;
  max-width: 440px;
}
.workflow-section {
  margin: 16px 0;
  display: grid;
  gap: 10px;
}
.workflow-section p,
.workflow-review dd {
  white-space: pre-line;
  overflow-wrap: anywhere;
  margin: 0;
}
.workflow-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
.workflow-form {
  display: grid;
  gap: 16px;
}
.workflow-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.workflow-field {
  min-width: 0;
  display: grid;
  gap: 5px;
}
.full-field {
  grid-column: 1/-1;
}
.workflow-field label {
  display: grid;
  gap: 8px;
}
.workflow-field input:not([type='checkbox']),
.workflow-field select,
.workflow-field textarea {
  width: 100%;
  min-width: 0;
}
.workflow-check {
  display: flex !important;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
.workflow-field fieldset {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
}
.workflow-error {
  color: var(--red, #b91c1c);
  margin: 0;
}
.workflow-review {
  display: grid;
  gap: 14px;
}
.workflow-review dt {
  font-weight: 600;
}
.workflow-review dd {
  margin-top: 4px;
}
.workflow-field small {
  color: var(--text-muted);
}
@media (max-width: 650px) {
  .workflow-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
