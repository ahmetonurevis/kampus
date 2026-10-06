<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { state, role, selectedChildId, transaction, notify, logError } from '../stores/demo.js'
import {
  automationExams,
  automationSchemas,
  prepareProfile,
  previewOptical,
  currentEvaluations,
  runAssessment,
  exampleOpticalFile,
} from '@kampus/school-core/lib/assessment-automation.js'
import { dateLabel } from '../lib/format.js'
import { exportCsv, saveTextFile } from '../lib/download.js'
import { useFormErrors } from '../lib/use-form-errors.js'
import { useDetailPanel } from '../lib/use-detail-panel.js'
import PageHeading from './PageHeading.vue'
import DataTable from './DataTable.vue'
import Modal from './Modal.vue'
import Badge from './Badge.vue'
const route = useRoute(),
  session = computed(() => ({ role: role.value, childId: selectedChildId.value }))
const exams = computed(() => automationExams(state, session.value))
const profiles = computed(() =>
  state.opticalProfiles.filter((p) => exams.value.some((e) => e.id === p.examId)),
)
const profileId = ref(
  profiles.value.find((p) => p.examId === route.query.sinav)?.id || profiles.value[0]?.id || '',
)
const profile = computed(() => profiles.value.find((p) => p.id === profileId.value))
const text = ref(''),
  encoding = ref('utf-8'),
  importing = ref(false),
  preview = ref(null),
  error = ref('')
const profileInput = ref(null),
  editingId = ref(''),
  profileReview = ref(null),
  profileForm = ref(null)
const validation = useFormErrors(profileForm)
const previewTable = ref(null),
  resultTable = ref(null),
  panel = useDetailPanel('sonuc')
