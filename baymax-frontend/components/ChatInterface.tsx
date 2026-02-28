"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Info, Mic, Square, Volume2, VolumeX, ShoppingCart, Package, Minus, Plus, CheckCircle, ExternalLink } from "lucide-react";
import { dataService } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OrderItem } from "@/types/api";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    metadata?: {
        triage?: string;
        emergency?: boolean;
        audio_base64?: string;
        agent_used?: string;
        requires_action?: string;
        order_items?: OrderItem[];
        safety_flags?: string[];
        sources?: string[];
        web_search_used?: boolean;
    };
};

// â”€â”€ Source Chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SourceChips({ sources, webSearchUsed }: { sources?: string[]; webSearchUsed?: boolean }) {
    if (!sources || sources.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 mt-2">
            {sources.map((src) => (
                <span
                    key={src}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700 tracking-wide"
                >
                    {webSearchUsed ? <ExternalLink size={9} /> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />}
                    {src}
                </span>
            ))}
        </div>
    );
}

// â”€â”€ Speaker Button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SpeakerButton({ text, msgId, onAudio }: { text: string; msgId: string; onAudio: (audio: string, msgId: string) => void }) {
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
            formData.append("text", text);
            const res = await dataService.playTTS(formData);
            const audio = new Audio(`data:audio/wav;base64,${res.audio_base64}`);
            audioRef.current = audio;
            audio.onended = () => setState("idle");
            audio.onpause = () => setState("idle");
            audio.play();
            setState("playing");
            onAudio(res.audio_base64, msgId);
        } catch {
            setState("idle");
        }
    };

    return (
        <button
            onClick={handleClick}
            title={state === "playing" ? "Stop speaking" : "Read aloud"}
            className={`w-6 h-6 flex items-center justify-center rounded-full mt-1 transition-all
                ${state === "playing"
                    ? "bg-emerald-100 text-emerald-600 animate-pulse"
                    : state === "loading"
                        ? "bg-slate-100 text-slate-300 cursor-wait"
                        : "bg-transparent text-slate-300 hover:text-emerald-500 hover:bg-emerald-50"
                }`}
        >
            {state === "loading" ? (
                <Loader2 size={12} className="animate-spin" />
            ) : state === "playing" ? (
                <VolumeX size={12} />
            ) : (
                <Volume2 size={12} />
            )}
        </button>
    );
}

