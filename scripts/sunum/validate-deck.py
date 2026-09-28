from pathlib import Path
import json, unicodedata
import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
ROOT=Path(__file__).resolve().parents[2];ART=ROOT/'artifacts/investor-presentation';OUT=ROOT/'sunumlar'
PPT=OUT/'kampus-yatirimci-sunumu-v2.pptx';PDF=OUT/'kampus-yatirimci-sunumu-v2.pdf'
prs=Presentation(PPT);doc=fitz.open(PDF);expected=json.loads((ART/'slide-content.json').read_text())
preview=ART/'previews';preview.mkdir(exist_ok=True)
issues=[];warnings=[];text_count=0;images=0;notes=0
for i,sl in enumerate(prs.slides):
 if not sl.has_notes_slide or not sl.notes_slide.notes_text_frame.text.strip():issues.append(f'{i+1}: konuşmacı notu eksik')
 else:notes+=1
 for sh in sl.shapes:
  if sh.left<-.01*914400 or sh.top<-.01*914400 or sh.left+sh.width>prs.slide_width+.01*914400 or sh.top+sh.height>prs.slide_height+.01*914400:issues.append(f'{i+1}: slayt dışında {sh.shape_id}')
  if sh.has_text_frame and sh.text.strip():text_count+=1
  if sh.shape_type==13:
   images+=1; a,b=sh.image.size
   if abs((sh.width/sh.height)/(a/b)-1)>.001:issues.append(f'{i+1}: görsel en/boy bozulmuş')
 def norm(t):return ''.join(unicodedata.normalize('NFC',t).split()).replace('\u00ad','').replace('ﬁ','fi').replace('ﬂ','fl')
 page=doc[i];raw=page.get_text();got=norm(raw)
 for item in expected['text']:
  if item['slide']==i+1 and norm(item['text']) not in got:issues.append(f"{i+1}: PDF metni eksik veya değişmiş: {item['text']}")
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line.get('spans',[]):
    x1,y1,x2,y2=span['bbox']
    if x1<-.5 or y1<-.5 or x2>page.rect.width+.5 or y2>page.rect.height+.5:issues.append(f'{i+1}: sayfa dışı PDF metni: {span["text"]}')
 page.get_pixmap(matrix=fitz.Matrix(1.6,1.6),alpha=False).save(preview/f'slide-{i+1:02}.png')
if len(prs.slides)!=len(doc):issues.append('PPTX / PDF sayfa sayısı farklı')
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
for part in range(0,len(doc),6):
 selected=range(part,min(part+6,len(doc))); sheet=Image.new('RGB',(1600,3*495),'#e7ecf3');d=ImageDraw.Draw(sheet)
 for ix,pageno in enumerate(selected):
  im=Image.open(preview/f'slide-{pageno+1:02}.png');im.thumbnail((774,437));x=13+(ix%2)*800;y=12+(ix//2)*495
  sheet.paste(im,(x,y));d.text((x,y+446),f'Slayt {pageno+1}',fill='#172438',font=font)
 sheet.save(preview/f'contact-{part//6+1}.jpg',quality=92)
distribution={platform:sum(x['platform']==platform for x in expected.get('screenshots',[])) for platform in ['web','mobile']}
mobile_slides=sorted({x['slide'] for x in expected.get('screenshots',[]) if x['platform']=='mobile'})
if distribution!={'web':12,'mobile':5} or len(mobile_slides)!=3:issues.append('Beklenen 12 web / 5 mobil / 3 mobil slayt dağılımı değişti')
report={'screenshotDistribution':distribution,'mobileSlides':mobile_slides,'slideCount':len(prs.slides),'pdfPages':len(doc),'editableTextBoxes':text_count,'embeddedScreenshots':images,'speakerNotes':notes,'issues':issues,'warnings':warnings}
(ART/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

if issues:raise SystemExit(1)
