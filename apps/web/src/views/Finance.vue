<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  state,
  role,
  currentStudent,
  studentById,
  classById,
  branchById,
  action,
  notify,
} from '../stores/demo.js'
import { money, dateLabel, sum, invoiceStatus } from '../lib/format.js'
import { payInvoice } from '../lib/payments.js'
import { previewPdf, exportCsv, pendingDocuments } from '../lib/download.js'
import PageHeading from '../components/PageHeading.vue'
import StatCard from '../components/StatCard.vue'
import DataTable from '../components/DataTable.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import { useDetailPanel } from '../lib/use-detail-panel.js'
const invoicePanel = useDetailPanel('detay')
import { z } from 'zod'
import { useFormErrors } from '../lib/use-form-errors.js'
const remember = useViewMemory()
const paymentElement = ref(null)
const { errors, field, errorId, validate } = useFormErrors(paymentElement)
const paymentSchema = z.object({
  cardholder: z.string().trim().min(3, 'Kart üzerindeki ad için en az 3 karakter girin.').max(80),
  consent: z.literal(true, 'Demo işlem bilgilendirmesini onaylayın.'),
})
const route = useRoute(),
  router = useRouter(),
  page = computed(() => route.path.split('/').at(-1))
const isInstitution = computed(() => ['yonetici', 'onburo'].includes(role.value))
const table = ref(null)
const status = remember('status', 'all'),
  selectedInvoice = ref(typeof route.query.taksit === 'string' ? route.query.taksit : ''),
  paymentStep = ref(1),
  paidInvoice = ref(null),
  paymentBusy = ref(false),
  collect = ref(null)
const payment = reactive({ cardholder: '', result: 'success', consent: false }),
  method = ref('Banka havalesi')
