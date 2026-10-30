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
        patch?: never;
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
        patch?: never;
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
        patch?: never;
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
        post?: never;
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
            resource: {
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
            };
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
        ErrorResponse: {
            /** @description Kararlı, İngilizce, snake_case hata kodu */
            code: string;
            /** @description Kullanıcıya gösterilebilir Türkçe mesaj */
            message: string;
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
            resource: {
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
            };
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
                /** @description `category` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                category?: string | string[];
                /** @description `type` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                type?: string | string[];
                /** @description `grade` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                grade?: string | string[];
                /** @description Gruplama alanı (zorunlu) ya da aylık gruplama `<tarih alanı>:month` (ör. `paidAt:month`, `dueDate:month`; değer `YYYY-MM`, Europe/Istanbul ayı; tarih alanı `dateField` izin listesindedir, dışındaki 400; tarih olmayan değer `null` grubudur). Rolün göremediği alan 400. `isActive` alanı olmayan kayıt `true`; `invoices` `status`u türetilmiş durumdur; kaydında sınıf olmayan öğrenci koleksiyonlarında (`classId` süzgeciyle aynı liste) `classId` öğrencinin güncel sınıfıdır */
                groupBy: "studentId" | "classId" | "teacherId" | "subjectId" | "branchId" | "parentId" | "examId" | "clubId" | "routeId" | "quizId" | "homeworkId" | "videoId" | "status" | "stage" | "category" | "type" | "grade" | "isActive" | "level" | "date:month" | "joinedAt:month" | "dueDate:month" | "paidAt:month" | "createdAt:month" | "trialAt:month" | "submittedAt:month" | "answeredAt:month" | "followUp:month" | "deadline:month" | "reviewedAt:month" | "endDate:month" | "consentDeadline:month";
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
}
