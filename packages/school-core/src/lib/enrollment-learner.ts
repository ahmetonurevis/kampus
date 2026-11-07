import type { InstitutionType } from '../modules/collection-modules.ts'

/**
 * Kayıtlı kişinin ekrandaki sözleri (ADR 0008 karar 1, DOM-KAY-012): okulda "öğrenci", okul
 * dışındaki türlerde (dil okulu, kurs) "kursiyer". "öğrenci" ünlüyle, "kursiyer" ünsüzle bittiği
 * için tamlayan, yönelme ve belirtme ekleri ayrı yazılır (öğrencinin / kursiyerin); çoğul,
 * bulunma ve ayrılma ekleri iki sözde de aynıdır (`noun` + "ler", "de", "den").
 */
export type LearnerWords = {
  /** Başlık ve etiket: "Öğrenci" / "Kursiyer". */
  title: 'Öğrenci' | 'Kursiyer'
  /** Cümle içi: "öğrenci" / "kursiyer". */
  noun: 'öğrenci' | 'kursiyer'
  /** Çoğul: "öğrenciler" / "kursiyerler". */
  plural: 'öğrenciler' | 'kursiyerler'
  /** Tamlayan: "öğrencinin" / "kursiyerin". */
  genitive: 'öğrencinin' | 'kursiyerin'
  /** Cümle başında tamlayan: "Öğrencinin" / "Kursiyerin". */
  titleGenitive: 'Öğrencinin' | 'Kursiyerin'
  /** Yönelme: "öğrenciye" / "kursiyere". */
  dative: 'öğrenciye' | 'kursiyere'
  /** Belirtme: "öğrenciyi" / "kursiyeri". */
  accusative: 'öğrenciyi' | 'kursiyeri'
}

const STUDENT_WORDS: LearnerWords = {
  title: 'Öğrenci',
  noun: 'öğrenci',
  plural: 'öğrenciler',
  genitive: 'öğrencinin',
  titleGenitive: 'Öğrencinin',
  dative: 'öğrenciye',
  accusative: 'öğrenciyi',
}

const LEARNER_WORDS: LearnerWords = {
  title: 'Kursiyer',
  noun: 'kursiyer',
  plural: 'kursiyerler',
  genitive: 'kursiyerin',
  titleGenitive: 'Kursiyerin',
  dative: 'kursiyere',
  accusative: 'kursiyeri',
}

/** Kurum türünün kayıtlı kişi sözleri (DOM-KAY-012); tür bilinmiyorsa okul sayılır. */
export function learnerWords(type?: InstitutionType): LearnerWords {
  return type === undefined || type === 'school' ? STUDENT_WORDS : LEARNER_WORDS
}
