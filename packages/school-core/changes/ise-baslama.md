---
etki: minor
---

- İş teklifi kuralı eklendi (`lib/finance-staff-onboarding.ts`, DOM-FIN-121): taslak, gönderildi, kabul, ret ve geri çekildi durumları (`jobOfferInputSchema`, `jobOfferUpdateSchema`, `planJobOffer`, `planJobOfferUpdate`, `planJobOfferSend`, `planJobOfferDecision`, `planJobOfferWithdraw`). Aday personel değilse yalnız adı ve iletişimi, personelse üyeliği tutulur; gönderilen teklif değişmez, son yanıt günü geçen teklif kabul edilmez. Teklif mektubu metni `jobOfferLetterParagraphs`, `jobOfferWageText`.
- İşe başlama listesi: kabulde açılan adımlar `buildOnboardingSteps` (hesap, zorunlu özlük belgesi türleri, öğretmende çalışma onayı, ücret tanımı, kıdem başlangıcı, zimmet, oryantasyon), kaynak durumu `onboardingStepEvidence`, ilerleme ve durum `onboardingProgress`, `onboardingState`; adım işaretleme, geri alma, sorumlu ve hesap bağlama kuralları (`planOnboardingStepComplete`, `planOnboardingStepReopen`, `planOnboardingStepUpdate`, `planOnboardingLink`); oryantasyon ayarı `onboardingSettingsSchema`, varsayılan `DEFAULT_ORIENTATION_STEPS`.
