import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { workflowPage } from '@kampus/school-core/modules/school-workflows.js'
import {
  workflowRows,
  workflowDetails,
  workflowCreateActions,
} from '@kampus/school-core/lib/workflow-presentation.js'
import { dateLabel } from '@kampus/school-core/lib/format.js'
import { useSchool } from '../store/SchoolProvider.jsx'
import { Badge, Button, Empty, Heading, SearchField, Sheet, T } from '../ui/components.jsx'
import { ListRow, Notice, Pagination, Screen, Section, Tabs } from '../ui/SchoolLayout.jsx'
import DocumentLink from '../ui/DocumentLink.jsx'
import WorkflowFormSheet from '../ui/WorkflowFormSheet.jsx'

const PAGE_SIZE = 12

function Detail({ row, onClose, onAction }) {
  const { data, session } = useSchool()
  const detail = workflowDetails(data, session, row)
  return (
    <Sheet visible title={row.title} onClose={onClose}>
      <Badge text={row.status} />
      {detail.sections.map((section) => (
        <View key={section.title} style={{ gap: 8 }}>
          <T bold size={16}>
            {section.title}
          </T>
          {section.lines.length ? (
            section.lines.map((line, index) => <T key={index}>{line}</T>)
          ) : (
            <T muted>Henüz kayıt yok.</T>
          )}
        </View>
      ))}
      {detail.documents.map((doc) => (
        <DocumentLink
          key={doc.id}
          type={doc.type}
          id={doc.id}
          studentId={doc.studentId}
          title={doc.title}
        />
      ))}
      <View style={{ gap: 10 }}>
        {detail.actions.map((item, index) => (
          <Button key={`${item.command}-${item.recordId}-${index}`} onPress={() => onAction(item)}>
            {item.label}
          </Button>
        ))}
      </View>
    </Sheet>
  )
}

export default function WorkflowScreen({ route }) {
  const { data, session } = useSchool()
  const page = route.params.page
  const definition = workflowPage(page)
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [index, setIndex] = useState(0),
    [selectedId, setSelectedId] = useState(''),
    [form, setForm] = useState(null)
  const rows = useMemo(
    () => workflowRows(data, session, page),
    [data, session.role, session.childId, page],
  )
  const createActions = workflowCreateActions(data, session, page)
  const statuses = useMemo(() => [...new Set(rows.map((row) => row.status))], [rows])
  const filtered = useMemo(() => {
    const search = query.toLocaleLowerCase('tr')
    return rows.filter(
      (row) =>
        (!status || row.status === status) &&
        (!search ||
          `${row.title} ${row.subtitle} ${row.body}`.toLocaleLowerCase('tr').includes(search)),
    )
  }, [rows, query, status])
  useEffect(() => setIndex(0), [query, status, page, session.childId])
  useEffect(() => setSelectedId(''), [page, session.childId])
  const last = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1),
    current = Math.min(index, last),
    visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const selected = rows.find((row) => row.id === selectedId)
  if (!definition || !data.modules[definition.key])
    return (
      <Screen>
        <Notice
          title="Modül kullanıma kapalı"
          text="Yönetici modül ayarlarını değiştirebilir."
          tone="amber"
        />
      </Screen>
    )
  return (
    <Screen>
      <Heading title={definition.title} subtitle={definition.description} />
      {createActions.map((item, order) => (
        <Button key={item.command} primary={order === 0} icon="Plus" onPress={() => setForm(item)}>
          {item.label}
        </Button>
      ))}
      <Section title={`${filtered.length} kayıt`}>
        <SearchField value={query} onChange={setQuery} placeholder="Başlık, kapsam veya özet" />
        {statuses.length > 1 && (
          <Tabs
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Tümü' },
              ...statuses.map((item) => ({ value: item, label: item })),
            ]}
          />
        )}
        {visible.length ? (
          <View style={{ gap: 12 }}>
            {visible.map((row) => (
              <ListRow
                key={row.id}
                card
                title={row.title}
                eyebrow={dateLabel(row.date, { year: 'numeric' })}
                subtitle={`${row.subtitle}\n${row.body}`}
                badge={<Badge text={row.status} />}
                label={`${row.title}, ayrıntılar`}
                onPress={() => setSelectedId(row.id)}
              />
            ))}
          </View>
        ) : (
          <Empty
            title="Kayıt bulunamadı"
            text={
              rows.length
                ? 'Aramayı veya durum filtresini değiştirin.'
                : 'Henüz kayıt yok. Yetkili rolden yeni kayıt ekleyebilirsiniz.'
            }
          />
        )}
        <Pagination
          count={filtered.length}
          index={current}
          pageSize={PAGE_SIZE}
          onChange={setIndex}
        />
      </Section>
      {selectedId && (
        <>
          {selected ? (
            <Detail row={selected} onClose={() => setSelectedId('')} onAction={setForm} />
          ) : (
            <Sheet visible title="Kayıt bulunamadı" onClose={() => setSelectedId('')}>
              <T>Kayıt mevcut rol veya çocuk kapsamında bulunamadı. Listeye dönüp yeniden seçin.</T>
            </Sheet>
          )}
        </>
      )}
      {form && (
        <WorkflowFormSheet
          key={`${form.command}-${form.recordId}`}
          descriptor={form}
          onClose={() => setForm(null)}
        />
      )}
    </Screen>
  )
}
