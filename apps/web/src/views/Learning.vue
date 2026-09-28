<script setup>
import { useViewMemory } from '../lib/view-memory.js'
import { computed, reactive, ref, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { z } from 'zod'
import {
  state,
  role,
  currentStudent,
  teacherId,
  teacherClasses,
  studentById,
  teacherById,
  classById,
  action,
  id,
  notify,
} from '../stores/demo.js'
import { dateLabel, homeworkStatus, slaLabel, slaStatus, dayKey } from '../lib/format.js'
import { subjects, schoolLevels, subjectById } from '../data/curriculum.js'
import { gradeQuiz, requiredText } from '../lib/domain.js'
import { previewPdf, pendingDocuments } from '../lib/download.js'
import PageHeading from '../components/PageHeading.vue'
import DataTable from '../components/DataTable.vue'
import Badge from '../components/Badge.vue'
import Avatar from '../components/Avatar.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import LineTabs from '../components/LineTabs.vue'
import PdfButton from '../components/PdfButton.vue'
import CollectionList from '../components/CollectionList.vue'
import LessonCover from '../components/LessonCover.vue'
const remember = useViewMemory()
const route = useRoute(),
  page = computed(() => route.path.split('/').at(-1)),
  isTeacher = computed(() => role.value === 'ogretmen')
const filter = remember('filter', 'all'),
  query = remember('query', ''),
  tab = remember('tab', 'all'),
  modal = ref(''),
  selectedHomework = ref(null),
  selectedSubmission = ref(null),
  selectedQuestion = ref(null),
  selectedVideo = ref(null),
  file = ref(null),
  answerText = ref(''),
  videoError = ref(false),
  subjectFilter = remember('subjectFilter', 'all'),
  now = ref(Date.now())
const homeworkForm = reactive({
  title: '',
  description: '',
  classId: teacherClasses.value[0]?.id || 'c1',
  dueDate: '',
})
const materialForm = reactive({ title: '', level: '7. Sınıf', type: 'Doküman' }),
  questionForm = reactive({ title: '', text: '', subjectId: 'math' })
const gradeForm = reactive({ score: 85, feedback: '' }),
  quizForm = reactive({ title: '', classId: 'c1', duration: 15, questionIds: [] })
const activeQuiz = ref(null),
  questionIndex = ref(0),
  answers = reactive({}),
  quizResult = ref(null)
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onBeforeUnmount(() => clearInterval(timer))
const homework = computed(() =>
  state.homework
    .filter((h) =>
      isTeacher.value ? h.teacherId === teacherId : h.classId === currentStudent.value.classId,
    )
    .map((h) => ({
      ...h,
      class: classById(h.classId).name,
      status: homeworkStatus(h, state.submissions, currentStudent.value.id),
      delivered: state.submissions.filter((s) => s.homeworkId === h.id).length,
      total: state.students.filter((s) => s.classId === h.classId).length,
    }))
    .filter(
      (h) =>
        (filter.value === 'all' ||
          (isTeacher.value ? h.classId === filter.value : h.status === filter.value)) &&
        h.title.toLocaleLowerCase('tr').includes(query.value.toLocaleLowerCase('tr')),
    ),
)
const submissions = computed(() =>
  state.submissions
    .filter((s) => state.homework.find((h) => h.id === s.homeworkId)?.teacherId === teacherId)
    .map((s) => ({
      ...s,
      name: studentById(s.studentId).name,
      homework: state.homework.find((h) => h.id === s.homeworkId).title,
      status: s.score != null ? 'Değerlendirildi' : 'Bekliyor',
      class: classById(studentById(s.studentId).classId)?.name,
    })),
)
const questions = computed(() =>
  state.questions
    .filter((q) =>
      isTeacher.value ? q.teacherId === teacherId : q.studentId === currentStudent.value.id,
    )
    .map((q) => ({
      ...q,
      subject: subjectById(q.subjectId)?.name,
      name: studentById(q.studentId)?.name,
      slaState: slaStatus(q, now.value),
    }))
    .filter((q) => tab.value === 'all' || (tab.value === 'answered' ? q.answeredAt : !q.answeredAt))
    .sort((a, b) =>
      isTeacher.value
        ? Number(!!a.answeredAt) - Number(!!b.answeredAt) || a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    ),
)
const videos = computed(() =>
  state.videos.filter(
    (v) =>
      (subjectFilter.value === 'all' || v.subjectId === subjectFilter.value) &&
      v.title.toLocaleLowerCase('tr').includes(query.value.toLocaleLowerCase('tr')),
  ),
)
const materials = computed(() =>
  state.materials
    .filter(
      (m) =>
        (!isTeacher.value || m.teacherId === teacherId) &&
        (filter.value === 'all' || m.level === filter.value) &&
        (subjectFilter.value === 'all' || m.subjectId === subjectFilter.value) &&
        m.title.toLocaleLowerCase('tr').includes(query.value.toLocaleLowerCase('tr')),
    )
    .map((m) => ({ ...m, teacher: teacherById(m.teacherId)?.name })),
)
const quizzes = computed(() =>
  state.quizzes
    .filter((q) =>
      isTeacher.value ? q.teacherId === teacherId : q.classId === currentStudent.value.classId,
    )
    .map((q) => ({
      ...q,
      completion: state.quizAttempts.some(
        (a) => a.quizId === q.id && a.studentId === currentStudent.value.id,
      )
        ? 'Çözüldü'
        : 'Henüz çözülmedi',
    })),
)
const bank = computed(() =>
  state.bank.filter(
    (q) =>
      (filter.value === 'all' || q.topic === filter.value) &&
      q.subjectId === teacherById(teacherId).subjectId &&
      classById(quizForm.classId)?.grade >= q.minGrade &&
      classById(quizForm.classId)?.grade <= q.maxGrade,
  ),
)
const activeQuestions = computed(() =>
  activeQuiz.value
    ? activeQuiz.value.questionIds.map((id) => state.bank.find((q) => q.id === id))
    : [],
)
const currentQuestion = computed(() => activeQuestions.value[questionIndex.value])
const progressFor = (video) =>
  state.videoProgress.find((v) => v.studentId === currentStudent.value.id && v.videoId === video.id)
    ?.progress || 0
const fileAccept = '.pdf,.png,.jpg,.jpeg,.docx'
function pickFile(event, videoAllowed = false) {
  const picked = event.target.files?.[0]
  if (!picked) return
  const ext = picked.name.split('.').at(-1).toLowerCase()
  if (
    !(
      videoAllowed
        ? ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'mp4', 'webm']
        : ['pdf', 'png', 'jpg', 'jpeg', 'docx']
    ).includes(ext)
  ) {
    notify('Dosya türü desteklenmiyor.', 'error')
    event.target.value = ''
    file.value = null
    return
  }
  if (picked.size > (videoAllowed && ['mp4', 'webm'].includes(ext) ? 100 : 5) * 1024 * 1024) {
    notify('Dosya boyutu sınırı aşıldı. Belgeler 5 MB, videolar 100 MB olabilir.', 'error')
    event.target.value = ''
    file.value = null
    return
  }
  file.value = { name: picked.name, size: picked.size }
}
function assignHomework() {
  if (
    action(() => {
      const data = z
        .object({
          title: requiredText.max(120),
          description: requiredText,
          classId: requiredText,
          dueDate: z.string().min(10, 'Son teslim tarihi seçin.'),
        })
        .parse(homeworkForm)
      if (!teacherClasses.value.some((c) => c.id === data.classId))
        throw new Error('Sınıf seçimi geçersiz.')
      const dueDate = new Date(`${data.dueDate}T20:59:00.000Z`).toISOString()
      if (new Date(dueDate) < new Date()) throw new Error('Son teslim tarihi geçmişte olamaz.')
      state.homework.unshift({
        ...data,
        dueDate,
        id: id('hw'),
        teacherId,
        subjectId: teacherById(teacherId).subjectId,
        subject: teacherById(teacherId).subject,
        createdAt: new Date().toISOString(),
      })
    }, 'Ödev sınıfınıza atandı.')
  ) {
    modal.value = ''
    homeworkForm.title = ''
    homeworkForm.description = ''
  }
}
function submitHomework() {
  if (
    action(() => {
      if (!file.value) throw new Error('Lütfen ödev dosyanızı seçin.')
      const exists = state.submissions.find(
        (s) =>
          s.homeworkId === selectedHomework.value.id && s.studentId === currentStudent.value.id,
      )
      if (exists?.score != null) throw new Error('Değerlendirilmiş ödev değiştirilemez.')
      if (exists) {
        exists.fileName = file.value.name
        exists.submittedAt = new Date().toISOString()
      } else
        state.submissions.push({
          id: id('sub'),
          homeworkId: selectedHomework.value.id,
          studentId: currentStudent.value.id,
          fileName: file.value.name,
          submittedAt: new Date().toISOString(),
          score: null,
          feedback: '',
        })
    }, 'Ödeviniz teslim edildi. Öğretmeniniz değerlendirebilir.')
  ) {
    modal.value = ''
    file.value = null
  }
}
function gradeSubmission() {
  if (
    action(() => {
      const data = z
        .object({
          score: z.coerce
            .number()
            .min(0, 'Puan 0–100 arasında olmalı.')
            .max(100, 'Puan 0–100 arasında olmalı.'),
          feedback: requiredText,
        })
        .parse(gradeForm)
      Object.assign(
        state.submissions.find((s) => s.id === selectedSubmission.value.id),
        data,
      )
    }, 'Değerlendirme öğrenciyle paylaşıldı.')
  )
    modal.value = ''
}
function openGrade(sub) {
  selectedSubmission.value = sub
  gradeForm.score = sub.score ?? 85
  gradeForm.feedback = sub.feedback
  modal.value = 'grade'
}
function uploadMaterial() {
  if (
    action(() => {
      requiredText.parse(materialForm.title)
      if (!file.value) throw new Error('Yüklenecek dosyayı seçin.')
      const extension = file.value.name.split('.').at(-1).toLowerCase()
      if (materialForm.type === 'Video' && !['mp4', 'webm'].includes(extension))
        throw new Error('Video için MP4 veya WebM dosyası seçin.')
      if (materialForm.type === 'Doküman' && ['mp4', 'webm'].includes(extension))
        throw new Error('Video dosyası için Video türünü seçin.')
      if (materialForm.type === 'Video')
        state.videos.unshift({
          id: id('v'),
          title: materialForm.title,
          level: materialForm.level,
          teacherId,
          duration: 15,
          topic: teacherById(teacherId).subject,
          subjectId: teacherById(teacherId).subjectId,
          subject: teacherById(teacherId).subject,
          src: null,
          fileName: file.value.name,
          color: 'lavender',
        })
      else
        state.materials.unshift({
          ...materialForm,
          subjectId: teacherById(teacherId).subjectId,
          subject: teacherById(teacherId).subject,
          id: id('mat'),
          fileName: file.value.name,
          size: `${(file.value.size / 1048576).toFixed(2)} MB`,
          teacherId,
          createdAt: new Date().toISOString(),
        })
    }, 'Materyal demo kütüphanesine eklendi.')
  ) {
    modal.value = ''
    file.value = null
    materialForm.title = ''
  }
}
function askQuestion() {
  if (
    action(() => {
      const data = z
        .object({ title: requiredText.max(120), text: requiredText, subjectId: requiredText })
        .parse(questionForm)
      const assignment = state.assignments.find(
        (a) =>
          a.classId === currentStudent.value.classId &&
          a.subjectId === data.subjectId &&
          teacherById(a.teacherId)?.isActive,
      )
      if (!assignment) throw new Error('Bu ders için aktif öğretmen ataması bulunamadı.')
      state.questions.unshift({
        ...data,
        id: id('ask'),
        studentId: currentStudent.value.id,
        teacherId: assignment.teacherId,
        createdAt: new Date().toISOString(),
        answeredAt: null,
        answer: '',
        fileName: file.value?.name || null,
      })
    }, 'Sorunuz öğretmeninize iletildi. Hedef yanıt süresi 24 saat.')
  ) {
    modal.value = ''
    questionForm.title = ''
    questionForm.text = ''
    file.value = null
  }
}
function answerQuestion() {
  if (
    action(() => {
      const answer = requiredText.parse(answerText.value)
      const q = state.questions.find((q) => q.id === selectedQuestion.value.id)
      if (q.teacherId !== teacherId) throw new Error('Bu soru başka bir öğretmene ait.')
      q.answer = answer
      q.answeredAt = new Date().toISOString()
    }, 'Yanıtınız öğrenciyle paylaşıldı.')
  ) {
    modal.value = ''
    answerText.value = ''
  }
}
function createQuiz() {
  if (
    action(() => {
      const data = z
        .object({
          title: requiredText.max(120),
          classId: requiredText,
          duration: z.coerce.number().int().min(5).max(120),
          questionIds: z.array(z.string()).min(1, 'En az bir soru seçin.'),
        })
        .parse(quizForm)
      if (!teacherClasses.value.some((c) => c.id === data.classId))
        throw new Error('Sınıf seçimi geçersiz.')
      const selectedGrade = classById(data.classId).grade
      if (
        data.questionIds.some(
          (qid) =>
            !state.bank.some(
              (q) =>
                q.id === qid &&
                q.subjectId === teacherById(teacherId).subjectId &&
                selectedGrade >= q.minGrade &&
                selectedGrade <= q.maxGrade,
            ),
        )
      )
        throw new Error('Sorular seçilen sınıf ve branşa uygun olmalıdır.')
      state.quizzes.unshift({
        ...data,
        questionIds: [...data.questionIds],
        id: id('quiz'),
        teacherId,
        subjectId: teacherById(teacherId).subjectId,
        subject: teacherById(teacherId).subject,
        createdAt: new Date().toISOString(),
      })
    }, 'Quiz oluşturuldu ve sınıfınızla paylaşıldı.')
  ) {
    quizForm.title = ''
    quizForm.questionIds = []
  }
}
function beginQuiz(quiz) {
  activeQuiz.value = quiz
  quizResult.value = null
  questionIndex.value = 0
  for (const key of Object.keys(answers)) delete answers[key]
}
function finishQuiz() {
  const result = action(() => {
    const result = gradeQuiz(activeQuiz.value, state.bank, answers)
    const date = new Date().toISOString()
    state.quizAttempts.push({
      id: id('attempt'),
      quizId: activeQuiz.value.id,
      studentId: currentStudent.value.id,
      answers: { ...answers },
      ...result,
      date,
    })
    state.grades.push({
      id: id('g'),
      studentId: currentStudent.value.id,
      title: activeQuiz.value.title,
      subjectId: activeQuiz.value.subjectId,
      subject: activeQuiz.value.subject,
      topic: 'Kazanım testi',
      score: result.score,
      date,
    })
    return result
  }, 'Quiz tamamlandı. Sonucunuz notlarınıza eklendi.')
  if (result) quizResult.value = result
}
function openVideo(video) {
  selectedVideo.value = video
  videoError.value = false
  if (
    !state.videoProgress.some(
      (v) => v.studentId === currentStudent.value.id && v.videoId === video.id,
    )
  )
    state.videoProgress.push({ studentId: currentStudent.value.id, videoId: video.id, progress: 0 })
}
function updateVideoProgress(event) {
  const video = event.target
  if (!Number.isFinite(video.duration) || video.duration <= 0) return
  const entry = state.videoProgress.find(
    (v) => v.studentId === currentStudent.value.id && v.videoId === selectedVideo.value?.id,
  )
  if (entry)
    entry.progress = video.ended
      ? 100
      : Math.min(100, Math.round((video.currentTime / video.duration) * 100))
}
function resumeVideo(event) {
  const progress = progressFor(selectedVideo.value)
  if (progress > 0 && progress < 99 && Number.isFinite(event.target.duration))
    event.target.currentTime = (event.target.duration * progress) / 100
}
function materialPdf(material) {
  previewPdf('material', material.id, `${material.title}.pdf`)
}
const questionSubjects = computed(() =>
  state.assignments
    .filter((a) => a.classId === currentStudent.value.classId && teacherById(a.teacherId)?.isActive)
    .map((a) => ({
      ...a,
      subject: subjectById(a.subjectId).name,
      teacher: teacherById(a.teacherId).name,
    })),
)
</script>
<template>
  <PageHeading
    ><button
      v-if="page === 'odevler' && isTeacher"
      class="btn btn-primary btn-create"
      @click="modal = 'homework'"
    >
      <Icon name="Plus" :size="17" />Ödev ata</button
    ><button
      v-if="page === 'materyal-yukle'"
      class="btn btn-primary btn-create"
      @click="
        () => {
          modal = 'material'
          file = null
        }
      "
    >
      <Icon name="Upload" :size="17" />Materyal yükle</button
    ><button
      v-if="page === 'soru-sor'"
      class="btn btn-primary btn-create"
      @click="
        () => {
          modal = 'ask'
          file = null
        }
      "
    >
      <Icon name="Plus" :size="17" />Yeni soru sor
    </button></PageHeading
  >
  <template v-if="page === 'odevler'"
    ><div class="content-filters">
      <label class="search-field"
        ><Icon name="Search" :size="17" /><input
          v-model="query"
          aria-label="Ödev ara"
          placeholder="Ödevlerde ara..." /></label
      ><select v-model="filter" aria-label="Ödev filtresi">
        <option value="all">Tüm ödevler</option>
        <template v-if="isTeacher"
          ><option v-for="c in teacherClasses" :key="c.id" :value="c.id">
            {{ c.name }}
          </option></template
        ><template v-else
          ><option>Bekliyor</option>
          <option>Teslim edildi</option>
          <option>Değerlendirildi</option>
          <option>Gecikmiş</option></template
        >
      </select>
    </div>
    <CollectionList
      list-key="learning-collectionlist-1"
      :rows="homework"
      :filter-key="[filter, query]"
      :external-active="filter !== 'all' || !!query"
      :filters="[
        { key: 'subject', label: 'Ders' },
        { key: 'dueDate', label: 'Son teslim tarihi', type: 'date' },
      ]"
      :sort-options="[
        { value: 'due', key: 'dueDate', label: 'Son teslim: en yakın' },
        { value: 'new', key: 'createdAt', direction: -1, label: 'En yeni ödevler' },
      ]"
      @reset="
        () => {
          filter = 'all'
          query = ''
        }
      "
      ><template #default="{ items }">
        <article v-for="h in items" :key="h.id" class="panel homework-card">
          <div class="card-top">
            <span class="mini-icon lavender"><Icon name="NotebookPen" :size="22" /></span
            ><Badge :text="isTeacher ? h.class : h.status" />
          </div>
          <h2>{{ h.title }}</h2>
          <p>{{ h.description }}</p>
          <div class="homework-meta">
            <span
              ><Icon name="CalendarDays" :size="15" />{{ dateLabel(h.dueDate) }} · Son teslim</span
            ><span v-if="isTeacher"
              ><Icon name="UsersRound" :size="15" />{{ h.delivered }}/{{ h.total }} teslim</span
            >
          </div>
          <div
            v-if="
              !isTeacher &&
              state.submissions.find(
                (s) => s.homeworkId === h.id && s.studentId === currentStudent.id,
              )
            "
            class="submission-note"
          >
            <strong>{{
              state.submissions.find(
                (s) => s.homeworkId === h.id && s.studentId === currentStudent.id,
              ).fileName
            }}</strong>
            <p>
              {{
                state.submissions.find(
                  (s) => s.homeworkId === h.id && s.studentId === currentStudent.id,
                ).feedback || 'Öğretmen değerlendirmesi bekleniyor.'
              }}
            </p>
            <Badge
              v-if="
                state.submissions.find(
                  (s) => s.homeworkId === h.id && s.studentId === currentStudent.id,
                ).score != null
              "
              :text="`${state.submissions.find((s) => s.homeworkId === h.id && s.studentId === currentStudent.id).score}/100`"
              tone="green"
            />
          </div>
          <PdfButton
            type="homework"
            :record-id="h.id"
            :student-id="isTeacher ? undefined : currentStudent.id"
            :filename="`odev-${h.id}.pdf`"
            >Çalışma kâğıdını görüntüle</PdfButton
          >
          <button
            v-if="!isTeacher && h.status !== 'Değerlendirildi'"
            class="btn"
            @click="
              () => {
                selectedHomework = h
                modal = 'submit'
                file = null
              }
            "
          >
            <Icon name="Upload" :size="16" />{{
              h.status === 'Teslim edildi' ? 'Teslimi güncelle' : 'Ödevi teslim et'
            }}
          </button>
        </article>
      </template></CollectionList
    >
    <section v-if="isTeacher" class="panel">
      <div class="panel-heading">
        <div>
          <h2>Öğrenci teslimleri</h2>
          <p>Geri bildiriminiz öğrenmenin bir parçası.</p>
        </div>
      </div>
      <DataTable
        list-key="learning-datatable-1"
        :rows="submissions"
        :filters="[{ key: 'class', label: 'Sınıf' }]"
        :columns="[
          { key: 'name', label: 'Öğrenci' },
          { key: 'homework', label: 'Ödev' },
          { key: 'submittedAt', label: 'Teslim tarihi' },
          { key: 'score', label: 'Puan' },
          { key: 'status', label: 'Durum' },
          { key: 'actions', label: '' },
        ]"
        ><template #name="{ row }"
          ><div class="person-cell">
            <Avatar :name="row.name" size="small" /><strong>{{ row.name }}</strong>
          </div></template
        ><template #submittedAt="{ value }">{{ dateLabel(value) }}</template
        ><template #status="{ value }"><Badge :text="value" /></template
        ><template #actions="{ row }"
          ><button class="btn btn-sm" @click="openGrade(row)">Değerlendir</button></template
        ></DataTable
      >
    </section></template
  >
  <template v-else-if="page === 'sorular' || page === 'soru-sor'"
    ><div class="info-box sla-info">
      <Icon name="Timer" :size="21" /><span
        >Sorular için hedef yanıt süresi <strong>24 saat</strong>. Süreler soru oluşturulduğu andan
        itibaren hesaplanır.</span
      >
    </div>
    <LineTabs
      v-model="tab"
      label="Soru durumu"
      :options="[
        { value: 'all', label: 'Tüm sorular' },
        { value: 'pending', label: 'Yanıt bekleyen' },
        { value: 'answered', label: 'Yanıtlanan' },
      ]" />
    <CollectionList
      list-key="learning-collectionlist-2"
      :rows="questions"
      :presets="[
        { label: 'Tüm süreler', values: {} },
        { label: 'Süresi aşılmış sorular', values: { slaState: 'Süre aşıldı' } },
        { label: 'Süresi yaklaşan sorular', values: { slaState: 'Süre azalıyor' } },
      ]"
      :filter-key="tab"
      :external-active="tab !== 'all'"
      search-label="Sorularda ara"
      layout="question-list"
      :filters="[
        { key: 'subject', label: 'Ders' },
        { key: 'slaState', label: 'Yanıt süresi durumu' },
        { key: 'createdAt', label: 'Soru tarihi', type: 'date' },
      ]"
      @reset="tab = 'all'"
      ><template #default="{ items }">
        <article v-for="q in items" :key="q.id" class="panel question-card">
          <div class="question-card-head">
            <div class="person-cell">
              <Avatar :name="studentById(q.studentId).name" />
              <div>
                <strong>{{ studentById(q.studentId).name }}</strong
                ><small>{{ dateLabel(q.createdAt, { hour: '2-digit', minute: '2-digit' }) }}</small>
              </div>
            </div>
            <Badge :text="slaStatus(q, now)" />
          </div>
          <h2>{{ q.title }}</h2>
          <p>{{ q.text }}</p>
          <span v-if="q.fileName" class="attachment"
            ><Icon name="FileText" :size="15" />{{ q.fileName }} · Demo ek</span
          >
          <div v-if="q.answer" class="answer-block">
            <strong
              ><Icon name="CheckCheck" :size="17" />{{
                teacherById(q.teacherId).name
              }}
              yanıtladı</strong
            >
            <p>{{ q.answer }}</p>
          </div>
          <div class="question-card-footer">
            <span><Icon name="Clock3" :size="16" />{{ slaLabel(q, now) }}</span
            ><button
              v-if="isTeacher"
              class="btn btn-primary btn-sm"
              @click="
                () => {
                  selectedQuestion = q
                  answerText = q.answer
                  modal = 'answer'
                }
              "
            >
              {{ q.answer ? 'Yanıtı düzenle' : 'Yanıtla' }}<Icon name="ArrowRight" :size="15" />
            </button>
          </div>
        </article> </template></CollectionList
  ></template>
  <template v-else-if="page === 'videolar'"
    ><div class="content-filters">
      <label class="search-field"
        ><Icon name="Search" :size="17" /><input
          v-model="query"
          aria-label="Video ara"
          placeholder="Ders veya konu ara..." /></label
      ><select v-model="subjectFilter" aria-label="Video dersi">
        <option value="all">Tüm dersler</option>
        <option
          v-for="s in subjects.filter((s) => state.videos.some((v) => v.subjectId === s.id))"
          :key="s.id"
          :value="s.id"
        >
          {{ s.name }}
        </option>
      </select>
    </div>
    <div class="three-grid">
      <button
        v-for="video in videos"
        :key="video.id"
        class="panel video-card"
        @click="openVideo(video)"
      >
        <div class="video-thumbnail course-cover">
          <LessonCover :subject-id="video.subjectId" :level="video.level" />
        </div>
        <div class="video-card-body">
          <div class="card-top">
            <Badge :text="video.level" tone="purple" /><small
              >{{ video.subject }} · {{ video.topic }}</small
            >
          </div>
          <h2>{{ video.title }}</h2>
          <p>{{ teacherById(video.teacherId).name }}</p>
          <div class="progress"><span :style="{ width: `${progressFor(video)}%` }"></span></div>
          <div class="video-watch">
            <small>{{
              progressFor(video) === 100
                ? 'Tamamlandı'
                : progressFor(video)
                  ? `%${progressFor(video)} izlendi · Devam et`
                  : 'Henüz izlenmedi'
            }}</small
            ><span class="watch-label"
              ><Icon name="Play" :size="15" />{{
                progressFor(video) ? 'Devam et' : 'Dersi izle'
              }}</span
            >
          </div>
          <small class="video-meta">{{ video.duration }} dk · Sesli ve altyazılı</small>
        </div>
      </button>
    </div>
    <div v-if="!videos.length" class="panel empty-page">
      Aramanıza uygun video bulunamadı.
    </div></template
  >
  <template v-else-if="page === 'materyaller' || page === 'materyal-yukle'"
    ><div class="content-filters">
      <label class="search-field"
        ><Icon name="Search" :size="17" /><input
          v-model="query"
          aria-label="Materyal ara"
          placeholder="Kütüphanede ara..." /></label
      ><select v-model="subjectFilter" aria-label="Materyal dersi">
        <option value="all">Tüm dersler</option>
        <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option></select
      ><select v-model="filter" aria-label="Materyal seviyesi">
        <option value="all">Tüm sınıf düzeyleri</option>
        <option v-for="level in schoolLevels" :key="level">{{ level }}</option>
      </select>
    </div>
    <CollectionList
      list-key="learning-collectionlist-3"
      :rows="materials"
      :filter-key="[filter, subjectFilter, query]"
      :external-active="filter !== 'all' || subjectFilter !== 'all' || !!query"
      :filters="[
        { key: 'teacher', label: 'Hazırlayan öğretmen' },
        { key: 'createdAt', label: 'Yayın tarihi', type: 'date' },
      ]"
      :sort-options="[
        { value: 'new', key: 'createdAt', direction: -1, label: 'En yeni materyaller' },
        { value: 'name', key: 'title', label: 'Başlığa göre (A–Z)' },
      ]"
      @reset="
        () => {
          filter = 'all'
          subjectFilter = 'all'
          query = ''
        }
      "
      ><template #default="{ items }">
        <article v-for="m in items" :key="m.id" class="panel document-card">
          <div class="card-top">
            <span class="mini-icon" :class="subjectById(m.subjectId)?.color || 'blue'"
              ><Icon :name="subjectById(m.subjectId)?.icon || 'FileText'" :size="24" /></span
            ><Badge :text="m.level" />
          </div>
          <span class="subject-label">{{
            subjectById(m.subjectId)?.name || 'Ders materyali'
          }}</span>
          <h2>{{ m.title }}</h2>
          <p>{{ m.fileName }}</p>
          <small>{{ m.size }} · {{ dateLabel(m.createdAt) }}</small>
          <div class="document-footer">
            <span>{{ teacherById(m.teacherId).name }}</span
            ><button
              class="icon-button"
              :aria-label="`${m.title} önizle`"
              :disabled="pendingDocuments.has(`material:${m.id}`)"
              @click="materialPdf(m)"
            >
              <Icon name="Download" :size="20" />
            </button>
          </div>
        </article> </template
    ></CollectionList>
    <section v-if="isTeacher" class="panel">
      <div class="panel-heading"><h2>Paylaştığım videolar</h2></div>
      <DataTable
        list-key="learning-datatable-2"
        :rows="state.videos.filter((v) => v.teacherId === teacherId)"
        :columns="[
          { key: 'title', label: 'Video' },
          { key: 'level', label: 'Sınıf düzeyi' },
          { key: 'duration', label: 'Süre (dk)' },
        ]"
      />
    </section>
  </template>
  <template v-else-if="page === 'quiz-olustur'"
    ><div class="quiz-create-layout">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Soru bankası</h2>
            <p>{{ state.bank.length }} soru · Sınıf seviyesine uygun soruları seçin</p>
          </div>
          <select v-model="filter" aria-label="Soru konusu">
            <option value="all">Tüm konular</option>
            <option v-for="topic in [...new Set(state.bank.map((q) => q.topic))]" :key="topic">
              {{ topic }}
            </option>
          </select>
        </div>
        <div class="bank-list">
          <label v-for="q in bank" :key="q.id" class="bank-question"
            ><input v-model="quizForm.questionIds" type="checkbox" :value="q.id" /><span
              ><span class="bank-meta"
                >{{ q.subject }} · {{ q.topic }} · {{ q.id.toUpperCase() }}</span
              ><strong>{{ q.text }}</strong
              ><small>{{ q.options.join(' / ') }}</small></span
            ></label
          >
        </div>
      </section>
      <aside class="panel quiz-settings">
        <h2>Yeni quiz</h2>
        <form novalidate class="form-grid" @submit.prevent="createQuiz">
          <label class="full"
            >Quiz başlığı<input
              v-model="quizForm.title"
              placeholder="Örn. Denklem ve problem çözme"
              maxlength="120" /></label
          ><label class="full"
            >Sınıf<select v-model="quizForm.classId" @change="quizForm.questionIds = []">
              <option v-for="c in teacherClasses" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          ><label class="full"
            >Önerilen süre (dakika)<input
              v-model="quizForm.duration"
              type="number"
              min="5"
              max="120"
          /></label>
          <div class="info-box full">
            {{ quizForm.questionIds.length }} soru seçildi. Her soru eşit puan ağırlığındadır.
          </div>
          <button class="btn btn-primary full" type="submit">
            <Icon name="Plus" :size="16" />Quiz oluştur ve paylaş
          </button>
        </form>
      </aside>
    </div>
    <section class="panel">
      <div class="panel-heading"><h2>Paylaşılan quizler</h2></div>
      <DataTable
        list-key="learning-datatable-3"
        :rows="
          quizzes.map((q) => ({
            ...q,
            class: classById(q.classId).name,
            count: q.questionIds.length,
          }))
        "
        :columns="[
          { key: 'title', label: 'Quiz' },
          { key: 'class', label: 'Sınıf' },
          { key: 'count', label: 'Soru sayısı' },
          { key: 'duration', label: 'Süre (dk)' },
        ]"
      /></section
  ></template>
  <template v-else-if="page === 'soru-coz'"
    ><CollectionList
      v-if="!activeQuiz"
      list-key="learning-collectionlist-4"
      :rows="quizzes"
      search-label="Quizlerde ara"
      :filters="[
        { key: 'subject', label: 'Ders' },
        { key: 'completion', label: 'Çözüm durumu' },
        { key: 'duration', label: 'Süre (dk)', type: 'number' },
      ]"
      ><template #default="{ items }">
        <article v-for="quiz in items" :key="quiz.id" class="panel quiz-card">
          <div class="card-top">
            <span class="mini-icon lavender"><Icon name="ListChecks" :size="25" /></span
            ><Badge :text="classById(quiz.classId).level" />
          </div>
          <h2>{{ quiz.title }}</h2>
          <p>Bilgilerini pekiştir, gelişim alanlarını keşfet.</p>
          <div class="quiz-meta">
            <span><Icon name="ListChecks" :size="17" />{{ quiz.questionIds.length }} soru</span
            ><span><Icon name="Clock3" :size="17" />{{ quiz.duration }} dk önerilen süre</span>
          </div>
          <div
            v-if="
              state.quizAttempts.some(
                (a) => a.quizId === quiz.id && a.studentId === currentStudent.id,
              )
            "
            class="info-box"
          >
            Son sonuç:
            {{
              state.quizAttempts
                .filter((a) => a.quizId === quiz.id && a.studentId === currentStudent.id)
                .at(-1).score
            }}/100
          </div>
          <button class="btn btn-primary" @click="beginQuiz(quiz)">
            Quize başla<Icon name="ArrowRight" :size="17" />
          </button>
        </article> </template
    ></CollectionList>
    <section v-else-if="quizResult" class="panel quiz-result">
      <span class="result-icon" :class="{ success: quizResult.score >= 60 }"
        ><Icon name="Award" :size="48" /></span
      ><span class="eyebrow">QUIZ TAMAMLANDI</span>
      <h2>{{ quizResult.score }}<small>/100</small></h2>
      <p>
        {{ quizResult.correct }} doğru · {{ quizResult.total - quizResult.correct }} yanlış ·
        {{ quizResult.total }} soru
      </p>
      <div class="quiz-review">
        <article v-for="q in activeQuestions" :key="q.id">
          <strong
            ><Icon :name="answers[q.id] === q.answer ? 'CircleCheck' : 'X'" :size="18" />{{
              q.text
            }}</strong
          >
          <p>Yanıtın: {{ q.options[answers[q.id]] }} · Doğru yanıt: {{ q.options[q.answer] }}</p>
          <small>{{ q.explanation }}</small>
        </article>
      </div>
      <button
        class="btn btn-primary"
        @click="
          () => {
            activeQuiz = null
            quizResult = null
          }
        "
      >
        Quiz listesine dön
      </button>
    </section>
    <section v-else class="panel quiz-player">
      <div class="quiz-player-header">
        <span>{{ activeQuiz.title }}</span
        ><Badge :text="`${questionIndex + 1} / ${activeQuestions.length} soru`" />
      </div>
      <div class="progress">
        <span
          :style="{ width: `${(Object.keys(answers).length / activeQuestions.length) * 100}%` }"
        ></span>
      </div>
      <div class="quiz-question">
        <span class="eyebrow">{{ currentQuestion.topic }}</span>
        <h2>{{ currentQuestion.text }}</h2>
        <div class="quiz-options">
          <label
            v-for="(option, i) in currentQuestion.options"
            :key="i"
            :class="{ selected: answers[currentQuestion.id] === i }"
            ><input
              v-model="answers[currentQuestion.id]"
              type="radio"
              :name="currentQuestion.id"
              :value="i" /><span>{{ ['A', 'B', 'C', 'D'][i] }}</span
            ><strong>{{ option }}</strong
            ><Icon v-if="answers[currentQuestion.id] === i" name="Check" :size="20"
          /></label>
        </div>
      </div>
      <div class="quiz-nav">
        <button class="btn" :disabled="questionIndex === 0" @click="questionIndex--">
          <Icon name="ArrowLeft" :size="16" />Önceki soru
        </button>
        <div class="quiz-dots">
          <button
            v-for="(q, i) in activeQuestions"
            :key="q.id"
            :class="{ answered: answers[q.id] != null, active: i === questionIndex }"
            :aria-label="`${i + 1}. soruya git`"
            @click="questionIndex = i"
          >
            {{ i + 1 }}
          </button>
        </div>
        <button
          v-if="questionIndex < activeQuestions.length - 1"
          class="btn btn-primary"
          @click="questionIndex++"
        >
          Sonraki<Icon name="ArrowRight" :size="16" /></button
        ><button v-else class="btn btn-primary" @click="finishQuiz">
          Quizi bitir<Icon name="Check" :size="16" />
        </button>
      </div>
      <button class="text-link quiz-exit" @click="modal = 'exit-quiz'">Quizden çık</button>
    </section></template
  >
  <Modal v-if="modal === 'homework'" drawer title="Sınıfa ödev ata" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="assignHomework">
      <label class="full">Ödev başlığı<input v-model="homeworkForm.title" maxlength="120" /></label
      ><label class="full"
        >Açıklama<textarea
          v-model="homeworkForm.description"
          rows="4"
          maxlength="2000"
        ></textarea></label
      ><label
        >Sınıf<select v-model="homeworkForm.classId">
          <option v-for="c in teacherClasses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select></label
      ><label
        >Son teslim tarihi<input
          v-model="homeworkForm.dueDate"
          type="date"
          :min="dayKey()" /></label
      ><button type="submit" class="btn btn-primary full">Ödevi paylaş</button>
    </form></Modal
  >
  <Modal v-if="modal === 'submit'" drawer :title="selectedHomework.title" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="submitHomework">
      <p class="full muted">{{ selectedHomework.description }}</p>
      <label class="upload-zone full"
        ><Icon name="Upload" :size="32" /><strong>{{
          file ? file.name : 'Ödev dosyanızı seçin'
        }}</strong
        ><small>PDF, JPG, PNG veya DOCX · En fazla 5 MB</small
        ><input
          type="file"
          :accept="fileAccept"
          aria-label="Ödev dosyası"
          @change="pickFile($event)"
      /></label>
      <div class="info-box full">
        Demo modunda dosya adı saklanır; dosyanız bir sunucuya yüklenmez.
      </div>
      <button type="submit" class="btn btn-primary full">Ödevi teslim et</button>
    </form></Modal
  >
  <Modal v-if="modal === 'grade'" drawer title="Ödev değerlendirmesi" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="gradeSubmission">
      <div class="person-cell full">
        <Avatar :name="selectedSubmission.name" />
        <div>
          <strong>{{ selectedSubmission.name }}</strong
          ><small>{{ selectedSubmission.homework }}</small>
        </div>
      </div>
      <button
        type="button"
        class="btn full"
        :disabled="pendingDocuments.has(`submission:${selectedSubmission.id}`)"
        @click="
          () => {
            previewPdf(
              'submission',
              selectedSubmission.id,
              `degerlendirme-${selectedSubmission.id}.pdf`,
            )
          }
        "
      >
        <Icon name="Download" :size="17" />{{ selectedSubmission.fileName }} · Değerlendirme formunu
        görüntüle</button
      ><label class="full"
        >Puan (0–100)<input v-model="gradeForm.score" type="number" min="0" max="100" /></label
      ><label class="full"
        >Öğrenciye geri bildirim<textarea
          v-model="gradeForm.feedback"
          rows="4"
          maxlength="2000"
        ></textarea></label
      ><button type="submit" class="btn btn-primary full">Değerlendirmeyi paylaş</button>
    </form></Modal
  >
  <Modal v-if="modal === 'material'" drawer title="Materyal yükle" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="uploadMaterial">
      <label class="full"
        >Materyal başlığı<input v-model="materialForm.title" maxlength="120" /></label
      ><label
        >Tür<select v-model="materialForm.type">
          <option>Doküman</option>
          <option>Video</option>
        </select></label
      ><label
        >Sınıf düzeyi<select v-model="materialForm.level">
          <option v-for="l in schoolLevels" :key="l">{{ l }}</option>
        </select></label
      ><label class="upload-zone full"
        ><Icon name="Upload" :size="30" /><strong>{{ file?.name || 'Dosya seçin' }}</strong
        ><small>Belgeler 5 MB · MP4/WebM videolar 100 MB</small
        ><input type="file" :accept="fileAccept + ',.mp4,.webm'" @change="pickFile($event, true)"
      /></label>
      <p class="full muted">
        Dosya içeriği yüklenmez; adı ve bilgileri demo kütüphanesine eklenir.
      </p>
      <button type="submit" class="btn btn-primary full">Kütüphaneye ekle</button>
    </form></Modal
  >
  <Modal v-if="modal === 'ask'" drawer title="Öğretmenine soru sor" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="askQuestion">
      <label class="full"
        >Ders ve öğretmen<select v-model="questionForm.subjectId">
          <option v-for="a in questionSubjects" :key="a.subjectId" :value="a.subjectId">
            {{ a.subject }} · {{ a.teacher }}
          </option>
        </select></label
      >
      <label class="full"
        >Konu başlığı<input
          v-model="questionForm.title"
          maxlength="120"
          placeholder="Hangi konuda yardıma ihtiyacın var?" /></label
      ><label class="full"
        >Sorun<textarea
          v-model="questionForm.text"
          rows="5"
          maxlength="2000"
          placeholder="Sorunu ve takıldığın noktayı açıkla..."
        ></textarea></label
      ><label class="full"
        >Ek dosya (isteğe bağlı)<input
          type="file"
          :accept="fileAccept"
          @change="pickFile($event)" /></label
      ><button type="submit" class="btn btn-primary full">
        <Icon name="Send" :size="17" />Soruyu gönder
      </button>
    </form></Modal
  >
  <Modal v-if="modal === 'answer'" drawer :title="selectedQuestion.title" @close="modal = ''"
    ><form novalidate class="form-grid" @submit.prevent="answerQuestion">
      <div class="info-box full">{{ selectedQuestion.text }}</div>
      <label class="full"
        >Yanıtınız<textarea v-model="answerText" rows="7" maxlength="2000"></textarea></label
      ><button type="submit" class="btn btn-primary full">
        <Icon name="Send" :size="17" />Yanıtı gönder
      </button>
    </form></Modal
  >
  <Modal v-if="selectedVideo" :title="selectedVideo.title" wide @close="selectedVideo = null">
    <video
      v-if="selectedVideo.src"
      :key="selectedVideo.id"
      class="lesson-player"
      controls
      playsinline
      preload="metadata"
      :poster="selectedVideo.poster"
      :aria-label="selectedVideo.title"
      @loadedmetadata="resumeVideo"
      @timeupdate="updateVideoProgress"
      @ended="updateVideoProgress"
      @error="videoError = true"
    >
      <source :src="selectedVideo.src" type="video/mp4" />
      <track
        v-if="selectedVideo.captions"
        kind="captions"
        :src="selectedVideo.captions"
        srclang="tr"
        label="Türkçe"
        default
      />
      Tarayıcınız video oynatmayı desteklemiyor.
    </video>
    <div v-if="videoError" class="info-box">
      Video yüklenemedi. Sayfayı yenileyerek tekrar deneyebilirsiniz.
    </div>
    <div v-if="!selectedVideo.src" class="info-box">
      {{ selectedVideo.fileName }} için dosya kaydı oluşturuldu. Demo yüklemelerinde dosya içeriği
      saklanmaz. Hazır ders videolarını kütüphaneden izleyebilirsiniz.
    </div>
    <div class="video-description">
      <div>
        <Badge :text="selectedVideo.subject" />
        <h3>{{ teacherById(selectedVideo.teacherId).name }}</h3>
        <p>{{ selectedVideo.description }}</p>
      </div>
      <Badge :text="`%${progressFor(selectedVideo)} izlendi`" />
    </div>
    <details v-if="selectedVideo.transcript" class="lesson-transcript">
      <summary>Ders notları ve metin dökümü</summary>
      <p v-for="line in selectedVideo.transcript" :key="line">{{ line }}</p>
    </details>
  </Modal>
  <Modal v-if="modal === 'exit-quiz'" title="Quizden çıkılsın mı?" @close="modal = ''"
    ><p>Bu denemenin yanıtları kaydedilmeyecek. Daha sonra quizi yeniden başlatabilirsiniz.</p>
    <div class="modal-actions">
      <button class="btn" @click="modal = ''">Çözmeye devam et</button
      ><button
        class="btn btn-primary"
        @click="
          () => {
            modal = ''
            activeQuiz = null
          }
        "
      >
        Quizden çık
      </button>
    </div></Modal
  >
</template>
