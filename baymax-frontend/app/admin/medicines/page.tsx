"use client";

import { useEffect, useState, useCallback } from "react";
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

    // ── Filtered list ──
    const filtered = medicines.filter((m) => {
        const matchesSearch =
            m.name.toLowerCase().includes(search.toLowerCase()) ||
            m.brand.toLowerCase().includes(search.toLowerCase());
        const matchesCat = categoryFilter === "All" || m.category === categoryFilter;
        return matchesSearch && matchesCat;
    });

    // ── Form Handlers ──
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
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Medicines</h1>
                    <p className="text-sm text-slate-500 font-medium mt-1">
                        Manage the pharmacy medicine catalog.
                    </p>
                </div>
                <button
                    onClick={openAdd}
                    className="flex items-center gap-2 h-10 px-5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-emerald-800 transition-colors shrink-0"
                >
                    <Plus size={16} /> Add Medicine
                </button>
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or brand..."
                        className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                    />
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <Filter size={14} className="text-slate-400 shrink-0" />
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat}
                            onClick={() => setCategoryFilter(cat)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
                                categoryFilter === cat
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                    : "bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:border-slate-300"
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* Data Table */}
            <div className="bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Name
                                </th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Brand
                                </th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Category
                                </th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Price (₹)
                                </th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Rx Required
                                </th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Status
                                </th>
                                <th className="text-right px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-16 text-slate-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Pill size={28} />
                                            <span className="text-xs font-bold uppercase tracking-widest">
                                                No medicines found
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((med) => (
                                    <tr
                                        key={med.id}
                                        className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50 transition-colors"
                                    >
                                        <td className="px-5 py-3.5 font-bold text-slate-900">{med.name}</td>
                                        <td className="px-5 py-3.5 text-slate-600 font-medium">{med.brand}</td>
                                        <td className="px-5 py-3.5">
                                            <span className="px-2 py-0.5 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold text-slate-600">
                                                {med.category}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 font-bold text-slate-900">₹{med.price}</td>
                                        <td className="px-5 py-3.5">
                                            {med.rx_required ? (
                                                <span className="px-2 py-0.5 bg-amber-50 border border-amber-100 rounded-lg text-[10px] font-black uppercase tracking-widest text-amber-600">
                                                    Yes
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-100 rounded-lg text-[10px] font-black uppercase tracking-widest text-emerald-600">
                                                    No
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span
                                                className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                                                    med.status === "active"
                                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                                        : "bg-red-50 text-red-500 border-red-100"
                                                }`}
                                            >
                                                {med.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => openEdit(med)}
                                                    className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
                                                    title="Edit"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleToggleStatus(med)}
                                                    className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                                                        med.status === "active"
                                                            ? "bg-red-50 border-red-100 text-red-500 hover:bg-red-100"
                                                            : "bg-emerald-50 border-emerald-100 text-emerald-600 hover:bg-emerald-100"
                                                    }`}
                                                    title={med.status === "active" ? "Disable" : "Enable"}
                                                >
                                                    {med.status === "active" ? <Ban size={14} /> : <CheckCircle size={14} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Table Footer */}
                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-bold">
                        {filtered.length} of {medicines.length} medicines
                    </span>
                </div>
            </div>

            {/* ─── Add/Edit Modal ─── */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-[28px] border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-900">
                                {editing ? "Edit Medicine" : "Add Medicine"}
                            </h2>
                            <button
                                onClick={closeForm}
                                className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 space-y-5">
                            {/* Name */}
                            <div>
                                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1.5 block">
                                    Medicine Name *
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Paracetamol 650mg"
                                    className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                                />
                            </div>

                            {/* Brand + Category */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1.5 block">
                                        Brand *
                                    </label>
                                    <input
                                        type="text"
                                        value={form.brand}
                                        onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                                        placeholder="e.g. Crocin"
                                        className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1.5 block">
                                        Category *
                                    </label>
                                    <select
                                        value={form.category}
                                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                                        className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 appearance-none"
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

                            {/* Price + Duration */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1.5 block">
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
                                        className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1.5 block">
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
                                        className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                                    />
                                </div>
                            </div>

                            {/* Rx Required toggle */}
                            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                                <span className="text-sm font-bold text-slate-700">Prescription Required</span>
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
                        <div className="p-6 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button
                                onClick={closeForm}
                                className="h-10 px-5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="h-10 px-6 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center gap-2"
                            >
                                {saving && <Loader2 className="animate-spin" size={14} />}
                                {editing ? "Update" : "Add Medicine"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
