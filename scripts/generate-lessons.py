"""Yerel ders videolarını üretir: Python/Pillow + FFmpeg + macOS Türkçe Yelda sesi.
Üretilmiş MP4, poster ve VTT dosyaları uygulamayla birlikte dağıtılır.
"""
from pathlib import Path
import subprocess
import tempfile
import textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/web/public/videos'
FONT = ROOT / 'apps/web/public/fonts/NotoSans-Regular.ttf'
OUT.mkdir(parents=True, exist_ok=True)
LESSONS = [
 ('denklemler', 'MATEMATİK · 7. SINIF', (119, 102, 186), [
  ('Denklem bir dengedir', 'Eşitliğin iki tarafı aynı değerdedir.', '2x + 6 = 18', 'Denklem, iki ifadenin eşitliğini gösterir. Eşitliği dengede bir terazi gibi düşünebiliriz. Bu derste iki x artı altı eşittir on sekiz denklemini çözeceğiz. Amacımız x değerini bulmak.'),
  ('Önce fazlalığı kaldıralım', 'Her iki taraftan da 6 çıkar.', '2x + 6 - 6 = 18 - 6', 'Önce x içeren terimi yalnız bırakalım. Bunun için eşitliğin iki tarafından da altı çıkarırız. Sol tarafta iki x, sağ tarafta on iki kalır. Yalnızca bir taraftan çıkarırsak eşitlik bozulur.'),
  ('İki eş parçaya ayıralım', 'Her iki tarafı da 2’ye böl.', '2x / 2 = 12 / 2', 'Artık iki x eşittir on iki. Bir x değerini bulmak için iki tarafı da ikiye böleriz. Sonuç x eşittir altı. Her adımda iki tarafa da aynı işlemi uyguladığımıza dikkat et.'),
  ('Sonucu kontrol edelim', 'x yerine 6 yaz. Eşitlik sağlanıyor mu?', '2 × 6 + 6 = 18', 'Bulduğumuz altıyı ilk denklemde x yerine yazalım. İki çarpı altı artı altı, on sekiz eder. Eşitlik sağlandı. Şimdi sıra sende: üç x artı üç eşittir on sekiz denklemini çöz. Cevabın beş olmalı.'),
 ]),
 ('hucre', 'FEN BİLİMLERİ · 7. SINIF', (65, 143, 123), [
  ('Canlıların küçük dünyası', 'Hücre: temel yapı ve görev birimi', 'HÜCRE', 'Hücre, canlıların temel yapı ve görev birimidir. Bitkiler ve hayvanlar hücrelerden oluşur. Hücreyi, farklı görevleri paylaşan yapıların birlikte çalıştığı küçük bir sistem olarak düşünebiliriz.'),
  ('Her yapının bir görevi var', 'Zar · Çekirdek · Mitokondri', 'GÖREV PAYLAŞIMI', 'Hücre zarı, hücre ile çevresi arasındaki madde alışverişini düzenler. Çekirdek kalıtsal bilgiyi taşır. Mitokondri, hücrenin kullanabileceği enerjinin üretiminde görevlidir. Bu yapılar birlikte çalışır.'),
  ('Bitki hücresini tanıyalım', 'Hücre duvarı ve kloroplastı fark et.', 'BİTKİ HÜCRESİ', 'Bitki hücresinde hücre zarının dışında hücre duvarı bulunur. Duvar hücreye destek verir. Kloroplast ise fotosentezin gerçekleştiği yapıdır. Kloroplast ve hücre duvarı hayvan hücresinde bulunmaz.'),
  ('Karşılaştır ve hatırla', 'Ortak yapılar ve ayırt edici özellikler', 'BİTKİ  ve  HAYVAN', 'Bitki ve hayvan hücrelerinde hücre zarı, sitoplazma ve çekirdek gibi ortak yapılar vardır. Bitki hücresini ayırt ederken hücre duvarını ve kloroplastı hatırla. Şimdi bir tablo çiz ve öğrendiğin yapıların görevlerini kendi cümlelerinle yaz.'),
 ])]

