"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Info, Mic, Square, PlayCircle } from "lucide-react";
import { dataService } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    metadata?: any;
};

export default function ChatInterface({ phone }: { phone: string }) {
    const { toast } = useToast();
    const [messages, setMessages] = useState<Message[]>([
        { id: "1", role: "assistant", content: "Hello. I am Baymax. How may I assist with your vital health assessment today?" }
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);

    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<BlobPart[]>([]);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isLoading]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !phone) return;

        const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
        setMessages(prev => [...prev, userMsg]);
        const messageText = input;
        setInput("");
        setIsLoading(true);

        const assistantId = (Date.now() + 1).toString();

        try {
            const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
            const token = typeof window !== "undefined" ? localStorage.getItem("baymax_token") : null;

            const res = await fetch(`${baseURL}/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ phone, message: messageText, channel: "web" }),
            });

            if (!res.ok || !res.body) throw new Error("Stream failed");

            setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);
            setIsLoading(false);

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = "";
            let buffer = "";

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
                        if (payload.type === "token" && payload.text) {
                            accumulated += payload.text;
                            const snapshot = accumulated;
                            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: snapshot } : m));
                        }
                    } catch { }
                }
            }

            if (!accumulated) {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: "No response received." } : m));
            }
        } catch {
            try {
                const resp = await dataService.chat(phone, messageText);
                const assistantMsg: Message = { id: assistantId, role: "assistant", content: resp.reply || "No response received.", metadata: { triage: resp.triage_level, emergency: resp.emergency } };
                setMessages(prev => {
                    const exists = prev.find(m => m.id === assistantId);
                    if (exists) return prev.map(m => m.id === assistantId ? assistantMsg : m);
                    return [...prev, assistantMsg];
                });
            } catch {
                toast("Failed to get response. Please try again.", "error");
                setMessages(prev => {
                    const errMsg: Message = { id: assistantId, role: "assistant", content: "System encountered an anomaly. Please try again." };
                    const exists = prev.find(m => m.id === assistantId);
                    if (exists) return prev.map(m => m.id === assistantId ? errMsg : m);
                    return [...prev, errMsg];
                });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleRecord = async () => {
        if (isRecording && mediaRecorder.current) { mediaRecorder.current.stop(); setIsRecording(false); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            mediaRecorder.current = recorder;
            audioChunks.current = [];
            recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunks.current.push(event.data); };
            recorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: "audio/webm" });
                stream.getTracks().forEach(track => track.stop());
                if (!phone) return;
                setIsLoading(true);
                setMessages(prev => [...prev, { id: Date.now().toString(), role: "user", content: "🎤 Sent voice note" }]);
                try {
                    const resp = await dataService.sendVoice(phone, audioBlob);
                    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: resp.reply || "Voice processed.", metadata: { triage: (resp as any).triage_level, emergency: resp.emergency, audio_base64: resp.audio_base64 } }]);
                } catch { toast("Voice processing failed", "error"); } finally { setIsLoading(false); }
            };
            recorder.start();
            setIsRecording(true);
        } catch { toast("Microphone access is required for voice chat", "error"); }
    };

    const handleTTS = async (text: string, msgId: string) => {
        try {
            const formData = new FormData();
            formData.append("text", text);
            const res = await dataService.playTTS(formData);
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, metadata: { ...m.metadata, audio_base64: res.audio_base64 } } : m));
        } catch { toast("Audio generation failed", "error"); }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-[28px] border border-slate-200 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden relative z-10">
            {/* Chat header */}
            <div className="h-14 border-b border-slate-100 bg-white/80 backdrop-blur-md flex items-center px-4 justify-between z-20 absolute top-0 w-full">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-sm font-bold tracking-tight text-slate-900">Baymax Core <span className="text-slate-400 font-mono text-xs">v6.0</span></span>
                </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 pt-20 space-y-6 bg-slate-50/50">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-3 max-w-[85%] transition-all duration-300 ${msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${msg.role === "user" ? "bg-slate-900 text-white" : "bg-emerald-100 border border-emerald-200 text-emerald-700"}`}>
                            {msg.role === "user" ? <User size={16} /> : <Bot size={16} />}
                        </div>
                        <div className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                            <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "bg-slate-900 text-white rounded-tr-sm" : "bg-white border border-slate-200 rounded-tl-sm shadow-sm text-slate-700"}`}>
                                {msg.role === "assistant" ? (
                                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-headings:text-slate-900 prose-pre:bg-slate-50 prose-pre:border prose-pre:border-slate-200 prose-code:text-emerald-700 prose-code:bg-emerald-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-a:text-emerald-600 prose-strong:text-slate-800">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                    </div>
                                ) : msg.content}
                            </div>
                            {msg.metadata?.audio_base64 ? (
                                <audio controls autoPlay={msg.role === "assistant"} className="h-8 max-w-[200px] mt-1 opacity-70 hover:opacity-100 transition-opacity">
                                    <source src={`data:audio/wav;base64,${msg.metadata.audio_base64}`} type="audio/wav" />
                                </audio>
                            ) : msg.role === "assistant" && (
                                <button onClick={() => handleTTS(msg.content, msg.id)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-600 mt-1 transition-colors px-1 font-bold">
                                    <PlayCircle size={12} /> Play Audio
                                </button>
                            )}
                            {msg.metadata?.emergency && (
                                <div className="flex items-center gap-1.5 text-xs text-red-600 mt-1 bg-red-50 px-2 py-1 rounded-lg w-fit border border-red-100 font-bold">
                                    <Info size={12} /> Emergency Protocol Engaged
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex gap-3 max-w-[80%] mr-auto">
                        <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 flex items-center justify-center"><Bot size={16} /></div>
                        <div className="px-5 py-3 rounded-2xl bg-white border border-slate-200 rounded-tl-sm flex items-center gap-1 shadow-sm">
                            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                    </div>
                )}
                <div ref={bottomRef} className="h-4" />
            </div>

            {/* Input area */}
            <div className="p-3 bg-white border-t border-slate-100 sticky bottom-0 z-20">
                <form onSubmit={handleSend} className="relative flex items-center">
                    <input
                        type="text" value={input} onChange={e => setInput(e.target.value)} disabled={isLoading}
                        placeholder="Describe your symptoms or ask a medical query..."
                        className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl pl-4 pr-12 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all disabled:opacity-50"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <button type="button" onClick={handleRecord} disabled={isLoading}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${isRecording ? "bg-red-100 text-red-500 animate-pulse border border-red-200" : "bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"}`}>
                            {isRecording ? <Square size={12} className="fill-current" /> : <Mic size={14} />}
                        </button>
                        <button type="submit" disabled={!input.trim() || isLoading}
                            className="w-8 h-8 flex items-center justify-center bg-slate-900 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                            <Send size={14} className={input.trim() ? "translate-x-[1px]" : ""} />
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