const invoices = computed(() =>
  state.invoices.filter((i) => isInstitution.value || i.studentId === currentStudent.value.id),
)
const detailInvoice = computed(() =>
  invoices.value.find((invoice) => invoice.id === invoicePanel.selectedId.value),
)
const unpaid = computed(() =>
  invoices.value.filter((i) => !i.paidAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
)
const rows = computed(() =>
  invoices.value
    .map((i) => ({
      ...i,
      studentName: studentById(i.studentId)?.name,
      studentNumber: studentById(i.studentId)?.number,
      class: classById(studentById(i.studentId)?.classId)?.name,
      status: invoiceStatus(i),
      branch: branchById(classById(studentById(i.studentId)?.classId)?.branchId)?.name,
    }))
    .filter(
      (i) =>
        (status.value === 'all' || i.status === status.value) &&
        (page.value !== 'dekontlar' || i.paidAt),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
)
const columns = computed(() => [
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'installment', label: 'Taksit' },
  { key: 'dueDate', label: 'Vade tarihi' },
  { key: 'amount', label: 'Tutar' },
  { key: 'status', label: 'Durum' },
  { key: 'actions', label: '' },
])
const currentInvoice = computed(
  () => unpaid.value.find((i) => i.id === selectedInvoice.value) || unpaid.value[0],
)
function receipt(invoice) {
  previewPdf('receipt', invoice.id, `dekont-${invoice.id}.pdf`)
}
function remind(invoice) {
  action(() => {
    invoice.reminderAt = new Date().toISOString()
    const original = state.invoices.find((i) => i.id === invoice.id)
    original.reminderAt = invoice.reminderAt
  }, 'Hatırlatma demo geçmişine kaydedildi; gerçek mesaj gönderilmedi.')
}
function startPayment() {
  if (!currentInvoice.value) return
  if (!validate(paymentSchema, payment)) return
  selectedInvoice.value = currentInvoice.value.id
  paymentStep.value = 2
}
async function completePayment() {
  if (paymentBusy.value) return
  paymentBusy.value = true
  await new Promise((resolve) => setTimeout(resolve, 600))
  if (payment.result === 'failure') {
    paymentStep.value = 1
    paymentBusy.value = false
    notify('Demo banka işlemi reddetti. Ödeme kaydedilmedi; yeniden deneyebilirsiniz.', 'error')
    return
  }
  const result = action(() => {
    const invoice = state.invoices.find(
      (i) => i.id === selectedInvoice.value && i.studentId === currentStudent.value.id,
    )
    if (!invoice) throw new Error('Seçili öğrenciye ait ödeme bulunamadı.')
    return payInvoice(state, invoice.id, 'Demo Sanal POS')
  }, 'Demo ödeme başarıyla tamamlandı.')
  paymentBusy.value = false
  if (result) {
    paidInvoice.value = result
    paymentStep.value = 3
  }
}
function collectPayment() {
  if (action(() => payInvoice(state, collect.value.id, method.value), 'Tahsilat kaydedildi.'))
    collect.value = null
}
</script>
<template>
  <PageHeading
    ><button
      v-if="page !== 'odeme-yap' && page !== 'sozlesmeler'"
      class="btn"
      @click="
        () => {
          exportCsv(
            'finans-raporu',
            columns.filter((c) => c.key !== 'actions'),
            (table?.filteredRows || rows).map((r) => ({
              ...r,
              amount: money(r.amount),
              dueDate: dateLabel(r.dueDate, { year: 'numeric' }),
            })),
          )
        }
      "
    >
      <Icon name="Download" :size="17" />Raporu indir</button
    ><RouterLink
      v-if="role === 'veli' && page === 'finans'"
      to="/veli/odeme-yap"
      class="btn btn-primary"
      ><Icon name="CreditCard" :size="17" />Ödeme yap</RouterLink
    ></PageHeading
  >
  <template v-if="page === 'odeme-yap'"
    ><div class="payment-layout">
      <section class="panel payment-form">
        <div class="stepper">
          <span
            v-for="(text, i) in ['Ödeme bilgileri', 'Demo banka onayı', 'Sonuç']"
            :key="text"
            :class="{ active: paymentStep >= i + 1 }"
            ><i>{{ i + 1 }}</i
            >{{ text }}</span
          >
        </div>
        <form
          v-if="paymentStep === 1 && unpaid.length"
          ref="paymentElement"
          class="form-grid"
          @submit.prevent="startPayment"
        >
          <div class="info-box full">
            <Icon name="ShieldCheck" />Demo ödeme ekranıdır. Gerçek kart bilgisi girmeyin. Para
            çekilmez.
          </div>
          <label class="full"
            >Ödenecek taksit<select v-model="selectedInvoice">
              <option value="" disabled>Taksit seçin</option>
              <option v-for="i in unpaid" :key="i.id" :value="i.id">
                {{ i.installment }}. taksit · {{ dateLabel(i.dueDate) }} · {{ money(i.amount) }}
              </option></select
            ><small>Seçilmezse vadesi en erken taksit kullanılır.</small></label
          ><label class="full"
            >Kart üzerindeki ad<input
              v-model="payment.cardholder"
              v-bind="field('cardholder', 'Kart üzerindeki ad')"
              placeholder="Örn. Ayşe Yılmaz"
              maxlength="80"
            /><small v-if="errors.cardholder" :id="errorId('cardholder')" class="field-error">{{
              errors.cardholder
            }}</small></label
          ><label class="full"
            >Demo kart numarası<input value="4500 0000 0000 0000" readonly /></label
          ><label>Son kullanma<input value="12/30" readonly /></label
          ><label>Güvenlik kodu<input value="000" readonly /></label
          ><label class="full"
            >Banka yanıtı<select v-model="payment.result">
              <option value="success">Başarılı ödeme senaryosu</option>
              <option value="failure">Reddedilen ödeme senaryosu</option>
            </select></label
          ><label class="checkbox-label full"
            ><input
              v-model="payment.consent"
              v-bind="
                field(
                  'consent',
                  'Bu işlemin bir demo olduğunu ve gerçek ödeme yapılmayacağını anladım.',
                )
              "
              type="checkbox"
            />Bu işlemin bir demo olduğunu ve gerçek ödeme yapılmayacağını anladım.</label
          ><small v-if="errors.consent" :id="errorId('consent')" class="field-error full">{{
            errors.consent
          }}</small
          ><button class="btn btn-primary full" type="submit">
            {{ money(currentInvoice?.amount) }} · Ödemeye devam et<Icon
              name="ArrowRight"
              :size="17"
            />
          </button>
        </form>
        <div v-else-if="paymentStep === 2" class="payment-result">
          <span class="result-icon"><Icon name="ShieldCheck" :size="42" /></span>
          <h2>Demo banka doğrulaması</h2>
          <p>
            {{ currentStudent.name }} adına {{ money(currentInvoice?.amount) }} tutarındaki demo
            işlemini onaylıyorsunuz.
          </p>
          <p class="muted">Bu ekran 3D Secure adımını simüle eder.</p>
          <button class="btn btn-primary" :disabled="paymentBusy" @click="completePayment">
            {{ paymentBusy ? 'İşleniyor…' : 'Demo işlemini onayla' }}</button
          ><button class="btn" :disabled="paymentBusy" @click="paymentStep = 1">Geri dön</button>
        </div>
        <div v-else-if="paymentStep === 3" class="payment-result">
          <span class="result-icon success"><Icon name="CircleCheck" :size="44" /></span>
          <h2>Ödemeniz tamamlandı.</h2>
          <p>{{ money(paidInvoice.amount) }} tutarındaki taksit ödendi olarak işaretlendi.</p>
          <button
            class="btn btn-primary"
            :disabled="pendingDocuments.has(`receipt:${paidInvoice.id}`)"
            @click="receipt(paidInvoice)"
          >
            <Icon name="Download" :size="17" />Dekontu görüntüle</button
          ><button class="btn" @click="router.push('/veli/finans')">Ödeme planına dön</button>
        </div>
        <div v-else class="payment-result">
          <Icon name="CircleCheck" :size="48" />
          <h2>Tüm taksitler ödenmiş.</h2>
          <p>Güncel borcunuz bulunmuyor.</p>
        </div>
      </section>
      <aside class="panel payment-summary">
        <span class="eyebrow">ÖDEME ÖZETİ</span><Avatar :name="currentStudent.name" size="large" />
        <h2>{{ currentStudent.name }}</h2>
        <p>{{ classById(currentStudent.classId).name }}</p>
        <hr />
        <div>
          <span>Seçili taksit</span><strong>{{ currentInvoice?.installment || '—' }}</strong>
        </div>
        <div>
          <span>Ödeme tutarı</span><strong>{{ money(currentInvoice?.amount) }}</strong>
        </div>
        <div><span>İşlem ücreti</span><strong>0,00 ₺</strong></div>
        <hr />
        <div>
          <span>Toplam</span
          ><strong class="text-purple">{{ money(currentInvoice?.amount) }}</strong>
        </div>
        <p class="payment-security">
          <Icon name="ShieldCheck" :size="16" />Sadece demo bakiyesi güncellenir.
        </p>
      </aside>
    </div></template
  >
  <template v-else-if="page === 'sozlesmeler'"
    ><div class="three-grid">
      <article
        v-for="contract in state.contracts.filter((c) => c.studentId === currentStudent.id)"
        :key="contract.id"
        class="panel document-card"
      >
        <span class="mini-icon lavender"><Icon name="FileText" :size="28" /></span
        ><Badge text="İmzalı örnek" tone="green" />
        <h2>{{ contract.title }}</h2>
        <p>{{ currentStudent.name }} · {{ dateLabel(contract.date, { year: 'numeric' }) }}</p>
        <p>
          Eğitim bedeli: <strong>{{ money(contract.amount) }}</strong>
        </p>
        <button
          class="btn"
          :disabled="pendingDocuments.has(`contract:${contract.id}`)"
          @click="
            () => {
              previewPdf('contract', contract.id, `sozlesme-${contract.id}.pdf`)
            }
          "
        >
          <Icon name="Download" :size="17" />Sözleşmeyi görüntüle
        </button>
      </article>
      <article class="panel document-card">
        <span class="mini-icon mint"><Icon name="ReceiptText" :size="28" /></span>
        <h2>Taksit taahhütnamesi</h2>
        <p>Öğrencinin güncel ödeme planı belgesi.</p>
        <button
          class="btn"
          :disabled="pendingDocuments.has(`payment-plan:${currentStudent.id}`)"
          @click="
            () => {
              previewPdf('payment-plan', currentStudent.id, `taksit-plani-${currentStudent.id}.pdf`)
            }
          "
        >
          <Icon name="Download" :size="17" />Ödeme belgesini görüntüle
        </button>
      </article>
    </div></template
  >
  <template v-else
    ><div class="stats-grid">
      <StatCard
        label="Toplam eğitim bedeli"
        :value="money(sum(invoices, 'amount'))"
        icon="Wallet"
        note="Tüm ödeme planları"
      /><StatCard
        label="Tahsil edilen"
        :value="
          money(
            sum(
              invoices.filter((i) => i.paidAt),
              'amount',
            ),
          )
        "
        icon="CircleCheck"
        tone="green"
      /><StatCard
        label="Kalan bakiye"
        :value="money(sum(unpaid, 'amount'))"
        icon="ReceiptText"
        tone="blue"
        note="Gelecek ve gecikmiş taksitler"
      /><StatCard
        label="Gecikmiş tutar"
        :value="
          money(
            sum(
              invoices.filter((i) => invoiceStatus(i) === 'Gecikmiş'),
              'amount',
            ),
          )
        "
        icon="Timer"
        tone="amber"
      />
    </div>
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>{{ page === 'dekontlar' ? 'Ödeme dekontları' : 'Taksit ve tahsilat listesi' }}</h2>
          <p>
            {{
              isInstitution
                ? 'Kurum genelinde ödeme hareketleri'
                : `${currentStudent.name} · Güncel ödeme planı`
            }}
          </p>
        </div>
        <Badge v-if="role === 'ogrenci'" text="Salt okunur" tone="gray" />
      </div>
      <DataTable
        ref="table"
        list-key="finance-datatable-1"
        :rows="rows"
        :columns="columns"
        :search-keys="['studentNumber', 'class']"
        :mobile-columns="['installment', 'dueDate', 'amount', 'status']"
        :filter-key="status"
        :external-active="status !== 'all'"
        :external-label="`Ödeme durumu: ${status}`"
        :exclude-filters="['status']"
        :filters="[
          ...(isInstitution
            ? [
                { key: 'branch', label: 'Kampüs' },
                { key: 'class', label: 'Sınıf' },
              ]
            : []),
          { key: 'method', label: 'Ödeme yöntemi' },
          { key: 'paidAt', label: 'Tahsilat tarihi', type: 'date' },
        ]"
        @reset="status = 'all'"
        ><template #presets>
          <div
            v-if="page !== 'dekontlar'"
            class="quick-filters"
            aria-label="Hazır ödeme filtreleri"
          >
            <button
              v-for="preset in [
                { value: 'all', label: 'Tüm ödemeler' },
                { value: 'Gecikmiş', label: 'Geciken ödemeler' },
                { value: 'Yaklaşan', label: 'Yaklaşan taksitler' },
                { value: 'Ödendi', label: 'Ödenenler' },
              ]"
              :key="preset.value"
              type="button"
              class="filter-chip"
              :aria-pressed="status === preset.value"
              @click="status = preset.value"
            >
              {{ preset.label }}
            </button>
          </div> </template
        ><template #filters
          ><select v-model="status" aria-label="Ödeme durumu">
            <option value="all">Tüm durumlar</option>
            <option>Ödendi</option>
            <option>Gecikmiş</option>
            <option>Yaklaşan</option>
          </select></template
        ><template #studentName="{ row }"
          ><div class="person-cell">
            <Avatar :name="row.studentName" size="small" />
            <div>
              <strong>{{ row.studentName }}</strong
              ><small>{{ row.class }} · No: {{ row.studentNumber }}</small>
            </div>
          </div></template
        ><template #installment="{ row, value }"
          ><button
            class="text-link record-link"
            :aria-label="`${row.studentName} ${value}. taksit detayını aç`"
            @click="invoicePanel.open(row.id)"
          >
            {{ value }}. taksit
          </button></template
        ><template #dueDate="{ value }">{{ dateLabel(value, { year: 'numeric' }) }}</template
        ><template #amount="{ value }"
          ><strong>{{ money(value) }}</strong></template
        ><template #status="{ value }"><Badge :text="value" /></template
        ><template #actions="{ row }"
          ><div class="button-row">
            <button
              v-if="row.paidAt"
              class="btn btn-sm"
              :disabled="pendingDocuments.has(`receipt:${row.id}`)"
              @click="receipt(row)"
            >
              <Icon name="Download" :size="14" />Dekont</button
            ><template v-else-if="isInstitution"
              ><button class="btn btn-sm" @click="remind(row)">
                <Icon name="Bell" :size="14" />{{
                  row.reminderAt ? 'Hatırlatıldı' : 'Hatırlat'
                }}</button
              ><button class="btn btn-sm btn-primary" @click="collect = row">
                Tahsil et
              </button></template
            ><RouterLink
              v-else-if="role === 'veli'"
              class="text-link"
              :to="{ path: '/veli/odeme-yap', query: { taksit: row.id } }"
              >Öde<Icon name="ArrowRight" :size="14"
            /></RouterLink></div></template
      ></DataTable></section
  ></template>
  <Modal
    v-if="invoicePanel.selectedId.value && !['odeme-yap', 'sozlesmeler'].includes(page)"
    drawer
    title="Taksit detayı"
    @close="invoicePanel.close"
  >
    <template v-if="detailInvoice">
      <div class="detail-person">
        <Avatar :name="studentById(detailInvoice.studentId)?.name" />
        <div>
          <h3>{{ studentById(detailInvoice.studentId)?.name }}</h3>
          <p>
            {{ classById(studentById(detailInvoice.studentId)?.classId)?.name }} ·
            {{ detailInvoice.installment }}. taksit
          </p>
        </div>
      </div>
      <dl class="detail-metrics">
        <div>
          <dt>Taksit tutarı</dt>
          <dd>{{ money(detailInvoice.amount) }}</dd>
        </div>
        <div>
          <dt>Durum</dt>
          <dd><Badge :text="invoiceStatus(detailInvoice)" /></dd>
        </div>
      </dl>
      <dl class="detail-facts">
        <div>
          <dt>Vade tarihi</dt>
          <dd>{{ dateLabel(detailInvoice.dueDate, { year: 'numeric' }) }}</dd>
        </div>
        <div>
          <dt>Tahsilat tarihi</dt>
          <dd>
            {{
              detailInvoice.paidAt
                ? dateLabel(detailInvoice.paidAt, { year: 'numeric' })
                : 'Henüz tahsil edilmedi'
            }}
          </dd>
        </div>
        <div>
          <dt>Ödeme yöntemi</dt>
          <dd>{{ detailInvoice.paidAt ? detailInvoice.method : '—' }}</dd>
        </div>
        <div>
          <dt>Kayıt numarası</dt>
          <dd>{{ detailInvoice.id.toUpperCase() }}</dd>
        </div>
        <div v-if="detailInvoice.reminderAt">
          <dt>Son hatırlatma</dt>
          <dd>{{ dateLabel(detailInvoice.reminderAt, { year: 'numeric' }) }}</dd>
        </div>
      </dl>
      <div class="button-row detail-actions">
        <button
          v-if="detailInvoice.paidAt"
          class="btn"
          :disabled="pendingDocuments.has(`receipt:${detailInvoice.id}`)"
          @click="receipt(detailInvoice)"
        >
          <Icon name="FileText" :size="17" />Dekontu görüntüle
        </button>
        <template v-else-if="isInstitution"
          ><button class="btn" @click="remind(detailInvoice)">Hatırlatma gönder</button
          ><button
            class="btn btn-primary"
            @click="
              collect = {
                ...detailInvoice,
                studentName: studentById(detailInvoice.studentId)?.name,
              }
            "
          >
            Tahsil et
          </button></template
        >
        <RouterLink
          v-else-if="role === 'veli'"
          class="btn btn-primary"
          :to="{ path: '/veli/odeme-yap', query: { taksit: detailInvoice.id } }"
          >Ödeme yap</RouterLink
        >
      </div>
      <p v-if="role === 'ogrenci'" class="muted">Ödeme planını bu ekrandan takip edebilirsiniz.</p>
    </template>
    <p v-else class="muted">Görüntüleyebileceğiniz bir taksit kaydı bulunamadı.</p>
  </Modal>
  <Modal v-if="collect" drawer title="Tahsilat kaydet" @close="collect = null"
    ><form novalidate class="form-grid" @submit.prevent="collectPayment">
      <div class="info-box full">
        {{ collect.studentName }} · {{ collect.installment }}. taksit · {{ money(collect.amount) }}
      </div>
      <label class="full"
        >Ödeme yöntemi<select v-model="method">
          <option>Banka havalesi</option>
          <option>Nakit</option>
          <option>Kredi kartı</option>
        </select></label
      >
      <p class="full muted">Bu işlem demo tahsilat kaydı oluşturur ve ödeme planını günceller.</p>
      <button class="btn btn-primary full" type="submit">Tahsilatı kaydet</button>
    </form></Modal
  >
</template>
