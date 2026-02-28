"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    Database,
    Search,
    ChevronRight,
    Users,
    Package,
    MessageSquare,
    FileText,
    Pill,
    Activity,
    Shield,
    BookOpen,
    AlertTriangle,
    ClipboardList,
    Heart,
    Brain,
} from "lucide-react";
import { adminService, type TableMeta } from "@/lib/adminApi";

/* ── Category Mapping ── */
const CATEGORIES: Record<string, { label: string; icon: any; color: string; slugs: string[] }> = {
    "users-access": {
        label: "Users & Access",
        icon: Users,
        color: "emerald",
        slugs: ["users", "families", "family-members", "user-consents", "user-behavioral-profiles"],
    },
    "drugs-reference": {
        label: "Drug Reference",
        icon: BookOpen,
        color: "blue",
        slugs: ["drug-classes", "dosage-safety-caps", "drug-contraindications", "duplicate-therapy-rules", "renal-dose-rules"],
    },
    "inventory-orders": {
        label: "Inventory & Orders",
        icon: Package,
        color: "teal",
        slugs: ["inventory", "orders"],
    },
    "medications-reminders": {
        label: "Medications & Reminders",
        icon: Pill,
        color: "violet",
        slugs: ["active-medications", "reminders", "reminder-logs", "medicine-courses"],
    },
    "health-data": {
        label: "Health Data",
        icon: Heart,
        color: "red",
        slugs: [
            "vitals", "vital-trends", "adherence-scores", "adverse-reactions",
            "health-events", "health-episodes", "medical-history", "symptom-followups",
        ],
    },
    "conversations": {
        label: "Conversations",
        icon: MessageSquare,
        color: "amber",
        slugs: ["conversations", "conversation-messages", "conversation-summaries"],
    },
    "clinical-ai": {
        label: "Clinical & AI Logs",
        icon: Brain,
        color: "indigo",
        slugs: [
            "extracted-medical-facts", "clinical-decision-log", "dfe-question-log",
            "web-search-log", "dfe-field-registry",
        ],
    },
    "admin-audit": {
        label: "Admin & Audit",
        icon: Shield,
        color: "slate",
        slugs: ["audit-log", "abuse-scores"],
    },
    "prescriptions": {
        label: "Prescriptions",
        icon: FileText,
        color: "cyan",
        slugs: ["prescription-uploads", "prescription-extracted-drugs", "prescription-observations"],
    },
};

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100", iconBg: "bg-emerald-100" },
    teal: { bg: "bg-teal-50", text: "text-teal-600", border: "border-teal-100", iconBg: "bg-teal-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-100", iconBg: "bg-blue-100" },
    violet: { bg: "bg-violet-50", text: "text-violet-600", border: "border-violet-100", iconBg: "bg-violet-100" },
    red: { bg: "bg-red-50", text: "text-red-600", border: "border-red-100", iconBg: "bg-red-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-100", iconBg: "bg-amber-100" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-100", iconBg: "bg-indigo-100" },
    slate: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-100", iconBg: "bg-slate-100" },
    cyan: { bg: "bg-cyan-50", text: "text-cyan-600", border: "border-cyan-100", iconBg: "bg-cyan-100" },
};

export default function TablesPage() {
    const [tables, setTables] = useState<TableMeta[]>([]);
    const [stats, setStats] = useState<Record<string, number>>({});
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [t, s] = await Promise.all([
                    adminService.getTables(),
                    adminService.getStats(),
                ]);
                setTables(t);
                setStats(s);
            } catch {
                // toast or handle
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const slugSet = new Set(tables.map((t) => t.slug));
    const filteredCategories = Object.entries(CATEGORIES)
        .map(([key, cat]) => ({
            ...cat,
            key,
            slugs: cat.slugs.filter(
                (s) => slugSet.has(s) && (search === "" || s.includes(search.toLowerCase()) || cat.label.toLowerCase().includes(search.toLowerCase()))
            ),
        }))
        .filter((cat) => cat.slugs.length > 0);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                    <h1
                        className="text-3xl lg:text-4xl tracking-tight text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Database{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
                            Tables
                        </span>
                    </h1>
                    <p
                        className="text-slate-400 mt-1 text-sm"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 400 }}
                    >
                        Browse and manage all {tables.length} tables
                    </p>
                </motion.div>

                {/* Search */}
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative"
                >
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search tables..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 w-full md:w-72 transition-all"
                        style={{ fontFamily: "var(--font-poppins)" }}
                    />
                </motion.div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="space-y-6">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="animate-pulse">
                            <div className="h-5 w-32 bg-slate-100 rounded mb-3" />
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {[...Array(3)].map((_, j) => (
                                    <div key={j} className="bg-white rounded-xl border border-slate-100 p-4 h-20" />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Categorized tables */}
            {!loading && filteredCategories.map((cat, catIdx) => {
                const c = COLOR_MAP[cat.color] || COLOR_MAP.slate;
                return (
                    <motion.div
                        key={cat.key}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: catIdx * 0.05, duration: 0.4 }}
                    >
                        <div className="flex items-center gap-2 mb-3">
                            <div className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center`}>
                                <cat.icon size={14} className={c.text} />
                            </div>
                            <h2
                                className="text-xs text-slate-500 uppercase tracking-[0.15em]"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                {cat.label}
                            </h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {cat.slugs.map((slug, idx) => {
                                const table = tables.find((t) => t.slug === slug);
                                return (
                                    <Link key={slug} href={`/admin/tables/${slug}`}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: catIdx * 0.05 + idx * 0.03 }}
                                            whileHover={{ y: -2 }}
                                            className="group bg-white rounded-xl border border-slate-200/80 px-4 py-3.5 hover:border-emerald-200 hover:shadow-md transition-all duration-200 flex items-center gap-3"
                                        >
                                            <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center flex-shrink-0`}>
                                                <Database size={14} className={c.text} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p
                                                    className="text-sm text-slate-800 truncate group-hover:text-emerald-700 transition-colors"
                                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                                >
                                                    {slug}
                                                </p>
                                                <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                                                    {table?.table} &middot; pk: {table?.pk}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="text-sm text-slate-500 min-w-[2.5rem] text-right"
                                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                >
                                                    {(stats[slug] ?? 0).toLocaleString()}
                                                </span>
                                                <ChevronRight size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                                            </div>
                                        </motion.div>
                                    </Link>
                                );
                            })}
                        </div>
                    </motion.div>
                );
            })}

            {!loading && filteredCategories.length === 0 && (
                <div className="text-center py-20">
                    <Database size={40} className="text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                        No tables match &ldquo;{search}&rdquo;
                    </p>
                </div>
            )}
        </div>
    );
}
