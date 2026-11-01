/**
 * Bu dosya apps/api/openapi.json'dan üretilir; elle düzenlemeyin.
 * Üretim: pnpm --filter @kampus/api-client generate
 */

export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sağlık kontrolü
         * @description Sunucunun ve veritabanı bağlantısının durumunu döndürür. Kimlik gerektirmez.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Oturumdaki kullanıcı
         * @description Oturum sahibinin kimliğini, etkin kurumunu, etkin üyeliğini ve bütün üyeliklerini döndürür.
         */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memberships": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kurum üyeleri
         * @description Etkin kurumun üyelerini sayfalı döndürür. Kurum oturumdan gelir; sorguda kurum kimliği kabul edilmez.
         */
        get: operations["listMemberships"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/institution-members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kurum kullanıcıları
         * @description Etkin kurumun üyelerini görünen ad, rol, durum, bağlı kişi ve oluşturulma tarihiyle sayfalı döndürür. E-posta yalnız yöneticiye döner; telefon, parola, oturum ve IP dönmez. Yalnız yönetici (diğer roller 403). Okuma denetim kaydı üretmez.
         */
        get: operations["listInstitutionMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * İşlem geçmişi
         * @description Etkin kurumun denetim kayıtlarını en yeniden eskiye sayfalı döndürür: zaman, işlem, varlık, yapan kişi, değişen alan adları ve gerekçe. Değer, mesaj metni, IP ve kullanıcı ajanı dönmez. Rehberlik kayıtlarında alan adı ve kimlik de dönmez (DOM-YTK-020). Tarih süzgeci Europe/Istanbul günüdür; `createdBefore` sayfalı dışa aktarmayı sabitleyen üst zaman sınırıdır. Yalnız yönetici (diğer roller 403). Okuma denetim kaydı üretmez.
         */
        get: operations["listAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kurum modül ayarları
         * @description Etkin kurumun türünde bulunan modülleri ve açık/kapalı durumlarını ayar sürümüyle döndürür. Yalnız yönetici.
         */
        get: operations["getModuleSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/{moduleKey}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Modülü aç veya kapat
         * @description Etkin kurumun modülünü açar veya kapatır. Kapatma veri silmez ve arşivlemez; kayıtlar (gelecek etüt rezervasyonları dahil) modül yeniden açılınca aynen döner. `If-Match` ve `Idempotency-Key` zorunludur. Kurum türünde olmayan modül 422 `module_unavailable_for_type`; durum değişmiyorsa 409 `module_unchanged`. Yalnız yönetici.
         */
        patch: operations["setModuleEnabled"];
        trace?: never;
    };
    "/api/v1/collections/{collection}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Koleksiyon kayıtları
         * @description Etkin kurumun koleksiyon kayıtlarını rol kapsamıyla, sayfalı döndürür. Kapalı modül 403 `module_disabled`, rolün okuyamadığı koleksiyon 403 `forbidden`, bilinmeyen koleksiyon veya kurum türünde bulunmayan modülün koleksiyonu 404.
         */
        get: operations["listCollection"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/collections/{collection}/counts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Koleksiyon sayımı
         * @description Liste ucuyla aynı kapsam, süzgeç ve aramayla `groupBy` alanına göre grup başına kayıt sayısı; `sum` verilirse grup başına toplam (ör. durum başına taksit sayısı ve tutarı, sınıf başına öğrenci). Kapsam dışı kayıt sayılmaz; rolün göremediği alanla gruplama/toplama 400. Durumlar liste ucuyla aynıdır.
         */
        get: operations["countCollection"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/collections/{collection}/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Koleksiyon kaydı
         * @description Tek kayıt. Yok, arşivde, başka kuruma ait veya aktörün kapsamı dışındaki kayıt 404 (varlığı sızdırılmaz); kapsam ve modül kuralları listeyle aynıdır.
         */
        get: operations["getCollectionRecord"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Genel Bakış özeti
         * @description Etkin rolün Genel Bakış kartları, kısa listeleri ve mini grafik verisi tek yanıtta; yanıt `role` alanıyla ayrılır. Değerler koleksiyon okuma uçlarının (`/collections/:c`, `/collections/:c/counts`) aynı kapsam ve süzgeçleriyle hesaplanır. Okuduğu koleksiyon aktöre kapalı olan bölüm (kapalı modül, kurum türünde olmayan modül, rolün okuyamadığı koleksiyon) `null` döner. Etkin kurum yoksa 403 `no_active_institution`; velide kapsam dışı `studentId` 404.
         */
        get: operations["getDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedef oluştur
         * @description school-core `runWorkflow('goal')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal-review/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedefi onayla veya gerekçeyle reddet
         * @description school-core `runWorkflow('goal-review')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoalReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal-step/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedefe adım ekle
         * @description school-core `runWorkflow('goal-step')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoalStep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal-step-done/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedef adımını tamamla
         * @description school-core `runWorkflow('goal-step-done')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoalStepDone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal-suggest/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedef için adım öner
         * @description school-core `runWorkflow('goal-suggest')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoalSuggest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal-comment/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedefe yorum ekle
         * @description school-core `runWorkflow('goal-comment')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `veli`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoalComment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/goal-close/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hedefi kapat
         * @description school-core `runWorkflow('goal-close')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `goals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGoalClose"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/guidance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rehberlik dosyası aç
         * @description school-core `runWorkflow('guidance')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `guidance`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGuidance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/guidance-note/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rehberlik dosyasına not ekle
         * @description school-core `runWorkflow('guidance-note')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `guidance`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowGuidanceNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/exam": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Deneme sınavı oluştur
         * @description school-core `runWorkflow('exam')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `exams`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowExam"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/exam-result": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Deneme sonucu gir
         * @description school-core `runWorkflow('exam-result')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `exams`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowExamResult"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/exam-import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Deneme sonuçlarını CSV ile içe aktar
         * @description school-core `runWorkflow('exam-import')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `exams`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowExamImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/renewal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kayıt yenileme planla
         * @description school-core `runWorkflow('renewal')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `renewal`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowRenewal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/renewal-activate/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sınıf geçişini uygula
         * @description school-core `runWorkflow('renewal-activate')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `renewal`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowRenewalActivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/lesson": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ders ekle veya güncelle
         * @description school-core `runWorkflow('lesson')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `planning`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowLesson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/lesson/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ders ekle veya güncelle
         * @description school-core `runWorkflow('lesson')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `planning`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowLessonUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/substitute/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Vekil öğretmen ata
         * @description school-core `runWorkflow('substitute')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `planning`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowSubstitute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/lesson-cancel/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dersi iptal et
         * @description school-core `runWorkflow('lesson-cancel')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `planning`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowLessonCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/study-task": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Çalışma görevi ver
         * @description school-core `runWorkflow('study-task')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `study`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowStudyTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/study-complete/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Çalışma görevini tamamla
         * @description school-core `runWorkflow('study-complete')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `ogrenci`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `study`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowStudyComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/study-review/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Çalışma görevini değerlendir
         * @description school-core `runWorkflow('study-review')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `study`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowStudyReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/event": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etkinlik oluştur
         * @description school-core `runWorkflow('event')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `calendar`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/consent/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etkinlik iznine yanıt ver
         * @description school-core `runWorkflow('consent')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `veli`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `calendar`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowConsent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/event-cancel/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etkinliği iptal et
         * @description school-core `runWorkflow('event-cancel')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `calendar`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowEventCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/route": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Servis güzergâhı ekle veya güncelle
         * @description school-core `runWorkflow('route')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `transport`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowRoute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/route/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Servis güzergâhı ekle veya güncelle
         * @description school-core `runWorkflow('route')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `transport`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowRouteUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/route-archive/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Servis güzergâhını arşivle
         * @description school-core `runWorkflow('route-archive')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `transport`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowRouteArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/transport-assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğrenciyi servise ata
         * @description school-core `runWorkflow('transport-assign')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `transport`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowTransportAssign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/transport-remove/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Servis atamasını kaldır
         * @description school-core `runWorkflow('transport-remove')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `transport`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowTransportRemove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/meal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yemek menüsü ekle veya güncelle
         * @description school-core `runWorkflow('meal')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `meals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowMeal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/meal/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yemek menüsü ekle veya güncelle
         * @description school-core `runWorkflow('meal')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `onburo`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `meals`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowMealUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/club": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kulüp oluştur
         * @description school-core `runWorkflow('club')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `clubs`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowClub"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/club-enroll/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğrenciyi kulübe kaydet
         * @description school-core `runWorkflow('club-enroll')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`, `veli`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `clubs`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowClubEnroll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/club-leave/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kulüp üyeliğini sonlandır
         * @description school-core `runWorkflow('club-leave')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`, `ogrenci`, `veli`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `clubs`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowClubLeave"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/club-attendance/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kulüp yoklaması al
         * @description school-core `runWorkflow('club-attendance')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `clubs`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowClubAttendance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/achievement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sosyal başarı ekle
         * @description school-core `runWorkflow('achievement')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `clubs`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowAchievement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflows/club-archive/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kulübü arşivle
         * @description school-core `runWorkflow('club-archive')`. Gövde core `workflowSchemas` şemasıdır. Core'un izin verdiği roller: `yonetici`, `ogretmen`; kayıt kapsamı core `scopeFor` ile üyelik bağlantılarından hesaplanır. Modül: `clubs`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runWorkflowClubArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invoices/{invoiceId}/pay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Taksiti öde
         * @description Taksiti ödenmiş işaretler (core `payInvoice`); yetki core `authorize('invoice.pay')` (DOM-FIN-052). `Idempotency-Key` zorunludur; ödenmiş taksit 409 `invoice_already_paid`. Roller: `yonetici`, `onburo`.
         */
        post: operations["payInvoice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/classes/{classId}/attendance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sınıf yoklaması al
         * @description Sınıfın günlük yoklamasını yazar (core `recordAttendance`); aynı öğrenci ve gün için kayıt yinelenmez, güncellenir. Yetki core `authorize('attendance.record')`: `ogretmen` yalnız ders verdiği sınıfta ve aynı gün (başka sınıf 403 `attendance_class_forbidden`, geçmiş gün 403 `attendance_correction_admin_only`); `yonetici` yalnız `reason` ile (yoksa 422 `correction_reason_required`). `If-Match` sınıf kaydının sürümüdür; tutmazsa 409 `version_conflict`. Roller: `yonetici`, `ogretmen`.
         */
        post: operations["recordClassAttendance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/grades": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resmî not gir
         * @description Resmî not kaydı ekler (core `recordGrade`, DOM-AKD-004); dönem ortalaması saklanmaz. Yetki core `authorize('grade.record')`: yalnız öğrencinin sınıfında o dersin atanmış öğretmeni (başka ders veya sınıf 403 `grade_assignment_forbidden`). Dil okulunda 422 `official_grades_school_only`; aynı gün aynı türde ikinci not 409 `grade_duplicate`; gelecek tarih 422. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `ogretmen`.
         */
        post: operations["recordGrade"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/grades/{gradeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Notu gerekçeyle düzelt
         * @description Not puanını gerekçeyle düzeltir; eski puan `corrections` geçmişinde kalır (core `updateGrade`, DOM-AKD-051). Yetki core `authorize('grade.update')`: atanmış ders öğretmeni veya `reason` ile yönetici; görülemeyen not 404. Aynı puan 409 `grade_unchanged`, quizden aktarılan not 422. `If-Match` notun sürümüdür; tutmazsa 409 `version_conflict`. Denetim kaydına değer değil alan adı yazılır. Roller: `yonetici`, `ogretmen`.
         */
        patch: operations["updateGrade"];
        trace?: never;
    };
    "/api/v1/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kampüs oluştur
         * @description Kampüs kaydı oluşturur; yetki core `authorize('branch.save')`. Aktif kampüs adı kurumda tekildir (409 `branch_name_taken`). `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `yonetici`.
         */
        post: operations["createBranch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/branches/{branchId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Kampüs arşivle
         * @description Kampüs kaydını arşivler (core `archiveRecord`); bağlı kayıtlar `replacementId`'ye aktarılır, geçmiş finans/not/yoklama korunur. Yetki core `authorize('record.archive')`; roller: `yonetici`.
         */
        delete: operations["archiveBranch"];
        options?: never;
        head?: never;
        /**
         * Kampüs düzenle
         * @description Kampüs kaydını kısmi gövdeyle düzenler: gönderilmeyen alan güncel değerinde kalır, sonuç kayıt şemasıyla bütün olarak doğrulanır. Yetki core `authorize('branch.save')`. Aktif kampüs adı kurumda tekildir (409 `branch_name_taken`). Arşivli, olmayan veya başka kurumun kaydı 404. `If-Match` zorunludur (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Denetim kaydına değer değil alan adı yazılır. Roller: `yonetici`.
         */
        patch: operations["updateBranch"];
        trace?: never;
    };
    "/api/v1/branches/{branchId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kampüs arşivden geri al
         * @description Kampüs kaydını arşivden geri alır (core `restoreRecord`); aktarılan görevler otomatik geri taşınmaz. Yetki core `authorize('record.restore')`; roller: `yonetici`.
         */
        post: operations["restoreBranch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/classes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sınıf oluştur
         * @description Sınıf kaydı oluşturur; yetki core `authorize('class.save')`. Gövde sınıf bilgisi ve `subjectTeachers` (ders → branş öğretmeni) taşır; düzeyin her dersi için dersin branşında aktif öğretmen gerekir (422 `subject_teacher_required`), danışman ve kampüs aktif olmalıdır (422 `advisor_required`, `campus_required`). Kampüste aynı sınıf adı veya derslik 409 (`class_name_taken`, `classroom_in_use`). Düzenlemede kontenjan mevcut öğrenciden az olamaz (422 `capacity_below_students`), öğrencili sınıfın düzeyi değişmez (422 `class_level_locked`), gelecek derslerde yeni öğretmenin veya dersliğin çakışması 409 (`teacher_schedule_conflict`, `tutor_schedule_conflict`), derslikte gelecek etüt 422 `classroom_has_future_tutoring`. `subjectTeachers` düzenlemede ders bazında mevcut atamalarla birleşir; aynı dersin ataması kimliğini korur. Gelecek dersler, açık soru/ödev, çözülmemiş quiz (deneme kaydı yok) ve çalışma görevleri yeni ders öğretmenine geçer; notlanmış ödev, cevaplanmış soru ve çözülmüş quiz eski öğretmende kalır. Gönderilmeyen dersin mevcut öğretmeni pasifse 422 `subject_teacher_required` (ders adı ve öğretmenin pasifliği mesajda). `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `yonetici`.
         */
        post: operations["createClass"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/classes/{classId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Sınıf arşivle
         * @description Sınıf kaydını arşivler (core `archiveRecord`); bağlı kayıtlar `replacementId`'ye aktarılır, geçmiş finans/not/yoklama korunur. Yetki core `authorize('record.archive')`; roller: `yonetici`.
         */
        delete: operations["archiveClass"];
        options?: never;
        head?: never;
        /**
         * Sınıf düzenle
         * @description Sınıf kaydını kısmi gövdeyle düzenler: gönderilmeyen alan güncel değerinde kalır, sonuç kayıt şemasıyla bütün olarak doğrulanır. Yetki core `authorize('class.save')`. Gövde sınıf bilgisi ve `subjectTeachers` (ders → branş öğretmeni) taşır; düzeyin her dersi için dersin branşında aktif öğretmen gerekir (422 `subject_teacher_required`), danışman ve kampüs aktif olmalıdır (422 `advisor_required`, `campus_required`). Kampüste aynı sınıf adı veya derslik 409 (`class_name_taken`, `classroom_in_use`). Düzenlemede kontenjan mevcut öğrenciden az olamaz (422 `capacity_below_students`), öğrencili sınıfın düzeyi değişmez (422 `class_level_locked`), gelecek derslerde yeni öğretmenin veya dersliğin çakışması 409 (`teacher_schedule_conflict`, `tutor_schedule_conflict`), derslikte gelecek etüt 422 `classroom_has_future_tutoring`. `subjectTeachers` düzenlemede ders bazında mevcut atamalarla birleşir; aynı dersin ataması kimliğini korur. Gelecek dersler, açık soru/ödev, çözülmemiş quiz (deneme kaydı yok) ve çalışma görevleri yeni ders öğretmenine geçer; notlanmış ödev, cevaplanmış soru ve çözülmüş quiz eski öğretmende kalır. Gönderilmeyen dersin mevcut öğretmeni pasifse 422 `subject_teacher_required` (ders adı ve öğretmenin pasifliği mesajda). Arşivli, olmayan veya başka kurumun kaydı 404. `If-Match` zorunludur (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Denetim kaydına değer değil alan adı yazılır. Roller: `yonetici`.
         */
        patch: operations["updateClass"];
        trace?: never;
    };
    "/api/v1/classes/{classId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sınıf arşivden geri al
         * @description Sınıf kaydını arşivden geri alır (core `restoreRecord`); aktarılan görevler otomatik geri taşınmaz. Yetki core `authorize('record.restore')`; roller: `yonetici`.
         */
        post: operations["restoreClass"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/teachers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğretmen oluştur
         * @description Öğretmen kaydı oluşturur; yetki core `authorize('teacher.save')`. Yalnız core `teachers` kaydını yazar; hesap ve üyelik kurum üyeleri ucundadır. Aktif öğretmen e-postası tekildir (409 `teacher_email_taken`); kampüs aktif (422 `campus_required`), branş müfredatta olmalıdır (422 `subject_invalid`). Ders ataması olan öğretmenin branşı değişmez (422 `teacher_has_assignments`); ileri tarihli etüdü olan öğretmenin kampüs/branşı değişmez (422 `teacher_has_future_tutoring`). Rehberlik görevi bu uçtan verilmez. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `yonetici`.
         */
        post: operations["createTeacher"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/teachers/{teacherId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Öğretmen arşivle
         * @description Öğretmen kaydını arşivler (core `archiveRecord`); bağlı kayıtlar `replacementId`'ye aktarılır, geçmiş finans/not/yoklama korunur. Yetki core `authorize('record.archive')`; roller: `yonetici`.
         */
        delete: operations["archiveTeacher"];
        options?: never;
        head?: never;
        /**
         * Öğretmen düzenle
         * @description Öğretmen kaydını kısmi gövdeyle düzenler: gönderilmeyen alan güncel değerinde kalır, sonuç kayıt şemasıyla bütün olarak doğrulanır. Yetki core `authorize('teacher.save')`. Yalnız core `teachers` kaydını yazar; hesap ve üyelik kurum üyeleri ucundadır. Aktif öğretmen e-postası tekildir (409 `teacher_email_taken`); kampüs aktif (422 `campus_required`), branş müfredatta olmalıdır (422 `subject_invalid`). Ders ataması olan öğretmenin branşı değişmez (422 `teacher_has_assignments`); ileri tarihli etüdü olan öğretmenin kampüs/branşı değişmez (422 `teacher_has_future_tutoring`). Rehberlik görevi bu uçtan verilmez. Arşivli, olmayan veya başka kurumun kaydı 404. `If-Match` zorunludur (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Denetim kaydına değer değil alan adı yazılır. Roller: `yonetici`.
         */
        patch: operations["updateTeacher"];
        trace?: never;
    };
    "/api/v1/teachers/{teacherId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğretmen arşivden geri al
         * @description Öğretmen kaydını arşivden geri alır (core `restoreRecord`); aktarılan görevler otomatik geri taşınmaz. Yetki core `authorize('record.restore')`; roller: `yonetici`.
         */
        post: operations["restoreTeacher"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tutor-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüt planını onayla
         * @description Deneme sonuçlarından etüt planını güncel veriyle yeniden hesaplar ve etütleri oluşturur (core `runAssessment('plan')`). `expectedPlan` önizlemedeki plandır; plan değiştiyse 409 `tutoring_plan_stale`.
         */
        post: operations["createTutorSessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tutor-sessions/{sessionId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüdü iptal et
         * @description Etüdü gerekçeyle iptal eder (core `runAssessment('cancel')`); iptal geçmişi korunur. Tamamlanmış etüt 422, iptal edilmiş etüt 409.
         */
        post: operations["cancelTutorSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tutor-sessions/{sessionId}/attendance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüt yoklaması al
         * @description Etüdün yoklamasını alır ve etüdü tamamlar (core `runAssessment('attendance')`). Gelecek etüt 422.
         */
        post: operations["recordTutorAttendance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Optik profil ve cevap anahtarı oluştur veya güncelle
         * @description school-core `runAssessment('profile')`. Gövde core `automationSchemas` şemasıdır. Modül: `optical`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/profile/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Optik profil ve cevap anahtarı oluştur veya güncelle
         * @description school-core `runAssessment('profile')`. Gövde core `automationSchemas` şemasıdır. Modül: `optical`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentProfileUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Okuyucu dosyasını değerlendir ve sonuçları kaydet
         * @description school-core `runAssessment('evaluate')`. Gövde core `automationSchemas` şemasıdır. Modül: `optical`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentEvaluate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüt planını onayla
         * @description school-core `runAssessment('plan')`. Gövde core `automationSchemas` şemasıdır. Modül: `tutoring`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/slot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğretmen uygunluk saati ekle
         * @description school-core `runAssessment('slot')`. Gövde core `automationSchemas` şemasıdır. Modül: `tutoring`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentSlot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/slot-remove/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğretmen uygunluk saatini kaldır
         * @description school-core `runAssessment('slot-remove')`. Gövde core `automationSchemas` şemasıdır. Modül: `tutoring`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentSlotRemove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/cancel/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüdü gerekçeyle iptal et
         * @description school-core `runAssessment('cancel')`. Gövde core `automationSchemas` şemasıdır. Modül: `tutoring`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/attendance/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüt yoklaması al
         * @description school-core `runAssessment('attendance')`. Gövde core `automationSchemas` şemasıdır. Modül: `tutoring`; kurum türünde olmayan modül 404, kapalı modül 403 `module_disabled`. Yazma yalnız `yonetici` ve `ogretmen` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 `permission_denied`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.
         */
        post: operations["runAssessmentAttendance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/plan/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Etüt planını önizle
         * @description Etüt planını güncel veriyle hesaplar (core `planTutoring`) ve **hiçbir şey yazmaz** (salt okunur transaction, kurum kilidi yok; kayıt, sürüm ve denetim kaydı değişmez). Yanıt: önerilen etütler (`sessions`, kapasite ile), yerleşemeyen gruplar ve nedenleri (`unresolved`: öğretmen, derslik, uygunluk, kapasite ve çakışma uyarıları), zaten karşılanan kazanımlar (`covered`) ve onayda geri gönderilecek `expectedPlan`. Onay (`POST /assessment/plan`) planı yeniden hesaplar; fark varsa 409 `tutoring_plan_stale`. Roller core `runAssessment` ile aynıdır: `yonetici`, `ogretmen`.
         */
        post: operations["previewAssessmentPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assessment/evaluate/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Okuyucu dosyasını önizle
         * @description Okuyucu dosyasını (CSV/DAT/TXT, en çok 1 MB; aşarsa 413) profile göre değerlendirir (core `previewOptical`) ve **hiçbir şey yazmaz**. Yanıt öğrenci/ders başına doğru, yanlış, boş, çoklu, iptal, net, zayıf kazanımlar ve üzerine yazılacak sonuç işaretidir (soru bazında ayrıntı yok) ile onayda `expectedDigest` olarak gönderilecek `digest`. Dosya hatası 422 ve `issues`: yol `["text","line",<satır>]`, satır dosya satırıdır (başlık 1).
         */
        post: operations["previewAssessmentEvaluation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duyuru yayınla
         * @description Duyuru yayınlar; hedef kitle (kampüs, düzey, CEFR seviyesi, sınıf × rol) yayın anında alıcı listesine çözülür (core `publishAnnouncement`, DOM-ILT-001). Yetki core `authorize('announcement.publish')` (DOM-ILT-002): öğretmen yalnız ders verdiği/rehberi olduğu sınıflara, ön büro yalnız `İdari` kategoride kurum veya kampüs kapsamında (403 `announcement_scope_denied`). Alıcısı olmayan hedef 422 `announcement_no_recipients`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `yonetici`, `onburo`, `ogretmen`.
         */
        post: operations["publishAnnouncement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{announcementId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Duyuruyu düzelt
         * @description Duyurunun başlık, metin veya kategorisini düzeltir; önceki içerik `revisions` geçmişinde kalır, alıcı "Güncellendi" işaretini görür (core `reviseAnnouncement`, DOM-ILT-004). Hedef kitle değişmez. Duyuruyu görmeye yetkisi olmayan olmayan kayıtla aynı 404'ü alır; görüp yayınlayan olmayan 403 `announcement_publisher_only` alır (yalnız yayınlayan veya yönetici, ön büroda yayınlayan kişi); değişiklik yoksa 409 `announcement_unchanged`, geri çekilmişse 409 `announcement_withdrawn`. `If-Match` duyurunun sürümüdür; tutmazsa 409 `version_conflict`. Roller: `yonetici`, `onburo`, `ogretmen`.
         */
        patch: operations["reviseAnnouncement"];
        trace?: never;
    };
    "/api/v1/announcements/{announcementId}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duyuruyu geri çek
         * @description Duyuruyu silmeden geri çeker (core `withdrawAnnouncement`, DOM-ILT-004): alıcılar duyuruyu "Geri çekildi" işaretiyle (`withdrawnAt`) görmeye devam eder, metni ve gerekçeyi yalnız yayınlayan ve yönetici görür. Gerekçe zorunludur. Yalnız yayınlayan veya yönetici (görmeye yetkisi olmayana 404, görüp yayınlayan olmayana 403); ikinci geri çekme 409 `announcement_withdrawn`. Roller: `yonetici`, `onburo`, `ogretmen`.
         */
        post: operations["withdrawAnnouncement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/announcements/{announcementId}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duyuruyu okundu işaretle
         * @description Alıcının ilk açılış anını bir kez yazar (core `markAnnouncementRead`, DOM-ILT-003); tekrar çağrı kaydı değiştirmez. Alıcı olmayan ama duyuruyu gören (yönetici, yayınlayan) için etkisizdir. Görülemeyen duyuru 404, geri çekilmiş duyuru 409 `announcement_withdrawn`. Roller: `yonetici`, `onburo`, `ogretmen`, `ogrenci`, `veli`.
         */
        post: operations["readAnnouncement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Yazışmalar
         * @description Oturum sahibinin tarafı olduğu yazışmalar, son etkinliğe göre azalan; satırda son mesaj, okunmamış sayısı ve öğretmende yanıt bekleme durumu (DOM-ILT-010, -013, -024). Yönetici taraf değildir: yalnız `studentId` ile ve yalnız üst veriyi (son mesaj yok) görür; içeriği `POST /conversations/{id}/access` ile gerekçe vererek açar (DOM-YTK-052).
         */
        get: operations["listConversations"];
        put?: never;
        /**
         * Yazışma başlat
         * @description Öğrenci + öğretmen + hedef kitle + veli hesabı için tek yazışma açar; varsa yenisi açılmaz, `text` var olan yazışmaya eklenir (core `startConversation`, DOM-ILT-010, -011). Yeni yazışma 201, var olan 200. Öğretmen `studentId` + `audience` verir; veli yazışmasında öğrencinin tek veli hesabı kendiliğinden seçilir, birden çoksa `parentUserId` zorunludur (422 `parent_choice_required`; hesaplar `GET /students/{id}/parent-accounts`). Öğrenci ve veli `studentId` + `teacherId` verir. İlişki yoksa 403 `conversation_party_forbidden`. `text` varsa istek bir mesaj sayılır ve mesaj gönderme ile aynı kotayı kullanır (kullanıcı ve kurum başına dakikada 30, aşılırsa 429); metinsiz başlatma saymaz. `Idempotency-Key` zorunludur. Roller: `ogretmen`, `ogrenci`, `veli`.
         */
        post: operations["startConversation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversationId}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Yazışmanın mesajları
         * @description Mesajlar en yeniden geriye imleçli sayfalanır (core `messagePage`); sayfa içinde sıra eskiden yeniyedir, `meta.nextCursor` daha eski sayfayı verir. Mesajlar değişmez ve silinmez, imleç kararlıdır; geçersiz imleç 400. Taraf olmayana 404. Yönetici yalnız öğrenci–öğretmen yazışmasını ve yalnız son 30 dakikada açtığı gerekçeli erişimle okur, aksi halde 404; okuması okundu üretmez (DOM-YTK-052).
         */
        get: operations["listConversationMessages"];
        put?: never;
        /**
         * Mesaj gönder
         * @description Yazışmaya mesaj ekler; mesaj sonradan değiştirilemez ve silinemez (core `sendMessage`, DOM-ILT-012). Taraf olmayana 404; öğretmenin öğrenciyle ders ilişkisi bittiyse yazışmayı okur ama gönderemez (403 `conversation_relationship_ended`). En fazla 2000 karakter. `Idempotency-Key` zorunludur: aynı anahtarla tekrar tek mesaj üretir. Kullanıcı ve kurum başına dakikada 30 mesaj (`POST /conversations` gövdesindeki `text` ile aynı kota), aşılırsa 429 ve `Retry-After`. Başarı 201. Roller: `ogretmen`, `ogrenci`, `veli`.
         */
        post: operations["sendConversationMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversationId}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yazışmayı okundu işaretle
         * @description Karşı tarafın okunmamış mesajlarına ilk görme anını yazar (core `markMessagesRead`, DOM-ILT-024). Taraf olmayana 404. Roller: `ogretmen`, `ogrenci`, `veli`.
         */
        post: operations["readConversation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversationId}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yazışmayı gerekçeyle aç
         * @description Yöneticinin şikâyet veya soruşturma gerekçesiyle yazışmayı açması (core `openConversationAccess`, DOM-YTK-052, DOM-ILT-011). Yalnız öğrenci–öğretmen yazışmasında geçerlidir: veli tarafı yazışma gerekçeyle de açılmaz (403 `conversation_access_student_only`). Gerekçe en az 10 karakter, yoksa 422 `access_reason_required`. Erişim gerekçesiyle `audit_log`'a (`conversation.access`) yazılır ve 30 dakika geçerlidir; bu sürede `GET /conversations/{id}/messages` açıktır. Yazışma yoksa 404. Roller: `yonetici`.
         */
        post: operations["openConversationAccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/students/{studentId}/parent-accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Öğrencinin veli hesapları
         * @description Öğrenciye bağlı platform veli hesapları (kullanıcı kimliği ve ad); öğretmenin veli yazışması başlatırken `parentUserId` seçimi için (DOM-ILT-010). Yalnız veliyle yazışma başlatabilen öğretmen okur (yönetici, ön büro, öğrenci ve veli 403); kapsam `POST /conversations` ile birebir aynıdır: ders verdiği, sınıf rehberi olduğu öğrenci ya da rehberlik görevlisi olarak her öğrenci. Kapsam dışı, var olmayan veya başka kurumun öğrencisi 404.
         */
        get: operations["listStudentParentAccounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Talep, şikayet veya öneri aç
         * @description Veli bağlı çocuğu için talep açar; talep `Yeni` durumunda `Ön büro`'ya düşer (core `openRequest`, DOM-ILT-080). Başka velinin çocuğu veya kurumda olmayan öğrenci 403 `student_scope_denied` (DOM-YTK-025), pasif öğrenci 422 `student_inactive`. Modül `communication`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `veli`.
         */
        post: operations["openRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/requests/{requestId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Talebi güncelle ve yanıtla
         * @description Talebin durumunu (`Yeni`, `İnceleniyor`, `Çözüldü`) ve ilgili birimini değiştirir; `reply` verilirse yanıtı `replies` listesine ekler, önceki yanıtlar değişmez ve veli yanıtları talepte görür (core `updateRequest`, DOM-ILT-080). Yanıt süresi saklanmaz (core `requestResponse`, DOM-ILT-013). Değişiklik yoksa 409 `request_unchanged`, çözülmüş talep yeniden incelemeye alınmadan 409 `request_resolved`, ele alınmış talep `Yeni`'ye dönerse 422 `request_status_invalid`; olmayan veya başka kurumun talebi 404. `If-Match` zorunludur (talebin sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Roller: `yonetici`, `onburo`.
         */
        patch: operations["updateRequest"];
        trace?: never;
    };
    "/api/v1/absences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * İzin veya mazeret bildir
         * @description Veli bağlı çocuğu için ileri tarihli izin veya geçmiş tarihli mazeret bildirir (core `notifyAbsence`, DOM-ILT-053). Geçmiş tarih devamsızlığın bitiminden itibaren ortaokulda 3, lisede 5 iş günü içinde kabul edilir, aksi 422 `absence_notice_late`. Aynı öğrencinin örtüşen bildirimi 409 `absence_overlap`; belge eki (`files`) henüz 422 `absence_files_unsupported`; başka velinin çocuğu 403 `student_scope_denied`, pasif öğrenci 422 `student_inactive`. Gerekçe yalnız kategoridir (`reasonCategory`: `health`, `family`, `official`, `other`); serbest açıklama (`reason`) ve bilinmeyen alan 400 `validation_failed`, sağlık ayrıntısı alınmaz (KVKK md. 6, en az veri). Bildirim yoklamayı değiştirmez ve talep kaydı açmaz; ön büro bildirimleri göremez. Modül `academic`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `veli`.
         */
        post: operations["notifyAbsence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/appointments/slots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Randevu alınabilecek saatleri listele
         * @description Öğrenci kendisi, veli seçili çocuğu (`studentId`) için öğrencinin sınıfına ders veren etkin öğretmenlerin gelecekteki uygunluk saatlerini okur (core `bookableSlots`, DOM-ILT-105). Aralık `from`–`to` (ISO 8601); verilmezse şimdiden itibaren 14 gün, `to` yalnız `from` ile verilir, en çok 28 gün (aşan, ters veya `from`suz aralık 400). Saat başına yalnız `slotId`, öğretmen ve adı, başlangıç, süre, varsa kampüs ve ders adları ile `available` döner; saatin iç notu, saati tutan randevu ve kişisi dönmez. `available: false` saatin talepte çakışma alacağını söyler (bekleyen/onaylı randevu ya da öğrencinin dersi, etüdü, randevusu, okul etkinliği; DOM-ILT-101) ve nedeni hiçbir durumda bildirilmez (DOM-ILT-073). Başka velinin çocuğu, kapsam dışı veya olmayan öğrenci olmayan kayıtla aynı 404 `not_found`; pasif öğrenci 422 `student_inactive`. Hiçbir şey yazılmaz. Modül `communication`. Roller: `ogrenci`, `veli`.
         */
        get: operations["listBookableSlots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/appointments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğretmenden randevu talep et
         * @description Veli bağlı çocuğu, öğrenci kendisi için öğretmenin bir uygunluk saatini (`slotId`) seçerek randevu talep eder; başlangıç ve süre o saatten alınır, talep `Bekliyor` durumunda açılır (core `bookAppointment`, DOM-ILT-100, DOM-ILT-101). Başka velinin çocuğu veya kurumda olmayan öğrenci 403 `student_scope_denied` (DOM-YTK-025), pasif öğrenci 422 `student_inactive`. Olmayan saat, başka öğretmenin, öğrencinin sınıfına ders vermeyen veya pasif öğretmenin saati aynı 422 `appointment_slot_unavailable`; geçmiş saat 422 `appointment_in_past`; role uymayan tür 422 `appointment_type_invalid`. Ders, etüt, etkinlik veya bekleyen/onaylı randevuyla çakışma 409 `appointment_conflict`; aynı saate eşzamanlı iki talepten yalnız biri yazılır. Görüşme notu loglanmaz. Modül `communication`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `ogrenci`, `veli`.
         */
        post: operations["bookAppointment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/appointments/{appointmentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Randevuyu onayla, reddet, iptal et veya geri çek
         * @description Randevunun durumunu değiştirir; her geçiş yapan kişi, an ve gerekçesiyle kaydın `history` listesine eklenir, kayıt silinmez (core `updateAppointment`, DOM-ILT-102). `Bekliyor` talebi yalnız ilgili öğretmen onaylar veya gerekçeyle reddeder (403 `appointment_teacher_only`); talep eden onaydan önce geri çeker (403 `appointment_requester_only`); onaylı ve başlamamış randevuyu öğretmen veya talep eden gerekçeyle iptal eder (403 `appointment_cancel_forbidden`). Red ve iptalde gerekçe yoksa 400 `validation_failed` (`reason`). Onayda saat geçmişse 422 `appointment_in_past`, çakışma 409 `appointment_conflict`; sonuçlanmış randevu 409 `appointment_closed`, yanlış geçiş 422 `appointment_transition_invalid`. Olmayan, başka kurumun veya aktörün göremediği randevu 404; görünürlük sürümden önce denetlenir (DOM-ILT-103). `If-Match` zorunludur (randevunun sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Gerekçe loglanmaz. Roller: `ogretmen`, `ogrenci`, `veli`.
         */
        patch: operations["updateAppointment"];
        trace?: never;
    };
    "/api/v1/prospects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Aday ekle
         * @description Ön büro yeni aday açar; aday `Yeni aday` aşamasında başlar, akademik veya finansal kayıt üretmez (core `createProspect`, DOM-KAY-001, DOM-KAY-009). Gövde katıdır: ad, telefon, isteğe bağlı e-posta, kampüs, ilgi, kaynak, aydınlatma metni sürümü, kanal bazında ticari ileti onayı; T.C. kimlik no, doğum tarihi, adres ve bilinmeyen alan 400 `validation_failed`. 18 yaş altı adayda veli adı zorunlu (422 `prospect_guardian_required`); dil okulunda yaş seçimi zorunlu (422 `prospect_age_required`). Pasif kampüs 422 `branch_unavailable`, olmayan referans öğrencisi 422 `referrer_not_found`. Aynı telefon veya e-posta ve aynı adla açık aday 409 `prospect_duplicate`, iletişimi paylaşan farklı adlı aday kardeş seçilmeden 409 `prospect_contact_shared` (DOM-KAY-002, DOM-KAY-031); ret eşleşen adayın kimliğini ve iletişim bilgisini taşımaz. Tekillik kurumun bütün adaylarına kurum kilidi altında bakar; aynı adayı eşzamanlı iki istekten yalnız biri açar. Telefon, e-posta ve veli adı loglanmaz. Modül `crm`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `yonetici`, `onburo`.
         */
        post: operations["createProspect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prospects/{prospectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Adayın aşamasını değiştir
         * @description Açık aşamalar arasında yalnız ileri gidilir, aşama atlanabilir (core `changeProspectStage`, DOM-KAY-005, DOM-KAY-030). Geri dönüş 422 `prospect_stage_backward`; `Görüşme planlandı` yalnız planlamayla (422 `prospect_meeting_required`), `Kayıt oldu` yalnız kesin kayıtla girilir (422 `prospect_enroll_required`). `Vazgeçti` nedenle girilir (422 `prospect_lost_reason_required`) ve ileri tarihli görüşmeyi ve deneme dersini kaldırır. Vazgeçen aday yalnız `İletişime geçildi` ile yeniden açılır ve tekillik denetiminden geçer (409 `prospect_duplicate`, `prospect_contact_shared`); iletişimi paylaşan açık aday varsa `siblingOfId` ile kardeş seçilir (DOM-KAY-031, 422 `sibling_not_found`). Aynı aşama 409 `prospect_stage_unchanged`, kayıtlı aday 409 `prospect_enrolled`. `If-Match` zorunludur (adayın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Olmayan veya başka kurumun adayı sürüm ne olursa olsun 404. Roller: `yonetici`, `onburo`.
         */
        patch: operations["changeProspectStage"];
        trace?: never;
    };
    "/api/v1/prospects/{prospectId}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Aday kartına not ekle
         * @description Aday kartına not eklenir; not değiştirilmez ve silinmez (core `addProspectNote`, DOM-KAY-032). Notu yazan kişi ve an saklanır; gösterilen yazar adı oturum kullanıcısından alınır, gövdede `authorName` ve bilinmeyen alan 400 `validation_failed`. Kayıtlı veya vazgeçmiş adaya not 409 `prospect_closed`; aday başına en çok 200 not (409 `prospect_note_limit`). Not metni loglanmaz. `If-Match` zorunludur (adayın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Olmayan veya başka kurumun adayı sürüm ne olursa olsun 404. Başarı 201 ve `Location` (aday kaydı). Roller: `yonetici`, `onburo`.
         */
        post: operations["addProspectNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prospects/{prospectId}/meetings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Tanışma görüşmesi planla
         * @description Adayın kampüsünde, gelecek bir anda, 15–120 dakikalık görüşme planlar; yeniden planlama öncekinin yerini alır (core `scheduleProspectMeeting`, DOM-KAY-006, DOM-KAY-033). Geçmiş an 422 `meeting_in_past`, başka kampüsün veya pasif öğretmen 422 `meeting_teacher_unavailable`. Aynı kampüste aynı oda veya öğretmen için örtüşen görüşme, öğretmenin dersi/randevusu/etüdü ve odanın kullanımı 409 `meeting_conflict`; adayın kendi deneme dersiyle örtüşme 409 `prospect_schedule_conflict`. Çakışma kurumun bütün adaylarına kurum kilidi altında bakar. `Yeni aday` ve `İletişime geçildi` aday `Görüşme planlandı` olur. Kapalı aday 409 `prospect_closed`. `If-Match` zorunludur (adayın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Olmayan veya başka kurumun adayı sürüm ne olursa olsun 404. Roller: `yonetici`, `onburo`.
         */
        post: operations["scheduleProspectMeeting"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prospects/{prospectId}/trial-lessons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Deneme dersi planla
         * @description Yalnız dil okulunda: aday kendi kampüsündeki açık grubun gelecek, iptal edilmemiş dersine deneme katılımcısı olarak yazılır (core `scheduleTrialLesson`, DOM-DIL-030, DOM-KAY-034). Okul kurumunda uç her rol için 404'tür. Gerçekleşmiş deneme 409 `trial_already_used`; olmayan ders 404; iptal edilmiş ders 422 `lesson_cancelled`, geçmiş ders 422 `trial_in_past`, başka kampüsün veya kapalı grubun dersi 422 `trial_group_unavailable`. Derse en çok iki deneme katılımcısı (409 `trial_lesson_full`), kursiyer + deneme grup kapasitesini ve 18'i aşamaz (409 `trial_capacity_full`). 18 yaş altı adayda veli adı/iletişimi (422 `trial_guardian_contact_required`) ve `guardianConsent: true` (422 `trial_guardian_consent_required`) zorunlu. Adayın görüşmesiyle örtüşme 409 `prospect_schedule_conflict`. `If-Match` zorunludur (adayın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Olmayan veya başka kurumun adayı sürüm ne olursa olsun 404. Roller: `yonetici`, `onburo`.
         */
        post: operations["scheduleTrialLesson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prospects/{prospectId}/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Adayı kesin kayda al
         * @description Açık aşamadaki adayı kesin kayda alır: öğrenci, veli, taksit planı ve sözleşme oluşturulur, aday `Kayıt oldu` olur; hepsi tek işlemde yazılır, hata olursa hiçbir kayıt değişmez (core `enrollProspect`, DOM-KAY-001, DOM-KAY-011, DOM-KAY-035). Yetki core `prospect.enroll` işlemden önce ayrıca denetlenir. Gövde: `classId`, `totalCents` (eğitim bedeli, kuruş, tamsayı, 10.000–100.000.000; core'a olduğu gibi geçer), `count` (1–12 taksit), `startDate` (ilk vade, `YYYY-MM-DD`); isteğe bağlı `allowOtherCampus`, `parentId`, `nationalId`, `birthDate`, `guardianRelation`, `payer`. Sayısal alanlar metin olarak gelirse, aday kimliği gövdede olursa veya bilinmeyen alan varsa 400 `validation_failed`; geçersiz kimlik numarası (11 hane ve denetim haneleri) 400. 18 yaş altında (`school` her zaman; `language_school`'da adayın seçimi) adayın telefonu, e-postası ve veli adı veliye yazılır, öğrenciye yazılmaz (DOM-KAY-003). Kardeş kaydında yeni veli açılmaz: `parentId` ile seçilen veli ya da kardeş adayın kayıtlı öğrencisinin velisi kullanılır (DOM-KAY-013); olmayan veya başka kurumun velisi 404. Yetişkin kursiyer için açılan iletişimsiz veli kaydı gerçek veli sayılmaz: kardeşte atlanır (yeni veli açılır), `parentId` ile seçilirse 422 `parent_not_guardian`. Mevcut velinin eksik telefonu ve e-postası adayınkiyle tamamlanır; var olan değer ve ad değişmez. Sınıf adayın kampüsünden değilse 422 `class_campus_mismatch` (`issues` yolu `classId`); `allowOtherCampus: true` bilinçli seçimdir. DOM-KAY-012: doğum tarihi gelecekte 422 `invalid_birth_date`, dil okulunda adayın 18 yaş seçimiyle uyuşmazsa 422 `birth_date_minor_mismatch`; 18 yaş altında ödeyici veli (422 `payer_must_be_guardian`), yetişkin kursiyerde kendisi (422 `payer_must_be_student`), yetişkinde veli alanı 422 `guardian_not_applicable`. Sözleşme başlığı kurum türüne göredir (dil okulunda `Dil kursu eğitim sözleşmesi`). Olmayan veya başka kurumun aday ya da sınıfı 404; dolu sınıf 422 `class_capacity_full`, geçersiz ilk vade 422 `invalid_payment_date`. Kayıtlı aday 409 `prospect_already_enrolled`, vazgeçmiş veya tanınmayan aşamadaki aday 409 `prospect_closed` (önce `İletişime geçildi` ile yeniden açılır). İşlem kurum kilidi altındadır; aynı adayı eşzamanlı kayda alan iki istekten yalnız biri yazılır, öteki 409 alır. Aday telefonu, e-postası, veli adı, kimlik numarası ve doğum tarihi loglanmaz; denetim kaydına yalnız alan adları ve kimlikler yazılır. Modüller `crm` ve `finance` (taksit ve sözleşme yazılır); biri kapalıysa 403 `module_disabled`. `Idempotency-Key` zorunludur (mükerrer öğrenci ve taksit üretilmez). `If-Match` zorunludur (adayın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Olmayan veya başka kurumun adayı sürüm ne olursa olsun 404. Başarı 201; `entity` yeni öğrencidir, `Location` öğrenci kaydını gösterir ve `contractId` oluşturulan sözleşmedir. Roller: `yonetici`, `onburo`.
         */
        post: operations["enrollProspect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/questions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Öğretmene soru gönder
         * @description Öğrenci kendi sınıfının o dersine atanmış öğretmene soru gönderir; öğretmen ders atamasından çözülür (core `askQuestion`, DOM-ILT-090). Öğrenci oturumdan gelir, gövdede `studentId` ve bilinmeyen alan 400 `validation_failed`; başlık 2–120, metin 10–2000 karakter. Kapsam dışı ders veya öğretmen 403 `question_scope_denied` (varlık sızdırılmaz), bağlantısız öğrenci 403 `student_scope_denied`; pasif öğrenci 422 `student_inactive`, öğretmeni pasif ders 422 `question_teacher_unavailable`, ortak derste öğretmen seçilmezse 422 `question_teacher_required`, dersin listesinde olmayan kazanım 422 `question_topic_unknown`, dosya 422 `question_files_unsupported`. Modül `learning`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `ogrenci`.
         */
        post: operations["askQuestion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/questions/{questionId}/answers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Soruyu yanıtla
         * @description Sorunun atandığı öğretmen yanıt yazar (core `answerQuestion`, DOM-ILT-092). İlk yanıt `answer`, `answeredAt`, `answeredBy` alanlarına, sonrakiler ek yanıt olarak `followUps` listesine eklenir; verilmiş yanıt değişmez. Ek yanıtı yalnız sınıfın o dersine hâlâ atanmış öğretmen yazar; dersten alınan öğretmen 403 `question_teacher_reassigned`. Yanıt süresi saklanmaz (DOM-ILT-013). Başka öğretmenin sorusu ve olmayan soru 404; geri çekilmiş soru 409 `question_withdrawn`; en çok 10 yanıt, aşılırsa 422 `question_answer_limit`. `If-Match` zorunludur (sorunun sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Başarı 201 ve `Location` (soru kaydı). Roller: `ogretmen`.
         */
        post: operations["answerQuestion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/questions/{questionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Soruyu geri çek
         * @description Öğrenci yanıtlanmamış sorusunu geri çeker (core `withdrawQuestion`, DOM-ILT-091). Tek izinli değişiklik `{ "withdrawn": true }`'dur; başlık, metin, ders veya kazanım gönderilirse 400 `validation_failed` (gönderilen soru değişmez). Kayıt silinmez, `withdrawnAt` yazılır. Yanıtlanmış soru 409 `question_answered`, ikinci geri çekme 409 `question_withdrawn`; başkasının sorusu ve olmayan soru 404. `If-Match` zorunludur: eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Roller: `ogrenci`.
         */
        patch: operations["withdrawQuestion"];
        trace?: never;
    };
    "/api/v1/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * İçerik havuzu
         * @description Kişinin görebildiği kaynaklar, sayfalı (DOM-KYN-030, 040, 041). Personel satırı kaynağın okunabilir baş sürümüdür (arşivli olmayan, en yüksek numara) ve `view: 'staff'` taşır; öğrenci ve veli yalnız paylaşım kapsamındaki, düzey/seviyesine uyan, lisansı geçerli güncel yayın sürümünü `view: 'learner'` olarak görür (cevap anahtarı ve lisans ayrıntısı yok). Baş sürümü arşivli veya kaldırılmış kaynak varsayılan olarak listede ve aramada yoktur; yalnız `status=archived` / `status=removed` ile gelir (DOM-KYN-051). Normalleşince terim kalmayan `q` (ör. `!!!`) boş sonuç döner. Süzgeçler baş sürüme uygulanır; bilinmeyen parametre 400. Roller: `yonetici`, `ogretmen`, `ogrenci`, `veli`; ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        get: operations["listResources"];
        put?: never;
        /**
         * Kaynak oluştur
         * @description Yeni kaynak ve ilk taslak sürüm (DOM-KYN-001): sahip ve yazar işlemi yapan kişi, kapsam `private`. Gövde core `resourceVersionInputSchema` (taslak eksik kaydedilebilir; yayım koşulları onaya gönderirken denetlenir). Quiz/alıştırma sorusu kurumda yoksa veya okunamıyorsa 422 `quiz_item_missing`; dosyalı içerik henüz 422 `resource_files_unsupported`. Başarı 201 ve `Location`. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["createResource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kaynak ayrıntısı
         * @description Personel: kaynak, paylaşım hedefleri, okunabilir sürümler, baş sürümün tamamı (içerik, cevap anahtarı, lisans) ve açık sürümde yayım eksikleri. Öğrenci/veli: güncel yayın sürümünün öğrenci görünümü (seçenekler kişiye sabit karıştırılır, cevap anahtarı yok, dinleme dökümü gizli; DOM-KYN-003, 024). Okunabilir sürümü olmayan veya başka kurumun kaynağı 404. Roller: `yonetici`, `ogretmen`, `ogrenci`, `veli`; ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        get: operations["getResource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Kaynak sürümü
         * @description Tek sürüm. Personel okuyabildiği her sürümü (arşivli dahil; DOM-KYN-032) tam görür; öğrenci/veli yalnız güncel yayın sürümünü öğrenci görünümüyle. Diğer durumlarda 404. Roller: `yonetici`, `ogretmen`, `ogrenci`, `veli`; ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        get: operations["getResourceVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Taslağı düzenle
         * @description Taslak veya reddedilmiş sürümün alanlarını değiştirir (DOM-KYN-030, 032); verilmeyen alan aynen kalır, `tags` bütün olarak değişir. Yalnız yazar (403). Yayımlanmış, incelemedeki veya arşivli sürüm 409 `version_immutable`; içerik türü değişmez (422 `content_type_immutable`). Kopyada miras lisans ve kaynak gösterimi değişmez (422 `license_inherited`, `attribution_inherited`; DOM-KYN-050). Reddedilen sürüm taslağa döner. `If-Match` zorunlu: sürümün `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        patch: operations["updateResourceDraft"];
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yeni sürüm aç
         * @description Yayındaki (yoksa son) sürümün içeriğinden yeni taslak sürüm açar (DOM-KYN-032); numara bir artar. Sahip, zümre başkanı veya yönetici (403). Açık sürüm varken 409 `open_version_exists`, kaldırılmış kaynakta 409 `resource_removed`. Arşivlenmiş kaynak yeniden açılır. Başarı 201. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["createResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Onaya gönder
         * @description Taslağı onaya gönderir (DOM-KYN-030); yalnız yazar. Yayım koşulları eksikse 422 (ilk eksiğin kodu, ör. `subject_required`). İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["submitResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Yayımla
         * @description Onaysız yayın (DOM-KYN-031): yalnız `Kurum özgün` ve kapsamı yazarın kendi öğrencileri/sınıfları olan taslak; diğerleri 403 `review_required`. Önceki yayın sürümü arşivlenir. İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["publishResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Onaydan geri çek
         * @description İncelemedeki sürümü taslağa döndürür; yalnız yazar. Önceden yayımlanmış sürüm 409 `version_immutable`. İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["withdrawResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Onayla
         * @description İncelemedeki sürümü yayımlar (DOM-KYN-031); yazar ve sahip onaylayamaz (403). Önceki yayın sürümü aynı işlemde arşivlenir. Telif bildirimi incelenen içeriği yalnız yönetici yeniden yayına alır. İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["approveResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Reddet
         * @description İncelemedeki sürümü gerekçeyle reddeder (`reason` zorunlu, yoksa 422 `reason_required`). İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["rejectResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Taslağa döndür
         * @description Reddedilen sürümü taslağa döndürür; yalnız yazar. İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["reopenResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Arşivle
         * @description Taslak, reddedilmiş veya yayındaki sürümü arşivler (DOM-KYN-042, 051); sahip, zümre başkanı veya yönetici. Kaynağın bütün sürümleri arşivlenince kaynak da arşivlenir ve listeden düşer. İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["archiveResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/versions/{versionId}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sürüm: Telif bildirimi
         * @description Telif bildirimi (DOM-KYN-025): yayındaki sürüm `İncelemede`ye alınır, öğrenci ve veliden düşer. `reason` zorunlu. Gerekçe saklanmaz (`TODO(content-report-log)`). İzinsiz geçiş 409 `resource_transition_invalid`. `If-Match` isteğe bağlı: sürümün `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["reportResourceVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kaynağı kaldır
         * @description Telif ihlali veya kişisel veri nedeniyle kaynağı kaldırır (DOM-KYN-025, 051): bütün sürümlerin içeriği ve cevap anahtarı silinir; başlık, menşe, gerekçe ve tarih kalır; kaynak arşivlenir. Yalnız yönetici (öğretmen 403); `reason` zorunlu (422 `reason_required`); ikinci kez 409 `resource_removed`. Yanıt bu sürümlerden türetilmiş kopyaları ve soruyu içeren quiz sürümlerini listeler. `If-Match` isteğe bağlı: kaynağın `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["removeResource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Paylaşımı değiştir
         * @description Paylaşım kapsamı ve hedefleri (DOM-KYN-021, 031, 040): `private`, `students` (`studentIds`), `classes` (`classIds`), `department`, `institution`. Sahip, zümre başkanı veya yönetici (403). Öğretmen yalnız ders verdiği sınıf ve öğrencilerle paylaşır (403 `share_target_out_of_scope`); kurumda olmayan kimlik 422 `share_target_not_found`. Kitap sahibiyle sınırlı lisans sınıf/kurum kapsamına açılmaz (422 `license_restricts_share`); onaysız yayın zümre/kuruma açılırken 409 `share_scope_review_required`. `If-Match` isteğe bağlı: kaynağın `rowVersion`'ı. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["shareResource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resourceId}/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kaynağı kopyala
         * @description Yayındaki güncel sürümü yeni kaynağa kopyalar (DOM-KYN-050): sahibi kopyalayan, kapsam `private`, durum `Taslak`; `derivedFromVersionId`, lisans ve kaynak gösterimleri miras alınır ve sonraki taslaklarda değiştirilemez. Yayında sürüm yoksa 409 `copy_source_not_published`; uyarlamaya izin vermeyen lisans 403 `license_forbids_copy`; süresi dolan lisans 409 `license_expired`. Başarı 201 ve `Location`. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.
         */
        post: operations["copyResource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rubrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Rubrik kütüphanesi
         * @description Kurumun rubrikleri, sayfalı (IST-048): rubrik kurumundur, bütün içerik personeli görür ve yayındaki sürümü görevlerde kullanır. Satır en yüksek numaralı sürümü (`head`) ve yayındaki sürümün kimliğini taşır. Süzgeçler baş sürüme uygulanır; son güncellenen önce. Bilinmeyen parametre 400. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        get: operations["listRubrics"];
        put?: never;
        /**
         * Rubrik oluştur
         * @description Yeni rubrik ve ilk taslak sürüm (DOM-BEC-020, 022): sahibi oluşturan kişi. Gövde core `rubricVersionInputSchema`: analitik rubrikte becerinin en az iki niteliksel yönü, bütüncülde tek `overall` kriteri; her kriterde 0–5 altı bant, kurum cümlesi ve tanımlayıcı. Dil okulunda bant kazanıma bağlanamaz (422 `rubric_alignment_invalid`). Başarı 201 ve `Location`. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        post: operations["createRubric"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rubrics/{rubricId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Rubrik ayrıntısı
         * @description Rubrik ve bütün sürümleri (arşivli dahil; DOM-BEC-022): kriterler, bantlar, tanımlayıcı eşlemesi ve sürüm başına kullanım (atama ve puan sayısı). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        get: operations["getRubric"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rubric-versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Rubrik sürümü
         * @description Tek rubrik sürümü kimliğiyle (DOM-BEC-022): atamanın `rubricVersionId`'si rubrik aranmadan okunur. Kriterler, bantlar, tanımlayıcı eşlemesi ve kullanım. Rubrik sonradan arşivlense de sürüm okunur. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404. Olmayan veya başka kurumun sürümü 404.
         */
        get: operations["getRubricVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rubrics/{rubricId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yeni rubrik sürümü aç
         * @description Gövdedeki içerikle yeni taslak sürüm açar (DOM-BEC-022); numara bir artar, yayındaki sürüm ve eski puanlar değişmez. Açık taslak varken 409 `open_rubric_version_exists`. Başarı 201. Yalnız rubriğin sahibi ve yönetici (core `canManageRubric`; diğer öğretmen 403). Sıra: kapsam (404) → yetki (403) → sürüm (409). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        post: operations["createRubricVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rubrics/{rubricId}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Rubrik taslağını düzenle
         * @description Taslak sürümün alanlarını değiştirir (DOM-BEC-020, 022); verilmeyen alan aynen kalır, `criteria` bütün olarak değişir ve birleşmiş içerik core şemasıyla yeniden doğrulanır (400). Yayımlanmış, arşivli veya kullanılmış (atamaya ya da puana bağlı) sürüm 409 `rubric_version_immutable`. `If-Match` zorunlu: sürümün `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Yalnız rubriğin sahibi ve yönetici (core `canManageRubric`; diğer öğretmen 403). Sıra: kapsam (404) → yetki (403) → sürüm (409). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        patch: operations["updateRubricDraft"];
        trace?: never;
    };
    "/api/v1/rubrics/{rubricId}/versions/{versionId}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rubrik sürümünü yayımla
         * @description Taslağı yayımlar (DOM-BEC-022): rubriğin önceki yayındaki sürümü aynı işlemde arşivlenir; o sürümle verilmiş puanlar onunla hesaplanmaya, sabitlendiği atamalar onunla puanlanmaya devam eder. Taslak olmayan sürüm 409 `rubric_version_immutable`; eşzamanlı ikinci yayım 409. `If-Match` zorunlu: sürümün `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Yalnız rubriğin sahibi ve yönetici (core `canManageRubric`; diğer öğretmen 403). Sıra: kapsam (404) → yetki (403) → sürüm (409). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        post: operations["publishRubricVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rubrics/{rubricId}/versions/{versionId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rubrik sürümünü arşivle
         * @description Yayındaki sürümü arşivler (DOM-BEC-022): yeni görevde kullanılamaz, sabitlendiği atamalarda puanlanmaya devam eder; kullanılmış sürüm silinmez, yalnız arşivlenir. Arşiv geri alınmaz; yeni sürüm açılır. Yayında olmayan sürüm 409 `rubric_version_not_published`. `If-Match` zorunlu: sürümün `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Yalnız rubriğin sahibi ve yönetici (core `canManageRubric`; diğer öğretmen 403). Sıra: kapsam (404) → yetki (403) → sürüm (409). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.
         */
        post: operations["archiveRubricVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Görev atamaları
         * @description Arşivlenmemiş atamalar, en yeni önce, sayfalı (IST-034). Süzgeçler: içerik (`resourceId`; aynı içeriğin farklı son tarihli ayrı atamaları) ve görev türü. Bilinmeyen parametre 400. Roller: `yonetici` kurumun bütün atamaları; `ogretmen` kendi atamaları, kapsamındaki (ders verdiği veya sınıf rehber öğretmeni olduğu) sınıfı/grubu hedefleyenler ve o sınıfların güncel öğrencilerine hedeflenenler (DOM-YTK-028; atayan değilse `targets` yalnız kendi kapsamındaki hedefleri içerir); `ogrenci` kendisine hedeflenenler, `veli` çocuklarına hedeflenenler; ön büro 403. Öğrenci ve veli `learner` görünümünü alır: hedef listesi, puanlama ve rubrik sürümü, ikinci puanlama oranı ve atayan yoktur; cevap anahtarı hiçbir görünümde yoktur. Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun ataması 404.
         */
        get: operations["listTaskAssignments"];
        put?: never;
        /**
         * Görev ata
         * @description İçeriğin güncel yayındaki sürümünü, ayarları ve (varsa) yayındaki rubrik sürümünü atamaya sabitler (ADR 0004 karar 4; DOM-KYN-032, DOM-BEC-041, 042); `scoringVersionId` başta içerik sürümüdür. Hedefler sınıf/şube (okul), dil grubu (dil okulu) veya öğrencidir; öğretmen yalnız ders verdiği sınıfa ve içeriğin dersine atar, yönetici kurumda atar. Aynı içerik farklı son tarihle ayrı atamadır (IST-034); açık atamadaki kursiyere ikinci kez 409 `assignment_duplicate`/`assignment_overlap`. Sıra: atayanın göremediği veya olmayan içerik 404 → lisansı dolmuş içerik 409 `resource_license_expired` → kapsam dışı hedef 403 `target_scope_denied` (olmayan hedef veya rubrik sürümü 404 `not_found`, mesaj ve `issues` yoluyla) → yayında olmayan veya güncel olmayan sürüm 409 `resource_version_not_assignable`, taslak veya arşivli rubrik sürümü 409 `rubric_version_not_assignable`. Geçici sınırlar: dosyalı ve sesli teslim 422 `submission_kind_unavailable`, dinleme hakkı sayımı açılana kadar gönderilmeyen hak sınırsız (`null`) saklanır, 1 veya 2 seçilirse 422 `listening_plays_unavailable`. Sınıf/şube hedefli atama o sınıfın güncel öğrencilerine görünür. `Idempotency-Key` zorunludur (sınıfa toplu dağıtım). Başarı 201 ve `Location`. Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["createTaskAssignment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-assignments/{assignmentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Görev ataması ayrıntısı
         * @description Atamanın sabitlenmiş içerik sürümü ve ayarları (DOM-KYN-032, DOM-BEC-041, 042). Roller: `yonetici` kurumun bütün atamaları; `ogretmen` kendi atamaları, kapsamındaki (ders verdiği veya sınıf rehber öğretmeni olduğu) sınıfı/grubu hedefleyenler ve o sınıfların güncel öğrencilerine hedeflenenler (DOM-YTK-028; atayan değilse `targets` yalnız kendi kapsamındaki hedefleri içerir); `ogrenci` kendisine hedeflenenler, `veli` çocuklarına hedeflenenler; ön büro 403. Öğrenci ve veli `learner` görünümünü alır: hedef listesi, puanlama ve rubrik sürümü, ikinci puanlama oranı ve atayan yoktur; cevap anahtarı hiçbir görünümde yoktur. Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun ataması 404.
         */
        get: operations["getTaskAssignment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Görev atamasını değiştir
         * @description Yalnız son teslim ve geç kabul süresi uzatılır (core `planAssignmentChange`; DOM-BEC-041, 042, 044): kısaltma 422 `deadline_shortened`; otomatik puanlı değerlendirmenin cevap anahtarı açıldıysa (teslim kapandı) uzatma 409 `answer_key_released` (DOM-BEC-045); ikinci puanlama başladıysa (örneklem veya elle istek) süre değişikliği 409 `second_rating_started` (DOM-BEC-024); içerik, puanlama ve rubrik sürümü, görev türü, deneme hakkı ve diğer ayarlar 409 `assignment_setting_frozen`. Değiştiren yalnız atayan veya yöneticidir (DOM-YTK-028). Sıra: kapsam dışı atama 404 → görünür ama atayan olmayan öğretmen 403 `forbidden` → sürüm. `If-Match` zorunlu: atamanın `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        patch: operations["updateTaskAssignment"];
        trace?: never;
    };
    "/api/v1/task-attempts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Görev denemeleri
         * @description Atamanın arşivlenmemiş denemeleri, kursiyer ve deneme numarası sırasıyla, sayfalı (DOM-BEC-042). `assignmentId` zorunlu; `learnerId` süzgeci okuma kapsamıyla kesişir. Bilinmeyen parametre 400. Roller: `yonetici` kurumun bütün denemeleri; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün denemeleri, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının denemelerini (sınıf değiştirse de eski sınıfta yaptığı denemeyi ve puanı görür); ön büro 403. Kursiyer ve veli süren denemede sonuç görmez, tamamlanınca yalnız toplam puanı, cevap anahtarı açılınca (alıştırmada deneme bitince, değerlendirmede teslim kapanınca) madde sonuçlarını ve anahtarı görür (DOM-BEC-045); personel tamamlanan denemenin madde sonuçlarını görür, anahtar ona da açılınca döner. Puan saklanmaz, her okumada cevaplardan hesaplanır (DOM-BEC-010). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.
         */
        get: operations["listTaskAttempts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-attempts/{attemptId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Görev denemesi ayrıntısı
         * @description Deneme, durumu, süresi, cevapları, sonucu ve soruları (anahtar ve açıklama yok). Roller: `yonetici` kurumun bütün denemeleri; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün denemeleri, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının denemelerini (sınıf değiştirse de eski sınıfta yaptığı denemeyi ve puanı görür); ön büro 403. Kursiyer ve veli süren denemede sonuç görmez, tamamlanınca yalnız toplam puanı, cevap anahtarı açılınca (alıştırmada deneme bitince, değerlendirmede teslim kapanınca) madde sonuçlarını ve anahtarı görür (DOM-BEC-045); personel tamamlanan denemenin madde sonuçlarını görür, anahtar ona da açılınca döner. Puan saklanmaz, her okumada cevaplardan hesaplanır (DOM-BEC-010). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.
         */
        get: operations["getTaskAttempt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Deneme cevaplarını kaydet
         * @description Süren denemeye cevap kaydı (DOM-BEC-043; core `planAnswerSave`): yalnız gönderilen sorular güncellenir. Süre dolduysa 422 `attempt_time_over`, teslim edilmiş deneme 409 `attempt_already_submitted`, soruyla uyuşmayan cevap 422 `answer_invalid`. `If-Match` zorunlu: denemenin `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`). Otomatik kayıt denetim kaydına yazılmaz. Roller: yalnız `ogrenci` (kendi denemesi; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm 409 → kural. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        patch: operations["saveTaskAttemptAnswers"];
        trace?: never;
    };
    "/api/v1/task-assignments/{assignmentId}/attempts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Görev denemesi başlat
         * @description Atamanın şu an hedeflediği öğrenci için yeni deneme (DOM-BEC-042, 043, 044; core `planAttemptStart`). Başlangıç sunucu saatidir; süre başlangıç + süre sınırıdır ve teslim kapanışını aşmaz. Değerlendirmede başlatılan her deneme hakkı tüketir: hak dolunca 422 `attempt_limit_reached`; süren deneme varken 409 `attempt_in_progress` (eşzamanlı ikinci başlatma da); teslim kapandıysa 422 `submission_closed`; otomatik puanlanmayan görev 422 `not_auto_scored`; içeriğin (puanlama sürümü veya bir sorusu) lisansı dolduysa 409 `resource_license_expired` (DOM-KYN-021; süren deneme kaydedilir ve teslim edilir). Gövde `{}`. `Idempotency-Key` zorunlu; `If-Match` desteklenmez (400 `if_match_not_supported`). Başarı 201 ve `Location`. Roller: yalnız `ogrenci` (kendi denemesi; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm 409 → kural. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["startTaskAttempt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-attempts/{attemptId}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Denemeyi teslim et
         * @description Denemeyi teslim eder (DOM-BEC-010, 043; core `planAttemptSubmit`). Puan sunucuda cevaplardan hesaplanır; gövdede puan veya bilinmeyen alan 400. Süre dolduysa gönderilen cevaplar alınmaz, deneme kaydedilmiş cevaplarla bitiş anında teslim edilir (`autoSubmitted`). Son teslimden sonra geç kabul süresinde teslim `late` işaretlenir. İkinci teslim 409 `attempt_already_submitted`. `If-Match` zorunlu (denemenin `rowVersion`'ı); `Idempotency-Key` zorunlu. Roller: yalnız `ogrenci` (kendi denemesi; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm 409 → kural. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["submitTaskAttempt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Görev teslimleri
         * @description Atamanın arşivlenmemiş teslim kayıtları (kursiyer başına bir), kursiyer sırasıyla, sayfalı; her kayıtta son sürümün özeti (metin yok). `assignmentId` zorunlu; `learnerId` süzgeci okuma kapsamıyla kesişir. Bilinmeyen parametre 400. Roller: `yonetici` kurumun bütün teslimlerini; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün teslimlerini, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının teslimini (sınıf değiştirse de eski sınıfta yaptığı teslimi görür); ön büro 403. Taslak teslim okumasında hiç dönmez. Yazma otomatik puanlanmaz (DOM-BEC-023); puan öğretmenin rubrik puanıdır, her okumada kriter bantlarından hesaplanır. Kursiyer ve veli puanı ve geri bildirimi yalnız puan kesinleşip geri bildirim açılınca görür (DOM-BEC-045); öncesinde `score: null`, puanlanmamış sürümle aynı. Kesinleşmemiş puanı yalnız personel görür (öğretmen kendi puanını, yönetici hepsini). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.
         */
        get: operations["listTaskSubmissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/grading-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Puanlanmayı bekleyen teslimler
         * @description Öğretmenin puanlama kuyruğu: kişinin gördüğü arşivsiz, rubrikli atamalarda son sürümü ilk puanı veya istenmiş ikinci puanı (DOM-BEC-024) almamış teslimler ile iki puanı uyuşmayıp koordinatörü bekleyen teslimler, en eski gönderim önce, sayfalı; kişinin bir rolde puanladığı bekleyen sürüm listede yoktur (aynı kişi iki rolde puanlamaz), uyuşmazlıklı sürüm puanlayıcılara da görünür. Her kayıtta son sürümün özeti (metin yok) ve `grading`: bekleyen roller (`awaiting`; ikinci puan bekleyenler ayrı görünür), uyuşmazlık (`awaitingResolution`; yalnız iki puan da verilince), örneklem bekleniyor mu, puanlama süresi (`dueAt`: son teslim + 7 gün, core `gradingDueAt`; örneklemli görevde örneklem anından, örneklemden önce `null`) ve gecikme (`overdue`; DOM-BEC-025). Süzgeçler: `assignmentId`, `awaiting=first|second` (uyuşmazlıklı satırları dışarıda bırakır), `overdue=true|false`; bilinmeyen parametre 400. Roller: `yonetici` kurumun bütün, `ogretmen` gördüğü atamaların (DOM-YTK-028) teslimleri; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        get: operations["listGradingQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Görev teslimi ayrıntısı
         * @description Teslim kaydı, değişmez sürümleri (eskiden yeniye, metinleriyle), her sürümün geç bayrağı ve sözcük sayısı (DOM-BEC-044, 046), teslim durumu ve yeni sürüm hakkı. Roller: `yonetici` kurumun bütün teslimlerini; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün teslimlerini, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının teslimini (sınıf değiştirse de eski sınıfta yaptığı teslimi görür); ön büro 403. Taslak teslim okumasında hiç dönmez. Yazma otomatik puanlanmaz (DOM-BEC-023); puan öğretmenin rubrik puanıdır, her okumada kriter bantlarından hesaplanır. Kursiyer ve veli puanı ve geri bildirimi yalnız puan kesinleşip geri bildirim açılınca görür (DOM-BEC-045); öncesinde `score: null`, puanlanmamış sürümle aynı. Kesinleşmemiş puanı yalnız personel görür (öğretmen kendi puanını, yönetici hepsini). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.
         */
        get: operations["getTaskSubmission"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-assignments/{assignmentId}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Yazma taslağı
         * @description Öğrencinin kendi taslağı (IST-047); yoksa `data: null`. Taslağı yalnız öğrenci görür (ADR 0004 karar 6); öğretmen, yönetici, veli ve ön büro 403. Atama öğrenciyi artık hedeflemiyorsa taslak varken okunur, yoksa 404. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        get: operations["getTaskDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Yazma taslağını kaydet
         * @description Taslağın otomatik kaydı (IST-047; core `planDraftSave`); kursiyer × atama başına tek taslak üzerine yazılır. `If-Match` taslağın `revision`'ıdır: yalnız henüz taslak yokken atlanabilir (ilk kayıt); taslak varken başlıksız istek 400 `if_match_required`, eski revizyon 409 `draft_conflict` (başka pencere; eşzamanlı iki kayıttan biri). Teslim kapandıysa 422 `submission_closed`, yazma dışı görevde 422 `draft_not_supported`. Otomatik kayıt denetim kaydına yazılmaz. Roller: yalnız `ogrenci` (kendi taslağı ve teslimi, atama onu şu an hedefliyorsa; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm → kural. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        patch: operations["saveTaskDraft"];
        trace?: never;
    };
    "/api/v1/task-assignments/{assignmentId}/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yazma görevini teslim et
         * @description Yeni teslim sürümü (DOM-BEC-040, 044, 046; IST-051; core `planSubmissionVersion`). İlk gönderim kursiyerin tek teslim kaydını açar, sonrakiler değişmez sürüm ekler; önceki sürümler ve metinleri değişmez. Sürüm sınırı (`maxVersions`) dolunca 422 `version_limit_reached`; puanlanmış teslimde öğretmen yeniden teslim istemeden 409 `resubmission_not_requested` (geri bildirim açılmadan genel 409 `submission_locked`; DOM-BEC-045); teslim kapandıysa (geç kabul dahil) 422 `submission_closed`; son teslimden sonra geç kabul süresindeki sürüm `late`. Sözcük sınırı dışındaki metin uyarıyla kabul edilir. Otomatik puanlı görev 422 `submission_not_expected`; dosyalı ve sesli teslim 422 `submission_kind_unavailable`. Yazma otomatik puanlanmaz. `Idempotency-Key` zorunlu; `If-Match` desteklenmez (400 `if_match_not_supported`). Başarı 201 ve teslim kaydının `Location`'ı. Roller: yalnız `ogrenci` (kendi taslağı ve teslimi, atama onu şu an hedefliyorsa; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm → kural. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["submitTaskSubmission"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}/scores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Teslimi rubrikle puanla
         * @description Öğretmen yazma teslimi sürümünü rubrikle puanlar ve geri bildirim yazar (DOM-BEC-020…023; core `planRubricScore`). Rubrik atamanın sabitlediği sürümdür (DOM-BEC-022), gövdede seçilmez; rubriksiz görev 422 `rubric_not_assigned`. Her kritere bir bant (0–5) verilir: eksik kriter 422 `rubric_criterion_missing`, rubrikte olmayan veya tekrar eden kriter 422 `rubric_criterion_invalid`, hedefin altındaki (0–2) bantta kriter yorumu yoksa 422 `criterion_comment_required`. Toplam ve yüzde sunucuda hesaplanır, saklanmaz; gövdedeki toplam/yüzde/rol 400. Yalnız son sürüm puanlanır (409 `version_not_latest`; bilinmeyen sürüm 404); aynı sürümün ikinci puanı 409 `rubric_score_exists` (puan değişmez; yeniden puanlama ve ikinci puanlayıcı ayrı iştir). Puan kesinleşince geri bildirim kursiyere ve veliye açılır (DOM-BEC-045). Roller: `yonetici` ve atamayı gören `ogretmen` (atayan olmasa da kapsamındaki sınıf/öğrenci hedefi yüzünden gören; DOM-YTK-028); öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. `Idempotency-Key` zorunlu. Başarı 201, teslimin güncel ayrıntısı ve teslim kaydının `Location`'ı. Geri bildirim metni ve öğrenci kimliği loglanmaz; denetime yalnız alan adları. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["scoreTaskSubmission"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}/resubmission-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Yeniden teslim iste
         * @description Öğretmen puanlanan son sürüm için kursiyerden yeni sürüm ister (DOM-BEC-040; core `planResubmissionRequest`). Son tarih ileri ve en çok 14 gün sonradır (422 `resubmission_due_invalid`), geç kabul yoktur. Son olmayan sürüm 409 `version_not_latest`, puanı kesinleşmemiş sürüm 409 `resubmission_not_graded`, aynı sürüme ikinci istek 409 `resubmission_exists`. Kursiyer sonra yeni sürüm gönderebilir; bu sürüm hakka sayılmaz. Roller: `yonetici` ve atamayı gören `ogretmen` (atayan olmasa da kapsamındaki sınıf/öğrenci hedefi yüzünden gören; DOM-YTK-028); öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. `Idempotency-Key` zorunlu. Başarı 201, teslimin güncel ayrıntısı ve teslim kaydının `Location`'ı. Geri bildirim metni ve öğrenci kimliği loglanmaz; denetime yalnız alan adları. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["requestTaskResubmission"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}/second-scores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * İkinci puanı ver
         * @description İkinci puanlayıcı son sürümü ilk puanı görmeden rubrikle puanlar (DOM-BEC-024; core `planRubricScore`, `scoresVisibleToRater`). Gövde ilk puanınkiyle aynıdır. Sürüm ikinci puanlama isteğinin (örneklem veya elle) kapsamında değilse 409 `second_rating_not_requested`; ilk puanı veren kişi 409 `rater_not_independent`; aynı sürümün ikinci ikinci puanı 409 `rubric_score_exists`. Herhangi bir kriterde iki puan arasında birden fazla bant fark varsa sonuç uyuşmazlıktır: son puan koordinatörle gelecek (F4b3b2b), o zamana kadar sonuç kursiyere ve veliye kapalıdır. Uyuşmazlık yoksa ilk puan geçerlidir ve geri bildirim açılır (DOM-BEC-045). Roller: `yonetici` ve atamayı gören `ogretmen` (atayan olmasa da kapsamındaki sınıf/öğrenci hedefi yüzünden gören; DOM-YTK-028); öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. `Idempotency-Key` zorunlu. Başarı 201, teslimin güncel ayrıntısı ve teslim kaydının `Location`'ı. Geri bildirim metni ve öğrenci kimliği loglanmaz; denetime yalnız alan adları. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["secondScoreTaskSubmission"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}/second-rating-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * İkinci puanlama iste
         * @description Öğretmen veya yönetici son teslim sürümü için ikinci puanlama ister (DOM-BEC-024: diğer görevlerde isteğe bağlı). İstek, kursiyer yeni sürüm gönderemezken yapılır: sıradaki sürümün teslim penceresi (geç kabul dahil) kapandı ya da sürüm hakkı doldu, aksi 409 `second_rating_window_open`. Böylece kursiyerin yanıtı ve yazma hakkı istekten ve sonraki puanlamadan etkilenmez (DOM-BEC-045). Puanı kesinleşen sürüm 409 `second_rating_too_late` (açılmış sonuç geri alınmaz); teslim başına tek istek 409 `second_rating_exists`; son olmayan sürüm 409 `version_not_latest`, bilinmeyen sürüm 404; rubriksiz görev 422 `rubric_not_assigned`. Roller: `yonetici` ve atamayı gören `ogretmen` (atayan olmasa da kapsamındaki sınıf/öğrenci hedefi yüzünden gören; DOM-YTK-028); öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. `Idempotency-Key` zorunlu. Başarı 201, teslimin güncel ayrıntısı ve teslim kaydının `Location`'ı. Geri bildirim metni ve öğrenci kimliği loglanmaz; denetime yalnız alan adları. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["requestSecondRating"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-assignments/{assignmentId}/second-rating-sample": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * İkinci puanlama örneklemini seç
         * @description Örneklemli görevde (`secondRatingPercent > 0`; seviye tespiti ve kur sonu değerlendirmesinde en az %10) ikinci puanlanacak teslimler seçilir (DOM-BEC-024; core `secondRatingQuota`, `pickSecondRatingSample`): sürümü olan bütün teslimlerden oranın yukarı yuvarlanmışı, en az bir. Örneklem teslim penceresi (geç kabul dahil) kapanınca bir kez seçilir (açıkken 409 `second_rating_window_open`, ikinci kez 409 `second_rating_sample_drawn`); seçilmeden ilk puan verilmez (409 `second_rating_sample_pending`) ve puanlama süresi örneklem anından başlar. Böylece kursiyere açılmış bir sonuç sonradan ikinci puan beklemeye dönmez ve kursiyer puanlandığını yeni sürüm reddinden çıkaramaz (DOM-BEC-045). Son tarihsiz görevde pencere kapanmaz, örneklem seçilmez (409 `second_rating_sample_unavailable`): ilk puan örneklemi beklemez, ikinci puan teslim bazında elle istenir. Örneklemsiz görev 422 `second_rating_not_configured`. Rastgelelik atama kimliğiyle tohumlanır. `If-Match` atamanın `rowVersion`'ıdır; başarı 201, atamanın yeni sürümü ve ikinci puan kuyruğunun `Location`'ı. Roller: `yonetici` ve atamayı gören `ogretmen`; öğrenci, veli ve ön büro 403; kapsam dışı veya başka kurumun ataması 404. `Idempotency-Key` zorunlu. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["drawSecondRatingSample"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}/appeals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sonuca itiraz et
         * @description Kursiyer/öğrenci veya velisi sonuç duyurusundan (geri bildirimin açılması) sonra 5 iş günü içinde gerekçeli itiraz eder (DOM-BEC-025; core `planAppeal`, `appealDeadline`: süre ertesi gün başlar, hafta sonu ve kurum tatili sayılmaz, Europe/Istanbul gün sonu). Duyurudan önce 409 `appeal_not_open`; puanlanmamış ve açılmamış puanlı sürümde yanıt aynıdır (DOM-BEC-045). Süre geçince 422 `appeal_window_closed`; alıştırmada 422 `appeal_not_available`; sürüm başına tek itiraz 409 `appeal_exists`; yalnız son sürüme, eski sürüme 409 `appeal_not_latest`; bilinmeyen sürüm 404. İtirazı o sürümü puanlamamış bir öğretmen karara bağlar. Gerekçe loglanmaz; denetime yalnız alan adları. `Idempotency-Key` zorunlu; `If-Match` desteklenmez (400 `if_match_not_supported`). Başarı 201 ve teslim kaydının `Location`'ı. Roller: `ogrenci` kendi, `veli` çocuğunun teslimine; yönetici, öğretmen ve ön büro 403; okuma kapsamı dışı veya başka kurumun teslimi ve arşivli atama 404. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["fileTaskAppeal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/task-submissions/{submissionId}/appeals/{appealId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * İtirazı karara bağla
         * @description İtirazı o sürümü hiçbir rolde puanlamamış, atamayı gören öğretmen karara bağlar (DOM-BEC-025: itiraz ilk puanlayıcı dışında bir öğretmene gider; core `planAppealDecision`); puanlayan öğretmen 409 `rater_not_independent`. Yönetici itirazı okur ama karar veremez (403 `forbidden`). Karar gerekçesiyle bildirilir: `upheld` yeni rubrik puanı (son puan) ister, `rejected` yalnız gerekçe. İlk puan ve önceki puanlar kayıt geçmişinde kalır; kabulde son puan geçerli olur ve kursiyere açılır. Sonuçlanmış itiraz 409 `appeal_decided`; bilinmeyen itiraz 404. Karar gerekçesi loglanmaz. Başarı 200 ve teslimin güncel ayrıntısı. Roller: yalnız `ogretmen` (atamayı gören; DOM-YTK-028); yönetici, öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. `Idempotency-Key` zorunlu. Modül `learning`; kapalıysa 403 `module_disabled`.
         */
        post: operations["decideTaskAppeal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dosya yükle
         * @description Tek dosya, `multipart/form-data`: önce `purpose`, sonra `file` alanı (DOM-KYN-004; ADR 0003 karar 2, 3). Dosya akışla depoya yazılır; boyut ve SHA-256 aynı geçişte hesaplanır. Tür içerikten (sihirli bayt) bulunur: amaçta olmayan tür 422 `file_type_not_allowed`, bildirilen tür veya ad uzantısı içerikle çelişirse 422 `file_type_mismatch`, boş dosya 422 `file_empty`. Amacın (türe özel) boyut sınırı aşılırsa akış kesilir, nesne silinir, 413 `file_too_large`. Kurum kotası aşılırsa 422 `storage_quota_exceeded`. Konuşma kaydı rıza kaydı gelene kadar 403 `consent_required` (DOM-BEC-050). Multipart olmayan gövde 415. Dosya `pending` başlar ve 24 saat içinde bir kayda bağlanmazsa silinir. Kurum kimliği oturumdan gelir. `Idempotency-Key` zorunlu (aynı anahtar + aynı içerik ilk yanıtı tekrarlar); `If-Match` desteklenmez. Başarı 201 ve dosyanın `Location`'ı. Özgün ad log ve denetim kaydına yazılmaz. Roller amaca göre: `submission` ve `speaking_recording` öğrenci; `material`, `question_image`, `listening_audio` yönetici ve öğretmen (modül `learning`, kapalıysa 403 `module_disabled`); `document` yönetici ve ön büro. Diğer roller 403.
         */
        post: operations["uploadFile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{fileId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dosya bilgisi
         * @description Dosyanın meta verisi ve durumu (ADR 0003 karar 4). Bağlı dosya bağlı kaydın okuma kuralından geçer (ADR 0003 karar 6); bağlanmamış dosyayı yalnız yükleyen görür. Yok, başka kurum, silinmiş veya kapsam dışı 404; amacın modülü kapalıysa 403 `module_disabled`.
         */
        get: operations["getFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{fileId}/url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * İmzalı indirme bağlantısı
         * @description Kısa ömürlü imzalı GET bağlantısı (ADR 0003 karar 6): varsayılan 5 dk, konuşma kaydında 2 dk. Tür ve `Content-Disposition` (belge `attachment`, görsel/ses/görüntü `inline`) imzaya dahildir. Dosya işlenirken 409 `file_processing`. Teslim ve konuşma kaydında her bağlantı üretimi denetim kaydına `file.access` olarak yazılır (DOM-BEC-053, DOM-YTK-052). Bağlı dosya bağlı kaydın okuma kuralından geçer (ADR 0003 karar 6); bağlanmamış dosyayı yalnız yükleyen görür. Yok, başka kurum, silinmiş veya kapsam dışı 404; amacın modülü kapalıysa 403 `module_disabled`.
         */
        get: operations["getFileUrl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * İmzalı indirme (disk sürücüsü)
         * @description `disk` sürücüsünde `GET /api/v1/files/{fileId}/url` bağlantısının hedefi; oturum istemez, yetki HMAC imzasındadır. Süresi geçmiş bağlantı 403 `link_expired`, bozuk veya değiştirilmiş bağlantı 403 `invalid_signature`, silinmiş nesne 404. Yanıt dosyanın kendisidir (`Cache-Control: no-store`); `Cross-Origin-Resource-Policy: cross-origin` ile web başka kökenden `<img>`/`<audio>` olarak gömebilir.
         */
        get: operations["downloadFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ErrorResponseInput: {
            /** @description Kararlı, İngilizce, snake_case hata kodu */
            code: string;
            /** @description Kullanıcıya gösterilebilir Türkçe mesaj */
            message: string;
            /** @description Alan düzeyindeki hatalar: 400 doğrulama ve alan yolu bilinen iş kuralı hataları (422/409/403) */
            issues?: {
                path: (string | number)[];
                code: string;
                message: string;
            }[];
            requestId: string;
        };
        PageMetaInput: {
            /** @description Sayfa numarası (1’den başlar) */
            page: number;
            /** @description Sayfa boyutu */
            pageSize: number;
            /** @description Filtre uygulanmış toplam kayıt sayısı */
            total: number;
        };
        CollectionItemJoinedInput: {
            /** @description Kaydın öğrencisinin adı */
            studentName?: string;
            /** @description Kaydın öğrencisinin okul numarası; aktör öğrencinin kaydını okuyabiliyorsa ve numara kayıtlıysa gelir */
            studentNumber?: string;
            /** @description Kaydın sınıfının adı; kayıtta sınıf yoksa öğrencinin güncel sınıfı */
            className?: string;
            /** @description Kaydın kampüsünün adı */
            branchName?: string;
        };
        CollectionItemInput: {
            /** @description Kayıt kimliği */
            id: string;
            /** @description Kayıt sürümü; sonraki yazmada iyimser kilit için geri gönderilir */
            version: number;
            /**
             * Format: date-time
             * @description Kaydın sunucuda oluştuğu an (UTC; kayıt kolonu)
             */
            createdAt: string;
            /**
             * Format: date-time
             * @description Kaydın sunucuda son değiştiği an (UTC; kayıt kolonu)
             */
            updatedAt: string;
            /** @description Arşivlendiği an; arşivde değilse `null` */
            archivedAt: string | null;
            /** @description school-core kaydı; rolün göremediği alanlar çıkarılmıştır. İçindeki `createdAt`/`updatedAt` core iş alanıdır, sistem zamanı üst alanlardır */
            record: {
                [key: string]: unknown;
            };
            /** @description Bağlı kayıtların adları (yalnız bağlı alanı tanımlı koleksiyonlarda: öğrenciye bağlı kayıtlar `studentName`/`studentNumber`/`className`, sınıfa bağlı kayıtlar `className`, kampüse bağlı kayıtlar `branchName`). Bağlı kayıt aktörün okuyabildiği kayıtsa ad döner; kapsam dışı kaydın adı yoktur (alan eksik kalır) */
            joined?: components["schemas"]["CollectionItemJoinedInput"];
        };
        CollectionCountGroupInput: {
            /** @description Grup değeri; alanı olmayan veya skaler olmayan değerli kayıtlar `null` grubundadır */
            value: string | number | boolean | null;
            /** @description Gruptaki kayıt sayısı */
            count: number;
            /** @description Yalnız `sum` istendiğinde: gruptaki değerlerin toplamı (`amount` kuruş) */
            sum?: number;
        };
        CollectionCountsMetaInput: {
            /** @description Süzgeçten geçen toplam kayıt sayısı */
            total: number;
            /** @description Yalnız `sum` istendiğinde: bütün grupların toplamı */
            sum?: number;
        };
        CommandResultInput: {
            /** @description İşlemin konusu; yalnız toplu işlemlerde `null` */
            entity: {
                /** @description İşlemin konusu olan kaydın koleksiyonu */
                collection: string;
                /** @description İşlemin konusu olan kaydın kimliği (yeni kayıtta üretilen) */
                id: string;
            } | null;
            /** @description Değişen kayıt sayıları (yalnız sıra değişikliği sayılmaz) */
            changes: {
                inserted: number;
                updated: number;
                archived: number;
                restored: number;
            };
            /** @description Yazılan kayıtlar; güncel veri koleksiyon okuma uçlarından alınır */
            records: {
                /** @description school-core State koleksiyonu */
                collection: string;
                id: string;
                /** @description Kaydın yeni sürümü (`If-Match` için) */
                version: number;
                /** @enum {string} */
                change: "insert" | "update" | "archive" | "restore" | "move";
            }[];
        };
        TutoringPlanPreviewInput: {
            /** @description Çözümlenmiş plan girdisi */
            input: {
                examId: string;
                threshold: number;
                fromDate: string;
                toDate: string;
                duration: number;
                maxGroupSize: number;
                branchId: string;
                subjectId: string;
            };
            /** @description Önerilen etütler */
            sessions: {
                examId: string;
                branchId: string;
                grade: number;
                subjectId: string;
                /** @description Eksik kazanım */
                topic: string;
                studentIds: string[];
                scores: {
                    studentId: string;
                    percent: number | null;
                }[];
                teacherId: string;
                /** @description Başlangıç anı, ISO 8601 UTC */
                date: string;
                /** @description Dakika */
                duration: number;
                room: string;
                roomClassId: string;
                /** @description Grup kapasitesi: en küçük(grup üst sınırı, derslik kapasitesi) */
                capacity: number;
            }[];
            /** @description Yerleşemeyen gruplar ve nedeni: kapasite, öğretmen, derslik, uygunluk veya çakışma uyarısı */
            unresolved: {
                examId: string;
                branchId: string;
                grade: number;
                subjectId: string;
                /** @description Eksik kazanım */
                topic: string;
                studentIds: string[];
                scores: {
                    studentId: string;
                    percent: number | null;
                }[];
                reason: string;
            }[];
            /** @description Zaten planlanmış veya tamamlanmış etütle karşılanan öğrenci/kazanımlar */
            covered: {
                studentId: string;
                topic: string;
                sessionId: string;
            }[];
            evaluatedStudents: number;
            summary: {
                sessionCount: number;
                plannedStudentCount: number;
                unresolvedGroupCount: number;
                unresolvedStudentCount: number;
                coveredCount: number;
            };
            /** @description Planın JSON metni; onay isteğinde `expectedPlan` olarak aynen geri gönderilir */
            expectedPlan: string;
        };
        EvaluationPreviewInput: {
            rows: {
                examId: string;
                studentId: string;
                studentName: string;
                subjectId: string;
                booklet: string;
                profileId: string;
                keyRevision: number;
                correct: number;
                wrong: number;
                blank: number;
                multiple: number;
                cancelled: number;
                net: number;
                topicScores: {
                    topic: string;
                    total: number;
                    correct: number;
                    percent: number | null;
                }[];
                weakTopics: string[];
                /** @description Aynı sınav/öğrenci/ders sonucunun üzerine yazar */
                replaces: boolean;
            }[];
            summary: {
                rowCount: number;
                studentCount: number;
                replacesCount: number;
            };
            /** @description Önizlemenin SHA-256 özeti (hex); onay isteğinde `expectedDigest` olarak gönderilir */
            digest: string;
        };
        ConversationMessageInput: {
            id: string;
            text: string;
            /** @description `teacher`, `student` veya `parent` */
            sender: string;
            /** @description Gönderim anı (ISO 8601 UTC) */
            sentAt: string;
            /** @description Karşı tarafın ilk görme anı (DOM-ILT-024) */
            readAt: string | null;
            /** @description Mesaj okuyan tarafın mı; yöneticide her zaman `false` */
            fromMe: boolean;
        };
        ConversationSummaryInput: {
            id: string;
            studentId: string;
            teacherId: string;
            /** @description `student` veya `parent` */
            audience: string;
            /** @description Veli yazışmasında velinin kullanıcı kimliği (DOM-ILT-010); eski kayıtta `null` */
            parentUserId: string | null;
            messageCount: number;
            /** @description Son mesaj; yöneticide `null` */
            lastMessage: components["schemas"]["ConversationMessageInput"] | null;
            /** @description Karşı tarafın okunmamış mesajları */
            unreadCount: number;
            /** @description Öğretmen görünümünde yanıt bekleyen yazışma */
            awaitingReply: {
                since: string;
                /** @description İlk iş günü sonu (DOM-ILT-013) */
                dueAt: string;
                overdue: boolean;
            } | null;
        };
        DashboardStatusTotalInput: {
            count: number;
            /** @description Kuruş */
            amount: number;
        };
        DashboardInvoiceSummaryInput: {
            /** @description Taksit sayısı */
            total: number;
            /** @description Ödeme planı toplamı (kuruş) */
            amount: number;
            /** @description Gecikmiş */
            overdue: components["schemas"]["DashboardStatusTotalInput"];
            /** @description Yaklaşan */
            upcoming: components["schemas"]["DashboardStatusTotalInput"];
            /** @description Ödendi */
            paid: components["schemas"]["DashboardStatusTotalInput"];
        };
        DashboardAttendanceCountsInput: {
            present: number;
            absent: number;
            late: number;
            excused: number;
            total: number;
        };
        DashboardInvoiceRowInput: {
            id: string;
            /** @description Bağlı öğrenci adı; kapsam dışında yok */
            studentName?: string;
            installment?: number;
            /** @description Kuruş */
            amount?: number;
            /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
            dueDate?: string;
            /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
            paidAt?: string;
        };
        DashboardAdminInput: {
            /** @constant */
            role: "yonetici";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            students: {
                active: number;
                archived: number;
            };
            classes: {
                active: number;
                /** @description Aktif sınıfı olan kampüs sayısı */
                campusCount: number;
            };
            teachers: {
                active: number;
            };
            /** @description `finance` modülü kapalıysa `null` */
            finance: {
                /** @description Taksit durumu dağılımı (core `invoiceStatus`, isteğin Istanbul günü) */
                invoices: components["schemas"]["DashboardInvoiceSummaryInput"];
                /** @description Bugün (`paidAt` günü) ödenen taksitler */
                collectedToday: components["schemas"]["DashboardStatusTotalInput"];
                monthlyCollection: {
                    /** @description Son 6 ayda ödenen taksit */
                    count: number;
                    /** @description Kuruş */
                    amount: number;
                    /** @description Eskiden yeniye 6 ay (`paidAt:month`); kaydı olmayan ay sıfır */
                    months: {
                        /** @description `YYYY-MM` */
                        month: string;
                        count: number;
                        /** @description Kuruş */
                        amount: number;
                    }[];
                };
            } | null;
            /** @description Bugünkü yoklama; `academic` modülü kapalıysa `null` */
            attendanceToday: components["schemas"]["DashboardAttendanceCountsInput"] | null;
            /** @description En son eklenen 5 aktif öğrenci */
            recentStudents: {
                id: string;
                name: string;
                number?: string;
                className?: string;
            }[];
            /** @description Aktif kampüs başına aktif öğrenci ve aktif sınıf kontenjanı */
            campuses: {
                id: string;
                name: string;
                students: number;
                capacity: number;
            }[];
        };
        DashboardFrontDeskInput: {
            /** @constant */
            role: "onburo";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            /** @description `finance` modülü kapalıysa `null` */
            finance: {
                /** @description Taksit durumu dağılımı (core `invoiceStatus`, isteğin Istanbul günü) */
                invoices: components["schemas"]["DashboardInvoiceSummaryInput"];
                /** @description Taksit sayısı ve tutarı (kuruş) */
                collectedToday: components["schemas"]["DashboardStatusTotalInput"];
                /** @description Vadesi en eski 5 gecikmiş taksit */
                overdue: components["schemas"]["DashboardInvoiceRowInput"][];
                /** @description Vadesi en yakın 5 yaklaşan taksit */
                upcoming: components["schemas"]["DashboardInvoiceRowInput"][];
                /** @description En son kaydedilen 5 ödeme */
                recentPayments: components["schemas"]["DashboardInvoiceRowInput"][];
            } | null;
            /** @description `crm` modülü kapalıysa `null` */
            prospects: {
                total: number;
                /** @description Aşama başına aday; aşamasız `null` sonda */
                stages: {
                    stage: string | null;
                    count: number;
                }[];
            } | null;
        };
        DashboardTeacherInput: {
            /** @constant */
            role: "ogretmen";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            students: {
                active: number;
            };
            classes: {
                active: number;
            };
            /** @description `academic` modülü kapalıysa `null` */
            academic: {
                /** @description Yoklama durum sayıları; `total` bütün kayıtlar */
                attendanceToday: components["schemas"]["DashboardAttendanceCountsInput"];
                lessons: {
                    /** @description Bugünkü iptal edilmemiş ders */
                    total: number;
                    /** @description Bugün iptal edilen ders */
                    cancelled: number;
                    items: {
                        id: string;
                        /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                        date: string;
                        title?: string;
                        subject?: string;
                        room?: string;
                        duration?: number;
                        className?: string;
                    }[];
                };
                /** @description Son 5 gelmedi/geç geldi kaydı */
                recentAbsences: {
                    id: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    date: string;
                    status: string;
                    studentName?: string;
                    className?: string;
                }[];
            } | null;
            /** @description `learning` modülü kapalıysa `null` */
            learning: {
                /** @description Notlanmamış teslim */
                ungraded: number;
                /** @description Son teslim günü bugün veya sonrası olan en yakın 5 ödev */
                homework: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    dueDate: string;
                    className?: string;
                    delivered: number;
                    /** @description Ödevin sınıfındaki aktif öğrenci */
                    expected: number;
                }[];
            } | null;
        };
        DashboardStudentInput: {
            /** @constant */
            role: "ogrenci";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            student: {
                id: string;
                name: string;
            };
            /** @description `academic` modülü kapalıysa `null` */
            academic: {
                grades: {
                    count: number;
                    scoreSum: number;
                    subjects: {
                        subjectId: string;
                        name?: string;
                        count: number;
                        scoreSum: number;
                    }[];
                };
                /** @description Yoklama durum sayıları; `total` bütün kayıtlar */
                attendance: components["schemas"]["DashboardAttendanceCountsInput"];
                /** @description Son 8 hafta (pazartesi–pazar), eskiden yeniye */
                weeklyAbsences: {
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    from: string;
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    to: string;
                    absent: number;
                }[];
                recentGrades: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    date: string;
                    score?: number;
                }[];
            } | null;
            /** @description `learning` modülü kapalıysa `null` */
            learning: {
                submitted: number;
                /** @description Sınıfa verilen ödev */
                assigned: number;
                homework: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    dueDate: string;
                    /** @description Teslim yoksa `null`; `score` `null` ise notlanmamış */
                    submission: {
                        score: number | null;
                    } | null;
                }[];
            } | null;
        };
        DashboardParentInput: {
            /** @constant */
            role: "veli";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            student: {
                id: string;
                name: string;
            };
            /** @description `academic` modülü kapalıysa `null` */
            academic: {
                grades: {
                    count: number;
                    scoreSum: number;
                    subjects: {
                        subjectId: string;
                        name?: string;
                        count: number;
                        scoreSum: number;
                    }[];
                };
                /** @description Yoklama durum sayıları; `total` bütün kayıtlar */
                attendance: components["schemas"]["DashboardAttendanceCountsInput"];
                /** @description Son 8 hafta (pazartesi–pazar), eskiden yeniye */
                weeklyAbsences: {
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    from: string;
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    to: string;
                    absent: number;
                }[];
                recentGrades: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    date: string;
                    score?: number;
                }[];
            } | null;
            /** @description `learning` modülü kapalıysa `null` */
            learning: {
                submitted: number;
                /** @description Sınıfa verilen ödev */
                assigned: number;
                homework: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    dueDate: string;
                    /** @description Teslim yoksa `null`; `score` `null` ise notlanmamış */
                    submission: {
                        score: number | null;
                    } | null;
                }[];
            } | null;
            /** @description Seçili çocuğun bakiyesi; `finance` modülü kapalıysa `null` */
            balance: {
                /** @description Gecikmiş + yaklaşan taksit toplamı */
                outstanding: number;
                overdueCount: number;
            } | null;
        };
        DashboardInput: components["schemas"]["DashboardAdminInput"] | components["schemas"]["DashboardFrontDeskInput"] | components["schemas"]["DashboardTeacherInput"] | components["schemas"]["DashboardStudentInput"] | components["schemas"]["DashboardParentInput"];
        FileUploadBodyInput: {
            /**
             * @description Dosyanın amacı; tür ve boyut sınırı amaca göredir (ADR 0003 karar 3)
             * @enum {string}
             */
            purpose: "submission" | "material" | "question_image" | "listening_audio" | "speaking_recording" | "document";
            /**
             * Format: binary
             * @description Tek dosya; alan adı `file`
             */
            file: string;
        };
        FileInput: {
            /** Format: uuid */
            id: string;
            /**
             * @description Dosyanın amacı; tür ve boyut sınırı amaca göredir (ADR 0003 karar 3)
             * @enum {string}
             */
            purpose: "submission" | "material" | "question_image" | "listening_audio" | "speaking_recording" | "document";
            /**
             * @description `pending` yüklendi, denetim bekliyor; `processing` taranıyor/dönüştürülüyor (bağlantı verilmez); `ready` kullanıma hazır; `rejected`/`deleted` görünmez
             * @enum {string}
             */
            status: "pending" | "processing" | "ready" | "rejected" | "deleted";
            /** @description İçerikten tespit edilen kanonik MIME türü */
            contentType: string;
            byteSize: number;
            sha256: string;
            /** @description Sunucuda ölçülen süre; yoksa `null` */
            durationMs: number | null;
            /** @description Temizlenmiş özgün ad; yalnız gösterim için */
            originalName: string | null;
            /** @description Dosya bir kayda bağlandı mı (ADR 0003 karar 5) */
            attached: boolean;
            /** Format: date-time */
            createdAt: string;
            rowVersion: number;
        };
        FileUrlInput: {
            /**
             * Format: uri
             * @description Kısa ömürlü imzalı GET bağlantısı
             */
            url: string;
            /**
             * Format: date-time
             * @description Bağlantının geçerlilik sonu
             */
            expiresAt: string;
        };
        HealthInput: {
            /**
             * @description Sunucu çalışıyor
             * @constant
             */
            status: "ok";
            /**
             * @description Veritabanı bağlantısı sağlıklı
             * @constant
             */
            database: "ok";
        };
        MembershipLinkInput: {
            /**
             * @description Bağlantı türü: öğrenci kendi kaydı, veli çocuğu, öğretmen kaydı
             * @enum {string}
             */
            kind: "student" | "child" | "teacher";
            /** @description school-core kayıt kimliği */
            recordId: string;
        };
        MeInput: {
            user: {
                id: string;
                /** @description Ad soyad */
                name: string;
                /** @description Giriş e-postası */
                email: string;
            };
            /** @description Oturumun etkin kurumu; üyelik yoksa `null` */
            activeInstitution: {
                id: string;
                name: string;
                slug: string;
                /**
                 * @description Kurum türü: `school` ders + kazanım, `language_school` CEFR + beceri
                 * @enum {string}
                 */
                type: "school" | "language_school";
                /** @description Modül anahtarı → açık mı. school-core modül kaydındaki her modül listelenir. Kurum türünde bulunmayan modül her zaman `false`tır ve uçları 404 döner (DOM-YTK-012); kurumun kapattığı modülün uçları 403 `module_disabled` */
                enabledModules: {
                    [key: string]: boolean;
                };
                /** @description Etkin eğitim-öğretim yılının (dönemin) başlangıç yılı: 2026 → 2026–2027. Kurum ayarı yoksa `null` */
                academicYear: number | null;
            } | null;
            /** @description Etkin kurumdaki üyelik ve school-core kayıt bağlantıları */
            activeMembership: {
                id: string;
                /** @enum {string} */
                role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
                links: components["schemas"]["MembershipLinkInput"][];
            } | null;
            /** @description Kullanıcının bütün kurum üyelikleri (kurum değiştirme için) */
            memberships: {
                id: string;
                institutionId: string;
                institutionName: string;
                /**
                 * @description Kurum türü: `school` ders + kazanım, `language_school` CEFR + beceri
                 * @enum {string}
                 */
                institutionType: "school" | "language_school";
                /** @enum {string} */
                role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            }[];
        };
        AuditEventActorInput: {
            userId: string;
            /** @description Kullanıcının görünen adı; hesap yoksa `null` */
            name: string | null;
            /** @description İşlem anındaki rol; kayıtlı değilse üyelik rolü */
            role: ("yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli") | null;
        };
        AuditEventInput: {
            id: string;
            /**
             * Format: date-time
             * @description İşlemin anı (UTC)
             */
            createdAt: string;
            /** @description İşlem adı (ör. `module.set`, `workflow.goal`) */
            action: string;
            /** @description Varlık türü; rehberlik kayıtlarında `guidanceCases` */
            entityType: string | null;
            /** @description Varlık kimliği; rehberlik kayıtlarında (DOM-YTK-020) hiçbir zaman dönmez */
            entityId: string | null;
            /** @description Yapan kişi; sistem olaylarında `null` */
            actor: components["schemas"]["AuditEventActorInput"] | null;
            /** @description Değişen alan adları (değerler hiçbir zaman dönmez); rehberlikte boştur */
            fields: string[];
            /** @description Gerekçeli hassas okumanın gerekçesi (DOM-YTK-052); diğer kayıtlarda `null` */
            reason: string | null;
        };
        InstitutionMemberLinkInput: {
            /**
             * @description Bağlantı türü: öğrenci, çocuk (veli) veya öğretmen
             * @enum {string}
             */
            kind: "student" | "child" | "teacher";
            /** @description Bağlı kişinin adı; kayıt yoksa `null` */
            name: string | null;
        };
        InstitutionMemberInput: {
            /** @description Üyelik kimliği */
            id: string;
            userId: string;
            /** @description Görünen ad */
            name: string;
            /** @description Giriş e-postası; yalnız yöneticiye döner */
            email: string;
            /** @enum {string} */
            role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            /** @enum {string} */
            status: "active" | "passive";
            /** @description Bağlı öğrenci, çocuk veya öğretmen */
            links: components["schemas"]["InstitutionMemberLinkInput"][];
            /**
             * Format: date-time
             * @description Üyeliğin açıldığı an (UTC)
             */
            createdAt: string;
        };
        InstitutionMembershipInput: {
            /** @description Üyelik kimliği */
            id: string;
            userId: string;
            /** @description Ad soyad */
            name: string;
            /** @description Giriş e-postası */
            email: string;
            /** @enum {string} */
            role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            /**
             * Format: date-time
             * @description Üyeliğin açıldığı an (UTC)
             */
            createdAt: string;
        };
        ModuleSettingsInput: {
            /** @description Kurum ayar sürümü (`If-Match` için) */
            version: number;
            /** @description Kurum türünde bulunan modüller; türde olmayan modül listelenmez */
            modules: {
                /** @description Modül anahtarı */
                key: string;
                /** @description Modül açık mı */
                enabled: boolean;
            }[];
        };
        ModuleChangeInput: {
            moduleKey: string;
            enabled: boolean;
            /** @description Güncel etkin modül haritası (`/me` `enabledModules` ile aynı) */
            enabledModules: {
                [key: string]: boolean;
            };
            /** @description Yeni kurum ayar sürümü */
            version: number;
        };
        ResourceTagsInput: {
            subjectId: string | null;
            gradeLevels: number[];
            cefrLevel: ("Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2") | null;
            primarySkill: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use") | null;
            skills: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use" | "vocabulary" | "grammar" | "pronunciation")[];
            activityMode: ("reception" | "production" | "interaction" | "mediation") | null;
            interactionChannel: ("spoken" | "written" | "online") | null;
            mediation: {
                /** @enum {string} */
                sourceSkill: "reading" | "listening" | "writing" | "speaking";
                /** @enum {string} */
                targetSkill: "reading" | "listening" | "writing" | "speaking";
            } | null;
            durationMinutes: number | null;
            difficulty: ("easy" | "medium" | "hard") | null;
            outcomes: {
                outcomeId: string;
                /** @enum {string} */
                outcomeSource: "platform" | "institution";
            }[];
        };
        ResourceAttributionInput: {
            work: string;
            author: string;
            source: string;
            year: number | null;
        };
        ResourceVersionSummaryInput: {
            /** Format: uuid */
            id: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "in_review" | "published" | "rejected" | "archived" | "removed";
            title: string;
            authorUserId: string;
            tags: components["schemas"]["ResourceTagsInput"];
            /** @description Lisans türü; seçilmemişse `null` */
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            /** @description Arşivlendiği an; arşivli sürüm geçmişte okunur */
            archivedAt: string | null;
            removedAt: string | null;
        };
        ResourceVersionInput: {
            /** Format: uuid */
            id: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "in_review" | "published" | "rejected" | "archived" | "removed";
            title: string;
            authorUserId: string;
            tags: components["schemas"]["ResourceTagsInput"];
            /** @description Lisans türü; seçilmemişse `null` */
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            /** @description Arşivlendiği an; arşivli sürüm geçmişte okunur */
            archivedAt: string | null;
            removedAt: string | null;
            /** @description Kaldırılan sürümde `null` (DOM-KYN-051) */
            content: {
                [key: string]: unknown;
            } | null;
            /** @description Cevap anahtarı (school-core `answerKeySchema`); yalnız personel */
            answerKey: {
                [key: string]: unknown;
            } | null;
            /** @description Lisans ayrıntısı (school-core `resourceLicenseSchema`); yalnız personel */
            license: {
                [key: string]: unknown;
            } | null;
            attributions: components["schemas"]["ResourceAttributionInput"][];
            submittedAt: string | null;
            reviewedByUserId: string | null;
            reviewedAt: string | null;
            rejectionReason: string | null;
            removalReason: string | null;
            /** @description İyimser kilit sürümü (`If-Match`) */
            rowVersion: number;
        };
        LearnerResourceVersionInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            title: string;
            /** @description Öğrenci görünümü: seçenekler kişiye sabit karıştırılır, dinleme görevinde döküm gizlidir */
            content: {
                [key: string]: unknown;
            };
            tags: components["schemas"]["ResourceTagsInput"];
            attributions: components["schemas"]["ResourceAttributionInput"][];
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
        };
        StaffResourceInput: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            ownerUserId: string;
            /** @enum {string} */
            shareScope: "private" | "students" | "classes" | "department" | "institution";
            /** @description Güncel yayındaki sürüm; hiç yayımlanmadıysa `null` */
            currentVersionId: string | null;
            /** @description Kopyalandığı sürüm */
            derivedFromVersionId: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            sharedStudentIds: string[];
            sharedClassIds: string[];
            /** @description Bütün sürümleri arşivlenince veya kaynak kaldırılınca dolar (DOM-KYN-051) */
            archivedAt: string | null;
            /** @description Kaynak satırının iyimser kilit sürümü (paylaşım ve kaldırmada `If-Match`) */
            rowVersion: number;
        };
        StaffResourceListItemInput: {
            /** @constant */
            view: "staff";
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            ownerUserId: string;
            /** @enum {string} */
            shareScope: "private" | "students" | "classes" | "department" | "institution";
            /** @description Güncel yayındaki sürüm; hiç yayımlanmadıysa `null` */
            currentVersionId: string | null;
            /** @description Kopyalandığı sürüm */
            derivedFromVersionId: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Okunabilir baş sürüm */
            version: components["schemas"]["ResourceVersionSummaryInput"];
        };
        LearnerResourceListItemInput: {
            /** @constant */
            view: "learner";
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            version: {
                /** Format: uuid */
                id: string;
                title: string;
                tags: components["schemas"]["ResourceTagsInput"];
                licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
            };
        };
        StaffResourceDetailInput: {
            /** @constant */
            view: "staff";
            resource: components["schemas"]["StaffResourceInput"];
            /** @description Okunabilir sürümler, numaraya göre artan */
            versions: components["schemas"]["ResourceVersionSummaryInput"][];
            head: components["schemas"]["ResourceVersionInput"];
            /** @description Açık sürümde (taslak, incelemede, reddedildi) yayım eksikleri; diğerlerinde boş */
            publicationIssues: {
                code: string;
                message: string;
                path: string[];
            }[];
        };
        LearnerResourceDetailInput: {
            /** @constant */
            view: "learner";
            resource: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            };
            version: components["schemas"]["LearnerResourceVersionInput"];
        };
        ResourceWriteResultInput: {
            resource: components["schemas"]["StaffResourceInput"];
            version: components["schemas"]["ResourceVersionInput"];
        };
        ResourceShareResultInput: {
            resource: components["schemas"]["StaffResourceInput"];
        };
        ResourceRemovalResultInput: {
            resource: components["schemas"]["StaffResourceInput"];
            /** @description Kaldırılan sürümler */
            versionIds: string[];
            /** @description Bu sürümlerden türetilmiş kopyalar; yönetici ayrıca inceler (DOM-KYN-050) */
            affectedCopyIds: string[];
            /** @description Kaldırılan soruyu içeren quiz/alıştırma seti sürümleri */
            affectedContainerVersionIds: string[];
        };
        BookableSlotInput: {
            /** @description Uygunluk saati kimliği; talepte `slotId` olarak gönderilir */
            slotId: string;
            teacherId: string;
            teacherName: string;
            /** @description Başlangıç, ISO 8601 UTC */
            startsAt: string;
            /** @description Dakika */
            duration: number;
            /** @description Öğretmenin kampüsü; kayıt yoksa yok */
            campusName?: string;
            /** @description Öğretmenin öğrencinin sınıfında verdiği dersler, ada göre sıralı */
            subjectNames: string[];
            /** @description `false`: saat dolu ("Dolu"); neden hiçbir durumda bildirilmez (DOM-ILT-073) */
            available: boolean;
        };
        EnrollProspectResultInput: {
            /** @description İşlemin konusu; yalnız toplu işlemlerde `null` */
            entity: {
                /** @description İşlemin konusu olan kaydın koleksiyonu */
                collection: string;
                /** @description İşlemin konusu olan kaydın kimliği (yeni kayıtta üretilen) */
                id: string;
            } | null;
            /** @description Değişen kayıt sayıları (yalnız sıra değişikliği sayılmaz) */
            changes: {
                inserted: number;
                updated: number;
                archived: number;
                restored: number;
            };
            /** @description Yazılan kayıtlar; güncel veri koleksiyon okuma uçlarından alınır */
            records: {
                /** @description school-core State koleksiyonu */
                collection: string;
                id: string;
                /** @description Kaydın yeni sürümü (`If-Match` için) */
                version: number;
                /** @enum {string} */
                change: "insert" | "update" | "archive" | "restore" | "move";
            }[];
            /** @description Oluşturulan sözleşmenin kimliği (PDF ve okuma uçları için) */
            contractId: string;
        };
        RubricInput: {
            /** Format: uuid */
            id: string;
            ownerUserId: string;
            /** Format: date-time */
            createdAt: string;
            /** @description Kişi rubriği düzenleyebilir mi (core `canManageRubric`: sahip veya yönetici) */
            canManage: boolean;
        };
        RubricVersionSummaryInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            rubricId: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "published" | "archived";
            title: string;
            /** @enum {string} */
            kind: "analytic" | "holistic";
            /** @enum {string} */
            skill: "writing" | "speaking" | "mediation";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            archivedAt: string | null;
            /** @description Sürüm satırının iyimser kilit sürümü (düzenleme, yayım ve arşivde `If-Match`) */
            rowVersion: number;
        };
        RubricVersionInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            rubricId: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "published" | "archived";
            title: string;
            /** @enum {string} */
            kind: "analytic" | "holistic";
            /** @enum {string} */
            skill: "writing" | "speaking" | "mediation";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            archivedAt: string | null;
            /** @description Sürüm satırının iyimser kilit sürümü (düzenleme, yayım ve arşivde `If-Match`) */
            rowVersion: number;
            criteria: {
                id: string;
                /** @description CEFR-CV niteliksel yönü; bütüncül rubrikte `overall` */
                aspect: string;
                weight: number;
                bands: {
                    band: number;
                    /** @description Kurumun kendi cümlesi (DOM-BEC-004) */
                    description: string;
                    alignment: {
                        /** @constant */
                        kind: "cefr";
                        scale: string;
                        /** @enum {string} */
                        level: "Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2";
                        index: number;
                    } | {
                        /** @constant */
                        kind: "outcome";
                        outcomeId: string;
                        /** @enum {string} */
                        outcomeSource: "platform" | "institution";
                    };
                }[];
            }[];
            /** @description Sürümün sabitlendiği atama ve verilmiş puan sayısı; kullanılmış sürüm değişmez (DOM-BEC-022) */
            usage: {
                assignmentCount: number;
                scoreCount: number;
            };
        };
        RubricListItemInput: {
            rubric: components["schemas"]["RubricInput"];
            /** @description En yüksek numaralı sürüm */
            head: components["schemas"]["RubricVersionSummaryInput"];
            /** @description Yayındaki sürüm; yeni atamada yalnız bu kullanılır (DOM-BEC-022) */
            publishedVersionId: string | null;
        };
        RubricDetailInput: {
            rubric: components["schemas"]["RubricInput"];
            /** @description Bütün sürümler, numaraya göre artan */
            versions: components["schemas"]["RubricVersionInput"][];
        };
        RubricWriteResultInput: {
            rubric: components["schemas"]["RubricInput"];
            version: components["schemas"]["RubricVersionInput"];
        };
        TaskAssignmentStaffInput: {
            /** @constant */
            view: "staff";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü (DOM-KYN-032)
             */
            resourceVersionId: string;
            /** @description Atanan sürümün başlığı */
            title: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            /**
             * @description Otomatik puanlı veya öğretmen puanlı
             * @enum {string}
             */
            scoringMode: "auto" | "teacher";
            /** @enum {string} */
            kind: "evaluation" | "practice";
            /** @description Deneme hakkı ve sayım politikası (DOM-BEC-042) */
            attempts: {
                /** @constant */
                kind: "evaluation";
                /** @default 1 */
                maxAttempts: number;
                /**
                 * @default first
                 * @enum {string}
                 */
                countPolicy: "first" | "highest";
            } | {
                /** @constant */
                kind: "practice";
            };
            /** @description Son teslim ve geç kabul (DOM-BEC-044) */
            deadline: {
                /** @default null */
                dueAt: string | null;
                /** @default 0 */
                lateAcceptanceDays: number;
            };
            timeLimitMinutes: number | null;
            /** @description Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005) */
            listeningPlays: (1 | 2) | null;
            showTranscript: boolean;
            /** @description Öğretmen puanlı görevin teslim ayarı */
            submission: ({
                /** @constant */
                submissionKind: "text";
                /** @default 3 */
                maxVersions: number;
                /** @default null */
                minWords: number | null;
                /** @default null */
                maxWords: number | null;
            } | {
                /** @constant */
                submissionKind: "file";
                /** @default 3 */
                maxVersions: number;
            } | {
                /** @constant */
                submissionKind: "audio";
                /** @default 3 */
                maxVersions: number;
                /** @default 1 */
                speakingAttempts: number;
                /** @default 0 */
                preparationSeconds: number;
                speakingSeconds: number;
            }) | null;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: uuid
             * @description Puanlamanın okunduğu sürüm; başta içerik sürümüdür, yalnız yeniden puanlama değiştirir
             */
            scoringVersionId: string;
            /** @description Sabitlenen yayındaki rubrik sürümü (DOM-BEC-022) */
            rubricVersionId: string | null;
            highStakes: boolean;
            secondRatingPercent: number;
            /** @description İkinci puanlama örnekleminin seçildiği an (DOM-BEC-024); seçilmediyse veya örneklem yoksa `null`. Yalnız personel görür */
            secondRatingSampledAt: string | null;
            assignedByUserId: string;
            /** @description Sınıf/şube, dil grubu veya öğrenci hedefleri */
            targets: {
                /** @enum {string} */
                kind: "class" | "group" | "student";
                id: string;
            }[];
            /** Format: date-time */
            updatedAt: string;
            archivedAt: string | null;
            /** @description Atama satırının iyimser kilit sürümü (değişiklikte `If-Match`) */
            rowVersion: number;
        };
        TaskAssignmentLearnerProgressInput: {
            learnerId: string;
            /**
             * @description Başlanmadı/teslim bekleniyor, süren deneme, zamanında veya geç tamamlandı/teslim edildi, pencere kapandı ve yapılmadı (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "in_progress" | "submitted" | "late" | "not_submitted";
            /** @description Öğretmen yeniden teslim istedi ve yeni sürüm henüz gelmedi (DOM-BEC-040) */
            resubmissionRequested: boolean;
            /** @description Otomatik puanlı: süren deneme, yoksa gösterilen (sayılan veya son) deneme */
            attemptId: string | null;
            /** @description Öğretmen puanlı: teslim kaydı */
            submissionId: string | null;
            /** @description Gösterilen denemenin tamamlandığı veya son sürümün gönderildiği an */
            lastActivityAt: string | null;
            /** @description Kullanılan deneme veya gönderilen sürüm sayısı */
            used: number;
            /** @description Deneme veya sürüm hakkı; `null` sınırsız */
            limit: number | null;
            /** @description Kalan hak; `null` sınırsız */
            remaining: number | null;
            /** @description Şu an yeni deneme başlatılabilir veya yeni sürüm gönderilebilir */
            canAct: boolean;
            /** @description `canAct` değilse neden: süren deneme, içerik lisansı doldu (DOM-KYN-021), pencere kapandı, hak doldu, teslim değerlendirildi (yalnız geri bildirim açıldıysa) veya görev okunamıyor */
            blockedBy: ("in_progress" | "license_expired" | "locked" | "limit" | "graded" | "unavailable") | null;
            /** @description Açılmış puan: otomatik puanlıda gösterilen denemenin toplamı, öğretmen puanlıda geri bildirimi açılmış son sürümün rubrik toplamı (DOM-BEC-045) */
            score: {
                earned: number;
                possible: number;
                percent: number;
            } | null;
        };
        TaskAssignmentLearnerInput: {
            /** @constant */
            view: "learner";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü (DOM-KYN-032)
             */
            resourceVersionId: string;
            /** @description Atanan sürümün başlığı */
            title: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            /**
             * @description Otomatik puanlı veya öğretmen puanlı
             * @enum {string}
             */
            scoringMode: "auto" | "teacher";
            /** @enum {string} */
            kind: "evaluation" | "practice";
            /** @description Deneme hakkı ve sayım politikası (DOM-BEC-042) */
            attempts: {
                /** @constant */
                kind: "evaluation";
                /** @default 1 */
                maxAttempts: number;
                /**
                 * @default first
                 * @enum {string}
                 */
                countPolicy: "first" | "highest";
            } | {
                /** @constant */
                kind: "practice";
            };
            /** @description Son teslim ve geç kabul (DOM-BEC-044) */
            deadline: {
                /** @default null */
                dueAt: string | null;
                /** @default 0 */
                lateAcceptanceDays: number;
            };
            timeLimitMinutes: number | null;
            /** @description Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005) */
            listeningPlays: (1 | 2) | null;
            showTranscript: boolean;
            /** @description Öğretmen puanlı görevin teslim ayarı */
            submission: ({
                /** @constant */
                submissionKind: "text";
                /** @default 3 */
                maxVersions: number;
                /** @default null */
                minWords: number | null;
                /** @default null */
                maxWords: number | null;
            } | {
                /** @constant */
                submissionKind: "file";
                /** @default 3 */
                maxVersions: number;
            } | {
                /** @constant */
                submissionKind: "audio";
                /** @default 3 */
                maxVersions: number;
                /** @default 1 */
                speakingAttempts: number;
                /** @default 0 */
                preparationSeconds: number;
                speakingSeconds: number;
            }) | null;
            /** Format: date-time */
            createdAt: string;
            /** @description Görevin hedeflediği kişinin kendisi veya velinin çocukları */
            learnerIds: string[];
            /** @description `learnerIds` sırasıyla her kişinin durumu */
            progress: components["schemas"]["TaskAssignmentLearnerProgressInput"][];
        };
        TaskAssignmentLearnerBodyInput: {
            /** @constant */
            type: "text";
            body: string | null;
            fileId: string | null;
        } | {
            /** @constant */
            type: "worksheet";
            body: string | null;
            fileId: string | null;
        } | {
            /** @constant */
            type: "reading_passage";
            body: string;
        } | {
            /** @constant */
            type: "audio";
            /** @description Dosya kimliği */
            fileId: string;
            /** @description Dinleme görevinde atamanın `showTranscript` ayarına bağlıdır (DOM-KYN-003) */
            transcript: string | null;
            captionsVtt: string | null;
        } | {
            /** @constant */
            type: "video";
            /** @description Dosya kimliği */
            fileId: string;
            /** @description Dinleme görevinde atamanın `showTranscript` ayarına bağlıdır (DOM-KYN-003) */
            transcript: string | null;
            captionsVtt: string | null;
        } | {
            /** @constant */
            type: "file";
            /** @description Dosya kimliği */
            fileId: string;
        } | {
            /** @constant */
            type: "link";
            url: string;
            provider: string | null;
        } | {
            /** @constant */
            type: "book_reference";
            publisher: string;
            bookTitle: string;
            edition: string | null;
            isbn: string | null;
            pages: string;
            note: string | null;
        } | {
            /** @constant */
            type: "question";
            /** @description Soru sayısı; sorular denemede gelir */
            questionCount: number;
        } | {
            /** @constant */
            type: "quiz";
            /** @description Soru sayısı; sorular denemede gelir */
            questionCount: number;
        } | {
            /** @constant */
            type: "exercise_set";
            /** @description Soru sayısı; sorular denemede gelir */
            questionCount: number;
        } | {
            /** @constant */
            type: "homework_template";
            instructions: string;
            submissionKinds: ("file" | "text" | "audio")[];
        };
        TaskAssignmentLearnerContentInput: {
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü
             */
            versionId: string;
            title: string;
            body: components["schemas"]["TaskAssignmentLearnerBodyInput"];
            /** @description Kaynak gösterimi (DOM-KYN-024) */
            attributions: components["schemas"]["ResourceAttributionInput"][];
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
        };
        TaskAssignmentLearnerDetailInput: {
            /** @constant */
            view: "learner";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü (DOM-KYN-032)
             */
            resourceVersionId: string;
            /** @description Atanan sürümün başlığı */
            title: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            /**
             * @description Otomatik puanlı veya öğretmen puanlı
             * @enum {string}
             */
            scoringMode: "auto" | "teacher";
            /** @enum {string} */
            kind: "evaluation" | "practice";
            /** @description Deneme hakkı ve sayım politikası (DOM-BEC-042) */
            attempts: {
                /** @constant */
                kind: "evaluation";
                /** @default 1 */
                maxAttempts: number;
                /**
                 * @default first
                 * @enum {string}
                 */
                countPolicy: "first" | "highest";
            } | {
                /** @constant */
                kind: "practice";
            };
            /** @description Son teslim ve geç kabul (DOM-BEC-044) */
            deadline: {
                /** @default null */
                dueAt: string | null;
                /** @default 0 */
                lateAcceptanceDays: number;
            };
            timeLimitMinutes: number | null;
            /** @description Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005) */
            listeningPlays: (1 | 2) | null;
            showTranscript: boolean;
            /** @description Öğretmen puanlı görevin teslim ayarı */
            submission: ({
                /** @constant */
                submissionKind: "text";
                /** @default 3 */
                maxVersions: number;
                /** @default null */
                minWords: number | null;
                /** @default null */
                maxWords: number | null;
            } | {
                /** @constant */
                submissionKind: "file";
                /** @default 3 */
                maxVersions: number;
            } | {
                /** @constant */
                submissionKind: "audio";
                /** @default 3 */
                maxVersions: number;
                /** @default 1 */
                speakingAttempts: number;
                /** @default 0 */
                preparationSeconds: number;
                speakingSeconds: number;
            }) | null;
            /** Format: date-time */
            createdAt: string;
            /** @description Görevin hedeflediği kişinin kendisi veya velinin çocukları */
            learnerIds: string[];
            /** @description `learnerIds` sırasıyla her kişinin durumu */
            progress: components["schemas"]["TaskAssignmentLearnerProgressInput"][];
            content: components["schemas"]["TaskAssignmentLearnerContentInput"] | null;
            /** @description `content` boşsa neden: lisans doldu ve süren iş yok (DOM-KYN-021) veya sürüm kaldırıldı/yayında değil */
            contentUnavailable: ("license_expired" | "unavailable") | null;
        };
        TaskAssignmentInput: components["schemas"]["TaskAssignmentStaffInput"] | components["schemas"]["TaskAssignmentLearnerInput"];
        TaskAssignmentDetailInput: components["schemas"]["TaskAssignmentStaffInput"] | components["schemas"]["TaskAssignmentLearnerDetailInput"];
        TaskAttemptItemScoreInput: {
            questionVersionId: string;
            parts: number;
            correctParts: number;
            answered: boolean;
            points: number;
            earned: number;
        };
        TaskAttemptResultInput: {
            /** @description Kazanılan puan (iki ondalık) */
            earned: number;
            possible: number;
            /** @description 100 üzerinden puan */
            percent: number;
            /** @description Madde sonuçları; kursiyer ve veli yalnız anahtar açılınca görür (DOM-BEC-045) */
            items: components["schemas"]["TaskAttemptItemScoreInput"][] | null;
            /** @description Doğru cevaplar ve açıklamalar; yalnız anahtar açılınca (DOM-BEC-045) */
            answerKey: {
                questionVersionId: string;
                answerKey: {
                    /** @constant */
                    questionType: "multiple_choice";
                    correctOptionId: string;
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    /** @enum {string} */
                    answer: "true" | "false" | "not_given";
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "matching";
                    pairs: {
                        promptId: string;
                        choiceId: string;
                    }[];
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    gaps: {
                        gapId: string;
                        accepted: string[];
                    }[];
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "ordering";
                    order: string[];
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    accepted: string[];
                    explanation: string;
                };
            }[] | null;
        };
        TaskAttemptInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            attemptNumber: number;
            /**
             * @description Süren, teslim edilmiş veya süresi dolmuş (kaydedilmiş cevaplarla teslim sayılır)
             * @enum {string}
             */
            status: "in_progress" | "submitted" | "expired";
            /** Format: date-time */
            startedAt: string;
            /** @description Süre ve teslim kapanışından erken olanı; yoksa `null` */
            endsAt: string | null;
            remainingMs: number | null;
            completedAt: string | null;
            /** @description Süre dolduğu için kaydedilmiş cevaplarla teslim sayıldı */
            autoSubmitted: boolean;
            /** @description Son teslimden sonra, geç kabul süresinde tamamlandı */
            late: boolean;
            /** @description Sayılan deneme (DOM-BEC-042); alıştırmada hep `false` */
            counted: boolean;
            answers: {
                [key: string]: {
                    /** @constant */
                    questionType: "multiple_choice";
                    optionId: string | null;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    answer: ("true" | "false" | "not_given") | null;
                } | {
                    /** @constant */
                    questionType: "matching";
                    pairs: {
                        promptId: string;
                        choiceId: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    gaps: {
                        gapId: string;
                        value: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "ordering";
                    order: string[];
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    value: string;
                };
            };
            /** @description Süren denemede ve kursiyer görünümünde tamamlanmadan `null` */
            result: components["schemas"]["TaskAttemptResultInput"] | null;
            /** @description Deneme satırının iyimser kilit sürümü (cevap kaydı ve teslimde `If-Match`) */
            rowVersion: number;
        };
        TaskAttemptDetailInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            attemptNumber: number;
            /**
             * @description Süren, teslim edilmiş veya süresi dolmuş (kaydedilmiş cevaplarla teslim sayılır)
             * @enum {string}
             */
            status: "in_progress" | "submitted" | "expired";
            /** Format: date-time */
            startedAt: string;
            /** @description Süre ve teslim kapanışından erken olanı; yoksa `null` */
            endsAt: string | null;
            remainingMs: number | null;
            completedAt: string | null;
            /** @description Süre dolduğu için kaydedilmiş cevaplarla teslim sayıldı */
            autoSubmitted: boolean;
            /** @description Son teslimden sonra, geç kabul süresinde tamamlandı */
            late: boolean;
            /** @description Sayılan deneme (DOM-BEC-042); alıştırmada hep `false` */
            counted: boolean;
            answers: {
                [key: string]: {
                    /** @constant */
                    questionType: "multiple_choice";
                    optionId: string | null;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    answer: ("true" | "false" | "not_given") | null;
                } | {
                    /** @constant */
                    questionType: "matching";
                    pairs: {
                        promptId: string;
                        choiceId: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    gaps: {
                        gapId: string;
                        value: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "ordering";
                    order: string[];
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    value: string;
                };
            };
            /** @description Süren denemede ve kursiyer görünümünde tamamlanmadan `null` */
            result: components["schemas"]["TaskAttemptResultInput"] | null;
            /** @description Deneme satırının iyimser kilit sürümü (cevap kaydı ve teslimde `If-Match`) */
            rowVersion: number;
            /** @description Denemenin soruları; anahtar ve açıklama yoktur, seçenekler denemeye göre karışık */
            questions: {
                questionVersionId: string;
                points: number;
                question: {
                    /** @constant */
                    questionType: "multiple_choice";
                    stem: string;
                    options: {
                        id: string;
                        text: string;
                    }[];
                    /** @default null */
                    imageFileId: string | null;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    stem: string;
                    /** @default false */
                    allowNotGiven: boolean;
                    /** @default null */
                    imageFileId: string | null;
                } | {
                    /** @constant */
                    questionType: "matching";
                    stem: string;
                    prompts: {
                        id: string;
                        text: string;
                    }[];
                    choices: {
                        id: string;
                        text: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    stem: string;
                    gaps: {
                        id: string;
                        /** @default [] */
                        options: string[];
                    }[];
                } | {
                    /** @constant */
                    questionType: "ordering";
                    stem: string;
                    items: {
                        id: string;
                        text: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    stem: string;
                    /** @default 100 */
                    maxLength: number;
                    /** @default null */
                    imageFileId: string | null;
                };
            }[];
        };
        TaskWordCountInput: {
            count: number;
            /** @enum {string} */
            status: "ok" | "below" | "above";
            /** @description Sözcük sınırı dışındaysa uyarı; teslim reddedilmez (DOM-BEC-046) */
            warning: string | null;
        };
        TaskScoreBriefInput: {
            /** @description Puan kesinleşti mi (core `scoreResolution`); kesinleşmemiş puanı yalnız personel görür */
            settled: boolean;
            /**
             * Format: uuid
             * @description Puanın verildiği rubrik sürümü (atamanın sabitlediği; DOM-BEC-022)
             */
            rubricVersionId: string;
            /** @description Ağırlıklı bant toplamı; saklanmaz, okunurken */
            total: number;
            /** @description Azami ağırlıklı bant toplamı */
            max: number;
            /** @description 100 üzerinden puan (DOM-BEC-021) */
            percent: number;
            /** Format: date-time */
            scoredAt: string;
        };
        TaskScoreInput: {
            /** @description Puan kesinleşti mi (core `scoreResolution`); kesinleşmemiş puanı yalnız personel görür */
            settled: boolean;
            /**
             * Format: uuid
             * @description Puanın verildiği rubrik sürümü (atamanın sabitlediği; DOM-BEC-022)
             */
            rubricVersionId: string;
            /** @description Ağırlıklı bant toplamı; saklanmaz, okunurken */
            total: number;
            /** @description Azami ağırlıklı bant toplamı */
            max: number;
            /** @description 100 üzerinden puan (DOM-BEC-021) */
            percent: number;
            /** Format: date-time */
            scoredAt: string;
            criteria: {
                criterionId: string;
                band: number;
                weight: number;
                weighted: number;
                /** @enum {string} */
                meaning: "below" | "target" | "above";
                comment: string | null;
            }[];
            /** @description Öğretmenin genel geri bildirimi */
            overallComment: string;
        };
        TaskSubmissionInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            /**
             * @description Son sürüme göre teslim durumu (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "submitted" | "late" | "not_submitted";
            versionCount: number;
            latestVersion: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCountInput"] | null;
                score: components["schemas"]["TaskScoreBriefInput"] | null;
            } | null;
            /** @description Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040) */
            resubmission: {
                versionNumber: number;
                /** Format: date-time */
                dueAt: string;
            } | null;
            /** @description Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045) */
            rowVersion: number | null;
        };
        TaskVersionGradingInput: {
            /**
             * @description Sürümün puan sonucu (core `scoreResolution`): puanlanmadı, puan bekliyor, iki puan arasında birden fazla bant fark (DOM-BEC-024) veya kesinleşti
             * @enum {string}
             */
            status: "unscored" | "pending" | "disagreement" | "settled";
            /** @description `pending` iken beklenen puan; değilse `null` */
            missing: ("first" | "second") | null;
            /** @description Sürüm ikinci puanlama isteğinin (örneklem veya elle) kapsamında mı */
            secondRatingRequested: boolean;
            /** @description Uyuşmazlık kriterleri; bantlar yine yalnız kendi puanlayıcısına görünür. Son puan koordinatör rolüyle gelecek (F4b3b2b); o zamana kadar sonuç kursiyere kapalıdır */
            disagreementCriterionIds: string[];
            /** @description Puanlamanın son anı (core `gradingDueAt`; son teslim + 7 gün). Örneklemli görevde süre örneklemin seçildiği andan başlar; örneklem seçilmeden `null` (süre işlemez) */
            dueAt: string | null;
            /** @description Puanlama süresi aşıldı mı (core `gradingOverdue`); süre yokken `false` */
            overdue: boolean;
        };
        TaskAppealInput: {
            /** Format: uuid */
            id: string;
            /** @description İtiraz gerekçesi */
            reason: string;
            /** Format: date-time */
            filedAt: string;
            /** @description Karar; beklerken `null` */
            outcome: ("upheld" | "rejected") | null;
            decidedAt: string | null;
            /** @description Karar gerekçesi */
            decisionReason: string | null;
        };
        TaskSubmissionDetailInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            /**
             * @description Son sürüme göre teslim durumu (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "submitted" | "late" | "not_submitted";
            versionCount: number;
            latestVersion: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCountInput"] | null;
                score: components["schemas"]["TaskScoreBriefInput"] | null;
            } | null;
            /** @description Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040) */
            resubmission: {
                versionNumber: number;
                /** Format: date-time */
                dueAt: string;
            } | null;
            /** @description Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045) */
            rowVersion: number | null;
            /** @description Değişmez sürümler, eskiden yeniye (DOM-BEC-040); taslak hiç dönmez */
            versions: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCountInput"] | null;
                /** @description Gönderilen metin; değişmez */
                body: string | null;
                score: components["schemas"]["TaskScoreInput"] | null;
                grading: components["schemas"]["TaskVersionGradingInput"] | null;
                /** @description İtirazın son anı (core `appealDeadline`: duyurudan sonra 5 iş günü, Europe/Istanbul gün sonu); yalnız değerlendirme türünde ve sonuç duyurulduysa, kursiyer ve veliye duyurudan önce `null` */
                appealDeadline: string | null;
                appeal: components["schemas"]["TaskAppealInput"] | null;
            }[];
            /** @description Yeni sürüm hakkı (core `versionAllowance`) */
            allowance: {
                limit: number;
                used: number;
                remaining: number;
                resubmissionOpen: boolean;
                canSubmit: boolean;
                /** @description `canSubmit: false` ise neden. Kursiyer ve veli geri bildirimi açılmamış puanı görmez: hak, son sürüm puanlanmamış gibi hesaplanır (DOM-BEC-045); onlara `locked` yalnız sıradaki sürümün teslim penceresi kapandığında döner */
                blockedBy: ("limit" | "graded" | "locked") | null;
            } | null;
        };
        TaskDraftInput: {
            /** Format: uuid */
            assignmentId: string;
            body: string;
            /** @description Taslağın iyimser kilit sürümü; sonraki kayıtta `If-Match` olarak gönderilir */
            revision: number;
            /** Format: date-time */
            savedAt: string;
            wordCount: components["schemas"]["TaskWordCountInput"] | null;
        };
        GradingQueueItemInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            /**
             * @description Son sürüme göre teslim durumu (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "submitted" | "late" | "not_submitted";
            versionCount: number;
            latestVersion: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCountInput"] | null;
                score: components["schemas"]["TaskScoreBriefInput"] | null;
            } | null;
            /** @description Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040) */
            resubmission: {
                versionNumber: number;
                /** Format: date-time */
                dueAt: string;
            } | null;
            /** @description Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045) */
            rowVersion: number | null;
            grading: {
                /** @description Son sürümün beklediği puanlar; kişinin puanladığı bekleyen sürüm kuyrukta yoktur. Uyuşmazlıkta boş */
                awaiting: ("first" | "second")[];
                /** @description İki puan uyuşmuyor, koordinatörün son puanı bekleniyor (DOM-BEC-024); yalnız iki puan da verildikten sonra `true` */
                awaitingResolution: boolean;
                /** @description Örneklemli görevde örneklem henüz seçilmedi; ilk puan örneklemden sonra verilir. Son tarihsiz görevde örneklem yoktur, `false` */
                samplePending: boolean;
                /** @description Puanlamanın son anı (core `gradingDueAt`); örneklemli görevde örneklem anından başlar, örneklem seçilmeden `null` */
                dueAt: string | null;
                /** @description Puanlama süresi aşıldı mı (core `gradingOverdue`); süre yokken `false` */
                overdue: boolean;
            };
        };
        SecondRatingSampleInput: {
            /** Format: uuid */
            assignmentId: string;
            /** Format: date-time */
            sampledAt: string;
            percent: number;
            /** @description Örneklem havuzu: sürümü olan teslimler */
            submissionCount: number;
            /** @description İkinci puanlanacak teslimler: oranın yukarı yuvarlanmışı, en az bir */
            submissionIds: string[];
            /** @description Atamanın yeni satır sürümü */
            rowVersion: number;
        };
        ErrorResponse: {
            /** @description Kararlı, İngilizce, snake_case hata kodu */
            code: string;
            /** @description Kullanıcıya gösterilebilir Türkçe mesaj */
            message: string;
            /** @description Alan düzeyindeki hatalar: 400 doğrulama ve alan yolu bilinen iş kuralı hataları (422/409/403) */
            issues?: {
                path: (string | number)[];
                code: string;
                message: string;
            }[];
            requestId: string;
        };
        PageMeta: {
            /** @description Sayfa numarası (1’den başlar) */
            page: number;
            /** @description Sayfa boyutu */
            pageSize: number;
            /** @description Filtre uygulanmış toplam kayıt sayısı */
            total: number;
        };
        CollectionItemJoined: {
            /** @description Kaydın öğrencisinin adı */
            studentName?: string;
            /** @description Kaydın öğrencisinin okul numarası; aktör öğrencinin kaydını okuyabiliyorsa ve numara kayıtlıysa gelir */
            studentNumber?: string;
            /** @description Kaydın sınıfının adı; kayıtta sınıf yoksa öğrencinin güncel sınıfı */
            className?: string;
            /** @description Kaydın kampüsünün adı */
            branchName?: string;
        };
        CollectionItem: {
            /** @description Kayıt kimliği */
            id: string;
            /** @description Kayıt sürümü; sonraki yazmada iyimser kilit için geri gönderilir */
            version: number;
            /**
             * Format: date-time
             * @description Kaydın sunucuda oluştuğu an (UTC; kayıt kolonu)
             */
            createdAt: string;
            /**
             * Format: date-time
             * @description Kaydın sunucuda son değiştiği an (UTC; kayıt kolonu)
             */
            updatedAt: string;
            /** @description Arşivlendiği an; arşivde değilse `null` */
            archivedAt: string | null;
            /** @description school-core kaydı; rolün göremediği alanlar çıkarılmıştır. İçindeki `createdAt`/`updatedAt` core iş alanıdır, sistem zamanı üst alanlardır */
            record: {
                [key: string]: unknown;
            };
            /** @description Bağlı kayıtların adları (yalnız bağlı alanı tanımlı koleksiyonlarda: öğrenciye bağlı kayıtlar `studentName`/`studentNumber`/`className`, sınıfa bağlı kayıtlar `className`, kampüse bağlı kayıtlar `branchName`). Bağlı kayıt aktörün okuyabildiği kayıtsa ad döner; kapsam dışı kaydın adı yoktur (alan eksik kalır) */
            joined?: components["schemas"]["CollectionItemJoined"];
        };
        CollectionCountGroup: {
            /** @description Grup değeri; alanı olmayan veya skaler olmayan değerli kayıtlar `null` grubundadır */
            value: string | number | boolean | null;
            /** @description Gruptaki kayıt sayısı */
            count: number;
            /** @description Yalnız `sum` istendiğinde: gruptaki değerlerin toplamı (`amount` kuruş) */
            sum?: number;
        };
        CollectionCountsMeta: {
            /** @description Süzgeçten geçen toplam kayıt sayısı */
            total: number;
            /** @description Yalnız `sum` istendiğinde: bütün grupların toplamı */
            sum?: number;
        };
        CommandResult: {
            /** @description İşlemin konusu; yalnız toplu işlemlerde `null` */
            entity: {
                /** @description İşlemin konusu olan kaydın koleksiyonu */
                collection: string;
                /** @description İşlemin konusu olan kaydın kimliği (yeni kayıtta üretilen) */
                id: string;
            } | null;
            /** @description Değişen kayıt sayıları (yalnız sıra değişikliği sayılmaz) */
            changes: {
                inserted: number;
                updated: number;
                archived: number;
                restored: number;
            };
            /** @description Yazılan kayıtlar; güncel veri koleksiyon okuma uçlarından alınır */
            records: {
                /** @description school-core State koleksiyonu */
                collection: string;
                id: string;
                /** @description Kaydın yeni sürümü (`If-Match` için) */
                version: number;
                /** @enum {string} */
                change: "insert" | "update" | "archive" | "restore" | "move";
            }[];
        };
        TutoringPlanPreview: {
            /** @description Çözümlenmiş plan girdisi */
            input: {
                examId: string;
                threshold: number;
                fromDate: string;
                toDate: string;
                duration: number;
                maxGroupSize: number;
                branchId: string;
                subjectId: string;
            };
            /** @description Önerilen etütler */
            sessions: {
                examId: string;
                branchId: string;
                grade: number;
                subjectId: string;
                /** @description Eksik kazanım */
                topic: string;
                studentIds: string[];
                scores: {
                    studentId: string;
                    percent: number | null;
                }[];
                teacherId: string;
                /** @description Başlangıç anı, ISO 8601 UTC */
                date: string;
                /** @description Dakika */
                duration: number;
                room: string;
                roomClassId: string;
                /** @description Grup kapasitesi: en küçük(grup üst sınırı, derslik kapasitesi) */
                capacity: number;
            }[];
            /** @description Yerleşemeyen gruplar ve nedeni: kapasite, öğretmen, derslik, uygunluk veya çakışma uyarısı */
            unresolved: {
                examId: string;
                branchId: string;
                grade: number;
                subjectId: string;
                /** @description Eksik kazanım */
                topic: string;
                studentIds: string[];
                scores: {
                    studentId: string;
                    percent: number | null;
                }[];
                reason: string;
            }[];
            /** @description Zaten planlanmış veya tamamlanmış etütle karşılanan öğrenci/kazanımlar */
            covered: {
                studentId: string;
                topic: string;
                sessionId: string;
            }[];
            evaluatedStudents: number;
            summary: {
                sessionCount: number;
                plannedStudentCount: number;
                unresolvedGroupCount: number;
                unresolvedStudentCount: number;
                coveredCount: number;
            };
            /** @description Planın JSON metni; onay isteğinde `expectedPlan` olarak aynen geri gönderilir */
            expectedPlan: string;
        };
        EvaluationPreview: {
            rows: {
                examId: string;
                studentId: string;
                studentName: string;
                subjectId: string;
                booklet: string;
                profileId: string;
                keyRevision: number;
                correct: number;
                wrong: number;
                blank: number;
                multiple: number;
                cancelled: number;
                net: number;
                topicScores: {
                    topic: string;
                    total: number;
                    correct: number;
                    percent: number | null;
                }[];
                weakTopics: string[];
                /** @description Aynı sınav/öğrenci/ders sonucunun üzerine yazar */
                replaces: boolean;
            }[];
            summary: {
                rowCount: number;
                studentCount: number;
                replacesCount: number;
            };
            /** @description Önizlemenin SHA-256 özeti (hex); onay isteğinde `expectedDigest` olarak gönderilir */
            digest: string;
        };
        ConversationMessage: {
            id: string;
            text: string;
            /** @description `teacher`, `student` veya `parent` */
            sender: string;
            /** @description Gönderim anı (ISO 8601 UTC) */
            sentAt: string;
            /** @description Karşı tarafın ilk görme anı (DOM-ILT-024) */
            readAt: string | null;
            /** @description Mesaj okuyan tarafın mı; yöneticide her zaman `false` */
            fromMe: boolean;
        };
        ConversationSummary: {
            id: string;
            studentId: string;
            teacherId: string;
            /** @description `student` veya `parent` */
            audience: string;
            /** @description Veli yazışmasında velinin kullanıcı kimliği (DOM-ILT-010); eski kayıtta `null` */
            parentUserId: string | null;
            messageCount: number;
            /** @description Son mesaj; yöneticide `null` */
            lastMessage: components["schemas"]["ConversationMessage"] | null;
            /** @description Karşı tarafın okunmamış mesajları */
            unreadCount: number;
            /** @description Öğretmen görünümünde yanıt bekleyen yazışma */
            awaitingReply: {
                since: string;
                /** @description İlk iş günü sonu (DOM-ILT-013) */
                dueAt: string;
                overdue: boolean;
            } | null;
        };
        DashboardStatusTotal: {
            count: number;
            /** @description Kuruş */
            amount: number;
        };
        DashboardInvoiceSummary: {
            /** @description Taksit sayısı */
            total: number;
            /** @description Ödeme planı toplamı (kuruş) */
            amount: number;
            /** @description Gecikmiş */
            overdue: components["schemas"]["DashboardStatusTotal"];
            /** @description Yaklaşan */
            upcoming: components["schemas"]["DashboardStatusTotal"];
            /** @description Ödendi */
            paid: components["schemas"]["DashboardStatusTotal"];
        };
        DashboardAttendanceCounts: {
            present: number;
            absent: number;
            late: number;
            excused: number;
            total: number;
        };
        DashboardInvoiceRow: {
            id: string;
            /** @description Bağlı öğrenci adı; kapsam dışında yok */
            studentName?: string;
            installment?: number;
            /** @description Kuruş */
            amount?: number;
            /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
            dueDate?: string;
            /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
            paidAt?: string;
        };
        DashboardAdmin: {
            /** @constant */
            role: "yonetici";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            students: {
                active: number;
                archived: number;
            };
            classes: {
                active: number;
                /** @description Aktif sınıfı olan kampüs sayısı */
                campusCount: number;
            };
            teachers: {
                active: number;
            };
            /** @description `finance` modülü kapalıysa `null` */
            finance: {
                /** @description Taksit durumu dağılımı (core `invoiceStatus`, isteğin Istanbul günü) */
                invoices: components["schemas"]["DashboardInvoiceSummary"];
                /** @description Bugün (`paidAt` günü) ödenen taksitler */
                collectedToday: components["schemas"]["DashboardStatusTotal"];
                monthlyCollection: {
                    /** @description Son 6 ayda ödenen taksit */
                    count: number;
                    /** @description Kuruş */
                    amount: number;
                    /** @description Eskiden yeniye 6 ay (`paidAt:month`); kaydı olmayan ay sıfır */
                    months: {
                        /** @description `YYYY-MM` */
                        month: string;
                        count: number;
                        /** @description Kuruş */
                        amount: number;
                    }[];
                };
            } | null;
            /** @description Bugünkü yoklama; `academic` modülü kapalıysa `null` */
            attendanceToday: components["schemas"]["DashboardAttendanceCounts"] | null;
            /** @description En son eklenen 5 aktif öğrenci */
            recentStudents: {
                id: string;
                name: string;
                number?: string;
                className?: string;
            }[];
            /** @description Aktif kampüs başına aktif öğrenci ve aktif sınıf kontenjanı */
            campuses: {
                id: string;
                name: string;
                students: number;
                capacity: number;
            }[];
        };
        DashboardFrontDesk: {
            /** @constant */
            role: "onburo";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            /** @description `finance` modülü kapalıysa `null` */
            finance: {
                /** @description Taksit durumu dağılımı (core `invoiceStatus`, isteğin Istanbul günü) */
                invoices: components["schemas"]["DashboardInvoiceSummary"];
                /** @description Taksit sayısı ve tutarı (kuruş) */
                collectedToday: components["schemas"]["DashboardStatusTotal"];
                /** @description Vadesi en eski 5 gecikmiş taksit */
                overdue: components["schemas"]["DashboardInvoiceRow"][];
                /** @description Vadesi en yakın 5 yaklaşan taksit */
                upcoming: components["schemas"]["DashboardInvoiceRow"][];
                /** @description En son kaydedilen 5 ödeme */
                recentPayments: components["schemas"]["DashboardInvoiceRow"][];
            } | null;
            /** @description `crm` modülü kapalıysa `null` */
            prospects: {
                total: number;
                /** @description Aşama başına aday; aşamasız `null` sonda */
                stages: {
                    stage: string | null;
                    count: number;
                }[];
            } | null;
        };
        DashboardTeacher: {
            /** @constant */
            role: "ogretmen";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            students: {
                active: number;
            };
            classes: {
                active: number;
            };
            /** @description `academic` modülü kapalıysa `null` */
            academic: {
                /** @description Yoklama durum sayıları; `total` bütün kayıtlar */
                attendanceToday: components["schemas"]["DashboardAttendanceCounts"];
                lessons: {
                    /** @description Bugünkü iptal edilmemiş ders */
                    total: number;
                    /** @description Bugün iptal edilen ders */
                    cancelled: number;
                    items: {
                        id: string;
                        /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                        date: string;
                        title?: string;
                        subject?: string;
                        room?: string;
                        duration?: number;
                        className?: string;
                    }[];
                };
                /** @description Son 5 gelmedi/geç geldi kaydı */
                recentAbsences: {
                    id: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    date: string;
                    status: string;
                    studentName?: string;
                    className?: string;
                }[];
            } | null;
            /** @description `learning` modülü kapalıysa `null` */
            learning: {
                /** @description Notlanmamış teslim */
                ungraded: number;
                /** @description Son teslim günü bugün veya sonrası olan en yakın 5 ödev */
                homework: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    dueDate: string;
                    className?: string;
                    delivered: number;
                    /** @description Ödevin sınıfındaki aktif öğrenci */
                    expected: number;
                }[];
            } | null;
        };
        DashboardStudent: {
            /** @constant */
            role: "ogrenci";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            student: {
                id: string;
                name: string;
            };
            /** @description `academic` modülü kapalıysa `null` */
            academic: {
                grades: {
                    count: number;
                    scoreSum: number;
                    subjects: {
                        subjectId: string;
                        name?: string;
                        count: number;
                        scoreSum: number;
                    }[];
                };
                /** @description Yoklama durum sayıları; `total` bütün kayıtlar */
                attendance: components["schemas"]["DashboardAttendanceCounts"];
                /** @description Son 8 hafta (pazartesi–pazar), eskiden yeniye */
                weeklyAbsences: {
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    from: string;
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    to: string;
                    absent: number;
                }[];
                recentGrades: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    date: string;
                    score?: number;
                }[];
            } | null;
            /** @description `learning` modülü kapalıysa `null` */
            learning: {
                submitted: number;
                /** @description Sınıfa verilen ödev */
                assigned: number;
                homework: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    dueDate: string;
                    /** @description Teslim yoksa `null`; `score` `null` ise notlanmamış */
                    submission: {
                        score: number | null;
                    } | null;
                }[];
            } | null;
        };
        DashboardParent: {
            /** @constant */
            role: "veli";
            /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
            today: string;
            student: {
                id: string;
                name: string;
            };
            /** @description `academic` modülü kapalıysa `null` */
            academic: {
                grades: {
                    count: number;
                    scoreSum: number;
                    subjects: {
                        subjectId: string;
                        name?: string;
                        count: number;
                        scoreSum: number;
                    }[];
                };
                /** @description Yoklama durum sayıları; `total` bütün kayıtlar */
                attendance: components["schemas"]["DashboardAttendanceCounts"];
                /** @description Son 8 hafta (pazartesi–pazar), eskiden yeniye */
                weeklyAbsences: {
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    from: string;
                    /** @description Europe/Istanbul günü (`YYYY-MM-DD`) */
                    to: string;
                    absent: number;
                }[];
                recentGrades: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    date: string;
                    score?: number;
                }[];
            } | null;
            /** @description `learning` modülü kapalıysa `null` */
            learning: {
                submitted: number;
                /** @description Sınıfa verilen ödev */
                assigned: number;
                homework: {
                    id: string;
                    title: string;
                    /** @description Gün (`YYYY-MM-DD`) veya an (ISO 8601 UTC); kaydın değeri */
                    dueDate: string;
                    /** @description Teslim yoksa `null`; `score` `null` ise notlanmamış */
                    submission: {
                        score: number | null;
                    } | null;
                }[];
            } | null;
            /** @description Seçili çocuğun bakiyesi; `finance` modülü kapalıysa `null` */
            balance: {
                /** @description Gecikmiş + yaklaşan taksit toplamı */
                outstanding: number;
                overdueCount: number;
            } | null;
        };
        Dashboard: components["schemas"]["DashboardAdmin"] | components["schemas"]["DashboardFrontDesk"] | components["schemas"]["DashboardTeacher"] | components["schemas"]["DashboardStudent"] | components["schemas"]["DashboardParent"];
        FileUploadBody: {
            /**
             * @description Dosyanın amacı; tür ve boyut sınırı amaca göredir (ADR 0003 karar 3)
             * @enum {string}
             */
            purpose: "submission" | "material" | "question_image" | "listening_audio" | "speaking_recording" | "document";
            /**
             * Format: binary
             * @description Tek dosya; alan adı `file`
             */
            file: string;
        };
        File: {
            /** Format: uuid */
            id: string;
            /**
             * @description Dosyanın amacı; tür ve boyut sınırı amaca göredir (ADR 0003 karar 3)
             * @enum {string}
             */
            purpose: "submission" | "material" | "question_image" | "listening_audio" | "speaking_recording" | "document";
            /**
             * @description `pending` yüklendi, denetim bekliyor; `processing` taranıyor/dönüştürülüyor (bağlantı verilmez); `ready` kullanıma hazır; `rejected`/`deleted` görünmez
             * @enum {string}
             */
            status: "pending" | "processing" | "ready" | "rejected" | "deleted";
            /** @description İçerikten tespit edilen kanonik MIME türü */
            contentType: string;
            byteSize: number;
            sha256: string;
            /** @description Sunucuda ölçülen süre; yoksa `null` */
            durationMs: number | null;
            /** @description Temizlenmiş özgün ad; yalnız gösterim için */
            originalName: string | null;
            /** @description Dosya bir kayda bağlandı mı (ADR 0003 karar 5) */
            attached: boolean;
            /** Format: date-time */
            createdAt: string;
            rowVersion: number;
        };
        FileUrl: {
            /**
             * Format: uri
             * @description Kısa ömürlü imzalı GET bağlantısı
             */
            url: string;
            /**
             * Format: date-time
             * @description Bağlantının geçerlilik sonu
             */
            expiresAt: string;
        };
        Health: {
            /**
             * @description Sunucu çalışıyor
             * @constant
             */
            status: "ok";
            /**
             * @description Veritabanı bağlantısı sağlıklı
             * @constant
             */
            database: "ok";
        };
        MembershipLink: {
            /**
             * @description Bağlantı türü: öğrenci kendi kaydı, veli çocuğu, öğretmen kaydı
             * @enum {string}
             */
            kind: "student" | "child" | "teacher";
            /** @description school-core kayıt kimliği */
            recordId: string;
        };
        Me: {
            user: {
                id: string;
                /** @description Ad soyad */
                name: string;
                /** @description Giriş e-postası */
                email: string;
            };
            /** @description Oturumun etkin kurumu; üyelik yoksa `null` */
            activeInstitution: {
                id: string;
                name: string;
                slug: string;
                /**
                 * @description Kurum türü: `school` ders + kazanım, `language_school` CEFR + beceri
                 * @enum {string}
                 */
                type: "school" | "language_school";
                /** @description Modül anahtarı → açık mı. school-core modül kaydındaki her modül listelenir. Kurum türünde bulunmayan modül her zaman `false`tır ve uçları 404 döner (DOM-YTK-012); kurumun kapattığı modülün uçları 403 `module_disabled` */
                enabledModules: {
                    [key: string]: boolean;
                };
                /** @description Etkin eğitim-öğretim yılının (dönemin) başlangıç yılı: 2026 → 2026–2027. Kurum ayarı yoksa `null` */
                academicYear: number | null;
            } | null;
            /** @description Etkin kurumdaki üyelik ve school-core kayıt bağlantıları */
            activeMembership: {
                id: string;
                /** @enum {string} */
                role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
                links: components["schemas"]["MembershipLink"][];
            } | null;
            /** @description Kullanıcının bütün kurum üyelikleri (kurum değiştirme için) */
            memberships: {
                id: string;
                institutionId: string;
                institutionName: string;
                /**
                 * @description Kurum türü: `school` ders + kazanım, `language_school` CEFR + beceri
                 * @enum {string}
                 */
                institutionType: "school" | "language_school";
                /** @enum {string} */
                role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            }[];
        };
        AuditEventActor: {
            userId: string;
            /** @description Kullanıcının görünen adı; hesap yoksa `null` */
            name: string | null;
            /** @description İşlem anındaki rol; kayıtlı değilse üyelik rolü */
            role: ("yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli") | null;
        };
        AuditEvent: {
            id: string;
            /**
             * Format: date-time
             * @description İşlemin anı (UTC)
             */
            createdAt: string;
            /** @description İşlem adı (ör. `module.set`, `workflow.goal`) */
            action: string;
            /** @description Varlık türü; rehberlik kayıtlarında `guidanceCases` */
            entityType: string | null;
            /** @description Varlık kimliği; rehberlik kayıtlarında (DOM-YTK-020) hiçbir zaman dönmez */
            entityId: string | null;
            /** @description Yapan kişi; sistem olaylarında `null` */
            actor: components["schemas"]["AuditEventActor"] | null;
            /** @description Değişen alan adları (değerler hiçbir zaman dönmez); rehberlikte boştur */
            fields: string[];
            /** @description Gerekçeli hassas okumanın gerekçesi (DOM-YTK-052); diğer kayıtlarda `null` */
            reason: string | null;
        };
        InstitutionMemberLink: {
            /**
             * @description Bağlantı türü: öğrenci, çocuk (veli) veya öğretmen
             * @enum {string}
             */
            kind: "student" | "child" | "teacher";
            /** @description Bağlı kişinin adı; kayıt yoksa `null` */
            name: string | null;
        };
        InstitutionMember: {
            /** @description Üyelik kimliği */
            id: string;
            userId: string;
            /** @description Görünen ad */
            name: string;
            /** @description Giriş e-postası; yalnız yöneticiye döner */
            email: string;
            /** @enum {string} */
            role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            /** @enum {string} */
            status: "active" | "passive";
            /** @description Bağlı öğrenci, çocuk veya öğretmen */
            links: components["schemas"]["InstitutionMemberLink"][];
            /**
             * Format: date-time
             * @description Üyeliğin açıldığı an (UTC)
             */
            createdAt: string;
        };
        InstitutionMembership: {
            /** @description Üyelik kimliği */
            id: string;
            userId: string;
            /** @description Ad soyad */
            name: string;
            /** @description Giriş e-postası */
            email: string;
            /** @enum {string} */
            role: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            /**
             * Format: date-time
             * @description Üyeliğin açıldığı an (UTC)
             */
            createdAt: string;
        };
        ModuleSettings: {
            /** @description Kurum ayar sürümü (`If-Match` için) */
            version: number;
            /** @description Kurum türünde bulunan modüller; türde olmayan modül listelenmez */
            modules: {
                /** @description Modül anahtarı */
                key: string;
                /** @description Modül açık mı */
                enabled: boolean;
            }[];
        };
        ModuleChange: {
            moduleKey: string;
            enabled: boolean;
            /** @description Güncel etkin modül haritası (`/me` `enabledModules` ile aynı) */
            enabledModules: {
                [key: string]: boolean;
            };
            /** @description Yeni kurum ayar sürümü */
            version: number;
        };
        ResourceTags: {
            subjectId: string | null;
            gradeLevels: number[];
            cefrLevel: ("Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2") | null;
            primarySkill: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use") | null;
            skills: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use" | "vocabulary" | "grammar" | "pronunciation")[];
            activityMode: ("reception" | "production" | "interaction" | "mediation") | null;
            interactionChannel: ("spoken" | "written" | "online") | null;
            mediation: {
                /** @enum {string} */
                sourceSkill: "reading" | "listening" | "writing" | "speaking";
                /** @enum {string} */
                targetSkill: "reading" | "listening" | "writing" | "speaking";
            } | null;
            durationMinutes: number | null;
            difficulty: ("easy" | "medium" | "hard") | null;
            outcomes: {
                outcomeId: string;
                /** @enum {string} */
                outcomeSource: "platform" | "institution";
            }[];
        };
        ResourceAttribution: {
            work: string;
            author: string;
            source: string;
            year: number | null;
        };
        ResourceVersionSummary: {
            /** Format: uuid */
            id: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "in_review" | "published" | "rejected" | "archived" | "removed";
            title: string;
            authorUserId: string;
            tags: components["schemas"]["ResourceTags"];
            /** @description Lisans türü; seçilmemişse `null` */
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            /** @description Arşivlendiği an; arşivli sürüm geçmişte okunur */
            archivedAt: string | null;
            removedAt: string | null;
        };
        ResourceVersion: {
            /** Format: uuid */
            id: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "in_review" | "published" | "rejected" | "archived" | "removed";
            title: string;
            authorUserId: string;
            tags: components["schemas"]["ResourceTags"];
            /** @description Lisans türü; seçilmemişse `null` */
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            /** @description Arşivlendiği an; arşivli sürüm geçmişte okunur */
            archivedAt: string | null;
            removedAt: string | null;
            /** @description Kaldırılan sürümde `null` (DOM-KYN-051) */
            content: {
                [key: string]: unknown;
            } | null;
            /** @description Cevap anahtarı (school-core `answerKeySchema`); yalnız personel */
            answerKey: {
                [key: string]: unknown;
            } | null;
            /** @description Lisans ayrıntısı (school-core `resourceLicenseSchema`); yalnız personel */
            license: {
                [key: string]: unknown;
            } | null;
            attributions: components["schemas"]["ResourceAttribution"][];
            submittedAt: string | null;
            reviewedByUserId: string | null;
            reviewedAt: string | null;
            rejectionReason: string | null;
            removalReason: string | null;
            /** @description İyimser kilit sürümü (`If-Match`) */
            rowVersion: number;
        };
        LearnerResourceVersion: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            title: string;
            /** @description Öğrenci görünümü: seçenekler kişiye sabit karıştırılır, dinleme görevinde döküm gizlidir */
            content: {
                [key: string]: unknown;
            };
            tags: components["schemas"]["ResourceTags"];
            attributions: components["schemas"]["ResourceAttribution"][];
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
        };
        StaffResource: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            ownerUserId: string;
            /** @enum {string} */
            shareScope: "private" | "students" | "classes" | "department" | "institution";
            /** @description Güncel yayındaki sürüm; hiç yayımlanmadıysa `null` */
            currentVersionId: string | null;
            /** @description Kopyalandığı sürüm */
            derivedFromVersionId: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            sharedStudentIds: string[];
            sharedClassIds: string[];
            /** @description Bütün sürümleri arşivlenince veya kaynak kaldırılınca dolar (DOM-KYN-051) */
            archivedAt: string | null;
            /** @description Kaynak satırının iyimser kilit sürümü (paylaşım ve kaldırmada `If-Match`) */
            rowVersion: number;
        };
        StaffResourceListItem: {
            /** @constant */
            view: "staff";
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            ownerUserId: string;
            /** @enum {string} */
            shareScope: "private" | "students" | "classes" | "department" | "institution";
            /** @description Güncel yayındaki sürüm; hiç yayımlanmadıysa `null` */
            currentVersionId: string | null;
            /** @description Kopyalandığı sürüm */
            derivedFromVersionId: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Okunabilir baş sürüm */
            version: components["schemas"]["ResourceVersionSummary"];
        };
        LearnerResourceListItem: {
            /** @constant */
            view: "learner";
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            version: {
                /** Format: uuid */
                id: string;
                title: string;
                tags: components["schemas"]["ResourceTags"];
                licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
            };
        };
        StaffResourceDetail: {
            /** @constant */
            view: "staff";
            resource: components["schemas"]["StaffResource"];
            /** @description Okunabilir sürümler, numaraya göre artan */
            versions: components["schemas"]["ResourceVersionSummary"][];
            head: components["schemas"]["ResourceVersion"];
            /** @description Açık sürümde (taslak, incelemede, reddedildi) yayım eksikleri; diğerlerinde boş */
            publicationIssues: {
                code: string;
                message: string;
                path: string[];
            }[];
        };
        LearnerResourceDetail: {
            /** @constant */
            view: "learner";
            resource: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            };
            version: components["schemas"]["LearnerResourceVersion"];
        };
        ResourceWriteResult: {
            resource: components["schemas"]["StaffResource"];
            version: components["schemas"]["ResourceVersion"];
        };
        ResourceShareResult: {
            resource: components["schemas"]["StaffResource"];
        };
        ResourceRemovalResult: {
            resource: components["schemas"]["StaffResource"];
            /** @description Kaldırılan sürümler */
            versionIds: string[];
            /** @description Bu sürümlerden türetilmiş kopyalar; yönetici ayrıca inceler (DOM-KYN-050) */
            affectedCopyIds: string[];
            /** @description Kaldırılan soruyu içeren quiz/alıştırma seti sürümleri */
            affectedContainerVersionIds: string[];
        };
        BookableSlot: {
            /** @description Uygunluk saati kimliği; talepte `slotId` olarak gönderilir */
            slotId: string;
            teacherId: string;
            teacherName: string;
            /** @description Başlangıç, ISO 8601 UTC */
            startsAt: string;
            /** @description Dakika */
            duration: number;
            /** @description Öğretmenin kampüsü; kayıt yoksa yok */
            campusName?: string;
            /** @description Öğretmenin öğrencinin sınıfında verdiği dersler, ada göre sıralı */
            subjectNames: string[];
            /** @description `false`: saat dolu ("Dolu"); neden hiçbir durumda bildirilmez (DOM-ILT-073) */
            available: boolean;
        };
        EnrollProspectResult: {
            /** @description İşlemin konusu; yalnız toplu işlemlerde `null` */
            entity: {
                /** @description İşlemin konusu olan kaydın koleksiyonu */
                collection: string;
                /** @description İşlemin konusu olan kaydın kimliği (yeni kayıtta üretilen) */
                id: string;
            } | null;
            /** @description Değişen kayıt sayıları (yalnız sıra değişikliği sayılmaz) */
            changes: {
                inserted: number;
                updated: number;
                archived: number;
                restored: number;
            };
            /** @description Yazılan kayıtlar; güncel veri koleksiyon okuma uçlarından alınır */
            records: {
                /** @description school-core State koleksiyonu */
                collection: string;
                id: string;
                /** @description Kaydın yeni sürümü (`If-Match` için) */
                version: number;
                /** @enum {string} */
                change: "insert" | "update" | "archive" | "restore" | "move";
            }[];
            /** @description Oluşturulan sözleşmenin kimliği (PDF ve okuma uçları için) */
            contractId: string;
        };
        Rubric: {
            /** Format: uuid */
            id: string;
            ownerUserId: string;
            /** Format: date-time */
            createdAt: string;
            /** @description Kişi rubriği düzenleyebilir mi (core `canManageRubric`: sahip veya yönetici) */
            canManage: boolean;
        };
        RubricVersionSummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            rubricId: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "published" | "archived";
            title: string;
            /** @enum {string} */
            kind: "analytic" | "holistic";
            /** @enum {string} */
            skill: "writing" | "speaking" | "mediation";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            archivedAt: string | null;
            /** @description Sürüm satırının iyimser kilit sürümü (düzenleme, yayım ve arşivde `If-Match`) */
            rowVersion: number;
        };
        RubricVersion: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            rubricId: string;
            versionNumber: number;
            /** @enum {string} */
            status: "draft" | "published" | "archived";
            title: string;
            /** @enum {string} */
            kind: "analytic" | "holistic";
            /** @enum {string} */
            skill: "writing" | "speaking" | "mediation";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedAt: string | null;
            archivedAt: string | null;
            /** @description Sürüm satırının iyimser kilit sürümü (düzenleme, yayım ve arşivde `If-Match`) */
            rowVersion: number;
            criteria: {
                id: string;
                /** @description CEFR-CV niteliksel yönü; bütüncül rubrikte `overall` */
                aspect: string;
                weight: number;
                bands: {
                    band: number;
                    /** @description Kurumun kendi cümlesi (DOM-BEC-004) */
                    description: string;
                    alignment: {
                        /** @constant */
                        kind: "cefr";
                        scale: string;
                        /** @enum {string} */
                        level: "Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2";
                        index: number;
                    } | {
                        /** @constant */
                        kind: "outcome";
                        outcomeId: string;
                        /** @enum {string} */
                        outcomeSource: "platform" | "institution";
                    };
                }[];
            }[];
            /** @description Sürümün sabitlendiği atama ve verilmiş puan sayısı; kullanılmış sürüm değişmez (DOM-BEC-022) */
            usage: {
                assignmentCount: number;
                scoreCount: number;
            };
        };
        RubricListItem: {
            rubric: components["schemas"]["Rubric"];
            /** @description En yüksek numaralı sürüm */
            head: components["schemas"]["RubricVersionSummary"];
            /** @description Yayındaki sürüm; yeni atamada yalnız bu kullanılır (DOM-BEC-022) */
            publishedVersionId: string | null;
        };
        RubricDetail: {
            rubric: components["schemas"]["Rubric"];
            /** @description Bütün sürümler, numaraya göre artan */
            versions: components["schemas"]["RubricVersion"][];
        };
        RubricWriteResult: {
            rubric: components["schemas"]["Rubric"];
            version: components["schemas"]["RubricVersion"];
        };
        TaskAssignmentStaff: {
            /** @constant */
            view: "staff";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü (DOM-KYN-032)
             */
            resourceVersionId: string;
            /** @description Atanan sürümün başlığı */
            title: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            /**
             * @description Otomatik puanlı veya öğretmen puanlı
             * @enum {string}
             */
            scoringMode: "auto" | "teacher";
            /** @enum {string} */
            kind: "evaluation" | "practice";
            /** @description Deneme hakkı ve sayım politikası (DOM-BEC-042) */
            attempts: {
                /** @constant */
                kind: "evaluation";
                /** @default 1 */
                maxAttempts: number;
                /**
                 * @default first
                 * @enum {string}
                 */
                countPolicy: "first" | "highest";
            } | {
                /** @constant */
                kind: "practice";
            };
            /** @description Son teslim ve geç kabul (DOM-BEC-044) */
            deadline: {
                /** @default null */
                dueAt: string | null;
                /** @default 0 */
                lateAcceptanceDays: number;
            };
            timeLimitMinutes: number | null;
            /** @description Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005) */
            listeningPlays: (1 | 2) | null;
            showTranscript: boolean;
            /** @description Öğretmen puanlı görevin teslim ayarı */
            submission: ({
                /** @constant */
                submissionKind: "text";
                /** @default 3 */
                maxVersions: number;
                /** @default null */
                minWords: number | null;
                /** @default null */
                maxWords: number | null;
            } | {
                /** @constant */
                submissionKind: "file";
                /** @default 3 */
                maxVersions: number;
            } | {
                /** @constant */
                submissionKind: "audio";
                /** @default 3 */
                maxVersions: number;
                /** @default 1 */
                speakingAttempts: number;
                /** @default 0 */
                preparationSeconds: number;
                speakingSeconds: number;
            }) | null;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: uuid
             * @description Puanlamanın okunduğu sürüm; başta içerik sürümüdür, yalnız yeniden puanlama değiştirir
             */
            scoringVersionId: string;
            /** @description Sabitlenen yayındaki rubrik sürümü (DOM-BEC-022) */
            rubricVersionId: string | null;
            highStakes: boolean;
            secondRatingPercent: number;
            /** @description İkinci puanlama örnekleminin seçildiği an (DOM-BEC-024); seçilmediyse veya örneklem yoksa `null`. Yalnız personel görür */
            secondRatingSampledAt: string | null;
            assignedByUserId: string;
            /** @description Sınıf/şube, dil grubu veya öğrenci hedefleri */
            targets: {
                /** @enum {string} */
                kind: "class" | "group" | "student";
                id: string;
            }[];
            /** Format: date-time */
            updatedAt: string;
            archivedAt: string | null;
            /** @description Atama satırının iyimser kilit sürümü (değişiklikte `If-Match`) */
            rowVersion: number;
        };
        TaskAssignmentLearnerProgress: {
            learnerId: string;
            /**
             * @description Başlanmadı/teslim bekleniyor, süren deneme, zamanında veya geç tamamlandı/teslim edildi, pencere kapandı ve yapılmadı (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "in_progress" | "submitted" | "late" | "not_submitted";
            /** @description Öğretmen yeniden teslim istedi ve yeni sürüm henüz gelmedi (DOM-BEC-040) */
            resubmissionRequested: boolean;
            /** @description Otomatik puanlı: süren deneme, yoksa gösterilen (sayılan veya son) deneme */
            attemptId: string | null;
            /** @description Öğretmen puanlı: teslim kaydı */
            submissionId: string | null;
            /** @description Gösterilen denemenin tamamlandığı veya son sürümün gönderildiği an */
            lastActivityAt: string | null;
            /** @description Kullanılan deneme veya gönderilen sürüm sayısı */
            used: number;
            /** @description Deneme veya sürüm hakkı; `null` sınırsız */
            limit: number | null;
            /** @description Kalan hak; `null` sınırsız */
            remaining: number | null;
            /** @description Şu an yeni deneme başlatılabilir veya yeni sürüm gönderilebilir */
            canAct: boolean;
            /** @description `canAct` değilse neden: süren deneme, içerik lisansı doldu (DOM-KYN-021), pencere kapandı, hak doldu, teslim değerlendirildi (yalnız geri bildirim açıldıysa) veya görev okunamıyor */
            blockedBy: ("in_progress" | "license_expired" | "locked" | "limit" | "graded" | "unavailable") | null;
            /** @description Açılmış puan: otomatik puanlıda gösterilen denemenin toplamı, öğretmen puanlıda geri bildirimi açılmış son sürümün rubrik toplamı (DOM-BEC-045) */
            score: {
                earned: number;
                possible: number;
                percent: number;
            } | null;
        };
        TaskAssignmentLearner: {
            /** @constant */
            view: "learner";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü (DOM-KYN-032)
             */
            resourceVersionId: string;
            /** @description Atanan sürümün başlığı */
            title: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            /**
             * @description Otomatik puanlı veya öğretmen puanlı
             * @enum {string}
             */
            scoringMode: "auto" | "teacher";
            /** @enum {string} */
            kind: "evaluation" | "practice";
            /** @description Deneme hakkı ve sayım politikası (DOM-BEC-042) */
            attempts: {
                /** @constant */
                kind: "evaluation";
                /** @default 1 */
                maxAttempts: number;
                /**
                 * @default first
                 * @enum {string}
                 */
                countPolicy: "first" | "highest";
            } | {
                /** @constant */
                kind: "practice";
            };
            /** @description Son teslim ve geç kabul (DOM-BEC-044) */
            deadline: {
                /** @default null */
                dueAt: string | null;
                /** @default 0 */
                lateAcceptanceDays: number;
            };
            timeLimitMinutes: number | null;
            /** @description Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005) */
            listeningPlays: (1 | 2) | null;
            showTranscript: boolean;
            /** @description Öğretmen puanlı görevin teslim ayarı */
            submission: ({
                /** @constant */
                submissionKind: "text";
                /** @default 3 */
                maxVersions: number;
                /** @default null */
                minWords: number | null;
                /** @default null */
                maxWords: number | null;
            } | {
                /** @constant */
                submissionKind: "file";
                /** @default 3 */
                maxVersions: number;
            } | {
                /** @constant */
                submissionKind: "audio";
                /** @default 3 */
                maxVersions: number;
                /** @default 1 */
                speakingAttempts: number;
                /** @default 0 */
                preparationSeconds: number;
                speakingSeconds: number;
            }) | null;
            /** Format: date-time */
            createdAt: string;
            /** @description Görevin hedeflediği kişinin kendisi veya velinin çocukları */
            learnerIds: string[];
            /** @description `learnerIds` sırasıyla her kişinin durumu */
            progress: components["schemas"]["TaskAssignmentLearnerProgress"][];
        };
        TaskAssignmentLearnerBody: {
            /** @constant */
            type: "text";
            body: string | null;
            fileId: string | null;
        } | {
            /** @constant */
            type: "worksheet";
            body: string | null;
            fileId: string | null;
        } | {
            /** @constant */
            type: "reading_passage";
            body: string;
        } | {
            /** @constant */
            type: "audio";
            /** @description Dosya kimliği */
            fileId: string;
            /** @description Dinleme görevinde atamanın `showTranscript` ayarına bağlıdır (DOM-KYN-003) */
            transcript: string | null;
            captionsVtt: string | null;
        } | {
            /** @constant */
            type: "video";
            /** @description Dosya kimliği */
            fileId: string;
            /** @description Dinleme görevinde atamanın `showTranscript` ayarına bağlıdır (DOM-KYN-003) */
            transcript: string | null;
            captionsVtt: string | null;
        } | {
            /** @constant */
            type: "file";
            /** @description Dosya kimliği */
            fileId: string;
        } | {
            /** @constant */
            type: "link";
            url: string;
            provider: string | null;
        } | {
            /** @constant */
            type: "book_reference";
            publisher: string;
            bookTitle: string;
            edition: string | null;
            isbn: string | null;
            pages: string;
            note: string | null;
        } | {
            /** @constant */
            type: "question";
            /** @description Soru sayısı; sorular denemede gelir */
            questionCount: number;
        } | {
            /** @constant */
            type: "quiz";
            /** @description Soru sayısı; sorular denemede gelir */
            questionCount: number;
        } | {
            /** @constant */
            type: "exercise_set";
            /** @description Soru sayısı; sorular denemede gelir */
            questionCount: number;
        } | {
            /** @constant */
            type: "homework_template";
            instructions: string;
            submissionKinds: ("file" | "text" | "audio")[];
        };
        TaskAssignmentLearnerContent: {
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü
             */
            versionId: string;
            title: string;
            body: components["schemas"]["TaskAssignmentLearnerBody"];
            /** @description Kaynak gösterimi (DOM-KYN-024) */
            attributions: components["schemas"]["ResourceAttribution"][];
            licenseKind: ("institution_original" | "contains_quotation" | "platform_derived" | "open_license" | "public_domain" | "licensed_publication" | "external_reference") | null;
        };
        TaskAssignmentLearnerDetail: {
            /** @constant */
            view: "learner";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            resourceId: string;
            /**
             * Format: uuid
             * @description Atamada sabitlenen içerik sürümü (DOM-KYN-032)
             */
            resourceVersionId: string;
            /** @description Atanan sürümün başlığı */
            title: string;
            /** @enum {string} */
            contentType: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
            /**
             * @description Otomatik puanlı veya öğretmen puanlı
             * @enum {string}
             */
            scoringMode: "auto" | "teacher";
            /** @enum {string} */
            kind: "evaluation" | "practice";
            /** @description Deneme hakkı ve sayım politikası (DOM-BEC-042) */
            attempts: {
                /** @constant */
                kind: "evaluation";
                /** @default 1 */
                maxAttempts: number;
                /**
                 * @default first
                 * @enum {string}
                 */
                countPolicy: "first" | "highest";
            } | {
                /** @constant */
                kind: "practice";
            };
            /** @description Son teslim ve geç kabul (DOM-BEC-044) */
            deadline: {
                /** @default null */
                dueAt: string | null;
                /** @default 0 */
                lateAcceptanceDays: number;
            };
            timeLimitMinutes: number | null;
            /** @description Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005) */
            listeningPlays: (1 | 2) | null;
            showTranscript: boolean;
            /** @description Öğretmen puanlı görevin teslim ayarı */
            submission: ({
                /** @constant */
                submissionKind: "text";
                /** @default 3 */
                maxVersions: number;
                /** @default null */
                minWords: number | null;
                /** @default null */
                maxWords: number | null;
            } | {
                /** @constant */
                submissionKind: "file";
                /** @default 3 */
                maxVersions: number;
            } | {
                /** @constant */
                submissionKind: "audio";
                /** @default 3 */
                maxVersions: number;
                /** @default 1 */
                speakingAttempts: number;
                /** @default 0 */
                preparationSeconds: number;
                speakingSeconds: number;
            }) | null;
            /** Format: date-time */
            createdAt: string;
            /** @description Görevin hedeflediği kişinin kendisi veya velinin çocukları */
            learnerIds: string[];
            /** @description `learnerIds` sırasıyla her kişinin durumu */
            progress: components["schemas"]["TaskAssignmentLearnerProgress"][];
            content: components["schemas"]["TaskAssignmentLearnerContent"] | null;
            /** @description `content` boşsa neden: lisans doldu ve süren iş yok (DOM-KYN-021) veya sürüm kaldırıldı/yayında değil */
            contentUnavailable: ("license_expired" | "unavailable") | null;
        };
        TaskAssignment: components["schemas"]["TaskAssignmentStaff"] | components["schemas"]["TaskAssignmentLearner"];
        TaskAssignmentDetail: components["schemas"]["TaskAssignmentStaff"] | components["schemas"]["TaskAssignmentLearnerDetail"];
        TaskAttemptItemScore: {
            questionVersionId: string;
            parts: number;
            correctParts: number;
            answered: boolean;
            points: number;
            earned: number;
        };
        TaskAttemptResult: {
            /** @description Kazanılan puan (iki ondalık) */
            earned: number;
            possible: number;
            /** @description 100 üzerinden puan */
            percent: number;
            /** @description Madde sonuçları; kursiyer ve veli yalnız anahtar açılınca görür (DOM-BEC-045) */
            items: components["schemas"]["TaskAttemptItemScore"][] | null;
            /** @description Doğru cevaplar ve açıklamalar; yalnız anahtar açılınca (DOM-BEC-045) */
            answerKey: {
                questionVersionId: string;
                answerKey: {
                    /** @constant */
                    questionType: "multiple_choice";
                    correctOptionId: string;
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    /** @enum {string} */
                    answer: "true" | "false" | "not_given";
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "matching";
                    pairs: {
                        promptId: string;
                        choiceId: string;
                    }[];
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    gaps: {
                        gapId: string;
                        accepted: unknown;
                    }[];
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "ordering";
                    order: string[];
                    explanation: string;
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    accepted: unknown;
                    explanation: string;
                };
            }[] | null;
        };
        TaskAttempt: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            attemptNumber: number;
            /**
             * @description Süren, teslim edilmiş veya süresi dolmuş (kaydedilmiş cevaplarla teslim sayılır)
             * @enum {string}
             */
            status: "in_progress" | "submitted" | "expired";
            /** Format: date-time */
            startedAt: string;
            /** @description Süre ve teslim kapanışından erken olanı; yoksa `null` */
            endsAt: string | null;
            remainingMs: number | null;
            completedAt: string | null;
            /** @description Süre dolduğu için kaydedilmiş cevaplarla teslim sayıldı */
            autoSubmitted: boolean;
            /** @description Son teslimden sonra, geç kabul süresinde tamamlandı */
            late: boolean;
            /** @description Sayılan deneme (DOM-BEC-042); alıştırmada hep `false` */
            counted: boolean;
            answers: {
                [key: string]: {
                    /** @constant */
                    questionType: "multiple_choice";
                    optionId: string | null;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    answer: ("true" | "false" | "not_given") | null;
                } | {
                    /** @constant */
                    questionType: "matching";
                    pairs: {
                        promptId: string;
                        choiceId: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    gaps: {
                        gapId: string;
                        value: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "ordering";
                    order: string[];
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    value: string;
                };
            };
            /** @description Süren denemede ve kursiyer görünümünde tamamlanmadan `null` */
            result: components["schemas"]["TaskAttemptResult"] | null;
            /** @description Deneme satırının iyimser kilit sürümü (cevap kaydı ve teslimde `If-Match`) */
            rowVersion: number;
        };
        TaskAttemptDetail: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            attemptNumber: number;
            /**
             * @description Süren, teslim edilmiş veya süresi dolmuş (kaydedilmiş cevaplarla teslim sayılır)
             * @enum {string}
             */
            status: "in_progress" | "submitted" | "expired";
            /** Format: date-time */
            startedAt: string;
            /** @description Süre ve teslim kapanışından erken olanı; yoksa `null` */
            endsAt: string | null;
            remainingMs: number | null;
            completedAt: string | null;
            /** @description Süre dolduğu için kaydedilmiş cevaplarla teslim sayıldı */
            autoSubmitted: boolean;
            /** @description Son teslimden sonra, geç kabul süresinde tamamlandı */
            late: boolean;
            /** @description Sayılan deneme (DOM-BEC-042); alıştırmada hep `false` */
            counted: boolean;
            answers: {
                [key: string]: {
                    /** @constant */
                    questionType: "multiple_choice";
                    optionId: string | null;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    answer: ("true" | "false" | "not_given") | null;
                } | {
                    /** @constant */
                    questionType: "matching";
                    pairs: {
                        promptId: string;
                        choiceId: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    gaps: {
                        gapId: string;
                        value: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "ordering";
                    order: string[];
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    value: string;
                };
            };
            /** @description Süren denemede ve kursiyer görünümünde tamamlanmadan `null` */
            result: components["schemas"]["TaskAttemptResult"] | null;
            /** @description Deneme satırının iyimser kilit sürümü (cevap kaydı ve teslimde `If-Match`) */
            rowVersion: number;
            /** @description Denemenin soruları; anahtar ve açıklama yoktur, seçenekler denemeye göre karışık */
            questions: {
                questionVersionId: string;
                points: number;
                question: {
                    /** @constant */
                    questionType: "multiple_choice";
                    stem: string;
                    options: {
                        id: string;
                        text: string;
                    }[];
                    /** @default null */
                    imageFileId: string | null;
                } | {
                    /** @constant */
                    questionType: "true_false";
                    stem: string;
                    /** @default false */
                    allowNotGiven: boolean;
                    /** @default null */
                    imageFileId: string | null;
                } | {
                    /** @constant */
                    questionType: "matching";
                    stem: string;
                    prompts: {
                        id: string;
                        text: string;
                    }[];
                    choices: {
                        id: string;
                        text: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "gap_fill";
                    stem: string;
                    gaps: {
                        id: string;
                        options: unknown;
                    }[];
                } | {
                    /** @constant */
                    questionType: "ordering";
                    stem: string;
                    items: {
                        id: string;
                        text: string;
                    }[];
                } | {
                    /** @constant */
                    questionType: "short_answer";
                    stem: string;
                    /** @default 100 */
                    maxLength: number;
                    /** @default null */
                    imageFileId: string | null;
                };
            }[];
        };
        TaskWordCount: {
            count: number;
            /** @enum {string} */
            status: "ok" | "below" | "above";
            /** @description Sözcük sınırı dışındaysa uyarı; teslim reddedilmez (DOM-BEC-046) */
            warning: string | null;
        };
        TaskScoreBrief: {
            /** @description Puan kesinleşti mi (core `scoreResolution`); kesinleşmemiş puanı yalnız personel görür */
            settled: boolean;
            /**
             * Format: uuid
             * @description Puanın verildiği rubrik sürümü (atamanın sabitlediği; DOM-BEC-022)
             */
            rubricVersionId: string;
            /** @description Ağırlıklı bant toplamı; saklanmaz, okunurken */
            total: number;
            /** @description Azami ağırlıklı bant toplamı */
            max: number;
            /** @description 100 üzerinden puan (DOM-BEC-021) */
            percent: number;
            /** Format: date-time */
            scoredAt: string;
        };
        TaskScore: {
            /** @description Puan kesinleşti mi (core `scoreResolution`); kesinleşmemiş puanı yalnız personel görür */
            settled: boolean;
            /**
             * Format: uuid
             * @description Puanın verildiği rubrik sürümü (atamanın sabitlediği; DOM-BEC-022)
             */
            rubricVersionId: string;
            /** @description Ağırlıklı bant toplamı; saklanmaz, okunurken */
            total: number;
            /** @description Azami ağırlıklı bant toplamı */
            max: number;
            /** @description 100 üzerinden puan (DOM-BEC-021) */
            percent: number;
            /** Format: date-time */
            scoredAt: string;
            criteria: {
                criterionId: string;
                band: number;
                weight: number;
                weighted: number;
                /** @enum {string} */
                meaning: "below" | "target" | "above";
                comment: string | null;
            }[];
            /** @description Öğretmenin genel geri bildirimi */
            overallComment: string;
        };
        TaskSubmission: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            /**
             * @description Son sürüme göre teslim durumu (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "submitted" | "late" | "not_submitted";
            versionCount: number;
            latestVersion: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCount"] | null;
                score: components["schemas"]["TaskScoreBrief"] | null;
            } | null;
            /** @description Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040) */
            resubmission: {
                versionNumber: number;
                /** Format: date-time */
                dueAt: string;
            } | null;
            /** @description Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045) */
            rowVersion: number | null;
        };
        TaskVersionGrading: {
            /**
             * @description Sürümün puan sonucu (core `scoreResolution`): puanlanmadı, puan bekliyor, iki puan arasında birden fazla bant fark (DOM-BEC-024) veya kesinleşti
             * @enum {string}
             */
            status: "unscored" | "pending" | "disagreement" | "settled";
            /** @description `pending` iken beklenen puan; değilse `null` */
            missing: ("first" | "second") | null;
            /** @description Sürüm ikinci puanlama isteğinin (örneklem veya elle) kapsamında mı */
            secondRatingRequested: boolean;
            /** @description Uyuşmazlık kriterleri; bantlar yine yalnız kendi puanlayıcısına görünür. Son puan koordinatör rolüyle gelecek (F4b3b2b); o zamana kadar sonuç kursiyere kapalıdır */
            disagreementCriterionIds: string[];
            /** @description Puanlamanın son anı (core `gradingDueAt`; son teslim + 7 gün). Örneklemli görevde süre örneklemin seçildiği andan başlar; örneklem seçilmeden `null` (süre işlemez) */
            dueAt: string | null;
            /** @description Puanlama süresi aşıldı mı (core `gradingOverdue`); süre yokken `false` */
            overdue: boolean;
        };
        TaskAppeal: {
            /** Format: uuid */
            id: string;
            /** @description İtiraz gerekçesi */
            reason: string;
            /** Format: date-time */
            filedAt: string;
            /** @description Karar; beklerken `null` */
            outcome: ("upheld" | "rejected") | null;
            decidedAt: string | null;
            /** @description Karar gerekçesi */
            decisionReason: string | null;
        };
        TaskSubmissionDetail: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            /**
             * @description Son sürüme göre teslim durumu (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "submitted" | "late" | "not_submitted";
            versionCount: number;
            latestVersion: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCount"] | null;
                score: components["schemas"]["TaskScoreBrief"] | null;
            } | null;
            /** @description Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040) */
            resubmission: {
                versionNumber: number;
                /** Format: date-time */
                dueAt: string;
            } | null;
            /** @description Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045) */
            rowVersion: number | null;
            /** @description Değişmez sürümler, eskiden yeniye (DOM-BEC-040); taslak hiç dönmez */
            versions: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCount"] | null;
                /** @description Gönderilen metin; değişmez */
                body: string | null;
                score: components["schemas"]["TaskScore"] | null;
                grading: components["schemas"]["TaskVersionGrading"] | null;
                /** @description İtirazın son anı (core `appealDeadline`: duyurudan sonra 5 iş günü, Europe/Istanbul gün sonu); yalnız değerlendirme türünde ve sonuç duyurulduysa, kursiyer ve veliye duyurudan önce `null` */
                appealDeadline: string | null;
                appeal: components["schemas"]["TaskAppeal"] | null;
            }[];
            /** @description Yeni sürüm hakkı (core `versionAllowance`) */
            allowance: {
                limit: number;
                used: number;
                remaining: number;
                resubmissionOpen: boolean;
                canSubmit: boolean;
                /** @description `canSubmit: false` ise neden. Kursiyer ve veli geri bildirimi açılmamış puanı görmez: hak, son sürüm puanlanmamış gibi hesaplanır (DOM-BEC-045); onlara `locked` yalnız sıradaki sürümün teslim penceresi kapandığında döner */
                blockedBy: ("limit" | "graded" | "locked") | null;
            } | null;
        };
        TaskDraft: {
            /** Format: uuid */
            assignmentId: string;
            body: string;
            /** @description Taslağın iyimser kilit sürümü; sonraki kayıtta `If-Match` olarak gönderilir */
            revision: number;
            /** Format: date-time */
            savedAt: string;
            wordCount: components["schemas"]["TaskWordCount"] | null;
        };
        GradingQueueItem: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            assignmentId: string;
            learnerId: string;
            /**
             * @description Son sürüme göre teslim durumu (DOM-BEC-044)
             * @enum {string}
             */
            status: "pending" | "submitted" | "late" | "not_submitted";
            versionCount: number;
            latestVersion: {
                /** Format: uuid */
                id: string;
                number: number;
                /** Format: date-time */
                submittedAt: string;
                /** @description Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044) */
                late: boolean;
                /** @description Yazmada sözcük sayısı; saklanmaz, okunurken */
                wordCount: components["schemas"]["TaskWordCount"] | null;
                score: components["schemas"]["TaskScoreBrief"] | null;
            } | null;
            /** @description Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040) */
            resubmission: {
                versionNumber: number;
                /** Format: date-time */
                dueAt: string;
            } | null;
            /** @description Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045) */
            rowVersion: number | null;
            grading: {
                /** @description Son sürümün beklediği puanlar; kişinin puanladığı bekleyen sürüm kuyrukta yoktur. Uyuşmazlıkta boş */
                awaiting: ("first" | "second")[];
                /** @description İki puan uyuşmuyor, koordinatörün son puanı bekleniyor (DOM-BEC-024); yalnız iki puan da verildikten sonra `true` */
                awaitingResolution: boolean;
                /** @description Örneklemli görevde örneklem henüz seçilmedi; ilk puan örneklemden sonra verilir. Son tarihsiz görevde örneklem yoktur, `false` */
                samplePending: boolean;
                /** @description Puanlamanın son anı (core `gradingDueAt`); örneklemli görevde örneklem anından başlar, örneklem seçilmeden `null` */
                dueAt: string | null;
                /** @description Puanlama süresi aşıldı mı (core `gradingOverdue`); süre yokken `false` */
                overdue: boolean;
            };
        };
        SecondRatingSample: {
            /** Format: uuid */
            assignmentId: string;
            /** Format: date-time */
            sampledAt: string;
            percent: number;
            /** @description Örneklem havuzu: sürümü olan teslimler */
            submissionCount: number;
            /** @description İkinci puanlanacak teslimler: oranın yukarı yuvarlanmışı, en az bir */
            submissionIds: string[];
            /** @description Atamanın yeni satır sürümü */
            rowVersion: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Health"];
                    };
                };
            };
            /** @description Default Response */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Me"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listMemberships: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Role göre süz */
                role?: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InstitutionMembership"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listInstitutionMembers: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Ad veya e-postada arama (Türkçe harf ve büyük/küçük harf duyarsız) */
                q?: string;
                /** @description Role göre süz */
                role?: "yonetici" | "onburo" | "ogretmen" | "ogrenci" | "veli";
                /** @description Duruma göre süz. `passive`: bağlı kişi kaydı (öğrenci, çocuk, öğretmen) olan ve hepsi pasif ya da arşivli üyelik */
                status?: "active" | "passive";
                /** @description Sıralama; eksi azalan. Eşitlikte üyelik kimliği */
                sort?: "name" | "-name" | "role" | "-role" | "createdAt" | "-createdAt";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InstitutionMember"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAuditEvents: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Europe/Istanbul günü olarak başlangıç (`YYYY-MM-DD`, dahil) */
                dateFrom?: string;
                /** @description Europe/Istanbul günü olarak bitiş (`YYYY-MM-DD`, dahil) */
                dateTo?: string;
                /** @description Üst zaman sınırı (ISO 8601 UTC, hariç): yalnız bu andan önce yazılmış kayıtlar. Sayfalı dışa aktarma ilk istekte sabitler; böylece sürerken yazılan yeni kayıtlar sayfaları kaydırıp mükerrer satır üretmez. `dateTo` ile birlikte kullanılırsa ikisi de uygulanır */
                createdBefore?: string;
                /** @description Yapan kişinin kullanıcı kimliği (`institution-members` listesindeki `userId`) */
                actorUserId?: string;
                /** @description Varlık türü (ör. `invoices`, `module`); eşitlik */
                entityType?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["AuditEvent"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getModuleSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ModuleSettings"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    setModuleEnabled: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar. */
                "idempotency-key": string;
                /** @description Zorunlu. `GET /modules` yanıtındaki kurum ayar sürümü (ör. `"3"`). Tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Modül anahtarı (ör. `meals`, `finance`) */
                moduleKey: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Modül açık mı olacak */
                    enabled: boolean;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ModuleChange"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listCollection: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Serbest arama; Türkçe büyük/küçük harf ve aksan duyarsız. Kaydın görünen alanlarında ve bağlı adlarda arar: `classes`ta kampüs adı; `invoices`, `grades`, `attendance`ta öğrenci adı, okul numarası ve sınıf adı (yalnız aktörün okuyabildiği bağlı kayıtlar) */
                q?: string;
                /** @description Arşivliler varsayılan olarak dönmez; `include` ekler, `only` yalnız onları verir */
                archived?: "include" | "only";
                /** @description Etkinlik süzgeci (kampüs, sınıf, kadro arşivi `isActive: false` yapar): `true` etkin kayıtlar (alanı olmayan kayıt etkindir), `false` arşivdekiler. Verilmezse ikisi birlikte döner. Sistem arşivi (`archived`) ayrıdır */
                isActive?: "true" | "false";
                /** @description Yalnız `schedule`: `true` iptal edilen dersler (`cancelledAt` dolu), `false` iptal edilmeyenler. Verilmezse ikisi birlikte döner. Başka koleksiyonda 400 */
                cancelled?: "true" | "false";
                /** @description Yalnız `submissions`: `true` notlanmış teslimler (`score` dolu; `0` puandır), `false` notlanmamışlar (`score` boş). Verilmezse ikisi birlikte döner. Başka koleksiyonda 400 */
                graded?: "true" | "false";
                /** @description Gün aralığının (`dateFrom`/`dateTo`) tarih alanı; koleksiyon başına izin listesi, dışındaki alan 400. Varsayılan listenin ilk alanıdır: `invoices` `dueDate` (`paidAt`; ödenmemiş taksit eşleşmez), `homework`/`studyTasks` `dueDate`/`createdAt`, `studentGoals` `deadline`/`reviewedAt`/`createdAt`, `schoolEvents` `date`/`endDate`/`consentDeadline`/`createdAt`, `students` `joinedAt`, `submissions` `submittedAt`, `prospects` `createdAt`/`trialAt`, `questions` `createdAt`/`answeredAt`, `guidanceCases` `followUp`/`createdAt`, `mockExams` `date`/`createdAt`, `quizzes`/`materials`/`mockResults` `createdAt`; diğer koleksiyonlarda `date`. Aralık yoksa etkisizdir */
                dateField?: "date" | "joinedAt" | "dueDate" | "paidAt" | "createdAt" | "trialAt" | "submittedAt" | "answeredAt" | "followUp" | "deadline" | "reviewedAt" | "endDate" | "consentDeadline";
                /** @description Tarih alanının (`dateField`; varsayılan koleksiyonun ilk alanı, çoğunlukla `date`) Europe/Istanbul günü için başlangıç (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateFrom?: string;
                /** @description Tarih alanının (`dateField`; varsayılan koleksiyonun ilk alanı, çoğunlukla `date`) Europe/Istanbul günü için bitiş (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateTo?: string;
                /** @description `studentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                studentId?: string | string[];
                /** @description `classId` eşitlik filtresi; çoklu değer parametre tekrarıyla. Kaydında sınıf olmayan öğrenci koleksiyonlarında (`grades`, `invoices`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`, `guidanceCases`, `studyTasks`, `appointments`, `requests`, `renewals`, `eventConsents`, `transportAssignments`, `clubMemberships`, `socialAchievements`) öğrencinin güncel sınıfıdır */
                classId?: string | string[];
                /** @description `teacherId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                teacherId?: string | string[];
                /** @description `subjectId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                subjectId?: string | string[];
                /** @description `branchId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                branchId?: string | string[];
                /** @description `parentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                parentId?: string | string[];
                /** @description `examId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                examId?: string | string[];
                /** @description `clubId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                clubId?: string | string[];
                /** @description `routeId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                routeId?: string | string[];
                /** @description `quizId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                quizId?: string | string[];
                /** @description `homeworkId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                homeworkId?: string | string[];
                /** @description `videoId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                videoId?: string | string[];
                /** @description `status` eşitlik filtresi; çoklu değer parametre tekrarıyla. `invoices`'ta durum saklanmaz, core `invoiceStatus` ile ödeme, vade ve isteğin saatinden (Europe/Istanbul günü) türetilir: `Ödendi`, `Gecikmiş`, `Yaklaşan`; başka değer 400 */
                status?: string | string[];
                /** @description `stage` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                stage?: string | string[];
                /** @description `source` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                source?: string | string[];
                /** @description `category` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                category?: string | string[];
                /** @description `type` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                type?: string | string[];
                /** @description `grade` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                grade?: string | string[];
                /** @description En çok üç alan, virgülle; eksi azalan (ör. `-createdAt,name`). Alanlar: id, createdAt, updatedAt, name, title, date, dueDate, deadline, followUp, status, stage, grade, score, amount, installment, number, studentName, studentNumber, className, branchName. Bağlı alanlar yalnız tanımlı listede: `branchName` `classes`; `studentName`, `studentNumber`, `className` `invoices`, `grades`, `attendance` (başka listede 400). `invoices` `status`u türetilmiş durumdur. Verilmezse deponun sırası */
                sort?: string;
            };
            header?: never;
            path: {
                /** @description school-core koleksiyon adı (State anahtarı). Okunabilir olanlar: `subjects`, `assignments`, `branches`, `teachers`, `classes`, `students`, `parents`, `grades`, `attendance`, `invoices`, `prospects`, `bank`, `quizzes`, `homework`, `submissions`, `questions`, `videos`, `videoProgress`, `materials`, `announcements`, `appointments`, `requests`, `schedule`, `availability`, `quizAttempts`, `absences`, `contracts`, `guidanceCases`, `mockExams`, `mockResults`, `studentGoals`, `renewals`, `enrollmentHistory`, `studyTasks`, `schoolEvents`, `eventConsents`, `transportRoutes`, `transportAssignments`, `mealMenus`, `clubs`, `clubMemberships`, `clubAttendance`, `socialAchievements`, `opticalProfiles`, `opticalEvaluations`, `tutorSessions`. Bilinmeyen ad 404. */
                collection: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CollectionItem"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    countCollection: {
        parameters: {
            query: {
                /** @description Serbest arama; Türkçe büyük/küçük harf ve aksan duyarsız. Kaydın görünen alanlarında ve bağlı adlarda arar: `classes`ta kampüs adı; `invoices`, `grades`, `attendance`ta öğrenci adı, okul numarası ve sınıf adı (yalnız aktörün okuyabildiği bağlı kayıtlar) */
                q?: string;
                /** @description Arşivliler varsayılan olarak dönmez; `include` ekler, `only` yalnız onları verir */
                archived?: "include" | "only";
                /** @description Etkinlik süzgeci (kampüs, sınıf, kadro arşivi `isActive: false` yapar): `true` etkin kayıtlar (alanı olmayan kayıt etkindir), `false` arşivdekiler. Verilmezse ikisi birlikte döner. Sistem arşivi (`archived`) ayrıdır */
                isActive?: "true" | "false";
                /** @description Yalnız `schedule`: `true` iptal edilen dersler (`cancelledAt` dolu), `false` iptal edilmeyenler. Verilmezse ikisi birlikte döner. Başka koleksiyonda 400 */
                cancelled?: "true" | "false";
                /** @description Yalnız `submissions`: `true` notlanmış teslimler (`score` dolu; `0` puandır), `false` notlanmamışlar (`score` boş). Verilmezse ikisi birlikte döner. Başka koleksiyonda 400 */
                graded?: "true" | "false";
                /** @description Gün aralığının (`dateFrom`/`dateTo`) tarih alanı; koleksiyon başına izin listesi, dışındaki alan 400. Varsayılan listenin ilk alanıdır: `invoices` `dueDate` (`paidAt`; ödenmemiş taksit eşleşmez), `homework`/`studyTasks` `dueDate`/`createdAt`, `studentGoals` `deadline`/`reviewedAt`/`createdAt`, `schoolEvents` `date`/`endDate`/`consentDeadline`/`createdAt`, `students` `joinedAt`, `submissions` `submittedAt`, `prospects` `createdAt`/`trialAt`, `questions` `createdAt`/`answeredAt`, `guidanceCases` `followUp`/`createdAt`, `mockExams` `date`/`createdAt`, `quizzes`/`materials`/`mockResults` `createdAt`; diğer koleksiyonlarda `date`. Aralık yoksa etkisizdir */
                dateField?: "date" | "joinedAt" | "dueDate" | "paidAt" | "createdAt" | "trialAt" | "submittedAt" | "answeredAt" | "followUp" | "deadline" | "reviewedAt" | "endDate" | "consentDeadline";
                /** @description Tarih alanının (`dateField`; varsayılan koleksiyonun ilk alanı, çoğunlukla `date`) Europe/Istanbul günü için başlangıç (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateFrom?: string;
                /** @description Tarih alanının (`dateField`; varsayılan koleksiyonun ilk alanı, çoğunlukla `date`) Europe/Istanbul günü için bitiş (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateTo?: string;
                /** @description `studentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                studentId?: string | string[];
                /** @description `classId` eşitlik filtresi; çoklu değer parametre tekrarıyla. Kaydında sınıf olmayan öğrenci koleksiyonlarında (`grades`, `invoices`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`, `guidanceCases`, `studyTasks`, `appointments`, `requests`, `renewals`, `eventConsents`, `transportAssignments`, `clubMemberships`, `socialAchievements`) öğrencinin güncel sınıfıdır */
                classId?: string | string[];
                /** @description `teacherId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                teacherId?: string | string[];
                /** @description `subjectId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                subjectId?: string | string[];
                /** @description `branchId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                branchId?: string | string[];
                /** @description `parentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                parentId?: string | string[];
                /** @description `examId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                examId?: string | string[];
                /** @description `clubId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                clubId?: string | string[];
                /** @description `routeId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                routeId?: string | string[];
                /** @description `quizId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                quizId?: string | string[];
                /** @description `homeworkId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                homeworkId?: string | string[];
                /** @description `videoId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                videoId?: string | string[];
                /** @description `status` eşitlik filtresi; çoklu değer parametre tekrarıyla. `invoices`'ta durum saklanmaz, core `invoiceStatus` ile ödeme, vade ve isteğin saatinden (Europe/Istanbul günü) türetilir: `Ödendi`, `Gecikmiş`, `Yaklaşan`; başka değer 400 */
                status?: string | string[];
                /** @description `stage` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                stage?: string | string[];
                /** @description `source` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                source?: string | string[];
                /** @description `category` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                category?: string | string[];
                /** @description `type` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                type?: string | string[];
                /** @description `grade` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                grade?: string | string[];
                /** @description Gruplama alanı (zorunlu) ya da aylık gruplama `<tarih alanı>:month` (ör. `paidAt:month`, `dueDate:month`; değer `YYYY-MM`, Europe/Istanbul ayı; tarih alanı `dateField` izin listesindedir, dışındaki 400; tarih olmayan değer `null` grubudur). Rolün göremediği alan 400. `isActive` alanı olmayan kayıt `true`; `invoices` `status`u türetilmiş durumdur; kaydında sınıf olmayan öğrenci koleksiyonlarında (`classId` süzgeciyle aynı liste) `classId` öğrencinin güncel sınıfıdır */
                groupBy: "studentId" | "classId" | "teacherId" | "subjectId" | "branchId" | "parentId" | "examId" | "clubId" | "routeId" | "quizId" | "homeworkId" | "videoId" | "status" | "stage" | "source" | "category" | "type" | "grade" | "isActive" | "level" | "date:month" | "joinedAt:month" | "dueDate:month" | "paidAt:month" | "createdAt:month" | "trialAt:month" | "submittedAt:month" | "answeredAt:month" | "followUp:month" | "deadline:month" | "reviewedAt:month" | "endDate:month" | "consentDeadline:month";
                /** @description Grup başına toplanacak sayısal alan; sayı olmayan değer toplama girmez. `amount` kuruştur. Rolün göremediği alan 400 */
                sum?: "amount" | "capacity" | "score" | "progress" | "attendanceRate" | "homeworkRate";
            };
            header?: never;
            path: {
                /** @description school-core koleksiyon adı (State anahtarı). Okunabilir olanlar: `subjects`, `assignments`, `branches`, `teachers`, `classes`, `students`, `parents`, `grades`, `attendance`, `invoices`, `prospects`, `bank`, `quizzes`, `homework`, `submissions`, `questions`, `videos`, `videoProgress`, `materials`, `announcements`, `appointments`, `requests`, `schedule`, `availability`, `quizAttempts`, `absences`, `contracts`, `guidanceCases`, `mockExams`, `mockResults`, `studentGoals`, `renewals`, `enrollmentHistory`, `studyTasks`, `schoolEvents`, `eventConsents`, `transportRoutes`, `transportAssignments`, `mealMenus`, `clubs`, `clubMemberships`, `clubAttendance`, `socialAchievements`, `opticalProfiles`, `opticalEvaluations`, `tutorSessions`. Bilinmeyen ad 404. */
                collection: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Gruplar, değere göre sıralı; `null` sonda */
                        data: components["schemas"]["CollectionCountGroup"][];
                        meta: components["schemas"]["CollectionCountsMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getCollectionRecord: {
        parameters: {
            query?: {
                /** @description Arşivlenmiş kayıt varsayılan olarak 404; `include` ile döner */
                archived?: "include";
            };
            header?: never;
            path: {
                /** @description school-core koleksiyon adı (State anahtarı). Okunabilir olanlar: `subjects`, `assignments`, `branches`, `teachers`, `classes`, `students`, `parents`, `grades`, `attendance`, `invoices`, `prospects`, `bank`, `quizzes`, `homework`, `submissions`, `questions`, `videos`, `videoProgress`, `materials`, `announcements`, `appointments`, `requests`, `schedule`, `availability`, `quizAttempts`, `absences`, `contracts`, `guidanceCases`, `mockExams`, `mockResults`, `studentGoals`, `renewals`, `enrollmentHistory`, `studyTasks`, `schoolEvents`, `eventConsents`, `transportRoutes`, `transportAssignments`, `mealMenus`, `clubs`, `clubMemberships`, `clubAttendance`, `socialAchievements`, `opticalProfiles`, `opticalEvaluations`, `tutorSessions`. Bilinmeyen ad 404. */
                collection: string;
                /** @description Kayıt kimliği */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CollectionItem"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getDashboard: {
        parameters: {
            query?: {
                /** @description Yalnız öğrenci ve velide: özeti gösterilecek öğrenci. Velide seçili çocuk (verilmezse kapsamdaki ilk çocuk); kapsam dışı öğrenci 404. Diğer rollerde 400 */
                studentId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Dashboard"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoal: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    subjectId: string;
                    title: string;
                    targetNet: number;
                    deadline: string;
                    /** @default  */
                    motivation?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoalReview: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status: "Aktif" | "Reddedildi";
                    /** @default  */
                    feedback?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoalStep: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    /** @default  */
                    topic?: string;
                    dueDate: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoalStepDone: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    stepId: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoalSuggest: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoalComment: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    text: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGoalClose: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGuidance: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    teacherId: string;
                    title: string;
                    plan: string;
                    /** @default  */
                    sharedNote?: string;
                    /** @default  */
                    internalNote?: string;
                    followUp: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowGuidanceNote: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    text: string;
                    /** @default  */
                    sharedNote?: string;
                    followUp: string;
                    /** @enum {string} */
                    status: "Takipte" | "Tamamlandı";
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowExam: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    /** @enum {string} */
                    type: "LGS" | "YKS" | "Okul denemesi";
                    grade: number;
                    wrongPenalty: number;
                    date: string;
                    subjectIds: string[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowExamResult: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    examId: string;
                    studentId: string;
                    subjectId: string;
                    correct: number;
                    wrong: number;
                    blank: number;
                    weakTopics: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowExamImport: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    csv: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowRenewal: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    targetClassId: string;
                    year: number;
                    /** @enum {string} */
                    mode: "renew" | "graduate";
                    total: number;
                    scholarship: number;
                    discount: number;
                    count: number;
                    startDate: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowRenewalActivate: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowLesson: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    classId: string;
                    teacherId: string;
                    subjectId: string;
                    date: string;
                    duration: number;
                    room: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowLessonUpdate: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    classId: string;
                    teacherId: string;
                    subjectId: string;
                    date: string;
                    duration: number;
                    room: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowSubstitute: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    teacherId: string;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowLessonCancel: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowStudyTask: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    subjectId: string;
                    topic: string;
                    title: string;
                    instructions: string;
                    dueDate: string;
                    minutes: number;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowStudyComplete: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    completionNote: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowStudyReview: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    feedback: string;
                    /** @enum {string} */
                    status: "Onaylandı" | "Tamamlandı" | "Tekrar çalışılacak";
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowEvent: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    classId: string;
                    branchId: string;
                    date: string;
                    endDate: string;
                    location: string;
                    description: string;
                    requiresConsent: boolean;
                    consentDeadline: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowConsent: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "Onaylandı" | "Reddedildi";
                    /** @default  */
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowEventCancel: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowRoute: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    branchId: string;
                    plate: string;
                    driver: string;
                    phone: string;
                    capacity: number;
                    stops: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowRouteUpdate: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    branchId: string;
                    plate: string;
                    driver: string;
                    phone: string;
                    capacity: number;
                    stops: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowRouteArchive: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowTransportAssign: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    routeId: string;
                    stop: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowTransportRemove: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowMeal: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    branchId: string;
                    date: string;
                    title: string;
                    allergens: string;
                    /** @default  */
                    description?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowMealUpdate: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    branchId: string;
                    date: string;
                    title: string;
                    allergens: string;
                    /** @default  */
                    description?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowClub: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    branchId: string;
                    teacherId: string;
                    capacity: number;
                    description: string;
                    meeting: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowClubEnroll: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowClubLeave: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowClubAttendance: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    date: string;
                    marks: {
                        [key: string]: "Geldi" | "Gelmedi" | "İzinli";
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowAchievement: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    clubId: string;
                    title: string;
                    description: string;
                    date: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runWorkflowClubArchive: {
        parameters: {
            query?: {
                /** @description Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner) */
                childId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu olan kayıt (ör. hedef kimliği) */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    payInvoice: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Taksit kimliği */
                invoiceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Ödeme yöntemi: `Banka havalesi`, `Nakit`, `Kredi kartı`
                     * @enum {string}
                     */
                    method: "Banka havalesi" | "Nakit" | "Kredi kartı";
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    recordClassAttendance: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Sınıf kimliği */
                classId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Yoklama günü (`YYYY-MM-DD`); gelecek gün 422 */
                    date: string;
                    /** @description Öğrenci kimliği → durum; sınıfın bütün aktif öğrencileri bulunmalı */
                    marks: {
                        [key: string]: "present" | "absent" | "late" | "excused";
                    };
                    /** @description Düzeltme gerekçesi (DOM-AKD-035); kırpılır, en çok 500 karakter. Yöneticide zorunlu, yoksa 422 `correction_reason_required`; öğretmende isteğe bağlı. Durumu değişen öğrencinin düzeltme geçmişine yazılır */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    recordGrade: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    subjectId: string;
                    term: number;
                    /** @enum {string} */
                    assessmentType: "sinav" | "performans" | "proje" | "katilim";
                    date: string;
                    score?: number;
                    quizId?: string;
                    /** @default  */
                    topic?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateGrade: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Not kimliği */
                gradeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    score: number;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createBranch: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    address: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archiveBranch: {
        parameters: {
            query?: {
                /** @description Bağlı kayıtların aktarılacağı kayıt (kampüs, sınıf veya öğretmen); core gerektiriyorsa zorunlu */
                replacementId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kampüs kimliği */
                branchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateBranch: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Kampüs kimliği */
                branchId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    address?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    restoreBranch: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kampüs kimliği */
                branchId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createClass: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    grade: number;
                    section: string;
                    branchId: string;
                    teacherId: string;
                    capacity: number;
                    room: string;
                    subjectTeachers: {
                        [key: string]: string;
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archiveClass: {
        parameters: {
            query?: {
                /** @description Bağlı kayıtların aktarılacağı kayıt (kampüs, sınıf veya öğretmen); core gerektiriyorsa zorunlu */
                replacementId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Sınıf kimliği */
                classId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateClass: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Sınıf kimliği */
                classId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    grade?: number;
                    section?: string;
                    branchId?: string;
                    teacherId?: string;
                    capacity?: number;
                    room?: string;
                    subjectTeachers?: {
                        [key: string]: string;
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    restoreClass: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Sınıf kimliği */
                classId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createTeacher: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** Format: email */
                    email: string;
                    phone: string;
                    subjectId: string;
                    branchId: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archiveTeacher: {
        parameters: {
            query?: {
                /** @description Bağlı kayıtların aktarılacağı kayıt (kampüs, sınıf veya öğretmen); core gerektiriyorsa zorunlu */
                replacementId?: string;
            };
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Öğretmen kimliği */
                teacherId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateTeacher: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Öğretmen kimliği */
                teacherId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    /** Format: email */
                    email?: string;
                    phone?: string;
                    subjectId?: string;
                    branchId?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    restoreTeacher: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Öğretmen kimliği */
                teacherId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createTutorSessions: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    examId: string;
                    threshold: number;
                    fromDate: string;
                    toDate: string;
                    duration: number;
                    maxGroupSize: number;
                    /** @default  */
                    branchId?: string;
                    /** @default  */
                    subjectId?: string;
                    /** @description Önizlemede gösterilen planın JSON metni */
                    expectedPlan?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    cancelTutorSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Etüt kimliği */
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    recordTutorAttendance: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Etüt kimliği */
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Etüt öğrencisi → durum; bütün etüt öğrencileri ve yalnız onlar */
                    marks: {
                        [key: string]: "Geldi" | "Gelmedi" | "İzinli";
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    examId: string;
                    title: string;
                    /** @enum {string} */
                    format: "csv" | "fixed";
                    /** @enum {string} */
                    identifier: "id" | "number";
                    headerLines: number;
                    studentStart: number;
                    studentLength: number;
                    bookletStart: number;
                    bookletLength: number;
                    answersStart: number;
                    answersLength: number;
                    keyCsv: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentProfileUpdate: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu: profil, uygunluk saati veya etüt kimliği */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    examId: string;
                    title: string;
                    /** @enum {string} */
                    format: "csv" | "fixed";
                    /** @enum {string} */
                    identifier: "id" | "number";
                    headerLines: number;
                    studentStart: number;
                    studentLength: number;
                    bookletStart: number;
                    bookletLength: number;
                    answersStart: number;
                    answersLength: number;
                    keyCsv: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentEvaluate: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    profileId: string;
                    text: string;
                    /** @description Önizlemedeki `digest`. Güncel sonuç farklıysa hiçbir şey yazılmaz: 409 `evaluation_stale` */
                    expectedDigest?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentPlan: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    examId: string;
                    threshold: number;
                    fromDate: string;
                    toDate: string;
                    duration: number;
                    maxGroupSize: number;
                    /** @default  */
                    branchId?: string;
                    /** @default  */
                    subjectId?: string;
                    /** @description Önizlemedeki `expectedPlan` metni. Güncel plan farklıysa hiçbir şey yazılmaz: 409 `tutoring_plan_stale` ve `issues` içinde fark döner */
                    expectedPlan?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentSlot: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    teacherId: string;
                    date: string;
                    duration: number;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentSlotRemove: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu: profil, uygunluk saati veya etüt kimliği */
                recordId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentCancel: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu: profil, uygunluk saati veya etüt kimliği */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    runAssessmentAttendance: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Komutun konusu: profil, uygunluk saati veya etüt kimliği */
                recordId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Etüt öğrencisi → durum; bütün etüt öğrencileri ve yalnız onlar */
                    marks: {
                        [key: string]: "Geldi" | "Gelmedi" | "İzinli";
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    previewAssessmentPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    examId: string;
                    threshold: number;
                    fromDate: string;
                    toDate: string;
                    duration: number;
                    maxGroupSize: number;
                    /** @default  */
                    branchId?: string;
                    /** @default  */
                    subjectId?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TutoringPlanPreview"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    previewAssessmentEvaluation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    profileId: string;
                    text: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["EvaluationPreview"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    publishAnnouncement: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    text: string;
                    /** @enum {string} */
                    category: "Akademik" | "Etkinlik" | "Bilgilendirme" | "İdari";
                    target: {
                        /** @default [] */
                        branchIds?: string[];
                        /** @default [] */
                        grades?: number[];
                        /** @default [] */
                        levels?: string[];
                        /** @default [] */
                        classIds?: string[];
                        roles: ("ogretmen" | "ogrenci" | "veli")[];
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reviseAnnouncement: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Duyuru kimliği */
                announcementId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string;
                    text?: string;
                    /** @enum {string} */
                    category?: "Akademik" | "Etkinlik" | "Bilgilendirme" | "İdari";
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    withdrawAnnouncement: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Duyuru kimliği */
                announcementId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readAnnouncement: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path: {
                /** @description Duyuru kimliği */
                announcementId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listConversations: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Öğrenci süzgeci; yöneticide zorunlu (yalnız üst veri döner) */
                studentId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ConversationSummary"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    startConversation: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    teacherId?: string;
                    /** @enum {string} */
                    audience?: "student" | "parent";
                    parentUserId?: string;
                    text?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listConversationMessages: {
        parameters: {
            query?: {
                /** @description Önceki sayfanın `meta.nextCursor` değeri; yoksa en yeni mesajlar */
                cursor?: string;
                /** @description Sayfa boyutu (≤ 100) */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description Yazışma kimliği */
                conversationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Sayfa içinde eskiden yeniye */
                        data: components["schemas"]["ConversationMessage"][];
                        meta: {
                            /** @description Daha eski mesajlar için imleç; yoksa `null` */
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    sendConversationMessage: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path: {
                /** @description Yazışma kimliği */
                conversationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    text: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readConversation: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path: {
                /** @description Yazışma kimliği */
                conversationId: string;
            };
            cookie?: never;
        };
        /** @description Gövdesiz komut */
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    openConversationAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Yazışma kimliği */
                conversationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default  */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            conversationId: string;
                            /** @description Erişimin bittiği an (ISO 8601 UTC); 30 dakika */
                            expiresAt: string;
                        };
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listStudentParentAccounts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Öğrenci kimliği */
                studentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @description Velinin kullanıcı kimliği (`parentUserId`) */
                            userId: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    openRequest: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    /** @enum {string} */
                    category: "Talep" | "Şikayet" | "Öneri";
                    title: string;
                    text: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateRequest: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Talep kimliği */
                requestId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status?: "Yeni" | "İnceleniyor" | "Çözüldü";
                    /** @enum {string} */
                    assignedTo?: "Ön büro" | "Akademik koordinatör" | "Finans birimi" | "Şube müdürü";
                    reply?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    notifyAbsence: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    startDate: string;
                    endDate: string;
                    /** @enum {string} */
                    reasonCategory: "health" | "family" | "official" | "other";
                    files?: string[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listBookableSlots: {
        parameters: {
            query: {
                studentId: string;
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Başlangıca göre sıralı; aralıkla sınırlı, sayfalanmaz */
                        data: components["schemas"]["BookableSlot"][];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    bookAppointment: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    studentId: string;
                    slotId: string;
                    /** @enum {string} */
                    type?: "Bireysel etüt" | "Veli görüşmesi" | "Akademik danışmanlık";
                    note: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateAppointment: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Randevu kimliği */
                appointmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status: "Onaylandı" | "Reddedildi" | "İptal" | "Geri çekildi";
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createProspect: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    phone: string;
                    email?: "" | string;
                    branchId: string;
                    interest: string;
                    /** @enum {string} */
                    source: "Web sitesi" | "Veli referansı" | "Kampüs ziyareti" | "Telefon" | "Bursluluk sınavı" | "Sosyal medya" | "Kurumsal anlaşma";
                    referrerStudentId?: string;
                    minor?: boolean;
                    guardianName?: string;
                    siblingOfId?: string;
                    privacyNoticeVersion: string;
                    marketingConsent?: {
                        sms?: boolean;
                        email?: boolean;
                        call?: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    changeProspectStage: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Aday kimliği */
                prospectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    stage: "Yeni aday" | "İletişime geçildi" | "Görüşme planlandı" | "Teklif verildi" | "Kayıt oldu" | "Vazgeçti";
                    /** @enum {string} */
                    lostReason?: "price" | "transport" | "other_school" | "academic_fit" | "other";
                    siblingOfId?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    addProspectNote: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Aday kimliği */
                prospectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    text: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    scheduleProspectMeeting: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Aday kimliği */
                prospectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: date-time */
                    date: string;
                    /** @default 30 */
                    duration?: number;
                    room: string;
                    teacherId?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    scheduleTrialLesson: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Aday kimliği */
                prospectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    lessonId: string;
                    guardianConsent?: boolean;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    enrollProspect: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Aday kimliği */
                prospectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Öğrencinin yerleşeceği etkin sınıf */
                    classId: string;
                    /** @description Eğitim bedeli, kuruş (tamsayı). 10.000–100.000.000 (100–1.000.000 ₺) */
                    totalCents: number;
                    /** @description Taksit sayısı (1–12) */
                    count: number;
                    /** @description İlk taksitin vadesi (`YYYY-MM-DD`) */
                    startDate: string;
                    /** @description Sınıf adayın kampüsünden değilse bilinçli seçim onayı; verilmezse 422 `class_campus_mismatch` */
                    allowOtherCampus?: boolean;
                    /** @description Kardeş kaydında öğrencinin bağlanacağı mevcut veli (DOM-KAY-013); yalnız 18 yaş altı */
                    parentId?: string;
                    /** @description Öğrencinin T.C. veya yabancı uyruklu kimlik numarası (11 hane, DOM-KAY-012) */
                    nationalId?: string;
                    /** @description Öğrencinin doğum tarihi (`YYYY-MM-DD`, DOM-KAY-012) */
                    birthDate?: string;
                    /**
                     * @description Velinin öğrenciye yakınlığı (DOM-KAY-012); yalnız 18 yaş altı
                     * @enum {string}
                     */
                    guardianRelation?: "mother" | "father" | "legal_guardian" | "other";
                    /**
                     * @description Sözleşmenin ödeyicisi (DOM-KAY-012); verilmezse 18 yaş altında `guardian`, üstünde `student`
                     * @enum {string}
                     */
                    payer?: "guardian" | "student";
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["EnrollProspectResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    askQuestion: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    subjectId: string;
                    teacherId?: string;
                    topic?: string;
                    title: string;
                    text: string;
                    files?: string[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    answerQuestion: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Soru kimliği */
                questionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    text: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    withdrawQuestion: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Soru kimliği */
                questionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {boolean} */
                    withdrawn: true;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CommandResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listResources: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Başlık, metin ve kaynak gösteriminde önek araması. Türkçe harf, büyük/küçük harf ve uyumluluk biçimleri (NFKD) duyarsız; en fazla 8 terim, hepsi eşleşmeli. Cevap anahtarı ve dinleme dökümü aranmaz */
                q?: string;
                /** @description İçerik türü */
                contentType?: "text" | "reading_passage" | "audio" | "video" | "worksheet" | "file" | "link" | "book_reference" | "question" | "quiz" | "exercise_set" | "homework_template";
                /** @description CEFR seviyesi */
                cefrLevel?: "Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2";
                /** @description Birincil beceri */
                primarySkill?: "reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use";
                /** @description Beceri listesinde bulunan beceri */
                skill?: "reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use" | "vocabulary" | "grammar" | "pronunciation";
                /** @description Ders kimliği */
                subjectId?: string;
                /** @description Sınıf düzeyi */
                gradeLevel?: number;
                /** @description Baş sürümün durumu. Verilmezse arşivli ve kaldırılan kaynaklar dışlanır (DOM-KYN-051). Yalnız personel; öğrenci ve velide 400 `staff_only_filter` */
                status?: "draft" | "in_review" | "published" | "rejected" | "archived" | "removed";
                /** @description Kaynak sahibi. Yalnız personel; öğrenci ve velide 400 `staff_only_filter` */
                ownerUserId?: string;
                /** @description Sıralama; eksi azalan. Eşitlikte kaynak kimliği */
                sort?: "-updatedAt" | "updatedAt" | "title" | "-title";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: (components["schemas"]["StaffResourceListItem"] | components["schemas"]["LearnerResourceListItem"])[];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createResource: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    content: {
                        /** @enum {string} */
                        type: "text";
                        /** @default null */
                        body?: string | null;
                        /** @default null */
                        fileId?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "worksheet";
                        /** @default null */
                        body?: string | null;
                        /** @default null */
                        fileId?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "reading_passage";
                        body: string;
                    } | {
                        /** @enum {string} */
                        type: "audio";
                        fileId: string;
                        /** @default null */
                        transcript?: string | null;
                        /** @default null */
                        captionsVtt?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "video";
                        fileId: string;
                        /** @default null */
                        transcript?: string | null;
                        /** @default null */
                        captionsVtt?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "file";
                        fileId: string;
                    } | {
                        /** @enum {string} */
                        type: "link";
                        /** Format: uri */
                        url: string;
                        /** @default null */
                        provider?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "book_reference";
                        publisher: string;
                        bookTitle: string;
                        /** @default null */
                        edition?: string | null;
                        /** @default null */
                        isbn?: string | null;
                        pages: string;
                        /** @default null */
                        note?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "question";
                        question: {
                            /** @enum {string} */
                            questionType: "multiple_choice";
                            stem: string;
                            options: {
                                id: string;
                                text: string;
                            }[];
                            /** @default null */
                            imageFileId?: string | null;
                        } | {
                            /** @enum {string} */
                            questionType: "true_false";
                            stem: string;
                            /** @default false */
                            allowNotGiven?: boolean;
                            /** @default null */
                            imageFileId?: string | null;
                        } | {
                            /** @enum {string} */
                            questionType: "matching";
                            stem: string;
                            prompts: {
                                id: string;
                                text: string;
                            }[];
                            choices: {
                                id: string;
                                text: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "gap_fill";
                            stem: string;
                            gaps: {
                                id: string;
                                /** @default [] */
                                options?: string[];
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "ordering";
                            stem: string;
                            items: {
                                id: string;
                                text: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "short_answer";
                            stem: string;
                            /** @default 100 */
                            maxLength?: number;
                            /** @default null */
                            imageFileId?: string | null;
                        };
                    } | {
                        /** @enum {string} */
                        type: "quiz";
                        items: {
                            questionVersionId: string;
                            /** @default 1 */
                            points?: number;
                        }[];
                        /** @default null */
                        timeLimitMinutes?: number | null;
                        /** @default false */
                        shuffleItems?: boolean;
                    } | {
                        /** @enum {string} */
                        type: "exercise_set";
                        items: {
                            questionVersionId: string;
                            /** @default 1 */
                            points?: number;
                        }[];
                        /** @default null */
                        timeLimitMinutes?: number | null;
                        /** @default false */
                        shuffleItems?: boolean;
                    } | {
                        /** @enum {string} */
                        type: "homework_template";
                        instructions: string;
                        submissionKinds: ("file" | "text" | "audio")[];
                        /** @default null */
                        criteria?: string | null;
                        /** @default null */
                        rubricId?: string | null;
                    };
                    answerKey?: ({
                        /** @enum {string} */
                        questionType: "multiple_choice";
                        correctOptionId: string;
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "true_false";
                        /** @enum {string} */
                        answer: "true" | "false" | "not_given";
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "matching";
                        pairs: {
                            promptId: string;
                            choiceId: string;
                        }[];
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "gap_fill";
                        gaps: {
                            gapId: string;
                            accepted: string[];
                        }[];
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "ordering";
                        order: string[];
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "short_answer";
                        accepted: string[];
                        explanation: string;
                    }) | null;
                    /** @default {} */
                    tags?: {
                        /** @default null */
                        subjectId?: string | null;
                        /** @default [] */
                        gradeLevels?: number[];
                        /** @default null */
                        cefrLevel?: ("Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2") | null;
                        /** @default null */
                        primarySkill?: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use") | null;
                        /** @default [] */
                        skills?: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use" | "vocabulary" | "grammar" | "pronunciation")[];
                        /** @default null */
                        activityMode?: ("reception" | "production" | "interaction" | "mediation") | null;
                        /** @default null */
                        interactionChannel?: ("spoken" | "written" | "online") | null;
                        /** @default null */
                        mediation?: {
                            /** @enum {string} */
                            sourceSkill: "reading" | "listening" | "writing" | "speaking";
                            /** @enum {string} */
                            targetSkill: "reading" | "listening" | "writing" | "speaking";
                        } | null;
                        /** @default null */
                        durationMinutes?: number | null;
                        /** @default null */
                        difficulty?: ("easy" | "medium" | "hard") | null;
                        /** @default [] */
                        outcomes?: {
                            outcomeId: string;
                            /** @enum {string} */
                            outcomeSource: "platform" | "institution";
                        }[];
                    };
                    /** @default null */
                    license?: ({
                        /** @enum {string} */
                        kind: "institution_original";
                    } | {
                        /** @enum {string} */
                        kind: "contains_quotation";
                    } | {
                        /** @enum {string} */
                        kind: "platform_derived";
                        platformVersionId: string;
                    } | {
                        /** @enum {string} */
                        kind: "open_license";
                        /** @enum {string} */
                        license: "CC0-1.0" | "CC-BY-4.0" | "CC-BY-SA-4.0" | "CC-BY-3.0" | "CC-BY-SA-3.0";
                    } | {
                        /** @enum {string} */
                        kind: "public_domain";
                        basisNote: string;
                    } | {
                        /** @enum {string} */
                        kind: "licensed_publication";
                        publisher: string;
                        contractNumber: string;
                        coverage: string;
                        expiryDate: string;
                        /** @default false */
                        allowsAdaptation?: boolean;
                        /** @default false */
                        restrictedToBookOwners?: boolean;
                    } | {
                        /** @enum {string} */
                        kind: "external_reference";
                    }) | null;
                    /** @default [] */
                    attributions?: {
                        work: string;
                        author: string;
                        source: string;
                        /** @default null */
                        year?: number | null;
                    }[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getResource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["StaffResourceDetail"] | components["schemas"]["LearnerResourceDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getResourceVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            view: "staff";
                            version: components["schemas"]["ResourceVersion"];
                        } | {
                            /** @enum {string} */
                            view: "learner";
                            version: components["schemas"]["LearnerResourceVersion"];
                        };
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateResourceDraft: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string;
                    /** @description Tür başına içerik; tür değiştirilemez */
                    content?: {
                        /** @enum {string} */
                        type: "text";
                        /** @default null */
                        body?: string | null;
                        /** @default null */
                        fileId?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "worksheet";
                        /** @default null */
                        body?: string | null;
                        /** @default null */
                        fileId?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "reading_passage";
                        body: string;
                    } | {
                        /** @enum {string} */
                        type: "audio";
                        fileId: string;
                        /** @default null */
                        transcript?: string | null;
                        /** @default null */
                        captionsVtt?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "video";
                        fileId: string;
                        /** @default null */
                        transcript?: string | null;
                        /** @default null */
                        captionsVtt?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "file";
                        fileId: string;
                    } | {
                        /** @enum {string} */
                        type: "link";
                        /** Format: uri */
                        url: string;
                        /** @default null */
                        provider?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "book_reference";
                        publisher: string;
                        bookTitle: string;
                        /** @default null */
                        edition?: string | null;
                        /** @default null */
                        isbn?: string | null;
                        pages: string;
                        /** @default null */
                        note?: string | null;
                    } | {
                        /** @enum {string} */
                        type: "question";
                        question: {
                            /** @enum {string} */
                            questionType: "multiple_choice";
                            stem: string;
                            options: {
                                id: string;
                                text: string;
                            }[];
                            /** @default null */
                            imageFileId?: string | null;
                        } | {
                            /** @enum {string} */
                            questionType: "true_false";
                            stem: string;
                            /** @default false */
                            allowNotGiven?: boolean;
                            /** @default null */
                            imageFileId?: string | null;
                        } | {
                            /** @enum {string} */
                            questionType: "matching";
                            stem: string;
                            prompts: {
                                id: string;
                                text: string;
                            }[];
                            choices: {
                                id: string;
                                text: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "gap_fill";
                            stem: string;
                            gaps: {
                                id: string;
                                /** @default [] */
                                options?: string[];
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "ordering";
                            stem: string;
                            items: {
                                id: string;
                                text: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "short_answer";
                            stem: string;
                            /** @default 100 */
                            maxLength?: number;
                            /** @default null */
                            imageFileId?: string | null;
                        };
                    } | {
                        /** @enum {string} */
                        type: "quiz";
                        items: {
                            questionVersionId: string;
                            /** @default 1 */
                            points?: number;
                        }[];
                        /** @default null */
                        timeLimitMinutes?: number | null;
                        /** @default false */
                        shuffleItems?: boolean;
                    } | {
                        /** @enum {string} */
                        type: "exercise_set";
                        items: {
                            questionVersionId: string;
                            /** @default 1 */
                            points?: number;
                        }[];
                        /** @default null */
                        timeLimitMinutes?: number | null;
                        /** @default false */
                        shuffleItems?: boolean;
                    } | {
                        /** @enum {string} */
                        type: "homework_template";
                        instructions: string;
                        submissionKinds: ("file" | "text" | "audio")[];
                        /** @default null */
                        criteria?: string | null;
                        /** @default null */
                        rubricId?: string | null;
                    };
                    answerKey?: ({
                        /** @enum {string} */
                        questionType: "multiple_choice";
                        correctOptionId: string;
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "true_false";
                        /** @enum {string} */
                        answer: "true" | "false" | "not_given";
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "matching";
                        pairs: {
                            promptId: string;
                            choiceId: string;
                        }[];
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "gap_fill";
                        gaps: {
                            gapId: string;
                            accepted: string[];
                        }[];
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "ordering";
                        order: string[];
                        explanation: string;
                    } | {
                        /** @enum {string} */
                        questionType: "short_answer";
                        accepted: string[];
                        explanation: string;
                    }) | null;
                    /** @description Etiketler bütün olarak değişir */
                    tags?: {
                        /** @default null */
                        subjectId?: string | null;
                        /** @default [] */
                        gradeLevels?: number[];
                        /** @default null */
                        cefrLevel?: ("Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2") | null;
                        /** @default null */
                        primarySkill?: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use") | null;
                        /** @default [] */
                        skills?: ("reading" | "listening" | "writing" | "speaking" | "mediation" | "language_use" | "vocabulary" | "grammar" | "pronunciation")[];
                        /** @default null */
                        activityMode?: ("reception" | "production" | "interaction" | "mediation") | null;
                        /** @default null */
                        interactionChannel?: ("spoken" | "written" | "online") | null;
                        /** @default null */
                        mediation?: {
                            /** @enum {string} */
                            sourceSkill: "reading" | "listening" | "writing" | "speaking";
                            /** @enum {string} */
                            targetSkill: "reading" | "listening" | "writing" | "speaking";
                        } | null;
                        /** @default null */
                        durationMinutes?: number | null;
                        /** @default null */
                        difficulty?: ("easy" | "medium" | "hard") | null;
                        /** @default [] */
                        outcomes?: {
                            outcomeId: string;
                            /** @enum {string} */
                            outcomeSource: "platform" | "institution";
                        }[];
                    };
                    license?: ({
                        /** @enum {string} */
                        kind: "institution_original";
                    } | {
                        /** @enum {string} */
                        kind: "contains_quotation";
                    } | {
                        /** @enum {string} */
                        kind: "platform_derived";
                        platformVersionId: string;
                    } | {
                        /** @enum {string} */
                        kind: "open_license";
                        /** @enum {string} */
                        license: "CC0-1.0" | "CC-BY-4.0" | "CC-BY-SA-4.0" | "CC-BY-3.0" | "CC-BY-SA-3.0";
                    } | {
                        /** @enum {string} */
                        kind: "public_domain";
                        basisNote: string;
                    } | {
                        /** @enum {string} */
                        kind: "licensed_publication";
                        publisher: string;
                        contractNumber: string;
                        coverage: string;
                        expiryDate: string;
                        /** @default false */
                        allowsAdaptation?: boolean;
                        /** @default false */
                        restrictedToBookOwners?: boolean;
                    } | {
                        /** @enum {string} */
                        kind: "external_reference";
                    }) | null;
                    attributions?: {
                        work: string;
                        author: string;
                        source: string;
                        /** @default null */
                        year?: number | null;
                    }[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    submitResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kullanılmaz; yalnız ret ve telif bildiriminde */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    publishResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kullanılmaz; yalnız ret ve telif bildiriminde */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    withdrawResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kullanılmaz; yalnız ret ve telif bildiriminde */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    approveResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kullanılmaz; yalnız ret ve telif bildiriminde */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    rejectResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Gerekçe (5–1000 karakter, kırpılır) */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reopenResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kullanılmaz; yalnız ret ve telif bildiriminde */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archiveResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kullanılmaz; yalnız ret ve telif bildiriminde */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reportResourceVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
                /** @description Sürüm kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Gerekçe (5–1000 karakter, kırpılır) */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    removeResource: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Gerekçe (5–1000 karakter, kırpılır) */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceRemovalResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    shareResource: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    scope: "private" | "students" | "classes" | "department" | "institution";
                    /** @default [] */
                    studentIds?: string[];
                    /** @default [] */
                    classIds?: string[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceShareResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    copyResource: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path: {
                /** @description Kaynak kimliği */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ResourceWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listRubrics: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Baş sürümün becerisi */
                skill?: "writing" | "speaking" | "mediation";
                /** @description Baş sürümün türü: analitik veya bütüncül */
                kind?: "analytic" | "holistic";
                /** @description Baş sürümün durumu */
                status?: "draft" | "published" | "archived";
                /** @description Rubrik sahibi (ör. "Benim rubriklerim") */
                ownerUserId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricListItem"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createRubric: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    /** @enum {string} */
                    kind: "analytic" | "holistic";
                    /** @enum {string} */
                    skill: "writing" | "speaking" | "mediation";
                    criteria: {
                        id: string;
                        /** @enum {string} */
                        aspect: "overall" | "task_fulfilment" | "coherence_cohesion" | "vocabulary" | "grammatical_accuracy" | "range" | "accuracy" | "fluency" | "interaction" | "coherence" | "phonological_control" | "meaning_transfer" | "audience_fit" | "language";
                        /** @default 1 */
                        weight?: number;
                        bands: {
                            band: number;
                            description: string;
                            alignment: {
                                /** @enum {string} */
                                kind: "cefr";
                                scale: string;
                                /** @enum {string} */
                                level: "Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2";
                                index: number;
                            } | {
                                /** @enum {string} */
                                kind: "outcome";
                                outcomeId: string;
                                /** @enum {string} */
                                outcomeSource: "platform" | "institution";
                            };
                        }[];
                    }[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getRubric: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Rubrik kimliği */
                rubricId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getRubricVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Rubrik sürümü kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricVersion"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createRubricVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
            };
            path: {
                /** @description Rubrik kimliği */
                rubricId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    /** @enum {string} */
                    kind: "analytic" | "holistic";
                    /** @enum {string} */
                    skill: "writing" | "speaking" | "mediation";
                    criteria: {
                        id: string;
                        /** @enum {string} */
                        aspect: "overall" | "task_fulfilment" | "coherence_cohesion" | "vocabulary" | "grammatical_accuracy" | "range" | "accuracy" | "fluency" | "interaction" | "coherence" | "phonological_control" | "meaning_transfer" | "audience_fit" | "language";
                        /** @default 1 */
                        weight?: number;
                        bands: {
                            band: number;
                            description: string;
                            alignment: {
                                /** @enum {string} */
                                kind: "cefr";
                                scale: string;
                                /** @enum {string} */
                                level: "Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2";
                                index: number;
                            } | {
                                /** @enum {string} */
                                kind: "outcome";
                                outcomeId: string;
                                /** @enum {string} */
                                outcomeSource: "platform" | "institution";
                            };
                        }[];
                    }[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateRubricDraft: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Rubrik kimliği */
                rubricId: string;
                /** @description Rubrik sürümü kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string;
                    /** @enum {string} */
                    kind?: "analytic" | "holistic";
                    /** @enum {string} */
                    skill?: "writing" | "speaking" | "mediation";
                    /** @description Kriterler bütün olarak değişir */
                    criteria?: {
                        id: string;
                        /** @enum {string} */
                        aspect: "overall" | "task_fulfilment" | "coherence_cohesion" | "vocabulary" | "grammatical_accuracy" | "range" | "accuracy" | "fluency" | "interaction" | "coherence" | "phonological_control" | "meaning_transfer" | "audience_fit" | "language";
                        /** @default 1 */
                        weight?: number;
                        bands: {
                            band: number;
                            description: string;
                            alignment: {
                                /** @enum {string} */
                                kind: "cefr";
                                scale: string;
                                /** @enum {string} */
                                level: "Pre-A1" | "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C2";
                                index: number;
                            } | {
                                /** @enum {string} */
                                kind: "outcome";
                                outcomeId: string;
                                /** @enum {string} */
                                outcomeSource: "platform" | "institution";
                            };
                        }[];
                    }[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    publishRubricVersion: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Rubrik kimliği */
                rubricId: string;
                /** @description Rubrik sürümü kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archiveRubricVersion: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Rubrik kimliği */
                rubricId: string;
                /** @description Rubrik sürümü kimliği */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RubricWriteResult"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listTaskAssignments: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Atanan içerik (aynı içeriğin ayrı atamaları, IST-034) */
                resourceId?: string;
                /** @description Görev türü: değerlendirme veya alıştırma */
                kind?: "evaluation" | "practice";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAssignment"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createTaskAssignment: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    resourceVersionId: string;
                    /** @default {} */
                    settings?: {
                        /**
                         * @default {
                         *       "kind": "evaluation"
                         *     }
                         */
                        attempts?: {
                            /** @enum {string} */
                            kind: "evaluation";
                            /** @default 1 */
                            maxAttempts?: number;
                            /**
                             * @default first
                             * @enum {string}
                             */
                            countPolicy?: "first" | "highest";
                        } | {
                            /** @enum {string} */
                            kind: "practice";
                        };
                        /** @default {} */
                        deadline?: {
                            /** @default null */
                            dueAt?: string | null;
                            /** @default 0 */
                            lateAcceptanceDays?: number;
                        };
                        timeLimitMinutes?: number | null;
                        /**
                         * @description Dinleme hakkı; gönderilmezse sınırsız. Dinleme sayımı açılana kadar yalnız sınırsız kabul edilir.
                         * @default null
                         */
                        listeningPlays?: (1 | 2) | null;
                        /** @default false */
                        showTranscript?: boolean;
                        /** @default null */
                        submission?: ({
                            /** @enum {string} */
                            submissionKind: "text";
                            /** @default 3 */
                            maxVersions?: number;
                            /** @default null */
                            minWords?: number | null;
                            /** @default null */
                            maxWords?: number | null;
                        } | {
                            /** @enum {string} */
                            submissionKind: "file";
                            /** @default 3 */
                            maxVersions?: number;
                        } | {
                            /** @enum {string} */
                            submissionKind: "audio";
                            /** @default 3 */
                            maxVersions?: number;
                            /** @default 1 */
                            speakingAttempts?: number;
                            /** @default 0 */
                            preparationSeconds?: number;
                            speakingSeconds: number;
                        }) | null;
                        /** @default false */
                        highStakes?: boolean;
                        secondRatingPercent?: number;
                        /** @default null */
                        rubricVersionId?: string | null;
                    };
                    targets: {
                        /** @enum {string} */
                        kind: "class" | "group" | "student";
                        id: string;
                    }[];
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAssignmentStaff"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getTaskAssignment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAssignmentDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateTaskAssignment: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Yeni son teslim ve geç kabul; yalnız uzatılabilir (DOM-BEC-044) */
                    deadline?: {
                        /** @default null */
                        dueAt?: string | null;
                        /** @default 0 */
                        lateAcceptanceDays?: number;
                    };
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAssignmentStaff"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listTaskAttempts: {
        parameters: {
            query: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Atama (zorunlu) */
                assignmentId: string;
                /** @description Kursiyer süzgeci; okuma kapsamı dışındaki kursiyer boş liste verir */
                learnerId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAttempt"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getTaskAttempt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Deneme kimliği */
                attemptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAttemptDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    saveTaskAttemptAnswers: {
        parameters: {
            query?: never;
            header: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Deneme kimliği */
                attemptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Kaydedilecek cevaplar; yalnız gönderilen sorular güncellenir */
                    answers: {
                        [key: string]: {
                            /** @enum {string} */
                            questionType: "multiple_choice";
                            optionId: string | null;
                        } | {
                            /** @enum {string} */
                            questionType: "true_false";
                            answer: ("true" | "false" | "not_given") | null;
                        } | {
                            /** @enum {string} */
                            questionType: "matching";
                            pairs: {
                                promptId: string;
                                choiceId: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "gap_fill";
                            gaps: {
                                gapId: string;
                                value: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "ordering";
                            order: string[];
                        } | {
                            /** @enum {string} */
                            questionType: "short_answer";
                            value: string;
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAttemptDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    startTaskAttempt: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAttemptDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    submitTaskAttempt: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Deneme kimliği */
                attemptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Teslimle birlikte kaydedilecek son cevaplar; süre dolduysa alınmaz */
                    answers?: {
                        [key: string]: {
                            /** @enum {string} */
                            questionType: "multiple_choice";
                            optionId: string | null;
                        } | {
                            /** @enum {string} */
                            questionType: "true_false";
                            answer: ("true" | "false" | "not_given") | null;
                        } | {
                            /** @enum {string} */
                            questionType: "matching";
                            pairs: {
                                promptId: string;
                                choiceId: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "gap_fill";
                            gaps: {
                                gapId: string;
                                value: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            questionType: "ordering";
                            order: string[];
                        } | {
                            /** @enum {string} */
                            questionType: "short_answer";
                            value: string;
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskAttemptDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listTaskSubmissions: {
        parameters: {
            query: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Atama (zorunlu) */
                assignmentId: string;
                /** @description Kursiyer süzgeci; okuma kapsamı dışındaki kursiyer boş liste verir */
                learnerId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmission"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listGradingQueue: {
        parameters: {
            query?: {
                /** @description Sayfa numarası */
                page?: number;
                /** @description Sayfa boyutu (≤ 100) */
                pageSize?: number;
                /** @description Atama süzgeci */
                assignmentId?: string;
                /** @description Yalnız ilk puanı veya yalnız ikinci puanı bekleyenler (DOM-BEC-024) */
                awaiting?: "first" | "second";
                /** @description `true` puanlama süresi aşılanlar, `false` aşılmayanlar (DOM-BEC-025) */
                overdue?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["GradingQueueItem"][];
                        meta: components["schemas"]["PageMeta"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getTaskSubmission: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getTaskDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Taslak yoksa `null` */
                        data: components["schemas"]["TaskDraft"] | null;
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    saveTaskDraft: {
        parameters: {
            query?: never;
            header?: {
                /** @description İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
                /** @description İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`. */
                "if-match"?: string;
            };
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Taslak metni; boş olabilir */
                    body: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskDraft"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    submitTaskSubmission: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    submissionKind: "text";
                    /** @description Teslim metni; boş olamaz, gönderildikten sonra değişmez */
                    body: string;
                } | {
                    /** @enum {string} */
                    submissionKind: "file";
                    fileIds: string[];
                } | {
                    /** @enum {string} */
                    submissionKind: "audio";
                    recordingFileId: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    scoreTaskSubmission: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Puanlanan sürüm; yalnız son sürüm puanlanır */
                    versionNumber: number;
                    criteria: {
                        criterionId: string;
                        band: number;
                        /** @default null */
                        comment?: string | null;
                    }[];
                    overallComment: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    requestTaskResubmission: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    versionNumber: number;
                    /** Format: date-time */
                    dueAt: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    secondScoreTaskSubmission: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Puanlanan sürüm; yalnız son sürüm puanlanır */
                    versionNumber: number;
                    criteria: {
                        criterionId: string;
                        band: number;
                        /** @default null */
                        comment?: string | null;
                    }[];
                    overallComment: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    requestSecondRating: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description İkinci puanlaması istenen sürüm; yalnız son sürüm */
                    versionNumber: number;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    drawSecondRatingSample: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Atama kimliği */
                assignmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["SecondRatingSample"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    fileTaskAppeal: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description İtiraz edilen sürüm */
                    versionNumber: number;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    decideTaskAppeal: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
                /** @description Zorunlu iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`); yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. */
                "if-match": string;
            };
            path: {
                /** @description Teslim kimliği */
                submissionId: string;
                /** @description İtiraz kimliği */
                appealId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    outcome: "upheld";
                    reason: string;
                    score: {
                        criteria: {
                            criterionId: string;
                            band: number;
                            /** @default null */
                            comment?: string | null;
                        }[];
                        overallComment: string;
                    };
                } | {
                    /** @enum {string} */
                    outcome: "rejected";
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TaskSubmissionDetail"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    uploadFile: {
        parameters: {
            query?: never;
            header: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["FileUploadBodyInput"] | null;
            };
        };
        responses: {
            /** @description Default Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["File"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Dosya kimliği */
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["File"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getFileUrl: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Dosya kimliği */
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["FileUrl"];
                    };
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    downloadFile: {
        parameters: {
            query: {
                /** @description İmzalı bağlantı belirteci */
                token: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dosya içeriği (ikili; türü `Content-Type` başlığında) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Default Response */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Default Response */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
