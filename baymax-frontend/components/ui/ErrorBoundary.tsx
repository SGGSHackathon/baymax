"use client";

import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught:", error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-[#fafbfc] text-slate-900 flex items-center justify-center p-8">
                    <div className="bg-white border border-slate-200 shadow-xl rounded-2xl p-10 max-w-md text-center space-y-6">
                        <div className="w-16 h-16 mx-auto rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
                            <AlertTriangle size={28} className="text-red-500" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight mb-2 text-slate-900">Something went wrong</h2>
                            <p className="text-sm text-slate-500 leading-relaxed font-medium">
                                An unexpected error occurred. Try reloading or contact support if this persists.
                            </p>
                        </div>
                        {this.state.error && (
                            <pre className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 text-left overflow-x-auto font-mono">
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={this.handleReset}
                            className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-emerald-800 transition-colors active:scale-[0.98] w-full"
                        >
                            <RotateCw size={14} />
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
