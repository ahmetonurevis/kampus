import { ConversationDetail } from './Conversations.jsx'
import { FormScrollView } from '../ui/KeyboardLayout.jsx'
import React, { useState } from 'react'
import { View } from 'react-native'
import { useSchool, recordError } from '../store/SchoolProvider.tsx'
import { context, rowsFor, nameOf, gradeAverage, absentCount } from '../model/school.ts'
import { recordActions } from '../model/operations.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { Button, Badge, Card, Heading, T, Sheet, styles, useColors } from '../ui/components.jsx'
import { HomeworkDetail, QuestionDetail } from './SchoolDetails.jsx'
import OperationForm from '../ui/OperationForm.jsx'
import { useMinute } from '../ui/use-minute.ts'
import { RecordIcon } from '../ui/RecordCard.jsx'
import { createDocument, shareFile, saveFile, printFile } from '../lib/files.ts'

const pages = {
  invoice: 'finans',
  contract: 'sozlesmeler',
  branch: 'subeler',
  class: 'classes',
  teacher: 'personel',
  prospect: 'adaylar',
  student: 'students',
  lesson: 'ders-programi',
  grade: 'notlarim',
  attendance: 'devamsizlik',
  question: 'sorular',
  homework: 'odevler',
  video: 'videolar',
  material: 'materyaller',
  quiz: 'soru-coz',
  announcement: 'duyurular',
  appointment: 'randevular',
  conversation: 'mesajlar',
  request: 'talepler',
  absence: 'devamsizlik-bildirimi',
  submission: 'ogretmen-degerlendirmeleri',
}
export default function Detail(props) {
  const { session } = useSchool()
  if (props.route.params.row.kind === 'conversation') return <ConversationDetail {...props} />
  if (session.role === 'ogrenci' && props.route.params.row.kind === 'homework')
    return <HomeworkDetail {...props} />
  if (session.role === 'ogretmen' && props.route.params.row.kind === 'question')
    return <QuestionDetail {...props} />
  return <GeneralDetail {...props} />
}
function GeneralDetail({ route, navigation }) {
  useMinute()
  const { data, session, notify } = useSchool(),
    scope = context(data, session),
    c = useColors(),
    [form, setForm] = useState(null),
    [document, setDocument] = useState(null),
    [fileBusy, setFileBusy] = useState(false)
  const original = route.params.row
  const row =
    rowsFor(data, session, pages[original.kind]).find((r) => r.id === original.id) || original
  const record = row.source
  const actions = recordActions(row, session)
  async function documentAction(action) {
    setFileBusy(true)
    try {
      if (row.kind === 'material' && record.fileUri) {
        await shareFile(record.fileUri)
        return
      }
      const result = await createDocument(
        data,
        action.document,
        action.id || record.id,
        scope.institution || scope.teacher ? undefined : scope.student.id,
      )
      setDocument(result)
    } catch (error) {
      recordError(error, 'document')
      notify('Belge hazırlanamadı. Lütfen tekrar deneyin.', 'error')
    } finally {
      setFileBusy(false)
    }
  }
  async function handleDocument(action) {
    setFileBusy(true)
    try {
      if (action === 'save') {
        if (await saveFile(document)) notify('PDF cihazınıza kaydedildi.')
      } else if (action === 'print') await printFile(document)
      else await shareFile(document.uri)
    } catch (error) {
      recordError(error, 'document-action')
      notify('Belge işlemi tamamlanamadı. Yeniden deneyin.', 'error')
    } finally {
      setFileBusy(false)
    }
  }
  return (
    <>
      <FormScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 14 }}>
          <View style={styles.between}>
            <RecordIcon row={row} size={50} />
            <Badge text={row.status} />
          </View>
          <Heading title={row.title} subtitle={row.subtitle} />
        </View>
        {row.kind !== 'conversation' && !!row.body && (
          <Card soft>
            <T>{row.body}</T>
          </Card>
        )}
        <View style={styles.wrap}>
          {actions.map((action) => (
            <Button
              key={action.label}
              disabled={fileBusy}
              icon={action.document ? 'FileDown' : undefined}
              primary={action.label === 'Yanıtla' || action.label === 'Ödeme yap'}
              onPress={() =>
                action.operation
                  ? setForm({ kind: action.operation, record: { ...record, kind: row.kind } })
                  : documentAction(action)
              }
            >
              {action.label}
            </Button>
          ))}
        </View>
        {row.kind === 'invoice' && record.reminderAt && (
          <T muted>
            Son hatırlatma: {dateLabel(record.reminderAt, { hour: '2-digit', minute: '2-digit' })}
          </T>
        )}
        {row.kind === 'question' && (
          <>
            <T muted>
              {nameOf(data, 'students', record.studentId)} ·{' '}
              {nameOf(data, 'teachers', record.teacherId)}
            </T>
            {!!record.fileName && <T muted>Ek: {record.fileName}</T>}
            {!!record.answer && (
              <Card style={{ backgroundColor: c.greenSoft, borderColor: c.greenSoft }}>
                <T bold>Öğretmenin yanıtı</T>
                <T>{record.answer}</T>
                <T muted size={12}>
                  {dateLabel(record.answeredAt, { hour: '2-digit', minute: '2-digit' })}
                </T>
              </Card>
            )}
          </>
        )}
        {row.kind === 'prospect' && (
          <>
            <Card>
              <T bold>İletişim bilgileri</T>
              <T>{record.phone}</T>
              <T>{record.email}</T>
              <T muted>Kaynak: {record.source}</T>
              {!!record.trialAt && (
                <T>Görüşme: {dateLabel(record.trialAt, { hour: '2-digit', minute: '2-digit' })}</T>
              )}
            </Card>
            <T bold size={19}>
              Görüşme geçmişi
            </T>
            {record.notes.map((note) => (
              <Card key={note.id}>
                <T>{note.text}</T>
                <T muted size={12}>
                  {note.author} · {dateLabel(note.date)}
                </T>
              </Card>
            ))}
          </>
        )}
        {row.kind === 'class' && (
          <>
            <Button
              onPress={() => navigation.push('Module', { page: 'students', classId: record.id })}
            >
              Öğrenci listesi
            </Button>
            <Card>
              <T bold>Ders ve öğretmen atamaları</T>
              {data.assignments
                .filter((a) => a.classId === record.id)
                .map((a) => (
                  <View key={a.id} style={{ gap: 3 }}>
                    <T bold>{data.subjects.find((s) => s.id === a.subjectId)?.name}</T>
                    <T muted>{nameOf(data, 'teachers', a.teacherId)}</T>
                  </View>
                ))}
            </Card>
          </>
        )}
        {row.kind === 'branch' && (
          <Button
            onPress={() => navigation.push('Module', { page: 'classes', branchId: record.id })}
          >
            Kampüsün sınıfları
          </Button>
        )}
        {row.kind === 'teacher' && (
          <Card>
            <T>{record.email}</T>
            <T>{record.phone}</T>
            <T bold>Ders verdiği sınıflar</T>
            <T muted>
              {data.classes
                .filter(
                  (cls) =>
                    cls.isActive &&
                    data.assignments.some((a) => a.classId === cls.id && a.teacherId === record.id),
                )
                .map((cls) => cls.name)
                .join(', ') || 'Henüz atama yapılmadı'}
            </T>
          </Card>
        )}
        {row.kind === 'student' && (
          <>
            <Card>
              <T bold size={24}>
                Ortalama {gradeAverage(data, record.id)}
              </T>
              <T muted>{absentCount(data, record.id)} gün devamsızlık</T>
              <T>{record.email}</T>
              <T>{record.phone}</T>
            </Card>
            <T bold size={19}>
              Son notlar
            </T>
            {data.grades
              .filter((g) => g.studentId === record.id)
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 12)
              .map((g) => (
                <Card key={g.id}>
                  <T bold>{g.title}</T>
                  <T>{g.score} / 100</T>
                  <T muted>{dateLabel(g.date)}</T>
                </Card>
              ))}
            <T bold size={19}>
              Devamsızlık geçmişi
            </T>
            {data.attendance
              .filter((a) => a.studentId === record.id && a.status !== 'present')
              .slice(0, 8)
              .map((a) => (
                <T key={a.id}>
                  {dateLabel(a.date)} ·{' '}
                  {{ absent: 'Gelmedi', late: 'Geç geldi', excused: 'Mazeretli' }[a.status]}
                </T>
              ))}
            {data.modules.learning && (
              <>
                <T bold size={19}>
                  Ödev geçmişi
                </T>
                {data.submissions
                  .filter((s) => s.studentId === record.id)
                  .slice(0, 6)
                  .map((s) => (
                    <Card key={s.id}>
                      <T bold>{data.homework.find((h) => h.id === s.homeworkId)?.title}</T>
                      <Badge
                        text={s.score == null ? 'Değerlendirme bekliyor' : `${s.score} / 100`}
                      />
                      <T muted>{s.feedback || s.fileName}</T>
                    </Card>
                  ))}
              </>
            )}
          </>
        )}
        {row.kind === 'homework' && (
          <>
            <T bold size={19}>
              {scope.teacher ? 'Teslimler' : 'Teslimin'}
            </T>
            {data.submissions
              .filter(
                (s) =>
                  s.homeworkId === record.id && (scope.teacher || s.studentId === scope.student.id),
              )
              .map((s) => (
                <Card key={s.id}>
                  <T bold>{nameOf(data, 'students', s.studentId)}</T>
                  <T muted>
                    {s.fileName} · {dateLabel(s.submittedAt)}
                  </T>
                  <Badge text={s.score == null ? 'Değerlendirme bekliyor' : `${s.score} / 100`} />
                  {!!s.feedback && <T>{s.feedback}</T>}
                  {scope.teacher && (
                    <Button onPress={() => setForm({ kind: 'grade', record: s })}>
                      Değerlendir
                    </Button>
                  )}
                  {!!s.fileUri && (
                    <Button
                      onPress={async () => {
                        try {
                          await shareFile(s.fileUri)
                        } catch (error) {
                          recordError(error, 'submission-file')
                          notify('Dosya açılamadı.', 'error')
                        }
                      }}
                    >
                      Teslim dosyasını aç
                    </Button>
                  )}
                </Card>
              ))}
          </>
        )}
        {row.kind === 'quiz' && (
          <>
            <T bold>Soru bankası</T>
            {record.questionIds.map((id) => {
              const q = data.bank.find((q) => q.id === id)
              return (
                <Card key={id}>
                  <T bold>{q.topic}</T>
                  <T>{q.text}</T>
                  {q.options.map((option, i) => (
                    <T key={i}>
                      {String.fromCharCode(65 + i)}. {option}
                    </T>
                  ))}
                  {scope.teacher && (
                    <T muted>
                      Doğru cevap: {String.fromCharCode(65 + q.answer)} · {q.explanation}
                    </T>
                  )}
                </Card>
              )
            })}
          </>
        )}
        {row.kind === 'material' &&
          record.content?.map((text, i) => (
            <Card key={i}>
              <T>{text}</T>
            </Card>
          ))}
        {row.kind === 'lesson' && scope.teacher && (
          <Button
            onPress={() =>
              navigation.push('Module', {
                page: 'yoklama',
                classId: record.classId,
                date: dayKey(record.date),
              })
            }
          >
            Yoklama ekranını aç
          </Button>
        )}
      </FormScrollView>
      {form && <OperationForm key={form.kind} descriptor={form} onClose={() => setForm(null)} />}
      {document && (
        <Sheet visible title="Belgeniz hazır" onClose={() => setDocument(null)}>
          <Card>
            <T bold>{document.name}</T>
            <T muted>Belgeyi PDF olarak kaydedebilir, paylaşabilir veya yazdırabilirsiniz.</T>
          </Card>
          <Button
            primary
            icon="Download"
            disabled={fileBusy}
            onPress={() => handleDocument('save')}
          >
            Cihaza kaydet
          </Button>
          <Button icon="Share2" disabled={fileBusy} onPress={() => handleDocument('share')}>
            Paylaş
          </Button>
          <Button icon="Printer" disabled={fileBusy} onPress={() => handleDocument('print')}>
            Yazdır
          </Button>
        </Sheet>
      )}
    </>
  )
}
