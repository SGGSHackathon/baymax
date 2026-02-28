"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await login(identifier, password);
            router.push("/dashboard");
        } catch (err: any) {
            const msg = err.apiError?.message || err?.response?.data?.detail || err?.message || "Authentication failed.";
            setError(msg === "Network Error" ? "Unable to connect to server." : msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#fafbfc] flex relative font-sans">
            {/* Decorative */}
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-[-15%] right-[-10%] w-[45%] h-[45%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
            </div>

            {/* Left panel */}
            <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 z-10"
            >
                <Link href="/" className="flex items-center gap-3 w-fit">
                    <Image src="/baymax-logo.png" alt="Baymax" width={112} height={112} className="w-28 h-28 object-contain" />
                    <span className="font-bold tracking-tight text-xl text-slate-900">Baymax <span className="text-emerald-600">Assistant</span></span>
                </Link>
                <div className="max-w-md">
                    <h2 className="text-4xl font-bold mb-6 tracking-tight text-slate-900 leading-tight">
                        Secure Patient<br /><span className="text-emerald-600">Access Node.</span>
                    </h2>
                    <p className="text-slate-500 leading-relaxed text-lg font-medium">
                        Clinical intelligence platform requiring authorized access. All activity is logged and encrypted end-to-end.
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-bold uppercase tracking-widest">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" /> HIPAA Compliant
                </div>
            </motion.div>

            {/* Right panel (form) */}
            <motion.div
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="w-full lg:w-1/2 flex items-center justify-center p-8 z-10"
            >
                <div className="w-full max-w-[420px]">
                    {/* Mobile logo */}
                    <div className="mb-10 block lg:hidden">
                        <Link href="/" className="flex items-center gap-3 w-fit mb-12">
                            <Image src="/baymax-logo.png" alt="Baymax" width={40} height={40} className="w-10 h-10 object-contain" />
                            <span className="font-bold tracking-tight text-xl text-slate-900">Baymax</span>
                        </Link>
                    </div>

                    <div className="bg-white rounded-[32px] border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">Welcome back</h1>
                        <p className="text-slate-500 mb-8 font-medium">Enter your credentials to continue.</p>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Identifier (Phone/Email)</label>
                                <input
                                    type="text"
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    placeholder="Ex: +919876543210"
                                    className="w-full h-14 bg-slate-50 border border-slate-200 rounded-2xl px-5 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
                                    required
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Password</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full h-14 bg-slate-50 border border-slate-200 rounded-2xl px-5 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
                                    required
                                />
                            </div>

                            {error && (
                                <div className="text-red-500 text-sm font-medium bg-red-50 border border-red-100 px-4 py-3 rounded-xl">{error}</div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full h-14 flex items-center justify-center gap-2 bg-slate-900 text-white font-bold rounded-2xl hover:bg-emerald-800 transition-all shadow-xl shadow-slate-200 hover:shadow-emerald-200 active:scale-[0.98] disabled:opacity-50 text-sm"
                            >
                                {loading ? <Loader2 className="animate-spin" size={18} /> : <>Authenticate <ArrowRight size={16} /></>}
                            </button>
                        </form>

                        <p className="text-sm text-slate-400 mt-8 text-center font-medium">
                            Don&apos;t have an account?{" "}
                            <Link href="/signup" className="text-emerald-600 font-bold hover:text-emerald-700">Request Access</Link>
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
