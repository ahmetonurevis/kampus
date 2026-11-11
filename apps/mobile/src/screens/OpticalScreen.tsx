import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { CommonActions } from '@react-navigation/native'
import {
  automationExams,
  automationSchemas,
  prepareProfile,
  previewOptical,
  currentEvaluations,
  runAssessment,
  exampleOpticalFile,
  type OpticalEvaluation,
  type OpticalPreviewRow,
  type QuestionOutcome,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import { recordError } from '../lib/error-log.ts'
import { moduleNavigationState } from '../model/navigation.ts'
import type { FormValues } from '../model/operations.ts'
import type { ScreenProps } from '../route-types.ts'
import { pickTextFile } from '../lib/text-files.ts'
import { userErrorMessage } from '../lib/error-message.ts'
import {
  Badge,
  Button,
  Empty,
  Field,
  Heading,
  Select,
  Sheet,
  T,
  useColors,
} from '../ui/components.tsx'
import { ListRow, Notice, Screen, Section, TextAction } from '../ui/SchoolLayout.tsx'

type OpticalProfile = State['opticalProfiles'][number]
// Önizleme ve kayıtlı sonuçlar aynı satır görünümüyle gösterilir.
type ResultItem = Omit<OpticalPreviewRow, 'studentName' | 'replaces'> & {
  id: string
  subject: string
  studentName: string
  status: string
}
type FieldExtra = Omit<ComponentProps<typeof Field>, 'label' | 'value' | 'onChange'>

const OUTCOME: Record<QuestionOutcome, string> = {
  correct: 'Doğru',
  wrong: 'Yanlış',
  blank: 'Boş',
  multiple: 'Çoklu işaret',
  cancelled: 'İptal',
}
const ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'windows-1254', label: 'Windows-1254 (Türkçe)' },
]
const FORMATS = [
  { value: 'csv', label: 'Cevap sütunlu CSV' },
  { value: 'fixed', label: 'Sabit alanlı DAT/TXT' },
]
const IDENTIFIERS = [
  { value: 'number', label: 'Okul numarası' },
  { value: 'id', label: 'Öğrenci kimliği' },
]
const FIXED_FIELDS = [
  { key: 'headerLines', label: 'Atlanacak başlık satırı' },
  { key: 'studentStart', label: 'Öğrenci alanı başlangıcı' },
  { key: 'studentLength', label: 'Öğrenci alanı uzunluğu' },
  { key: 'bookletStart', label: 'Kitapçık alanı başlangıcı' },
  { key: 'bookletLength', label: 'Kitapçık alanı uzunluğu' },
  { key: 'answersStart', label: 'Cevap alanı başlangıcı' },
  { key: 'answersLength', label: 'Cevap alanı uzunluğu' },
]

// Hata nesnesinden kullanıcıya gösterilecek Türkçe mesajı çıkarır.
function errorMessage(error: unknown) {
  return userErrorMessage(error, 'Dosya işlenemedi. Biçimini ve karakter kodlamasını kontrol edin.')
}

