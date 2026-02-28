"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { dataService } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {
    Send, Mic, Square, Loader2, ArrowLeft,
    Globe, Stethoscope, AlertTriangle, User as UserIcon,
    Volume2, VolumeX, ExternalLink,
    MessageSquare, Phone, PhoneOff, MicOff
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatMode = null | "text" | "voice";
type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface ToolBadge {
    icon: "web" | "medicine" | "triage";
    label: string;
}

interface ChatMessage {
    id: string;
    role: "user" | "bot";
    content: string;
    transcript?: string;
    tools?: ToolBadge[];
    sources?: string[];
    webSearchUsed?: boolean;
    emergency?: boolean;
}

// ── Strip markdown for clean TTS ─────────────────────────────────────────────
function stripMarkdown(text: string): string {
    return text
        .replace(/#{1,6}\s*/g, "")          // headings
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")  // bold/italic
        .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")    // underline/italic
        .replace(/`{1,3}[^`]*`{1,3}/g, "")        // inline code / code blocks
        .replace(/```[\s\S]*?```/g, "")            // fenced code blocks
        .replace(/^>\s*/gm, "")                    // blockquotes
        .replace(/^[-*+]\s+/gm, "")               // list bullets
        .replace(/^\d+\.\s+/gm, "")               // ordered list
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")    // images
        .replace(/\|[^\n]+\|/g, "")               // tables
        .replace(/[-]{2,}/g, "")                   // horizontal rules
        .replace(/\n{3,}/g, "\n\n")               // excess newlines
        .trim();
}

// ── Speaker Button (text mode only) ──────────────────────────────────────────

function SpeakerButton({ text }: { text: string }) {
    const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handleClick = async () => {
        if (state === "playing") {
            audioRef.current?.pause();
            setState("idle");
            return;
        }
        setState("loading");
        try {
            const formData = new FormData();
            formData.append("text", stripMarkdown(text));
            const res = await dataService.playTTS(formData);
            const audio = new Audio(`data:audio/wav;base64,${res.audio_base64}`);
            audioRef.current = audio;
            audio.onended = () => setState("idle");
            audio.onpause = () => setState("idle");
            audio.play();
            setState("playing");
        } catch {
            setState("idle");
        }
    };

    return (
        <button
            onClick={handleClick}
            title={state === "playing" ? "Stop" : "Read aloud"}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all
                ${state === "playing"
                    ? "bg-emerald-100 text-emerald-600 animate-pulse"
                    : state === "loading"
                        ? "text-slate-300 cursor-wait"
                        : "text-slate-300 hover:text-emerald-500 hover:bg-emerald-50"
                }`}
        >
            {state === "loading" ? (
                <Loader2 size={13} className="animate-spin" />
            ) : state === "playing" ? (
                <VolumeX size={13} />
            ) : (
                <Volume2 size={13} />
            )}
        </button>
    );
}

// ── Source Chips ───────────────────────────────────────────────────────────────

function SourceChips({ sources, webSearchUsed }: { sources?: string[]; webSearchUsed?: boolean }) {
    if (!sources || sources.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 mt-1">
            {sources.map((src) => (
                <span
                    key={src}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700 tracking-wide"
                >
                    {webSearchUsed
                        ? <ExternalLink size={9} />
                        : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />}
                    {src}
                </span>
            ))}
        </div>
    );
}

// ── Tool Badge Row ─────────────────────────────────────────────────────────────

function ToolBadgeRow({ tools }: { tools: ToolBadge[] }) {
    if (!tools.length) return null;
    return (
        <div className="flex flex-col gap-1.5 mb-2">
            {tools.map((tool, idx) => (
                <div key={idx} className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold w-fit shadow-sm">
                    {tool.icon === "web" && <Globe size={13} className="text-blue-500" />}
                    {tool.icon === "medicine" && <PillIcon size={13} className="text-emerald-500" />}
                    {tool.icon === "triage" && <AlertTriangle size={13} className="text-amber-500" />}
                    {tool.label}
                </div>
            ))}
        </div>
    );
}

