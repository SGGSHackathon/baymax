"use client";

import { useEffect, useState, useCallback, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    Search,
    Plus,
    Trash2,
    Edit3,
    ChevronLeft,
    ChevronRight,
    X,
    Check,
    Loader2,
    RefreshCw,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Eye,
    Copy,
    CheckCheck,
    AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import {
    adminService,
    type PaginatedRows,
    type ColumnSchema,
    type TableSchemaResponse,
} from "@/lib/adminApi";
import {
    AISummaryWidget,
    getRowRiskBadge,
    isLikelyLogsDataset,
    matchesSmartFilter,
    ProactiveInsights,
    RiskTrendChart,
    shouldShowAlert,
    SmartFilters,
    type SmartFilter,
} from "@/components/admin/ProactiveInsights";

/* ── Helpers ── */
function formatCellValue(val: any): string {
    if (val === null || val === undefined) return "—";
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "object") return JSON.stringify(val);
    const s = String(val);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

function isTimestamp(colName: string): boolean {
    return /(_at|_date|date$|timestamp|updated|created)/i.test(colName);
}

function formatDate(val: any): string {
    if (!val) return "—";
    try {
        const d = new Date(val);
        return d.toLocaleString("en-IN", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return String(val);
    }
}

/* ── Row Detail Modal ── */
function RowDetailModal({
    row,
    columns,
    onClose,
    onEdit,
    onDelete,
    slug,
    pk,
}: {
    row: Record<string, any>;
    columns: ColumnSchema[];
    onClose: () => void;
    onEdit: () => void;
    onDelete: () => void;
    slug: string;
    pk: string;
}) {
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const copyValue = (key: string, val: any) => {
        navigator.clipboard.writeText(String(val ?? ""));
        setCopiedField(key);
        setTimeout(() => setCopiedField(null), 1500);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h3
                            className="text-lg text-slate-900"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Row Detail
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5" style={{ fontFamily: "var(--font-poppins)" }}>
                            {slug} / {String(row[pk] ?? "").slice(0, 12)}…
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onEdit}
                            className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-xs border border-emerald-100 hover:bg-emerald-100 transition-all"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                        >
                            <Edit3 size={12} className="inline mr-1" /> Edit
                        </button>
                        <button
                            onClick={onDelete}
                            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs border border-red-100 hover:bg-red-100 transition-all"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                        >
                            <Trash2 size={12} className="inline mr-1" /> Delete
                        </button>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
                    {Object.entries(row).map(([key, val]) => (
                        <div
                            key={key}
                            className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0 group"
                        >
                            <span
                                className="text-xs text-slate-400 w-40 flex-shrink-0 pt-0.5 truncate"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                {key}
                            </span>
                            <span
                                className="text-sm text-slate-700 flex-1 break-all"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 400 }}
                            >
                                {isTimestamp(key) ? formatDate(val) : formatCellValue(val)}
                            </span>
                            <button
                                onClick={() => copyValue(key, val)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 transition-all flex-shrink-0"
                            >
                                {copiedField === key ? (
                                    <CheckCheck size={12} className="text-emerald-500" />
                                ) : (
                                    <Copy size={12} className="text-slate-300" />
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            </motion.div>
        </motion.div>
    );
}

/* ── Create / Edit Modal ── */
function FormModal({
    mode,
    columns,
    initialData,
    onClose,
    onSubmit,
    submitting,
    pk,
}: {
    mode: "create" | "edit";
    columns: ColumnSchema[];
    initialData: Record<string, any>;
    onClose: () => void;
    onSubmit: (data: Record<string, any>) => void;
    submitting: boolean;
    pk: string;
}) {
    const [formData, setFormData] = useState<Record<string, any>>(() => {
        const d: Record<string, any> = {};
        columns.forEach((c) => {
            d[c.column_name] = initialData[c.column_name] ?? "";
        });
        return d;
    });

    // Skip auto-generated columns in create mode
    const editableCols = columns.filter((c) => {
        if (c.is_generated && c.is_generated !== "NEVER") return false;
        if (mode === "create") {
            // Skip PK if it has a default (auto-gen)
            if (c.column_name === pk && c.column_default) return false;
            // Skip auto timestamps
            if (/^(created_at|updated_at)$/.test(c.column_name) && c.column_default) return false;
        }
        return true;
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload: Record<string, any> = {};
        editableCols.forEach((c) => {
            const val = formData[c.column_name];
            if (val !== "" && val !== undefined) {
                payload[c.column_name] = val;
            }
        });
        onSubmit(payload);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
            >
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-lg text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                        {mode === "create" ? "Create Row" : "Edit Row"}
                    </h3>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                        <X size={16} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                    {editableCols.map((col) => (
                        <div key={col.column_name}>
                            <label
                                className="text-xs text-slate-500 mb-1 block"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                {col.column_name}
                                <span className="text-slate-300 ml-1">({col.data_type})</span>
                                {col.is_nullable === "NO" && <span className="text-red-400 ml-1">*</span>}
                            </label>
                            {col.data_type === "boolean" ? (
                                <select
                                    value={String(formData[col.column_name] ?? "")}
                                    onChange={(e) =>
                                        setFormData((d) => ({
                                            ...d,
                                            [col.column_name]: e.target.value === "true" ? true : e.target.value === "false" ? false : "",
                                        }))
                                    }
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                                    style={{ fontFamily: "var(--font-poppins)" }}
                                >
                                    <option value="">—</option>
                                    <option value="true">True</option>
                                    <option value="false">False</option>
                                </select>
                            ) : col.data_type === "text" && !col.column_name.includes("id") ? (
                                <textarea
                                    value={String(formData[col.column_name] ?? "")}
                                    onChange={(e) => setFormData((d) => ({ ...d, [col.column_name]: e.target.value }))}
                                    rows={2}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 resize-none"
                                    style={{ fontFamily: "var(--font-poppins)" }}
                                />
                            ) : (
                                <input
                                    type={col.data_type.includes("int") || col.data_type === "numeric" || col.data_type === "real" || col.data_type === "double precision" ? "number" : "text"}
                                    step={col.data_type === "numeric" || col.data_type === "real" || col.data_type === "double precision" ? "any" : undefined}
                                    value={String(formData[col.column_name] ?? "")}
                                    onChange={(e) => setFormData((d) => ({ ...d, [col.column_name]: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                                    style={{ fontFamily: "var(--font-poppins)" }}
                                />
                            )}
                        </div>
                    ))}
                </form>

                <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 transition-all"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit as any}
                        disabled={submitting}
                        className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center gap-2"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        {submitting && <Loader2 size={14} className="animate-spin" />}
                        {mode === "create" ? "Create" : "Save Changes"}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

/* ── Delete Confirmation ── */
function DeleteConfirm({
    count,
    onConfirm,
    onCancel,
    loading,
}: {
    count: number;
    onConfirm: () => void;
    onCancel: () => void;
    loading: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={onCancel}
        >
            <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 max-w-sm w-full text-center"
            >
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle size={22} className="text-red-500" />
                </div>
                <h3
                    className="text-lg text-slate-900 mb-2"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    Delete {count} row{count > 1 ? "s" : ""}?
                </h3>
                <p className="text-sm text-slate-500 mb-6" style={{ fontFamily: "var(--font-poppins)" }}>
                    This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={onCancel}
                        className="px-5 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm hover:bg-slate-200"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className="px-5 py-2 rounded-xl bg-red-500 text-white text-sm hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        Delete
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

/* ────────────────────────────────────────────────────────────
   Main Table Detail Page
   ──────────────────────────────────────────────────────────── */

export default function TableDetailPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = use(params);
    const router = useRouter();
    const isClinicalLogsTable = ["clinical-decision-log", "dfe-question-log", "web-search-log"].includes(slug);

    const [schema, setSchema] = useState<TableSchemaResponse | null>(null);
    const [data, setData] = useState<PaginatedRows | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Pagination & search
    const [page, setPage] = useState(1);
    const perPage = isClinicalLogsTable ? 100 : 25;
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [sortCol, setSortCol] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [smartFilter, setSmartFilter] = useState<SmartFilter>("all");
    const [dismissedProactiveAlert, setDismissedProactiveAlert] = useState(false);

    // Selection
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Modals
    const [viewRow, setViewRow] = useState<Record<string, any> | null>(null);
    const [formModal, setFormModal] = useState<{ mode: "create" | "edit"; data: Record<string, any> } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Fetch schema once
    useEffect(() => {
        adminService.getTableSchema(slug).then(setSchema).catch(() => setError("Failed to load schema"));
    }, [slug]);

    // Fetch data
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await adminService.listRows(slug, {
                page,
                per_page: perPage,
                q: search || undefined,
                sort: sortCol || undefined,
                order: sortOrder,
            });
            setData(result);
        } catch (e: any) {
            setError(e?.apiError?.message || "Failed to load data");
        } finally {
            setLoading(false);
        }
    }, [slug, page, perPage, search, sortCol, sortOrder]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Search debounce
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput);
            setPage(1);
        }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    // PK
    const pk = schema?.columns?.find((c) => c.column_name === "id")
        ? "id"
        : schema?.columns?.[0]?.column_name || "id";

    // Visible columns (first 8 for table view)
    const visibleCols = schema?.columns?.slice(0, 8) || [];

    const rawRows = useMemo(() => data?.data || [], [data]);
    const isLogsDataset = useMemo(() => isLikelyLogsDataset(rawRows), [rawRows]);
    const filteredRows = useMemo(() => {
        if (!isLogsDataset || smartFilter === "all") return rawRows;
        return rawRows.filter((row) => matchesSmartFilter(row, smartFilter));
    }, [isLogsDataset, rawRows, smartFilter]);
    const showProactiveAlert = useMemo(() => {
        if (!isLogsDataset || dismissedProactiveAlert) return false;
        return shouldShowAlert(rawRows, 5);
    }, [isLogsDataset, rawRows, dismissedProactiveAlert]);

    const renderEnhancedCell = (row: Record<string, any>, colName: string) => {
        const rawValue = row[colName];
        const normalized = colName.toLowerCase();

        if (["riskscore", "risk_score", "risk", "risk_score_value"].includes(normalized)) {
            const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
            if (Number.isFinite(num)) {
                const badge = getRowRiskBadge(num);
                return (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold ${badge.className}`}>
                        {badge.label}
                    </span>
                );
            }
        }

        if (["escalationrequired", "escalation_required", "requiresescalation", "requires_escalation"].includes(normalized)) {
            const val = typeof rawValue === "boolean"
                ? rawValue
                : typeof rawValue === "string"
                    ? ["true", "1", "yes"].includes(rawValue.toLowerCase())
                    : rawValue === 1;

            if (val) {
                return (
                    <span className="inline-flex items-center gap-1.5 text-red-600 text-xs font-semibold">
                        <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                        </span>
                        Escalate
                    </span>
                );
            }
        }

        return isTimestamp(colName) ? formatDate(rawValue) : formatCellValue(rawValue);
    };

    // Sort handler
    const handleSort = (col: string) => {
        if (sortCol === col) {
            setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
        } else {
            setSortCol(col);
            setSortOrder("desc");
        }
        setPage(1);
    };

    // Toggle selection
    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (!data) return;
        const allIds = filteredRows.map((r) => String(r[pk]));
        const allSelected = allIds.every((id) => selected.has(id));
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(allIds));
        }
    };

    // CRUD handlers
    const handleCreate = async (body: Record<string, any>) => {
        setSubmitting(true);
        try {
            await adminService.createRow(slug, body);
            setFormModal(null);
            fetchData();
        } catch (e: any) {
            alert(e?.apiError?.message || "Create failed");
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (body: Record<string, any>) => {
        if (!formModal) return;
        setSubmitting(true);
        try {
            await adminService.updateRow(slug, String(formModal.data[pk]), body);
            setFormModal(null);
            fetchData();
        } catch (e: any) {
            alert(e?.apiError?.message || "Update failed");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirm) return;
        setSubmitting(true);
        try {
            if (deleteConfirm.length === 1) {
                await adminService.deleteRow(slug, deleteConfirm[0]);
            } else {
                await adminService.bulkDelete(slug, deleteConfirm);
            }
            setDeleteConfirm(null);
            setSelected(new Set());
            fetchData();
        } catch (e: any) {
            alert(e?.apiError?.message || "Delete failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Breadcrumb + Title */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => router.push("/admin/tables")}
                    className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
                >
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                        <Link href="/admin/tables" className="hover:text-emerald-600">Tables</Link>
                        <ChevronRight size={10} />
                        <span className="text-slate-600">{slug}</span>
                    </div>
                    <h1
                        className="text-2xl tracking-tight text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        {slug}
                    </h1>
                </div>
            </div>

            {/* Toolbar */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col md:flex-row items-stretch md:items-center gap-3"
            >
                {/* Search */}
                <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                        style={{ fontFamily: "var(--font-poppins)" }}
                    />
                </div>

                <div className="flex items-center gap-2">
                    {/* Bulk delete */}
                    {selected.size > 0 && (
                        <button
                            onClick={() => setDeleteConfirm(Array.from(selected))}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-500 border border-red-100 text-sm hover:bg-red-100 transition-all"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                        >
                            <Trash2 size={14} />
                            Delete {selected.size}
                        </button>
                    )}

                    {/* Refresh */}
                    <button
                        onClick={fetchData}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all"
                    >
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>

                    {/* Create */}
                    <button
                        onClick={() => setFormModal({ mode: "create", data: {} })}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-all"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        <Plus size={15} />
                        Add Row
                    </button>
                </div>
            </motion.div>

            {isLogsDataset && (
                <>
                    {showProactiveAlert && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-red-700">Proactive Alert</p>
                                <p className="text-xs text-red-600 mt-0.5">High-risk responses in last 24 hours crossed the threshold.</p>
                            </div>
                            <button
                                onClick={() => setDismissedProactiveAlert(true)}
                                className="p-1.5 rounded-lg hover:bg-red-100 text-red-500"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    <ProactiveInsights rows={rawRows} />

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className="xl:col-span-2">
                            <RiskTrendChart rows={rawRows} />
                        </div>
                        <AISummaryWidget rows={rawRows} />
                    </div>

                    <SmartFilters
                        active={smartFilter}
                        onChange={setSmartFilter}
                        rows={rawRows}
                    />
                </>
            )}

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                    {error}
                </div>
            )}

            {/* Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden"
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="w-10 px-3 py-3">
                                    <input
                                        type="checkbox"
                                        checked={filteredRows.length ? filteredRows.every((r) => selected.has(String(r[pk]))) : false}
                                        onChange={toggleSelectAll}
                                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                    />
                                </th>
                                {visibleCols.map((col) => (
                                    <th
                                        key={col.column_name}
                                        onClick={() => handleSort(col.column_name)}
                                        className="px-3 py-3 text-left cursor-pointer group hover:bg-slate-50 transition-colors"
                                    >
                                        <span
                                            className="flex items-center gap-1 text-xs text-slate-400 uppercase tracking-widest whitespace-nowrap"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                        >
                                            {col.column_name}
                                            {sortCol === col.column_name ? (
                                                sortOrder === "asc" ? (
                                                    <ArrowUp size={11} className="text-emerald-500" />
                                                ) : (
                                                    <ArrowDown size={11} className="text-emerald-500" />
                                                )
                                            ) : (
                                                <ArrowUpDown size={11} className="text-slate-200 group-hover:text-slate-400" />
                                            )}
                                        </span>
                                    </th>
                                ))}
                                <th className="w-16 px-3 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && !data && (
                                <tr>
                                    <td colSpan={visibleCols.length + 2} className="text-center py-20">
                                        <Loader2 size={24} className="animate-spin text-emerald-400 mx-auto" />
                                    </td>
                                </tr>
                            )}
                            {filteredRows.map((row, i) => {
                                const id = String(row[pk]);
                                const isSelected = selected.has(id);
                                return (
                                    <motion.tr
                                        key={id}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: i * 0.02 }}
                                        className={`border-b border-slate-50 hover:bg-emerald-50/30 transition-colors cursor-pointer ${
                                            isSelected ? "bg-emerald-50/50" : ""
                                        }`}
                                        onClick={() => setViewRow(row)}
                                    >
                                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelect(id)}
                                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                            />
                                        </td>
                                        {visibleCols.map((col) => (
                                            <td
                                                key={col.column_name}
                                                className="px-3 py-2.5 text-slate-600 whitespace-nowrap max-w-[200px] truncate"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 400, fontSize: "13px" }}
                                            >
                                                {isLogsDataset
                                                    ? renderEnhancedCell(row, col.column_name)
                                                    : isTimestamp(col.column_name)
                                                        ? formatDate(row[col.column_name])
                                                        : formatCellValue(row[col.column_name])}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => setViewRow(row)}
                                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-300 hover:text-slate-500 transition-all"
                                                >
                                                    <Eye size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setFormModal({ mode: "edit", data: row })}
                                                    className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-300 hover:text-emerald-500 transition-all"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setDeleteConfirm([id])}
                                                    className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-all"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </motion.tr>
                                );
                            })}
                            {data && filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan={visibleCols.length + 2} className="text-center py-16">
                                        <p className="text-slate-300 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                                            {isLogsDataset && smartFilter !== "all" ? "No rows found for selected filter" : "No rows found"}
                                        </p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {data && data.total_pages > 1 && (
                    <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                            Showing {(data.page - 1) * data.per_page + 1}–{Math.min(data.page * data.per_page, data.total)} of{" "}
                            {data.total.toLocaleString()} rows
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 disabled:opacity-30"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            {/* Page numbers */}
                            {Array.from({ length: Math.min(5, data.total_pages) }, (_, i) => {
                                const start = Math.max(1, Math.min(page - 2, data.total_pages - 4));
                                const p = start + i;
                                if (p > data.total_pages) return null;
                                return (
                                    <button
                                        key={p}
                                        onClick={() => setPage(p)}
                                        className={`w-8 h-8 rounded-lg text-xs transition-all ${
                                            p === page
                                                ? "bg-emerald-600 text-white"
                                                : "hover:bg-slate-100 text-slate-500"
                                        }`}
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                    >
                                        {p}
                                    </button>
                                );
                            })}
                            <button
                                onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                                disabled={page >= data.total_pages}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 disabled:opacity-30"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </motion.div>

            {/* Modals */}
            <AnimatePresence>
                {viewRow && schema && (
                    <RowDetailModal
                        row={viewRow}
                        columns={schema.columns}
                        pk={pk}
                        slug={slug}
                        onClose={() => setViewRow(null)}
                        onEdit={() => {
                            setFormModal({ mode: "edit", data: viewRow });
                            setViewRow(null);
                        }}
                        onDelete={() => {
                            setDeleteConfirm([String(viewRow[pk])]);
                            setViewRow(null);
                        }}
                    />
                )}

                {formModal && schema && (
                    <FormModal
                        mode={formModal.mode}
                        columns={schema.columns}
                        initialData={formModal.data}
                        pk={pk}
                        onClose={() => setFormModal(null)}
                        onSubmit={formModal.mode === "create" ? handleCreate : handleUpdate}
                        submitting={submitting}
                    />
                )}

                {deleteConfirm && (
                    <DeleteConfirm
                        count={deleteConfirm.length}
                        onConfirm={handleDelete}
                        onCancel={() => setDeleteConfirm(null)}
                        loading={submitting}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
