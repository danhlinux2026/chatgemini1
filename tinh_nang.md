# Lumina Studio - Trợ lý AI Đa phương thức

## Tổng quan dự án
Lumina Studio là một ứng dụng trợ lý AI đa phương thức (multimodal AI assistant), cho phép người dùng tương tác thông minh với các mô hình Gemini.

## Cấu trúc dự án
- `/src`: Mã nguồn frontend React SPA.
  - `/components`: Các thành phần giao diện (UI components).
- `/server.ts`: Backend Express quản lý API, xác thực, và proxy yêu cầu tới Gemini API.
- `/firebase-applet-config.json`: Cấu hình tích hợp Firebase.

## Ngôn ngữ & Công nghệ
- Frontend: React, TypeScript, Tailwind CSS.
- Backend: Node.js, Express, TypeScript.
- AI SDK: @google/genai (TypeScript SDK).
- Database & Auth: Firebase Firestore & Authentication.

## Tính năng chính
1. **Chat AI Đa phương thức**: Hỗ trợ văn bản, hình ảnh, tệp tin.
2. **Quản lý Cụm Khóa & Tự động Luân chuyển (Failover)**: Tự động xử lý lỗi quá tải (429/503) bằng cách chuyển đổi qua các khóa API dự phòng.
3. **Trò chuyện Giọng nói Gemini Live**: Tích hợp WebSocket bridge thời gian thực.
4. **Tích hợp Terminal/Shell**: Giao diện dòng lệnh cho phép người dùng thực thi các lệnh shell cơ bản (`whoami`, `date`, `ls`, `help`), đồng thời AI có khả năng tự gọi và thực thi các lệnh này thông qua công cụ tích hợp (Tool Calling).
5. **Dashboard Thống kê**: Sử dụng Recharts để theo dõi dữ liệu sử dụng.
6. **Kiểm soát Token**: Hiển thị số lượng token thời gian thực trong khung soạn thảo.
7. **Tìm kiếm & Web Context**: Hỗ trợ phân tích nội dung từ liên kết (GitHub, web) thông qua công cụ tìm kiếm tích hợp.