function newKey(state: State, examId: string) {
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
const answersLengthFor = (state: State, examId: string) =>
  (state.mockExams.find((e) => e.id === examId)?.subjectIds.length || 1) * 2

function ResultRow({ row, onPress }: { row: ResultItem; onPress?: () => void }) {
  return (
    <ListRow
      card
      title={`${row.studentName} · ${row.subject}`}
      subtitle={`Kitapçık ${row.booklet} · ${row.correct} doğru / ${row.wrong} yanlış / ${row.blank} boş · ${row.multiple} çoklu · ${row.cancelled} iptal\nNet ${row.net.toLocaleString('tr-TR')}`}
      badge={<Badge text={row.status} />}
      label={`${row.studentName}, ${row.subject}, ayrıntılar`}
      onPress={onPress}
    />
  )
}

function ResultDetail({ row, onClose }: { row: ResultItem | undefined; onClose: () => void }) {
  return (
    <Sheet
      visible
      title={row ? `${row.studentName} · ${row.subject}` : 'Sonuç bulunamadı'}
      onClose={onClose}
    >
      {row ? (
        <>
          <View style={{ gap: 8 }}>
            <T bold size={16}>
              Kazanım başarıları
            </T>
            {row.topicScores.map((topic) => (
              <T key={topic.topic}>
                {topic.topic}:{' '}
                {topic.total
                  ? `%${topic.percent} (${topic.correct}/${topic.total})`
                  : 'Tüm sorular iptal'}
              </T>
            ))}
          </View>
          <View style={{ gap: 8 }}>
            <T bold size={16}>
              Soru ayrıntıları
            </T>
            {row.questionResults.map((question) => (
              <T key={question.number}>
                {question.number}. soru · {question.topic} · {OUTCOME[question.outcome]} · İşaret{' '}
                {(question.response ?? '').trim() || 'boş'} / Anahtar {question.answer}
              </T>
            ))}
          </View>
        </>
      ) : (
        <T>Güncel değerlendirme mevcut rol kapsamında bulunamadı.</T>
      )}
    </Sheet>
  )
}

type ProfileSheetProps = {
  initial: FormValues
  editingId: string
  exams: ReturnType<typeof automationExams>
  onClose: () => void
  onSaved: (id: string) => void
}
function ProfileSheet({ initial, editingId, exams, onClose, onSaved }: ProfileSheetProps) {
  const { data, session, commit, busy, notify } = useActiveSchool(),
    c = useColors()
  const [input, setInput] = useState(initial),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [review, setReview] = useState<ReturnType<typeof prepareProfile> | null>(null),
    [showSubjects, setShowSubjects] = useState(false)
  const set = (key: string, value: unknown) => {
    setInput((old) => ({ ...old, [key]: value }))
    setErrors({})
    setReview(null)
  }
  const changeExam = (examId: string) => {
    setInput((old) => ({
      ...old,
      examId,
      keyCsv: newKey(data, examId),
      answersLength: answersLengthFor(data, examId),
    }))
    setErrors({})
    setReview(null)
  }
  async function submit() {
    if (!review) {
      const parsed = automationSchemas.profile.safeParse(input)
      if (!parsed.success) {
        const next: Record<string, string> = {}
        for (const issue of parsed.error.issues) next[issue.path.join('.')] ||= issue.message
        setErrors(next)
        notify(parsed.error.issues[0]?.message ?? 'Girdiğiniz bilgileri kontrol edin.', 'error')
        return
      }
      try {
        setReview(prepareProfile(data, session, input, editingId))
      } catch (error) {
        recordError(error, 'optical', 'warn')
        notify(errorMessage(error), 'error')
      }
      return
    }
    let savedId = ''
    const ok = await commit((next, makeId) => {
      savedId = runAssessment(next, session, 'profile', input, makeId, editingId).id ?? ''
    }, 'Optik profil kaydedildi.')
    if (ok) onSaved(savedId)
  }
  const text = (key: string, label: string, extra: FieldExtra = {}) => (
    <View key={key} style={{ gap: 6 }}>
      <Field label={label} value={input[key]} onChange={(v) => set(key, v)} {...extra} />
      {!!errors[key] && (
        <T size={13} accessibilityRole="alert" style={{ color: c.red }}>
          {errors[key]}
        </T>
      )}
    </View>
  )
  return (
    <Sheet
      visible
      title={editingId ? 'Optik profil düzenle' : 'Optik profil oluştur'}
      onClose={() => !busy && onClose()}
      footer={
        <View style={{ gap: 10 }}>
          <Button primary disabled={busy} onPress={submit}>
            {busy ? 'Kaydediliyor…' : review ? 'Onayla ve profili kaydet' : 'Profili kontrol et'}
          </Button>
          {review && (
            <Button disabled={busy} onPress={() => setReview(null)}>
              Düzenlemeye dön
            </Button>
          )}
        </View>
      }
    >
      <T muted>
        Anahtar değişikliği önceki kazanım analizlerini geçersiz kılar; cevap dosyaları yeniden
        değerlendirilmelidir.
      </T>
      {!review ? (
        <>
          {text('title', 'Profil adı')}
          <Select
            label="Sınav"
            required
            value={input.examId}
            options={exams.map((exam) => ({ value: exam.id, label: exam.title }))}
            onChange={(value) => !editingId && value && changeExam(value)}
          />
          <Select
            label="Dosya biçimi"
            required
            value={input.format}
            options={FORMATS}
            onChange={(value) => set('format', value)}
          />
          <Select
            label="Öğrenci eşleştirme"
            required
            value={input.identifier}
            options={IDENTIFIERS}
            onChange={(value) => set('identifier', value)}
          />
          {input.format === 'fixed' &&
            FIXED_FIELDS.map((field) =>
              text(field.key, field.label, { keyboard: 'numeric', maxLength: 5 }),
            )}
          {text('keyCsv', 'Cevap anahtarı ve kazanımlar', {
            multiline: true,
            maxLength: 1048576,
            hint: 'Başlık: booklet;question;subjectId;topic;answer. Soru numaraları her kitapçıkta 1’den başlar. İptal soru cevabı - olmalıdır.',
          })}
          <TextAction onPress={() => setShowSubjects((open) => !open)}>
            {showSubjects ? 'Ders kimliklerini gizle' : 'Ders kimlikleri'}
          </TextAction>
          {showSubjects &&
            data.subjects.map((subject) => (
              <T key={subject.id} muted size={13}>
                {subject.id} · {subject.name}
              </T>
            ))}
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <T bold size={17}>
            Profil kontrolü
          </T>
          <T>
            {review.title} · {review.format === 'csv' ? 'CSV' : 'DAT/TXT'} ·{' '}
            {review.identifier === 'number' ? 'Okul numarası' : 'Öğrenci kimliği'}
          </T>
          {review.keys.map((key) => (
            <T key={key.booklet}>
              {key.booklet} kitapçığı: {key.questions.length} soru ·{' '}
              {key.questions.filter((q) => q.answer === '-').length} iptal soru
            </T>
          ))}
          <T muted>Anahtar sürümü: {review.revision}</T>
        </View>
      )}
    </Sheet>
  )
}

export default function OpticalScreen({ navigation }: ScreenProps<'Module'>) {
  const { data, session, commit, busy, notify } = useActiveSchool(),
    c = useColors()
  const exams = useMemo(() => automationExams(data, session), [data, session.role, session.childId])
  const profiles = useMemo(
    () => data.opticalProfiles.filter((p) => exams.some((e) => e.id === p.examId)),
    [data.opticalProfiles, exams],
  )
  const [profileId, setProfileId] = useState(profiles[0]?.id || ''),
    [text, setText] = useState(''),
    [encoding, setEncoding] = useState('utf-8'),
    [importing, setImporting] = useState(false),
    [preview, setPreview] = useState<OpticalPreviewRow[] | null>(null),
    [error, setError] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [profileInput, setProfileInput] = useState<FormValues | null>(null),
    [editingId, setEditingId] = useState(''),
    [showKey, setShowKey] = useState(false)
  const readRequest = useRef(0)
  const profile = profiles.find((p) => p.id === profileId)
  useEffect(() => {
    if (!profiles.some((p) => p.id === profileId)) setProfileId(profiles[0]?.id || '')
  }, [profiles, profileId])
  useEffect(() => {
    setPreview(null)
    setError('')
  }, [text, profileId, profile?.revision, data.modules.exams])
  useEffect(() => {
    readRequest.current++
    setText('')
    setImporting(false)
    setShowKey(false)
  }, [profileId])

  const subjectName = (id: string) => data.subjects.find((s) => s.id === id)?.name || id
  const present = (row: OpticalPreviewRow | OpticalEvaluation, status: string): ResultItem => ({
    ...row,
    id: ('id' in row && row.id) || `${row.studentId}-${row.subjectId}`,
    subject: subjectName(row.subjectId),
    studentName:
      data.students.find((s) => s.id === row.studentId)?.name ||
      ('studentName' in row ? row.studentName : ''),
    status,
  })
  const previewRows = useMemo(
    () =>
      (preview || []).map((row) =>
        present(row, row.replaces ? 'Mevcut sonucu günceller' : 'Yeni değerlendirme'),
      ),
    [preview, data.students, data.subjects],
  )
  const results = useMemo(
    () =>
      profile
        ? currentEvaluations(data, profile.examId, session).map((row) =>
            present(row, 'Değerlendirildi'),
          )
        : [],
    [data, profile, session.role, session.childId],
  )
  const selected = results.find((r) => r.id === selectedId)
  const keyRows = useMemo(
    () =>
      profile?.keys.flatMap((k) =>
        k.questions.map(
          (q) => `${k.booklet}-${q.number}. ${subjectName(q.subjectId)} · ${q.topic} · ${q.answer}`,
        ),
      ) || [],
    [profile, data.subjects],
  )

  function showError(value: unknown) {
    recordError(value, 'optical', 'warn')
    const message = errorMessage(value)
    setError(message)
    notify(message, 'error')
  }
  async function chooseFile() {
    const request = ++readRequest.current
    setImporting(true)
    try {
      const file = await pickTextFile({ extensions: ['csv', 'dat', 'txt'], encoding })
      if (file && request === readRequest.current) setText(file.text)
    } catch (exception) {
      if (request === readRequest.current) showError(exception)
    } finally {
      if (request === readRequest.current) setImporting(false)
    }
  }
  function evaluate() {
    setError('')
    try {
      setPreview(previewOptical(data, session, { profileId, text }))
    } catch (exception) {
      setPreview(null)
      showError(exception)
    }
  }
  async function save() {
    if (!preview) return
    const ok = await commit(
      (next, makeId) =>
        runAssessment(
          next,
          session,
          'evaluate',
          { profileId, text, expectedPreview: JSON.stringify(preview) },
          makeId,
        ),
      'Optik sonuçlar kaydedildi.',
    )
    if (ok) {
      setPreview(null)
      setText('')
    }
  }
  function loadSample(target: OpticalProfile) {
    try {
      setText(exampleOpticalFile(data, target, session))
    } catch (exception) {
      showError(exception)
    }
  }
  function openProfile(existing?: OpticalProfile) {
    setEditingId(existing?.id || '')
    const examId =
      existing?.examId ||
      exams.find((e) => !data.opticalProfiles.some((p) => p.examId === e.id))?.id ||
      exams[0]?.id ||
      ''
    setProfileInput(
      existing
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
            answersLength: answersLengthFor(data, examId),
            keyCsv: newKey(data, examId),
          },
    )
    setError('')
  }
  // `navigation.reset` kök rota listesine bağlı tiplidir; dispatch aynı eylemi gevşek tipli gönderir.
  const openTutoring = () =>
    navigation.dispatch(
      CommonActions.reset(moduleNavigationState(navigation.getState(), 'otomatik-etut')),
    )

  if (!data.modules.optical)
    return (
      <Screen>
        <Notice
          title="Modül kullanıma kapalı"
          text="Yönetici modül ayarlarını değiştirebilir."
          tone="amber"
        />
      </Screen>
    )
  const manager = session.role === 'yonetici'
  return (
    <Screen>
      <Heading
        title="Optik Değerlendirme"
        subtitle="Cevap dosyalarını kitapçık anahtarıyla değerlendirip kazanım eksiklerini bulun."
      />
      {!data.modules.exams ? (
        <Notice
          title="Deneme sınavları modülü kapalı"
          text="Optik değerlendirme için yönetici bu modülü açmalıdır."
          tone="amber"
        />
      ) : (
        <>
          {manager && (
            <Button primary icon="Plus" onPress={() => openProfile()}>
              Optik profil oluştur
            </Button>
          )}
          <Section title="Cevap dosyasını değerlendir" panel>
            <T muted size={14}>
              Önizleme kayıtları değiştirmez. Son onay, aynı sınav/öğrenci/ders sonucunu günceller.
            </T>
            <Select
              label="Optik profil"
              value={profileId}
              options={profiles.map((p) => ({ value: p.id, label: p.title }))}
              onChange={setProfileId}
              required
            />
            {profile ? (
              <>
                <Button onPress={() => loadSample(profile)}>Örnek cevap dosyasını yükle</Button>
                {manager && <Button onPress={() => openProfile(profile)}>Profili düzenle</Button>}
                {data.modules.tutoring && (
                  <Button onPress={openTutoring}>Otomatik etüt planla</Button>
                )}
                <TextAction onPress={() => setShowKey((open) => !open)}>
                  {showKey ? 'Cevap anahtarını gizle' : 'Cevap anahtarını göster'}
                </TextAction>
                {showKey && (
                  <View style={{ gap: 4 }}>
                    {keyRows.map((line) => (
                      <T key={line} muted size={12}>
                        {line}
                      </T>
                    ))}
                  </View>
                )}
                <T size={14}>
                  {profile.format === 'csv'
                    ? `CSV başlıkları: student;booklet;answers. Öğrenci alanı ${profile.identifier === 'number' ? 'okul numarası' : 'öğrenci kimliği'} içerir.`
                    : `DAT/TXT konumları (1’den başlar): öğrenci ${profile.studentStart}–${profile.studentStart + profile.studentLength - 1}, kitapçık ${profile.bookletStart}–${profile.bookletStart + profile.bookletLength - 1}, cevap ${profile.answersStart}–${profile.answersStart + profile.answersLength - 1}. Atlanan başlık satırı: ${profile.headerLines}.`}
                </T>
                <T muted size={13}>
                  A–E cevap; boş için - / . / _ / boşluk; çoklu işaret için *. İptal sorular net ve
                  kazanım oranından çıkarılır. Çoklu işaret yanlış sayılır.
                </T>
                <Select
                  label="Karakter kodlaması"
                  value={encoding}
                  options={ENCODINGS}
                  onChange={setEncoding}
                  required
                />
                <Button icon="Paperclip" disabled={importing} onPress={chooseFile}>
                  {importing ? 'Dosya okunuyor…' : 'Optik cevap dosyası seç'}
                </Button>
                <Field
                  label="Optik dosya içeriği"
                  value={text}
                  onChange={setText}
                  multiline
                  maxLength={1048576}
                />
                {!!error && (
                  <T accessibilityRole="alert" style={{ color: c.red }}>
                    {error}
                  </T>
                )}
                <Button primary disabled={importing || !text} onPress={evaluate}>
                  {importing ? 'Dosya okunuyor…' : 'Sonuçları önizle'}
                </Button>
              </>
            ) : (
              <T muted>
                Bu sınav için yönetici cevap anahtarı ve dosya alanlarını tanımlayan bir profil
                oluşturabilir.
              </T>
            )}
          </Section>
          {preview && (
            <Section title="Değerlendirme önizlemesi" panel>
              <T muted size={14}>
                {new Set(preview.map((r) => r.studentId)).size} öğrenci · {preview.length} ders
                sonucu. Mevcut sonuçlar aşağıda belirtilmiştir.
              </T>
              {previewRows.map((row) => (
                <ResultRow key={row.id} row={row} />
              ))}
              <Button primary disabled={busy} onPress={save}>
                {busy ? 'Kaydediliyor…' : 'Onayla ve sonuçları kaydet'}
              </Button>
              <Button onPress={() => setPreview(null)}>Önizlemeyi kapat</Button>
            </Section>
          )}
          <Section title="Kayıtlı optik sonuçlar">
            <T muted size={14}>
              Güncel cevap anahtarıyla değerlendirilen sonuçlar gösterilir. Anahtar değişirse
              dosyayı yeniden değerlendirin.
            </T>
            {results.length ? (
              results.map((row) => (
                <ResultRow key={row.id} row={row} onPress={() => setSelectedId(row.id)} />
              ))
            ) : (
              <Empty title="Sonuç yok" text="Henüz güncel optik değerlendirme yok." />
            )}
          </Section>
        </>
      )}
      {selectedId && <ResultDetail row={selected} onClose={() => setSelectedId('')} />}
      {profileInput && (
        <ProfileSheet
          key={editingId || 'new'}
          initial={profileInput}
          editingId={editingId}
          exams={exams}
          onClose={() => setProfileInput(null)}
          onSaved={(id) => {
            setProfileInput(null)
            setProfileId(id)
          }}
        />
      )}
    </Screen>
  )
}
