<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed, reactive, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { z } from 'zod'
import {
  state,
  role,
  currentStudent,
  teacherId,
  studentById,
  classById,
  assignmentsForClass,
  teacherById,
  action,
  id,
} from '../stores/demo.js'
import { dayKey, dateLabel, timeLabel } from '../lib/format.js'
import { requiredText } from '../lib/domain.js'
import { tutorConflict } from '@kampus/school-core/lib/tutor-conflicts.ts'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import LineTabs from '../components/LineTabs.vue'
import CollectionList from '../components/CollectionList.vue'
const remember = useViewMemory()
const route = useRoute(),
  page = computed(() => route.path.split('/').at(-1)),
  tab = remember('tab', 'appointments'),
  modal = ref(''),
  message = ref(''),
  selectedConversation = ref(''),
  messagesEl = ref(null),
  selectedRequest = ref(null),
  announcementFilter = remember('announcementFilter', 'all')
const recipientId = ref('t1')
const recipients = computed(() =>
  assignmentsForClass(currentStudent.value.classId).map((a) => teacherById(a.teacherId)),
)
watch(
  recipients,
  (list) => {
    if (!list.some((t) => t.id === recipientId.value)) recipientId.value = list[0]?.id || ''
  },
  { immediate: true },
)
const isTeacher = computed(() => role.value === 'ogretmen')
const appointmentForm = reactive({
    slotId: '',
    note: '',
    type: role.value === 'veli' ? 'Veli görüşmesi' : 'Bireysel etüt',
  }),
  slotForm = reactive({ date: '', time: '16:00', duration: 30 })
const requestForm = reactive({ title: '', text: '', category: 'Talep' }),
  requestEdit = reactive({ status: 'İnceleniyor', assignedTo: 'Ön büro' })
