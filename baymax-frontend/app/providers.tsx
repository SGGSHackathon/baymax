"use client";

import AuthProvider from "@/providers/AuthProvider";
import ToastProvider from "@/providers/ToastProvider";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <ToastProvider>
                    {children}
                </ToastProvider>
            </AuthProvider>
        </ErrorBoundary>
    );
}
