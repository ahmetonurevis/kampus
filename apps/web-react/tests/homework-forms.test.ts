import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addUploadedFile,
  changedHomeworkFields,
  homeworkActions,
  planHomeworkUpdate,
  SUBMISSION_FILE_LIMIT,
  type HomeworkFormOutput,
} from '../src/pages/learning/homework-forms.ts'

// OG-047 (DOM-AKD-070, 071, 072): ödev formunun gövde planı, dosya sığdırma ve yetki hesapları.

const opened = {
  title: 'Üslü sayılar',
  description: 'Sayfa 14 alıştırmaları.',
  dueDate: '2026-11-10T14:00:00.000Z',
  allowLate: true,
}

const values = (patch: Partial<HomeworkFormOutput> = {}): HomeworkFormOutput => ({
  classId: 'c1',
  subjectId: 'math',
  ...opened,
  ...patch,
})

describe('ödev düzenleme planı: sessiz ezme yok (OG-047, DOM-AKD-071)', () => {
  test('yalnız kullanıcının değiştirdiği alan gider; başkasının başlığı geri yazılmaz', () => {
    // B başlığı değiştirdi; A yalnız açıklamayı düzenledi.
    const fresh = { ...opened, title: 'Üslü sayılar (B)' }
    const plan = planHomeworkUpdate(opened, fresh, values({ description: 'Sayfa 15.' }))
    assert.deepEqual(plan.body, { description: 'Sayfa 15.' })
    assert.deepEqual(plan.overlaps, [])
  })

  test('taze kayıtla karşılaştırılan eski kod başlığı geri yazardı (regresyon)', () => {
    const fresh = { ...opened, title: 'Üslü sayılar (B)' }
    const old = changedHomeworkFields(fresh, values({ description: 'Sayfa 15.' }))
    assert.equal(old.title, 'Üslü sayılar', 'eski hesap kullanıcının dokunmadığı alanı ezerdi')
    assert.equal(
      'title' in planHomeworkUpdate(opened, fresh, values({ description: 'x' })).body,
      false,
    )
  })

  test('aynı alanı başkası da değiştirdiyse iki değer listelenir ve alan gövdede kalır', () => {
    const fresh = { ...opened, description: 'Sayfa 20.' }
    const plan = planHomeworkUpdate(opened, fresh, values({ description: 'Sayfa 15.' }))
    assert.deepEqual(plan.body, { description: 'Sayfa 15.' })
    assert.deepEqual(plan.overlaps, [
      { field: 'description', label: 'Açıklama', theirs: 'Sayfa 20.', mine: 'Sayfa 15.' },
    ])
  })

  test('başkası aynı değeri girdiyse çakışma yok ve alan gönderilmez', () => {
    const fresh = { ...opened, title: 'Yeni başlık' }
    const plan = planHomeworkUpdate(opened, fresh, values({ title: 'Yeni başlık' }))
    assert.deepEqual(plan.body, {})
    assert.deepEqual(plan.overlaps, [])
  })

  test('kullanıcı hiçbir şeyi değiştirmediyse gövde boştur (başkasının değişikliği olsa da)', () => {
    const fresh = { ...opened, allowLate: false }
    const plan = planHomeworkUpdate(opened, fresh, values())
    assert.deepEqual(plan.body, {})
    assert.deepEqual(plan.overlaps, [])
  })

  test('son teslim ve geç teslim çakışması okunur metinle gösterilir', () => {
    const fresh = { ...opened, dueDate: '2026-11-12T14:00:00.000Z', allowLate: false }
    const plan = planHomeworkUpdate(
      opened,
      fresh,
      values({ dueDate: '2026-11-11T14:00:00.000Z', allowLate: false }),
    )
    // Geç teslimi başkası da kapattı: aynı değer, çakışma değil ve gövdede yok.
    assert.deepEqual(Object.keys(plan.body), ['dueDate'])
    const due = plan.overlaps.find((item) => item.field === 'dueDate')
    assert.ok(due)
    assert.equal(due.label, 'Son teslim')
    assert.notEqual(due.theirs, due.mine)
    assert.equal(
      plan.overlaps.some((item) => item.field === 'allowLate'),
      false,
    )
  })

  test('uzun açıklama çakışma satırında kısaltılır', () => {
    const long = 'a'.repeat(200)
    const plan = planHomeworkUpdate(
      opened,
      { ...opened, description: long },
      values({ description: 'kısa' }),
    )
    const [overlap] = plan.overlaps
    assert.ok(overlap && overlap.theirs.length <= 81 && overlap.theirs.endsWith('…'))
  })
})

describe('teslim dosyaları (OG-047, DOM-AKD-072)', () => {
  const file = (id: string) => ({ id, name: `${id}.pdf` })

  test('teslim en çok 5 dosya alır', () => {
    assert.equal(SUBMISSION_FILE_LIMIT, 5)
  })

  test('yüklenen dosya id ile tekilleştirilir; yeni id eklenir', () => {
    const current = [file('a')]
    assert.deepEqual(addUploadedFile(current, file('a')), [file('a')])
    assert.deepEqual(addUploadedFile(current, file('b')), [file('a'), file('b')])
  })

  test('liste dolu iken yeni dosya eklenmez', () => {
    const full = ['a', 'b', 'c', 'd', 'e'].map(file)
    assert.equal(addUploadedFile(full, file('f')).length, 5)
  })
})

describe('ödev işlem yetkisi (OG-047, DOM-AKD-070, 071, 073)', () => {
  const homework = { teacherId: 't1' }
  test('ödevin öğretmeni düzenler ve değerlendirir; başka öğretmen hiçbirini yapamaz', () => {
    const owner = homeworkActions({ role: 'ogretmen', teacherId: 't1' }, homework)
    assert.deepEqual([owner.manage, owner.grade], [true, true])
    const other = homeworkActions({ role: 'ogretmen', teacherId: 't2' }, homework)
    assert.deepEqual([other.create, other.manage, other.grade], [true, false, false])
  })

  test('yönetici düzenler, değerlendirmez; öğrenci ve veli hiçbir işlem yapmaz', () => {
    const admin = homeworkActions({ role: 'yonetici', teacherId: null }, homework)
    assert.deepEqual([admin.manage, admin.grade], [true, false])
    for (const role of ['ogrenci', 'veli']) {
      const actions = homeworkActions({ role, teacherId: null }, homework)
      assert.deepEqual([actions.create, actions.manage, actions.grade], [false, false, false])
    }
  })
})
