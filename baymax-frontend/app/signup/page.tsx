"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

export default function SignupPage() {
    const router = useRouter();
    const { signup } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [formData, setFormData] = useState({
        name: "", phone: "", email: "", password: "",
        age: "", gender: "", city: "", pincode: "", country: "India",
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const payload = { ...formData, age: formData.age ? parseInt(formData.age) : undefined };
            await signup(payload);
            router.push("/dashboard");
        } catch (err: any) {
            let errMsg = "Registration failed.";
            if (err.apiError?.message) {
                errMsg = err.apiError.message;
            } else if (err?.response?.data?.detail) {
                const d = err.response.data.detail;
                errMsg = typeof d === "string" ? d : (Array.isArray(d) ? d[0]?.msg?.replace("Value error, ", "") : errMsg);
            } else if (err.message === "Network Error") {
                errMsg = "Unable to connect to server.";
            }
            setError(errMsg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#fafbfc] flex relative font-sans">
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-[20%] left-[20%] w-[400px] h-[400px] bg-emerald-50 rounded-full blur-[150px] opacity-50" />
                <div className="absolute bottom-[20%] right-[20%] w-[400px] h-[400px] bg-teal-50 rounded-full blur-[100px] opacity-30" />
            </div>

            {/* Left panel */}
            <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="hidden lg:flex lg:w-1/3 flex-col justify-between p-12 z-10"
            >
                <Link href="/" className="flex items-center gap-3 w-fit">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white text-[10px] font-black">BX</div>
                    <span className="font-bold tracking-tight text-xl text-slate-900">Baymax <span className="text-emerald-600">Assistant</span></span>
                </Link>
                <div>
                    <h2 className="text-4xl font-bold mb-6 tracking-tight text-slate-900 leading-tight">Join the network.</h2>
                    <p className="text-slate-500 leading-relaxed text-lg font-medium">
                        Create an identity on the secure clinical network to begin managing health records, vitals, and receiving AI triage.
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-bold uppercase tracking-widest">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" /> End-to-End Encrypted
                </div>
            </motion.div>

            {/* Right panel (form) */}
            <motion.div
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="w-full lg:w-2/3 flex items-center justify-center p-6 md:p-12 z-10 overflow-y-auto"
            >
                <div className="w-full max-w-[540px] my-auto">
                    <div className="mb-10 block lg:hidden">
                        <Link href="/" className="flex items-center gap-3 w-fit">
                            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white text-[10px] font-black">BX</div>
                            <span className="font-bold tracking-tight text-xl text-slate-900">Baymax</span>
                        </Link>
                    </div>

                    <div className="bg-white rounded-[32px] border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">Request Access</h1>
                        <p className="text-slate-500 mb-8 font-medium">Register to the clinical network.</p>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Full Name</label>
                                    <input name="name" value={formData.name} onChange={handleChange} required placeholder="Rahul Sharma" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Phone</label>
                                    <input name="phone" value={formData.phone} onChange={handleChange} required placeholder="+919876543210" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Email</label>
                                <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="rahul@example.com" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Password</label>
                                <input name="password" type="password" value={formData.password} onChange={handleChange} required placeholder="Min 6 characters" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Age</label>
                                    <input name="age" type="number" value={formData.age} onChange={handleChange} placeholder="28" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Gender</label>
                                    <select name="gender" value={formData.gender} onChange={handleChange} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all appearance-none">
                                        <option value="">Select</option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Pincode</label>
                                    <input name="pincode" value={formData.pincode} onChange={handleChange} placeholder="110001" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">City</label>
                                <input name="city" value={formData.city} onChange={handleChange} placeholder="New Delhi" className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                            </div>

                            {error && (
                                <div className="text-red-500 text-sm font-medium bg-red-50 border border-red-100 px-4 py-3 rounded-xl">{error}</div>
                            )}

                            <button type="submit" disabled={loading} className="w-full h-14 flex items-center justify-center gap-2 bg-slate-900 text-white font-bold rounded-2xl hover:bg-emerald-800 transition-all shadow-xl shadow-slate-200 hover:shadow-emerald-200 active:scale-[0.98] disabled:opacity-50 text-sm">
                                {loading ? <Loader2 className="animate-spin" size={18} /> : <>Create Account <ArrowRight size={16} /></>}
                            </button>
                        </form>

                        <p className="text-sm text-slate-400 mt-8 text-center font-medium">
                            Already registered?{" "}
                            <Link href="/login" className="text-emerald-600 font-bold hover:text-emerald-700">Sign In</Link>
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
