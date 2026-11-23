import type { SeedDate } from './seed-support.ts'

/** Örnek duyurular, öğretmen yazışmaları (ADR 0005), randevular ve veli/öğrenci talepleri. */
export function createCommunication(date: SeedDate) {
  const announcementContent = [
    [
      'Yeni eğitim öğretim yılına merhaba',
      'Güncel ders programları, branş öğretmenleri ve sınıf listeleri panelinizde. Rehber öğretmeniniz okul uyum sürecinde yanınızda.',
    ],
    [
      'Bilim şenliği proje başvuruları',
      'Fen ve bilişim zümrelerinin düzenlediği bilim şenliğine enerji, çevre ve robotik projeleriyle katılabilirsiniz. Başvurular cuma gününe kadar danışman öğretmeninize yapılabilir.',
    ],
    [
      'Birinci yazılı sınav hazırlıkları',
      'Matematik, Türkçe, fen ve sosyal bilgiler kazanım testleri kütüphaneye eklendi. Branş öğretmenleriniz etüt saatlerinde sorularınızı yanıtlayacak.',
    ],
    [
      'Kütüphane okuma günleri',
      'Bu ayın teması doğa ve insan. Okuduğunuz kitapların değerlendirmelerini Türkçe ve edebiyat derslerinde paylaşabilirsiniz.',
    ],
    [
      'Veli görüşme haftası',
      'Branş öğretmenleriyle görüşme saatlerini randevu ekranından seçebilirsiniz. Her görüşme için 30 dakika ayrılmıştır.',
    ],
    [
      'Okullar arası basketbol turnuvası',
      'Okul takımının seçmeleri spor salonunda yapılacak. Katılmak isteyen öğrenciler beden eğitimi öğretmenine başvurabilir.',
    ],
    [
      'LGS ve YKS deneme sınavları',
      '8 ve 12. sınıflar için deneme sınavı sonuçları açıklanmıştır. Konu eksiklerinizi akademik gelişim ekranında inceleyebilirsiniz.',
    ],
    [
      'Görsel sanatlar sergisi',
      'Öğrencilerimizin doğa temalı resimleri ana binada sergilenecek. Eser teslimi için görsel sanatlar öğretmeninizle görüşün.',
    ],
    [
      'Müzik korosu çalışmaları',
      'Çok sesli okul korosunun çalışmaları salı ve perşembe günleri ders çıkışında müzik atölyesinde yapılacak.',
    ],
    [
      'Yemekhane ve servis bilgilendirmesi',
      'Alerjen bilgileri için okul danışmasına ulaşabilirsiniz. Servis güzergâh değişikliği talepleri ön büro tarafından değerlendirilecektir.',
    ],
    [
      'Dijital vatandaşlık atölyesi',
      'Bilişim dersinde güvenli parola, kişisel veri ve kaynak doğrulama konularını uygulamalarla ele alıyoruz.',
    ],
    [
      'Cumhuriyet haftası hazırlıkları',
      'Tarih, sosyal bilgiler ve müzik zümreleri ortak bir etkinlik hazırlıyor. Görev almak isteyen öğrenciler sınıf danışmanına başvurabilir.',
    ],
    [
      'Rehberlik: verimli çalışma',
      'Haftalık çalışma planınızı yaparken kısa molalara, uykuya ve sosyal etkinliklere de zaman ayırın. Rehberlik servisi bireysel planlama desteği sunuyor.',
    ],
    [
      'İngilizce kitap paylaşım saati',
      'Yabancı dil dersinde bu hafta okuduğumuz kısa hikâyeleri paylaşacağız. Her öğrenci sevdiği bir karakteri tanıtacak.',
    ],
    [
      'Çevre gönüllüleri buluşuyor',
      'Okul bahçesinde atık ayrıştırma ve bitki gözlem alanı kurulacak. Fen ve biyoloji zümreleri çalışmaya rehberlik edecek.',
    ],
    [
      'Matematik oyunları günü',
      'Akıl oyunları, geometrik yapbozlar ve sayı bulmacaları matematik atölyesinde sizleri bekliyor.',
    ],
  ]
  const announcements = announcementContent.map(([title, text], i) => ({
    id: `ann${i + 1}`,
    title,
    text,
    date: date(-i),
    classId: i % 4 === 0 ? 'c1' : null,
    category: ['Akademik', 'Etkinlik', 'Bilgilendirme'][i % 3],
  }))
  const messageTexts = [
    'Merhaba hocam, bu haftaki çalışma konularını paylaşabilir misiniz?',
    'Merhaba. Matematikte denklem kurma ve problem çözme adımlarına odaklanıyoruz.',
    'Problem metnini denkleme dönüştürürken zorlanıyoruz. Ek kaynak var mı?',
    'Materyaller bölümündeki çalışma kâğıdını ve denklemler videosunu inceleyebilirsiniz.',
    'Kaynağı bulduk. Bir etüt görüşmesi de planlayabilir miyiz?',
    'Tabii, randevu ekranından uygun bir saat seçebilirsiniz.',
    'Teşekkürler. Önce soruları çözüp takıldığımız adımları not edeceğiz.',
    'Çok iyi bir yöntem. Görüşmede birlikte değerlendirelim.',
  ]
  // Yazışma kaydı yalnız taraf bilgisini ve son mesaj anını taşır; mesajlar ayrı kayıtlardır
  // (`conversationMessages`, ADR 0005). Mesaj, yazışmanın taraf anahtarlarını kopya olarak taşır:
  // kapsam kuralı ve SQL süzgeci yazışmaya bakmadan karar verir; taraflar değişmez.
  const conversationParties = [
    { id: 'conv1', studentId: 's1', teacherId: 't1', audience: 'student' },
    { id: 'conv2', studentId: 's1', teacherId: 't1', audience: 'parent', parentUserId: 'p1' },
    { id: 'conv3', studentId: 's2', teacherId: 't1', audience: 'parent', parentUserId: 'p1' },
    { id: 'conv4', studentId: 's1', teacherId: 't3', audience: 'student' },
  ]
  const conversationMessages = conversationParties.flatMap(({ id, ...parties }) =>
    messageTexts.map((text, i) => ({
      id: `${id}-m${i}`,
      conversationId: id,
      ...parties,
      text:
        parties.teacherId === 't3'
          ? text
              .replace(
                'Matematikte denklem kurma ve problem çözme adımlarına',
                'Fen bilimlerinde hücrelerin yapılarına',
              )
              .replace('denklemler videosunu', 'hücre videosunu')
              .replace(
                'Problem metnini denkleme dönüştürürken',
                'Hücre yapılarını karşılaştırırken',
              )
          : text,
      sender: i % 2 ? 'teacher' : parties.audience,
      date: date(-2 + Math.floor(i / 4), 8 + i),
    })),
  )
  const conversations = conversationParties.map((c) => ({
    ...c,
    lastMessageAt: conversationMessages.filter((m) => m.conversationId === c.id).at(-1)?.date,
  }))
  const appointments = [
    {
      id: 'apt1',
      studentId: 's1',
      teacherId: 't1',
      date: date(2, 12),
      type: 'Bireysel etüt',
      note: 'Denklem kurma problemlerini tekrar etmek istiyorum.',
      status: 'Bekliyor',
    },
    {
      id: 'apt2',
      studentId: 's2',
      teacherId: 't1',
      date: date(3, 13),
      type: 'Veli görüşmesi',
      note: 'Dönem içi gelişimini değerlendirmek istiyorum.',
      status: 'Onaylandı',
    },
    {
      id: 'apt3',
      studentId: 's25',
      teacherId: 't1',
      date: date(1, 11),
      type: 'Bireysel etüt',
      note: 'Yazılı öncesi konu tekrarı.',
      status: 'Onaylandı',
    },
  ]
  const requests = [
    {
      id: 'req1',
      studentId: 's1',
      title: 'Okul servisi güzergâhı',
      text: 'Servis durağının evimize daha yakın bir noktaya alınmasını rica ediyoruz.',
      category: 'Talep',
      status: 'İnceleniyor',
      assignedTo: 'Ön büro',
      date: date(-2),
    },
    {
      id: 'req2',
      studentId: 's2',
      title: 'Sınıfın havalandırılması',
      text: 'Öğleden sonraki derslerde sınıfın havalandırılması konusunda destek rica ediyorum.',
      category: 'Şikayet',
      status: 'Yeni',
      assignedTo: 'Akademik koordinatör',
      date: date(-1),
    },
    {
      id: 'req3',
      studentId: 's3',
      title: 'Materyal desteği',
      text: 'Fen bilimleri için ek kaynak kitap önerisi rica ediyorum.',
      category: 'Talep',
      status: 'Çözüldü',
      assignedTo: 'Akademik koordinatör',
      date: date(-4),
    },
  ]
  return { announcements, conversations, conversationMessages, appointments, requests }
}
