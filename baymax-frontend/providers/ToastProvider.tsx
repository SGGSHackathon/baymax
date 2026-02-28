"use client";

import { createContext, useCallback, useState, type ReactNode } from "react";
import { X, CheckCircle, AlertTriangle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

export interface ToastContextType {
    toast: (message: string, type?: ToastType) => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);

const ICON_MAP = {
    success: <CheckCircle size={16} className="text-emerald-500 shrink-0" />,
    error: <AlertTriangle size={16} className="text-red-500 shrink-0" />,
    info: <Info size={16} className="text-blue-500 shrink-0" />,
};

const BORDER_MAP = {
    success: "border-emerald-200 bg-emerald-50",
    error: "border-red-200 bg-red-50",
    info: "border-blue-200 bg-blue-50",
};

export default function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, type: ToastType = "info") => {
        const id = Date.now().toString() + Math.random().toString(36).slice(2);
        setToasts((prev) => [...prev, { id, message, type }]);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toast: addToast }}>
            {children}

            {/* Toast container — fixed bottom-right */}
            {toasts.length > 0 && (
                <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
                    {toasts.map((t) => (
                        <div
                            key={t.id}
                            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl animate-in slide-in-from-right-5 fade-in duration-300 max-w-[380px] ${BORDER_MAP[t.type]}`}
                        >
                            {ICON_MAP[t.type]}
                            <span className="text-sm text-slate-800 font-bold tracking-tight flex-1">{t.message}</span>
                            <button
                                onClick={() => removeToast(t.id)}
                                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-900 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </ToastContext.Provider>
    );
}
