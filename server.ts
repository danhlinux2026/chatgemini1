import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, ThinkingLevel, Content, Part, LiveServerMessage, Modality } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const COOLDOWN_MS = 3_000; // 3 seconds instant cooldown for rapid rotation

const ALLOWED_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
] as const;

type AllowedModel = (typeof ALLOWED_MODELS)[number];

interface KeySlot {
  index: number;
  label: string;
  envSource: string;
  key: string;
  cooldownUntil: number;
  totalRequests: number;
  rateLimitHits: number;
}

class KeyPoolManager {
  private slots: KeySlot[] = [];
  private dynamicKeys: Array<{ key: string; label: string }> = [];
  private roundRobinPointer = 0;
  public strategy: 'failover' | 'round-robin' = 'failover';

  constructor() {
    this.reloadFromEnv();
  }

  public setDynamicKeys(keys: Array<{ key: string; label: string }>) {
    this.dynamicKeys = keys;
    this.reloadFromEnv();
  }

  public reloadFromEnv() {
    const existingStats = new Map<
      string,
      { cooldownUntil: number; totalRequests: number; rateLimitHits: number }
    >();
    for (const s of this.slots) {
      existingStats.set(s.key, {
        cooldownUntil: s.cooldownUntil,
        totalRequests: s.totalRequests,
        rateLimitHits: s.rateLimitHits,
      });
    }

    const discovered: Array<{ key: string; envSource: string }> = [];
    const seenKeys = new Set<string>();

    const addKeyCandidates = (raw: string | undefined, sourceName: string) => {
      if (!raw) return;
      const parts = raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const candidate of parts) {
        if (
          candidate &&
          candidate !== 'MY_GEMINI_API_KEY' &&
          !seenKeys.has(candidate)
        ) {
          seenKeys.add(candidate);
          discovered.push({ key: candidate, envSource: sourceName });
        }
      }
    };

    addKeyCandidates(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY');
    addKeyCandidates(process.env.GEMINI_API_KEYS, 'GEMINI_API_KEYS');

    const envKeys = Object.keys(process.env).sort();
    for (const envName of envKeys) {
      if (/^GEMINI_API_KEY_\d+$/i.test(envName)) {
        addKeyCandidates(process.env[envName], envName);
      }
    }

    for (const dyn of this.dynamicKeys) {
      if (dyn.key && !seenKeys.has(dyn.key)) {
        seenKeys.add(dyn.key);
        discovered.push({ key: dyn.key, envSource: dyn.label || 'Firestore DB' });
      }
    }

    this.slots = discovered.map((item, idx) => {
      const prev = existingStats.get(item.key);
      return {
        index: idx + 1,
        label: `Slot #${idx + 1}`,
        envSource: item.envSource,
        key: item.key,
        cooldownUntil: prev?.cooldownUntil ?? 0,
        totalRequests: prev?.totalRequests ?? 0,
        rateLimitHits: prev?.rateLimitHits ?? 0,
      };
    });

    if (this.roundRobinPointer >= this.slots.length) {
      this.roundRobinPointer = 0;
    }
  }

  public resetCooldowns() {
    for (const slot of this.slots) {
      slot.cooldownUntil = 0;
    }
  }

  public getOrderedCandidateSlots(): KeySlot[] {
    this.reloadFromEnv();
    if (this.slots.length === 0) return [];

    const now = Date.now();
    const total = this.slots.length;
    const ordered: KeySlot[] = [];

    if (this.strategy === 'round-robin') {
      for (let i = 0; i < total; i++) {
        const idx = (this.roundRobinPointer + i) % total;
        ordered.push(this.slots[idx]);
      }
      this.roundRobinPointer = (this.roundRobinPointer + 1) % total;
    } else {
      ordered.push(...this.slots);
    }

    const healthy = ordered.filter((s) => s.cooldownUntil <= now);
    const cooling = ordered
      .filter((s) => s.cooldownUntil > now)
      .sort((a, b) => a.cooldownUntil - b.cooldownUntil);

    return [...healthy, ...cooling];
  }

