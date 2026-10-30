import { useState } from 'react'
import { View, Pressable } from 'react-native'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { usePersistentDraft } from '../store/use-persistent-draft.ts'
import DraftStatus from '../ui/DraftStatus.tsx'
import { contentTitle } from '../model/presentation.ts'
import { useActiveSchool, recordError } from '../store/SchoolProvider.tsx'
import { context, nameOf } from '../model/school.ts'
import { operation, type PickedFile } from '../model/operations.ts'
import { waitingLabel } from '../model/experience.ts'
import { pickFile, fileSelectionMessage } from '../lib/files.ts'
import { Badge, Button, Card, Field, T, useColors } from '../ui/components.tsx'
import { DetailPair, Notice, Screen, Section, TextAction } from '../ui/SchoolLayout.tsx'
import DocumentLink from '../ui/DocumentLink.tsx'
import { useMinute } from '../ui/use-minute.ts'
import type { ScreenProps } from '../route-types.ts'

type HomeworkDraft = { file: PickedFile | null; note: string }

export function HomeworkDetail({ route, navigation }: ScreenProps<'Detail'>) {
  const { data, session, commit, busy, notify } = useActiveSchool(),
    scope = context(data, session),
    c = useColors()
  const homework = data.homework.find(
    (h) => h.id === route.params.row.id && h.classId === scope.student.classId,
  )
  const submission = data.submissions.find(
    (s) => s.homeworkId === homework?.id && s.studentId === scope.student.id,
  )
  const draft = usePersistentDraft<HomeworkDraft>(
    'homework',
    homework?.id || route.params.row.id,
    { file: null, note: '' },
    submission?.submittedAt || '',
  )
  const { file, note } = draft.value
  const setFile = (file: PickedFile | null) => draft.set((old) => ({ ...old, file }))
  const setNote = (note: string) => draft.set((old) => ({ ...old, note }))
  const [picking, setPicking] = useState(false),
    [error, setError] = useState(''),
    [extras, setExtras] = useState(false),
    [editing, setEditing] = useState(!submission)
  if (!homework || !data.modules.learning)
    return (
      <Screen>
        <Notice
          title="Ödev kullanılamıyor"
          text="Ödev kaldırılmış veya öğrenme modülü kapatılmış olabilir."
        />
      </Screen>
    )
  async function choose() {
    setPicking(true)
    try {
      const selected = await pickFile({ homework: true })
      if (selected) {
        setFile(selected)
        setError('')
      }
    } catch (err) {
      recordError(err, 'homework-file', 'warn')
      const message = fileSelectionMessage(err)
      setError(message)
      notify(message, 'error')
    } finally {
      setPicking(false)
    }
  }
  const submit = async () => {
    if (!file) {
      setError('Dosya seçilmedi. Teslim için PDF veya görsel ekle.')
      notify('Dosya seçilmedi. Teslim için PDF veya görsel ekle.', 'error')
      return
    }
    const ok = await commit(
      (s, id) => operation(s, session, 'submit', homework).run(s, { file, note }, id),
      'Ödev teslim edildi.',
    )
    if (ok) {
      setEditing(false)
      await draft.clear({ file: null, note: '' })
      setError('')
      setExtras(false)
    }
  }
  const submissionNote = submission?.note ?? ''
  const completed = submission && !editing && !file && !note
  return (
    <Screen
      footer={
        <>
          {completed ? (
            <Button
              primary
              onPress={() => {
                const previous = navigation.getState().routes.at(-2)
                const previousParams: unknown = previous?.params
                const previousPage =
                  typeof previousParams === 'object' &&
                  previousParams !== null &&
                  'page' in previousParams
                    ? previousParams.page
                    : undefined
                if (previous?.name === 'Module' && previousPage === 'odevler') navigation.goBack()
                else navigation.replace('Module', { page: 'odevler' })
              }}
            >
              Ödevlere dön
            </Button>
          ) : (
            <Button accent disabled={busy || picking || !draft.ready} onPress={submit}>
              {busy ? 'Teslim kaydediliyor…' : 'Ödevi teslim et'}
            </Button>
          )}
          {!completed && (
            <TextAction onPress={() => setExtras(!extras)}>
              {extras ? 'Diğer işlemleri gizle ⌃' : 'Diğer işlemler ⌄'}
            </TextAction>
          )}
          {extras && !completed && (
            <>
              <Field
                label="Öğretmene not (isteğe bağlı)"
                value={note}
                onChange={setNote}
                editable={draft.ready}
                multiline
              />
              {file && (
                <TextAction onPress={() => setFile(null)}>Seçilen dosyayı kaldır</TextAction>
              )}
              {submission && (
                <TextAction
                  onPress={() => {
                    setEditing(false)
                    draft.clear({ file: null, note: '' })
                    setError('')
                  }}
                >
                  Değişiklikten vazgeç
                </TextAction>
              )}
            </>
          )}
        </>
      }
    >
      <Card style={{ gap: 14 }}>
        <T muted size={13}>
          {homework.subject} · {scope.student.name} · {scope.classroom.name}
        </T>
        <T bold size={20}>
          {contentTitle(homework.title, homework.subject)}
        </T>
        <View style={{ gap: 14 }}>
          <DetailPair label="Öğretmen" value={nameOf(data, 'teachers', homework.teacherId)} />
          <DetailPair
            label="Son teslim"
            value={dateLabel(homework.dueDate, { hour: '2-digit', minute: '2-digit' })}
          />
        </View>
      </Card>
      <Section panel title="Yapılacak çalışma">
        <T size={15}>{homework.description}</T>
        <DocumentLink type="homework" id={homework.id} studentId={scope.student.id} />
      </Section>
      <Section panel title="Teslimin">
        {!completed && <DraftStatus draft={draft} />}
        {completed ? (
          <>
            <Notice
              tone="green"
              title="Ödev teslim edildi"
              text={`${dateLabel(submission.submittedAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}\n${submission.fileName}`}
            />
            {!!submissionNote && <T muted>{submissionNote}</T>}
            {submission.score != null ? (
              <Notice
                title={`Öğretmen değerlendirmesi · ${submission.score} / 100`}
                text={submission.feedback || 'Ödevin değerlendirildi.'}
              />
            ) : (
              <TextAction
                onPress={() => {
                  setEditing(true)
                  setNote(submissionNote)
                }}
              >
                Teslimi değiştir
              </TextAction>
            )}
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={file ? 'Dosyayı değiştir' : 'Dosya seç'}
              accessibilityState={{ disabled: busy || picking || !draft.ready }}
              disabled={busy || picking || !draft.ready}
              onPress={choose}
              style={{
                minHeight: 104,
                padding: 16,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                borderWidth: 1,
                borderColor: error ? c.red : c.border,
                borderRadius: 10,
              }}
            >
              <T bold size={17} style={{ color: c.primary, textAlign: 'center' }}>
                {picking ? 'Dosya açılıyor…' : file ? file.name : 'Dosya seç'}
              </T>
              <T muted size={13} style={{ textAlign: 'center' }}>
                {file
                  ? `${Math.ceil((file.size || 0) / 1024)} KB · Değiştirmek için dokun`
                  : 'PDF veya görsel · En fazla 10 MB'}
              </T>
            </Pressable>
            {!!error && <Notice tone="red" title="Teslim tamamlanamadı" text={error} />}
          </>
        )}
      </Section>
    </Screen>
  )
}

