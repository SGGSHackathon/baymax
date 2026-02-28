"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { adminMockService, Prescription } from "@/lib/admin-mock";
import { useToast } from "@/hooks/useToast";
import {
    FileText,
    Loader2,
    Search,
    Filter,
    CheckCircle,
    XCircle,
    Clock,
    User,
    Phone,
} from "lucide-react";

const STATUS_FILTERS = ["All", "active", "completed", "cancelled"] as const;

/* ── animation helpers ── */
const fadeUp = {
    hidden: { opacity: 0, y: 16 },
    show: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] },
    }),
};

export default function PrescriptionsPage() {
    const { toast } = useToast();
    const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("All");
    const [updating, setUpdating] = useState<string | null>(null);

    const fetchPrescriptions = useCallback(async () => {
        try {
            const data = await adminMockService.getPrescriptions();
            setPrescriptions(data);
        } catch {
            toast("Failed to load prescriptions", "error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPrescriptions();
    }, [fetchPrescriptions]);

    const handleStatusChange = async (id: string, status: Prescription["status"]) => {
        setUpdating(id);
        try {
            await adminMockService.updatePrescriptionStatus(id, status);
            toast(`Prescription ${status}`, "success");
            await fetchPrescriptions();
        } catch {
            toast("Failed to update prescription", "error");
        } finally {
            setUpdating(null);
        }
    };

    const filtered = prescriptions.filter((p) => {
        const matchSearch =
            p.patient_name.toLowerCase().includes(search.toLowerCase()) ||
            p.drug_name.toLowerCase().includes(search.toLowerCase()) ||
            p.prescribed_by.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "All" || p.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const statusStyle = (s: string) => {
        switch (s) {
            case "active":
                return "bg-emerald-50 text-emerald-600 border-emerald-100";
            case "completed":
                return "bg-blue-50 text-blue-600 border-blue-100";
            case "cancelled":
                return "bg-red-50 text-red-500 border-red-100";
            default:
                return "bg-slate-50 text-slate-500 border-slate-200";
        }
    };

    const statusIcon = (s: string) => {
        switch (s) {
            case "active":
                return <Clock size={12} />;
            case "completed":
                return <CheckCircle size={12} />;
            case "cancelled":
                return <XCircle size={12} />;
            default:
                return null;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-emerald-600" size={28} />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-[1200px]">
            {/* ── Header ── */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <h1
                    className="text-3xl tracking-tight text-slate-900"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    Prescriptions
                </h1>
                <p
                    className="text-sm text-slate-500 mt-1.5"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                >
                    View and manage patient prescriptions.
                </p>
            </motion.div>

            {/* ── Filters ── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="flex flex-col sm:flex-row gap-3"
            >
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by patient, drug, or doctor..."
                        className="w-full h-11 bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter size={14} className="text-slate-400 shrink-0" />
                    {STATUS_FILTERS.map((s) => (
                        <motion.button
                            key={s}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap border transition-all capitalize ${
                                statusFilter === s
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm shadow-emerald-100/50"
                                    : "bg-white/60 text-slate-500 border-slate-200/60 hover:text-slate-900 hover:border-slate-300"
                            }`}
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: statusFilter === s ? 700 : 600 }}
                        >
                            {s}
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* ── Table ── */}
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100/80">
                                {["Patient", "Drug", "Dosage", "Frequency", "Prescribed By", "Date", "Status", "Actions"].map((h, i) => (
                                    <th
                                        key={h}
                                        className={`${i === 7 ? "text-right" : "text-left"} px-5 py-4 text-[10px] uppercase tracking-[0.18em] text-slate-400`}
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-16 text-slate-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                                                <FileText size={24} />
                                            </div>
                                            <span
                                                className="text-[10px] uppercase tracking-[0.2em]"
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                No prescriptions found
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((rx, i) => (
                                    <motion.tr
                                        key={rx.id}
                                        variants={fadeUp}
                                        custom={i}
                                        initial="hidden"
                                        animate="show"
                                        className="border-b border-slate-50 last:border-b-0 hover:bg-emerald-50/30 transition-colors"
                                    >
                                        <td className="px-5 py-4">
                                            <div className="text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{rx.patient_name}</div>
                                            <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                                <Phone size={10} /> {rx.patient_phone}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{rx.drug_name}</td>
                                        <td className="px-5 py-4 text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{rx.dosage}</td>
                                        <td className="px-5 py-4 text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{rx.frequency}</td>
                                        <td className="px-5 py-4">
                                            <span className="flex items-center gap-1.5 text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                                <User size={12} className="text-slate-400" /> {rx.prescribed_by}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-slate-500 text-xs" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                            {new Date(rx.prescribed_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span
                                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-[0.15em] border ${statusStyle(rx.status)}`}
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                {statusIcon(rx.status)} {rx.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                {rx.status === "active" && (
                                                    <>
                                                        <motion.button
                                                            whileHover={{ scale: 1.08 }}
                                                            whileTap={{ scale: 0.92 }}
                                                            onClick={() => handleStatusChange(rx.id, "completed")}
                                                            disabled={updating === rx.id}
                                                            className="h-8 px-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] uppercase tracking-[0.15em] hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                        >
                                                            {updating === rx.id ? <Loader2 className="animate-spin" size={12} /> : "Complete"}
                                                        </motion.button>
                                                        <motion.button
                                                            whileHover={{ scale: 1.08 }}
                                                            whileTap={{ scale: 0.92 }}
                                                            onClick={() => handleStatusChange(rx.id, "cancelled")}
                                                            disabled={updating === rx.id}
                                                            className="h-8 px-3 rounded-xl bg-red-50 border border-red-100 text-red-500 text-[10px] uppercase tracking-[0.15em] hover:bg-red-100 transition-colors disabled:opacity-50"
                                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                        >
                                                            Cancel
                                                        </motion.button>
                                                    </>
                                                )}
                                                {rx.status !== "active" && (
                                                    <span
                                                        className="text-[10px] text-slate-300 uppercase tracking-[0.15em]"
                                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                    >
                                                        —
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </motion.tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-5 py-3.5 border-t border-slate-100/80 flex items-center justify-between">
                    <span
                        className="text-xs text-slate-400"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        {filtered.length} of {prescriptions.length} prescriptions
                    </span>
                </div>
            </motion.div>
        </div>
    );
}
