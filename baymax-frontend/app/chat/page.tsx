"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { dataService } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {
    Send, Mic, Square, Loader2, ArrowLeft,
    Globe, Stethoscope, ChevronDown, CheckCircle2,
    MessageSquare, AlertTriangle, User as UserIcon
} from "lucide-react";

interface ToolUsage {
    type: "web_search" | "medicine_info" | "triage";
    label: string;
}

interface ChatMessage {
    id: string;
    role: "user" | "bot";
    content: string;
    transcript?: string;
    toolsUsed?: ToolUsage[];
    isStreaming?: boolean;
}

export default function ChatPage() {
    const router = useRouter();
    const { user } = useAuth();
    const { toast } = useToast();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingPhase, setThinkingPhase] = useState("Analyzing request...");

    // Generate a unique session ID for this chat window instance once
    const [sessionId] = useState(() => `web_${Date.now()}_${Math.random().toString(36).substring(7)}`);

    // Audio recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(() => {
        scrollToBottom();
    }, [messages, isThinking, thinkingPhase]);

    // Cycling thinking phases while waiting
    useEffect(() => {
        if (!isThinking) return;
        const phases = [
            "Analyzing request...",
            "Consulting clinical guidelines...",
            "Checking databases...",
            "Formulating response..."
        ];
        let idx = 0;
        const interval = setInterval(() => {
            idx = (idx + 1) % phases.length;
            setThinkingPhase(phases[idx]);
        }, 2000);
        return () => clearInterval(interval);
    }, [isThinking]);

    const handleSendText = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim() || isThinking) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: "user",
            content: input.trim()
        };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsThinking(true);
        setThinkingPhase("Analyzing request...");

        try {
            const res = await dataService.chat(user?.phone || "", userMsg.content, sessionId);
            processBotResponse(res);
        } catch (error) {
            toast("Failed to process message", "error");
            setIsThinking(false);
        }
    };

    const processBotResponse = (res: any, forceTranscript?: string) => {
        setIsThinking(false);

        const toolsUsed: ToolUsage[] = [];
        if (res.web_search_used) {
            toolsUsed.push({
                type: "web_search",
                label: res.web_search_source ? `Searched Web: ${res.web_search_source}` : "Searched Web"
            });
        }
        if (res.agent_used === "pharmacy_agent") {
            toolsUsed.push({
                type: "medicine_info",
                label: "Consulted Medicine Database"
            });
        }
        if (res.triage_level && res.triage_level !== "none") {
            toolsUsed.push({
                type: "triage",
                label: `Safety Protocol: Tier ${res.triage_level.toUpperCase()}`
            });
        }

        const botMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: "bot",
            content: res.reply || "",
            toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
            transcript: forceTranscript,
        };

        setMessages(prev => [...prev, botMsg]);
    };

    // --- Audio Recording Logic ---
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());
                await handleSendVoice(audioBlob);
            };

            mediaRecorder.start();
            setIsRecording(true);
            setRecordingDuration(0);
            timerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);
        } catch (e) {
            toast("Microphone access denied or unavailable", "error");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    const handleSendVoice = async (blob: Blob) => {
        setIsThinking(true);
        setThinkingPhase("Transcribing audio...");

        // Optimistically add user audio message
        const tempId = Date.now().toString();
        setMessages(prev => [...prev, {
            id: tempId,
            role: "user",
            content: "🎙️ Voice note",
            transcript: "Transcribing..."
        }]);

        try {
            const res = await dataService.sendVoice(user?.phone || "", blob, sessionId);

            // Update the user message with actual transcript
            setMessages(prev => prev.map(msg =>
                msg.id === tempId ? { ...msg, transcript: res.transcript } : msg
            ));

            processBotResponse(res);
        } catch (error) {
            toast("Failed to process voice note", "error");
            setMessages(prev => prev.filter(msg => msg.id !== tempId));
            setIsThinking(false);
        }
    };

    // --- Render ---
    const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="flex flex-col h-screen bg-[#fafbfc] text-slate-900 font-sans">
            {/* Header */}
            <header className="flex-shrink-0 h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between px-4 md:px-8">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push('/dashboard')}
                        className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            Clinical AI Assistant
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest">
                                Baymax V6
                            </span>
                        </h1>
                        <p className="text-xs font-semibold text-slate-500">Secure, encrypted, multi-lingual chat.</p>
                    </div>
                </div>
            </header>

            {/* Chat Area */}
            <main className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto p-4 md:p-8 space-y-8 scrollbar-hide pb-56">
                {messages.length === 0 && !isThinking ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                        <MessageSquare size={48} className="text-emerald-500 mb-4 opacity-50" />
                        <h2 className="text-2xl font-bold text-slate-700">How can I help you today?</h2>
                        <p className="text-slate-500 mt-2 max-w-sm">
                            Ask about your medications, describe your symptoms, or upload a prescription. I'll automatically respond in your preferred language.
                        </p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`flex max-w-[85%] gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

                                {/* Avatar */}
                                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-emerald-100 text-emerald-600 border border-emerald-200'
                                    }`}>
                                    {msg.role === 'user' ? <UserIcon size={16} /> : <Stethoscope size={18} />}
                                </div>

                                {/* Content Bubble */}
                                <div className="flex flex-col gap-2 w-full max-w-[calc(100%-3rem)]">
                                    {/* User Bubble */}
                                    {msg.role === 'user' && (
                                        <div className="bg-slate-900 text-white px-5 py-3.5 rounded-3xl rounded-tr-sm shadow-md">
                                            <p className="text-[15px] leading-relaxed font-medium">{msg.content}</p>
                                            {msg.transcript && (
                                                <div className="mt-2 pt-2 border-t border-slate-700/50">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Transcript</p>
                                                    <p className="text-sm text-slate-300 italic">"{msg.transcript}"</p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Bot Bubble */}
                                    {msg.role === 'bot' && (
                                        <div className="flex flex-col gap-3">
                                            {/* Tools Status Accordions */}
                                            {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                                                <div className="flex flex-col gap-1.5 self-start">
                                                    {msg.toolsUsed.map((tool, idx) => (
                                                        <div key={idx} className="flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">
                                                            {tool.type === 'web_search' && <Globe size={14} className="text-blue-500" />}
                                                            {tool.type === 'medicine_info' && <PillIcon size={14} className="text-emerald-500" />}
                                                            {tool.type === 'triage' && <AlertTriangle size={14} className="text-amber-500" />}
                                                            {tool.label}
                                                            <CheckCircle2 size={12} className="text-emerald-500 ml-1" />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Markdown Content */}
                                            <div className="prose prose-sm md:prose-base prose-slate max-w-none text-slate-800 leading-relaxed marker:text-emerald-500 prose-a:text-emerald-600">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {msg.content}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}

                {/* Thinking Indicator */}
                <AnimatePresence>
                    {isThinking && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex items-start gap-4"
                        >
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shadow-inner text-slate-400">
                                <Loader2 size={16} className="animate-spin" />
                            </div>
                            <div className="bg-slate-50 border border-slate-200 px-5 py-3.5 rounded-3xl rounded-tl-sm shadow-sm flex items-center gap-3">
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

                <div ref={messagesEndRef} className="h-4" />
            </main>

            {/* Input Area Overlay */}
            <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-[#fafbfc] via-[#fafbfc] to-transparent pt-12 pb-6 px-4 md:px-8 z-30">
                <div className="max-w-3xl mx-auto relative">
                    {isRecording ? (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-white border-2 border-emerald-500 shadow-[0_8px_30px_rgb(5,150,105,0.15)] rounded-2xl p-4 flex items-center justify-between"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse shadow-[0_0_15px_rgb(239,68,68,0.5)]" />
                                <div>
                                    <p className="text-sm font-bold text-slate-900">Recording Audio...</p>
                                    <p className="text-xs font-bold font-mono text-emerald-600 transition-all">{formatTime(recordingDuration)}</p>
                                </div>
                            </div>
                            <button
                                onClick={stopRecording}
                                className="h-10 px-6 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-colors flex items-center gap-2"
                            >
                                <Square size={14} className="fill-current" /> Stop & Send
                            </button>
                        </motion.div>
                    ) : (
                        <form
                            onSubmit={handleSendText}
                            className="bg-white border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.06)] rounded-3xl p-2 flex items-end gap-2 focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-50 transition-all"
                        >
                            <button
                                type="button"
                                onClick={startRecording}
                                disabled={isThinking}
                                className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                            >
                                <Mic size={22} />
                            </button>

                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendText();
                                    }
                                }}
                                placeholder="Message Clinical AI..."
                                disabled={isThinking}
                                className="flex-1 max-h-32 min-h-[48px] bg-transparent resize-none outline-none py-3.5 px-2 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 disabled:opacity-50 break-words"
                                rows={1}
                            />

                            <button
                                type="submit"
                                disabled={!input.trim() || isThinking}
                                className="flex-shrink-0 w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 shadow-md"
                            >
                                <Send size={18} className="translate-x-[-1px] translate-y-[1px]" />
                            </button>
                        </form>
                    )}
                    <p className="text-center mt-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Baymax can make mistakes. Check important clinical information.
                    </p>
                </div>
            </div>
        </div>
    );
}

// Inline pill icon for tools
function PillIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
            <path d="m8.5 8.5 7 7" />
        </svg>
    )
}
