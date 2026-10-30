export const subjects = [
  {
    id: 'math',
    name: 'Matematik',
    icon: 'Calculator',
    color: 'lavender',
    min: 5,
    max: 12,
    topics: ['Sayılar ve işlemler', 'Oran ve orantı', 'Geometri', 'Denklemler'],
    task: 'Bir alışveriş bütçesi hazırlayın. İndirim oranlarını, toplam tutarı ve kalan bütçeyi işlem adımlarıyla gösterin.',
    lesson:
      'Oran iki çokluğun karşılaştırılmasıdır. 3 kırmızı ve 5 mavi kalemin kırmızı/mavi oranı 3/5 olur. Orantıda çapraz çarpımlar eşittir: 2/3 = 4/6. Bir denklemin iki tarafına aynı işlem uygulanır; 2x + 6 = 18 için önce 6 çıkarılır, sonra 2’ye bölünür ve x = 6 bulunur.',
  },
  {
    id: 'turkish',
    name: 'Türkçe',
    icon: 'BookOpen',
    color: 'peach',
    min: 5,
    max: 8,
    topics: ['Sözcükte anlam', 'Paragraf', 'Yazım kuralları', 'Cümlede anlam'],
    task: 'Okuduğunuz bir öykünün ana fikrini, yardımcı düşüncelerini ve olay örgüsünü belirleyin. 150 kelimelik bir değerlendirme yazın.',
    lesson:
      'Ana fikir, yazarın okuyucuya vermek istediği temel düşüncedir. Konu ise metinde ne anlatıldığıdır. Ana fikir tam bir yargı bildirir. Metinde geçen neden-sonuç ve amaç-sonuç ilişkilerini ayrı ayrı işaretleyin; her çıkarımınızı metinden bir örnekle destekleyin.',
  },
  {
    id: 'science',
    name: 'Fen Bilimleri',
    icon: 'FlaskConical',
    color: 'mint',
    min: 5,
    max: 8,
    topics: ['Hücre ve canlılar', 'Kuvvet ve enerji', 'Madde ve değişim', 'Dünya ve evren'],
    task: 'Bitki ve hayvan hücresini karşılaştıran bir tablo hazırlayın. Ortak ve farklı yapıları görevleriyle birlikte açıklayın.',
    lesson:
      'Hücre canlıların temel yapı ve görev birimidir. Hücre zarı madde alışverişini düzenler. Çekirdek kalıtsal bilgiyi taşır. Mitokondri enerji üretiminde görevlidir. Bitki hücresinde hücre duvarı ve kloroplast bulunur; hayvan hücresinde bu iki yapı bulunmaz.',
  },
  {
    id: 'social',
    name: 'Sosyal Bilgiler',
    icon: 'Globe',
    color: 'blue',
    min: 5,
    max: 8,
    topics: ['Birey ve toplum', 'Kültür ve miras', 'İnsanlar ve çevre', 'Etkin vatandaşlık'],
    task: 'Yaşadığınız ilçedeki bir kültürel miras ögesini araştırın. Tarihini, korunma nedenlerini ve kaynaklarınızı bir sayfada sunun.',
    lesson:
      'Haklar ve sorumluluklar birlikte düşünülür. Eğitim hakkını kullanırken okul kurallarına uymak ve başkalarının öğrenme hakkına saygı göstermek gerekir. Tarihî eserler ortak kültürel mirastır; korunmaları toplumsal sorumluluktur. Araştırmada birden fazla güvenilir kaynağı karşılaştırın.',
  },
  {
    id: 'literature',
    name: 'Türk Dili ve Edebiyatı',
    icon: 'BookOpen',
    color: 'peach',
    min: 9,
    max: 12,
    topics: ['Şiir bilgisi', 'Hikâye ve roman', 'Edebî sanatlar', 'Metin inceleme'],
    task: 'Bir şiirde tema, ahenk ve söz sanatlarını inceleyin. Metinden örneklerle 250 kelimelik bir çözümleme yazın.',
    lesson:
      'Tema, edebî metnin temel duygu veya düşüncesidir. Benzetmede iki varlık ortak özellikleriyle karşılaştırılır. Kişileştirmede insan dışındaki varlıklara insan özellikleri verilir. Anlatıcı ile yazar aynı kişi olmak zorunda değildir. Metin incelemesinde dönem, biçim ve içerik birlikte değerlendirilir.',
  },
  {
    id: 'physics',
    name: 'Fizik',
    icon: 'Zap',
    color: 'blue',
    min: 9,
    max: 12,
    topics: ['Hareket', 'Kuvvet', 'Enerji', 'Elektrik'],
    task: 'Sabit süratli bir hareket için konum-zaman tablosu ve grafiği oluşturun. Grafiğin eğimini hesaplayıp birimini belirtin.',
    lesson:
      'Sürat, alınan yolun geçen zamana oranıdır. Hız ise yer değiştirme üzerinden tanımlanan vektörel büyüklüktür. Newton’un ikinci yasası F = m × a biçimindedir. İş birimi joule, güç birimi watt’tır. İdeal bir sistemde toplam enerji korunur.',
  },
  {
    id: 'chemistry',
    name: 'Kimya',
    icon: 'FlaskConical',
    color: 'mint',
    min: 9,
    max: 12,
    topics: ['Atom', 'Periyodik sistem', 'Kimyasal bağlar', 'Karışımlar'],
    task: 'İlk 20 elementten beşini seçin. Sembol, atom numarası, grup ve günlük kullanım alanlarını karşılaştırın.',
    lesson:
      'Atom numarası proton sayısına eşittir. Nötr atomda proton ve elektron sayıları aynıdır. İzotop atomların proton sayıları aynı, nötron sayıları farklıdır. Elementler tek tür atomdan oluşur. Homojen karışımlar her noktasında aynı özellik gösterir; tuzlu su buna örnektir.',
  },
  {
    id: 'biology',
    name: 'Biyoloji',
    icon: 'Leaf',
    color: 'mint',
    min: 9,
    max: 12,
    topics: ['Hücre', 'Kalıtım', 'Ekosistem', 'Canlıların sınıflandırılması'],
    task: 'Bir besin ağı çizin. Üretici, tüketici ve ayrıştırıcıları gösterin; bir türün azalmasının etkilerini açıklayın.',
    lesson:
      'DNA kalıtsal bilgiyi taşır. Mitoz bölünme büyüme ve onarımda görev alır; kromozom sayısı korunur. Ekosistemde üreticiler inorganik maddelerden organik besin üretir. Ayrıştırıcılar madde döngüsünü sağlar. Enerji besin zinciri boyunca aktarılırken bir kısmı ısıya dönüşür.',
  },
  {
    id: 'history',
    name: 'Tarih',
    icon: 'Landmark',
    color: 'peach',
    min: 9,
    max: 12,
    topics: ['Tarih bilimi', 'İlk uygarlıklar', 'Osmanlı tarihi', 'Millî Mücadele'],
    task: 'Millî Mücadele dönemindeki önemli gelişmeleri neden-sonuç ilişkileriyle bir zaman çizelgesinde gösterin.',
    lesson:
      'Tarih, geçmişteki insan faaliyetlerini yer ve zaman göstererek kaynaklara dayalı inceler. Olayın yaşandığı döneme ait belgeler birinci el kaynaklardır. Kronoloji olayları zaman sırasına koyar. Kaynakların yazarı, amacı ve üretildiği bağlam sorgulanmalıdır.',
  },
  {
    id: 'geography',
    name: 'Coğrafya',
    icon: 'Map',
    color: 'blue',
    min: 9,
    max: 12,
    topics: ['Harita bilgisi', 'İklim', 'Nüfus', 'Doğal sistemler'],
    task: 'Türkiye’de iki farklı iklim bölgesini sıcaklık, yağış ve bitki örtüsü bakımından karşılaştırın.',
    lesson:
      'Harita ölçeği, haritadaki uzunluğun gerçek uzunluğa oranıdır. 1/100.000 ölçekli haritada 1 cm, gerçekte 1 km’dir. Hava durumu kısa süreli atmosfer koşullarını, iklim ise uzun yılların ortalama koşullarını anlatır. Yükselti ve denize uzaklık sıcaklığı etkiler.',
  },
  {
    id: 'english',
    name: 'İngilizce',
    icon: 'Languages',
    color: 'lavender',
    min: 5,
    max: 12,
    topics: ['Reading', 'Vocabulary', 'Grammar', 'Writing'],
    task: 'My school day başlıklı kısa bir paragraf yazın. Ders programınızı ve okulda sevdiğiniz etkinlikleri anlatın.',
    lesson:
      'Simple present günlük alışkanlıklarda kullanılır: I walk to school. He, she ve it ile fiile -s eklenir: She reads every day. Sorularda do/does kullanılır. Bir paragrafta önce ana düşünceyi, ardından destekleyici örnekleri yazın.',
  },
  {
    id: 'informatics',
    name: 'Bilişim Teknolojileri',
    icon: 'Monitor',
    color: 'blue',
    min: 5,
    max: 12,
    topics: ['Algoritmalar', 'Dijital güvenlik', 'Veri', 'Programlama'],
    task: 'Bir sayının tek veya çift olduğunu belirleyen algoritmanın akış şemasını çizin. İki örnekle test edin.',
    lesson:
      'Algoritma bir problemi çözmek için izlenen sonlu ve sıralı adımlardır. Koşullar karar vermeyi, döngüler tekrarı sağlar. Güçlü parolalar benzersiz olmalı ve paylaşılmamalıdır. Kişisel verileri korumak için gereksiz paylaşım yapmayın; dosyalarınızı düzenli yedekleyin.',
  },
  {
    id: 'music',
    name: 'Müzik',
    icon: 'Music',
    color: 'lavender',
    min: 5,
    max: 12,
    topics: ['Ritim', 'Nota bilgisi', 'Çalgılar', 'Dinleme'],
    task: '4/4 ölçüde dört ölçülük bir ritim yazın. El çırparak uygulayın ve kullandığınız nota sürelerini belirtin.',
    lesson:
      'Porte beş çizgi ve dört aralıktan oluşur. 4/4 ölçüde her ölçü dört dörtlük vuruş içerir. Tempo eserin hızını, nüans sesin şiddetini belirtir. Do majör dizisi do, re, mi, fa, sol, la, si notalarından oluşur.',
  },
  {
    id: 'art',
    name: 'Görsel Sanatlar',
    icon: 'Palette',
    color: 'peach',
    min: 5,
    max: 12,
    topics: ['Renk', 'Perspektif', 'Kompozisyon', 'Sanat tarihi'],
    task: 'Sıcak ve soğuk renkleri kullanarak iki küçük kompozisyon oluşturun. Renk seçimlerinin duyguyu nasıl etkilediğini açıklayın.',
    lesson:
      'Geleneksel boya renk çemberinde ana renkler kırmızı, sarı ve mavidir. Sıcak renkler kırmızı, turuncu ve sarı; soğuk renkler mavi, yeşil ve mordur. Perspektif, derinliği düzlem üzerinde göstermeyi sağlar. Kompozisyonda denge ve vurgu izleyicinin dikkatini yönlendirir.',
  },
  {
    id: 'pe',
    name: 'Beden Eğitimi',
    icon: 'Activity',
    color: 'mint',
    min: 5,
    max: 12,
    topics: ['Takım sporları', 'Hareket becerileri', 'Fair play', 'Sağlıklı yaşam'],
    task: 'Isınma, ana etkinlik ve soğuma bölümlerinden oluşan güvenli bir hareket planı hazırlayın. Fair play davranışlarına üç örnek verin.',
    lesson:
      'Isınma vücudu etkinliğe hazırlar, soğuma ise hareketin kontrollü biçimde azaltılmasıdır. Fair play kurallara, rakibe ve hakeme saygıyı içerir. Voleybolda bir takım sahada altı oyuncuyla yer alır. Düzenli hareket, dinlenme ve dengeli beslenme birlikte değerlendirilir.',
  },
  {
    id: 'religion',
    name: 'Din Kültürü ve Ahlak Bilgisi',
    icon: 'HeartHandshake',
    color: 'peach',
    min: 5,
    max: 12,
    topics: ['Değerler', 'İnanç ve kültür', 'Yardımlaşma', 'Ahlak'],
    task: 'Yardımlaşma ve sorumluluk değerlerini konu alan bir okul projesi tasarlayın. Görev dağılımını ve beklenen yararı açıklayın.',
    lesson:
      'Dürüstlük, adalet, saygı ve yardımlaşma ortak ahlaki değerlerdendir. Empati, bir başkasının duygu ve düşüncelerini anlamaya çalışmaktır. Farklı inanç ve düşüncelere saygı göstermek birlikte yaşama kültürünü güçlendirir. Sorumluluk, üstlenilen görevleri zamanında yerine getirmektir.',
  },
]
export type Subject = (typeof subjects)[number]
export const subjectById = (id: string): Subject | undefined =>
  subjects.find((subject) => subject.id === id)
export const subjectsForGrade = (grade: number): Subject[] =>
  subjects.filter((subject) => grade >= subject.min && grade <= subject.max)
export const schoolLevels = Array.from({ length: 8 }, (_, i) => `${i + 5}. Sınıf`)
