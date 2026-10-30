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
         * @description Taksiti ödenmiş işaretler (core `payInvoice`). `Idempotency-Key` zorunludur; ödenmiş taksit 409 `invoice_already_paid`. Roller: `yonetici`, `onburo`.
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
         * @description Sınıfın günlük yoklamasını yazar (core `recordAttendance`); aynı öğrenci ve gün için kayıt yinelenmez, güncellenir. `If-Match` sınıf kaydının sürümüdür; tutmazsa 409 `version_conflict`. Roller: `yonetici`; `ogretmen` yalnız core kapsamındaki sınıfta.
         */
        post: operations["recordClassAttendance"];
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
         * @description Kampüs kaydını arşivler (core `archiveRecord`); bağlı kayıtlar `replacementId`'ye aktarılır, geçmiş finans/not/yoklama korunur. Rol: `yonetici`.
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
         * @description Kampüs kaydını arşivden geri alır (core `restoreRecord`); aktarılan görevler otomatik geri taşınmaz. Rol: `yonetici`.
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
         * @description Sınıf kaydını arşivler (core `archiveRecord`); bağlı kayıtlar `replacementId`'ye aktarılır, geçmiş finans/not/yoklama korunur. Rol: `yonetici`.
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
         * @description Sınıf kaydını arşivden geri alır (core `restoreRecord`); aktarılan görevler otomatik geri taşınmaz. Rol: `yonetici`.
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
         * @description Öğretmen kaydını arşivler (core `archiveRecord`); bağlı kayıtlar `replacementId`'ye aktarılır, geçmiş finans/not/yoklama korunur. Rol: `yonetici`.
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
         * @description Öğretmen kaydını arşivden geri alır (core `restoreRecord`); aktarılan görevler otomatik geri taşınmaz. Rol: `yonetici`.
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
                /** @description `date` alanının Europe/Istanbul günü için başlangıç (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateFrom?: string;
                /** @description `date` alanının Europe/Istanbul günü için bitiş (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateTo?: string;
                /** @description `studentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                studentId?: string | string[];
                /** @description `classId` eşitlik filtresi; çoklu değer parametre tekrarıyla. Kaydında sınıf olmayan öğrenci koleksiyonlarında (`grades`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`) öğrencinin güncel sınıfıdır */
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
                /** @description `date` alanının Europe/Istanbul günü için başlangıç (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateFrom?: string;
                /** @description `date` alanının Europe/Istanbul günü için bitiş (`YYYY-MM-DD`, dahil). Gün (`YYYY-MM-DD`) veya an (ISO UTC) değerli kayıtlar eşlenir */
                dateTo?: string;
                /** @description `studentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                studentId?: string | string[];
                /** @description `classId` eşitlik filtresi; çoklu değer parametre tekrarıyla. Kaydında sınıf olmayan öğrenci koleksiyonlarında (`grades`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`) öğrencinin güncel sınıfıdır */
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
                /** @description Gruplama alanı (zorunlu). Rolün göremediği alan 400. `isActive` alanı olmayan kayıt `true`; `invoices` `status`u türetilmiş durumdur; kaydında sınıf olmayan öğrenci koleksiyonlarında `classId` öğrencinin güncel sınıfıdır */
                groupBy: "studentId" | "classId" | "teacherId" | "subjectId" | "branchId" | "parentId" | "examId" | "clubId" | "routeId" | "quizId" | "homeworkId" | "videoId" | "status" | "stage" | "category" | "type" | "grade" | "isActive" | "level";
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
            header?: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
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
            header?: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
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
            header?: {
                /** @description Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır. */
                "idempotency-key"?: string;
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
                    /** @description Ödeme yöntemi (ör. `Kredi kartı`, `Nakit`, `Havale/EFT`) */
                    method: string;
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
}
