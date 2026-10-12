/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus,
  Search,
  Send,
  Square,
  Paperclip,
  Trash2,
  Pin,
  Download,
  RotateCcw,
  Copy,
  Check,
  Globe,
  MessageSquare,
  BookOpen,
  X,
  ExternalLink,
  AlertTriangle,
  ChevronRight,
  Edit3,
  Menu,
  RefreshCw,
  Mic,
  MicOff,
  Volume2,
  Radio,
  Terminal as TerminalIcon,
} from 'lucide-react';
import {
  Attachment,
  ChatMessage,
  ChatThread,
  GeminiModelId,
  GroundingSource,
  PromptTemplate,
  ServerPoolStatus,
  ThinkingLevelOption,
} from './types/chat';
import {
  AVAILABLE_MODELS,
  PERSONA_PRESETS,
  PROMPT_TEMPLATES,
} from './data/presets';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { Terminal } from './components/Terminal';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  query,
  orderBy,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
} from './firebase';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const STORAGE_KEY = 'lumina_ai_studio_threads_v1';

function createInitialThread(): ChatThread {
  return {
    id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'Cuộc trò chuyện mới',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    personaId: 'default',
    customSystemInstruction: '',
    model: 'gemini-3.8-flash',
    thinkingLevel: 'LOW',
    useSearch: false,
    temperature: 0.7,
    autoModelFallback: true,
    messages: [],
  };
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatDateShort(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(timestamp));
}

