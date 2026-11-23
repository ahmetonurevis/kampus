import { useEffect, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import { context } from '../model/school.ts'
import type { ScreenProps } from '../route-types.ts'
import { Card, Heading, Icon, T, styles, useColors } from '../ui/components.tsx'
import denklemler from '../../assets/videos/denklemler.mp4'
import hucre from '../../assets/videos/hucre.mp4'

const media: Partial<Record<string, VideoSource>> = { v1: denklemler, v2: hucre }
export default function Video({ route }: ScreenProps<'Video'>) {
  const { data, session, commit } = useActiveSchool(),
    c = useColors(),
    scope = context(data, session),
    video = data.videos.find((v) => v.id === route.params.row.id)
  if (!video) throw new Error('Video kaydı bulunamadı.')
  const videoId = video.id
  const saved =
    data.videoProgress.find((p) => p.videoId === videoId && p.studentId === scope.student.id)
      ?.progress || 0
  const latest = useRef(saved),
    persisted = useRef(saved)
  const player = useVideoPlayer(media[videoId] ?? null, (player) => {
    player.timeUpdateEventInterval = 2
  })
  useEffect(() => {
    const time = player.addListener('timeUpdate', (event) => {
      if (player.duration > 0)
        latest.current = Math.max(
          latest.current,
          Math.min(100, Math.round((event.currentTime / player.duration) * 100)),
        )
    })
    const end = player.addListener('playToEnd', () => {
      latest.current = 100
      save()
    })
    function resume() {
      if (player.status === 'readyToPlay' && saved > 0 && saved < 95 && player.currentTime === 0)
        player.currentTime = (player.duration * saved) / 100
    }
    const loaded = player.addListener('statusChange', resume)
    resume()
    const timer = setInterval(save, 15000)
    function save() {
      if (latest.current === persisted.current) return
      const progress = latest.current
      commit((s) => {
        const record = s.videoProgress.find(
          (p) => p.studentId === scope.student.id && p.videoId === videoId,
        )
        if (record) record.progress = progress
        else s.videoProgress.push({ studentId: scope.student.id, videoId, progress })
      }, '').then((ok) => {
        if (ok) persisted.current = progress
      })
    }
    return () => {
      time.remove()
      end.remove()
      loaded.remove()
      clearInterval(timer)
      save()
    }
  }, [player])
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Heading title={video.title} subtitle={`${video.subject} · ${video.level}`} />
      <View style={{ overflow: 'hidden', borderRadius: 22, backgroundColor: c.soft }}>
        <VideoView
          player={player}
          style={{ width: '100%', aspectRatio: 16 / 9 }}
          nativeControls
          fullscreenOptions={{ enable: true }}
        />
      </View>
      <View style={styles.between}>
        <View style={styles.row}>
          <Icon name="Download" size={16} />
          <T muted size={12}>
            İnternetsiz izleyebilirsin
          </T>
        </View>
        <T bold size={12} style={{ color: c.primary }}>
          %{saved} izlendi
        </T>
      </View>
      <Card soft>
        <T>{video.description}</T>
      </Card>
      <T bold size={20}>
        Ders notları
      </T>
      <Card style={{ gap: 18 }}>
        {video.transcript.map((paragraph, i) => (
          <View key={i} style={{ gap: 8 }}>
            <T bold size={12} style={{ color: c.primary }}>
              NOT {String(i + 1).padStart(2, '0')}
            </T>
            <T>{paragraph}</T>
          </View>
        ))}
      </Card>
    </ScrollView>
  )
}
