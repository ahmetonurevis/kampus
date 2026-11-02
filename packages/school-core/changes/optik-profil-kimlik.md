---
etki: patch
---

- Optik profil düzenlemesi (`runAssessment('profile', …, profileId)`) olmayan ya da başka kurumun profil kimliğinde sınav çakışmasından (`optical_profile_exists`, 409) önce `record_not_found` (404) döner; yanıt sınavın kendi profilini ele vermez (OG-034; IST-002).