  public markRateLimited(slotIndex: number) {
    const slot = this.slots.find((s) => s.index === slotIndex);
    if (slot) {
      slot.rateLimitHits += 1;
      slot.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
  }

  public markRequestUsed(slotIndex: number) {
    const slot = this.slots.find((s) => s.index === slotIndex);
    if (slot) {
      slot.totalRequests += 1;
    }
  }

  public getFirstAvailableKey(): string | null {
    const slots = this.getOrderedCandidateSlots();
    if (slots.length > 0) return slots[0].key;
    const fallback = process.env.GEMINI_API_KEY;
    if (fallback && fallback !== 'MY_GEMINI_API_KEY') return fallback;
    return null;
  }

  public getPublicStatus() {
    this.reloadFromEnv();
    const now = Date.now();
    return {
      configured: this.slots.length > 0,
      totalKeys: this.slots.length,
      activeKeys: this.slots.filter((s) => s.cooldownUntil <= now).length,
      strategy: this.strategy,
      slots: this.slots.map((s) => ({
        index: s.index,
        label: s.label,
        envSource: s.envSource,
        status: s.cooldownUntil > now ? 'cooldown' : 'ready',
        cooldownRemainingSec:
          s.cooldownUntil > now
            ? Math.ceil((s.cooldownUntil - now) / 1000)
            : 0,
        totalRequests: s.totalRequests,
        rateLimitHits: s.rateLimitHits,
      })),
    };
  }

  public isValidKey(key: string): boolean {
    return this.slots.some((s) => s.key === key);
  }
}

const keyPool = new KeyPoolManager();

function createClientForKey(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isRateLimitOrTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('Too Many Requests') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('overloaded')
  );
}

function getFallbackModelChain(
  primaryModel: AllowedModel,
  autoModelFallback: boolean
): AllowedModel[] {
  if (!autoModelFallback) return [primaryModel];
  const chain: AllowedModel[] = [primaryModel];
  for (const m of ALLOWED_MODELS) {
    if (!chain.includes(m)) {
      chain.push(m);
    }
  }
  return chain;
}

interface IncomingAttachment {
  name: string;
  mimeType: string;
  data: string;
}

interface IncomingMessage {
  role: 'user' | 'model';
  content: string;
  attachments?: IncomingAttachment[];
}

