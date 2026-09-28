"""Kampüs: Office-PowerPoint-MCP-Server üzerinden düzenlenebilir yatırımcı sunumu."""
import asyncio, json, math
from pathlib import Path
from datetime import datetime, timezone
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import MSO_AUTO_SIZE
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'artifacts/investor-presentation'
OUT=ROOT/'sunumlar'
SHOTS=OUT/'ekran-goruntuleri'
SERVER=Path('/Users/onurevis/.local/share/kampus-tools/Office-PowerPoint-MCP-Server')
PYTHON='/Users/onurevis/.local/share/kampus-tools/powerpoint-venv/bin/python'
PID='kampus-investor-2026-09'
W,H=13.333333,7.5
TOKENS={
 'primitive':{'sapphire':'#1E3A8A','orange':'#F97316','white':'#FFFFFF','ink':'#172438','muted':'#607086','line':'#DEE5EF','soft':'#F3F6FA','pale_blue':'#EBF1FC','dark':'#101B30','light_text':'#C5D2E6'},
 'semantic':{'brand':'sapphire','action':'orange','background':'white','text':'ink','secondary':'muted','divider':'line','surface':'soft'},
 'component':{'slide_margin':.65,'title_size':32,'body_size':18,'caption_size':10,'radius_adjustment':.08,'font':'Arial'}
}
P=TOKENS['primitive']; NOTES=[]; CALLS=[]; TEXTS=[]; PHOTOS=[]; SESSION=None
ART.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
(ART/'design-tokens.json').write_text(json.dumps(TOKENS,ensure_ascii=False,indent=2))
def rgb(c):
 c=P.get(c,c).lstrip('#');return [int(c[i:i+2],16) for i in (0,2,4)]
async def call(name,**args):
 result=await SESSION.call_tool(name,args)
 chunks=[x.text for x in result.content if getattr(x,'type',None)=='text']
 parsed=[]
 for x in chunks:
  try: parsed.append(json.loads(x))
  except json.JSONDecodeError: parsed.append(x)
 CALLS.append({'tool':name,'arguments':args,'result':parsed,'isError':result.isError})
 if result.isError or any(isinstance(x,dict) and x.get('error') for x in parsed):
  raise RuntimeError(f'{name}: {parsed}')
 return parsed[0] if len(parsed)==1 else parsed
async def shape(s,x,y,w,h,fill='soft',kind='rectangle',line=None):
 return await call('add_shape',presentation_id=PID,slide_index=s,shape_type=kind,left=x,top=y,width=w,height=h,fill_color=rgb(fill),line_color=rgb(line or fill),line_width=0)
async def text(s,value,x,y,w,h,size=18,color='ink',bold=False,align='left'):
 TEXTS.append({'slide':s+1,'text':value,'x':x,'y':y,'width':w,'height':h,'font_size':size})
 return await call('manage_text',presentation_id=PID,slide_index=s,operation='add',left=x,top=y,width=w,height=h,text=value,font_size=size,font_name='Arial',color=rgb(color),bold=bold,alignment=align,vertical_alignment='top',auto_fit=False)
async def line(s,x,y,w,dark=False):await shape(s,x,y,w,.009,'#354660' if dark else 'line')
async def photo(s,name,x,y,w=None,h=None,frame=True):
 PHOTOS.append({'slide':s+1,'name':name,'platform':'web' if name.startswith('web/') else 'mobile'})
 path=SHOTS/(name+'.png')
 iw,ih=Image.open(path).size
 if h is None:h=w*ih/iw
 if w is None:w=h*iw/ih
 if frame:await shape(s,x-.018,y-.018,w+.036,h+.036,'line')
 await call('manage_image',presentation_id=PID,slide_index=s,operation='add',image_source=str(path),source_type='file',left=x,top=y,width=w,height=h)
 return w,h
async def slide(section,title,note,dark=False,footer=None):
 s=len(NOTES);NOTES.append(note)
 await call('add_slide',presentation_id=PID,layout_index=6)
 await shape(s,0,0,W,H,'dark' if dark else 'white')
 await text(s,'Kampüs',.65,.34,2,.32,17,'white' if dark else 'sapphire',True)
 await text(s,section.replace('i','İ').replace('ı','I').upper(),8.0,.37,4.65,.25,10,'light_text' if dark else 'muted',False,'right')
 if title:await text(s,title,.65,.97,12.0,1.05,32,'white' if dark else 'ink',True)
 await line(s,.65,7.02,12.0,dark)
 await text(s,footer or 'Yatırımcı sunumu · Eylül 2026',.65,7.13,11.2,.20,9,'light_text' if dark else 'muted')
 await text(s,f'{s+1:02}',12.04,7.12,.62,.22,10,'light_text' if dark else 'muted',False,'right')
 print(f'Slayt {s+1}: {section}',flush=True)
 return s
async def feature(s,n,heading,body,x,y,w=5.2,dark=False):
 await text(s,n,x,y,.48,.36,14,'orange',True)
 await text(s,heading,x+.62,y-.02,w-.62,.5,20,'white' if dark else 'sapphire',True)
 await text(s,body,x+.62,y+.51,w-.62,1.01,17,'light_text' if dark else 'muted')
