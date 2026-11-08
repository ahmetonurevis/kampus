---
etki: patch
---

- Kurumsal katılım özeti bugün etkin bağın içinde başlayan kur kayıtlarıyla sınırlandı (DOM-FIN-060, DOM-DIL-093): bağdan önceki, kursiyerin kendi ödediği kur işverene gitmez; bağın bugün etkinliği ileri tarihli başlangıç ve bitişle birlikte tarih aralığından (`linkCovers`) hesaplanır.
- Yönetim kurulu raporunda küçük grup bastırması kişi kimlikleriyle yapılacak biçimde düzeltildi (DOM-FIN-064): gizli hücrelerin birleşimi 5'ten az farklı kişi kapsıyorsa ikincil hücre gizlenir; gizlenecek dolu hücre yoksa kırılımın tamamı gizlenir, böylece kurum geneli toplamdan tek kişinin yöntemi, gecikme dilimi ya da ayrılış nedeni çıkarılamaz. `suppressSmallGroups` kişi sayısı yerine hücredeki kişi kimliklerini (`membersOf`) alır; işlev henüz sürüme girmediği (`yonetim-kurulu-raporu.md` parçası) için kırıcı sayılmaz.
