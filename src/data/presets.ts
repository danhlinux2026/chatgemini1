import { GeminiModelId, PersonaPreset, PromptTemplate } from '../types/chat';

export interface ModelMetadata {
  id: GeminiModelId;
  name: string;
  summary: string;
  speedLabel: string;
  contextWindow: string;
  freeTierRpm: string;
  freeTierRpd: string;
  freeTierTpm: string;
}

export const AVAILABLE_MODELS: ModelMetadata[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    summary: 'Mô hình đa phương thức cân bằng tối ưu giữa tốc độ phản hồi và khả năng suy luận sâu.',
    speedLabel: 'Tiêu chuẩn · Đa năng',
    contextWindow: '1M tokens',
    freeTierRpm: '15 RPM',
    freeTierRpd: '1,500 RPD',
    freeTierTpm: '1M TPM',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    summary: 'Bản cập nhật Flash mới nhất từ Google AI Studio cho tác vụ tổng hợp và phân tích.',
    speedLabel: 'Cập nhật mới nhất',
    contextWindow: '1M tokens',
    freeTierRpm: '15 RPM',
    freeTierRpd: '1,500 RPD',
    freeTierTpm: '1M TPM',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    summary: 'Phản hồi tức thì với độ trễ cực thấp, tối ưu cho tóm tắt nhanh, dịch thuật và hỏi đáp.',
    speedLabel: 'Siêu tốc · Độ trễ thấp',
    contextWindow: '1M tokens',
    freeTierRpm: '30 RPM',
    freeTierRpd: '1,500 RPD',
    freeTierTpm: '1M TPM',
  },
];

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'default',
    name: 'Trợ lý Toàn diện',
    role: 'General AI Assistant',
    description: 'Trả lời rõ ràng, chính xác, có cấu trúc mạch lạc bằng tiếng Việt hoặc ngôn ngữ người dùng yêu cầu.',
    systemInstruction:
      'Bạn là một trợ lý AI thông minh, chính xác và chuyên nghiệp. Hãy trình bày câu trả lời rõ ràng, có cấu trúc hợp lý với Markdown khi cần thiết, đi thẳng vào trọng tâm và đưa ra ví dụ thực tế.',
  },
  {
    id: 'architect',
    name: 'Kỹ sư Phần mềm Senior',
    role: 'Staff Software Engineer',
    description: 'Chuyên sâu về kiến trúc hệ thống, TypeScript, Python, tối ưu hiệu năng và rà soát lỗi mã nguồn.',
    systemInstruction:
      'Bạn là một Kỹ sư Phần mềm Senior (Staff Engineer). Khi viết code, hãy luôn tuân thủ nguyên tắc Clean Code, xử lý lỗi đầy đủ, chú thích ngắn gọn những điểm quan trọng và giải thích độ phức tạp thuật toán hoặc lý do chọn giải pháp kiến trúc đó.',
  },
  {
    id: 'analyst',
    name: 'Chuyên gia Phân tích & Nghiên cứu',
    role: 'Research & Data Strategist',
    description: 'Phân tích số liệu, tổng hợp báo cáo thị trường, so sánh ưu nhược điểm bằng bảng biểu trực quan.',
    systemInstruction:
      'Bạn là Chuyên gia Phân tích Dữ liệu và Chiến lược. Hãy phân tích vấn đề dựa trên bằng chứng, trình bày các góc nhìn đa chiều, lập bảng so sánh rõ ràng và luôn tóm tắt các khuyến nghị hành động cụ thể ở cuối bài.',
  },
  {
    id: 'writer',
    name: 'Biên tập viên Nội dung',
    role: 'Editorial & Copywriting Specialist',
    description: 'Soạn thảo email đối tác, tài liệu sản phẩm (PRD), bài viết chuyên sâu với văn phong tự nhiên.',
    systemInstruction:
      'Bạn là Biên tập viên Nội dung cao cấp. Hãy sử dụng ngôn từ tinh tế, mạch lạc, giàu sức thuyết phục, tránh lối viết sáo rỗng máy móc và điều chỉnh giọng điệu phù hợp với đối tượng độc giả mục tiêu.',
  },
];

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'code-review',
    category: 'engineering',
    categoryLabel: 'Kỹ thuật phần mềm',
    title: 'Thiết kế kiến trúc REST / Full-Stack API',
    description: 'Xây dựng cấu trúc dự án, định nghĩa schema, bảo mật và xử lý lỗi chuẩn Production.',
    prompt:
      'Hãy thiết kế kiến trúc hệ thống và viết mã mẫu cho một dịch vụ REST API quản lý đơn hàng thời gian thực bằng TypeScript và Node.js. Bao gồm: cấu trúc thư mục, xử lý bất đồng bộ, kiểm tra dữ liệu đầu vào và chiến lược chống quá tải (rate-limiting).',
    recommendedModel: 'gemini-3.8-flash',
    recommendedThinking: 'HIGH',
  },
  {
    id: 'sql-optimize',
    category: 'engineering',
    categoryLabel: 'Kỹ thuật phần mềm',
    title: 'Tối ưu hóa truy vấn cơ sở dữ liệu',
    description: 'Phân tích điểm nghẽn truy vấn SQL, đề xuất đánh chỉ mục (Index) và viết lại câu lệnh.',
    prompt:
      'Giải thích các nguyên nhân phổ biến khiến truy vấn PostgreSQL trên bảng có 50 triệu bản ghi bị chậm. Hãy đưa ra 4 kịch bản thực tế kèm câu lệnh SQL trước và sau khi tối ưu hóa, cùng chiến lược tạo Composite Index.',
    recommendedModel: 'gemini-3.8-flash',
    recommendedThinking: 'HIGH',
  },
  {
    id: 'market-research',
    category: 'analysis',
    categoryLabel: 'Phân tích & Dữ liệu',
    title: 'Tổng hợp xu hướng công nghệ mới nhất',
    description: 'Sử dụng Google Search để tra cứu thông tin thời gian thực và lập bảng so sánh.',
    prompt:
      'Hãy tìm kiếm và tổng hợp những xu hướng nổi bật nhất về ứng dụng AI trong phát triển phần mềm doanh nghiệp năm nay. Trình bày thành bảng so sánh gồm: Xu hướng, Lợi ích cốt lõi, Rủi ro triển khai và Ví dụ thực tế.',
    recommendedModel: 'gemini-3.8-flash',
    recommendedThinking: 'LOW',
    useSearch: true,
  },
  {
    id: 'product-prd',
    category: 'writing',
    categoryLabel: 'Soạn thảo & Sản phẩm',
    title: 'Soạn tài liệu đặc tả sản phẩm (PRD)',
    description: 'Khung tài liệu PRD hoàn chỉnh gồm mục tiêu, user stories, luồng trải nghiệm và chỉ số đo lường.',
    prompt:
      'Hãy giúp tôi soạn một tài liệu Đặc tả Yêu cầu Sản phẩm (PRD) cho tính năng "Báo cáo chi tiêu thông minh tự động phân loại hóa đơn". Bao gồm: Bối cảnh vấn đề, Mục tiêu kinh doanh, User Stories, Yêu cầu chức năng và Chỉ số đo lường thành công (KPIs).',
    recommendedModel: 'gemini-3.8-flash',
    recommendedThinking: 'LOW',
  },
  {
    id: 'explain-concept',
    category: 'learning',
    categoryLabel: 'Học tập & Nghiên cứu',
    title: 'Giải thích chuyên sâu theo phương pháp Feynman',
    description: 'Bóc tách các khái niệm phức tạp thành nguyên lý cơ bản kèm ví dụ minh họa.',
    prompt:
      'Hãy giải thích cơ chế hoạt động của kiến trúc Transformer và cơ chế Self-Attention theo phương pháp Feynman: bắt đầu bằng giải thích trực quan dễ hiểu, sau đó đi sâu vào bản chất toán học của ma trận Query, Key, Value và cuối cùng là ví dụ ứng dụng thực tế.',
    recommendedModel: 'gemini-3.8-flash',
    recommendedThinking: 'HIGH',
  },
  {
    id: 'bilingual-translate',
    category: 'learning',
    categoryLabel: 'Học tập & Nghiên cứu',
    title: 'Hiệu đính & Dịch thuật học thuật Anh - Việt',
    description: 'Dịch thuật chuẩn xác thuật ngữ chuyên ngành kèm giải thích ngữ cảnh sử dụng.',
    prompt:
      'Hãy đóng vai chuyên gia biên dịch kỹ thuật. Khi tôi cung cấp một đoạn văn bản tiếng Anh hoặc tiếng Việt, hãy cung cấp: 1) Bản dịch tự nhiên, chuẩn xác nhất; 2) Bản dịch trang trọng dùng trong báo cáo học thuật/doanh nghiệp; 3) Bảng chú giải các thuật ngữ chuyên ngành quan trọng.',
    recommendedModel: 'gemini-3.1-flash-lite',
    recommendedThinking: 'MINIMAL',
  },
];
