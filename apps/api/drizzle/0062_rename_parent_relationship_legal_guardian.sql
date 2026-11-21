-- Veli yakınlığında yasal vasi değeri `'guardian'`dan `'legal_guardian'`a geçti (DOM-KAY-012,
-- b33fbff8): eski ad sözleşmenin ödeyici değeri (`payer: 'guardian'`) ve kesin kayıt gövdesindeki
-- `guardian` nesnesiyle karışıyordu. Yeniden adlandırmadan önce kesin kayıtla açılan veli kayıtları
-- (`records`, `collection = 'parents'`) yakınlığı `data.relationship = 'guardian'` olarak
-- saklamış olabilir; bu değer artık `GUARDIAN_RELATIONSHIPS` içinde yok ve kardeş kaydında veli
-- bağına (`student_guardians`) `other` olarak geçerdi. Değer yenisine çevrilir; arşivli kayıt da
-- çevrilir, geri alındığında şemaya uysun. Sürüm artar: eski sürümle yazmak isteyen istemci 409
-- alır, sessiz üzerine yazma olmaz. Yalnız eski değerli satıra dokunduğu için idempotenttir;
-- yeniden çalışınca hiçbir satır değişmez. `student_guardians` kısıtı (0027) eski değeri hiç
-- kabul etmediğinden o tabloda dönüştürülecek satır yoktur; denetim kaydı (`audit_log`) yalnız
-- eklenir ve geçmiş olarak olduğu gibi kalır.
UPDATE "records"
   SET "data" = jsonb_set("data", '{relationship}', '"legal_guardian"'::jsonb),
       "updated_at" = now(),
       "version" = "version" + 1
 WHERE "collection" = 'parents'
   AND "data" ->> 'relationship' = 'guardian';
