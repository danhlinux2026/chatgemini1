export type GeminiModelId =
  | 'gemini-3.8-flash'
  | 'gemini-flash-latest'
  | 'gemini-3.1-flash-lite';

export type ThinkingLevelOption = 'HIGH' | 'LOW' | 'MINIMAL';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  data: string; // base64 string without prefix
  previewUrl: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  model?: GeminiModelId;
  keyLabel?: string;
  rotated?: boolean;
  attachments?: Attachment[];
  sources?: GroundingSource[];
  error?: {
    code: string;
    message: string;
    hint: string;
  };
  latencyMs?: number;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  personaId: string;
  customSystemInstruction?: string;
  model: GeminiModelId;
  thinkingLevel: ThinkingLevelOption;
  useSearch: boolean;
  temperature: number;
  autoModelFallback?: boolean;
  messages: ChatMessage[];
}

export interface KeySlotStatus {
  index: number;
  label: string;
  envSource: string;
  status: 'ready' | 'cooldown';
  cooldownRemainingSec: number;
  totalRequests: number;
  rateLimitHits: number;
}

export interface ServerPoolStatus {
  checked: boolean;
  configured: boolean;
  totalKeys: number;
  activeKeys: number;
  strategy: 'failover' | 'round-robin';
  slots: KeySlotStatus[];
}

export interface PersonaPreset {
  id: string;
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
}

export interface PromptTemplate {
  id: string;
  category: 'engineering' | 'analysis' | 'writing' | 'learning';
  categoryLabel: string;
  title: string;
  description: string;
  prompt: string;
  recommendedModel: GeminiModelId;
  recommendedThinking: ThinkingLevelOption;
  useSearch?: boolean;
}
