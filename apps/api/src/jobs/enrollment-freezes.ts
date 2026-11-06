import { startDueFreezes, type FreezeStartResult } from '../services/enrollment-freezes.ts'
import { HOUR_SECONDS, type InstitutionJob } from './types.ts'

/**
 * Başlangıç günü gelen onaylı kayıt dondurmaların etkisi (DOM-DIL-052): her gün 00:05 Europe/Istanbul
 * kurum başına çalışır; kural ve yazma `startDueFreezes`'tadır. Etkisi doğan kayıt taramaya girmez,
 * ikinci çalıştırma sonucu değiştirmez.
 */
// TODO(dondurma-is-kaydi): iş `jobs/registry.ts` `INSTITUTION_JOBS` listesine eklenince zamanlanır;
// dosya Oğuzhan'ın alanındadır, o satır gelene kadar ileri tarihli onay kendiliğinden başlamaz.
export const enrollmentFreezesStartJob: InstitutionJob<FreezeStartResult> = {
  name: 'enrollment-freezes.start',
  cron: '5 0 * * *',
  slotSeconds: HOUR_SECONDS,
  run: ({ db, log }, { institutionId }, now) => startDueFreezes({ db, institutionId, now, log }),
}