WEB_FOOTER='Çalışan web uygulaması · Ekranlardaki okul kayıtları ve tutarlar örnek veridir'
MOBILE_FOOTER='Mobil uygulama · Android APK / Expo önizlemesi · Örnek veriler'

async def module_slide(section,title,image_name,features,note,value):
 s=await slide(section,title,note,footer=WEB_FOOTER)
 await photo(s,'web/'+image_name,.66,1.91,w=8.00)
 for i,(heading,body) in enumerate(features):
  y=2.00+i*1.25
  await text(s,heading,9.08,y,3.5,.43,20,'sapphire',True)
  await text(s,body,9.08,y+.5,3.5,.73,16,'muted')
 await line(s,9.08,6.02,3.49)
 await text(s,value,9.08,6.24,3.49,.62,16,'ink',True)
 return s

async def pair_slide(section,title,left,right,left_title,left_body,right_title,right_body,note,summary):
 s=await slide(section,title,note,footer=WEB_FOOTER)
 await photo(s,'web/'+left,.66,1.94,w=5.78)
 await photo(s,'web/'+right,6.88,1.94,w=5.78)
 await text(s,left_title,.66,5.81,5.75,.42,21,'sapphire',True)
 await text(s,left_body,.66,6.29,5.75,.55,15,'muted')
 await text(s,right_title,6.88,5.81,5.75,.42,21,'sapphire',True)
 await text(s,right_body,6.88,6.29,5.75,.55,15,'muted')
 # Value proposition is part of the speaker notes; screenshots stay large.
 NOTES[s]+='\nYatırımcı açısından değer hipotezi: '+summary
 return s

