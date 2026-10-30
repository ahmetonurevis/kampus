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
         * @description Etkin kurumun koleksiyon kayıtlarını rol kapsamıyla, sayfalı döndürür. Kapalı modül 403 `module_disabled`, rolün okuyamadığı koleksiyon 403 `forbidden`, bilinmeyen koleksiyon 404.
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
    "/api/v1/collections/{collection}/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Koleksiyon kaydı
         * @description Tek kayıt. Yok, arşivde veya başka kuruma ait kayıt 404 (varlığı sızdırılmaz); kapsam ve modül kuralları listeyle aynıdır.
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
                /** @description Modül anahtarı → açık mı. school-core modül kaydındaki her modül listelenir; kapalı modülün API uçları 403 `module_disabled` döner */
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
                /** @description Modül anahtarı → açık mı. school-core modül kaydındaki her modül listelenir; kapalı modülün API uçları 403 `module_disabled` döner */
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
                /** @description Serbest arama; Türkçe büyük/küçük harf ve aksan duyarsız */
                q?: string;
                /** @description En çok üç alan, virgülle; eksi azalan (ör. `-createdAt,name`). Alanlar: id, createdAt, updatedAt, name, title, date, dueDate, deadline, followUp, status, stage, grade, score, amount, installment, number. Verilmezse deponun sırası */
                sort?: string;
                /** @description Arşivliler varsayılan olarak dönmez; `include` ekler, `only` yalnız onları verir */
                archived?: "include" | "only";
                /** @description `studentId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                studentId?: string | string[];
                /** @description `classId` eşitlik filtresi; çoklu değer parametre tekrarıyla */
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
                /** @description `status` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                status?: string | string[];
                /** @description `stage` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                stage?: string | string[];
                /** @description `category` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                category?: string | string[];
                /** @description `type` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                type?: string | string[];
                /** @description `grade` eşitlik filtresi; çoklu değer parametre tekrarıyla */
                grade?: string | string[];
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
}
