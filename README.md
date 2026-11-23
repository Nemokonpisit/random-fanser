# Lucky Draw QR

เว็บสุ่มชื่อสำหรับกิจกรรม: host กรอกเวลา → สร้าง QR → ผู้ร่วมกิจกรรมสแกนและกรอกชื่อ → ปิดรับชื่อ → สุ่มผู้โชคดี 1 คน แล้วเริ่มรอบใหม่ได้ทันที

## เริ่มใช้งาน

```powershell
node server.js
```

เปิด `http://localhost:3125/` บนเครื่อง host และใช้ URL ที่ server แสดงเป็นที่อยู่สำหรับมือถือใน Wi‑Fi เดียวกัน ตัว QR จะสร้างลิงก์จากที่อยู่ LAN ให้อัตโนมัติเมื่อ host เปิดผ่าน localhost

ถ้ามี Windows Firewall ถาม ให้กดอนุญาตการเชื่อมต่อในเครือข่าย Private เพื่อให้มือถืออื่นเข้าถึงรอบได้

## หมายเหตุ

- ข้อมูลรอบเก็บในหน่วยความจำของ server และจะหายเมื่อปิด server
- ผู้ร่วมกิจกรรมแต่ละเครื่องส่งชื่อได้หนึ่งครั้งต่อรอบ
- ตัวสร้าง QR โหลดจาก CDN ตอนเปิดหน้าเว็บ หากหน้างานไม่มีอินเทอร์เน็ต ให้ดาวน์โหลด `qrcode.min.js` มาไว้ใน `public/vendor/` แล้วเปลี่ยน script ใน `public/index.html` เป็นไฟล์ local

## Deploy บน Netlify

โปรเจกต์มี `netlify.toml` และ Netlify Function พร้อมแล้ว โดยใช้ Netlify Blobs เก็บข้อมูลห้องและใช้ polling อัปเดตชื่อข้ามมือถือ

สำคัญ: ต้อง deploy จากโฟลเดอร์หลักของ repository นี้ (ไม่ใช่ลากเฉพาะโฟลเดอร์ `public`) เพื่อให้ Netlify เห็นทั้ง `netlify/functions` และ `netlify.toml` โดยตั้งค่าเป็น `Publish directory = public`, `Functions directory = netlify/functions` และใช้ Build command ตาม `netlify.toml` (`npm ci`) หากหน้าเว็บแจ้งว่าไม่พบ API ให้ตรวจสอบจุดนี้ก่อน
