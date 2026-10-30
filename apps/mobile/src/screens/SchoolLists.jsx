import { contentTitle } from '../model/presentation.ts'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useSchool } from '../store/SchoolProvider.tsx'
import { context, nameOf, rowsFor } from '../model/school.ts'
import { homeworkRows, paymentSummary, waitingLabel } from '../model/experience.ts'
import { Badge, Button, Card, SearchField, Select, Sheet, T, styles } from '../ui/components.jsx'
import {
  ChildSelector,
  EmptyResults,
  ListRow,
  Pagination,
  Screen,
  Tabs,
  TextAction,
} from '../ui/SchoolLayout.jsx'
import { useMinute } from '../ui/use-minute.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'

export default function SchoolList({ kind, navigation }) {
  const { data, session } = useSchool(),
    scope = context(data, session),
    now = useMinute()
  const [tab, setTab] = useState('pending'),
    [query, setQuery] = useState(''),
    [subject, setSubject] = useState(''),
    [status, setStatus] = useState(''),
    [classId, setClassId] = useState(''),
    [order, setOrder] = useState('date'),
    [filters, setFilters] = useState(false),
    [page, setPage] = useState(0)
  const scrollRef = useRef(null),
    payment = kind === 'payment',
    question = kind === 'question'
  const finance = useMemo(
    () => (payment ? paymentSummary(data, session) : null),
    [data, session.childId, payment],
  )
  const rows = useMemo(
    () =>
      payment
        ? finance.rows
        : question
          ? rowsFor(data, session, 'sorular')
          : homeworkRows(data, session),
    [data, session.role, session.childId, payment, question, finance, now],
  )
  const done = (row) =>
    payment ? !!row.source.paidAt : question ? !!row.source.answeredAt : !!row.submission
  const pendingCount = rows.filter((r) => !done(r)).length
  const classFor = (row) =>
    question
      ? data.students.find((s) => s.id === row.source.studentId)?.classId
      : row.source.classId
  const courseFor = (row) =>
    row.source.subject || data.subjects.find((s) => s.id === row.source.subjectId)?.name || ''
  const filtered = rows
    .filter((row) => {
      const search =
        `${row.title} ${row.subtitle} ${row.body} ${courseFor(row)} ${question ? nameOf(data, 'classes', classFor(row)) : ''}`.toLocaleLowerCase(
          'tr',
        )
      return (
        done(row) === (tab === 'done') &&
        (!query.trim() || search.includes(query.trim().toLocaleLowerCase('tr'))) &&
        (!subject || courseFor(row) === subject) &&
        (!status || row.status === status) &&
        (!classId || classFor(row) === classId)
      )
    })
    .sort((a, b) =>
      order === 'name'
        ? a.title.localeCompare(b.title, 'tr')
        : (a.source.dueDate || a.source.createdAt).localeCompare(
            b.source.dueDate || b.source.createdAt,
          ) * (order === 'recent' ? -1 : 1),
    )
  useEffect(() => setPage(0), [query, subject, status, classId, tab, order, session.childId])
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1))
  const activeFilters = [subject, status, classId, order !== 'date'].filter(Boolean).length
  const clear = () => {
    setQuery('')
    setSubject('')
    setStatus('')
    setClassId('')
    setOrder('date')
  }
  const open = (row) => navigation.navigate('Detail', { row })
  const noun = payment ? 'taksit' : question ? 'soru' : 'ödev'
  const statusOptions = [
    ...new Set(rows.filter((r) => done(r) === (tab === 'done')).map((r) => r.status)),
  ].map((value) => ({
    value,
    label: value,
  }))
  return (
    <>
      <Screen
        scrollRef={scrollRef}
        footer={
          payment ? (
            <>
              <TextAction onPress={() => navigation.navigate('Module', { page: 'dekontlar' })}>
                Dekontları gör
              </TextAction>
            </>
          ) : undefined
        }
      >
        {payment ? (
          <>
            <ChildSelector />
            <Card soft style={{ gap: 8 }}>
              <T muted size={13}>
                Kalan tutar
              </T>
              <T bold size={26}>
                {money(finance.balance)}
              </T>
              <T muted size={13}>
                {finance.unpaid.length} taksit ödeme bekliyor
              </T>
              {finance.next && (
                <Button accent onPress={() => open(finance.next)}>
                  Taksit ayrıntısını gör
                </Button>
              )}
            </Card>
          </>
        ) : (
          <T muted size={14}>
            {question
              ? 'Selin Kaya · Matematik'
              : `${scope.student.name} · ${scope.classroom.name}`}
          </T>
        )}
        <View style={{ gap: 12 }}>
          <Tabs
            value={tab}
            onChange={(value) => {
              setTab(value)
              setStatus('')
            }}
            options={[
              {
                value: 'pending',
                label: `${payment ? 'Ödenecek' : 'Bekleyen'} (${pendingCount})`,
              },
              {
                value: 'done',
                label: `${payment ? 'Ödenen' : question ? 'Yanıtlanan' : 'Tamamlanan'} (${rows.length - pendingCount})`,
              },
            ]}
          />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={
              payment ? 'Tutar veya vade ara' : question ? 'Öğrenci veya konu ara' : 'Ödev ara'
            }
          />
          <View style={styles.between}>
            <T muted size={13}>
              {filtered.length} sonuç
            </T>
            <TextAction
              onPress={() => setFilters(true)}
            >{`Filtrele${activeFilters ? ` (${activeFilters})` : ''} ⌄`}</TextAction>
          </View>
        </View>
        <View style={{ gap: 12 }}>
          {filtered.slice(current * 10, current * 10 + 10).map((row) => (
            <ListRow
              card
              key={row.id}
              title={
                payment
                  ? money(row.source.amount)
                  : question
                    ? `${nameOf(data, 'students', row.source.studentId)} · ${nameOf(data, 'classes', classFor(row))}`
                    : contentTitle(row.title, courseFor(row))
              }
              eyebrow={
                payment
                  ? `Eğitim taksiti · ${scope.student.name}`
                  : !question
                    ? courseFor(row)
                    : undefined
              }
              subtitle={
                payment
                  ? `Son ödeme: ${dateLabel(row.source.dueDate, { year: 'numeric' })}`
                  : question
                    ? `${row.title} · ${waitingLabel(row.source)}`
                    : `Son teslim: ${dateLabel(row.source.dueDate, { hour: '2-digit', minute: '2-digit' })}`
              }
              badge={
                <Badge
                  text={
                    question && !row.source.answeredAt && row.status === 'Bekliyor'
                      ? 'Yanıt bekliyor'
                      : !payment && !question && row.status === 'Bekliyor'
                        ? 'Teslim bekliyor'
                        : !payment && !question && row.status === 'Gecikmiş'
                          ? 'Teslim süresi geçti'
                          : row.status
                  }
                />
              }
              onPress={() => open(row)}
            />
          ))}
          {!filtered.length && <EmptyResults noun={noun} onClear={clear} />}
        </View>
        <Pagination
          count={filtered.length}
          index={current}
          onChange={(value) => {
            setPage(value)
            scrollRef.current?.scrollTo({ y: 0, animated: false })
          }}
        />
      </Screen>
      {filters && (
        <Sheet
          compact
          visible
          title={`${payment ? 'Ödeme planı' : question ? 'Soru' : 'Ödev'} filtreleri`}
          onClose={() => setFilters(false)}
          footer={
            <Button primary onPress={() => setFilters(false)}>
              Sonuçları göster
            </Button>
          }
        >
          {!payment && (
            <Select
              label="Ders"
              value={subject}
              onChange={setSubject}
              options={[...new Set(rows.map(courseFor))]
                .filter(Boolean)
                .map((value) => ({ value, label: value }))}
            />
          )}
          {question && (
            <Select
              label="Sınıf"
              value={classId}
              onChange={setClassId}
              options={[...new Set(rows.map(classFor))]
                .filter(Boolean)
                .map((value) => ({ value, label: nameOf(data, 'classes', value) }))}
            />
          )}
          <Select label="Durum" value={status} onChange={setStatus} options={statusOptions} />
          <Select
            label="Sıralama"
            required
            value={order}
            onChange={setOrder}
            options={[
              {
                value: 'date',
                label: payment
                  ? 'Vade: önce en eski'
                  : question
                    ? 'En uzun bekleyen önce'
                    : 'Son teslim: en yakın önce',
              },
              { value: 'recent', label: 'Tarih: yeniden eskiye' },
              { value: 'name', label: 'Ada göre' },
            ]}
          />
          <TextAction onPress={clear}>Filtreleri temizle</TextAction>
        </Sheet>
      )}
    </>
  )
}
