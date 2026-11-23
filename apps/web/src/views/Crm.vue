<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed, reactive, ref, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import { state, action, id, branchById } from '../stores/demo.js'
import { dateLabel, dayKey, money } from '../lib/format.js'
import { requiredText } from '../lib/domain.js'
import { prospectSchema } from '../lib/prospects.js'
import { installmentAmounts } from '../lib/payments.js'
import { registrationSchema, enrollProspect } from '../lib/enrollment.js'
import { previewPdf, pendingDocuments } from '../lib/download.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import LineTabs from '../components/LineTabs.vue'
import WeekCalendar from '../components/WeekCalendar.vue'
import FormSteps from '../components/FormSteps.vue'
import { useFormErrors } from '../lib/use-form-errors.js'
const remember = useViewMemory()
const registrationElement = ref(null)
const {
  errors,
  errorId,
  field,
  validate,
  show: showErrors,
  clear: clearErrors,
} = useFormErrors(registrationElement)
const prospectElement = ref(null)
const prospectValidation = useFormErrors(prospectElement)
const registrationStep = ref(0)
const registrationProspect = computed(() =>
  state.prospects.find((p) => p.id === registration.prospectId),
)
const registrationClass = computed(() => state.classes.find((c) => c.id === registration.classId))
async function goToStep(value) {
  registrationStep.value = value
  clearErrors()
  await nextTick()
  registrationElement.value?.querySelector('.step-heading')?.focus()
}
function validateRegistrationPerson() {
  if (!validate(registrationSchema.pick({ prospectId: true, classId: true }), registration))
    return false
  const next = {}
  if (!registrationProspect.value || registrationProspect.value.studentId)
    next.prospectId = 'Kaydı tamamlanmamış bir aday seçin.'
  const classroom = registrationClass.value
  if (
    !classroom?.isActive ||
    !state.branches.some((b) => b.id === classroom.branchId && b.isActive)
  )
    next.classId = 'Aktif bir sınıf seçin.'
  else if (
    state.students.filter((s) => s.classId === classroom.id && s.isActive).length >=
    classroom.capacity
  )
    next.classId = 'Bu sınıfın kontenjanı dolu. Başka bir sınıf seçin.'
  return showErrors(next)
}
function validateRegistrationPlan() {
  if (
    !validate(registrationSchema.pick({ total: true, count: true, startDate: true }), registration)
  )
    return false
  const date = new Date(`${registration.startDate}T09:00:00.000Z`)
  return showErrors(
    Number.isNaN(+date) || dayKey(date) !== registration.startDate
      ? { startDate: 'Geçerli bir ödeme tarihi girin.' }
      : {},
  )
}
const route = useRoute(),
  router = useRouter(),
  page = computed(() => route.path.split('/').at(-1))
const showNew = ref(false),
  showTrial = ref(false),
  stage = remember('stage', 'all'),
  note = ref(''),
  createdRegistration = ref(null)
