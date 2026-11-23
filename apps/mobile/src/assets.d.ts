// Metro, medya dosyalarını varlık numarası olarak verir; expo-video bu numarayı kaynak olarak alır.
declare module '*.mp4' {
  const source: number
  export default source
}
