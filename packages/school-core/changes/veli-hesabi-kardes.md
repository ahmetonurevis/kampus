---
etki: patch
---

- Kesin kayıtta mevcut veli kaydına bağlanan kardeş, velinin etkin hesabına da bağlanır (ON-128, DOM-KAY-013): bağ `membership_id` ile yazılır ve hesaba çocuk bağlantısı eklenir; veli yeni çocuğu ayrıca bağlanmadan görür. Devre dışı hesapta ya da kayıtla birden çok hesap eşlenmiş göründüğünde bağ hesapsız kalır.
