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
    Pill, Clock, FileText, AlertTriangle, Edit3, HeartPulse,
    FileImage, ChevronDown, Eye, CheckCircle, AlertCircle,
    Bell, BellOff, X, Plus
} from "lucide-react";
import type { Language, FullHistory, Reminder, MedicineCourse } from "@/types/api";
import type { PrescriptionSummary, PrescriptionDetail } from "@/types/api";

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

    // Prescription state
    const [prescriptions, setPrescriptions] = useState<PrescriptionSummary[]>([]);
    const [expandedRx, setExpandedRx] = useState<string | null>(null);
    const [rxDetails, setRxDetails] = useState<Record<string, PrescriptionDetail>>({});
    const [rxLoading, setRxLoading] = useState<string | null>(null);
    const [showRawOcr, setShowRawOcr] = useState<string | null>(null);

    // Reminder setup state
    const [reminderModal, setReminderModal] = useState<{
        orderId: string; drugName: string; quantity: number;
    } | null>(null);
    const [reminderForm, setReminderForm] = useState({
        frequency: 2,
        times: ["08:00", "20:00"],
        days: 7,
        dose: "1 tablet",
        meal: "after_meal",
    });
    const [reminderSaving, setReminderSaving] = useState(false);

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

    // Fetch prescriptions when tab is activated
    useEffect(() => {
        if (activeTab !== "prescriptions" || !history?.user?.id) return;
        if (prescriptions.length > 0) return; // already loaded

        const fetchRx = async () => {
            try {
                const res = await dataService.getUserPrescriptions(history.user.id);
                setPrescriptions(res.prescriptions || []);
            } catch {
                toast("Failed to load prescriptions", "error");
            }
        };
        fetchRx();
    }, [activeTab, history?.user?.id]);

    const toggleRxExpand = async (rxId: string) => {
        if (expandedRx === rxId) {
            setExpandedRx(null);
            return;
        }
        setExpandedRx(rxId);

        // Load details if not cached
        if (!rxDetails[rxId]) {
            setRxLoading(rxId);
            try {
                const detail = await dataService.getPrescriptionDetails(rxId);
                setRxDetails((prev) => ({ ...prev, [rxId]: detail }));
            } catch {
                toast("Failed to load prescription details", "error");
            } finally {
                setRxLoading(null);
            }
        }
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

    // ── Reminder helpers ──
    const openReminderModal = (orderId: string, drugName: string, quantity: number) => {
        setReminderForm({ frequency: 2, times: ["08:00", "20:00"], days: 7, dose: "1 tablet", meal: "after_meal" });
        setReminderModal({ orderId, drugName, quantity });
    };

    const handleFrequencyChange = (freq: number) => {
        const defaultTimes: Record<number, string[]> = {
            1: ["09:00"],
            2: ["08:00", "20:00"],
            3: ["08:00", "14:00", "20:00"],
            4: ["06:00", "12:00", "18:00", "22:00"],
        };
        setReminderForm(f => ({
            ...f,
            frequency: freq,
            times: defaultTimes[freq] || Array.from({ length: freq }, (_, i) => `${String(8 + Math.floor(i * (14 / freq))).padStart(2, "0")}:00`),
        }));
    };

    const handleTimeChange = (idx: number, val: string) => {
        setReminderForm(f => {
            const times = [...f.times];
            times[idx] = val;
            return { ...f, times };
        });
    };

    const handleCreateReminder = async () => {
        if (!reminderModal) return;
        setReminderSaving(true);
        try {
            await dataService.createReminder({
                order_id: reminderModal.orderId,
                drug_name: reminderModal.drugName,
                dose: reminderForm.dose,
                meal_instruction: reminderForm.meal,
                frequency_per_day: reminderForm.frequency,
                remind_times: reminderForm.times,
                duration_days: reminderForm.days,
            });
            toast("Daily intake reminder enabled!", "success");
            setReminderModal(null);
            // Refresh data
            const fullHist = await dataService.getFullHistory(user?.phone || "");
            setHistory(fullHist);
        } catch (err: any) {
            toast(err?.response?.data?.detail || "Failed to create reminder", "error");
        } finally {
            setReminderSaving(false);
        }
    };

    const handleDisableReminder = async (reminderId: string) => {
        try {
            await dataService.deleteReminder(reminderId);
            toast("Reminder disabled", "success");
            const fullHist = await dataService.getFullHistory(user?.phone || "");
            setHistory(fullHist);
        } catch {
            toast("Failed to disable reminder", "error");
        }
    };

    if (loading || !history) {
        return (
            <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            </div>
        );
    }

    const { user: profileData, active_medications, orders, reminders, medicine_courses, health_timeline, adverse_reactions, adherence_scores } = history;

    // Helper: find active reminder for a given order
    const getReminderForOrder = (orderId: string) => (reminders || []).find(r => r.order_id === orderId && r.is_active);
    // Active courses
    const activeCourses = (medicine_courses || []).filter(c => c.status === 'active');
    const completedCourses = (medicine_courses || []).filter(c => c.status === 'completed');

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
                                { id: 'prescriptions', icon: FileImage, label: 'Prescriptions' },
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
                                                        <span className="text-3xl font-black text-emerald-600">{profileData.overall_adherence != null ? `${profileData.overall_adherence}%` : "N/A"}</span>
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
                                                    )) : <span className="text-sm text-slate-400 italic">No allergies recorded yet.</span>}
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

                                    {/* --- TAB: MEDICATIONS (Medicine Courses) --- */}
                                    {activeTab === 'meds' && (
                                        <div className="space-y-6">
                                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Bell size={20} className="text-emerald-500" /> Daily Intake Reminders</h2>
                                            <p className="text-sm text-slate-500 -mt-3">Your active medicine courses with daily reminders. Set up reminders from the <button onClick={() => setActiveTab('orders')} className="text-emerald-600 font-bold hover:underline">Order History</button> tab.</p>

                                            {activeCourses.length === 0 && completedCourses.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                                    <Bell className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                                    <p className="text-slate-500 font-medium text-sm">No medicine courses.</p>
                                                    <p className="text-slate-400 text-xs mt-1">Enable reminders from your orders to start a daily intake course with WhatsApp notifications.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-6">
                                                    {/* Active Courses */}
                                                    {activeCourses.length > 0 && (
                                                        <div className="space-y-4">
                                                            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">Active Courses</h3>
                                                            {activeCourses.map(course => {
                                                                const total = course.total_qty || 1;
                                                                const taken = course.doses_taken || 0;
                                                                const skipped = course.doses_skipped || 0;
                                                                const remaining = course.qty_remaining ?? total;
                                                                const progressPct = Math.min(100, Math.round(((taken + skipped) / total) * 100));
                                                                const adherencePct = (taken + skipped) > 0 ? Math.round((taken / (taken + skipped)) * 100) : 100;

                                                                return (
                                                                    <div key={course.id} className="p-5 border border-emerald-200 rounded-2xl bg-white hover:shadow-lg hover:shadow-emerald-50 transition-all">
                                                                        <div className="flex items-start justify-between">
                                                                            <div className="flex-1">
                                                                                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                                                                    <Pill size={18} className="text-emerald-500" />
                                                                                    {course.drug_name.charAt(0).toUpperCase() + course.drug_name.slice(1)}
                                                                                </h3>
                                                                                <p className="text-emerald-600 font-bold text-sm mt-1">
                                                                                    {course.dose || '1 tablet'} • {course.frequency}x/day • {course.meal_instruction?.replace('_', ' ') || 'after meal'}
                                                                                </p>
                                                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                                                    {course.times?.map((t, i) => (
                                                                                        <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold uppercase tracking-widest rounded-md">
                                                                                            {t}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                            <button
                                                                                onClick={() => course.reminder_id && handleDisableReminder(course.reminder_id)}
                                                                                className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                                                title="Disable reminder"
                                                                            >
                                                                                <BellOff size={18} />
                                                                            </button>
                                                                        </div>

                                                                        {/* Progress bar */}
                                                                        <div className="mt-4">
                                                                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                                                                <span>Course Progress</span>
                                                                                <span className="font-bold">{progressPct}%</span>
                                                                            </div>
                                                                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                                                                <div
                                                                                    className="h-full bg-emerald-500 rounded-full transition-all"
                                                                                    style={{ width: `${progressPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </div>

                                                                        {/* Stats row */}
                                                                        <div className="mt-3 grid grid-cols-4 gap-3 text-center">
                                                                            <div className="bg-emerald-50 rounded-xl py-2 px-1">
                                                                                <p className="text-lg font-black text-emerald-600">{taken}</p>
                                                                                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Taken</p>
                                                                            </div>
                                                                            <div className="bg-red-50 rounded-xl py-2 px-1">
                                                                                <p className="text-lg font-black text-red-500">{skipped}</p>
                                                                                <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Skipped</p>
                                                                            </div>
                                                                            <div className="bg-blue-50 rounded-xl py-2 px-1">
                                                                                <p className="text-lg font-black text-blue-600">{remaining}</p>
                                                                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Left</p>
                                                                            </div>
                                                                            <div className="bg-amber-50 rounded-xl py-2 px-1">
                                                                                <p className="text-lg font-black text-amber-600">{adherencePct}%</p>
                                                                                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Adherence</p>
                                                                            </div>
                                                                        </div>

                                                                        <p className="text-slate-400 text-xs font-medium mt-3">
                                                                            {course.start_date?.slice(0,10)} → {course.end_date ? course.end_date.slice(0,10) : 'Ongoing'}
                                                                            {course.duration_days ? ` (${course.duration_days} days)` : ''}
                                                                        </p>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}

                                                    {/* Completed Courses */}
                                                    {completedCourses.length > 0 && (
                                                        <div className="space-y-4">
                                                            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Completed Courses</h3>
                                                            {completedCourses.map(course => {
                                                                const taken = course.doses_taken || 0;
                                                                const skipped = course.doses_skipped || 0;
                                                                return (
                                                                    <div key={course.id} className="p-4 border border-slate-100 rounded-2xl bg-slate-50/50">
                                                                        <div className="flex items-center justify-between">
                                                                            <div>
                                                                                <h3 className="font-bold text-sm text-slate-600 flex items-center gap-2">
                                                                                    <CheckCircle size={14} className="text-emerald-400" />
                                                                                    {course.drug_name.charAt(0).toUpperCase() + course.drug_name.slice(1)}
                                                                                </h3>
                                                                                <p className="text-xs text-slate-400 mt-0.5">
                                                                                    {taken} taken • {skipped} skipped • {course.dose || '1 tablet'}
                                                                                </p>
                                                                            </div>
                                                                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-500 text-[10px] font-black uppercase tracking-widest rounded-lg">Completed</span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
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
                                                <div className="space-y-4">
                                                    {orders.map(o => {
                                                        const existingReminder = getReminderForOrder(o.id);
                                                        return (
                                                            <div key={o.id} className="p-5 border border-slate-200 rounded-2xl hover:border-slate-300 transition-all bg-white">
                                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                                    <div className="flex-1">
                                                                        <div className="flex items-center gap-3">
                                                                            <h3 className="font-bold text-base text-slate-800">{o.drug_name.charAt(0).toUpperCase() + o.drug_name.slice(1)}</h3>
                                                                            <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                                                                                o.status === 'delivered' ? 'bg-emerald-50 text-emerald-600' :
                                                                                o.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                                                                                o.status === 'cancelled' ? 'bg-red-50 text-red-500' :
                                                                                'bg-slate-100 text-slate-600'
                                                                            }`}>{o.status}</span>
                                                                        </div>
                                                                        <p className="text-xs text-slate-500 font-medium mt-1">
                                                                            <span className="font-mono">{o.order_number}</span>
                                                                            <span className="mx-2">•</span>
                                                                            Qty: {o.quantity}
                                                                            {o.total_price != null && <><span className="mx-2">•</span>₹{o.total_price}</>}
                                                                            <span className="mx-2">•</span>
                                                                            {new Date(o.ordered_at).toLocaleDateString()}
                                                                        </p>
                                                                    </div>

                                                                    {/* Reminder toggle */}
                                                                    <div className="shrink-0">
                                                                        {existingReminder ? (
                                                                            <button
                                                                                onClick={() => handleDisableReminder(existingReminder.id)}
                                                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
                                                                            >
                                                                                <Bell size={14} /> Reminder Active
                                                                            </button>
                                                                        ) : o.status !== 'cancelled' ? (
                                                                            <button
                                                                                onClick={() => openReminderModal(o.id, o.drug_name, o.quantity)}
                                                                                className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 border border-slate-200 rounded-xl text-xs font-bold hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-all"
                                                                            >
                                                                                <Plus size={14} /> Set Reminder
                                                                            </button>
                                                                        ) : null}
                                                                    </div>
                                                                </div>

                                                                {/* Show reminder details if active */}
                                                                {existingReminder && (
                                                                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 items-center">
                                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Reminders at:</span>
                                                                        {existingReminder.remind_times?.map((t, i) => (
                                                                            <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold rounded-md">{t}</span>
                                                                        ))}
                                                                        <span className="text-[10px] text-slate-400 ml-2">
                                                                            {existingReminder.dose} • {existingReminder.end_date?.slice(0,10) || 'Ongoing'}
                                                                            {existingReminder.qty_remaining != null && ` • ${existingReminder.qty_remaining} left`}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* --- TAB: PRESCRIPTIONS --- */}
                                    {activeTab === 'prescriptions' && (
                                        <div className="space-y-6">
                                            <div className="flex items-center justify-between">
                                                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                                    <FileImage size={20} className="text-emerald-500" /> Uploaded Prescriptions
                                                </h2>
                                                <Link
                                                    href="/upload-prescription"
                                                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors"
                                                >
                                                    + Upload New
                                                </Link>
                                            </div>

                                            {prescriptions.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                                    <FileImage className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                                    <p className="text-slate-500 font-medium text-sm">No prescriptions uploaded yet.</p>
                                                    <Link href="/upload-prescription" className="text-emerald-600 font-bold text-sm mt-2 inline-block hover:underline">
                                                        Upload your first prescription &rarr;
                                                    </Link>
                                                </div>
                                            ) : (
                                                <div className="space-y-4">
                                                    {prescriptions.map((rx) => {
                                                        const isExpanded = expandedRx === rx.id;
                                                        const detail = rxDetails[rx.id];
                                                        const isLoadingDetail = rxLoading === rx.id;
                                                        const statusColor =
                                                            rx.ocr_status === "completed" ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                                            rx.ocr_status === "failed" ? "bg-red-50 text-red-600 border-red-100" :
                                                            "bg-amber-50 text-amber-600 border-amber-100";

                                                        return (
                                                            <div key={rx.id} className="border border-slate-200 rounded-2xl overflow-hidden hover:border-emerald-200 transition-all">
                                                                {/* Summary Row */}
                                                                <button
                                                                    onClick={() => toggleRxExpand(rx.id)}
                                                                    className="w-full p-5 flex items-center gap-4 text-left hover:bg-slate-50/50 transition-colors"
                                                                >
                                                                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                                                        <FileText size={20} />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="font-bold text-sm text-slate-900 truncate">
                                                                            {rx.s3_key?.split("/").pop() || "Prescription"}
                                                                        </p>
                                                                        <p className="text-xs text-slate-400 font-medium mt-0.5">
                                                                            {new Date(rx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                                        </p>
                                                                    </div>
                                                                    <div className="flex items-center gap-3 shrink-0">
                                                                        {rx.ocr_status === "completed" && (
                                                                            <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
                                                                                <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md">{rx.drugs_found} drugs</span>
                                                                                <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md">{rx.observations_found} obs</span>
                                                                            </div>
                                                                        )}
                                                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${statusColor}`}>
                                                                            {rx.ocr_status}
                                                                        </span>
                                                                        <ChevronDown
                                                                            size={16}
                                                                            className={`text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                                                                        />
                                                                    </div>
                                                                </button>

                                                                {/* Expanded Details */}
                                                                <AnimatePresence>
                                                                    {isExpanded && (
                                                                        <motion.div
                                                                            initial={{ height: 0, opacity: 0 }}
                                                                            animate={{ height: "auto", opacity: 1 }}
                                                                            exit={{ height: 0, opacity: 0 }}
                                                                            transition={{ duration: 0.2 }}
                                                                            className="overflow-hidden"
                                                                        >
                                                                            <div className="px-5 pb-5 border-t border-slate-100">
                                                                                {isLoadingDetail ? (
                                                                                    <div className="py-8 flex items-center justify-center">
                                                                                        <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                                                                                        <span className="ml-2 text-sm text-slate-500 font-medium">Loading details...</span>
                                                                                    </div>
                                                                                ) : detail ? (
                                                                                    <div className="pt-5 space-y-5">
                                                                                        {/* Drugs */}
                                                                                        {detail.drugs && detail.drugs.length > 0 && (
                                                                                            <div>
                                                                                                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                                                                                                    <Pill size={12} className="text-blue-500" /> Extracted Medications ({detail.drugs.length})
                                                                                                </h4>
                                                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                                                    {detail.drugs.map((drug, di) => {
                                                                                                        const score = drug.match_score ? Math.round(drug.match_score * 100) : 0;
                                                                                                        return (
                                                                                                            <div key={di} className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                                                                                                                <div className="flex items-start justify-between gap-2">
                                                                                                                    <div className="min-w-0">
                                                                                                                        <p className="font-bold text-sm text-slate-900 truncate">
                                                                                                                            {drug.drug_name_matched || drug.drug_name_raw}
                                                                                                                        </p>
                                                                                                                        {drug.drug_name_matched && drug.drug_name_raw !== drug.drug_name_matched && (
                                                                                                                            <p className="text-[10px] text-slate-400 font-medium truncate">OCR: {drug.drug_name_raw}</p>
                                                                                                                        )}
                                                                                                                    </div>
                                                                                                                    {score > 0 && (
                                                                                                                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${score >= 80 ? "bg-emerald-50 text-emerald-600" : score >= 50 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-500"}`}>
                                                                                                                            {score}%
                                                                                                                        </span>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                                <div className="flex flex-wrap gap-1.5 mt-2 text-[10px] font-bold uppercase tracking-wider">
                                                                                                                    {drug.dosage && <span className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-600">{drug.dosage}</span>}
                                                                                                                    {(drug.frequency_raw || drug.frequency) && (
                                                                                                                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{drug.frequency_raw || drug.frequency}</span>
                                                                                                                    )}
                                                                                                                    {drug.duration && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">{drug.duration}</span>}
                                                                                                                    {drug.meal_relation && <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded">{drug.meal_relation}</span>}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Observations */}
                                                                                        {detail.observations && detail.observations.length > 0 && (
                                                                                            <div>
                                                                                                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                                                                                                    <Activity size={12} className="text-indigo-500" /> Clinical Observations ({detail.observations.length})
                                                                                                </h4>
                                                                                                <div className="space-y-2">
                                                                                                    {detail.observations.map((obs, oi) => (
                                                                                                        <div key={oi} className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-start gap-3">
                                                                                                            <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                                                                                                            <div>
                                                                                                                <p className="text-sm font-semibold text-slate-800">{obs.observation_text}</p>
                                                                                                                <div className="flex items-center gap-2 mt-1">
                                                                                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                                                                                                                        {obs.observation_type?.replace("_", " ")}
                                                                                                                    </span>
                                                                                                                    {obs.body_part && (
                                                                                                                        <span className="text-[10px] text-slate-400 font-medium">• {obs.body_part}</span>
                                                                                                                    )}
                                                                                                                    {obs.severity && (
                                                                                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${obs.severity === "severe" ? "bg-red-100 text-red-600" : obs.severity === "moderate" ? "bg-orange-100 text-orange-600" : "bg-green-100 text-green-600"}`}>
                                                                                                                            {obs.severity}
                                                                                                                        </span>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    ))}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Raw OCR */}
                                                                                        {detail.raw_extracted_text && (
                                                                                            <div>
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); setShowRawOcr(showRawOcr === rx.id ? null : rx.id); }}
                                                                                                    className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                                                                                                >
                                                                                                    <Eye size={12} />
                                                                                                    {showRawOcr === rx.id ? "Hide" : "Show"} Raw OCR Text
                                                                                                    <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full">
                                                                                                        {detail.raw_extracted_text.length.toLocaleString()} chars
                                                                                                    </span>
                                                                                                </button>
                                                                                                <AnimatePresence>
                                                                                                    {showRawOcr === rx.id && (
                                                                                                        <motion.div
                                                                                                            initial={{ height: 0, opacity: 0 }}
                                                                                                            animate={{ height: "auto", opacity: 1 }}
                                                                                                            exit={{ height: 0, opacity: 0 }}
                                                                                                            className="overflow-hidden"
                                                                                                        >
                                                                                                            <div className="mt-3 bg-slate-50 border border-slate-100 rounded-xl p-4 max-h-[300px] overflow-y-auto">
                                                                                                                <pre className="text-[11px] text-slate-600 font-mono whitespace-pre-wrap leading-relaxed">
                                                                                                                    {detail.raw_extracted_text}
                                                                                                                </pre>
                                                                                                            </div>
                                                                                                        </motion.div>
                                                                                                    )}
                                                                                                </AnimatePresence>
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Error message for failed */}
                                                                                        {detail.ocr_status === "failed" && detail.error_message && (
                                                                                            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
                                                                                                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                                                                                                <p className="text-sm text-red-600 font-medium">{detail.error_message}</p>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="py-6 text-center text-sm text-slate-400">No details available.</div>
                                                                                )}
                                                                            </div>
                                                                        </motion.div>
                                                                    )}
                                                                </AnimatePresence>
                                                            </div>
                                                        );
                                                    })}
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
            {/* ── REMINDER SETUP MODAL ── */}
            {reminderModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5 relative animate-in fade-in zoom-in-95">
                        {/* Close */}
                        <button onClick={() => setReminderModal(null)} className="absolute top-4 right-4 p-1.5 rounded-xl hover:bg-slate-100 transition-colors">
                            <X size={18} className="text-slate-400" />
                        </button>

                        <div>
                            <h3 className="text-lg font-extrabold text-slate-900">Set Daily Reminder</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                <span className="font-semibold text-slate-700">{reminderModal.drugName.charAt(0).toUpperCase() + reminderModal.drugName.slice(1)}</span>
                                {reminderModal.quantity != null && <span className="ml-1 text-xs text-slate-400">(Qty: {reminderModal.quantity})</span>}
                            </p>
                        </div>

                        {/* Dose */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Dose (e.g. 500mg, 1 tablet)</label>
                            <input
                                type="text"
                                value={reminderForm.dose}
                                onChange={e => setReminderForm(f => ({ ...f, dose: e.target.value }))}
                                placeholder="1 tablet"
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                            />
                        </div>

                        {/* Meal instruction */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Meal Instruction</label>
                            <select
                                value={reminderForm.meal}
                                onChange={e => setReminderForm(f => ({ ...f, meal: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                            >
                                <option value="">-- Select --</option>
                                <option value="before_meal">Before Meal</option>
                                <option value="after_meal">After Meal</option>
                                <option value="with_meal">With Meal</option>
                                <option value="empty_stomach">Empty Stomach</option>
                                <option value="before_sleep">Before Sleep</option>
                            </select>
                        </div>

                        {/* Frequency */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">How many times per day?</label>
                            <div className="flex gap-2">
                                {[1, 2, 3, 4].map(n => (
                                    <button
                                        key={n}
                                        type="button"
                                        onClick={() => handleFrequencyChange(n)}
                                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                                            reminderForm.frequency === n
                                                ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                                        }`}
                                    >
                                        {n}x
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Time slots */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Reminder Times</label>
                            <div className="grid grid-cols-2 gap-2">
                                {reminderForm.times.map((t, idx) => (
                                    <input
                                        key={idx}
                                        type="time"
                                        value={t}
                                        onChange={e => handleTimeChange(idx, e.target.value)}
                                        className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Duration */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Duration (days)</label>
                            <input
                                type="number"
                                min={1}
                                max={365}
                                value={reminderForm.days}
                                onChange={e => setReminderForm(f => ({ ...f, days: parseInt(e.target.value) || 1 }))}
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setReminderModal(null)}
                                className="flex-1 py-3 rounded-xl text-sm font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateReminder}
                                disabled={reminderSaving || reminderForm.times.some(t => !t) || !reminderForm.dose}
                                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-emerald-500 border border-emerald-500 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {reminderSaving ? 'Saving...' : 'Enable Reminder'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            </main>
        </div>
    );
}