async def build():
 template=Presentation();template.slide_width=Inches(W);template.slide_height=Inches(H);template.save(ART/'blank-16x9.pptx')
 await call('create_presentation_from_template',template_path=str(ART/'blank-16x9.pptx'),id=PID)
 await call('set_core_properties',presentation_id=PID,title='Kampüs | Özel Okul Yönetim Platformu — Yatırımcı Sunumu',subject='Web ağırlıklı modüler LMS + ERP; ürün, B2B SaaS modeli ve ticarileşme planı',author='Kampüs',keywords='özel okul, web, LMS, ERP, yatırımcı, B2B SaaS',comments='12 web ekranı ve 5 mobil ekranı. Ürün demosu; ticari planlar öneridir. Pazar verisi MEB 2024–2025.')

 s=await slide('Özel okullar için LMS + ERP','', 'Kampüs, özel okulun ticari ve akademik işlerini tek ürün ailesinde birleştiren bir web yönetim platformu olarak konumlanır. Beş rol: yönetici, ön büro, öğretmen, öğrenci ve veli. Mobil, günlük kullanımın tamamlayıcısıdır. Görsel çalışan yerel Vue panelinden alınmıştır. Bugün bir ürün demosu vardır; gerçek müşteri, şirket geliri veya üretim entegrasyonu iddiası yoktur.',footer='Yatırımcı sunumu · Eylül 2026 · Web yönetim platformu ve mobil deneyim')
 await text(s,'Özel okulun\nortak çalışma\nalanı.',.65,1.68,4.1,2.45,37,'sapphire',True)
 await text(s,'Kayıt, tahsilat ve\nakademik takip için\ntek web platformu.',.68,4.35,4.0,1.22,22,'muted')
 await text(s,'Okula satılan lisans.\nBeş role yayılan kullanım.',.68,6.07,4.03,.67,16,'ink',True)
 await photo(s,'web/yonetici-genel-bakis',4.92,1.54,w=7.73)
 await text(s,'Yönetici paneli · Gösterilen değerler örnek okul verisidir',4.92,6.56,7.73,.28,11,'muted')

 s=await slide('Yatırım tezi','Bir kurum kararı. Okulun tamamına yayılan kullanım.', 'Yatırım tezi henüz ticari verilerle doğrulanmış bir sonuç değildir. Önerilen B2B modelde satın alan okul kurucusu veya yönetimidir; günlük kullananlar beş roldür. Parçalı süreçlerin görünür iş yükü yaratabileceği varsayımı pilotlarda süre ve hata takibiyle sınanmalıdır. Ürün benimsemesi veya yenileme oranı ölçülmüş değildir.')
 triples=[('Dağınık iş yükü','Kayıt, ödeme, akademik takip\nve veli iletişimi farklı\nkanallara bölünebiliyor.','Çözüm: aynı öğrenci bağlamı'),('Her gün kullanılan işler','Yoklama, ödev, soru ve\nmesajlaşma; ürünü yalnızca\nrapor dönemine bağlamaz.','Hedef: düzenli kullanım'),('Kurumla büyüyen kapsam','Yeni öğrenci kapasitesi,\nek kampüs ve modüller\nlisansı genişletebilir.','Model: yıllık B2B abonelik')]
 for i,(head,body,foot) in enumerate(triples):
  x=.65+i*4.16
  await text(s,f'0{i+1}',x,2.14,.9,.62,32,'orange',True)
  await text(s,head,x,3.10,3.8,.91,25,'sapphire',True)
  await text(s,body,x,4.26,3.8,1.36,19)
  await line(s,x,5.98,3.76)
  await text(s,foot,x,6.28,3.82,.46,15,'muted',True)

 s=await slide('Ürün mimarisi','Modüller ayrı; öğrenci ve okul bağlamı ortak.', 'Altı iş grubu mevcut demo modüllerini toplar. Modül durumları ayarlardan yönetilir, kapalı modül menüde ve doğrudan rotada erişilemez. Bu rol tabanlı demo gezinmesidir; üretim JWT/RBAC ve çok kiracılı veri izolasyonu ayrıca geliştirilecektir. Ortak veri modeli web/mobil için temel oluşturur, mevcut sürüm canlı eşzamanlı değildir.',dark=True)
 groups=[('Kayıt & satış','Aday, görüşme, kesin kayıt'),('Finans & belgeler','Taksit, tahsilat, dekont, sözleşme'),('Okul operasyonları','Kampüs, sınıf, kadro, ders atama'),('Akademik yönetim','Program, yoklama, not, analiz'),('Dijital öğrenme','Ödev, quiz, video, soru-cevap'),('İletişim & portallar','Veli, mesaj, randevu, duyuru')]
 for i,(a,b) in enumerate(groups):
  x=.65+(i%3)*4.16;y=2.10+(i//3)*1.73
  await shape(s,x,y,3.84,1.35,'#1C2C49',kind='rounded_rectangle')
  await text(s,a,x+.21,y+.25,3.42,.45,21,'white',True)
  await text(s,b,x+.21,y+.91,3.42,.32,14,'light_text')
 await line(s,.65,5.83,12,True)
 await text(s,'Yönetici   /   Ön büro   /   Öğretmen   /   Öğrenci   /   Veli',.65,6.23,12,.47,22,'white',True)

 s=await slide('Pazar & ilk müşteri profili','Türkiye’de ölçekli bir özel okul pazarı.', 'MEB 2024–2025 Örgün Eğitim İstatistikleri, 30.09.2025: 14.700 özel okul; özel kurumlarda 1.539.579 öğrenci; özel okullarda 177.738 öğretmen. Kaynak https://www.meb.gov.tr/2024-2025-orgun-egitim-istatistikleri-aciklandi//haber/38473/tr . Okul sayısı tekil kampüs/müşteri sayısı değildir; tüm kademe türlerini içerir. Parasal TAM veya okul sayısından türetilmiş satış tahmini yapılmamıştır. İlk hedef, ortaokul/lise kademesi bulunan ve kayıt/tahsilat/akademik takip ihtiyacını birlikte yaşayan özel okullardır.',footer='Kaynak: MEB · 2024–2025 Örgün Eğitim İstatistikleri · Yayımlanma: 30.09.2025')
 for i,(n,l) in enumerate([('14.700','özel okul'),('1.539.579','özel kurum öğrencisi'),('177.738','özel okul öğretmeni')]):
  x=.65+i*4.16
  await text(s,n,x,2.1,3.94,.8,42,'sapphire',True)
  await text(s,l,x,3.12,3.85,.49,19,'muted')
 await line(s,.65,4.04,12)
 await text(s,'İLK HEDEF',.65,4.41,2.6,.4,13,'sapphire',True)
 await text(s,'Ortaokul ve lise kademesi olan özel okullar',3.39,4.37,9.15,.63,25,'ink',True)
 await text(s,'Karar verici: kurucu / müdür\nBaşlangıç ihtiyacı: kayıt ve tahsilatın akademik süreçlerle birlikte takibi',3.39,5.21,9.1,.95,19,'muted')
 await text(s,'Okul sayısı, tekil müşteri veya parasal pazar büyüklüğü olarak yorumlanmamalıdır.',.65,6.61,11.98,.23,11,'muted')

 await module_slide('Web · CRM & satış','Her adayın bir sonraki adımı belli.', 'crm-adaylar',[
  ('Aday yönetimi','Aşama, kaynak, kampüs\nve programla filtreleme.'),
  ('Görüşme geçmişi','Notlar, iletişim kayıtları\nve tanışma takvimi.'),
  ('Dönüşüm görünümü','Adaydan kesin kayda\nilerleyiş ve raporlama.')],
  'CRM web ekranı. Yeni aday, iletişime geçildi, görüşme planlandı, teklif verildi, kayıt oldu ve vazgeçti aşamaları vardır. Aday detayında not ve görüşme takibi yapılır. Dönüşüm raporu bu ortak kayıtları temel alır. Görüntüdeki aday sayıları gerçek müşteri kazanımı değil mock okul verisidir.',
  'Değer: görüşme ve kayıt\ntakibini standartlaştırmak.')

 await pair_slide('Web · Kesin kayıt & belgeler','Kayıt kararı, sözleşme ve ödeme planına dönüşür.',
  'kayit-islemleri','sozlesme-onizleme','Kayıt ve taksit planı','Öğrenci / sınıf seçimi → eğitim bedeli →\ntaksit sayısı → kayıt kontrolü.',
  'Kurumsal belge çıktıları','Sözleşme, taksit taahhütnamesi ve dekont;\nönizleme, indirme ve yazdırma.',
  'Solda web kayıt formunun ödeme planı adımı, sağda veli portalında gerçek üretilen örnek sözleşmenin PDF önizlemesi vardır. Kayıt tamamlandığında öğrenci, sözleşme ve taksitler yerel store içinde oluşturulur. Belgelerin hukuken yürürlükte olduğu, gerçek imza veya gerçek tahsilat yapıldığı iddia edilmez.',
  'Kayıttan finans takibine geçişi tek akışta kurmak; ayrı belge ve taksit hazırlama işini azaltma hipotezi.')

 await module_slide('Web · Finans & tahsilat','Tahsilat planı ile gerçekleşen ödeme aynı yerde.', 'finans-tahsilat',[
  ('Taksit bazında kontrol','Vade, öğrenci, tutar\nve ödeme durumu.'),
  ('Öncelikli listeler','Gecikmiş / yaklaşan /\nödenen taksitler.'),
  ('Yönetim raporu','Toplam bedel, tahsilat,\nbakiye ve dışa aktarma.')],
  'Finans ekranı gerçek web demosudur. Tahsilat durumları ortak ödeme planından hesaplanır. Dekont ve filtreli rapor indirme vardır. Ekrandaki para tutarları Kampüs şirketinin geliri veya işlenmiş gerçek ödeme hacmi değildir. Gerçek banka/Sanal POS ve bildirim entegrasyonu yoktur.',
  'Değer: hangi ödemenin\ntakip gerektirdiğini görmek.')

 await pair_slide('Web · Kampüs, sınıf & kadro','Çok kampüslü okulun operasyonel omurgası.',
  'kampusler-siniflar','egitim-kadrosu','Kampüsler ve sınıflar','Kapasite, doluluk, sınıf oluşturma,\nders atamaları ve arşiv yönetimi.',
  'Eğitim kadrosu','Öğretmen, branş ve kampüs ataması;\nsınıflar ve takip metrikleri.',
  'Gerçek web kampüs/sınıf ve eğitim kadrosu ekranlarıdır. Ekleme, düzenleme ve arşivleme yerel veride çalışır; bağlı kayıtları koruyan aktarım kuralları vardır. 3 kampüs, 24 sınıf, 240 öğrenci ve 48 öğretmen demo senaryosudur; canlı kurum sayısı veya müşteri portföyü değildir.',
  'Yeni kampüs ve sınıflar aynı ürün içinde yönetilerek kurum içi genişlemeye temel oluşturur.')

 await module_slide('Web · Akademik operasyon','Ders planından öğrenci takibine uzanan iş akışı.', 'ders-programi',[
  ('Ders programı','Öğretmen, sınıf ve\nzaman bağlamı.'),
  ('Yoklama ve profil','Devamsızlık, not ve\nödev geçmişine erişim.'),
  ('Günlük iş takibi','Sınıflarım, etütler\nve öğretmen işleri.')],
  'Ders programı görüntüsü öğretmen web panelinden alınmıştır. Yoklama sınıf seçimiyle öğrencinin geldi/gelmedi/geç durumlarını kaydeder. Öğrenci profili not, devamsızlık ve ödev geçmişini gösterir. Web ve mobilde durum adları platform akışına göre sunulur; hepsi ortak akademik kayıt modeline dayanır.',
  'Değer: günlük okul işini\nkişisel listelerden çıkarmak.')

 await pair_slide('Web · LMS & dijital öğrenme','Ödev, ölçme ve içerik aynı öğrenme sürecinde.',
  'quiz-bankasi','ders-videolari','Soru bankası ve quiz','Soru seçimi, sınıfa atama ve sonuçlar;\nödev teslimi ve değerlendirme akışları.',
  'Video ve materyal kütüphanesi','Ders / konu bazlı içerik; izleme ilerlemesi,\ndokümanlar ve öğretmene soru sorma.',
  'Sol ekran web öğretmen quiz oluşturma arayüzü; başlık girilmiş, üç soru seçilmiş ama yeni quiz kaydı gönderilmemiştir. Sağ ekran web öğrenci ders videolarıdır. Dersler okul müfredatını kapsar; yalnızca İngilizce değildir. Mevcut demoda iki paketli gerçek video oynatılabilir. Video katalogundaki diğer kayıtlar örnek içerik listeleridir. Canlı yayın/WebRTC yoktur.',
  'Operasyonel yönetimin yanına düzenli akademik kullanım eklemek; birden fazla günlük rolü ürüne dahil etmek.')

 await module_slide('Web · Analiz & erken takip','Toplam notun arkasındaki ihtiyacı görünür kıl.', 'sinif-analizi',[
  ('Konu ve ders analizi','Güçlü alanlar, gelişim\nodağı ve geçmiş eğilim.'),
  ('Risk görünümü','Devamsızlık ve\nakademik risk listeleri.'),
  ('Yanıt süresi takibi','Soru kuyruğu, bekleme\nve SLA raporları.')],
  'Öğretmen sınıf analizi gerçek web görüntüsüdür. Yönetici risk ve SLA raporları aynı demo içinde ayrı modüllerdir. Akademik göstergeler mock not ve devam kayıtlarından hesaplanır. Bu ekranlar yapay zekâ tanısı, öğrenme garantisi veya ölçülmüş başarı artışı olarak sunulmaz.',
  'Değer: müdahale gerektiren\nöğrenciyi takip etmek.')

 await module_slide('Web · Veli & iletişim portalı','Veli, çocuğunun durumunu okuldan bağımsız izler.', 'veli-akademik-takip',[
  ('Çocuk bazında görünüm','Not, devamsızlık,\nödev ve ders bilgisi.'),
  ('Finansal şeffaflık','Bakiye, taksit, dekont\nve sözleşme erişimi.'),
  ('İletişim akışları','Mesaj, görüşme, izin,\nşikayet ve duyuru.')],
  'Web veli akademik takip ekranı. Deniz ve Ece arasında seçili çocuk bağlamı korunur. Öğretmen değerlendirmeleri, randevu/mesaj, duyuru, izin/mazeret, şikayet/talep ve finans belgeleri rol kapsamındadır. Bildirim tercihleri vardır; dış SMS, e-posta, push gönderimi bu demoda simüledir.',
  'Değer: bilgiye erişimi\ntek bir portalda toplamak.')

 s=await slide('Mobil · Öğrenci','Okulun günlük gündemi, öğrencinin cebinde.', 'Bu mobil bölüm web ürününü tamamlayan öğrenci kullanımını gösterir. Solda Android 1.3.0 APK ana ekranı; sağda aynı React Native uygulamasının Expo web önizlemesinden ödev detayı vardır. Ekranlar ayrı yerel demo oturumlarından alınmıştır. Dosya seçimi, yerel teslim ve taslak kalıcılığı çalışır; sunucu yüklemesi ve canlı eşzamanlılık yoktur.',footer=MOBILE_FOOTER)
 await photo(s,'android-ogrenci-ana-ekran',.72,2.03,h=4.76)
 await photo(s,'ogrenci-odev-detayi',3.18,2.03,h=4.76)
 await feature(s,'01','Bugün ne yapmalıyım?','Ders, ödev ve duyurularla\naçık bir günlük gündem.',6.1,2.18)
 await feature(s,'02','Dosya seç ve teslim et','Ödev yönergesi, ek dosya,\nteslim ve başarı durumu.',6.1,3.75)
 await feature(s,'03','Çalışmaya devam et','Paketli videolar ve yerel taslaklar\nçevrimdışı kullanım sağlar.',6.1,5.32)

 s=await slide('Mobil · Veli','Çocuğun gündemi ve ödeme planı elinin altında.', 'Veli mobil çocuk seçimi ve ödeme planı. Soldaki görsel Expo önizlemesi; sağdaki koyu tema Android 1.3.0 APK’dır. Örnek çocuklar Deniz Yılmaz 7-A ve Ece Yılmaz 5-A, veli Ayşe Yılmaz’dır. Taksite ait 24.500 TL tutar mock örnektir. Gerçek para tahsilatı yapılmaz.',footer=MOBILE_FOOTER)
 await photo(s,'veli-cocuk-secimi',.72,2.03,h=4.76)
 await photo(s,'android-odeme-plani-koyu',3.18,2.03,h=4.76)
 await feature(s,'01','Birden fazla çocuğa tek erişim','Seçilen çocuk akademik ve\nfinansal sayfalarda korunur.',6.1,2.18)
 await feature(s,'02','Ödemeyi anlamak kolay','Tutar, vade ve ödeme durumu\naynı listede görünür.',6.1,3.75)
 await feature(s,'03','Okulla teması sürdür','Öğretmen görüşleri, mesajlar,\nrandevular ve talepler.',6.1,5.32)

 s=await slide('Mobil · Öğretmen','Öğretmenin takibi masa başıyla sınırlı kalmaz.', 'Görsel gerçek React Native Expo önizlemesinden soru yanıtlama ekranıdır. Öğretmen kuyrukta öğrenci, konu ve süreyi görür; açılan soruya yanıt yazar ve yerel kaydı günceller. Yanıt, mesaj, ödev notu/dosyası ve yoklama taslakları cihazda saklanır. Klavye görünürlüğü emülatörde beş rolde doğrulanmıştır; fiziksel telefon performansı henüz doğrulanmamıştır.',footer=MOBILE_FOOTER)
 await photo(s,'ogretmen-soru-detayi',1.6,1.94,h=4.88)
 await feature(s,'01','Soruyu bağlamıyla yanıtla','Öğrenci, sınıf, konu ve bekleme\nsüresini kaybetmeden çalış.',5.35,2.08,w=6.63)
 await feature(s,'02','Günlük işleri tamamla','Yoklama, ders programı, ödev\ndeğerlendirme ve etüt takibi.',5.35,3.69,w=6.63)
 await feature(s,'03','Yarım kalan iş korunur','Yanıt, yoklama ve mesaj taslakları\nuygulama yeniden açıldığında gelir.',5.35,5.3,w=6.63)

 s=await slide('İş modeli · Öneri','Okulla başlayan, kurum içinde genişleyen abonelik.', 'Henüz uygulanmış fiyat veya ticari kazanım değil, önerilen yıllık B2B SaaS modelidir. Birinci gelir kaynağı kampüs lisansı, ölçekleyiciler öğrenci kapasitesi/yeni kampüs/isteğe bağlı modüllerdir. İlk kurulum ve veri aktarımı ayrı hizmet olabilir. Fiyat, brüt marj, müşteri edinme maliyeti, ödeme isteği ve yenileme pilotlarda ölçülecektir. Gerçek faturalanmış müşteri veya gelir açıklanmamıştır.',dark=True,footer='Önerilen ticari model · Fiyatlar ve birim ekonomi pilotta doğrulanacak')
 business=[('Ana gelir','Yıllık kampüs lisansı','Okulun günlük operasyonunu\nkapsayan abonelik.'),('Genişleme','Kapasite + modüller','Yeni öğrenci kapasitesi,\nek kampüs ve ek kullanım.'),('Geçiş hizmeti','Kurulum + eğitim','Veri aktarımı, ilk kurulum\nve okul içi kullanıcı eğitimi.')]
 for i,(tag,head,body) in enumerate(business):
  x=.65+i*4.16
  await text(s,tag.upper(),x,2.24,3.78,.3,12,'light_text',True)
  await text(s,head,x,3.02,3.8,1.0,28,'white',True)
  await text(s,body,x,4.39,3.8,1.0,19,'light_text')
  await line(s,x,5.83,3.76,True)
 await text(s,'Ölçülecek: okul başına gelir · kurulum / destek maliyeti · yenileme · kampüs genişlemesi',.65,6.25,12,.52,17,'white',True)

 s=await slide('Konumlandırma','İlk satışın ardından yeni iş alanlarına genişleme.', 'Bu konumlandırma bir rakip karşılaştırma araştırması değildir ve tek/ilk ürün iddiası içermez. Önerilen strateji: kurumun öncelikli kayıt/finans ihtiyacından giriş, akademik günlük kullanımla derinleşme, kampüs/modül genişlemesiyle büyüme. Bu akış henüz ölçülmüş kullanım veya gelir genişlemesi değildir. Savunulabilirlik, pilotlarda oluşacak ürün benimsemesi, veri aktarım kolaylığı ve kurumsal kullanım kalitesiyle inşa edilecektir.')
 stages=[('01','Giriş ihtiyacı','CRM + kayıt + finans','Kurucu ve yönetim için\nsomut operasyonel kapsam.'),('02','Günlük kullanım','Akademik + öğrenme','Öğretmen, öğrenci ve veli\nüzerinden kullanım sıklığı.'),('03','Kurum içi genişleme','Kampüs + kapasite','Aynı okul grubunda daha\ngeniş ürün kullanımı.')]
 for i,(n,h,sub,b) in enumerate(stages):
  x=.65+i*4.16
  await text(s,n,x,2.14,.9,.65,34,'orange',True)
  await text(s,h,x,3.08,3.8,.82,25,'sapphire',True)
  await text(s,sub,x,4.27,3.8,.52,20,'ink',True)
  await text(s,b,x,5.18,3.8,1.0,18,'muted')
 await text(s,'Değer hipotezi: süreçlerin birbirini beslemesi, tek modülün kullanım değerini artırır.',.65,6.61,12,.25,12,'muted')

 s=await slide('Pazara giriş · Öneri','Kısa bir özellik demosundan, ölçülen okul pilotuna.', 'Başlangıç hedefi üç pilot okuldur; imzalanmış pilot veya müşteri değildir. Doğrudan kurucu/müdür görüşmesi, ihtiyaç keşfi, kontrollü kurulum, ölçüm, ücretli sözleşme ve referans büyümesi önerilir. İlk pilot kapsamı küçük tutulmalı; veri aktarımı ve destek yükü ölçülmelidir. Eşikler saha başlangıç ölçümünden sonra kesinleşir.',footer='Pilot ve satış planı önerisi · 3 okul bir hedeftir, mevcut müşteri sayısı değildir')
 await text(s,'İlk hedef: 3 pilot okul',.65,2.16,7.8,.68,32,'sapphire',True)
 await text(s,'Karar verici: kurucu / müdür  ·  İç destekçi: ön büro veya akademik koordinatör',.65,3.11,12,.43,17,'muted')
 data=[('Kurulum','Veri aktarımı ve temel iş akışı\nİlk değer alınan güne kadar süre'),('Kullanım','Haftalık aktif roller ve işlem sıklığı\nGörev tamamlama ve destek ihtiyacı'),('Ticari doğrulama','Ödeme istekliliği ve yıllık sözleşme\nReferans olma ve genişleme niyeti')]
 for i,(a,b) in enumerate(data):
  x=.65+i*4.16
  await line(s,x,4.15,3.76)
  await text(s,a,x,4.53,3.78,.53,24,'sapphire',True)
  await text(s,b,x,5.37,3.78,1.19,18)

 s=await slide('Ürün aşaması & yol haritası','Çalışan demodan, ücretli okul pilotuna.', 'Bugünkü aşama: Vue web ve React Native Android demosu, beş rol, yerel örnek veri, belge/video ve yerel işlemler. Gerçek backend, kurumsal auth/veri izolasyonu, gerçek banka/dış bildirim ve web/telefon eşzamanlılığı yoktur. Bunlar üretime geçiş iş paketidir. Takvim öneridir; ekip ve bütçeye göre kesinleştirilecektir. 35 birim testi ve build kontrolleri önceki mobil sürümde geçti; bu revizyon uygulama kodunu değiştirmez. Fiziksel okul sahası doğrulaması yapılmamıştır.',footer='Takvim önerisi · Kaynak, ekip ve pilot kapsamıyla kesinleştirilecek')
 await shape(s,.65,2.15,3.39,4.45,'pale_blue',kind='rounded_rectangle')
 await text(s,'BUGÜN',.89,2.46,2.9,.33,12,'sapphire',True)
 await text(s,'Çalışan demo',.89,3.18,2.87,.77,28,'sapphire',True)
 await text(s,'Web + Android\nBeş rol ve modüler menü\nYerel kayıt kalıcılığı\nBelge, video ve iş akışları',.89,4.35,2.92,1.66,18)
 phases=[('0–3 ay','Üretim temeli','Backend, kurum izolasyonu,\nyetkilendirme ve veri aktarımı.'),('4–6 ay','Okul pilotları','3 okul hedefi; kullanım, destek\nyükü ve fiyat doğrulaması.'),('7–12 ay','Tekrarlanabilir satış','Ücretli sözleşme, referans\nve kampüs genişlemesi.')]
 for i,(a,b,c) in enumerate(phases):
  y=2.18+i*1.51
  await text(s,a,4.53,y,1.46,.42,17,'orange',True)
  await text(s,b,6.17,y-.02,6.3,.48,23,'sapphire',True)
  await text(s,c,6.17,y+.58,6.38,.74,18,'muted')

 s=await slide('Yatırım görüşmesinin odağı','Yatırımın hedefi: üretim altyapısı ve ücretli pilot.', 'Yatırım turu, tutar, değerleme, ortaklık yüzdesi ve ekip biyografisi sağlanmadığı için sunumda üretilmemiştir. Bu slayt yatırımın kullanım alanlarını somut iş paketlerine bağlar: ürün/altyapı, pilot geçişi ve satış doğrulaması. Sonuç hedefi güvenilir biçimde işletilen bir pilot ve ilk ücretli okul sözleşmesidir; şu anda elde edilmiş sonuç olarak anlatılmaz.',dark=True)
 items=[('Ürünleştirme','Veri güvenliği ve kurum izolasyonu\nWeb / mobil eşzamanlılığı\nÜretim işletimi ve yedekleme'),('Pilot uygulama','Veri aktarımı ve okul eğitimi\nGerçek cihaz / süreç testleri\nDestek ve benimseme ölçümü'),('Satış doğrulaması','Özel okul ağına erişim\nPaket ve fiyat testi\nReferans ve yıllık sözleşme')]
 for i,(a,b) in enumerate(items):
  x=.65+i*4.16
  await text(s,a,x,2.44,3.8,.58,27,'white',True)
  await text(s,b,x,3.51,3.85,1.57,19,'light_text')
 await line(s,.65,5.67,12,True)
 await text(s,'Birlikte netleştirilecek: pilot kurumlar, kaynak planı ve ölçülebilir başarı kriterleri.',.65,6.13,12,.7,23,'white',True)

 s=await slide('Ek · Ayrıntılı modül kapsamı','Okulun temel operasyonları için ortak ürün.', 'Bu tablo gerçek demo modül kapsamını özetler. Dışa aktarma, PDF, arama/filtre ve sayfalama ortak deneyim bileşenleridir. Belge örnekleri, ödeme adımları ve bildirim gönderme davranışları demo niteliğindedir. Üretim entegrasyonları ayrı iş paketidir.')
 rows=[('CRM & kayıt','Aday listesi / detay, görüşme notu, tanışma takvimi, kesin kayıt,\nsözleşme, taksit planı ve aday → kayıt dönüşüm raporu.'),('Finans & belgeler','Taksit / tahsilat listesi, geciken ve yaklaşan ödemeler, bakiye,\ndekont, sözleşme, taahhütname, rapor ve PDF önizleme.'),('Yönetim & akademik','Kampüs / sınıf / kadro, branş ve ders atamaları, program,\nyoklama, öğrenci profili, not, devamsızlık, risk ve SLA raporları.'),('Öğrenme & analiz','Ödev / teslim / değerlendirme, materyal, ders videosu, soru bankası,\nquiz çözme / oluşturma, öğrenci sorusu / yanıt, sınıf ve konu analizi.'),('Portallar & iletişim','Çocuk seçimi, akademik / finansal veli takibi, öğretmen görüşleri,\nmesaj, randevu, izin / mazeret, şikayet / talep, duyuru ve tercihler.')]
 for i,(a,b) in enumerate(rows):
  y=2.03+i*.94
  await line(s,.65,y,12)
  await text(s,a,.65,y+.22,2.62,.6,18,'sapphire',True)
  await text(s,b,3.55,y+.19,9.06,.65,16)

 s=await slide('Ek · Kaynaklar & veri notu','Pazar verisi, ürün kanıtı ve plan ayrı okunmalı.', 'MEB birincil kaynak: https://www.meb.gov.tr/2024-2025-orgun-egitim-istatistikleri-aciklandi//haber/38473/tr . Yıl 2024–2025, yayımlanma 30.09.2025, kontrol 28.09.2026. Görseller yerel çalışan Vue web ve React Native Android/Expo uygulamalarından alınmıştır. Sunumda 12 web, 5 mobil görüntü vardır. Ticari planlar öneridir. Gerçek müşteri, şirket cirosu, yatırım tutarı veya değerleme iddiası yoktur. PowerPoint içerikleri Office-PowerPoint-MCP-Server araçlarıyla üretildi.')
 await text(s,'Pazar verisi',.65,2.1,2.6,.5,22,'sapphire',True)
 await text(s,'MEB · 2024–2025 Örgün Eğitim İstatistikleri\n14.700 özel okul · 1.539.579 öğrenci · 177.738 öğretmen\nYayımlanma: 30 Eylül 2025',3.52,2.1,9.1,1.1,18)
 await text(s,'Kaynak: MEB resmî istatistik duyurusu',3.52,3.36,9,.28,12,'muted')
 await line(s,.65,3.97,12)
 await text(s,'Ürün kanıtı',.65,4.21,2.6,.5,22,'sapphire',True)
 await text(s,'12 web ekranı + 5 mobil ekranı; çalışan yerel uygulamalar.\nOkul, öğrenci, finans ve performans kayıtları örnek veridir.\nBugünkü ürün sunucusuz demodur; canlı eşzamanlılık bulunmaz.',3.52,4.2,9.1,1.22,18)
 await line(s,.65,5.75,12)
 await text(s,'Ticari plan',.65,6.0,2.6,.5,22,'sapphire',True)
 await text(s,'Gelir modeli, pilot hedefi ve yol haritası öneridir.\nMüşteri, gelir, değerleme veya yatırım tutarı iddiası içermez.',3.52,5.99,9.1,.79,18)

 await call('save_presentation',presentation_id=PID,file_path=str(ART/'kampus-mcp-raw.pptx'))
 info=await call('get_presentation_info',presentation_id=PID)
 (ART/'mcp-presentation-info.json').write_text(json.dumps(info,ensure_ascii=False,indent=2))

async def main():
 global SESSION
 params=StdioServerParameters(command=PYTHON,args=[str(SERVER/'ppt_mcp_server.py')],cwd=str(SERVER))
 with (ART/'mcp-generation-server.log').open('w') as log:
  try:
   async with stdio_client(params,errlog=log) as (read,write):
    async with ClientSession(read,write) as session:
     SESSION=session;await session.initialize();await build()
  finally:
   (ART/'mcp-generation-calls.json').write_text(json.dumps(CALLS,ensure_ascii=False,indent=2))
   (ART/'slide-content.json').write_text(json.dumps({'text':TEXTS,'notes':NOTES,'screenshots':PHOTOS},ensure_ascii=False,indent=2))
 # MCP creates all editable content. Deterministic finishing: no default padding/shadow/theme auto-fit.
 deck=Presentation(ART/'kampus-mcp-raw.pptx')
 for i,sl in enumerate(deck.slides):
  sl.notes_slide.notes_text_frame.text=NOTES[i]
  for sh in sl.shapes:
   if sh.has_text_frame:
    tf=sh.text_frame;tf.margin_left=0;tf.margin_right=0;tf.margin_top=0;tf.margin_bottom=0;tf.word_wrap=True;tf.auto_size=MSO_AUTO_SIZE.NONE
    for p in tf.paragraphs:
     p.space_before=Pt(0);p.space_after=Pt(0);p.line_spacing=1.12
     for r in p.runs:r._r.get_or_add_rPr().set('lang','tr-TR')
   if sh.shape_type==1 and len(sh.adjustments):sh.adjustments[0]=.08
   for effect_ref in sh._element.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}effectRef'):
    effect_ref.set('idx','0')
   sp=sh._element.find('{http://schemas.openxmlformats.org/presentationml/2006/main}spPr')
   if sp is not None:
    from lxml import etree
    ns='http://schemas.openxmlformats.org/drawingml/2006/main'
    for e in list(sp):
     if e.tag in ('{'+ns+'}effectLst','{'+ns+'}effectDag'):sp.remove(e)
    etree.SubElement(sp,'{'+ns+'}effectLst')
 # Clickable primary sources on the appendix.
 for sh in deck.slides[-1].shapes:
  if sh.has_text_frame and sh.text.startswith('Kaynak:'):
   sh.text_frame.paragraphs[0].runs[0].hyperlink.address='https://www.meb.gov.tr/2024-2025-orgun-egitim-istatistikleri-aciklandi//haber/38473/tr'
 deck.save(OUT/'kampus-yatirimci-sunumu-v2.pptx')
 print(f'Tamamlandı: {len(deck.slides)} slayt, {len(CALLS)} MCP çağrısı.',flush=True)

if __name__=='__main__':asyncio.run(main())