export function QuestionDetail({ route }: ScreenProps<'Detail'>) {
  useMinute()
  const { data, session, commit, busy, notify } = useActiveSchool()
  const question = data.questions.find((q) => q.id === route.params.row.id && q.teacherId === 't1')
  const student = data.students.find((s) => s.id === question?.studentId)
  const draft = usePersistentDraft(
    'answer',
    route.params.row.id,
    { answer: question?.answer || '' },
    question?.answeredAt || '',
  )
  const { answer } = draft.value
  const setAnswer = (answer: string) => draft.set({ answer })
  const [error, setError] = useState(''),
    [editing, setEditing] = useState(!question?.answeredAt)
  if (!question || !data.modules.learning)
    return (
      <Screen>
        <Notice
          title="Soru kullanılamıyor"
          text="Soru kaldırılmış veya öğrenme modülü kapatılmış olabilir."
        />
      </Screen>
    )
  const showEditor = editing || (draft.ready && answer !== (question.answer || ''))
  const send = async () => {
    if (answer.trim().length < 2 || answer.trim().length > 2000) {
      const message = 'Yanıtın 2–2.000 karakter arasında olmalı.'
      setError(message)
      notify(message, 'error')
      return
    }
    const ok = await commit(
      (s, id) => operation(s, session, 'answer', question).run(s, { answer }, id),
      'Yanıt gönderildi.',
    )
    if (ok) {
      await draft.clear({ answer })
      setError('')
      setEditing(false)
    }
  }
  return (
    <Screen
      footer={
        showEditor ? (
          <Button accent disabled={busy || !draft.ready} onPress={send}>
            {busy ? 'Yanıt kaydediliyor…' : 'Yanıtı gönder'}
          </Button>
        ) : (
          <TextAction onPress={() => setEditing(true)}>Yanıtı düzenle</TextAction>
        )
      }
    >
      <View style={{ gap: 14 }}>
        <T muted size={13}>
          Selin Kaya · {data.subjects.find((s) => s.id === question.subjectId)?.name || 'Matematik'}
        </T>
        <View style={{ gap: 9 }}>
          <T bold size={17}>
            {student?.name} · {nameOf(data, 'classes', student?.classId ?? '')}
          </T>
          <T muted size={14}>
            {question.title} · {waitingLabel(question)}
          </T>
          {!question.answeredAt && +new Date(question.createdAt) < Date.now() - 86400000 && (
            <Badge text="Süre aşıldı" />
          )}
        </View>
      </View>
      <Section panel title="Öğrencinin sorusu">
        <T size={16}>{question.text}</T>
        <T muted size={13}>
          {dateLabel(question.createdAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </T>
        {!!question.fileName && (
          <T muted size={13}>
            Ek: {question.fileName}
          </T>
        )}
      </Section>
      {showEditor ? (
        <View style={{ gap: 12 }}>
          <Field
            label="Yanıtın"
            editable={draft.ready}
            maxLength={2000}
            value={answer}
            onChange={(value) => {
              setAnswer(value)
              setError('')
            }}
            placeholder="Açıklamanı buraya yaz…"
            multiline
            hint="Öğrencinin anlayacağı bir örnek ekleyebilirsin."
          />
          <DraftStatus draft={draft} />
          {!!error && <Notice tone="red" title="Yanıt gönderilemedi" text={error} />}
        </View>
      ) : (
        <Notice tone="green" title="Yanıt gönderildi" text={question.answer}>
          <T muted size={13}>
            {dateLabel(question.answeredAt, { hour: '2-digit', minute: '2-digit' })}
          </T>
        </Notice>
      )}
    </Screen>
  )
}
