import { useState } from 'react'
import { View } from 'react-native'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import type { ArchiveKind } from '@kampus/school-core/lib/school-management.ts'
import { useActiveSchool, recordError } from '../store/SchoolProvider.tsx'
import {
  context,
  rowsFor,
  nameOf,
  gradeAverage,
  absentCount,
  type Row,
  type RowKind,
} from '../model/school.ts'
import { recordActions, str, type OperationRecord } from '../model/operations.ts'
import type { ScreenProps } from '../route-types.ts'
import { Button, Badge, Card, Heading, T, Sheet, styles, useColors } from '../ui/components.tsx'
import { FormScrollView } from '../ui/KeyboardLayout.tsx'
import OperationForm, { type OperationDescriptor } from '../ui/OperationForm.tsx'
import { useMinute } from '../ui/use-minute.ts'
import { RecordIcon } from '../ui/RecordCard.tsx'
import { createDocument, shareFile, saveFile, printFile, type PdfDocument } from '../lib/files.ts'
import { ConversationDetail } from './Conversations.tsx'
import { HomeworkDetail, QuestionDetail } from './SchoolDetails.tsx'

const pages: Partial<Record<RowKind, string>> = {
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
// Arşiv işlemleri kayıt türünü okur; diğer kayıtlar tür taşımaz.
const isArchiveKind = (kind: RowKind): kind is ArchiveKind =>
  kind === 'branch' || kind === 'class' || kind === 'teacher'
const operationRecord = (row: Row): OperationRecord =>
  isArchiveKind(row.kind) ? { ...row.source, kind: row.kind } : { ...row.source }
// Core kayıt tiplerinde `fileUri` yok; telefon dosyayı yüklerken kayda yazar.
const fileUriOf = (record: object) => ('fileUri' in record ? str(record.fileUri) : '')

export default function Detail(props: ScreenProps<'Detail'>) {
  const { session } = useActiveSchool()
  if (props.route.params.row.kind === 'conversation') return <ConversationDetail {...props} />
  if (session.role === 'ogrenci' && props.route.params.row.kind === 'homework')
    return <HomeworkDetail {...props} />
  if (session.role === 'ogretmen' && props.route.params.row.kind === 'question')
    return <QuestionDetail {...props} />
  return <GeneralDetail {...props} />
}
function GeneralDetail({ route, navigation }: ScreenProps<'Detail'>) {
  useMinute()
  const { data, session, notify } = useActiveSchool(),
    scope = context(data, session),
    c = useColors(),
    [form, setForm] = useState<OperationDescriptor | null>(null),
    [document, setDocument] = useState<PdfDocument | null>(null),
    [fileBusy, setFileBusy] = useState(false)
  const original = route.params.row
  const row: Row =
    rowsFor(data, session, pages[original.kind] ?? '').find((r) => r.id === original.id) || original
  // Tür ve kaynak birlikte ayrıştırılır; `kind` kontrolü `record` tipini daraltır.
  const { kind, source: record } = row
  const actions = recordActions(row, session)
  async function documentAction(action: (typeof actions)[number]) {
    setFileBusy(true)
    try {
      if (kind === 'material' && fileUriOf(record)) {
        await shareFile(fileUriOf(record))
        return
      }
      if (!action.document) throw new Error('Belge türü bulunamadı.')
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
  async function handleDocument(action: 'save' | 'share' | 'print', file: PdfDocument) {
    setFileBusy(true)
    try {
      if (action === 'save') {
        if (await saveFile(file)) notify('PDF cihazınıza kaydedildi.')
      } else if (action === 'print') await printFile(file)
      else await shareFile(file.uri)
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
          <Heading title={row.title ?? ''} subtitle={row.subtitle} />
        </View>
        {kind !== 'conversation' && !!row.body && (
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
                  ? setForm({ kind: action.operation, record: operationRecord(row) })
                  : documentAction(action)
              }
            >
              {action.label}
            </Button>
          ))}
        </View>
        {kind === 'invoice' && record.reminderAt && (
          <T muted>
            Son hatırlatma: {dateLabel(record.reminderAt, { hour: '2-digit', minute: '2-digit' })}
          </T>
        )}
        {kind === 'question' && (
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
        {kind === 'prospect' && (
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
        {kind === 'class' && (
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
        {kind === 'branch' && (
          <Button
            onPress={() => navigation.push('Module', { page: 'classes', branchId: record.id })}
          >
            Kampüsün sınıfları
          </Button>
        )}
        {kind === 'teacher' && (
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
        {kind === 'student' && (
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
              .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
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
        {kind === 'homework' && (
          <>
            <T bold size={19}>
              {scope.teacher ? 'Teslimler' : 'Teslimin'}
            </T>
            {data.submissions
              .filter(
                (s) =>
                  s.homeworkId === record.id && (scope.teacher || s.studentId === scope.student.id),
              )
              .map((s) => {
                const fileUri = fileUriOf(s)
                return (
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
                    {!!fileUri && (
                      <Button
                        onPress={async () => {
                          try {
                            await shareFile(fileUri)
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
                )
              })}
          </>
        )}
        {kind === 'quiz' && (
          <>
            <T bold>Soru bankası</T>
            {record.questionIds.map((id) => {
              const q = data.bank.find((q) => q.id === id)
              if (!q) throw new Error('Soru bankası kaydı bulunamadı.')
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
        {kind === 'material' &&
          record.content?.map((text, i) => (
            <Card key={i}>
              <T>{text}</T>
            </Card>
          ))}
        {kind === 'lesson' && scope.teacher && (
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
            onPress={() => handleDocument('save', document)}
          >
            Cihaza kaydet
          </Button>
          <Button
            icon="Share2"
            disabled={fileBusy}
            onPress={() => handleDocument('share', document)}
          >
            Paylaş
          </Button>
          <Button
            icon="Printer"
            disabled={fileBusy}
            onPress={() => handleDocument('print', document)}
          >
            Yazdır
          </Button>
        </Sheet>
      )}
    </>
  )
}
