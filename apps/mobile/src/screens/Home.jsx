import React, { useMemo } from 'react'
import { ScrollView, View, Pressable } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { useSchool } from '../store/SchoolProvider.jsx'
import { homeSummary, roles, availablePages } from '../model/school.js'
import { moduleNavigationState } from '../model/navigation.js'
import { useMinute } from '../ui/use-minute.js'
import { dateLabel, dayKey, money, timeLabel } from '@kampus/school-core/lib/format.js'
import { Avatar, Button, Card, Icon, T, styles, useColors } from '../ui/components.jsx'
import RoleHome from './RoleHome.jsx'
import RecordCard from '../ui/RecordCard.jsx'
import ModuleHub from '../ui/ModuleHub.jsx'

function Section({ title, action, onPress, children }) {
  const c = useColors()
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.between, { minHeight: 48 }]}>
        <T bold size={18} style={{ flex: 1, letterSpacing: -0.3 }}>
          {title}
        </T>
        {onPress && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            onPress={onPress}
            style={{ minHeight: 48, justifyContent: 'center', paddingLeft: 8 }}
          >
            <T bold size={13} style={{ color: c.primary }}>
              {action}
            </T>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  )
}
function Stat({ stat, icon, narrow = false }) {
  const c = useColors()
  return (
    <View
      style={{
        flexBasis: narrow ? '28%' : '45%',
        flexGrow: 1,
        backgroundColor: c.soft,
        borderRadius: 20,
        padding: narrow ? 13 : 16,
        gap: 10,
      }}
    >
      <View style={[styles.row, { gap: 7 }]}>
        <Icon name={icon} size={16} />
        <T muted size={12} style={{ flex: 1 }}>
          {stat.label}
        </T>
      </View>
      <T bold size={String(stat.value).length > 12 ? 18 : 24} style={{ letterSpacing: -0.6 }}>
        {stat.value}
      </T>
    </View>
  )
}
export default function Home(props) {
  const { session } = useSchool()
  return ['ogrenci', 'veli', 'ogretmen'].includes(session.role) ? (
    <RoleHome {...props} />
  ) : (
    <InstitutionHome {...props} />
  )
}
function InstitutionHome({ navigation }) {
  const minute = useMinute()
  const { data, session, preference } = useSchool(),
    c = useColors()
  const { scope, stats, lessons, important, trend } = useMemo(
    () => homeSummary(data, session),
    [data, session.role, session.childId, minute],
  )
  const isParent = session.role === 'veli',
    isStudent = session.role === 'ogrenci'
  const isManager = session.role === 'yonetici'
  const visiblePages = availablePages(data, session.role)
  const canOpen = (page) => visiblePages.some((p) => p.path === page)
  const open = (page) => navigation.reset(moduleNavigationState(navigation.getState(), page))
  const detail = (row) => navigation.push('Detail', { row })
  const next = lessons.find(
    (r) => +new Date(r.source.date) + r.source.duration * 60000 > Date.now(),
  )
  const importantPage = isManager
    ? 'finans'
    : scope.institution
      ? 'adaylar'
      : scope.teacher
        ? 'sorular'
        : 'odevler'
  const importantTitle = isManager
    ? 'Tahsilat takibi'
    : scope.institution
      ? 'Sıradaki görüşmeler'
      : scope.teacher
        ? 'Yanıt bekleyen sorular'
        : isParent
          ? 'Ödev takibi'
          : 'Sıradaki ödevlerin'
  const statIndexes = isParent
    ? [1, 2]
    : scope.teacher
      ? [2, 3]
      : isManager && data.modules.finance
        ? [0, 2, 3]
        : isStudent
          ? [0, 1]
          : [0, 1, 2, 3]
  const importantEnabled =
    data.modules[isManager ? 'finance' : scope.institution ? 'crm' : 'learning']
  const icons = scope.teacher
    ? ['School', 'CalendarDays', 'MessagesSquare', 'ClipboardCheck']
    : scope.institution
      ? isManager
        ? ['UsersRound', 'Wallet', 'Building2', 'Timer']
        : ['UsersRound', 'UserRoundPlus', 'CalendarDays', 'Inbox']
      : ['Award', 'CalendarCheck2', 'NotebookPen', isParent ? 'Wallet' : 'ListChecks']
  const max = Math.max(...trend, 1)
  const points = trend.map((value, i) => `${8 + i * 58},${66 - (value / max) * 52}`).join(' ')
  return (
    <ScrollView
      contentContainerStyle={[styles.page, { gap: 22 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <T muted size={12}>
          {dateLabel(new Date(), { weekday: 'long', year: 'numeric' })}
        </T>
        <T
          bold
          size={27}
          style={{ letterSpacing: -0.8 }}
        >{`Merhaba, ${roles[session.role].name.split(' ')[0]}`}</T>
        <T muted size={14}>
          {isParent
            ? 'Okul hayatının her adımında yanında.'
            : isStudent
              ? 'Bugün öğrenmek için güzel bir gün.'
              : scope.teacher
                ? 'Yeni bir gün, yeni keşifler.'
                : 'Okulunuzun güncel özeti burada.'}
        </T>
      </View>

      <ModuleHub navigation={navigation} />

      {isParent && (
        <View style={{ gap: 16 }}>
          <View style={styles.wrap}>
            {data.parents[0].studentIds.map((id) => {
              const student = data.students.find((s) => s.id === id)
              const selected = scope.student.id === id
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={`${student.name} profilini seç`}
                  accessibilityState={{ selected }}
                  onPress={() => preference({ childId: id })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: 48,
                    paddingHorizontal: 14,
                    gap: 8,
                    borderRadius: 24,
                    backgroundColor: selected ? c.primary : c.soft,
                  }}
                >
                  <Icon name="GraduationCap" size={18} color={selected ? c.onPrimary : c.muted} />
                  <T bold size={14} style={{ color: selected ? c.onPrimary : c.muted }}>
                    {student.name.split(' ')[0]}
                  </T>
                  {selected && <Icon name="Check" size={15} color={c.onPrimary} />}
                </Pressable>
              )
            })}
          </View>
          <Card soft style={{ backgroundColor: c.primarySoft, padding: 20, gap: 18 }}>
            <View style={styles.row}>
              <Avatar name={scope.student.name} size={48} />
              <View style={{ flex: 1, gap: 3 }}>
                <T bold size={19}>
                  {scope.student.name}
                </T>
                <T muted size={13}>
                  {scope.classroom.name} · {scope.classroom.level}
                </T>
              </View>
              <Icon name="GraduationCap" size={25} color={c.primary} />
            </View>
            <View style={styles.between}>
              <T muted size={13}>
                Genel not ortalaması
              </T>
              <T bold size={27} style={{ color: c.primary }}>
                {stats[0].value}
                <T muted size={13}>
                  {' '}
                  / 100
                </T>
              </T>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Genel not ortalaması"
              accessibilityValue={{ min: 0, max: 100, now: Number(stats[0].value) }}
              style={{ height: 6, borderRadius: 3, backgroundColor: c.surface }}
            >
              <View
                style={{
                  width: `${Math.min(100, Math.max(0, Number(stats[0].value)))}%`,
                  backgroundColor: c.primary,
                  height: 6,
                  borderRadius: 3,
                }}
              />
            </View>
            {canOpen('akademik-takip') && (
              <Button
                icon="ArrowUpRight"
                onPress={() => open('akademik-takip')}
                style={{ backgroundColor: c.surface }}
              >
                Akademik gelişimi incele
              </Button>
            )}
          </Card>
        </View>
      )}

      {(isStudent || scope.teacher) && data.modules.academic && (
        <Card soft style={{ backgroundColor: c.hero, padding: 22, gap: 17 }}>
          <View style={styles.between}>
            <View style={[styles.row, { gap: 7 }]}>
              <Icon name="CalendarDays" size={16} color={c.heroMuted} />
              <T size={12} bold style={{ color: c.heroMuted }}>
                {next
                  ? +new Date(next.source.date) <= Date.now()
                    ? 'DEVAM EDEN DERS'
                    : 'SIRADAKİ DERS'
                  : 'DERS PROGRAMIN'}
              </T>
            </View>
            <View
              style={{
                backgroundColor: c.heroSoft,
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <T size={12} style={{ color: c.heroText }}>
                {scope.teacher ? `${stats[1].value} ders bugün` : scope.classroom.name}
              </T>
            </View>
          </View>
          <View style={{ gap: 5 }}>
            <T bold size={24} style={{ color: c.heroText, letterSpacing: -0.5 }}>
              {next?.title || 'Bugün sana zaman kalsın.'}
            </T>
            <T size={13} style={{ color: c.heroMuted }}>
              {next
                ? `${dateLabel(next.source.date, { weekday: 'short' })} · ${timeLabel(next.source.date)} · ${next.source.duration} dk`
                : 'Yaklaşan derslerini programından takip edebilirsin.'}
            </T>
            {!!next && (
              <T size={13} style={{ color: c.heroMuted }}>
                {next.body.replace('\n', ' · ')}
              </T>
            )}
          </View>
          <Button
            accent
            icon={scope.teacher && canOpen('yoklama') ? 'ClipboardCheck' : 'ArrowRight'}
            onPress={() =>
              scope.teacher && canOpen('yoklama')
                ? navigation.push('Module', {
                    page: 'yoklama',
                    classId: next?.source.classId,
                    date: next ? dayKey(next.source.date) : dayKey(),
                  })
                : open('ders-programi')
            }
            style={{ alignSelf: 'flex-start', borderRadius: 25 }}
          >
            {scope.teacher && canOpen('yoklama') ? 'Yoklamayı aç' : 'Programı gör'}
          </Button>
        </Card>
      )}

      {isManager && data.modules.finance && (
        <Card soft style={{ backgroundColor: c.hero, padding: 22, gap: 12 }}>
          <View style={styles.between}>
            <T size={13} style={{ color: c.heroMuted }}>
              Bu ay tahsilat
            </T>
            <Icon name="ChartNoAxesCombined" color={c.heroMuted} />
          </View>
          <T bold size={28} style={{ color: c.heroText, letterSpacing: -0.8 }}>
            {stats[1].value}
          </T>
          <View
            accessible
            accessibilityLabel={`Son altı ay tahsilat: ${trend.map(money).join(', ')}`}
          >
            <Svg width="100%" height={74} viewBox="0 0 310 78">
              <Polyline points={points} fill="none" stroke={c.heroMuted} strokeWidth={2.5} />
            </Svg>
          </View>
          <View style={styles.between}>
            <T size={12} style={{ color: c.heroMuted }}>
              Son 6 ay · Gerçekleşen
            </T>
            <Button
              small
              icon="ArrowUpRight"
              label="Finansı incele"
              textColor={c.heroText}
              onPress={() => open('finans')}
              style={{ backgroundColor: c.heroSoft }}
            >
              Finansı incele
            </Button>
          </View>
        </Card>
      )}
      {session.role === 'onburo' && data.modules.crm && (
        <Card soft style={{ backgroundColor: c.primarySoft, padding: 22 }}>
          <View style={styles.between}>
            <T bold size={18}>
              İyi bir başlangıç için.
            </T>
            <Icon name="HeartHandshake" color={c.primary} size={26} />
          </View>
          <T muted>
            Bugün {stats[2].value} görüşme, takip edilecek {stats[0].value} aday öğrenci.
          </T>
          <Button
            primary
            icon="CalendarDays"
            onPress={() => open('deneme-dersi-takvimi')}
            style={{ alignSelf: 'flex-start', borderRadius: 25 }}
          >
            Görüşme takvimi
          </Button>
        </Card>
      )}

      <View style={[styles.wrap, { gap: 10 }]}>
        {statIndexes.map((i) => (
          <Stat
            key={stats[i].label}
            stat={stats[i]}
            icon={icons[i]}
            narrow={isManager && data.modules.finance}
          />
        ))}
      </View>
      {(isParent || isStudent) && (
        <Card
          soft
          onPress={
            canOpen(isParent ? 'finans' : 'notlarim')
              ? () => open(isParent ? 'finans' : 'notlarim')
              : undefined
          }
          label={isParent ? 'Ödeme planını incele' : 'Notlarımı incele'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingVertical: 14,
            gap: 8,
          }}
        >
          <Icon name={isParent ? 'Wallet' : 'ListChecks'} size={18} color={c.primary} />
          <T muted size={13} style={{ flexGrow: 1 }}>
            {stats[3].label}
          </T>
          <T bold size={16}>
            {stats[3].value}
          </T>
          <Icon name="ChevronRight" size={16} />
        </Card>
      )}
      {importantEnabled && (
        <Section
          title={importantTitle}
          action={
            isManager
              ? 'Tüm ödemeler'
              : scope.institution
                ? 'Tüm adaylar'
                : scope.teacher
                  ? 'Tüm sorular'
                  : isParent
                    ? 'Akademik takip'
                    : 'Tüm ödevler'
          }
          onPress={
            canOpen(importantPage)
              ? () => open(importantPage)
              : canOpen('akademik-takip')
                ? () => open('akademik-takip')
                : undefined
          }
        >
          {important.length ? (
            important.map((row) => (
              <RecordCard compact key={row.id} row={row} onPress={() => detail(row)} />
            ))
          ) : (
            <Card soft>
              <View style={styles.row}>
                <Icon name="CircleCheck" color={c.green} />
                <T style={{ flex: 1 }}>Şimdilik bekleyen bir iş bulunmuyor.</T>
              </View>
            </Card>
          )}
        </Section>
      )}
      {data.modules.academic && !scope.institution && lessons.length > 0 && (
        <Section
          title={isParent ? 'Ders programı' : 'Programından'}
          action="Tüm program"
          onPress={canOpen('ders-programi') ? () => open('ders-programi') : undefined}
        >
          <Card soft style={{ gap: 0, paddingVertical: 4 }}>
            {lessons.map((row, i) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.title} dersini incele`}
                key={row.id}
                onPress={() => detail(row)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 16,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: c.border,
                }}
              >
                <View style={{ width: 58, gap: 2 }}>
                  <T bold size={15}>
                    {timeLabel(row.source.date)}
                  </T>
                  <T muted size={11}>
                    {dateLabel(row.source.date)}
                  </T>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <T bold>{row.title}</T>
                  <T muted size={12}>
                    {row.body.replace('\n', ' · ')}
                  </T>
                </View>
                <Icon name="ChevronRight" size={16} />
              </Pressable>
            ))}
          </Card>
        </Section>
      )}
      {data.modules.communication && (
        <Section
          title="Okuldan haberler"
          action="Tüm duyurular"
          onPress={canOpen('duyurular') ? () => open('duyurular') : undefined}
        >
          {data.announcements
            .filter((a) => !a.classId || a.classId === scope.student.classId)
            .slice(0, 2)
            .map((item) => (
              <Card soft key={item.id}>
                <View style={styles.between}>
                  <View style={[styles.row, { gap: 7 }]}>
                    <Icon name="Megaphone" size={16} color={c.accentText} />
                    <T bold size={12} style={{ color: c.accentText }}>
                      {item.category}
                    </T>
                  </View>
                  <T muted size={12}>
                    {dateLabel(item.date)}
                  </T>
                </View>
                <T bold size={16}>
                  {item.title}
                </T>
                <T muted size={14}>
                  {item.text}
                </T>
              </Card>
            ))}
        </Section>
      )}
    </ScrollView>
  )
}