const absenceForm = reactive({
  startDate: dayKey(),
  endDate: dayKey(),
  reason: '',
  category: 'Sağlık',
})
const appointments = computed(() =>
  state.appointments
    .filter((a) =>
      isTeacher.value ? a.teacherId === teacherId : a.studentId === currentStudent.value.id,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((a) => ({
      ...a,
      student: studentById(a.studentId).name,
      teacher: teacherById(a.teacherId).name,
    })),
)
const requests = computed(() =>
  state.requests
    .filter((r) => role.value === 'onburo' || r.studentId === currentStudent.value.id)
    .map((r) => ({ ...r, student: studentById(r.studentId).name })),
)
const ownSender = computed(() =>
  isTeacher.value ? 'teacher' : role.value === 'veli' ? 'parent' : 'student',
)
const conversations = computed(() =>
  state.conversations.filter((c) =>
    isTeacher.value
      ? c.teacherId === teacherId
      : c.studentId === currentStudent.value.id && c.audience === ownSender.value,
  ),
)
const conversation = computed(() =>
  isTeacher.value
    ? conversations.value.find((c) => c.id === selectedConversation.value) || conversations.value[0]
    : conversations.value.find((c) => c.teacherId === recipientId.value),
)
const partner = (c) =>
  isTeacher.value
    ? `${studentById(c.studentId).name}${c.audience === 'parent' ? ' · Velisi' : ''}`
    : teacherById(c.teacherId).name
const slots = computed(() =>
  state.availability
    .filter(
      (s) =>
        s.teacherId === (isTeacher.value ? teacherId : recipientId.value) &&
        new Date(s.date) > new Date(),
    )
    .sort((a, b) => a.date.localeCompare(b.date)),
)
const slotTaken = (slot) =>
  !!tutorConflict(
    { ...state, schedule: [], schoolEvents: [] },
    {
      ...slot,
      branchId: teacherById(slot.teacherId)?.branchId,
      room: '',
      studentIds: isTeacher.value ? [] : [currentStudent.value.id],
    },
  ) ||
  state.appointments.some(
    (a) =>
      a.teacherId === slot.teacherId &&
      a.date === slot.date &&
      ['Bekliyor', 'Onaylandı'].includes(a.status),
  )
const announcements = computed(() =>
  state.announcements
    .filter(
      (a) =>
        (!a.classId || a.classId === currentStudent.value.classId) &&
        (announcementFilter.value === 'all' || a.category === announcementFilter.value),
    )
    .map((a) => ({ ...a, audience: a.classId ? 'Sınıfa özel' : 'Genel duyuru' })),
)
const scrollMessages = async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}
watch(() => conversation.value?.messages.length, scrollMessages)
watch([tab, selectedConversation], scrollMessages)
function sendMessage() {
  const result = action(() => {
    const text = requiredText.parse(message.value)
    if (!isTeacher.value && !recipients.value.some((t) => t.id === recipientId.value))
      throw new Error('Aktif bir branş öğretmeni seçin.')
    let conv = conversation.value
    if (!conv) {
      if (isTeacher.value) throw new Error('Bir konuşma seçin.')
      conv = {
        id: id('conv'),
        studentId: currentStudent.value.id,
        teacherId: recipientId.value,
        audience: ownSender.value,
        messages: [],
      }
      state.conversations.push(conv)
    }
    conv.messages.push({
      id: id('msg'),
      text,
      sender: ownSender.value,
      date: new Date().toISOString(),
    })
  }, 'Mesajınız gönderildi.')
  if (result) {
    message.value = ''
    scrollMessages()
  }
}
function bookAppointment() {
  if (
    action(() => {
      requiredText.parse(appointmentForm.note)
      const slot = slots.value.find((s) => s.id === appointmentForm.slotId)
      if (!slot || slotTaken(slot)) throw new Error('Müsait bir görüşme saati seçin.')
      if (
        state.appointments.some(
          (a) =>
            a.studentId === currentStudent.value.id &&
            a.date === slot.date &&
            a.status !== 'Reddedildi',
        )
      )
        throw new Error('Bu saatte zaten bir randevunuz var.')
      state.appointments.unshift({
        id: id('apt'),
        studentId: currentStudent.value.id,
        teacherId: slot.teacherId,
        date: slot.date,
        type: appointmentForm.type,
        note: appointmentForm.note.trim(),
        status: 'Bekliyor',
      })
    }, 'Randevu talebiniz öğretmeninize gönderildi.')
  ) {
    modal.value = ''
    appointmentForm.note = ''
    appointmentForm.slotId = ''
  }
}
function setAppointmentStatus(entry, status) {
  action(
    () => {
      const appointment = state.appointments.find((a) => a.id === entry.id)
      if (appointment.teacherId !== teacherId) throw new Error('Bu görüşme size ait değil.')
      if (status === 'Onaylandı') {
        const reason = tutorConflict(
          { ...state, schedule: [], appointments: [], schoolEvents: [] },
          {
            ...appointment,
            branchId: teacherById(teacherId).branchId,
            room: '',
            studentIds: [appointment.studentId],
          },
        )
        if (reason) throw new Error(reason)
      }
      if (
        status === 'Onaylandı' &&
        state.appointments.some(
          (a) =>
            a.id !== entry.id &&
            a.teacherId === teacherId &&
            a.date === entry.date &&
            a.status === 'Onaylandı',
        )
      )
        throw new Error('Bu saatte onaylanmış bir görüşmeniz var.')
      appointment.status = status
    },
    `Randevu ${status.toLocaleLowerCase('tr')}.`,
  )
}
function addSlot() {
  if (
    action(() => {
      z.object({
        date: z.string().min(10, 'Tarih seçin.'),
        time: z.string().min(5, 'Saat seçin.'),
        duration: z.coerce.number().min(15).max(60),
      }).parse(slotForm)
      const date = new Date(`${slotForm.date}T${slotForm.time}:00+03:00`).toISOString()
      if (new Date(date) < new Date()) throw new Error('Gelecek bir tarih seçin.')
      const tutorReason = tutorConflict(
        { ...state, schedule: [], appointments: [], schoolEvents: [] },
        {
          teacherId,
          date,
          duration: slotForm.duration,
          branchId: teacherById(teacherId).branchId,
          room: '',
          studentIds: [],
        },
      )
      if (tutorReason) throw new Error(tutorReason)
      const end = +new Date(date) + Number(slotForm.duration) * 60000
      if (
        state.availability.some(
          (s) =>
            s.teacherId === teacherId &&
            +new Date(s.date) < end &&
            +new Date(s.date) + s.duration * 60000 > +new Date(date),
        )
      )
        throw new Error('Bu aralık başka bir müsaitlik saatiyle çakışıyor.')
      state.availability.push({
        id: id('slot'),
        teacherId,
        date,
        duration: Number(slotForm.duration),
      })
    }, 'Müsaitlik saatiniz paylaşıldı.')
  )
    modal.value = ''
}
function sendRequest() {
  if (
    action(() => {
      const data = z
        .object({
          title: requiredText.max(120),
          text: requiredText,
          category: z.enum(['Talep', 'Şikayet', 'Öneri']),
        })
        .parse(requestForm)
      state.requests.unshift({
        ...data,
        id: id('req'),
        studentId: currentStudent.value.id,
        status: 'Yeni',
        assignedTo: 'Ön büro',
        date: new Date().toISOString(),
      })
    }, 'Geri bildiriminiz ön büroya iletildi.')
  ) {
    modal.value = ''
    requestForm.title = ''
    requestForm.text = ''
  }
}
function saveRequest() {
  action(
    () =>
      Object.assign(
        state.requests.find((r) => r.id === selectedRequest.value.id),
        requestEdit,
      ),
    'Talebin durumu ve sorumlu birimi güncellendi.',
  )
  selectedRequest.value = null
}
function sendAbsence() {
  if (
    action(() => {
      requiredText.parse(absenceForm.reason)
      if (
        !absenceForm.startDate ||
        !absenceForm.endDate ||
        absenceForm.endDate < absenceForm.startDate
      )
        throw new Error('Geçerli bir başlangıç ve bitiş tarihi seçin.')
      if (absenceForm.startDate < dayKey())
        throw new Error('Geçmiş tarih için izin bildirimi yapılamaz.')
      if (
        state.absences.some(
          (a) =>
            a.studentId === currentStudent.value.id &&
            a.startDate <= absenceForm.endDate &&
            a.endDate >= absenceForm.startDate,
        )
      )
        throw new Error('Bu tarih aralığında zaten bir izin bildirimi var.')
      state.absences.unshift({
        ...absenceForm,
        id: id('absence'),
        studentId: currentStudent.value.id,
        status: 'İletildi',
        date: new Date().toISOString(),
      })
      state.requests.unshift({
        id: id('req'),
        studentId: currentStudent.value.id,
        title: `İzin bildirimi · ${absenceForm.category}`,
        text: `${absenceForm.startDate} – ${absenceForm.endDate}: ${absenceForm.reason}`,
        category: 'Talep',
        status: 'Yeni',
        assignedTo: 'Akademik koordinatör',
        date: new Date().toISOString(),
      })
    }, 'Mazeret bildiriminiz kuruma iletildi.')
  )
    absenceForm.reason = ''
}
</script>
<template>
  <PageHeading
    ><button
      v-if="['randevu-talep', 'randevu-mesaj'].includes(page)"
      class="btn btn-primary btn-create"
      @click="modal = 'appointment'"
    >
      <Icon name="Plus" :size="17" />Randevu talep et</button
    ><button
      v-if="page === 'randevular'"
      class="btn btn-primary btn-create"
      @click="modal = 'slot'"
    >
      <Icon name="Plus" :size="17" />Müsaitlik ekle</button
    ><button
      v-if="page === 'sikayet-talep'"
      class="btn btn-primary btn-create"
      @click="modal = 'request'"
    >
      <Icon name="Plus" :size="17" />Yeni bildirim
    </button></PageHeading
  >
  <template v-if="page === 'duyurular'"
    ><LineTabs
      v-model="announcementFilter"
      label="Duyuru kategorisi"
      :options="[
        { value: 'all', label: 'Tüm duyurular' },
        ...['Akademik', 'Etkinlik', 'Bilgilendirme'].map((category) => ({
          value: category,
          label: category,
        })),
      ]"
    />
    <CollectionList
      list-key="communication-collectionlist-1"
      :rows="announcements"
      :filter-key="announcementFilter"
      :external-active="announcementFilter !== 'all'"
      layout="two-grid"
      search-label="Duyurularda ara"
      :filters="[
        { key: 'audience', label: 'Hedef kitle' },
        { key: 'date', label: 'Duyuru tarihi', type: 'date' },
      ]"
      @reset="announcementFilter = 'all'"
      ><template #default="{ items }">
        <article v-for="(a, i) in items" :key="a.id" class="panel announcement-card">
          <div class="card-top">
            <span class="mini-icon" :class="['lavender', 'mint', 'peach'][i % 3]"
              ><Icon
                :name="a.category === 'Etkinlik' ? 'CalendarDays' : 'Megaphone'"
                :size="24" /></span
            ><Badge :text="a.category" :tone="['purple', 'green', 'amber'][i % 3]" />
          </div>
          <h2>{{ a.title }}</h2>
          <p>{{ a.text }}</p>
          <div class="announcement-card-footer">
            <span>{{ dateLabel(a.date, { year: 'numeric' }) }}</span
            ><span>{{
              a.classId ? `${classById(a.classId).name} sınıfına özel` : 'Tüm kampüse'
            }}</span>
          </div>
        </article>
      </template></CollectionList
    ></template
  >
  <template v-else-if="page === 'talepler' || page === 'sikayet-talep'"
    ><section class="panel">
      <DataTable
        list-key="communication-datatable-1"
        :rows="requests"
        :columns="[
          { key: 'title', label: 'Konu' },
          { key: 'student', label: 'Öğrenci' },
          { key: 'category', label: 'Tür' },
          { key: 'date', label: 'Tarih' },
          { key: 'assignedTo', label: 'İlgili birim' },
          { key: 'status', label: 'Durum' },
          { key: 'actions', label: '' },
        ]"
        ><template #date="{ value }">{{ dateLabel(value) }}</template
        ><template #status="{ value }"><Badge :text="value" /></template
        ><template #actions="{ row }"
          ><button
            class="btn btn-sm"
            @click="
              () => {
                selectedRequest = row
                requestEdit.status = row.status
                requestEdit.assignedTo = row.assignedTo
              }
            "
          >
            {{ role === 'onburo' ? 'İncele & yönlendir' : 'Detayı gör' }}
          </button></template
        ></DataTable
      >
    </section></template
  >
  <template v-else-if="page === 'devamsizlik-bildirimi'"
    ><div class="two-grid">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>İzin / mazeret bildirimi</h2>
            <p>{{ currentStudent.name }} adına bildirim oluşturun.</p>
          </div>
        </div>
        <form novalidate class="form-grid padded-form" @submit.prevent="sendAbsence">
          <label
            >Başlangıç tarihi<input
              v-model="absenceForm.startDate"
              type="date"
              :min="dayKey()" /></label
          ><label
            >Bitiş tarihi<input
              v-model="absenceForm.endDate"
              type="date"
              :min="absenceForm.startDate" /></label
          ><label class="full"
            >Mazeret türü<select v-model="absenceForm.category">
              <option>Sağlık</option>
              <option>Ailevi nedenler</option>
              <option>Seyahat</option>
              <option>Diğer</option>
            </select></label
          ><label class="full"
            >Açıklama<textarea
              v-model="absenceForm.reason"
              rows="4"
              maxlength="2000"
              placeholder="Mazeretinizi kısaca açıklayın..."
            ></textarea>
          </label>
          <div class="info-box full">
            Bildirim kuruma iletilir; mevcut yoklama kayıtları otomatik değiştirilmez.
          </div>
          <button type="submit" class="btn btn-primary full">
            <Icon name="Send" :size="17" />Bildirimi gönder
          </button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>Bildirim geçmişi</h2></div>
        <div class="padded-form">
          <article
            v-for="a in state.absences.filter((a) => a.studentId === currentStudent.id)"
            :key="a.id"
            class="absence-entry"
          >
            <Badge :text="a.status" />
            <h3>{{ a.category }}</h3>
            <small>{{ dateLabel(a.startDate) }} – {{ dateLabel(a.endDate) }}</small>
            <p>{{ a.reason }}</p>
          </article>
          <div
            v-if="!state.absences.some((a) => a.studentId === currentStudent.id)"
            class="empty-page"
          >
            <Icon name="ClipboardCheck" :size="38" />
            <h3>Henüz izin bildirimi yok.</h3>
            <p>Gönderdiğiniz bildirimler burada görünecek.</p>
          </div>
        </div>
      </section>
    </div></template
  >
  <template v-else
    ><label v-if="!isTeacher" class="teacher-recipient"
      >Branş öğretmeni<select v-model="recipientId" aria-label="Branş öğretmeni">
        <option v-for="teacher in recipients" :key="teacher.id" :value="teacher.id">
          {{ teacher.subject }} · {{ teacher.name }}
        </option>
      </select></label
    >
    <LineTabs
      v-if="['randevu-mesaj', 'randevular'].includes(page)"
      v-model="tab"
      label="Görüşme görünümü"
      :options="[
        { value: 'appointments', label: 'Randevular', icon: 'CalendarDays' },
        { value: 'messages', label: 'Mesajlar', icon: 'MessagesSquare' },
      ]"
    />
    <div v-if="page === 'mesajlar' || tab === 'messages'" class="panel messaging">
      <aside class="conversation-list">
        <h2>Konuşmalar</h2>
        <button
          v-for="c in conversations"
          :key="c.id"
          :class="{ active: conversation?.id === c.id }"
          @click="
            () => {
              selectedConversation = c.id
              if (!isTeacher) recipientId = c.teacherId
            }
          "
        >
          <Avatar :name="partner(c)" /><span
            ><strong>{{ partner(c) }}</strong
            ><small>{{ c.messages.at(-1)?.text }}</small></span
          >
        </button>
        <p v-if="!conversations.length" class="empty-inline">
          Öğretmeninize ilk mesajınızı gönderin.
        </p>
      </aside>
      <section class="chat">
        <div class="chat-header">
          <Avatar
            :name="
              conversation
                ? partner(conversation)
                : teacherById(recipientId)?.name || 'Öğretmen seçin'
            "
          />
          <div>
            <strong>{{
              conversation
                ? partner(conversation)
                : teacherById(recipientId)?.name || 'Öğretmen seçin'
            }}</strong
            ><small>Akademi Özel Okulları · Demo iletişim</small>
          </div>
        </div>
        <div ref="messagesEl" class="chat-messages">
          <div
            v-for="m in conversation?.messages || []"
            :key="m.id"
            class="message-bubble"
            :class="{ own: m.sender === ownSender }"
          >
            <p>{{ m.text }}</p>
            <span
              >{{ dateLabel(m.date) }} · {{ timeLabel(m.date)
              }}<Icon v-if="m.sender === ownSender" name="CheckCheck" :size="14"
            /></span>
          </div>
        </div>
        <form novalidate class="chat-compose" @submit.prevent="sendMessage">
          <label class="sr-only" for="message">Mesajınız</label
          ><textarea
            id="message"
            v-model="message"
            rows="2"
            placeholder="Mesajınızı yazın..."
            maxlength="2000"
            @keydown.ctrl.enter.prevent="sendMessage"
          ></textarea
          ><button class="btn btn-primary" type="submit" aria-label="Mesajı gönder">
            <Icon name="Send" :size="20" />
          </button>
        </form>
      </section>
    </div>
    <template v-else
      ><section class="panel">
        <div class="panel-heading">
          <div>
            <h2>{{ isTeacher ? 'Görüşme ve etüt talepleri' : 'Randevularım' }}</h2>
            <p>Birlikte gelişmek için ayrılmış zaman.</p>
          </div>
        </div>
        <DataTable
          list-key="communication-datatable-2"
          :rows="appointments"
          :columns="[
            { key: 'student', label: 'Öğrenci' },
            { key: 'teacher', label: 'Öğretmen' },
            { key: 'type', label: 'Görüşme türü' },
            { key: 'date', label: 'Tarih / Saat' },
            { key: 'note', label: 'Görüşme notu' },
            { key: 'status', label: 'Durum' },
            { key: 'actions', label: '' },
          ]"
          ><template #date="{ value }">{{
            dateLabel(value, { hour: '2-digit', minute: '2-digit' })
          }}</template
          ><template #status="{ value }"><Badge :text="value" /></template
          ><template #actions="{ row }"
            ><div v-if="isTeacher && row.status === 'Bekliyor'" class="button-row">
              <button
                class="btn btn-sm btn-primary"
                @click="setAppointmentStatus(row, 'Onaylandı')"
              >
                Onayla</button
              ><button class="btn btn-sm" @click="setAppointmentStatus(row, 'Reddedildi')">
                Reddet
              </button>
            </div></template
          ></DataTable
        >
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>{{ isTeacher ? 'Müsaitlik saatlerim' : 'Öğretmenin müsait saatleri' }}</h2>
            <p>
              {{
                isTeacher
                  ? 'Öğrenci ve veliler bu saatlerden randevu talep edebilir.'
                  : teacherById(recipientId)?.name || 'Öğretmen seçin'
              }}
            </p>
          </div>
        </div>
        <div class="slot-grid">
          <div
            v-for="slot in slots"
            :key="slot.id"
            class="slot-card"
            :class="{ taken: slotTaken(slot) }"
          >
            <Icon name="CalendarDays" :size="21" /><strong>{{
              dateLabel(slot.date, { weekday: 'short' })
            }}</strong
            ><span>{{ timeLabel(slot.date) }} · {{ slot.duration }} dk</span
            ><Badge
              :text="slotTaken(slot) ? 'Dolu' : 'Müsait'"
              :tone="slotTaken(slot) ? 'gray' : 'green'"
            /><button
              v-if="!isTeacher"
              class="btn btn-sm"
              :disabled="slotTaken(slot)"
              @click="
                () => {
                  appointmentForm.slotId = slot.id
                  modal = 'appointment'
                }
              "
            >
              Bu saati seç
            </button>
          </div>
          <p v-if="!slots.length" class="empty-inline">Henüz müsaitlik saati tanımlanmamış.</p>
        </div>
      </section></template
    >
  </template>
  <Modal v-if="modal === 'appointment'" drawer title="Görüşme talep et" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="bookAppointment">
      <label class="full"
        >Öğretmen<input
          :value="teacherById(recipientId)?.name || 'Öğretmen seçin'"
          readonly /></label
      ><label class="full"
        >Müsait saat<select v-model="appointmentForm.slotId">
          <option value="" disabled>Saat seçin</option>
          <option
            v-for="slot in slots.filter((s) => !slotTaken(s))"
            :key="slot.id"
            :value="slot.id"
          >
            {{ dateLabel(slot.date, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }}
          </option>
        </select></label
      ><label class="full"
        >Görüşme türü<select v-model="appointmentForm.type">
          <option>Bireysel etüt</option>
          <option>Veli görüşmesi</option>
          <option>Akademik danışmanlık</option>
        </select></label
      ><label class="full"
        >Görüşme konusu<textarea
          v-model="appointmentForm.note"
          rows="3"
          maxlength="2000"
        ></textarea></label
      ><button class="btn btn-primary full" type="submit">Talebi gönder</button>
    </form></Modal
  >
  <Modal v-if="modal === 'slot'" drawer title="Müsaitlik saati ekle" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="addSlot">
      <label>Tarih<input v-model="slotForm.date" type="date" :min="dayKey()" /></label
      ><label>Saat<input v-model="slotForm.time" type="time" /></label
      ><label class="full"
        >Görüşme süresi<select v-model="slotForm.duration">
          <option :value="15">15 dakika</option>
          <option :value="30">30 dakika</option>
          <option :value="60">60 dakika</option>
        </select></label
      ><button class="btn btn-primary full" type="submit">Müsaitliği paylaş</button>
    </form></Modal
  >
  <Modal v-if="modal === 'request'" drawer title="Şikayet, talep veya öneri" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="sendRequest">
      <label class="full"
        >Bildirim türü<select v-model="requestForm.category">
          <option>Talep</option>
          <option>Şikayet</option>
          <option>Öneri</option>
        </select></label
      ><label class="full">Konu<input v-model="requestForm.title" maxlength="120" /></label
      ><label class="full"
        >Açıklama<textarea v-model="requestForm.text" rows="5" maxlength="2000"></textarea></label
      ><button class="btn btn-primary full" type="submit">Bildirimi gönder</button>
    </form></Modal
  >
  <Modal
    v-if="selectedRequest"
    drawer
    :title="selectedRequest.title"
    @close="selectedRequest = null"
    ><div class="request-detail">
      <Badge :text="selectedRequest.category" />
      <p>{{ selectedRequest.text }}</p>
      <small>{{ selectedRequest.student }} · {{ dateLabel(selectedRequest.date) }}</small>
    </div>
    <form v-if="role === 'onburo'" novalidate class="form-grid" @submit.prevent="saveRequest">
      <label
        >İlgili birim<select v-model="requestEdit.assignedTo">
          <option>Ön büro</option>
          <option>Akademik koordinatör</option>
          <option>Finans birimi</option>
          <option>Şube müdürü</option>
        </select></label
      ><label
        >Durum<select v-model="requestEdit.status" aria-label="Talep durumu">
          <option>Yeni</option>
          <option>İnceleniyor</option>
          <option>Çözüldü</option>
        </select></label
      ><button class="btn btn-primary full" type="submit">Güncelle ve yönlendir</button>
    </form>
    <div v-else class="info-box">
      {{ selectedRequest.assignedTo }} · {{ selectedRequest.status }}
    </div></Modal
  >
</template>
