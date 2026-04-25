# 📚 English Vocabulary Master

> *"Bạn có biết sự khác biệt giữa '0%' và '0.01%' mỗi ngày là gì không? Đó chính là ranh giới giữa 'không thể' và 'có thể'."*

**English Vocabulary Master** là một ứng dụng web (Web App) giúp người dùng lưu trữ, quản lý và ôn tập từ vựng tiếng Anh một cách có hệ thống. Ứng dụng tự động hóa quá trình tra từ điển, theo dõi tiến độ học tập và cung cấp nhiều chế độ luyện tập đa dạng để giúp người học ghi nhớ từ vựng sâu hơn.

---

## ✨ Tính năng nổi bật

### 🔐 1. Xác thực người dùng (Authentication)
- Đăng nhập / Đăng ký bằng Email và Mật khẩu.
- Đăng nhập nhanh qua tài khoản **Google**.
- Tính năng khôi phục (Quên mật khẩu).
- Dữ liệu người dùng được bảo mật và đồng bộ trên Cloud.

### 🗂️ 2. Quản lý hệ thống buổi học
- Phân chia từ vựng theo từng "Buổi học" (Session) giúp người học không bị ngợp.
- Thêm, xem, tìm kiếm và xóa các buổi học dễ dàng.

### 🤖 3. Thêm từ vựng thông minh (Smart Vocabulary Adding)
- **Tự động tra cứu:** Chỉ cần nhập từ tiếng Anh, hệ thống sẽ gọi API để tự động lấy:
  - Phiên âm chuẩn (Phonetics).
  - File phát âm âm thanh (Audio).
  - Từ loại (Part of Speech).
- **Tự động dịch:** Tích hợp API Dịch thuật để tự động chuyển đổi định nghĩa tiếng Anh sang tiếng Việt.
- **Chống trùng lặp:** Hệ thống cảnh báo và ngăn chặn nếu bạn thêm một từ đã tồn tại trong cùng một buổi học.

### 🎮 4. Khu vực Luyện tập Đa chế độ (Practice Modes)
- **Quiz:** Trắc nghiệm từ vựng với cấu hình tùy chỉnh (số lượng câu, chiều dịch Anh-Việt / Việt-Anh / Trộn ngẫu nhiên). Thuật toán tính toán độ thành thạo (Accuracy & Mastery).
- **Spelling:** Luyện gõ đúng chính tả từ tiếng Anh dựa trên nghĩa tiếng Việt.
- **Listening:** Nghe phát âm chuẩn và gõ lại từ (Sử dụng Audio gốc hoặc SpeechSynthesis API của trình duyệt).
- **Sentence:** Luyện đặt câu có chứa từ vựng mục tiêu.

### 📊 5. Thống kê & Theo dõi tiến độ
- Dashboard tổng quan hiển thị: Tổng số từ, số buổi học, số từ đã thuộc (Mastered), và tỉ lệ chính xác trung bình.
- Bảng xếp hạng (Ranking): Xếp hạng các từ vựng dựa trên độ ghi nhớ, giúp người học nhận biết từ nào đã thuộc và từ nào cần ôn tập thêm.
- Lưu trữ Lịch sử Quiz để xem lại điểm số và quá trình tiến bộ.

---

## 🛠️ Công nghệ sử dụng

- **Frontend:**
  - HTML5, CSS3 (Custom UI/UX, Responsive Design).
  - Vanilla JavaScript (ES6 Modules, thao tác DOM trực tiếp).
- **Backend & Cơ sở dữ liệu:**
  - **Firebase Authentication:** Quản lý đăng nhập/đăng ký.
  - **Firebase Cloud Firestore:** Lưu trữ dữ liệu từ vựng, buổi học, lịch sử và điểm số theo thời gian thực (Realtime NoSQL).
- **APIs Tích hợp:**
  - [Free Dictionary API](https://dictionaryapi.dev/): Lấy phiên âm, từ loại và phát âm tiếng Anh.
  - Tích hợp API dịch thuật (Google Translate) hỗ trợ dịch nghĩa tự động.

---

## 🚀 Hướng dẫn cài đặt và chạy máy chủ cục bộ (Local)

Vì dự án sử dụng ES6 Modules (`type="module"`) và tích hợp Firebase, bạn cần chạy code thông qua một local server (không thể mở trực tiếp file HTML bằng trình duyệt qua giao thức `file://`).

### Bước 1: Clone dự án
```bash
git clone https://github.com/kyvu09/learn-english-vocabulary.git
cd learn-english-vocabulary
