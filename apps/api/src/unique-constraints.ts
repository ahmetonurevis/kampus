/**
 * Tekillik kısıtlarının (23505) sınıf tablosu: kısıt adı → yeniden denenebilir yarış ya da kural
 * ihlali (OG-279). `mapDatabaseError` (errors.ts) bu tabloya bakar:
 *
 * - `retry`: kurum kilidinin dışından gelen eşzamanlı ilk yazma, kimlik/bağlantı anahtarı,
 *   sıra numarası, idempotency anahtarı, oturum ve kimlik (Better Auth) tabloları. 409 `conflict`
 *   döner; hiçbir kayıt değişmemiştir, aynı istek yeniden denenebilir.
 * - `rule`: iş anlamı taşıyan tekillik. Yazmalar kurum kilidi altında core denetiminden geçer;
 *   ihlal yeniden denemeyle düzelmez. 409 ve core'un aynı durumdaki kodu ve Türkçe iletisi
 *   (DomainError kind `conflict` ile aynı yanıt).
 *
 * Tabloda olmayan kısıt 422 `duplicate_record` olur ve kısıt adıyla `warn` loglanır. Envanter
 * testi (`test/unique-constraints.test.ts`) migration'lardan sonra veritabanındaki bütün tekil
 * indeksleri bu tabloyla karşılaştırır: yeni kısıt eklenince sınıfı buraya yazılır.
 *
 * Onur'un tabloları (kayıt ve finans: tahsilat, makbuz, tarife, burs, öğrenci kimliği, ayrılış,
 * banka hesabı) bugünkü davranışla `retry` kalır (`ONUR_RETRY`); sınıflarını Onur belirler.
 * Depoda kısıt adına göre çevrilen ihlaller (`constraintAs`, `insertNewVersion`) buraya gelmeden
 * `AppError` olur; buradaki karşılıkları aynı kod ve iletiyle yedektir.
 */

export type UniqueConstraintClass =
  | { readonly kind: 'retry'; readonly owner?: 'onur' }
  | { readonly kind: 'rule'; readonly code: string; readonly message: string }

const RETRY = { kind: 'retry' } as const
/** Onur'un alanı: davranış değişmedi (409 `conflict`); kural sınıfına geçiş Onur'un kararıdır. */
const ONUR_RETRY = { kind: 'retry', owner: 'onur' } as const
const rule = (code: string, message: string) => ({ kind: 'rule', code, message }) as const

