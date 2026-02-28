"use client";

import { useState, useEffect } from "react";
import { dataService, authService } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { X, Loader2 } from "lucide-react";

interface EditProfileModalProps {
    profile: any;
    languages: any[];
    onClose: () => void;
    onSaved: () => void;
}

export default function EditProfileModal({ profile, languages, onClose, onSaved }: EditProfileModalProps) {
    const { toast } = useToast();
    const [form, setForm] = useState({
        name: profile.name || "",
        email: profile.email || "",
        age: profile.age?.toString() || "",
        gender: profile.gender || "",
        city: profile.city || "",
        pincode: profile.pincode || "",
        preferred_language: profile.preferred_language || "en",
    });
    const [saving, setSaving] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await authService.updateProfile({ ...form, age: form.age ? parseInt(form.age) : undefined });
            onSaved();
        } catch (err: any) {
            toast(err.apiError?.message || "Failed to save.", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-[28px] border border-slate-200 shadow-2xl w-full max-w-md p-8 relative">
                <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                    <X size={16} />
                </button>

                <h2 className="text-xl font-bold tracking-tight text-slate-900 mb-1">Edit Profile</h2>
                <p className="text-sm text-slate-400 mb-6 font-medium">Update your clinical records.</p>

                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Name</label>
                        <input name="name" value={form.name} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Email</label>
                        <input name="email" value={form.email} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Age</label>
                            <input name="age" type="number" value={form.age} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Gender</label>
                            <select name="gender" value={form.gender} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 appearance-none transition-all">
                                <option value="">Select</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">City</label>
                            <input name="city" value={form.city} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Pincode</label>
                            <input name="pincode" value={form.pincode} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Language</label>
                        <select name="preferred_language" value={form.preferred_language} onChange={handleChange} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-medium text-slate-900 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 appearance-none transition-all">
                            {languages.map((l: any) => (
                                <option key={l.code} value={l.code}>{l.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <button onClick={handleSave} disabled={saving} className="w-full h-12 mt-6 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-emerald-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 active:scale-[0.98]">
                    {saving ? <Loader2 className="animate-spin" size={14} /> : "Save Changes"}
                </button>
            </div>
        </div>
    );
}
