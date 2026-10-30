import { contentTitle } from '../model/presentation.js'
import React from 'react'
import { View } from 'react-native'
import { subjects } from '@kampus/school-core/data/curriculum.ts'
import { Avatar, Badge, Card, Icon, T, styles, useColors } from './components.jsx'

const recordIcons = {
  invoice: 'Wallet',
  contract: 'FileText',
  branch: 'Building2',
  class: 'School',
  lesson: 'BookOpen',
  grade: 'Award',
  attendance: 'CalendarCheck2',
  question: 'MessageCircleQuestion',
  homework: 'NotebookPen',
  video: 'Play',
  material: 'FileText',
  quiz: 'ListChecks',
  announcement: 'Megaphone',
  appointment: 'CalendarDays',
  conversation: 'MessagesSquare',
  request: 'Inbox',
  absence: 'CalendarDays',
  submission: 'ClipboardCheck',
  report: 'ChartNoAxesCombined',
}
export function RecordIcon({ row, size = 42 }) {
  const c = useColors()
  if (['student', 'teacher', 'prospect'].includes(row.kind))
    return (
      <Avatar
        name={
          ['homework', 'material', 'video'].includes(row.kind)
            ? contentTitle(row.title, row.subject)
            : row.title
        }
        size={size}
      />
    )
  const subject = subjects.find((s) => s.id === row.source?.subjectId || s.name === row.subject)
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.primarySoft,
      }}
    >
      <Icon
        name={subject?.icon || recordIcons[row.kind] || 'FileText'}
        color={c.primary}
        size={21}
      />
    </View>
  )
}
export default function RecordCard({ row, onPress, compact = false }) {
  const c = useColors()
  return (
    <Card
      onPress={onPress}
      label={`${['homework', 'material', 'video'].includes(row.kind) ? contentTitle(row.title, row.subject) : row.title} detayını aç`}
      style={{ padding: 16, gap: 12 }}
    >
      {row.kind === 'video' && (
        <View
          style={{
            backgroundColor: c.primarySoft,
            borderRadius: 16,
            padding: 20,
            minHeight: 116,
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <T bold size={12} style={{ color: c.primary }}>
            {row.subject || 'Ders videosu'}
          </T>
          <View style={styles.between}>
            <Icon
              name={row.source.subjectId === 'math' ? 'Calculator' : 'FlaskConical'}
              size={34}
              color={c.primary}
            />
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="Play" color={c.primary} size={19} />
            </View>
          </View>
        </View>
      )}
      <View style={[styles.row, { alignItems: 'flex-start', gap: 12 }]}>
        {row.kind !== 'video' && <RecordIcon row={row} />}
        <View style={{ flex: 1, gap: 5 }}>
          <T bold size={15}>
            {['homework', 'material', 'video'].includes(row.kind)
              ? contentTitle(row.title, row.subject)
              : row.title}
          </T>
          {!!row.subtitle && (
            <T muted size={12}>
              {row.subtitle}
            </T>
          )}
        </View>
        {onPress && <Icon name="ChevronRight" size={17} />}
      </View>
      {!compact && !!row.body && (
        <T muted size={14} numberOfLines={2}>
          {row.body}
        </T>
      )}
      {!!row.status && <Badge text={row.status} />}
    </Card>
  )
}