def font(size): return ImageFont.truetype(str(FONT), size)
def stamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d}.{ms%1000:03d}'
def run(args): subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
with tempfile.TemporaryDirectory(prefix='kampus-video-') as tmp:
    tmp = Path(tmp)
    for slug, subject, accent, slides in LESSONS:
        clips, cues, elapsed = [], [], 0.0
        for index, (title, subtitle, formula, narration) in enumerate(slides):
            img = Image.new('RGB', (1280, 720), '#f7f5f1'); draw = ImageDraw.Draw(img)
            draw.rounded_rectangle((40, 36, 1240, 684), radius=38, fill='white')
            draw.rounded_rectangle((76, 74, 610, 122), radius=24, fill=(*accent,))
            draw.text((98, 82), subject, font=font(23), fill='white')
            draw.text((82, 155), title, font=font(43), fill='#263445')
            draw.text((82, 219), subtitle, font=font(26), fill='#677281')
            if slug == 'denklemler':
                draw.rounded_rectangle((80, 300, 1200, 520), radius=32, fill='#f0ecfa')
                draw.text((125, 366), formula, font=font(59 if index != 1 else 53), fill=accent)
                draw.text((100, 552), ['Dengeyi koru. Aynı işlemi iki tarafa uygula.', 'Sonuç: 2x = 12', 'Sonuç: x = 6', 'Sen dene: 3x + 3 = 18'][index], font=font(27), fill='#566172')
            else:
                draw.rounded_rectangle((82, 300, 510, 565), radius=48 if index < 2 else 24, fill='#e8f4ed', outline=accent, width=6)
                draw.ellipse((240, 362, 350, 466), fill='#a599d0'); draw.text((258, 396), 'Ç', font=font(25), fill='white')
                for x, y in [(130, 350), (380, 460), (180, 475)]: draw.ellipse((x, y, x+65, y+28), fill='#e9b478')
                if index >= 2:
                    for x, y in [(380, 335), (115, 420)]: draw.ellipse((x, y, x+63, y+30), fill='#60a67f')
                lines = [['Hücre zarı', 'Sitoplazma', 'Çekirdek'], ['Hücre zarı : Madde alışverişi', 'Çekirdek : Kalıtsal bilgi', 'Mitokondri : Enerji üretimi'], ['Hücre duvarı : Destek', 'Kloroplast : Fotosentez', 'Hayvan hücresinde bulunmaz.'], ['Ortak: zar, sitoplazma, çekirdek', 'Bitkide: duvar ve kloroplast', 'Görevleriyle birlikte öğren.']][index]
                for n, line in enumerate(lines): draw.text((555, 332+n*73), line, font=font(26), fill='#34554b')
                draw.text((100, 583), 'Şematik gösterim · Yapılar ölçekli değildir.', font=font(18), fill='#677281')
            draw.text((82, 636), 'KAMPÜS  /  Akademi Özel Okulları', font=font(18), fill='#7c8490')
            for n in range(4): draw.rounded_rectangle((1040+n*36, 644, 1065+n*36, 651), radius=4, fill=accent if n <= index else '#e7e8ed')
            png = tmp / f'{slug}-{index}.png'; img.save(png)
            if index == 0: img.save(OUT / f'{slug}.jpg', quality=88, optimize=True)
            audio = tmp / f'{slug}-{index}.aiff'
            run(['say', '-v', 'Yelda', '-r', '155', '-o', str(audio), narration])
            duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(audio)])) + 0.8
            clip = tmp / f'{slug}-{index}.mp4'
            run(['ffmpeg', '-y', '-loop', '1', '-i', str(png), '-i', str(audio), '-c:v', 'libx264', '-preset', 'fast', '-tune', 'stillimage', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '24', '-c:a', 'aac', '-b:a', '96k', '-af', 'apad', '-t', str(duration), '-movflags', '+faststart', str(clip)])
            clips.append(clip)
            sentences = narration.split('. ')
            for n, sentence in enumerate(sentences): cues.append(f'{stamp(elapsed+duration*n/len(sentences))} --> {stamp(elapsed+duration*(n+1)/len(sentences))}\n{sentence}\n')
            elapsed += duration
        playlist = tmp / f'{slug}.txt'; playlist.write_text(''.join(f"file '{clip}'\n" for clip in clips))
        run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist), '-c', 'copy', '-movflags', '+faststart', str(OUT / f'{slug}.mp4')])
        (OUT / f'{slug}.vtt').write_text('WEBVTT\n\n' + '\n'.join(cues))
        print(f'{slug}: {elapsed:.1f} saniye', flush=True)