let readRequest = 0
const columns = [
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'subject', label: 'Ders' },
  { key: 'booklet', label: 'Kitapçık' },
  { key: 'correct', label: 'Doğru' },
  { key: 'wrong', label: 'Yanlış' },
  { key: 'blank', label: 'Boş' },
  { key: 'multiple', label: 'Çoklu işaret' },
  { key: 'cancelled', label: 'İptal soru' },
  { key: 'net', label: 'Net' },
  { key: 'status', label: 'Durum' },
]
const subjectName = (id) => state.subjects.find((s) => s.id === id)?.name || id
const present = (row) => ({
  ...row,
  id: row.id || `${row.studentId}-${row.subjectId}`,
  subject: subjectName(row.subjectId),
  studentName: state.students.find((s) => s.id === row.studentId)?.name || row.studentName,
  status: row.replaces ? 'Mevcut sonucu günceller' : 'Yeni değerlendirme',
})
const previewRows = computed(() => (preview.value || []).map(present))
const results = computed(() =>
  profile.value
    ? currentEvaluations(state, profile.value.examId, session.value).map((row) => ({
        ...present(row),
        status: 'Değerlendirildi',
        date: row.updatedAt,
      }))
    : [],
)
const resultColumns = [
  ...columns,
  { key: 'date', label: 'Tarih' },
  { key: 'actions', label: 'İşlemler' },
]
const selected = computed(() => results.value.find((r) => r.id === panel.selectedId.value))
const outcome = {
  correct: 'Doğru',
  wrong: 'Yanlış',
  blank: 'Boş',
  multiple: 'Çoklu işaret',
  cancelled: 'İptal',
}
const keyRows = computed(
  () =>
    profile.value?.keys.flatMap((k) =>
      k.questions.map((q) => ({ ...q, booklet: k.booklet, question: q.number })),
    ) || [],
)
function clearPreview() {
  preview.value = null
  error.value = ''
}
watch([text, profileId, () => profile.value?.revision, () => state.modules.exams], clearPreview)
watch(profileId, () => {
  readRequest++
  text.value = ''
  importing.value = false
})
watch(profiles, (rows) => {
  if (!rows.some((p) => p.id === profileId.value)) profileId.value = rows[0]?.id || ''
})
watch(
  profileInput,
  () => {
    profileReview.value = null
  },
  { deep: true },
)
function showError(value) {
  logError(value, 'optical', 'warn')
  error.value =
    value.issues?.[0]?.message ||
    (value.name === 'Error'
      ? value.message
      : 'Dosya işlenemedi. Biçimini ve karakter kodlamasını kontrol edin.')
  notify(error.value, 'error')
}
async function readFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const request = ++readRequest
  if (file.size > 1024 * 1024 || !/\.(csv|dat|txt)$/i.test(file.name)) {
    showError(new Error('En fazla 1 MB boyutunda CSV, DAT veya TXT dosyası seçin.'))
    event.target.value = ''
    return
  }
  importing.value = true
  try {
    const content = new TextDecoder(encoding.value, { fatal: true }).decode(
      await file.arrayBuffer(),
    )
    if (request === readRequest) text.value = content
  } catch (exception) {
    if (request === readRequest) showError(exception)
  } finally {
    if (request === readRequest) importing.value = false
    event.target.value = ''
  }
}
function evaluate() {
  error.value = ''
  try {
    preview.value = previewOptical(state, session.value, {
      profileId: profileId.value,
      text: text.value,
    })
  } catch (exception) {
    preview.value = null
    showError(exception)
  }
}
function commit() {
  if (!preview.value) return
  const result = transaction(
    (next, id) =>
      runAssessment(
        next,
        session.value,
        'evaluate',
        {
          profileId: profileId.value,
          text: text.value,
          expectedPreview: JSON.stringify(preview.value),
        },
        id,
      ),
    'Optik sonuçlar kaydedildi.',
  )
  if (result) {
    preview.value = null
    text.value = ''
  }
}
function newKey(examId) {
  const exam = state.mockExams.find((e) => e.id === examId)
  return [
    'booklet;question;subjectId;topic;answer',
    ...(exam?.subjectIds || []).flatMap((subjectId, index) =>
      ['A', 'B'].map(
        (answer, n) =>
          `A;${index * 2 + n + 1};${subjectId};${state.subjects.find((s) => s.id === subjectId)?.topics[0] || 'Genel kazanım'};${answer}`,
      ),
    ),
  ].join('\n')
}
function openProfile(existing) {
  editingId.value = existing?.id || ''
  const examId =
    existing?.examId ||
    exams.value.find((e) => !state.opticalProfiles.some((p) => p.examId === e.id))?.id ||
    exams.value[0]?.id ||
    ''
  profileInput.value = existing
    ? { ...existing }
    : {
        examId,
        title: 'Optik sınav profili',
        format: 'csv',
        identifier: 'number',
        headerLines: 0,
        studentStart: 1,
        studentLength: 7,
        bookletStart: 8,
        bookletLength: 1,
        answersStart: 9,
        answersLength: (state.mockExams.find((e) => e.id === examId)?.subjectIds.length || 1) * 2,
        keyCsv: newKey(examId),
      }
  profileReview.value = null
  validation.clear()
  error.value = ''
}
function changeExam() {
  profileInput.value.keyCsv = newKey(profileInput.value.examId)
  profileInput.value.answersLength =
    (state.mockExams.find((e) => e.id === profileInput.value.examId)?.subjectIds.length || 1) * 2
}
function saveProfile() {
  if (!validation.validate(automationSchemas.profile, profileInput.value)) return
  if (!profileReview.value) {
    try {
      profileReview.value = prepareProfile(
        state,
        session.value,
        profileInput.value,
        editingId.value,
      )
    } catch (exception) {
      showError(exception)
    }
    return
  }
  const result = transaction(
    (next, id) =>
      runAssessment(next, session.value, 'profile', profileInput.value, id, editingId.value),
    'Optik profil kaydedildi.',
  )
  if (result) {
    profileInput.value = null
    profileId.value = result.id
  }
}
function sample() {
  try {
    saveTextFile(
      exampleOpticalFile(state, profile.value, session.value),
      profile.value.format === 'csv' ? 'optik-cevap-ornegi.csv' : 'optik-cevap-ornegi.dat',
    )
  } catch (exception) {
    showError(exception)
  }
}
function exportRows(rows) {
  exportCsv('optik-sonuclar', columns, rows)
}
function keyTemplate() {
  exportCsv(
    'optik-cevap-anahtari',
    [
      { key: 'booklet', label: 'booklet' },
      { key: 'question', label: 'question' },
      { key: 'subjectId', label: 'subjectId' },
      { key: 'topic', label: 'topic' },
      { key: 'answer', label: 'answer' },
    ],
    keyRows.value,
  )
}
</script>
<template>
  <PageHeading>
    <button
      v-if="role === 'yonetici' && state.modules.exams"
      class="btn btn-primary"
      @click="openProfile()"
    >
      Optik profil oluştur
    </button>
  </PageHeading>
  <section v-if="!state.modules.exams" class="panel">
    <h2>Deneme sınavları modülü kapalı</h2>
    <p>Optik değerlendirme için yönetici bu modülü açmalıdır.</p>
  </section>
  <template v-else>
    <section class="panel optical-panel">
      <div class="panel-heading">
        <div>
          <h2>Cevap dosyasını değerlendir</h2>
          <p>
            Önizleme kayıtları değiştirmez. Son onay, aynı sınav/öğrenci/ders sonucunu günceller.
          </p>
        </div>
      </div>
      <label
        >Optik profil<select v-model="profileId">
          <option value="">Profil seçin</option>
          <option v-for="item in profiles" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select></label
      >
      <template v-if="profile">
        <div class="optical-actions">
          <button class="btn" @click="sample">Örnek cevap dosyasını indir</button>
          <button class="btn" @click="keyTemplate">Cevap anahtarını indir</button>
          <button v-if="role === 'yonetici'" class="btn" @click="openProfile(profile)">
            Profili düzenle
          </button>
          <RouterLink
            v-if="state.modules.tutoring"
            class="btn"
            :to="`/${role}/otomatik-etut?sinav=${profile.examId}`"
            >Otomatik etüt planla</RouterLink
          >
        </div>
        <p v-if="profile.format === 'csv'">
          CSV başlıkları: <code>student;booklet;answers</code>. Öğrenci alanı
          {{ profile.identifier === 'number' ? 'okul numarası' : 'öğrenci kimliği' }} içerir.
        </p>
        <p v-else>
          DAT/TXT konumları (1’den başlar): öğrenci {{ profile.studentStart }}–{{
            profile.studentStart + profile.studentLength - 1
          }}, kitapçık {{ profile.bookletStart }}–{{
            profile.bookletStart + profile.bookletLength - 1
          }}, cevap {{ profile.answersStart }}–{{
            profile.answersStart + profile.answersLength - 1
          }}. Atlanan başlık satırı: {{ profile.headerLines }}.
        </p>
        <p>
          A–E cevap; boş için - / . / _ / boşluk; çoklu işaret için *. İptal sorular net ve kazanım
          oranından çıkarılır. Çoklu işaret yanlış sayılır.
        </p>
        <div class="optical-fields">
          <label
            >Karakter kodlaması<select v-model="encoding">
              <option value="utf-8">UTF-8</option>
              <option value="windows-1254">Windows-1254 (Türkçe)</option>
            </select></label
          >
          <label
            >Optik cevap dosyası<input
              type="file"
              accept=".csv,.dat,.txt"
              :disabled="importing"
              @change="readFile"
          /></label>
        </div>
        <label
          >Optik dosya içeriği<textarea
            v-model="text"
            maxlength="1048576"
            rows="5"
            spellcheck="false"
          />
        </label>
        <p v-if="error" role="alert" class="optical-error">{{ error }}</p>
        <button class="btn btn-primary" :disabled="importing || !text" @click="evaluate">
          {{ importing ? 'Dosya okunuyor…' : 'Sonuçları önizle' }}
        </button>
      </template>
      <p v-else>
        Bu sınav için yönetici cevap anahtarı ve dosya alanlarını tanımlayan bir profil
        oluşturabilir.
      </p>
    </section>
    <section v-if="preview" class="panel">
      <div class="panel-heading">
        <div>
          <h2>Değerlendirme önizlemesi</h2>
          <p>
            {{ new Set(preview.map((r) => r.studentId)).size }} öğrenci · {{ preview.length }} ders
            sonucu. Mevcut sonuçlar aşağıda belirtilmiştir.
          </p>
        </div>
        <button class="btn" @click="exportRows(previewTable?.filteredRows || previewRows)">
          Önizlemeyi CSV indir
        </button>
      </div>
      <DataTable
        ref="previewTable"
        list-key="optical-preview"
        :rows="previewRows"
        :columns="columns"
        :mobile-columns="['subject', 'net', 'status']"
      />
      <div class="optical-actions">
        <button class="btn btn-primary" @click="commit">Onayla ve sonuçları kaydet</button
        ><button class="btn" @click="preview = null">Önizlemeyi kapat</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>Kayıtlı optik sonuçlar</h2>
          <p>
            Güncel cevap anahtarıyla değerlendirilen sonuçlar gösterilir. Anahtar değişirse dosyayı
            yeniden değerlendirin.
          </p>
        </div>
        <button class="btn" @click="exportRows(resultTable?.filteredRows || results)">
          Sonuçları CSV indir
        </button>
      </div>
      <DataTable
        :key="profileId"
        ref="resultTable"
        :list-key="`optical-results-${role}-${profileId}`"
        :rows="results"
        :columns="resultColumns"
        :mobile-columns="['subject', 'net']"
        empty="Henüz güncel optik değerlendirme yok."
      >
        <template #studentName="{ row }"
          ><button class="text-link" @click="panel.open(row.id)">
            {{ row.studentName }}
          </button></template
        >
        <template #status="{ value }"><Badge :text="value" /></template>
        <template #date="{ value }">{{ dateLabel(value) }}</template>
        <template #actions="{ row }"
          ><button class="btn btn-sm" @click="panel.open(row.id)">
            Kazanım ve sorular
          </button></template
        >
      </DataTable>
    </section>
  </template>
  <Modal
    v-if="panel.selectedId.value"
    :title="selected ? `${selected.studentName} · ${selected.subject}` : 'Sonuç bulunamadı'"
    drawer
    @close="panel.close"
  >
    <template v-if="selected"
      ><h3>Kazanım başarıları</h3>
      <p v-for="topic in selected.topicScores" :key="topic.topic">
        {{ topic.topic }}:
        {{
          topic.total ? `%${topic.percent} (${topic.correct}/${topic.total})` : 'Tüm sorular iptal'
        }}
      </p>
      <h3>Soru ayrıntıları</h3>
      <p v-for="question in selected.questionResults" :key="question.number">
        {{ question.number }}. soru · {{ question.topic }} · {{ outcome[question.outcome] }} ·
        İşaret {{ question.response.trim() || 'boş' }} / Anahtar {{ question.answer }}
      </p></template
    >
    <p v-else>Güncel değerlendirme mevcut rol kapsamında bulunamadı.</p>
  </Modal>
  <Modal
    v-if="profileInput"
    :title="editingId ? 'Optik profil düzenle' : 'Optik profil oluştur'"
    wide
    @close="profileInput = null"
  >
    <form ref="profileForm" class="optical-panel" novalidate @submit.prevent="saveProfile">
      <p>
        Anahtar değişikliği önceki kazanım analizlerini geçersiz kılar; cevap dosyaları yeniden
        değerlendirilmelidir.
      </p>
      <template v-if="!profileReview">
        <div class="optical-fields">
          <label
            >Profil adı<input
              v-model="profileInput.title"
              v-bind="validation.field('title', 'Profil adı')"
            /><small v-if="validation.errors.value.title">{{
              validation.errors.value.title
            }}</small></label
          >
          <label
            >Sınav<select
              v-model="profileInput.examId"
              :disabled="!!editingId"
              v-bind="validation.field('examId', 'Sınav')"
              @change="changeExam"
            >
              <option v-for="exam in exams" :key="exam.id" :value="exam.id">
                {{ exam.title }}
              </option>
            </select></label
          >
          <label
            >Dosya biçimi<select v-model="profileInput.format">
              <option value="csv">Cevap sütunlu CSV</option>
              <option value="fixed">Sabit alanlı DAT/TXT</option>
            </select></label
          >
          <label
            >Öğrenci eşleştirme<select v-model="profileInput.identifier">
              <option value="number">Okul numarası</option>
              <option value="id">Öğrenci kimliği</option>
            </select></label
          >
        </div>
        <div v-if="profileInput.format === 'fixed'" class="optical-fields">
          <label
            v-for="field in [
              { key: 'headerLines', label: 'Atlanacak başlık satırı', min: 0, max: 10 },
              { key: 'studentStart', label: 'Öğrenci alanı başlangıcı', min: 1, max: 1000 },
              { key: 'studentLength', label: 'Öğrenci alanı uzunluğu', min: 1, max: 100 },
              { key: 'bookletStart', label: 'Kitapçık alanı başlangıcı', min: 1, max: 1000 },
              { key: 'bookletLength', label: 'Kitapçık alanı uzunluğu', min: 1, max: 10 },
              { key: 'answersStart', label: 'Cevap alanı başlangıcı', min: 1, max: 1000 },
              { key: 'answersLength', label: 'Cevap alanı uzunluğu', min: 1, max: 400 },
            ]"
            :key="field.key"
            >{{ field.label
            }}<input
              v-model.number="profileInput[field.key]"
              type="number"
              :min="field.min"
              :max="field.max"
              v-bind="validation.field(field.key, field.label)"
            /><small v-if="validation.errors.value[field.key]">{{
              validation.errors.value[field.key]
            }}</small></label
          >
        </div>
        <label
          >Cevap anahtarı ve kazanımlar<textarea
            v-model="profileInput.keyCsv"
            rows="10"
            maxlength="1048576"
            spellcheck="false"
            v-bind="validation.field('keyCsv', 'Cevap anahtarı ve kazanımlar')"
          /><small v-if="validation.errors.value.keyCsv">{{
            validation.errors.value.keyCsv
          }}</small></label
        >
        <p>
          Başlık: <code>booklet;question;subjectId;topic;answer</code>. Soru numaraları her
          kitapçıkta 1’den başlar. İptal soru cevabı - olmalıdır.
        </p>
        <details>
          <summary>Ders kimlikleri</summary>
          <p v-for="subject in state.subjects" :key="subject.id">
            {{ subject.id }} · {{ subject.name }}
          </p>
        </details>
      </template>
      <section v-else>
        <h3>Profil kontrolü</h3>
        <p>
          {{ profileReview.title }} · {{ profileReview.format === 'csv' ? 'CSV' : 'DAT/TXT' }} ·
          {{ profileReview.identifier === 'number' ? 'Okul numarası' : 'Öğrenci kimliği' }}
        </p>
        <p v-for="key in profileReview.keys" :key="key.booklet">
          {{ key.booklet }} kitapçığı: {{ key.questions.length }} soru ·
          {{ key.questions.filter((q) => q.answer === '-').length }} iptal soru
        </p>
        <p>Anahtar sürümü: {{ profileReview.revision }}</p>
      </section>
      <p v-if="error" role="alert" class="optical-error">{{ error }}</p>
      <div class="optical-actions">
        <button v-if="profileReview" type="button" class="btn" @click="profileReview = null">
          Düzenlemeye dön</button
        ><button type="submit" class="btn btn-primary">
          {{ profileReview ? 'Onayla ve profili kaydet' : 'Profili kontrol et' }}</button
        ><button type="button" class="btn" @click="profileInput = null">Vazgeç</button>
      </div>
    </form>
  </Modal>
</template>
<style scoped>
.optical-panel {
  display: grid;
  gap: 18px;
}
.panel.optical-panel {
  padding: var(--space-card);
}
.panel.optical-panel > .panel-heading {
  padding: 0;
}
.optical-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.optical-panel label {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.optical-panel input,
.optical-panel select,
.optical-panel textarea {
  width: 100%;
  min-width: 0;
}
.optical-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}
.optical-error {
  color: var(--red);
  overflow-wrap: anywhere;
}
code {
  overflow-wrap: anywhere;
}
p {
  overflow-wrap: anywhere;
}
.optical-panel small {
  color: var(--red);
}
@media (max-width: 650px) {
  .optical-fields {
    grid-template-columns: 1fr;
  }
}
</style>
