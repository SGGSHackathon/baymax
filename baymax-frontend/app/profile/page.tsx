"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { authService, dataService } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import {
    Loader2, ArrowLeft, Save, User as UserIcon, Activity,
    Pill, Clock, FileText, AlertTriangle, Edit3, HeartPulse
} from "lucide-react";
import type { Language, FullHistory } from "@/types/api";

export default function FullProfilePage() {
    const router = useRouter();
    const { user, refreshUser } = useAuth();
    const { toast } = useToast();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [history, setHistory] = useState<FullHistory | null>(null);
    const [languages, setLanguages] = useState<Language[]>([]);

    // UI State
    const [activeTab, setActiveTab] = useState("overview");
    const [isEditing, setIsEditing] = useState(false);

    const [form, setForm] = useState({
        name: "", email: "", age: "", gender: "",
        city: "", pincode: "", preferred_language: "en-IN",
    });

    useEffect(() => {
        if (!authService.isAuthenticated()) {
            router.push("/login");
            return;
        }

        const fetchInitialData = async () => {
            try {
                const [langs, fullHist] = await Promise.all([
                    dataService.getLanguages(),
                    dataService.getFullHistory(user?.phone || "")
                ]);

                setLanguages(langs);
                setHistory(fullHist);

                // Populate edit form
                const u = fullHist.user;
                setForm({
                    name: u.name || "",
                    email: u.email || "",
                    age: u.age?.toString() || "",
                    gender: u.gender || "",
                    city: u.city || "",
                    pincode: u.pincode || "",
                    preferred_language: u.preferred_language || "en-IN",
                });
            } catch (err: any) {
                toast("Failed to load full profile history", "error");
            } finally {
                setLoading(false);
            }
        };

        if (user?.phone) fetchInitialData();
    }, [user?.phone, router, toast]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await authService.updateProfile({
                ...form,
                age: form.age ? parseInt(form.age) : undefined,
            });
            await refreshUser();

            // Re-fetch to update local state without full reload
            const fullHist = await dataService.getFullHistory(user?.phone || "");
            setHistory(fullHist);

            toast("Profile updated successfully", "success");
            setIsEditing(false);
        } catch (err: any) {
            toast(err.apiError?.message || "Failed to update profile", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading || !history) {
        return (
            <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            </div>
        );
    }

    const { user: profileData, active_medications, orders, health_timeline, adverse_reactions, adherence_scores } = history;

    return (
        <div className="min-h-screen bg-[#fafbfc] text-slate-900 font-sans relative">
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
            </div>

            <main className="max-w-5xl mx-auto relative z-10 p-4 md:p-8 flex flex-col gap-6">

                {/* Navigation Back */}
                <div className="flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors text-sm font-bold">
                        <ArrowLeft size={16} /> Dashboard
                    </Link>
                </div>

                {/* Profile Header Card */}
                <div className="bg-white border border-slate-200 rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 blur-[50px] rounded-full group-hover:bg-emerald-100/50 transition-all pointer-events-none" />

                    <div className="flex items-center gap-5 relative z-10">
                        <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                            <UserIcon size={36} strokeWidth={1} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                                {profileData.name || "Unknown Patient"}
                                {profileData.risk_tier && (
                                    <span className={`text-[10px] uppercase font-black tracking-widest px-2 py-1 rounded-md ${profileData.risk_tier >= 3 ? 'bg-red-50 text-red-600 border border-red-100' :
                                            profileData.risk_tier >= 2 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                                'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                        }`}>
                                        Tier {profileData.risk_tier} Risk
                                    </span>
                                )}
                            </h1>
                            <p className="text-slate-500 font-medium mt-1 tracking-wide text-sm">
                                {profileData.phone} • {profileData.age ? `${profileData.age} yrs` : "Age N/A"} • {profileData.gender ? profileData.gender.charAt(0).toUpperCase() + profileData.gender.slice(1) : "Gender N/A"}
                            </p>
                            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-2 flex gap-4">
                                <span>Blood: <span className="text-slate-600">{profileData.blood_group || "—"}</span></span>
                                <span>Weight: <span className="text-slate-600">{profileData.weight_kg ? `${profileData.weight_kg}kg` : "—"}</span></span>
                                <span>BMI: <span className="text-slate-600">{profileData.bmi || "—"}</span></span>
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="relative z-10 h-10 px-5 flex items-center gap-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-emerald-800 transition-colors active:scale-[0.98]"
                    >
                        {isEditing ? <ArrowLeft size={14} /> : <Edit3 size={14} />}
                        {isEditing ? "Back to Profile" : "Edit Profile"}
                    </button>
                </div>

                {isEditing ? (
                    /* Edit Mode */
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white border border-slate-200 rounded-[32px] p-6 md:p-8">
                        <h2 className="text-xl font-bold text-slate-900 mb-6">Edit Basic Information</h2>
                        <form onSubmit={handleSave} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Full Name</label>
                                    <input name="name" value={form.name} onChange={handleChange} required className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Email Address</label>
                                    <input name="email" type="email" value={form.email} onChange={handleChange} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Age</label>
                                    <input name="age" type="number" min="0" max="120" value={form.age} onChange={handleChange} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Gender</label>
                                    <select name="gender" value={form.gender} onChange={handleChange} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 appearance-none transition-all">
                                        <option value="">Select Gender</option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">City / Town</label>
                                    <input name="city" value={form.city} onChange={handleChange} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Preferred Chat Language</label>
                                    <select name="preferred_language" value={form.preferred_language} onChange={handleChange} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 appearance-none transition-all">
                                        {languages.map(l => (
                                            <option key={l.code} value={l.code}>{l.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="pt-6 flex justify-end">
                                <button type="submit" disabled={saving} className="h-12 px-8 flex items-center gap-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 text-sm">
                                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Changes
                                </button>
                            </div>
                        </form>
                    </motion.div>
                ) : (
                    /* Tabs Layout */
                    <div className="flex flex-col md:flex-row gap-6">

                        {/* Sidebar */}
                        <div className="w-full md:w-64 flex flex-row md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
                            {[
                                { id: 'overview', icon: Activity, label: 'Health Overview' },
                                { id: 'meds', icon: Pill, label: 'Medications' },
                                { id: 'orders', icon: FileText, label: 'Order History' },
                                { id: 'timeline', icon: Clock, label: 'Timeline Events' },
                            ].map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm whitespace-nowrap transition-all ${isActive
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                : 'text-slate-500 hover:bg-slate-50 border border-transparent'
                                            }`}
                                    >
                                        <Icon size={16} className={isActive ? 'text-emerald-500' : 'text-slate-400'} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 min-h-[500px]">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeTab}
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    transition={{ duration: 0.2 }}
                                    className="bg-white border border-slate-200 rounded-[32px] p-6 md:p-8"
                                >

                                    {/* --- TAB: OVERVIEW --- */}
                                    {activeTab === 'overview' && (
                                        <div className="space-y-8">
                                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Activity size={20} className="text-emerald-500" /> Key Health Insights</h2>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Overall Adherence</p>
                                                    <div className="flex items-end gap-2">
                                                        <span className="text-3xl font-black text-emerald-600">{profileData.overall_adherence ? `${profileData.overall_adherence}%` : "100%"}</span>
                                                    </div>
                                                </div>
                                                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Registration Status</p>
                                                    <div className="flex items-end gap-2">
                                                        <span className="text-3xl font-black text-slate-700">Onboarded</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div>
                                                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-2">Allergies & Conditions</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {profileData.allergies?.length ? profileData.allergies.map((a: string, i: number) => (
                                                        <span key={i} className="px-3 py-1 bg-red-50 text-red-600 border border-red-100 text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-1"><AlertTriangle size={12} /> {a}</span>
                                                    )) : <span className="text-sm text-slate-400 italic">No registered allergies.</span>}
                                                    {profileData.chronic_conditions?.length ? profileData.chronic_conditions.map((c: string, i: number) => (
                                                        <span key={i} className="px-3 py-1 bg-amber-50 text-amber-600 border border-amber-100 text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-1"><HeartPulse size={12} /> {c}</span>
                                                    )) : null}
                                                </div>
                                            </div>

                                            {adverse_reactions.length > 0 && (
                                                <div>
                                                    <h3 className="text-sm font-bold uppercase tracking-widest text-red-400 mb-4 border-b border-red-100 pb-2">Adverse Reactions</h3>
                                                    <div className="space-y-3">
                                                        {adverse_reactions.map((r, i) => (
                                                            <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-red-50 border border-red-100 rounded-xl">
                                                                <div>
                                                                    <p className="font-bold text-red-800">{r.drug_name.toUpperCase()}</p>
                                                                    <p className="text-sm text-red-600">{r.reaction}</p>
                                                                </div>
                                                                <span className="text-xs font-bold tracking-widest uppercase text-red-400 mt-2 sm:mt-0">{r.severity}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* --- TAB: MEDICATIONS --- */}
                                    {activeTab === 'meds' && (
                                        <div className="space-y-6">
                                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Pill size={20} className="text-emerald-500" /> Active Prescriptions</h2>

                                            {active_medications.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                                    <Pill className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                                    <p className="text-slate-500 font-medium text-sm">No active medications registered.</p>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 gap-4">
                                                    {active_medications.map(med => (
                                                        <div key={med.id} className="p-5 border border-slate-200 rounded-2xl hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-50 transition-all bg-white group">
                                                            <div className="flex items-start justify-between">
                                                                <div>
                                                                    <h3 className="font-bold text-lg text-slate-800">{med.drug_name.charAt(0).toUpperCase() + med.drug_name.slice(1)}</h3>
                                                                    <p className="text-emerald-600 font-bold text-sm mt-1">{med.dosage || med.dose_per_intake || 'Dose details missing'}</p>
                                                                    <p className="text-slate-500 text-xs font-medium mt-1 uppercase tracking-widest">{med.frequency || 'Frequency missing'}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    {med.prescribed_by && <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">DR. {med.prescribed_by}</span>}
                                                                    <span className="block text-xs font-bold text-slate-500 mt-1">{med.start_date?.slice(0, 10)} → {med.end_date ? med.end_date.slice(0, 10) : 'Ongoing'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* --- TAB: ORDERS --- */}
                                    {activeTab === 'orders' && (
                                        <div className="space-y-6">
                                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><FileText size={20} className="text-emerald-500" /> Order History</h2>

                                            {orders.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                                    <FileText className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                                    <p className="text-slate-500 font-medium text-sm">No orders found.</p>
                                                </div>
                                            ) : (
                                                <div className="overflow-x-auto relative">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="border-b-2 border-slate-100">
                                                                <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Order ID</th>
                                                                <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Drug</th>
                                                                <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Qty</th>
                                                                <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Date</th>
                                                                <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right w-24">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {orders.map(o => (
                                                                <tr key={o.id} className="hover:bg-slate-50/50 transition-colors">
                                                                    <td className="py-4 font-mono text-xs text-slate-500">{o.order_number}</td>
                                                                    <td className="py-4 font-bold text-sm text-slate-800">{o.drug_name.charAt(0).toUpperCase() + o.drug_name.slice(1)}</td>
                                                                    <td className="py-4 font-bold text-sm text-slate-600 text-center">{o.quantity}</td>
                                                                    <td className="py-4 text-xs font-medium text-slate-500 text-right">{new Date(o.ordered_at).toLocaleDateString()}</td>
                                                                    <td className="py-4 text-right">
                                                                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${o.status === 'delivered' ? 'bg-emerald-50 text-emerald-600' :
                                                                                o.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                                                                                    'bg-slate-100 text-slate-600'
                                                                            }`}>{o.status}</span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* --- TAB: TIMELINE --- */}
                                    {activeTab === 'timeline' && (
                                        <div className="space-y-6">
                                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Clock size={20} className="text-emerald-500" /> Medical Timeline</h2>

                                            {health_timeline.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                                    <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                                    <p className="text-slate-500 font-medium text-sm">No recent health events logged.</p>
                                                </div>
                                            ) : (
                                                <div className="relative border-l border-slate-200 ml-4 space-y-8 pb-4">
                                                    {health_timeline.map((event, idx) => (
                                                        <div key={event.id} className="relative pl-6 sm:pl-8">
                                                            <div className="absolute w-3 h-3 bg-white border-2 border-emerald-500 rounded-full left-[-6px] top-1.5 ring-4 ring-white" />
                                                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 sm:p-5">
                                                                <span className="text-[10px] uppercase font-black tracking-widest text-emerald-600 mb-1 block">
                                                                    {new Date(event.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                                </span>
                                                                <h4 className="font-bold text-slate-900 text-[15px]">{event.title}</h4>
                                                                {event.description && <p className="text-sm text-slate-600 mt-2 leading-relaxed">{event.description}</p>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
