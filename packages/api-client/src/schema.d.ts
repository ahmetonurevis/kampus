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
}
