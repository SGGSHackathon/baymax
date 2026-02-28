"use client";

import { useEffect, useState, useCallback } from "react";
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
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Prescriptions</h1>
                <p className="text-sm text-slate-500 font-medium mt-1">
                    View and manage patient prescriptions.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by patient, drug, or doctor..."
                        className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter size={14} className="text-slate-400 shrink-0" />
                    {STATUS_FILTERS.map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors capitalize ${
                                statusFilter === s
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                    : "bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:border-slate-300"
                            }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Patient</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Drug</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Dosage</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Frequency</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Prescribed By</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Date</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Status</th>
                                <th className="text-right px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-16 text-slate-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <FileText size={28} />
                                            <span className="text-xs font-bold uppercase tracking-widest">No prescriptions found</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((rx) => (
                                    <tr key={rx.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                                        <td className="px-5 py-3.5">
                                            <div className="font-bold text-slate-900">{rx.patient_name}</div>
                                            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mt-0.5">
                                                <Phone size={10} /> {rx.patient_phone}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 font-bold text-slate-900">{rx.drug_name}</td>
                                        <td className="px-5 py-3.5 text-slate-600 font-medium">{rx.dosage}</td>
                                        <td className="px-5 py-3.5 text-slate-600 font-medium">{rx.frequency}</td>
                                        <td className="px-5 py-3.5">
                                            <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                                                <User size={12} className="text-slate-400" /> {rx.prescribed_by}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-slate-500 font-medium text-xs">
                                            {new Date(rx.prescribed_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${statusStyle(rx.status)}`}>
                                                {statusIcon(rx.status)} {rx.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center justify-end gap-2">
                                                {rx.status === "active" && (
                                                    <>
                                                        <button
                                                            onClick={() => handleStatusChange(rx.id, "completed")}
                                                            disabled={updating === rx.id}
                                                            className="h-7 px-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                                        >
                                                            {updating === rx.id ? <Loader2 className="animate-spin" size={12} /> : "Complete"}
                                                        </button>
                                                        <button
                                                            onClick={() => handleStatusChange(rx.id, "cancelled")}
                                                            disabled={updating === rx.id}
                                                            className="h-7 px-2.5 rounded-lg bg-red-50 border border-red-100 text-red-500 text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-colors disabled:opacity-50"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                                {rx.status !== "active" && (
                                                    <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">—</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-bold">{filtered.length} of {prescriptions.length} prescriptions</span>
                </div>
            </div>
        </div>
    );
}