// ── Voice Orb ─────────────────────────────────────────────────────────────────

function VoiceOrb({ voiceState }: { voiceState: VoiceState }) {
    const colorMap: Record<VoiceState, string> = {
        idle:        "from-emerald-400 to-teal-500",
        listening:   "from-red-400 to-rose-500",
        transcribing:"from-amber-400 to-orange-400",
        thinking:    "from-blue-400 to-indigo-500",
        speaking:    "from-violet-400 to-purple-500",
    };
    const labelMap: Record<VoiceState, string> = {
        idle:        "Tap mic to speak",
        listening:   "Listening…",
        transcribing:"Transcribing…",
        thinking:    "Thinking…",
        speaking:    "Speaking…",
    };
    const isPulsing = voiceState !== "idle";
    return (
        <div className="flex flex-col items-center gap-4">
            <div className="relative flex items-center justify-center">
                {isPulsing && (
                    <>
                        <span className={`absolute inline-flex h-40 w-40 rounded-full bg-gradient-to-br ${colorMap[voiceState]} opacity-20 animate-ping`} />
                        <span className={`absolute inline-flex h-32 w-32 rounded-full bg-gradient-to-br ${colorMap[voiceState]} opacity-30 animate-ping`}
                            style={{ animationDelay: "0.3s" }} />
                    </>
                )}
                <motion.div
                    animate={{ scale: isPulsing ? [1, 1.07, 1] : 1 }}
                    transition={{ repeat: isPulsing ? Infinity : 0, duration: 1.5, ease: "easeInOut" }}
                    className={`relative w-28 h-28 rounded-full bg-gradient-to-br ${colorMap[voiceState]} shadow-2xl flex items-center justify-center`}
                >
                    {voiceState === "idle"        && <Mic size={38} className="text-white drop-shadow" />}
                    {voiceState === "listening"   && <MicOff size={38} className="text-white drop-shadow animate-pulse" />}
                    {voiceState === "transcribing"&& <Loader2 size={38} className="text-white drop-shadow animate-spin" />}
                    {voiceState === "thinking"    && <Stethoscope size={38} className="text-white drop-shadow" />}
                    {voiceState === "speaking"    && <Volume2 size={38} className="text-white drop-shadow animate-bounce" />}
                </motion.div>
            </div>
            <span className="text-sm font-bold text-slate-500 tracking-wide">{labelMap[voiceState]}</span>
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ChatPage() {
    const router = useRouter();
    const { user } = useAuth();
    const { toast } = useToast();

    const [chatMode, setChatMode] = useState<ChatMode>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingPhase, setThinkingPhase] = useState("Analyzing request...");

    // Text mode recording
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);

    // Voice call state
    const [voiceState, setVoiceState] = useState<VoiceState>("idle");
    const [callDuration, setCallDuration] = useState(0);
    const [lastCaption, setLastCaption] = useState<{ user: string; bot: string }>({ user: "", bot: "" });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const autoPlayAudioRef = useRef<HTMLAudioElement | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const callTimerRef = useRef<NodeJS.Timeout | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);


    // Load history on mount
    useEffect(() => {
        if (!user?.phone) return;
        dataService.getChatMessages(user.phone, 40)
            .then((rows) => {
                if (!rows || rows.length === 0) return;
                setMessages(rows.map((r, i) => ({
                    id: `history_${i}`,
                    role: r.role === "assistant" ? "bot" : "user",
                    content: r.content,
                })));
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.phone]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isThinking, voiceState]);

    // Thinking phase cycling
    useEffect(() => {
        if (!isThinking) return;
        const phases = [
            "Analyzing request...",
            "Consulting clinical guidelines...",
            "Checking databases...",
            "Formulating response...",
        ];
        let idx = 0;
        const interval = setInterval(() => {
            idx = (idx + 1) % phases.length;
            setThinkingPhase(phases[idx]);
        }, 2000);
        return () => clearInterval(interval);
    }, [isThinking]);

    // Call timer (voice mode)
    useEffect(() => {
        if (chatMode === "voice") {
            setCallDuration(0);
            callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
        } else {
            if (callTimerRef.current) clearInterval(callTimerRef.current);
        }
        return () => { if (callTimerRef.current) clearInterval(callTimerRef.current); };
    }, [chatMode]);

    const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

    // Auto-resize textarea
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const ta = e.target;
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 128) + "px";
    };

    // ── Auto TTS ──────────────────────────────────────────────────────────────

    const playTTSAuto = useCallback(async (text: string) => {
        try {
            if (autoPlayAudioRef.current) { autoPlayAudioRef.current.pause(); autoPlayAudioRef.current = null; }
            setVoiceState("speaking");
            const fd = new FormData();
            fd.append("text", stripMarkdown(text));
            const res = await dataService.playTTS(fd);
            const audio = new Audio(`data:audio/wav;base64,${res.audio_base64}`);
            autoPlayAudioRef.current = audio;
            audio.onended = () => { setVoiceState("idle"); autoPlayAudioRef.current = null; };
            audio.onpause = () => { setVoiceState("idle"); autoPlayAudioRef.current = null; };
            audio.play();
        } catch {
            setVoiceState("idle");
        }
    }, []);

    const stopAutoPlay = () => {
        autoPlayAudioRef.current?.pause();
        autoPlayAudioRef.current = null;
        setVoiceState("idle");
    };

    // ── Stream sender ─────────────────────────────────────────────────────────

    const sendStream = useCallback(async (messageText: string, autoTTS = false) => {
        setIsThinking(false);
        const assistantId = `bot_${Date.now()}`;
        setMessages(prev => [...prev, { id: assistantId, role: "bot", content: "" }]);

        try {
            const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
            const token = typeof window !== "undefined" ? localStorage.getItem("baymax_token") : null;

            const res = await fetch(`${baseURL}/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ phone: user?.phone || "", message: messageText, channel: "web" }),
            });
            if (!res.ok || !res.body) throw new Error("Stream failed");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = "";
            let buffer = "";
            let finalSources: string[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const payload = JSON.parse(line.slice(6));
                        if (payload.type === "graph_result") {
                            accumulated = payload.text || "";
                            finalSources = payload.sources || [];
                            const tools: ToolBadge[] = [];
                            if (payload.web_search_used) tools.push({ icon: "web", label: payload.web_search_source ? `Web: ${payload.web_search_source}` : "Searched Web" });
                            if (payload.agent_used === "pharmacy_agent") tools.push({ icon: "medicine", label: "Medicine Database" });
                            if (payload.triage_level && payload.triage_level !== "none") tools.push({ icon: "triage", label: `Safety: Tier ${String(payload.triage_level).toUpperCase()}` });
                            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated, sources: finalSources, webSearchUsed: payload.web_search_used || false, tools, emergency: payload.emergency } : m));
                            continue;
                        }
                        if (payload.type === "token") {
                            if (payload.text) { accumulated += payload.text; const snap = accumulated; setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: snap } : m)); }
                            if (payload.done) { finalSources = payload.sources || []; setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, sources: finalSources } : m)); }
                        }
                    } catch { /* skip */ }
                }
            }

            if (!accumulated) {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: "No response received." } : m));
            } else if (autoTTS) {
                setLastCaption(prev => ({ ...prev, bot: accumulated }));
                await playTTSAuto(accumulated);
            }
        } catch {
            toast("Failed to get response. Please try again.", "error");
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: "System encountered an anomaly. Please try again." } : m));
            setVoiceState("idle");
        }
    }, [user?.phone, playTTSAuto, toast]);

    // ── Text mode send ────────────────────────────────────────────────────────

    const handleSendText = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim() || isThinking) return;
        const text = input.trim();
        setMessages(prev => [...prev, { id: `user_${Date.now()}`, role: "user", content: text }]);
        setInput("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        setIsThinking(true);
        await sendStream(text, false);
        setIsThinking(false);
    };

    // ── Shared recording ──────────────────────────────────────────────────────

    const startRecording = async (mode: "text" | "voice") => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            recorder.onstop = async () => {
                const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                stream.getTracks().forEach(t => t.stop());
                if (mode === "voice") await handleSendVoiceCall(blob);
                else await handleSendVoiceText(blob);
            };
            recorder.start();
            if (mode === "text") {
                setIsRecording(true);
                setRecordingDuration(0);
                timerRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);
            } else {
                setVoiceState("listening");
            }
        } catch {
            toast("Microphone access denied or unavailable", "error");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && (isRecording || voiceState === "listening")) {
            mediaRecorderRef.current.stop();
            if (isRecording) { setIsRecording(false); if (timerRef.current) clearInterval(timerRef.current); }
        }
    };

    // ── Text mode voice handler ───────────────────────────────────────────────

    const handleSendVoiceText = async (blob: Blob) => {
        setIsThinking(true);
        setThinkingPhase("Transcribing audio...");
        const tempId = `user_voice_${Date.now()}`;
        setMessages(prev => [...prev, { id: tempId, role: "user", content: "🎙️ Voice note", transcript: "Transcribing..." }]);
        try {
            const res = await dataService.sendVoice(user?.phone || "", blob, user?.phone || "");
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, transcript: res.transcript } : m));
            await sendStream(res.transcript || "", false);
        } catch {
            toast("Failed to process voice note", "error");
            setMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            setIsThinking(false);
        }
    };

    // ── Voice call handler ────────────────────────────────────────────────────

    const handleSendVoiceCall = async (blob: Blob) => {
        setVoiceState("transcribing");
        const tempId = `user_voice_${Date.now()}`;
        try {
            const res = await dataService.sendVoice(user?.phone || "", blob, user?.phone || "");
            const transcript = res.transcript || "";
            setLastCaption(prev => ({ ...prev, user: transcript }));
            setMessages(prev => [...prev, { id: tempId, role: "user", content: transcript }]);
            setVoiceState("thinking");
            await sendStream(transcript, true);
        } catch {
            toast("Failed to process voice", "error");
            setVoiceState("idle");
        }
    };

    // ── End call ──────────────────────────────────────────────────────────────

    const endCall = () => {
        stopAutoPlay();
        if (mediaRecorderRef.current && voiceState === "listening") mediaRecorderRef.current.stop();
        setChatMode(null);
        setVoiceState("idle");
        setLastCaption({ user: "", bot: "" });
    };

    // ── Mode selection ────────────────────────────────────────────────────────

    if (chatMode === null) {
        return (
            <div className="flex flex-col h-screen bg-[#fafbfc] text-slate-900 font-sans">
                <header className="shrink-0 h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center px-4 md:px-8">
                    <button onClick={() => router.push("/dashboard")} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors mr-4">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            Clinical AI Assistant
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest">Baymax V6</span>
                        </h1>
                        <p className="text-xs font-semibold text-slate-500">Choose how you want to interact</p>
                    </div>
                </header>

                <main className="flex-1 flex flex-col items-center justify-center px-6 gap-10">
                    <div className="text-center">
                        <Stethoscope size={52} className="text-emerald-400 mx-auto mb-4" />
                        <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-2">Web Assistant</h2>
                        <p className="text-slate-500 text-sm max-w-xs mx-auto">Select your preferred interaction mode to get started</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-xl">
                        {/* Text Chat card */}
                        <motion.button
                            whileHover={{ y: -4, scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setChatMode("text")}
                            className="group relative flex flex-col items-center gap-5 bg-white border-2 border-slate-200 hover:border-emerald-400 rounded-3xl p-8 shadow-sm hover:shadow-xl transition-all overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/0 to-emerald-100/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl" />
                            <div className="relative w-16 h-16 rounded-2xl bg-slate-100 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
                                <MessageSquare size={32} className="text-slate-500 group-hover:text-emerald-600 transition-colors" />
                            </div>
                            <div className="relative text-center">
                                <h3 className="text-xl font-black text-slate-800 mb-2">Text Chat</h3>
                                <p className="text-sm text-slate-500 leading-relaxed">Type your questions and read responses. Full markdown, sources, and history.</p>
                            </div>
                            <div className="relative flex flex-wrap justify-center gap-1.5">
                                {["Text input", "Markdown", "Sources"].map(t => (
                                    <span key={t} className="px-2 py-0.5 bg-slate-100 group-hover:bg-emerald-50 text-slate-600 group-hover:text-emerald-700 rounded-full text-[10px] font-bold transition-colors">{t}</span>
                                ))}
                            </div>
                        </motion.button>

                        {/* Voice Chat card */}
                        <motion.button
                            whileHover={{ y: -4, scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setChatMode("voice")}
                            className="group relative flex flex-col items-center gap-5 bg-white border-2 border-slate-200 hover:border-violet-400 rounded-3xl p-8 shadow-sm hover:shadow-xl transition-all overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-violet-50/0 to-violet-100/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl" />
                            <div className="relative w-16 h-16 rounded-2xl bg-slate-100 group-hover:bg-violet-100 flex items-center justify-center transition-colors">
                                <Phone size={32} className="text-slate-500 group-hover:text-violet-600 transition-colors" />
                            </div>
                            <div className="relative text-center">
                                <h3 className="text-xl font-black text-slate-800 mb-2">Voice Chat</h3>
                                <p className="text-sm text-slate-500 leading-relaxed">Speak naturally and hear responses — like a call with your doctor, with live captions.</p>
                            </div>
                            <div className="relative flex flex-wrap justify-center gap-1.5">
                                {["Voice input", "Auto TTS", "Live captions"].map(t => (
                                    <span key={t} className="px-2 py-0.5 bg-slate-100 group-hover:bg-violet-50 text-slate-600 group-hover:text-violet-700 rounded-full text-[10px] font-bold transition-colors">{t}</span>
                                ))}
                            </div>
                        </motion.button>
                    </div>
                </main>
            </div>
        );
    }

    // ── Voice Call UI ─────────────────────────────────────────────────────────

    if (chatMode === "voice") {
        const canSpeak = voiceState === "idle";
        return (
            <div className="flex flex-col h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white font-sans">

                {/* Call header */}
                <header className="shrink-0 h-16 flex items-center justify-between px-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                            <Stethoscope size={18} className="text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-sm font-black text-white">AI Doctor · Baymax</p>
                            <p className="text-[10px] font-mono font-bold text-emerald-400">{formatTime(callDuration)} · Encrypted</p>
                        </div>
                    </div>
                    <button
                        onClick={endCall}
                        className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/30 text-red-400 px-4 py-2 rounded-full text-xs font-bold transition-all"
                    >
                        <PhoneOff size={13} /> End Call
                    </button>
                </header>

                {/* Caption scrollable area */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
                    {messages.length === 0 && voiceState === "idle" && (
                        <div className="flex flex-col items-center justify-center h-full text-center opacity-40 py-12">
                            <Mic size={32} className="text-white/50 mb-3" />
                            <p className="text-sm font-bold text-white/60">Tap the mic below to start speaking</p>
                        </div>
                    )}
                    {messages.map((msg) => (
                        <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed font-medium
                                ${msg.role === "user"
                                    ? "bg-white/10 text-white/90 rounded-tr-sm"
                                    : "bg-emerald-500/15 border border-emerald-500/20 text-white/90 rounded-tl-sm"
                                }`}>
                                {msg.content || (
                                    <span className="flex gap-1 items-center">
                                        <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                        <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                        <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                    </span>
                                )}
                            </div>
                        </motion.div>
                    ))}
                    <div ref={bottomRef} className="h-2" />
                </div>

                {/* Orb + controls */}
                <div className="shrink-0 border-t border-white/10 bg-slate-900/80 backdrop-blur-md px-6 py-8 flex flex-col items-center gap-6">
                    <VoiceOrb voiceState={voiceState} />

                    <div className="flex items-center gap-6">
                        {canSpeak ? (
                            <motion.button
                                whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.93 }}
                                onClick={() => startRecording("voice")}
                                className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-[0_8px_32px_rgba(16,185,129,0.4)] flex items-center justify-center text-white"
                            >
                                <Mic size={32} />
                            </motion.button>
                        ) : voiceState === "listening" ? (
                            <motion.button
                                whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.93 }}
                                onClick={stopRecording}
                                className="w-20 h-20 rounded-full bg-gradient-to-br from-red-500 to-rose-600 shadow-[0_8px_32px_rgba(239,68,68,0.4)] flex items-center justify-center text-white animate-pulse"
                            >
                                <Square size={28} className="fill-current" />
                            </motion.button>
                        ) : (
                            <div className="w-20 h-20 rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-white/30 cursor-not-allowed">
                                <MicOff size={28} />
                            </div>
                        )}

                        {voiceState === "speaking" && (
                            <motion.button
                                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                                onClick={stopAutoPlay}
                                className="flex items-center gap-2 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 px-5 py-3 rounded-full text-sm font-bold transition-all"
                            >
                                <VolumeX size={15} /> Stop
                            </motion.button>
                        )}
                    </div>

                    {/* Live caption strip */}
                    <AnimatePresence mode="wait">
                        {(lastCaption.user || lastCaption.bot) && (
                            <motion.div
                                key={lastCaption.user + lastCaption.bot}
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                                className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl px-5 py-4 space-y-2"
                            >
                                {lastCaption.user && (
                                    <p className="text-xs text-white/50">
                                        <span className="font-black text-white/70 mr-1">You:</span>{lastCaption.user}
                                    </p>
                                )}
                                {lastCaption.bot && (
                                    <p className="text-xs text-emerald-300/80">
                                        <span className="font-black text-emerald-400 mr-1">Baymax:</span>
                                        {stripMarkdown(lastCaption.bot).slice(0, 220)}{lastCaption.bot.length > 220 ? "…" : ""}
                                    </p>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        );
    }

    // ── Text Chat UI ──────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-screen bg-[#fafbfc] text-slate-900 font-sans">

            {/* Header */}
            <header className="shrink-0 h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-4 md:px-8">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setChatMode(null)}
                        className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            Text Chat
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest">
                                Baymax V6
                            </span>
                        </h1>
                        <p className="text-xs font-semibold text-slate-500">Secure · Encrypted · Multi-lingual</p>
                    </div>
                </div>
                <button
                    onClick={() => setChatMode("voice")}
                    className="flex items-center gap-2 bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                >
                    <Phone size={12} /> Switch to Voice
                </button>
            </header>

            {/* Messages */}
            <main className="flex-1 min-h-0 overflow-y-auto w-full max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-8">
                {messages.length === 0 && !isThinking && (
                    <div className="flex flex-col items-center justify-center text-center opacity-60 py-24">
                        <Stethoscope size={48} className="text-emerald-400 mb-4" />
                        <h2 className="text-2xl font-bold text-slate-700">How can I help you today?</h2>
                        <p className="text-slate-500 mt-2 max-w-sm text-sm">
                            Ask about your medications, describe symptoms, or request a triage. I will respond in your preferred language.
                        </p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`flex max-w-[85%] gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm mt-1
                                ${msg.role === "user" ? "bg-slate-900 text-white" : "bg-emerald-100 text-emerald-600 border border-emerald-200"}`}>
                                {msg.role === "user" ? <UserIcon size={15} /> : <Stethoscope size={16} />}
                            </div>
                            <div className={`flex flex-col gap-1 min-w-0 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                                {msg.role === "user" ? (
                                    <div className="bg-slate-900 text-white px-5 py-3.5 rounded-3xl rounded-tr-sm shadow-md">
                                        <p className="text-[15px] leading-relaxed font-medium">{msg.content}</p>
                                        {msg.transcript && (
                                            <div className="mt-2 pt-2 border-t border-slate-700/50">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Transcript</p>
                                                <p className="text-sm text-slate-300 italic">"{msg.transcript}"</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2 w-full">
                                        {msg.tools && msg.tools.length > 0 && <ToolBadgeRow tools={msg.tools} />}
                                        <div className="relative">
                                            {msg.content ? (
                                                <div className="prose prose-sm md:prose-base prose-slate max-w-none text-slate-800 leading-relaxed marker:text-emerald-500 prose-a:text-emerald-600 prose-code:text-emerald-700 prose-code:bg-emerald-50 prose-code:px-1 prose-code:rounded prose-code:text-xs">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 py-1">
                                                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                                </div>
                                            )}
                                            {msg.content && (
                                                <div className="mt-1 flex items-center gap-2">
                                                    <SpeakerButton text={msg.content} />
                                                </div>
                                            )}
                                        </div>
                                        <SourceChips sources={msg.sources} webSearchUsed={msg.webSearchUsed} />
                                        {msg.emergency && (
                                            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-lg w-fit border border-red-100 font-bold">
                                                <AlertTriangle size={12} /> Emergency Protocol Engaged
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                <AnimatePresence>
                    {isThinking && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="flex items-start gap-3">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200 flex items-center justify-center">
                                <Loader2 size={15} className="animate-spin" />
                            </div>
                            <div className="bg-white border border-slate-200 px-5 py-3.5 rounded-3xl rounded-tl-sm shadow-sm flex items-center gap-3">
                                <span className="text-sm font-bold text-slate-600">{thinkingPhase}</span>
                                <span className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                </span>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div ref={bottomRef} className="h-2" />
            </main>

            {/* Text input */}
            <div className="shrink-0 border-t border-slate-200 bg-white/90 backdrop-blur-md px-4 md:px-8 py-4">
                <div className="max-w-3xl mx-auto flex flex-col gap-2">
                    {isRecording ? (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-white border-2 border-emerald-500 shadow-[0_4px_20px_rgb(5,150,105,0.12)] rounded-2xl p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-3.5 h-3.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_12px_rgb(239,68,68,0.5)]" />
                                <div>
                                    <p className="text-sm font-bold text-slate-900">Recording...</p>
                                    <p className="text-xs font-mono font-bold text-emerald-600">{formatTime(recordingDuration)}</p>
                                </div>
                            </div>
                            <button onClick={stopRecording} className="h-10 px-5 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-colors flex items-center gap-2">
                                <Square size={13} className="fill-current" /> Stop & Send
                            </button>
                        </motion.div>
                    ) : (
                        <form onSubmit={handleSendText}
                            className="bg-white border border-slate-200 shadow-[0_4px_20px_rgb(0,0,0,0.05)] rounded-3xl p-2 flex items-end gap-2 focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-50 transition-all">
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={handleInputChange}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
                                placeholder="Message Clinical AI..."
                                disabled={isThinking}
                                rows={1}
                                className="flex-1 min-h-[44px] max-h-32 bg-transparent resize-none outline-none py-3 px-2 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 disabled:opacity-50"
                            />
                            <button type="submit" disabled={!input.trim() || isThinking}
                                className="shrink-0 w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:bg-slate-200 disabled:text-slate-400 shadow-md">
                                <Send size={17} />
                            </button>
                        </form>
                    )}
                    <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Baymax can make mistakes. Verify important clinical information.
                    </p>
                </div>
            </div>
        </div>
    );
}

// ── Pill icon ──────────────────────────────────────────────────────────────────
function PillIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={className}>
            <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
            <path d="m8.5 8.5 7 7" />
        </svg>
    );
}














