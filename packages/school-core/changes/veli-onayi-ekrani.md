---
etki: minor
---

Web izin formu (dijital veli onayı) ekranları izin formu uçlarına bağlandı (OG-056; IST-067, DOM-ILT-030, -031, -036…039).

- Yönetici ve rehber öğretmen İletişim altındaki İzin Formları sayfasında form açar, düzenler, kapatır ve arşivler; liste sunucu sayfalıdır, konu ve durum süzgeci vardır. Öğrenci bazlı durum ve karar geçmişi sağ panelde görünür; karar satırı ve veli notu yalnız yönetici ve rehber öğretmene gelir. Düzenleme taze kayıttan `If-Match` ile yalnız değişen alanı yazar, çakışmada iki değer gösterilir.
- Veli Onay Bekleyenler sayfasında seçili çocuğu için, 18 yaşını doldurmuş öğrenci İzin Formlarım sayfasında kendisi için isteğe bağlı notla onaylar ya da reddeder; karar son güne kadar değiştirilebilir. Kapatılmış ya da son günü geçmiş formda düğmeler gerekçeyle kapalıdır (hakem sunucudur), gönderim sürerken kilitlidir.
- Menüye dört rolde `izin-formlari` girdisi eklendi (`apiOnly`; Vue demosunda ve mobilde yok). react-shared'e izin formu kancaları (`use-permission-forms.ts`, tüm sayfaları okuyan `useAllPermissionForms` dahil) ve Türkçe hata metinleri eklendi.
- Düzenleme kayıtlı hedefi (`classIds`, `targetStudentIds`) kullanır; başkası hedefi değiştirdiyse ve kullanıcı da hedefe dokunduysa iki değer gösterilir, başkasının eklediği öğrenci uyarısız düşmez. Arşiv ve hedef daraltma kilidi sunucunun `hasDecisions` alanındandır (velayeti kalkan velinin kararı da kilitler).
- Bilinen sınırlar: son gün hatırlatması (`TODO(onay-hatirlatma-isi)`) ve mobil ekran yok.