// Helper for Live API PCM encoding
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const output = new DataView(new ArrayBuffer(input.length * 2));
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return output.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function App() {
  const [threads, setThreads] = useState<ChatThread[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return [createInitialThread()];
  });

  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    return threads[0]?.id || '';
  });

  const [activeView, setActiveView] = useState<
    'chat' | 'prompts' | 'personas' | 'settings' | 'live' | 'terminal'
  >('chat');

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [promptCategoryFilter, setPromptCategoryFilter] = useState<
    'all' | 'engineering' | 'analysis' | 'writing' | 'learning'
  >('all');

  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingThreadTitleId, setEditingThreadTitleId] = useState<string | null>(
    null
  );
  const [editingTitleValue, setEditingTitleValue] = useState<string>('');

  // Live Voice State
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);
  const [liveStatusText, setLiveStatusText] = useState<string>(
    'Sẵn sàng kết nối trò chuyện giọng nói thời gian thực với Gemini Live.'
  );
  const [liveTranscript, setLiveTranscript] = useState<
    Array<{ speaker: 'user' | 'model'; text: string }>
  >([]);
  const liveWsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Server Key Pool & Failover status
  const [poolStatus, setPoolStatus] = useState<ServerPoolStatus>({
    checked: false,
    configured: true,
    totalKeys: 1,
    activeKeys: 1,
    strategy: 'failover',
    slots: [],
  });

  // Firebase Custom API Keys State
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [customKeys, setCustomKeys] = useState<Array<{ id: string; key: string; label: string }>>([]);
  const [newKeyLabel, setNewKeyLabel] = useState<string>('');
  const [newKeyValue, setNewKeyValue] = useState<string>('');
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeThread = useMemo(() => {
    return (
      threads.find((t) => t.id === activeThreadId) ||
      threads[0] ||
      createInitialThread()
    );
  }, [threads, activeThreadId]);

  const activePersona = useMemo(() => {
    return (
      PERSONA_PRESETS.find((p) => p.id === activeThread.personaId) ||
      PERSONA_PRESETS[0]
    );
  }, [activeThread.personaId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch {
      // ignore
    }
  }, [threads]);

  // Auth listener & Firestore keys loader
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await loadCustomKeysFromFirestore();
      } else {
        setCustomKeys([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setIsAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCustomKeys();
      syncKeysToServer([]);
    } catch {
      // ignore
    }
  };

  const loadCustomKeysFromFirestore = async () => {
    try {
      const q = query(collection(db, 'apikeys'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const keysList: Array<{ id: string; key: string; label: string }> = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        keysList.push({
          id: docSnap.id,
          key: data.key,
          label: data.label || 'Custom Key',
        });
      });
      setCustomKeys(keysList);
      syncKeysToServer(keysList);
    } catch (err) {
      console.error(err);
    }
  };

  const syncKeysToServer = async (keysList: Array<{ id: string; key: string; label: string }>) => {
    try {
      const res = await fetch('/api/key-pool/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keysList }),
      });
      if (res.ok) {
        const data = await res.json();
        setPoolStatus((prev) => ({
          ...prev,
          configured: Boolean(data?.configured),
          totalKeys: Number(data?.totalKeys ?? 0),
          activeKeys: Number(data?.activeKeys ?? 0),
          slots: Array.isArray(data?.slots) ? data.slots : [],
        }));
      }
    } catch {
      // ignore
    }
  };

  const handleAddCustomKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const keyVal = newKeyValue.trim();
    if (!keyVal || !firebaseUser) return;

    const keyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const labelVal = newKeyLabel.trim() || `Key #${customKeys.length + 1}`;

    try {
      await setDoc(doc(db, 'apikeys', keyId), {
        id: keyId,
        key: keyVal,
        label: labelVal,
        createdAt: new Date().toISOString(),
      });
      setNewKeyValue('');
      setNewKeyLabel('');
      await loadCustomKeysFromFirestore();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCustomKey = async (keyId: string) => {
    try {
      await deleteDoc(doc(db, 'apikeys', keyId));
      await loadCustomKeysFromFirestore();
    } catch (err) {
      console.error(err);
    }
  };

  const fetchServerPoolStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();
      setPoolStatus({
        checked: true,
        configured: Boolean(data?.configured),
        totalKeys: Number(data?.totalKeys ?? 0),
        activeKeys: Number(data?.activeKeys ?? 0),
        strategy: data?.strategy === 'round-robin' ? 'round-robin' : 'failover',
        slots: Array.isArray(data?.slots) ? data.slots : [],
      });
    } catch {
      setPoolStatus((prev) => ({ ...prev, checked: true }));
    }
  };

  useEffect(() => {
    fetchServerPoolStatus();
  }, []);

  useEffect(() => {
    if (activeView === 'settings') {
      fetchServerPoolStatus();
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeThread.messages.length, isStreaming, activeView]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputPrompt]);

  // Clean up Live session on unmount or view switch
  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  const startLiveSession = async () => {
    if (isLiveActive) return;

    try {
      setLiveStatusText('Đang yêu cầu quyền truy cập Micro...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });
      mediaStreamRef.current = stream;

      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${location.host}/live`;

      setLiveStatusText('Đang kết nối tới Gemini Live API...');
      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      const inputCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = inputCtx;

      const outputCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputCtx;
      nextPlayTimeRef.current = outputCtx.currentTime;

      ws.onopen = () => {
        setIsLiveActive(true);
        setLiveStatusText('Đang trò chuyện trực tiếp (Gemini Live hoạt động)');

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (!isLiveActive || ws.readyState !== WebSocket.OPEN) return;
          const channelData = e.inputBuffer.getChannelData(0);
          const pcmBuf = floatTo16BitPCM(channelData);
          const base64Data = arrayBufferToBase64(pcmBuf);
          ws.send(JSON.stringify({ audio: base64Data }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            setLiveStatusText(`Lỗi Live API: ${data.error}`);
            return;
          }
          if (data.interrupted) {
            nextPlayTimeRef.current = outputCtx.currentTime;
            return;
          }
          if (data.audio) {
            const binaryString = atob(data.audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const pcmData = new Int16Array(bytes.buffer);
            const float32Data = new Float32Array(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
              float32Data[i] = pcmData[i] / 32768;
            }

            const audioBuffer = outputCtx.createBuffer(
              1,
              float32Data.length,
              24000
            );
            audioBuffer.copyToChannel(float32Data, 0);

            const player = outputCtx.createBufferSource();
            player.buffer = audioBuffer;
            player.connect(outputCtx.destination);

            const now = outputCtx.currentTime;
            const startTime = Math.max(now, nextPlayTimeRef.current);
            player.start(startTime);
            nextPlayTimeRef.current = startTime + audioBuffer.duration;
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setLiveStatusText('Mất kết nối Live WebSocket.');
        stopLiveSession();
      };

      ws.onclose = () => {
        setLiveStatusText('Đã đóng phiên trò chuyện giọng nói.');
        setIsLiveActive(false);
      };
    } catch (err: any) {
      setLiveStatusText(
        `Không thể khởi động Micro: ${err?.message || 'Permission denied'}`
      );
      stopLiveSession();
    }
  };

  const stopLiveSession = () => {
    setIsLiveActive(false);
    try {
      processorRef.current?.disconnect();
      processorRef.current = null;
    } catch {
      // ignore
    }

    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    } catch {
      // ignore
    }

    try {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    } catch {
      // ignore
    }

    try {
      outputAudioCtxRef.current?.close();
      outputAudioCtxRef.current = null;
    } catch {
      // ignore
    }

    try {
      liveWsRef.current?.close();
      liveWsRef.current = null;
    } catch {
      // ignore
    }
    setLiveStatusText('Đã dừng phiên Live Voice.');
  };

  const updateActiveThread = (updater: (thread: ChatThread) => ChatThread) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === activeThread.id ? updater(t) : t))
    );
  };

  const handleUpdatePoolConfig = async (options: {
    strategy?: 'failover' | 'round-robin';
    resetCooldowns?: boolean;
  }) => {
    try {
      const res = await fetch('/api/key-pool/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      if (!res.ok) return;
      const data = await res.json();
      setPoolStatus({
        checked: true,
        configured: Boolean(data?.configured),
        totalKeys: Number(data?.totalKeys ?? 0),
        activeKeys: Number(data?.activeKeys ?? 0),
        strategy: data?.strategy === 'round-robin' ? 'round-robin' : 'failover',
        slots: Array.isArray(data?.slots) ? data.slots : [],
      });
    } catch {
      // ignore
    }
  };

  const handleNewChat = () => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
    }
    const fresh = createInitialThread();
    fresh.model = activeThread.model;
    fresh.personaId = activeThread.personaId;
    fresh.thinkingLevel = activeThread.thinkingLevel;
    fresh.useSearch = activeThread.useSearch;
    fresh.autoModelFallback = activeThread.autoModelFallback ?? true;
    setThreads((prev) => [fresh, ...prev]);
    setActiveThreadId(fresh.id);
    setActiveView('chat');
    setInputPrompt('');
    setAttachments([]);
  };

  const handleDeleteThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setThreads((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fallback = createInitialThread();
        setActiveThreadId(fallback.id);
        return [fallback];
      }
      if (activeThreadId === id) {
        setActiveThreadId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))
    );
  };

  const handleStartRename = (thread: ChatThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingThreadTitleId(thread.id);
    setEditingTitleValue(thread.title);
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editingTitleValue.trim();
    if (trimmed) {
      setThreads((prev) =>
        prev.map((t) => (t.id === id ? { ...t, title: trimmed } : t))
      );
    }
    setEditingThreadTitleId(null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 8 * 1024 * 1024) continue;

      const base64Url = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

      const base64Data = base64Url.split(',')[1] || '';
      if (base64Data) {
        newAttachments.push({
          id: `att_${Date.now()}_${i}`,
          name: file.name,
          mimeType: file.type,
          data: base64Data,
          previewUrl: base64Url,
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const generateThreadTitle = async (threadId: string, firstText: string) => {
    try {
      const res = await fetch('/api/chat/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstMessage: firstText }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.title) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId && t.title === 'Cuộc trò chuyện mới'
              ? { ...t, title: data.title }
              : t
          )
        );
      }
    } catch {
      // ignore
    }
  };

  const sendConversationToGemini = async (
    threadId: string,
    historyMessages: ChatMessage[],
    threadConfig: {
      model: GeminiModelId;
      systemInstruction: string;
      thinkingLevel: ThinkingLevelOption;
      useSearch: boolean;
      temperature: number;
      autoModelFallback: boolean;
    }
  ) => {
    const assistantMsgId = `msg_${Date.now()}_model`;
    const startTime = performance.now();

    const placeholderAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'model',
      content: '',
      timestamp: Date.now(),
      model: threadConfig.model,
    };

    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              updatedAt: Date.now(),
              messages: [...historyMessages, placeholderAssistantMsg],
            }
          : t
      )
    );

    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: threadConfig.model,
          systemInstruction: threadConfig.systemInstruction,
          thinkingLevel: threadConfig.thinkingLevel,
          useSearch: threadConfig.useSearch,
          temperature: threadConfig.temperature,
          autoModelFallback: threadConfig.autoModelFallback,
          messages: historyMessages.map((m) => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments?.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              data: a.data,
            })),
          })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      let accumulatedSources: GroundingSource[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n');
          let eventName = 'message';
          let dataLine = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLine = line.slice(5).trim();
            }
          }

          if (!dataLine) continue;
          const parsed = JSON.parse(dataLine);

          if (eventName === 'meta') {
            setThreads((prev) =>
              prev.map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      messages: t.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              model: parsed.modelUsed || m.model,
                              keyLabel: parsed.keyLabel,
                              rotated: Boolean(parsed.rotated),
                            }
                          : m
                      ),
                    }
                  : t
              )
            );
          } else if (eventName === 'chunk' && parsed.text) {
            accumulatedText += parsed.text;
            const currentLatency = Math.round(performance.now() - startTime);
            setThreads((prev) =>
              prev.map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      messages: t.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              content: accumulatedText,
                              latencyMs: currentLatency,
                            }
                          : m
                      ),
                    }
                  : t
              )
            );
          } else if (eventName === 'sources' && Array.isArray(parsed.sources)) {
            accumulatedSources = parsed.sources;
            setThreads((prev) =>
              prev.map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      messages: t.messages.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, sources: accumulatedSources }
                          : m
                      ),
                    }
                  : t
              )
            );
          } else if (eventName === 'error') {
            setThreads((prev) =>
              prev.map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      messages: t.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              error: {
                                code: parsed.code || 'ERROR',
                                message:
                                  parsed.message ||
                                  'Không thể nhận phản hồi từ Gemini API.',
                                hint:
                                  parsed.hint ||
                                  'Kiểm tra cấu hình khóa GEMINI_API_KEY trong bảng Settings > Secrets.',
                              },
                            }
                          : m
                      ),
                    }
                  : t
              )
            );
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          error: {
                            code: 'NETWORK_ERROR',
                            message: 'Kết nối tới máy chủ bị gián đoạn.',
                            hint: 'Vui lòng kiểm tra kết nối mạng hoặc thử gửi lại.',
                          },
                        }
                      : m
                  ),
                }
              : t
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      fetchServerPoolStatus();
    }
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (
      typeof customText === 'string' ? customText : inputPrompt
    ).trim();

    if ((!textToSend && attachments.length === 0) || isStreaming) return;

    const currentThread = activeThread;
    const isFirstMessage = currentThread.messages.length === 0;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: textToSend,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };

    const updatedHistory = [...currentThread.messages, userMessage];

    if (typeof customText !== 'string') {
      setInputPrompt('');
    }
    setAttachments([]);
    setActiveView('chat');

    if (isFirstMessage && textToSend) {
      generateThreadTitle(currentThread.id, textToSend);
    }

    const effectiveSystemInstruction =
      currentThread.customSystemInstruction?.trim() ||
      activePersona.systemInstruction;

    await sendConversationToGemini(currentThread.id, updatedHistory, {
      model: currentThread.model,
      systemInstruction: effectiveSystemInstruction,
      thinkingLevel: currentThread.thinkingLevel,
      useSearch: currentThread.useSearch,
      temperature: currentThread.temperature,
      autoModelFallback: currentThread.autoModelFallback ?? true,
    });
  };

  const handleRegenerateLast = async () => {
    if (isStreaming || activeThread.messages.length === 0) return;

    const msgs = [...activeThread.messages];
    if (msgs[msgs.length - 1].role === 'model') {
      msgs.pop();
    }
    if (msgs.length === 0) return;

    const effectiveSystemInstruction =
      activeThread.customSystemInstruction?.trim() ||
      activePersona.systemInstruction;

    await sendConversationToGemini(activeThread.id, msgs, {
      model: activeThread.model,
      systemInstruction: effectiveSystemInstruction,
      thinkingLevel: activeThread.thinkingLevel,
      useSearch: activeThread.useSearch,
      temperature: activeThread.temperature,
      autoModelFallback: activeThread.autoModelFallback ?? true,
    });
  };

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 1800);
    } catch {
      // ignore
    }
  };

  const handleApplyPromptTemplate = (template: PromptTemplate) => {
    updateActiveThread((t) => ({
      ...t,
      model: template.recommendedModel,
      thinkingLevel: template.recommendedThinking,
      useSearch: Boolean(template.useSearch),
    }));
    setInputPrompt(template.prompt);
    setActiveView('chat');
    setTimeout(() => textareaRef.current?.focus(), 60);
  };

  const handleExportMarkdown = () => {
    const lines: string[] = [
      `# ${activeThread.title}`,
      ``,
      `Mô hình: ${activeThread.model} · Vai trò: ${activePersona.name} · Xuất lúc: ${new Date().toLocaleString('vi-VN')}`,
      ``,
      `---`,
      ``,
    ];

    for (const msg of activeThread.messages) {
      const speaker = msg.role === 'user' ? 'Người dùng' : 'Lumina AI';
      lines.push(`### ${speaker} (${formatTime(msg.timestamp)})`);
      lines.push('');
      lines.push(msg.content || '*(Không có nội dung văn bản)*');
      if (msg.sources && msg.sources.length > 0) {
        lines.push('');
        lines.push('**Nguồn tham khảo:**');
        for (const s of msg.sources) {
          lines.push(`- [${s.title}](${s.uri})`);
        }
      }
      lines.push('');
    }

    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeThread.title.toLowerCase().replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [threads, searchQuery]);

  const pinnedThreads = useMemo(
    () => filteredThreads.filter((t) => t.pinned),
    [filteredThreads]
  );
  const recentThreads = useMemo(
    () => filteredThreads.filter((t) => !t.pinned),
    [filteredThreads]
  );

  const filteredPrompts = useMemo(() => {
    if (promptCategoryFilter === 'all') return PROMPT_TEMPLATES;
    return PROMPT_TEMPLATES.filter((p) => p.category === promptCategoryFilter);
  }, [promptCategoryFilter]);

  return (
    <div className="min-h-screen h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800/90 bg-slate-950 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#chat"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('chat');
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Lumina Studio
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#chat"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('chat');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeView === 'chat'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Không gian Chat
          </a>
          <a
            href="#live"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('live');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 inline-flex items-center gap-1.5 ${
              activeView === 'live'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            <Radio
              className={`w-3.5 h-3.5 ${
                isLiveActive ? 'text-emerald-400 animate-pulse' : ''
              }`}
            />
            <span>Gemini Live Voice</span>
          </a>
          <a
            href="#prompts"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('prompts');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeView === 'prompts'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Thư viện Prompt
          </a>
          <a
            href="#personas"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('personas');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeView === 'personas'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Vai trò AI
          </a>
          <a
            href="#settings"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('settings');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeView === 'settings'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Cấu hình & Cụm Khóa
          </a>
          <a
            href="#terminal"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('terminal');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 inline-flex items-center gap-1.5 ${
              activeView === 'terminal'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Cuộc trò chuyện mới</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'w-[272px]' : 'w-0 overflow-hidden border-r-0'
          } shrink-0 border-r border-slate-800/80 bg-slate-900/40 flex flex-col transition-all duration-150`}
        >
          <div className="p-3.5 border-b border-slate-800/70">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm lịch sử trò chuyện..."
                className="w-full pl-9 pr-7 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/70 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Mobile View Switcher */}
          <div className="flex md:hidden items-center gap-1 px-3.5 py-2 border-b border-slate-800/70 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveView('chat')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                activeView === 'chat'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setActiveView('live')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                activeView === 'live'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live Voice
            </button>
            <button
              type="button"
              onClick={() => setActiveView('prompts')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                activeView === 'prompts'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Prompt
            </button>
            <button
              type="button"
              onClick={() => setActiveView('personas')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                activeView === 'personas'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Vai trò
            </button>
            <button
              type="button"
              onClick={() => setActiveView('settings')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                activeView === 'settings'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cụm Khóa
            </button>
            <button
              type="button"
              onClick={() => setActiveView('terminal')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                activeView === 'terminal'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Terminal
            </button>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-5">
            {pinnedThreads.length > 0 && (
              <div>
                <div className="px-2 mb-1.5 text-xs font-medium text-slate-400">
                  Đã ghim
                </div>
                <div className="space-y-1">
                  {pinnedThreads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === activeThread.id}
                      isEditing={editingThreadTitleId === thread.id}
                      editingValue={editingTitleValue}
                      onSelect={() => {
                        setActiveThreadId(thread.id);
                        setActiveView('chat');
                      }}
                      onTogglePin={(e) => handleTogglePin(thread.id, e)}
                      onDelete={(e) => handleDeleteThread(thread.id, e)}
                      onStartRename={(e) => handleStartRename(thread, e)}
                      onChangeRename={setEditingTitleValue}
                      onSaveRename={() => handleSaveRename(thread.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="px-2 mb-1.5 flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Gần đây</span>
                <span className="tabular-nums text-slate-500">
                  {recentThreads.length}
                </span>
              </div>
              {recentThreads.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-slate-500">
                  Không tìm thấy cuộc trò chuyện nào khớp với từ khóa.
                </div>
              ) : (
                <div className="space-y-1">
                  {recentThreads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === activeThread.id}
                      isEditing={editingThreadTitleId === thread.id}
                      editingValue={editingTitleValue}
                      onSelect={() => {
                        setActiveThreadId(thread.id);
                        setActiveView('chat');
                      }}
                      onTogglePin={(e) => handleTogglePin(thread.id, e)}
                      onDelete={(e) => handleDeleteThread(thread.id, e)}
                      onStartRename={(e) => handleStartRename(thread, e)}
                      onChangeRename={setEditingTitleValue}
                      onSaveRename={() => handleSaveRename(thread.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Footer */}
          <div className="p-3.5 border-t border-slate-800/80 bg-slate-950/60 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400 tabular-nums">
              <span className="truncate">
                Cụm khóa: {poolStatus.activeKeys}/{poolStatus.totalKeys} sẵn sàng
              </span>
              <button
                type="button"
                onClick={() => setActiveView('settings')}
                className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                Chi tiết
              </button>
            </div>
            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={activeThread.messages.length === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800/80 disabled:opacity-40 disabled:pointer-events-none text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Xuất hội thoại (.md)</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
          {/* Contextual Workspace Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-b border-slate-800/80 bg-slate-900/30 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="Đóng/Mở thanh bên"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
                <span className="font-medium text-slate-200 truncate">
                  {activeView === 'live'
                    ? 'Gemini Live Voice (gemini-3.8-live)'
                    : activeThread.title}
                </span>
                {activeView !== 'live' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums whitespace-nowrap">
                      {activeThread.messages.length} tin nhắn
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Controls */}
            {activeView !== 'live' && (
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="model-select"
                    className="text-xs text-slate-400 hidden sm:inline whitespace-nowrap"
                  >
                    Mô hình:
                  </label>
                  <select
                    id="model-select"
                    value={activeThread.model}
                    onChange={(e) =>
                      updateActiveThread((t) => ({
                        ...t,
                        model: e.target.value as GeminiModelId,
                      }))
                    }
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-lg"
                  title="Mức độ suy luận (Thinking Level)"
                >
                  {(['MINIMAL', 'LOW', 'HIGH'] as ThinkingLevelOption[]).map(
                    (lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() =>
                          updateActiveThread((t) => ({
                            ...t,
                            thinkingLevel: lvl,
                          }))
                        }
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeThread.thinkingLevel === lvl
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {lvl === 'MINIMAL'
                          ? 'Nhanh'
                          : lvl === 'LOW'
                          ? 'Tiêu chuẩn'
                          : 'Suy luận sâu'}
                      </button>
                    )
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    updateActiveThread((t) => ({
                      ...t,
                      useSearch: !t.useSearch,
                    }))
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeThread.useSearch
                      ? 'bg-blue-950/80 border-blue-500/60 text-blue-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Google Search</span>
                </button>
              </div>
            )}
          </div>

          {poolStatus.checked && !poolStatus.configured && (
            <div className="px-6 py-3 bg-amber-950/50 border-b border-amber-800/60 flex items-center justify-between gap-4 text-xs text-amber-200">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Chưa phát hiện khóa <strong>GEMINI_API_KEY</strong> trong môi
                  trường máy chủ. Vui lòng kiểm tra mục{' '}
                  <strong>Settings &gt; Secrets</strong> trên thanh công cụ
                  Google AI Studio.
                </span>
              </div>
            </div>
          )}

          {/* View: Gemini Live Voice Workspace */}
          {activeView === 'live' && (
            <div className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center justify-center">
              <div className="max-w-xl w-full mx-auto text-center space-y-8 p-8 rounded-2xl border border-slate-800 bg-slate-900/40 shadow-2xl">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950 border border-blue-800 text-xs font-medium text-blue-300">
                    <Radio
                      className={`w-3.5 h-3.5 ${
                        isLiveActive ? 'text-emerald-400 animate-pulse' : ''
                      }`}
                    />
                    <span>Gemini Live Audio API (`gemini-3.8-live`)</span>
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
                    Trò chuyện giọng nói thời gian thực
                  </h2>
                  <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                    Nói chuyện trực tiếp với trợ lý Gemini qua micro. Hệ thống
                    truyền tải âm thanh độ trễ cực thấp qua WebSocket hai chiều.
                  </p>
                </div>

                {/* Orb / Visualizer Indicator */}
                <div className="py-8 flex flex-col items-center justify-center">
                  <div
                    className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                      isLiveActive
                        ? 'bg-gradient-to-tr from-blue-600 via-indigo-600 to-emerald-500 shadow-lg shadow-blue-500/30 animate-pulse scale-105'
                        : 'bg-slate-800 border-2 border-slate-700 text-slate-500'
                    }`}
                  >
                    {isLiveActive ? (
                      <Volume2 className="w-12 h-12 text-white animate-bounce" />
                    ) : (
                      <MicOff className="w-10 h-10 text-slate-400" />
                    )}
                  </div>
                  <div className="mt-6 text-sm font-medium text-slate-300">
                    {liveStatusText}
                  </div>
                </div>

                {/* Start / Stop Button */}
                <div className="flex justify-center">
                  {isLiveActive ? (
                    <button
                      type="button"
                      onClick={stopLiveSession}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors cursor-pointer shadow-lg shadow-red-900/30"
                    >
                      <Square className="w-4 h-4 fill-current" />
                      <span>Dừng phiên Live Voice</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startLiveSession}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors cursor-pointer shadow-lg shadow-blue-900/30"
                    >
                      <Mic className="w-4 h-4" />
                      <span>Bắt đầu trò chuyện giọng nói</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* View 1: Chat Workspace */}
          {activeView === 'chat' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
                <div className="max-w-3xl mx-auto space-y-6">
                  {activeThread.messages.length === 0 ? (
                    <div className="py-8 space-y-8">
                      <div className="space-y-3">
                        <p className="text-xs font-medium text-blue-400 tabular-nums">
                          Google AI Studio · {activeThread.model} · Vai trò:{' '}
                          {activePersona.name} · Cụm khóa: {poolStatus.totalKeys}{' '}
                          slot
                        </p>
                        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
                          Hôm nay bạn muốn phân tích, lập trình hay sáng tạo nội
                          dung gì?
                        </h1>
                        <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
                          Hệ thống tích hợp cơ chế tự động luân chuyển khóa
                          (Multi-Key Failover) và chuyển đổi mô hình dự phòng
                          ngay lập tức khi chạm ngưỡng giới hạn tần suất (Rate
                          Limit 429).
                        </p>
                      </div>
                    </div>
                  ) : (
                    activeThread.messages.map((msg, index) => {
                      const isUser = msg.role === 'user';
                      const isLastModel =
                        !isUser && index === activeThread.messages.length - 1;

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            isUser ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1.5 px-1 text-xs text-slate-400 tabular-nums">
                            <span className="font-medium text-slate-300">
                              {isUser ? 'Bạn' : 'Lumina AI'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{formatTime(msg.timestamp)}</span>
                            {!isUser && msg.model && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{msg.model}</span>
                              </>
                            )}
                            {!isUser && msg.keyLabel && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {msg.keyLabel}
                                  {msg.rotated ? ' (Đã tự động chuyển)' : ''}
                                </span>
                              </>
                            )}
                            {!isUser && msg.latencyMs && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {(msg.latencyMs / 1000).toFixed(1)}s
                                </span>
                              </>
                            )}
                          </div>

                          <div
                            className={`w-full rounded-xl p-4 sm:p-5 border ${
                              isUser
                                ? 'max-w-2xl bg-blue-950/35 border-blue-800/50 text-slate-100'
                                : 'bg-slate-900/55 border-slate-800/90 text-slate-100'
                            }`}
                          >
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2.5 mb-3">
                                {msg.attachments.map((att) => (
                                  <div
                                    key={att.id}
                                    className="relative rounded-lg overflow-hidden border border-slate-700 bg-slate-950 max-w-[220px]"
                                  >
                                    <img
                                      src={att.previewUrl}
                                      alt={att.name}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-36 object-cover"
                                    />
                                    <div className="px-2 py-1 text-[11px] text-slate-400 truncate bg-slate-900/90">
                                      {att.name}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.error ? (
                              <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/70 text-red-200 space-y-1.5 text-sm">
                                <div className="flex items-center gap-2 font-semibold text-red-300">
                                  <AlertTriangle className="w-4 h-4 shrink-0" />
                                  <span>{msg.error.message}</span>
                                </div>
                                <p className="text-xs text-red-200/80 leading-relaxed">
                                  {msg.error.hint}
                                </p>
                              </div>
                            ) : msg.content ? (
                              isUser ? (
                                <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                                  {msg.content}
                                </div>
                              ) : (
                                <MarkdownRenderer content={msg.content} />
                              )
                            ) : (
                              <div className="space-y-2.5 py-1">
                                <div className="h-3.5 w-3/4 bg-slate-800 rounded animate-pulse" />
                                <div className="h-3.5 w-1/2 bg-slate-800 rounded animate-pulse" />
                              </div>
                            )}

                            {msg.sources && msg.sources.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-slate-800/80">
                                <div className="text-xs font-medium text-slate-400 mb-2">
                                  Nguồn dẫn chứng từ Google Search:
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                                  {msg.sources.map((src, idx) => (
                                    <a
                                      key={idx}
                                      href={src.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-4"
                                    >
                                      <span className="truncate max-w-[240px]">
                                        {idx + 1}. {src.title}
                                      </span>
                                      <ExternalLink className="w-3 h-3 shrink-0" />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {msg.content && (
                              <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(msg)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  {copiedMessageId === msg.id ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      <span>Đã chép</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Sao chép</span>
                                    </>
                                  )}
                                </button>
                                {isLastModel && !isStreaming && (
                                  <button
                                    type="button"
                                    onClick={handleRegenerateLast}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>Tạo lại phản hồi</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Composer Area */}
              <div className="px-4 sm:px-8 pb-5 pt-2 bg-slate-950 border-t border-slate-900">
                <div className="max-w-3xl mx-auto">
                  {attachments.length > 0 && (
                    <div className="flex items-center gap-2.5 mb-2.5 overflow-x-auto pb-1">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shrink-0"
                        >
                          <img
                            src={att.previewUrl}
                            alt={att.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(att.id)}
                            className="absolute top-1 right-1 p-0.5 rounded bg-slate-950/80 text-slate-200 hover:text-white"
                            title="Xóa ảnh"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 focus-within:border-blue-500/70 transition-colors p-3">
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={inputPrompt}
                      onChange={(e) => setInputPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder="Nhập câu hỏi, yêu cầu viết code hoặc dán văn bản... (Enter để gửi, Shift + Enter xuống dòng)"
                      className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none max-h-[200px] leading-relaxed"
                    />

                    <div className="flex items-center justify-between gap-3 pt-2.5 mt-1 border-t border-slate-800/60">
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          title="Đính kèm hình ảnh để Gemini phân tích"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>Đính kèm ảnh</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveView('prompts')}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>Mẫu câu lệnh</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <span className="hidden sm:inline text-xs text-slate-500 tabular-nums">
                          {inputPrompt.length} ký tự
                        </span>
                        {isStreaming ? (
                          <button
                            type="button"
                            onClick={handleStopStreaming}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Square className="w-3.5 h-3.5 fill-current" />
                            <span>Dừng tạo</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSendMessage()}
                            disabled={
                              !inputPrompt.trim() && attachments.length === 0
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Gửi tin nhắn</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View: Prompt Library */}
          {activeView === 'prompts' && (
            <div className="flex-1 overflow-y-auto px-6 py-8">
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                  <div>
                    <h2 className="font-display text-xl font-bold text-white">
                      Thư viện Prompt Chuyên sâu
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">
                      Chọn một mẫu câu lệnh được tối ưu sẵn thông số mô hình và
                      mức độ suy luận cho từng tác vụ.
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg self-start">
                    {[
                      { id: 'all', label: 'Tất cả' },
                      { id: 'engineering', label: 'Kỹ thuật' },
                      { id: 'analysis', label: 'Phân tích' },
                      { id: 'writing', label: 'Soạn thảo' },
                      { id: 'learning', label: 'Học tập' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() =>
                          setPromptCategoryFilter(
                            tab.id as typeof promptCategoryFilter
                          )
                        }
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          promptCategoryFilter === tab.id
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredPrompts.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">
                          {tpl.categoryLabel} · {tpl.recommendedModel} · Suy
                          luận: {tpl.recommendedThinking}
                        </div>
                        <h3 className="font-display text-base font-semibold text-white">
                          {tpl.title}
                        </h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {tpl.description}
                        </p>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-xs text-slate-300 leading-relaxed line-clamp-3">
                          {tpl.prompt}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/70">
                        <button
                          type="button"
                          onClick={() => handleApplyPromptTemplate(tpl)}
                          className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Đưa vào khung chat
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* View: AI Personas */}
          {activeView === 'personas' && (
            <div className="flex-1 overflow-y-auto px-6 py-8">
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="border-b border-slate-800 pb-5">
                  <h2 className="font-display text-xl font-bold text-white">
                    Vai trò AI & Chỉ dẫn Hệ thống (System Instruction)
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Định hình phong cách trả lời, chuyên môn và cấu trúc đầu ra
                    của Gemini cho cuộc trò chuyện hiện tại.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PERSONA_PRESETS.map((persona) => {
                    const isSelected = activeThread.personaId === persona.id;
                    return (
                      <div
                        key={persona.id}
                        onClick={() =>
                          updateActiveThread((t) => ({
                            ...t,
                            personaId: persona.id,
                          }))
                        }
                        className={`p-5 rounded-xl border transition-colors cursor-pointer flex flex-col justify-between gap-4 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-950/20'
                            : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>{persona.role}</span>
                            {isSelected && (
                              <span className="font-semibold text-blue-400">
                                Đang kích hoạt
                              </span>
                            )}
                          </div>
                          <h3 className="font-display text-base font-semibold text-white">
                            {persona.name}
                          </h3>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {persona.description}
                          </p>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-xs text-slate-400 leading-relaxed">
                          {persona.systemInstruction}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">
                        Chỉ dẫn Hệ thống Tùy chỉnh (Ghi đè vai trò mặc định)
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Nếu bạn nhập nội dung tại đây, hệ thống sẽ ưu tiên dùng
                        chỉ dẫn này làm System Instruction gửi tới Gemini API.
                      </p>
                    </div>
                    {activeThread.customSystemInstruction && (
                      <button
                        type="button"
                        onClick={() =>
                          updateActiveThread((t) => ({
                            ...t,
                            customSystemInstruction: '',
                          }))
                        }
                        className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                      >
                        Xóa tùy chỉnh
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={4}
                    value={activeThread.customSystemInstruction || ''}
                    onChange={(e) =>
                      updateActiveThread((t) => ({
                        ...t,
                        customSystemInstruction: e.target.value,
                      }))
                    }
                    placeholder="Ví dụ: Hãy luôn trả lời dưới dạng danh sách gạch đầu dòng ngắn gọn, kèm theo ví dụ mã nguồn TypeScript..."
                    className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* View: Settings & Key Pool */}
          {activeView === 'settings' && (
            <div className="flex-1 overflow-y-auto px-6 py-8">
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="border-b border-slate-800 pb-5">
                  <h2 className="font-display text-xl font-bold text-white">
                    Cấu hình Cụm Khóa Tự động Luân chuyển & Mô hình
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Quản lý cơ chế tự động chuyển đổi khóa (Failover /
                    Round-Robin) và mô hình dự phòng khi gặp giới hạn tần suất
                    (Rate Limit 429).
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">
                        Cụm Khóa Máy chủ & Tự động Chuyển đổi khi Rate Limit
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                        Đang nhận diện {poolStatus.totalKeys} khóa từ môi trường
                        máy chủ · {poolStatus.activeKeys} khóa sẵn sàng
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdatePoolConfig({ resetCooldowns: true })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Đặt lại trạng thái & Làm mới</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-5 border-b border-slate-800/80 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          Chiến lược điều phối cụm khóa
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Khi một khóa chạm ngưỡng 429 (Quota/Rate Limit), máy
                          chủ tự động đưa khóa đó vào trạng thái nghỉ 60 giây và
                          chuyển tức thì sang khóa tiếp theo.
                        </p>
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg self-start shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdatePoolConfig({ strategy: 'failover' })
                          }
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            poolStatus.strategy === 'failover'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Ưu tiên & Dự phòng (Failover)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdatePoolConfig({ strategy: 'round-robin' })
                          }
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            poolStatus.strategy === 'round-robin'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Chia tải luân phiên (Round-Robin)
                        </button>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800/70 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-white">
                          Tự động chuyển sang mô hình dự phòng khi hết hạn mức
                          mô hình
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Nếu mô hình đang chọn bị giới hạn RPM/TPM trên tất cả
                          các khóa, tự động chuyển tiếp yêu cầu sang{' '}
                          <span className="font-mono text-slate-300">
                            gemini-flash-latest
                          </span>{' '}
                          hoặc{' '}
                          <span className="font-mono text-slate-300">
                            gemini-3.1-flash-lite
                          </span>{' '}
                          (hạn mức độc lập).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateActiveThread((t) => ({
                            ...t,
                            autoModelFallback: !(t.autoModelFallback ?? true),
                          }))
                        }
                        className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeThread.autoModelFallback ?? true
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {activeThread.autoModelFallback ?? true
                          ? 'Đang bật'
                          : 'Đang tắt'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs tabular-nums">
                      <thead>
                        <tr className="bg-slate-950/70 border-b border-slate-800 text-slate-400">
                          <th className="px-5 py-2.5 font-medium">Vị trí</th>
                          <th className="px-5 py-2.5 font-medium">
                            Biến môi trường (Secrets)
                          </th>
                          <th className="px-5 py-2.5 font-medium">
                            Trạng thái
                          </th>
                          <th className="px-5 py-2.5 font-medium text-right">
                            Lượt gọi
                          </th>
                          <th className="px-5 py-2.5 font-medium text-right">
                            Lần chuyển 429
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {poolStatus.slots.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-5 py-4 text-center text-slate-500"
                            >
                              Chưa có khóa nào được cấu hình trong Settings &gt;
                              Secrets.
                            </td>
                          </tr>
                        ) : (
                          poolStatus.slots.map((slot) => (
                            <tr
                              key={slot.index}
                              className="hover:bg-slate-900/60"
                            >
                              <td className="px-5 py-3 font-medium text-slate-200">
                                {slot.label}
                              </td>
                              <td className="px-5 py-3 font-mono text-slate-300">
                                {slot.envSource}
                              </td>
                              <td className="px-5 py-3">
                                {slot.status === 'ready' ? (
                                  <span className="text-emerald-400 font-medium">
                                    Sẵn sàng hoạt động
                                  </span>
                                ) : (
                                  <span className="text-amber-400 font-medium">
                                    Đang nghỉ chờ ({slot.cooldownRemainingSec}s)
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-right text-slate-300">
                                {slot.totalRequests}
                              </td>
                              <td className="px-5 py-3 text-right text-slate-300">
                                {slot.rateLimitHits}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-5 py-4 bg-slate-950/80 border-t border-slate-800 space-y-2.5 text-xs text-slate-300 leading-relaxed">
                    <div className="font-semibold text-white">
                      Hướng dẫn thêm nhiều khóa qua bảng Settings &gt; Secrets của Google AI Studio:
                    </div>
                    <p className="text-slate-400">
                      Theo quy chuẩn bảo mật của nền tảng Google AI Studio, khóa API không nhập trực tiếp trên giao diện web mà được quản lý an toàn trong mục{' '}
                      <strong className="text-slate-200">Settings (biểu tượng bánh răng) &gt; Secrets</strong> của AI Studio. Máy chủ sẽ tự động nạp tất cả khóa ngay khi bạn lưu:
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {['GEMINI_API_KEYS', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3'].map((envVar) => (
                        <button
                          key={envVar}
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(envVar);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 font-mono text-xs text-blue-300 hover:text-blue-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          title="Sao chép tên biến môi trường"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{envVar}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Firestore Custom API Keys Manager */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">
                        Quản lý Key Tùy chỉnh (Lưu trữ an toàn trên Firebase Firestore)
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Đăng nhập tài khoản Google để thêm hoặc xóa trực tiếp các khóa API phụ vào cụm xoay vòng.
                      </p>
                    </div>

                    <div>
                      {firebaseUser ? (
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-300 truncate max-w-[180px]">
                            {firebaseUser.email}
                          </span>
                          <button
                            type="button"
                            onClick={handleLogout}
                            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Đăng xuất
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          disabled={isAuthLoading}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          <span>Đăng nhập Google</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {firebaseUser ? (
                    <div className="space-y-4">
                      <form onSubmit={handleAddCustomKey} className="flex flex-col sm:flex-row gap-2.5">
                        <input
                          type="text"
                          value={newKeyLabel}
                          onChange={(e) => setNewKeyLabel(e.target.value)}
                          placeholder="Tên gợi nhớ (VD: Key phụ dự án A)"
                          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                        />
                        <input
                          type="password"
                          value={newKeyValue}
                          onChange={(e) => setNewKeyValue(e.target.value)}
                          placeholder="Dán mã API Key (AIzaSy...)"
                          className="flex-[2] bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={!newKeyValue.trim()}
                          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Thêm Key
                        </button>
                      </form>

                      <div className="space-y-2 pt-2">
                        <div className="text-xs font-medium text-slate-400">
                          Danh sách Key tùy chỉnh đã lưu ({customKeys.length}):
                        </div>
                        {customKeys.length === 0 ? (
                          <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-500">
                            Chưa có khóa tùy chỉnh nào được lưu trên Firestore.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {customKeys.map((k) => (
                              <div
                                key={k.id}
                                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                              >
                                <div className="space-y-0.5 min-w-0">
                                  <div className="font-semibold text-slate-200 truncate">
                                    {k.label}
                                  </div>
                                  <div className="font-mono text-slate-400 truncate">
                                    {k.key.slice(0, 8)}••••••••{k.key.slice(-4)}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomKey(k.id)}
                                  className="p-1.5 rounded hover:bg-red-950/60 text-slate-400 hover:text-red-400 transition-colors shrink-0"
                                  title="Xóa key"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-lg bg-slate-950/50 border border-slate-800 text-center space-y-2">
                      <p className="text-xs text-slate-400">
                        Vui lòng đăng nhập tài khoản Google để thêm, xóa và lưu trữ an toàn danh sách các khóa API cá nhân trên Firestore.
                      </p>
                    </div>
                  )}
                </div>

                {/* Free Tier Rate Limits Table for AI Studio Models */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">
                        Hạn mức Free Tier của các Mô hình AI Studio
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Thông số giới hạn yêu cầu (RPM), hạn mức ngày (RPD) và dung lượng token (TPM) trên gói miễn phí.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs tabular-nums">
                      <thead>
                        <tr className="bg-slate-950/70 border-b border-slate-800 text-slate-400">
                          <th className="px-5 py-2.5 font-medium">Mô hình</th>
                          <th className="px-5 py-2.5 font-medium">RPM (Số yêu cầu/phút)</th>
                          <th className="px-5 py-2.5 font-medium">RPD (Số yêu cầu/ngày)</th>
                          <th className="px-5 py-2.5 font-medium">TPM (Token/phút)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {AVAILABLE_MODELS.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-900/60">
                            <td className="px-5 py-3 font-medium text-white">
                              {m.name}
                              <div className="text-[11px] font-mono text-slate-400">{m.id}</div>
                            </td>
                            <td className="px-5 py-3 text-blue-300 font-medium">{m.freeTierRpm}</td>
                            <td className="px-5 py-3 text-emerald-300 font-medium">{m.freeTierRpd}</td>
                            <td className="px-5 py-3 text-slate-200">{m.freeTierTpm}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Recharts Analytics Dashboard */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 pb-6">
                  {/* Model Usage Pie Chart */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col">
                    <h3 className="font-display text-sm font-semibold text-white mb-1">
                      Tỷ lệ Sử dụng Mô hình
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Phân bổ số lượng yêu cầu theo từng model Gemini.
                    </p>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Gemini 3.8 Flash', value: 65, color: '#3b82f6' },
                              { name: 'Gemini Flash Latest', value: 25, color: '#6366f1' },
                              { name: 'Gemini 3.1 Flash Lite', value: 10, color: '#10b981' },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={4}
                            dataKey="value"
                            label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          >
                            {[
                              { color: '#3b82f6' },
                              { color: '#6366f1' },
                              { color: '#10b981' },
                            ].map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0f172a',
                              borderColor: '#1e293b',
                              borderRadius: '8px',
                              fontSize: '12px',
                              color: '#f8fafc',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Daily Request Volume Bar Chart */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col">
                    <h3 className="font-display text-sm font-semibold text-white mb-1">
                      Lưu lượng Yêu cầu theo Ngày
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Số lượng request thành công trong 7 ngày qua.
                    </p>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { day: 'Thứ 2', requests: 120 },
                            { day: 'Thứ 3', requests: 240 },
                            { day: 'Thứ 4', requests: 180 },
                            { day: 'Thứ 5', requests: 310 },
                            { day: 'Thứ 6', requests: 290 },
                            { day: 'Thứ 7', requests: 420 },
                            { day: 'Chủ nhật', requests: 380 },
                          ]}
                        >
                          <XAxis
                            dataKey="day"
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                          />
                          <YAxis
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0f172a',
                              borderColor: '#1e293b',
                              borderRadius: '8px',
                              fontSize: '12px',
                              color: '#f8fafc',
                            }}
                          />
                          <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeView === 'terminal' && <Terminal />}
        </main>
      </div>
    </div>
  );
}

interface ThreadRowProps {
  thread: ChatThread;
  isActive: boolean;
  isEditing: boolean;
  editingValue: string;
  onSelect: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onStartRename: (e: React.MouseEvent) => void;
  onChangeRename: (val: string) => void;
  onSaveRename: () => void;
}

const ThreadRow: React.FC<ThreadRowProps> = ({
  thread,
  isActive,
  isEditing,
  editingValue,
  onSelect,
  onTogglePin,
  onDelete,
  onStartRename,
  onChangeRename,
  onSaveRename,
}) => {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
        isActive
          ? 'bg-slate-800/90 text-white font-medium'
          : 'text-slate-300 hover:bg-slate-800/45 hover:text-white'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        {isEditing ? (
          <input
            type="text"
            value={editingValue}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChangeRename(e.target.value)}
            onBlur={onSaveRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveRename();
            }}
            className="w-full bg-slate-950 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
          />
        ) : (
          <div className="truncate flex-1">
            <span className="truncate">{thread.title}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[11px] text-slate-500 tabular-nums group-hover:hidden">
          {formatDateShort(thread.updatedAt)}
        </span>
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button
            type="button"
            onClick={onStartRename}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
            title="Đổi tên"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onTogglePin}
            className={`p-1 rounded hover:bg-slate-700 ${
              thread.pinned
                ? 'text-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
            title={thread.pinned ? 'Bỏ ghim' : 'Ghim hội thoại'}
          >
            <Pin className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1 rounded hover:bg-red-950/60 text-slate-400 hover:text-red-400"
            title="Xóa hội thoại"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
