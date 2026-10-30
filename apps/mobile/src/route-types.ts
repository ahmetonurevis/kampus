import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { Row } from './model/school.ts'

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