export const UNIQUE_CONSTRAINTS = {
  // --- Kimlik ve oturum (Better Auth, migration 0000/0001/0029) ---------------------------------
  users_pkey: RETRY,
  users_email_unique: RETRY,
  sessions_pkey: RETRY,
  sessions_token_unique: RETRY,
  accounts_pkey: RETRY,
  verifications_pkey: RETRY,
  invitations_pkey: RETRY,
  institutions_pkey: RETRY,
  institutions_slug_unique: RETRY,
  memberships_pkey: RETRY,
  memberships_institution_id_user_id_key: RETRY,
  memberships_institution_id_id_key: RETRY,
  membership_links_pkey: RETRY,

  // --- Platform çekirdeği -------------------------------------------------------------------
  records_pkey: RETRY,
  idempotency_keys_pkey: RETRY,
  institution_settings_pkey: RETRY,
  audit_log_pkey: RETRY,
  files_pkey: RETRY,
  files_storage_key_key: RETRY,

  // --- Eğitim yılı (DOM-YTK-063…065) --------------------------------------------------------
  academic_years_pkey: rule('academic_year_exists', 'Bu eğitim yılı zaten tanımlı.'),
  academic_years_active_key: rule(
    'academic_year_active_exists',
    'Kurumda etkin bir eğitim yılı zaten var. Sayfayı yenileyip kontrol edin.',
  ),
  academic_terms_pkey: RETRY,
  academic_terms_year_name_key: rule(
    'academic_term_name_exists',
    'Bu yılda aynı adlı bir dönem var.',
  ),

  // --- Velayet (DOM-ILT-070…075) ------------------------------------------------------------
  student_guardians_pkey: RETRY,
  student_guardians_payer_key: rule('guardian_payer_exists', 'Öğrencinin ödeyicisi zaten var.'),
  student_guardians_student_parent_key: rule(
    'guardian_link_exists',
    'Bu veli öğrenciye zaten bağlı.',
  ),
  student_guardians_student_membership_key: rule(
    'guardian_link_exists',
    'Bu veli öğrenciye zaten bağlı.',
  ),

  // --- Koordinatör görevi ---------------------------------------------------------------------
  coordinator_duties_pkey: RETRY,
  coordinator_duties_membership_kind_scope_key: rule(
    'coordinator_duty_exists',
    'Bu görev öğretmene zaten verilmiş.',
  ),

  // --- KVKK aydınlatma ve rıza (DOM-YTK-056…062) --------------------------------------------
  privacy_notices_pkey: RETRY,
  // Metin sürüm numarası en büyük + 1'dir: çakışma eşzamanlı yayımdır.
  privacy_notices_audience_version_key: RETRY,
  privacy_notices_purpose_version_key: RETRY,
  notice_acknowledgements_pkey: RETRY,
  notice_acknowledgements_user_notice_key: rule(
    'notice_already_acknowledged',
    'Bu metni zaten okudunuz.',
  ),
  consents_pkey: RETRY,
  consents_subject_purpose_decision_key: rule(
    'consent_decision_exists',
    'Bu amaç için aynı karar zaten kayıtlı.',
  ),

  // --- Kurlar ve gruplar (dil okulu) ----------------------------------------------------------
  courses_pkey: RETRY,
  courses_name_key: rule('course_name_exists', 'Bu adla tanımlı bir kur var.'),
  courses_e_ozel_program_key: rule(
    'course_program_code_exists',
    'Bu e-Özel program kodu başka kurda.',
  ),
  language_groups_pkey: RETRY,
  language_groups_id_course_key: RETRY,
  language_groups_name_key: rule('group_name_exists', 'Bu adla tanımlı bir grup var.'),
  language_group_members_pkey: RETRY,
  language_group_members_id_group_student_key: RETRY,
  language_group_members_group_student_key: rule(
    'group_member_exists',
    'Kursiyer zaten bu grupta.',
  ),
  language_group_waitlist_pkey: RETRY,
  language_group_waitlist_student_key: rule(
    'waitlist_entry_exists',
    'Kişi bu kurun bekleme listesinde zaten var.',
  ),
  language_group_waitlist_prospect_key: rule(
    'waitlist_entry_exists',
    'Kişi bu kurun bekleme listesinde zaten var.',
  ),

  // --- CEFR seviye tespiti ve kur sonu kararı -------------------------------------------------
  placement_sessions_pkey: RETRY,
  placement_sessions_learner_key: RETRY,
  placement_sessions_in_progress_key: rule(
    'placement_in_progress',
    'Bu kişinin süren bir seviye tespiti var.',
  ),
  level_decisions_pkey: RETRY,
  level_decisions_placement_skill_key: rule('placement_completed', 'Seviye tespiti zaten bitti.'),
  progression_decisions_pkey: RETRY,
  progression_decisions_enrollment_id_key: RETRY,
  progression_decisions_pending_key: rule(
    'progression_pending',
    'Bu kayıt için onay bekleyen bir karar var.',
  ),

  // --- İçerik havuzu --------------------------------------------------------------------------
  resources_pkey: RETRY,
  resource_versions_pkey: RETRY,
  resource_versions_resource_number_key: RETRY,
  resource_versions_editable_key: rule(
    'open_version_exists',
    'Bu içeriğin üzerinde çalışılan bir sürümü zaten var.',
  ),
  resource_version_items_pkey: RETRY,
  resource_version_outcomes_pkey: RETRY,
  resource_version_files_pkey: RETRY,
  resource_shares_pkey: RETRY,

  // --- Beceri görevleri ve rubrik (depoda `constraintAs` ile de çevrilir) -------------------
  rubrics_pkey: RETRY,
  rubric_versions_pkey: RETRY,
  rubric_versions_rubric_number_key: RETRY,
  rubric_versions_draft_key: rule(
    'open_rubric_version_exists',
    'Bu rubriğin açık bir taslağı var; önce onu tamamlayın.',
  ),
  rubric_versions_published_key: rule(
    'published_rubric_version_exists',
    'Bu rubriğin yayındaki bir sürümü zaten var. Sayfayı yenileyip yeniden deneyin.',
  ),
  rubric_scores_pkey: RETRY,
  rubric_scores_version_role_key: rule(
    'rubric_score_exists',
    'Bu teslim sürümü bu rolde zaten puanlandı.',
  ),
  task_assignments_pkey: RETRY,
  task_assignment_targets_pkey: rule(
    'assignment_target_exists',
    'Aynı hedef atamaya yalnız bir kez eklenebilir.',
  ),
  task_attempts_pkey: RETRY,
  task_attempts_id_assignment_learner_key: RETRY,
  task_attempts_assignment_learner_number_key: rule(
    'attempt_in_progress',
    'Süren bir denemeniz var; ona devam edin.',
  ),
  attempt_media_plays_pkey: RETRY,
  attempt_media_plays_attempt_file_number_key: RETRY,
  task_submissions_pkey: RETRY,
  task_submissions_assignment_learner_key: rule(
    'submission_exists',
    'Bu görev için teslim kaydınız zaten var; sayfayı yenileyin.',
  ),
  submission_drafts_pkey: RETRY,
  submission_versions_pkey: RETRY,
  submission_versions_submission_number_key: RETRY,
  resubmission_requests_pkey: rule(
    'resubmission_exists',
    'Bu sürüm için yeniden teslim zaten istendi.',
  ),
  second_rating_requests_pkey: RETRY,
  score_appeals_pkey: RETRY,
  score_appeals_submission_version_key: rule('appeal_exists', 'Bu sonuca zaten itiraz edildi.'),
  score_transfers_pkey: RETRY,
  score_transfers_assignment_learner_key: rule(
    'score_transfer_exists',
    'Bu görevin sonucu not olarak zaten aktarıldı.',
  ),

  // --- Onur: kayıt ve finans (davranış değişmedi) --------------------------------------------
  student_identities_pkey: ONUR_RETRY,
  student_identities_number_key: ONUR_RETRY,
  fee_tariffs_pkey: ONUR_RETRY,
  fee_tariffs_year_version_key: ONUR_RETRY,
  fee_tariffs_draft_key: ONUR_RETRY,
  fee_tariffs_published_key: ONUR_RETRY,
  payments_pkey: ONUR_RETRY,
  payments_reference_key: ONUR_RETRY,
  payments_receipt_key: ONUR_RETRY,
  payment_allocations_pkey: ONUR_RETRY,
  payment_settings_pkey: ONUR_RETRY,
  bank_accounts_pkey: ONUR_RETRY,
  bank_accounts_iban_key: ONUR_RETRY,
  student_withdrawals_pkey: ONUR_RETRY,
  student_withdrawals_contract_key: ONUR_RETRY,
  scholarship_programs_pkey: ONUR_RETRY,
  scholarship_programs_year_name_key: ONUR_RETRY,
  scholarship_awards_pkey: ONUR_RETRY,
  scholarship_awards_student_year_key: ONUR_RETRY,
} as const satisfies Record<string, UniqueConstraintClass>

export type UniqueConstraintName = keyof typeof UNIQUE_CONSTRAINTS

/** Kısıtın sınıfı; tabloda yoksa `undefined` (bilinmeyen tekillik ihlali). */
export function uniqueConstraintClass(
  constraint: string | undefined,
): UniqueConstraintClass | undefined {
  if (constraint === undefined || !Object.hasOwn(UNIQUE_CONSTRAINTS, constraint)) return undefined
  return UNIQUE_CONSTRAINTS[constraint as UniqueConstraintName]
}