function formatError(err: unknown): {
  code: string;
  message: string;
  hint: string;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);

  if (
    rawMessage === 'MISSING_API_KEY' ||
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('API key not valid')
  ) {
    return {
      code: 'API_KEY_INVALID',
      message: 'Khóa API chưa hợp lệ hoặc chưa được cấu hình.',
      hint: 'Vui lòng kiểm tra khóa GEMINI_API_KEY trong bảng Settings > Secrets của Google AI Studio.',
    };
  }

  if (rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('403')) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Quyền truy cập API bị từ chối (403).',
      hint: 'Hãy kiểm tra lại khóa trong bảng Settings > Secrets trên Google AI Studio.',
    };
  }

  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return {
      code: 'RESOURCE_EXHAUSTED',
      message:
        'Tất cả các khóa và mô hình dự phòng hiện tại đều đã chạm giới hạn tần suất (429 Quota Exceeded).',
      hint: 'Hệ thống đã tự động thử chuyển đổi qua toàn bộ cụm khóa. Bạn có thể đợi ~30 giây hoặc bổ sung thêm biến GEMINI_API_KEY_2, GEMINI_API_KEY_3 trong bảng Settings > Secrets.',
    };
  }

  if (rawMessage.includes('NOT_FOUND') || rawMessage.includes('404')) {
    return {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy mô hình yêu cầu (404).',
      hint: 'Hãy thử chuyển sang mô hình gemini-3.8-flash hoặc gemini-flash-latest.',
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: rawMessage || 'Đã xảy ra lỗi khi kết nối tới Gemini API.',
    hint: 'Vui lòng thử gửi lại tin nhắn hoặc kiểm tra mục Settings > Secrets.',
  };
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });

  app.use(express.json({ limit: '25mb' }));

  // Status & Key Pool Telemetry Endpoint
  app.get('/api/status', (_req, res) => {
    res.json({
      ...keyPool.getPublicStatus(),
      models: Array.from(ALLOWED_MODELS),
    });
  });

  // Sync dynamic keys from frontend/Firestore database
  app.post('/api/key-pool/sync', (req, res) => {
    const { keys } = req.body as { keys?: Array<{ key: string; label: string }> };
    if (Array.isArray(keys)) {
      keyPool.setDynamicKeys(keys);
    }
    res.json(keyPool.getPublicStatus());
  });

  // Update Key Pool Strategy or Reset Cooldowns
  app.post('/api/key-pool/config', (req, res) => {
    const { strategy, resetCooldowns } = req.body as {
      strategy?: 'failover' | 'round-robin';
      resetCooldowns?: boolean;
    };
    if (strategy === 'failover' || strategy === 'round-robin') {
      keyPool.strategy = strategy;
    }
    if (resetCooldowns) {
      keyPool.resetCooldowns();
    }
    res.json(keyPool.getPublicStatus());
  });

  // Streaming Chat Endpoint with Multi-Key & Model Failover
  app.post('/api/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const candidateSlots = keyPool.getOrderedCandidateSlots();
      if (candidateSlots.length === 0) {
        throw new Error('MISSING_API_KEY');
      }

      const {
        messages = [],
        model = 'gemini-3.8-flash',
        systemInstruction = '',
        thinkingLevel = 'LOW',
        useSearch = false,
        temperature = 0.7,
        autoModelFallback = true,
      } = req.body as {
        messages: IncomingMessage[];
        model?: string;
        systemInstruction?: string;
        thinkingLevel?: 'HIGH' | 'LOW' | 'MINIMAL';
        useSearch?: boolean;
        temperature?: number;
        autoModelFallback?: boolean;
      };

      const initialModel: AllowedModel = (
        ALLOWED_MODELS as readonly string[]
      ).includes(model)
        ? (model as AllowedModel)
        : 'gemini-3.8-flash';

      const contents: Content[] = messages.map((msg) => {
        const parts: Part[] = [];
        if (msg.attachments && Array.isArray(msg.attachments)) {
          for (const att of msg.attachments) {
            if (att.data && att.mimeType) {
              parts.push({
                inlineData: {
                  mimeType: att.mimeType,
                  data: att.data,
                },
              });
            }
          }
        }
        if (msg.content && msg.content.trim()) {
          parts.push({ text: msg.content });
        } else if (parts.length === 0) {
          parts.push({ text: ' ' });
        }
        return {
          role: msg.role === 'model' ? 'model' : 'user',
          parts,
        };
      });

      let mappedThinking = ThinkingLevel.LOW;
      if (thinkingLevel === 'HIGH') mappedThinking = ThinkingLevel.HIGH;
      else if (thinkingLevel === 'MINIMAL') mappedThinking = ThinkingLevel.MINIMAL;

      const config: Record<string, unknown> = {
        temperature:
          typeof temperature === 'number'
            ? Math.min(2, Math.max(0, temperature))
            : 0.7,
        thinkingConfig: {
          thinkingLevel: mappedThinking,
        },
      };

      if (systemInstruction && systemInstruction.trim()) {
        config.systemInstruction = systemInstruction.trim();
      }

      if (useSearch) {
        config.tools = [{ googleSearch: {} }];
      }

      const modelChain = getFallbackModelChain(initialModel, autoModelFallback);
      let lastError: unknown = null;
      let succeeded = false;

      outerLoop: for (let mIdx = 0; mIdx < modelChain.length; mIdx++) {
        const targetModel = modelChain[mIdx];

        for (let kIdx = 0; kIdx < candidateSlots.length; kIdx++) {
          const slot = candidateSlots[kIdx];
          let emittedAnyChunk = false;

          try {
            keyPool.markRequestUsed(slot.index);
            const ai = createClientForKey(slot.key);

            const responseStream = await ai.models.generateContentStream({
              model: targetModel,
              contents,
              config,
            });

            sendEvent('meta', {
              keyLabel: slot.label,
              modelUsed: targetModel,
              rotated: kIdx > 0 || mIdx > 0,
            });

            const collectedSources: Array<{ title: string; uri: string }> = [];
            const seenUris = new Set<string>();

            for await (const chunk of responseStream) {
              const text = chunk.text;
              if (text) {
                emittedAnyChunk = true;
                sendEvent('chunk', { text });
              }

              const groundingChunks =
                chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              if (groundingChunks && Array.isArray(groundingChunks)) {
                for (const gChunk of groundingChunks) {
                  const web = (
                    gChunk as { web?: { uri?: string; title?: string } }
                  ).web;
                  if (web?.uri && !seenUris.has(web.uri)) {
                    seenUris.add(web.uri);
                    collectedSources.push({
                      title: web.title || web.uri,
                      uri: web.uri,
                    });
                  }
                }
              }
            }

            if (collectedSources.length > 0) {
              sendEvent('sources', { sources: collectedSources });
            }

            succeeded = true;
            break outerLoop;
          } catch (err) {
            lastError = err;
            if (isRateLimitOrTransientError(err)) {
              keyPool.markRateLimited(slot.index);
              if (!emittedAnyChunk) {
                continue;
              }
            }
            throw err;
          }
        }
      }

      if (!succeeded && lastError) {
        throw lastError;
      }

      sendEvent('done', { ok: true });
      res.end();
    } catch (err) {
      const formatted = formatError(err);
      sendEvent('error', formatted);
      res.end();
    }
  });

  // Auto-generate short conversation title
  app.post('/api/chat/title', async (req, res) => {
    const { firstMessage } = req.body as { firstMessage?: string };
    if (!firstMessage || !firstMessage.trim()) {
      return res.json({ title: 'Cuộc trò chuyện mới' });
    }

    const candidateSlots = keyPool.getOrderedCandidateSlots();
    for (const slot of candidateSlots) {
      try {
        keyPool.markRequestUsed(slot.index);
        const ai = createClientForKey(slot.key);
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `Đặt một tiêu đề ngắn gọn (tối đa 5 từ, không dùng dấu ngoặc kép) cùng ngôn ngữ với nội dung sau: "${firstMessage.slice(
            0,
            250
          )}"`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            temperature: 0.3,
          },
        });

        const title = (response.text || 'Cuộc trò chuyện mới')
          .replace(/["'*#]/g, '')
          .trim()
          .slice(0, 60);

        return res.json({ title: title || 'Cuộc trò chuyện mới' });
      } catch (err) {
        if (isRateLimitOrTransientError(err)) {
          keyPool.markRateLimited(slot.index);
          continue;
        }
        break;
      }
    }

    return res.json({ title: 'Cuộc trò chuyện mới' });
  });

  // WebSocket Server for Gemini Live API Voice Conversations (`gemini-3.8-live`)
  wss.on('connection', async (clientWs) => {
    const apiKey = keyPool.getFirstAvailableKey();
    if (!apiKey) {
      clientWs.send(
        JSON.stringify({
          error: 'MISSING_API_KEY',
          message: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ.',
        })
      );
      clientWs.close();
      return;
    }

    let liveSession: any = null;

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction:
            'Bạn là trợ lý giọng nói AI thông minh, thân thiện và hữu ích bằng tiếng Việt.',
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audioData =
              message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ audio: audioData }));
            }
            if (
              message.serverContent?.interrupted &&
              clientWs.readyState === WebSocket.OPEN
            ) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
          onerror: (err: any) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  error: err?.message || 'Live session error',
                })
              );
            }
          },
        },
      });

      clientWs.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.audio && liveSession) {
            await liveSession.sendRealtimeInput({
              audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
            });
          }
        } catch {
          // ignore parse errors
        }
      });
    } catch (err: any) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            error: err?.message || 'Failed to connect Live API',
          })
        );
      }
      clientWs.close();
    }

    clientWs.on('close', () => {
      try {
        liveSession?.close?.();
      } catch {
        // ignore
      }
    });
  });

  // API endpoint for external AI chat integration
  app.post('/api/v1/chat', express.json(), async (req, res) => {
    const apiKey = req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey || !keyPool.isValidKey(apiKey)) return res.status(401).json({ error: 'Invalid API Key' });

    const { model, messages } = req.body;
    try {
      const genAI = createClientForKey(apiKey);
      const result = await genAI.models.generateContent({
        model: model || 'gemini-3.8-flash',
        contents: messages,
      });
      res.json({ response: result.text });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Terminal REST endpoint
  app.post('/api/terminal/execute', express.json(), (req, res) => {
    const { command } = req.body;
    const cmdParts = command.split(' ');
    const baseCmd = cmdParts[0];

    switch (baseCmd) {
      case 'whoami':
        return res.json({ output: 'Lumina-User' });
      case 'date':
        return res.json({ output: new Date().toString() });
      case 'help':
        return res.json({ output: 'Các lệnh hỗ trợ: whoami, date, help, ls' });
      case 'ls':
        return res.json({ output: 'src\nnode_modules\npackage.json\nserver.ts\nindex.html\nREADME.md' });
      default:
        return res.json({ error: `Lệnh '${baseCmd}' không được hỗ trợ.` });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server & WebSocket Live API running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