// â”€â”€ OrderCard Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function OrderCard({
    items,
    requiresAction,
    onSendMessage,
}: {
    items: OrderItem[];
    requiresAction?: string;
    onSendMessage: (msg: string) => void;
}) {
    const [quantities, setQuantities] = useState<Record<string, number>>(() => {
        const init: Record<string, number> = {};
        items.forEach(item => { init[item.drug_name] = 10; });
        return init;
    });
    const [ordered, setOrdered] = useState(false);

    const updateQty = (drugName: string, delta: number) => {
        setQuantities(prev => ({
            ...prev,
            [drugName]: Math.max(1, Math.min((prev[drugName] || 10) + delta, items.find(i => i.drug_name === drugName)?.stock_qty || 999))
        }));
    };

    const handleOrder = (item: OrderItem) => {
        const qty = quantities[item.drug_name] || 10;
        onSendMessage(String(qty));
        setOrdered(true);
    };

    if (items.length === 0) return null;

    return (
        <div className="mt-3 space-y-3">
            {items.map((item) => {
                const qty = quantities[item.drug_name] || 10;
                const total = (qty * item.price_per_unit).toFixed(2);
                return (
                    <div key={item.drug_name} className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                        {/* Header */}
                        <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                                    <Package size={16} className="text-emerald-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm text-slate-900">
                                        {item.brand_name || item.drug_name}
                                    </h4>
                                    {item.brand_name && item.brand_name !== item.drug_name && (
                                        <p className="text-[10px] text-slate-500 font-medium">{item.drug_name} {item.strength}</p>
                                    )}
                                </div>
                            </div>
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest rounded-md">
                                In Stock
                            </span>
                        </div>

                        {/* Details Grid */}
                        <div className="px-4 py-3 grid grid-cols-3 gap-3 text-center">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Available</p>
                                <p className="text-sm font-bold text-slate-700 mt-0.5">{item.stock_qty} {item.unit}s</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Price</p>
                                <p className="text-sm font-bold text-slate-700 mt-0.5">â‚¹{item.price_per_unit}/{item.unit}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Type</p>
                                <p className="text-sm font-bold mt-0.5">
                                    {item.is_otc
                                        ? <span className="text-emerald-600">OTC âœ“</span>
                                        : <span className="text-amber-600">Rx Needed</span>
                                    }
                                </p>
                            </div>
                        </div>

                        {/* Quantity Picker + Order Button */}
                        {requiresAction === "order_quantity" && !ordered && (
                            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => updateQty(item.drug_name, -1)}
                                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                                    >
                                        <Minus size={14} />
                                    </button>
                                    <input
                                        type="number"
                                        min={1}
                                        max={item.stock_qty}
                                        value={qty}
                                        onChange={(e) => {
                                            const v = parseInt(e.target.value) || 1;
                                            setQuantities(prev => ({ ...prev, [item.drug_name]: Math.max(1, Math.min(v, item.stock_qty)) }));
                                        }}
                                        className="w-16 h-8 text-center bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100"
                                    />
                                    <button
                                        onClick={() => updateQty(item.drug_name, 1)}
                                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                                    >
                                        <Plus size={14} />
                                    </button>
                                    <span className="text-xs font-bold text-slate-400 ml-2">{item.unit}s</span>
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-bold text-slate-700">â‚¹{total}</span>
                                    <button
                                        onClick={() => handleOrder(item)}
                                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all active:scale-[0.97] flex items-center gap-1.5 shadow-sm"
                                    >
                                        <ShoppingCart size={12} /> Order
                                    </button>
                                </div>
                            </div>
                        )}

                        {ordered && (
                            <div className="px-4 py-3 border-t border-emerald-100 bg-emerald-50/50 flex items-center gap-2 text-xs font-bold text-emerald-700">
                                <CheckCircle size={14} /> Order request sent â€” check below for confirmation.
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// â”€â”€ Main Chat Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const handleAudio = (audio_base64: string, msgId: string) => {
        setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, metadata: { ...m.metadata, audio_base64 } } : m
        ));
    };

    // Helper: programmatically send a message (used by OrderCard)
    const sendMessage = (text: string) => {
        setInput(text);
        setTimeout(() => {
            const form = document.getElementById("chat-form") as HTMLFormElement;
            if (form) form.requestSubmit();
        }, 50);
    };

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
            let finalSources: string[] = [];
            let finalWebSearch = false;

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

                        // â”€â”€ Graph result (order agent, action flows) â”€â”€
                        if (payload.type === "graph_result") {
                            finalSources = payload.sources || [];
                            finalWebSearch = payload.web_search_used || false;
                            const graphMsg: Message = {
                                id: assistantId,
                                role: "assistant",
                                content: payload.text || "",
                                metadata: {
                                    agent_used: payload.agent_used,
                                    requires_action: payload.requires_action,
                                    order_items: payload.order_items,
                                    emergency: payload.emergency,
                                    safety_flags: payload.safety_flags,
                                    sources: finalSources,
                                    web_search_used: finalWebSearch,
                                },
                            };
                            accumulated = payload.text || "";
                            setMessages(prev => prev.map(m => m.id === assistantId ? graphMsg : m));
                            continue;
                        }

                        // â”€â”€ Token streaming â”€â”€
                        if (payload.type === "token") {
                            if (payload.text) {
                                accumulated += payload.text;
                                const snapshot = accumulated;
                                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: snapshot } : m));
                            }
                            // done=true carries final sources
                            if (payload.done) {
                                finalSources = payload.sources || [];
                                setMessages(prev => prev.map(m =>
                                    m.id === assistantId
                                        ? { ...m, metadata: { ...m.metadata, sources: finalSources } }
                                        : m
                                ));
                            }
                        }
                    } catch { }
                }
            }

            if (!accumulated) {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: "No response received." } : m));
            }
        } catch {
            toast("Failed to get response. Please try again.", "error");
            setMessages(prev => {
                const errMsg: Message = { id: assistantId, role: "assistant", content: "System encountered an anomaly. Please try again." };
                const exists = prev.find(m => m.id === assistantId);
                if (exists) return prev.map(m => m.id === assistantId ? errMsg : m);
                return [...prev, errMsg];
            });
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
                setMessages(prev => [...prev, { id: Date.now().toString(), role: "user", content: "ðŸŽ¤ Sent voice note" }]);
                try {
                    const resp = await dataService.sendVoice(phone, audioBlob, phone);
                    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: resp.reply || "Voice processed.", metadata: { triage: (resp as any).triage_level, emergency: resp.emergency, audio_base64: resp.audio_base64 } }]);
                } catch { toast("Voice processing failed", "error"); } finally { setIsLoading(false); }
            };
            recorder.start();
            setIsRecording(true);
        } catch { toast("Microphone access is required for voice chat", "error"); }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-[28px] border border-slate-200 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden">
            {/* Chat header */}
            <div className="shrink-0 h-14 border-b border-slate-100 bg-white flex items-center px-4 justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-sm font-bold tracking-tight text-slate-900">Baymax Core <span className="text-slate-400 font-mono text-xs">v6.0</span></span>
                </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6 bg-slate-50/50">
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

                            {/* Order Card */}
                            {msg.metadata?.order_items && msg.metadata.order_items.length > 0 && (
                                <OrderCard
                                    items={msg.metadata.order_items}
                                    requiresAction={msg.metadata.requires_action}
                                    onSendMessage={sendMessage}
                                />
                            )}

                            {/* Sources */}
                            {msg.role === "assistant" && (
                                <SourceChips
                                    sources={msg.metadata?.sources}
                                    webSearchUsed={msg.metadata?.web_search_used}
                                />
                            )}

                            {/* Speaker button (assistant only, shown when content exists) */}
                            {msg.role === "assistant" && msg.content && (
                                <SpeakerButton
                                    text={msg.content}
                                    msgId={msg.id}
                                    onAudio={handleAudio}
                                />
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
            <div className="shrink-0 p-3 bg-white border-t border-slate-100">
                <form id="chat-form" onSubmit={handleSend} className="relative flex items-center">
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