const stages = [
  'Yeni aday',
  'İletişime geçildi',
  'Görüşme planlandı',
  'Teklif verildi',
  'Kayıt oldu',
  'Vazgeçti',
]
const form = reactive({
  name: '',
  phone: '',
  email: '',
  branchId: 'b1',
  interest: '7. Sınıf · Ortaokul',
  source: 'Web sitesi',
})
const trial = reactive({ prospectId: '', date: '', time: '14:00' })
const registration = reactive({
  prospectId: route.query.aday || '',
  classId: 'c1',
  total: 240000,
  count: 8,
  startDate: dayKey(),
})
const prospect = computed(() => state.prospects.find((p) => p.id === route.params.id))
const rows = computed(() =>
  state.prospects
    .filter((p) => stage.value === 'all' || p.stage === stage.value)
    .map((p) => ({ ...p, branch: branchById(p.branchId).name })),
)
const trialEvents = computed(() =>
  state.prospects
    .filter((p) => p.trialAt)
    .map((p) => ({
      id: p.id,
      date: p.trialAt,
      title: p.name,
      subtitle: `${branchById(p.branchId).name} · ${p.interest}`,
    })),
)
const plan = computed(() => {
  try {
    return installmentAmounts(Number(registration.total) * 100, Number(registration.count))
  } catch {
    return []
  }
})
function openProspect() {
  prospectValidation.clear()
  showNew.value = true
}
function createProspect() {
  if (!prospectValidation.validate(prospectSchema, form)) return
  const result = action(() => {
    const data = prospectSchema.parse(form)
    const entry = {
      ...data,
      id: id('pr'),
      stage: 'Yeni aday',
      studentId: null,
      createdAt: new Date().toISOString(),
      trialAt: null,
      notes: [],
    }
    state.prospects.unshift(entry)
    return entry
  }, 'Yeni aday kaydı oluşturuldu.')
  if (result) {
    showNew.value = false
    router.push(`/onburo/aday/${result.id}`)
  }
}
function addNote() {
  if (
    action(() => {
      const text = requiredText.parse(note.value)
      prospect.value.notes.unshift({
        id: id('note'),
        text,
        date: new Date().toISOString(),
        author: 'Büşra Aydın',
      })
    }, 'Görüşme notu eklendi.')
  )
    note.value = ''
}
function changeStage(event) {
  const next = event.target.value
  if (next === 'Kayıt oldu') {
    event.target.value = prospect.value.stage
    router.push({ path: '/onburo/kayit-islemleri', query: { aday: prospect.value.id } })
    return
  }
  action(() => {
    if (prospect.value.studentId)
      throw new Error('Kesin kaydı tamamlanan adayın aşaması değiştirilemez.')
    prospect.value.stage = next
  }, 'Aday aşaması güncellendi.')
}
function scheduleTrial() {
  const result = action(() => {
    z.object({
      prospectId: requiredText,
      date: z.string().min(10, 'Tarih seçin.'),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    }).parse(trial)
    const p = state.prospects.find((p) => p.id === trial.prospectId)
    if (!p || p.studentId) throw new Error('Uygun bir aday seçin.')
    const date = new Date(`${trial.date}T${trial.time}:00+03:00`).toISOString()
    if (new Date(date) < new Date()) throw new Error('Gelecek bir tarih ve saat seçin.')
    if (
      state.prospects.some(
        (other) => other.id !== p.id && other.branchId === p.branchId && other.trialAt === date,
      )
    )
      throw new Error('Bu şubede seçili saatte başka bir tanışma görüşmesi var.')
    p.trialAt = date
    p.stage = 'Görüşme planlandı'
  }, 'Tanışma görüşmesi planlandı.')
  if (result) showTrial.value = false
}
function register() {
  if (registrationStep.value === 0) {
    if (validateRegistrationPerson()) goToStep(1)
    return
  }
  if (registrationStep.value === 1) {
    if (validateRegistrationPlan()) goToStep(2)
    return
  }
  if (!validateRegistrationPerson()) {
    registrationStep.value = 0
    return
  }
  if (!validateRegistrationPlan()) {
    registrationStep.value = 1
    return
  }
  const result = action(
    () => enrollProspect(state, registrationSchema.parse(registration), id),
    'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.',
  )
  if (result) createdRegistration.value = result
}
function contractPdf() {
  const { student, contract } = createdRegistration.value
  previewPdf('contract', contract.id, `sozlesme-${student.id}.pdf`)
}
function openTrial() {
  if (prospect.value) trial.prospectId = prospect.value.id
  showTrial.value = true
}
</script>
<template>
  <PageHeading :title="prospect ? prospect.name : ''"
    ><button v-if="page === 'adaylar'" class="btn btn-primary btn-create" @click="openProspect">
      <Icon name="Plus" :size="18" />Yeni aday ekle</button
    ><button
      v-if="page === 'deneme-dersi-takvimi' || prospect"
      class="btn btn-primary btn-create"
      :disabled="!!prospect?.studentId"
      @click="openTrial"
    >
      <Icon name="CalendarDays" :size="17" />Tanışma görüşmesi planla
    </button></PageHeading
  >
  <template v-if="route.params.id"
    ><template v-if="prospect"
      ><RouterLink to="/onburo/adaylar" class="text-link back-link"
        ><Icon name="ArrowLeft" :size="16" />Aday listesine dön</RouterLink
      >
      <div class="detail-grid">
        <aside class="panel profile-card">
          <Avatar :name="prospect.name" size="large" />
          <h2>{{ prospect.name }}</h2>
          <Badge :text="prospect.stage" />
          <div class="contact-lines">
            <p><Icon name="Phone" :size="17" />{{ prospect.phone }}</p>
            <p><Icon name="Mail" :size="17" />{{ prospect.email }}</p>
            <p><Icon name="Building2" :size="17" />{{ branchById(prospect.branchId).name }}</p>
            <p><Icon name="BookOpen" :size="17" />{{ prospect.interest }}</p>
          </div>
          <label class="field-label"
            >Kayıt aşaması<select
              :value="prospect.stage"
              :disabled="!!prospect.studentId"
              @change="changeStage"
            >
              <option v-for="s in stages" :key="s">{{ s }}</option>
            </select></label
          ><RouterLink
            v-if="!prospect.studentId"
            :to="`/onburo/kayit-islemleri?aday=${prospect.id}`"
            class="btn btn-primary"
            >Kesin kayda dönüştür<Icon name="ArrowRight" :size="16"
          /></RouterLink>
        </aside>
        <div class="stack">
          <section class="panel">
            <div class="panel-heading">
              <div>
                <h2>Görüşme notu ekle</h2>
                <p>Her ayrıntı, daha iyi bir iletişim.</p>
              </div>
            </div>
            <form novalidate class="padded-form" @submit.prevent="addNote">
              <label class="field-label"
                >Görüşme notu<textarea
                  v-model="note"
                  rows="3"
                  placeholder="Görüşmenin önemli noktalarını yazın..."
                  maxlength="2000"
                ></textarea></label
              ><button class="btn btn-primary" type="submit">
                <Icon name="Plus" :size="16" />Notu kaydet
              </button>
            </form>
          </section>
          <section class="panel">
            <div class="panel-heading">
              <h2>İletişim geçmişi</h2>
              <Badge :text="`${prospect.notes.length} görüşme`" />
            </div>
            <div class="timeline">
              <article v-for="n in prospect.notes" :key="n.id">
                <span class="timeline-dot"></span>
                <div>
                  <small
                    >{{
                      dateLabel(n.date, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    }}
                    · {{ n.author }}</small
                  >
                  <p>{{ n.text }}</p>
                </div>
              </article>
              <article>
                <span class="timeline-dot"></span>
                <div>
                  <small>{{ dateLabel(prospect.createdAt) }}</small>
                  <p>{{ prospect.source }} üzerinden aday kaydı oluşturuldu.</p>
                </div>
              </article>
            </div>
          </section>
          <section v-if="prospect.trialAt" class="panel trial-summary">
            <span class="mini-icon mint"><Icon name="CalendarCheck2" :size="24" /></span>
            <div>
              <h3>Tanışma görüşmesiniz planlandı</h3>
              <p>
                {{
                  dateLabel(prospect.trialAt, {
                    weekday: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }}
                · {{ branchById(prospect.branchId).name }}
              </p>
            </div>
          </section>
        </div>
      </div></template
    >
    <div v-else class="panel empty-page">
      <h2>Aday bulunamadı.</h2>
      <RouterLink class="btn" to="/onburo/adaylar">Aday listesine dön</RouterLink>
    </div></template
  >
  <section v-else-if="page === 'adaylar'" class="panel">
    <LineTabs
      v-model="stage"
      label="Aday aşaması"
      :options="[
        { value: 'all', label: 'Tüm adaylar', count: state.prospects.length },
        ...stages.map((stage) => ({
          value: stage,
          label: stage,
          count: state.prospects.filter((prospect) => prospect.stage === stage).length,
        })),
      ]"
    />
    <DataTable
      list-key="crm-datatable-1"
      :rows="rows"
      :filter-key="stage"
      :external-active="stage !== 'all'"
      :exclude-filters="['stage']"
      :filters="[
        { key: 'createdAt', label: 'Kayıt tarihi', type: 'date' },
        { key: 'trialAt', label: 'Görüşme tarihi', type: 'date' },
      ]"
      :columns="[
        { key: 'name', label: 'Aday öğrenci' },
        { key: 'interest', label: 'İlgilendiği program' },
        { key: 'branch', label: 'Şube' },
        { key: 'source', label: 'Kaynak' },
        { key: 'stage', label: 'Aşama' },
        { key: 'actions', label: '' },
      ]"
      @reset="stage = 'all'"
      ><template #name="{ row }"
        ><div class="person-cell">
          <Avatar :name="row.name" size="small" />
          <div>
            <RouterLink :to="`/onburo/aday/${row.id}`"
              ><strong>{{ row.name }}</strong></RouterLink
            ><small>{{ row.phone }}</small>
          </div>
        </div></template
      ><template #stage="{ value }"><Badge :text="value" /></template
      ><template #actions="{ row }"
        ><RouterLink
          :to="`/onburo/aday/${row.id}`"
          class="icon-button"
          :aria-label="`${row.name} detayını aç`"
          ><Icon name="ArrowUpRight" :size="18" /></RouterLink></template
    ></DataTable>
  </section>
  <section v-else-if="page === 'deneme-dersi-takvimi'" class="panel">
    <WeekCalendar :events="trialEvents" @select="router.push(`/onburo/aday/${$event.id}`)" />
  </section>
  <template v-else-if="page === 'kayit-islemleri'"
    ><div v-if="createdRegistration" class="panel registration-success">
      <span class="result-icon success"><Icon name="CircleCheck" :size="46" /></span>
      <h2>{{ createdRegistration.student.name }}, aramıza hoş geldin!</h2>
      <p>Öğrenci kaydı, sözleşmesi ve taksitleri tüm ilgili panellere yansıdı.</p>
      <div class="button-row">
        <button
          class="btn btn-primary"
          :disabled="pendingDocuments.has(`contract:${createdRegistration.contract.id}`)"
          @click="contractPdf"
        >
          <Icon name="Download" :size="17" />Sözleşmeyi görüntüle</button
        ><RouterLink to="/onburo/tahsilat-takip" class="btn">Ödeme planını görüntüle</RouterLink
        ><button
          class="btn"
          @click="
            () => {
              createdRegistration = null
              registrationStep = 0
              clearErrors()
              registration.prospectId = ''
            }
          "
        >
          Yeni kayıt
        </button>
      </div>
    </div>
    <div v-else class="registration-grid">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Öğrenci kayıt bilgileri</h2>
            <p>Öğrenci bilgileri, ödeme planı ve son kontrol.</p>
          </div>
          <span class="mini-icon lavender"><Icon name="UserRoundPlus" /></span>
        </div>
        <form
          ref="registrationElement"
          novalidate
          class="form-grid padded-form"
          @submit.prevent="register"
        >
          <FormSteps
            class="full"
            :steps="['Öğrenci ve sınıf', 'Ödeme planı', 'Kontrol']"
            :current="registrationStep"
            @back="goToStep"
          />
          <h3 class="step-heading full" tabindex="-1">
            {{
              [
                'Öğrenci ve sınıf seçimi',
                'Eğitim bedeli ve taksitler',
                'Kaydı tamamlamadan önce kontrol edin',
              ][registrationStep]
            }}
          </h3>
          <p v-if="registrationStep < 2" class="form-hint full">
            Bu adımdaki tüm alanlar zorunludur.
          </p>
          <template v-if="registrationStep === 0">
            <label class="full"
              >Aday öğrenci<select
                v-model="registration.prospectId"
                v-bind="field('prospectId', 'Aday öğrenci')"
              >
                <option value="" disabled>Aday seçin</option>
                <option
                  v-for="candidate in state.prospects.filter((p) => !p.studentId)"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.name }} · {{ candidate.interest }}
                </option></select
              ><small v-if="errors.prospectId" :id="errorId('prospectId')" class="field-error">{{
                errors.prospectId
              }}</small></label
            >
            <label class="full"
              >Sınıf<select v-model="registration.classId" v-bind="field('classId', 'Sınıf')">
                <option
                  v-for="classroom in state.classes.filter((c) => c.isActive)"
                  :key="classroom.id"
                  :value="classroom.id"
                >
                  {{ branchById(classroom.branchId).name }} · {{ classroom.name }} ({{
                    state.students.filter((s) => s.classId === classroom.id && s.isActive).length
                  }}/{{ classroom.capacity }})
                </option></select
              ><small v-if="errors.classId" :id="errorId('classId')" class="field-error">{{
                errors.classId
              }}</small></label
            >
          </template>
          <template v-if="registrationStep === 1">
            <label
              >Toplam eğitim bedeli (₺)<input
                v-model="registration.total"
                v-bind="field('total', 'Toplam eğitim bedeli (₺)')"
                type="number"
                min="100"
                max="1000000"
                step="1"
              /><small v-if="errors.total" :id="errorId('total')" class="field-error">{{
                errors.total
              }}</small></label
            >
            <label
              >Taksit sayısı<select
                v-model="registration.count"
                v-bind="field('count', 'Taksit sayısı')"
              >
                <option v-for="n in 12" :key="n" :value="n">{{ n }} taksit</option></select
              ><small v-if="errors.count" :id="errorId('count')" class="field-error">{{
                errors.count
              }}</small></label
            >
            <label class="full"
              >İlk taksit tarihi<input
                v-model="registration.startDate"
                v-bind="field('startDate', 'İlk taksit tarihi')"
                type="date"
              /><small v-if="errors.startDate" :id="errorId('startDate')" class="field-error">{{
                errors.startDate
              }}</small></label
            >
          </template>
          <template v-if="registrationStep === 2">
            <dl class="review-grid full">
              <div>
                <dt>Öğrenci</dt>
                <dd>{{ registrationProspect?.name }}</dd>
              </div>
              <div>
                <dt>Sınıf / Kampüs</dt>
                <dd>
                  {{ registrationClass?.name }} ·
                  {{ branchById(registrationClass?.branchId)?.name }}
                </dd>
              </div>
              <div>
                <dt>Eğitim bedeli</dt>
                <dd>{{ money(Number(registration.total) * 100) }}</dd>
              </div>
              <div>
                <dt>Ödeme planı</dt>
                <dd>
                  {{ registration.count }} taksit · İlk ödeme
                  {{ dateLabel(registration.startDate, { year: 'numeric' }) }}
                </dd>
              </div>
            </dl>
            <div class="info-box full">
              <Icon name="FileText" :size="20" />Kaydı tamamladığınızda öğrenci, sözleşme ve taksit
              planı birlikte oluşturulur.
            </div>
          </template>
          <div class="modal-actions full">
            <button
              v-if="registrationStep > 0"
              type="button"
              class="btn"
              @click="goToStep(registrationStep - 1)"
            >
              Geri
            </button>
            <button type="submit" class="btn btn-primary">
              {{ registrationStep < 2 ? 'Devam et' : 'Kaydı tamamla'
              }}<Icon name="ArrowRight" :size="18" />
            </button>
          </div>
        </form>
      </section>
      <section v-if="registrationStep > 0" class="panel payment-summary">
        <span class="eyebrow">ÖDEME PLANI ÖNİZLEMESİ</span>
        <h2>{{ money(Number(registration.total) * 100) }}</h2>
        <p>{{ registration.count }} eşit taksit</p>
        <hr />
        <div v-for="(amount, i) in plan" :key="i">
          <span>{{ i + 1 }}. taksit</span><strong>{{ money(amount) }}</strong>
        </div>
        <p class="muted">
          Kuruş farkı ilk taksitlere dağıtılır. Ay sonu tarihleri ilgili ayın son gününe ayarlanır.
        </p>
      </section>
    </div></template
  >
  <Modal v-if="showNew" drawer title="Yeni aday öğrenci" @close="showNew = false"
    ><form ref="prospectElement" novalidate class="form-grid" @submit.prevent="createProspect">
      <label class="full"
        >Ad soyad<input
          v-model="form.name"
          v-bind="prospectValidation.field('name', 'Ad soyad')"
          maxlength="80"
        /><small
          v-if="prospectValidation.errors.value.name"
          :id="prospectValidation.errorId('name')"
          class="field-error"
          >{{ prospectValidation.errors.value.name }}</small
        ></label
      ><label
        >Telefon<input
          v-model="form.phone"
          v-bind="prospectValidation.field('phone', 'Telefon')"
          placeholder="05XXXXXXXXX"
          inputmode="tel"
          maxlength="11"
        /><small
          v-if="prospectValidation.errors.value.phone"
          :id="prospectValidation.errorId('phone')"
          class="field-error"
          >{{ prospectValidation.errors.value.phone }}</small
        ></label
      ><label
        >E-posta<input
          v-model="form.email"
          v-bind="prospectValidation.field('email', 'E-posta')"
          type="email"
          placeholder="ornek@eposta.com"
        /><small
          v-if="prospectValidation.errors.value.email"
          :id="prospectValidation.errorId('email')"
          class="field-error"
          >{{ prospectValidation.errors.value.email }}</small
        ></label
      ><label
        >Şube<select v-model="form.branchId" v-bind="prospectValidation.field('branchId', 'Şube')">
          <option v-for="b in state.branches.filter((b) => b.isActive)" :key="b.id" :value="b.id">
            {{ b.name }}
          </option></select
        ><small
          v-if="prospectValidation.errors.value.branchId"
          :id="prospectValidation.errorId('branchId')"
          class="field-error"
          >{{ prospectValidation.errors.value.branchId }}</small
        ></label
      ><label
        >Program<select
          v-model="form.interest"
          v-bind="prospectValidation.field('interest', 'Program')"
        >
          <option v-for="grade in 8" :key="grade">
            {{ grade + 4 }}. Sınıf · {{ grade + 4 < 9 ? 'Ortaokul' : 'Anadolu Lisesi' }}
          </option></select
        ><small
          v-if="prospectValidation.errors.value.interest"
          :id="prospectValidation.errorId('interest')"
          class="field-error"
          >{{ prospectValidation.errors.value.interest }}</small
        ></label
      ><label class="full"
        >Başvuru kaynağı<select
          v-model="form.source"
          v-bind="prospectValidation.field('source', 'Başvuru kaynağı')"
        >
          <option>Web sitesi</option>
          <option>Referans</option>
          <option>Instagram</option>
          <option>Telefon</option>
          <option>Şube ziyareti</option></select
        ><small
          v-if="prospectValidation.errors.value.source"
          :id="prospectValidation.errorId('source')"
          class="field-error"
          >{{ prospectValidation.errors.value.source }}</small
        ></label
      ><button class="btn btn-primary full" type="submit">Adayı kaydet</button>
    </form></Modal
  >
  <Modal v-if="showTrial" drawer title="Tanışma görüşmesi planla" @close="showTrial = false"
    ><form novalidate class="form-grid" @submit.prevent="scheduleTrial">
      <label class="full"
        >Aday<select v-model="trial.prospectId">
          <option value="" disabled>Aday seçin</option>
          <option
            v-for="p in state.prospects.filter((p) => !p.studentId)"
            :key="p.id"
            :value="p.id"
          >
            {{ p.name }}
          </option>
        </select></label
      ><label>Tarih<input v-model="trial.date" type="date" :min="dayKey()" /></label
      ><label>Saat<input v-model="trial.time" type="time" /></label
      ><button class="btn btn-primary full" type="submit">Tanışma görüşmesini kaydet</button>
    </form></Modal
  >
</template>
