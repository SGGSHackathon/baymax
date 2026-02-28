"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { adminMockService, Medicine } from "@/lib/admin-mock";
import { useToast } from "@/hooks/useToast";
import {
    Plus,
    Pencil,
    Ban,
    CheckCircle,
    Search,
    X,
    Loader2,
    Pill,
    Filter,
} from "lucide-react";

const CATEGORIES = ["All", "Pain Relief", "Antibiotic", "Diabetes", "Allergy", "Fever", "Cosmetic"];

const EMPTY_FORM: Omit<Medicine, "id"> = {
    name: "",
    brand: "",
    category: "",
    price: 0,
    duration_days: 0,
    rx_required: false,
    status: "active",
};

/* ── animation helpers ── */
const fadeUp = {
    hidden: { opacity: 0, y: 16 },
    show: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] },
    }),
};

export default function MedicinesPage() {
    const { toast } = useToast();
    const [medicines, setMedicines] = useState<Medicine[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("All");
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<Medicine | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const fetchMedicines = useCallback(async () => {
        try {
            const data = await adminMockService.getMedicines();
            setMedicines(data);
        } catch {
            toast("Failed to load medicines", "error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMedicines();
    }, [fetchMedicines]);

    const filtered = medicines.filter((m) => {
        const matchesSearch =
            m.name.toLowerCase().includes(search.toLowerCase()) ||
            m.brand.toLowerCase().includes(search.toLowerCase());
        const matchesCat = categoryFilter === "All" || m.category === categoryFilter;
        return matchesSearch && matchesCat;
    });

    const openAdd = () => {
        setEditing(null);
        setForm(EMPTY_FORM);
        setShowForm(true);
    };

    const openEdit = (med: Medicine) => {
        setEditing(med);
        setForm({
            name: med.name,
            brand: med.brand,
            category: med.category,
            price: med.price,
            duration_days: med.duration_days,
            rx_required: med.rx_required,
            status: med.status,
        });
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditing(null);
        setForm(EMPTY_FORM);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.brand.trim() || !form.category.trim()) {
            toast("Please fill in all required fields", "error");
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await adminMockService.updateMedicine(editing.id, form);
                toast("Medicine updated successfully", "success");
            } else {
                await adminMockService.addMedicine(form);
                toast("Medicine added successfully", "success");
            }
            await fetchMedicines();
            closeForm();
        } catch {
            toast("Failed to save medicine", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleToggleStatus = async (med: Medicine) => {
        try {
            await adminMockService.toggleMedicineStatus(med.id);
            toast(
                `${med.name} ${med.status === "active" ? "disabled" : "enabled"}`,
                "success"
            );
            await fetchMedicines();
        } catch {
            toast("Failed to update status", "error");
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
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
                <div>
                    <h1
                        className="text-3xl tracking-tight text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Medicines
                    </h1>
                    <p
                        className="text-sm text-slate-500 mt-1.5"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    >
                        Manage the pharmacy medicine catalog.
                    </p>
                </div>
                <motion.button
                    whileHover={{ scale: 1.04, y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={openAdd}
                    className="flex items-center gap-2 h-11 px-6 bg-slate-900 text-white rounded-2xl text-sm shrink-0 hover:bg-emerald-800 transition-colors shadow-lg shadow-slate-900/10"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                >
                    <Plus size={16} /> Add Medicine
                </motion.button>
            </motion.div>

            {/* ── Filters Row ── */}
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
                        placeholder="Search by name or brand..."
                        className="w-full h-11 bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    />
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <Filter size={14} className="text-slate-400 shrink-0" />
                    {CATEGORIES.map((cat) => (
                        <motion.button
                            key={cat}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setCategoryFilter(cat)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap border transition-all ${
                                categoryFilter === cat
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm shadow-emerald-100/50"
                                    : "bg-white/60 text-slate-500 border-slate-200/60 hover:text-slate-900 hover:border-slate-300"
                            }`}
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: categoryFilter === cat ? 700 : 600 }}
                        >
                            {cat}
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* ── Data Table ── */}
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
                                {["Name", "Brand", "Category", "Price (₹)", "Rx Required", "Status", "Actions"].map((h, i) => (
                                    <th
                                        key={h}
                                        className={`${i === 6 ? "text-right" : "text-left"} px-5 py-4 text-[10px] uppercase tracking-[0.18em] text-slate-400`}
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
                                    <td colSpan={7} className="text-center py-16 text-slate-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                                                <Pill size={24} />
                                            </div>
                                            <span
                                                className="text-[10px] uppercase tracking-[0.2em]"
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                No medicines found
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((med, i) => (
                                    <motion.tr
                                        key={med.id}
                                        variants={fadeUp}
                                        custom={i}
                                        initial="hidden"
                                        animate="show"
                                        className="border-b border-slate-50 last:border-b-0 hover:bg-emerald-50/30 transition-colors"
                                    >
                                        <td className="px-5 py-4 text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>
                                            {med.name}
                                        </td>
                                        <td className="px-5 py-4 text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                            {med.brand}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span
                                                className="px-2.5 py-0.5 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-600"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                            >
                                                {med.category}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                            ₹{med.price}
                                        </td>
                                        <td className="px-5 py-4">
                                            {med.rx_required ? (
                                                <span
                                                    className="px-2.5 py-0.5 bg-amber-50 border border-amber-100 rounded-lg text-[10px] uppercase tracking-[0.15em] text-amber-600"
                                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                >
                                                    Yes
                                                </span>
                                            ) : (
                                                <span
                                                    className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-100 rounded-lg text-[10px] uppercase tracking-[0.15em] text-emerald-600"
                                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                >
                                                    No
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span
                                                className={`px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-[0.15em] border ${
                                                    med.status === "active"
                                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                                        : "bg-red-50 text-red-500 border-red-100"
                                                }`}
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                {med.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                <motion.button
                                                    whileHover={{ scale: 1.12 }}
                                                    whileTap={{ scale: 0.92 }}
                                                    onClick={() => openEdit(med)}
                                                    className="w-9 h-9 rounded-xl bg-white/80 border border-slate-200/60 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all shadow-sm"
                                                    title="Edit"
                                                >
                                                    <Pencil size={14} />
                                                </motion.button>
                                                <motion.button
                                                    whileHover={{ scale: 1.12 }}
                                                    whileTap={{ scale: 0.92 }}
                                                    onClick={() => handleToggleStatus(med)}
                                                    className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all shadow-sm ${
                                                        med.status === "active"
                                                            ? "bg-red-50/80 border-red-100 text-red-500 hover:bg-red-100"
                                                            : "bg-emerald-50/80 border-emerald-100 text-emerald-600 hover:bg-emerald-100"
                                                    }`}
                                                    title={med.status === "active" ? "Disable" : "Enable"}
                                                >
                                                    {med.status === "active" ? <Ban size={14} /> : <CheckCircle size={14} />}
                                                </motion.button>
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
                        {filtered.length} of {medicines.length} medicines
                    </span>
                </div>
            </motion.div>

            {/* ─── Add/Edit Modal ─── */}
            <AnimatePresence>
                {showForm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                            className="bg-white/95 backdrop-blur-xl rounded-[28px] border border-slate-200/60 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between p-6 border-b border-slate-100/80">
                                <h2
                                    className="text-lg text-slate-900"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    {editing ? "Edit Medicine" : "Add Medicine"}
                                </h2>
                                <motion.button
                                    whileHover={{ scale: 1.1, rotate: 90 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={closeForm}
                                    className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
                                >
                                    <X size={16} />
                                </motion.button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 space-y-5">
                                <div>
                                    <label
                                        className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5 block"
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        Medicine Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={form.name}
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                        placeholder="e.g. Paracetamol 650mg"
                                        className="w-full h-11 bg-white/70 border border-slate-200/60 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label
                                            className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5 block"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            Brand *
                                        </label>
                                        <input
                                            type="text"
                                            value={form.brand}
                                            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                                            placeholder="e.g. Crocin"
                                            className="w-full h-11 bg-white/70 border border-slate-200/60 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5 block"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            Category *
                                        </label>
                                        <select
                                            value={form.category}
                                            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                                            className="w-full h-11 bg-white/70 border border-slate-200/60 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 appearance-none"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                        >
                                            <option value="">Select...</option>
                                            {CATEGORIES.filter((c) => c !== "All").map((c) => (
                                                <option key={c} value={c}>
                                                    {c}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label
                                            className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5 block"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            Price (₹)
                                        </label>
                                        <input
                                            type="number"
                                            value={form.price || ""}
                                            onChange={(e) =>
                                                setForm((f) => ({
                                                    ...f,
                                                    price: parseFloat(e.target.value) || 0,
                                                }))
                                            }
                                            placeholder="0"
                                            className="w-full h-11 bg-white/70 border border-slate-200/60 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5 block"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            Duration (days)
                                        </label>
                                        <input
                                            type="number"
                                            value={form.duration_days || ""}
                                            onChange={(e) =>
                                                setForm((f) => ({
                                                    ...f,
                                                    duration_days: parseInt(e.target.value) || 0,
                                                }))
                                            }
                                            placeholder="0"
                                            className="w-full h-11 bg-white/70 border border-slate-200/60 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between bg-white/70 border border-slate-200/60 rounded-xl px-4 py-3.5">
                                    <span
                                        className="text-sm text-slate-700"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                    >
                                        Prescription Required
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setForm((f) => ({ ...f, rx_required: !f.rx_required }))}
                                        className={`w-11 h-6 rounded-full flex items-center transition-colors relative ${
                                            form.rx_required ? "bg-emerald-500" : "bg-slate-300"
                                        }`}
                                    >
                                        <span
                                            className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform absolute ${
                                                form.rx_required ? "translate-x-5.5" : "translate-x-0.5"
                                            }`}
                                        />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="p-6 border-t border-slate-100/80 flex items-center justify-end gap-3">
                                <motion.button
                                    whileHover={{ scale: 1.03 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={closeForm}
                                    className="h-11 px-5 rounded-xl border border-slate-200/60 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                >
                                    Cancel
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.04, y: -1 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="h-11 px-6 bg-slate-900 text-white rounded-xl text-sm hover:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-lg shadow-slate-900/10"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                >
                                    {saving && <Loader2 className="animate-spin" size={14} />}
                                    {editing ? "Update" : "Add Medicine"}
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
