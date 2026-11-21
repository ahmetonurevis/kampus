import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { Row } from './model/school.ts'
import type { TeacherAttendanceTab } from './api/attendance-history.ts'
import type { ApiScreen } from './api/pages.ts'
import type { ParentTab } from './api/parent-tracking.ts'

// Modül ekranı; sınıf/kampüs/deneme/tarih parametreleri listeyi veya ekranı daraltır.
export type ModuleParams = {
  page: string
  classId?: string
  branchId?: string
  date?: string
  examId?: string
}
export type RootStackParamList = {
  Home: undefined
  Category: { category: string }
  Module: ModuleParams
  Detail: { row: Row }
  Quiz: { row: Row<'quiz'> }
  Video: { row: Row<'video'> }
}
export type ScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>

// API modu (`EXPO_PUBLIC_API_URL`): yalnız API'ye taşınmış ekranlar.
export type ApiStackParamList = {
  ApiHome: undefined
  ApiCategory: { category: string }
  /** Yazışma akışı; menü sayfası değildir, Mesajlar listesinden açılır. */
  ApiConversation: { conversationId: string }
  /** Bildirim merkezi; menü sayfası değildir, üst başlıktaki zilden açılır. */
  ApiNotifications: undefined
} & Record<Exclude<ApiScreen, 'ParentTracking' | 'TeacherAttendance'>, undefined> & {
    /** Bildirimden açılırken sekme verilir (`devamsizlik`); menüden parametresizdir. */
    ParentTracking: { tab?: ParentTab } | undefined
    /** Bildirimden açılırken geçmiş sekmesi (`gecmis`); menüden parametresizdir. */
    TeacherAttendance: { tab?: TeacherAttendanceTab } | undefined
  }
export type ApiScreenProps<Name extends keyof ApiStackParamList> = NativeStackScreenProps<
  ApiStackParamList,
  Name
>
