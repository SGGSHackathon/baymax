"use client";

import { useState } from "react";
import { dataService } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { Activity, Droplet, Heart, Thermometer, Weight, Wind, Loader2 } from "lucide-react";

export default function VitalsLogger({ phone, onLogged }: { phone: string, onLogged: () => void }) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [vitals, setVitals] = useState({ bp_systolic: "", bp_diastolic: "", blood_sugar: "", spo2_pct: "", temp_celsius: "", heart_rate: "", weight_kg: "" });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setVitals({ ...vitals, [e.target.name]: e.target.value });
    };

    const handleLog = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const payload: any = { phone };
        Object.entries(vitals).forEach(([key, val]) => { if (val) payload[key] = Number(val); });

        try {
            const res = await dataService.logVitals(payload);
            if (res.alerts && res.alerts.length > 0) {
                toast(`Vitals recorded. Alert: ${res.alerts.join(", ")}`, "error");
            } else {
                toast("Vitals recorded securely", "success");
            }
            setVitals({ bp_systolic: "", bp_diastolic: "", blood_sugar: "", spo2_pct: "", temp_celsius: "", heart_rate: "", weight_kg: "" });
            onLogged();
        } catch (err: any) {
            toast(err.apiError?.message || "Failed to log vitals.", "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-[28px] border border-slate-200 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
            <h4 className="text-xs uppercase tracking-widest text-slate-400 font-bold flex items-center gap-2 mb-6">
                <Activity size={14} className="text-emerald-500" /> Log Vitals
            </h4>

            <form onSubmit={handleLog} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex gap-1 items-center"><Heart size={10} className="text-red-400" /> BP Sys/Dia</label>
                        <div className="flex gap-2">
                            <input type="number" name="bp_systolic" placeholder="120" value={vitals.bp_systolic} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                            <input type="number" name="bp_diastolic" placeholder="80" value={vitals.bp_diastolic} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex gap-1 items-center"><Droplet size={10} className="text-blue-400" /> Sugar (mg/dL)</label>
                        <input type="number" step="0.1" name="blood_sugar" placeholder="95.5" value={vitals.blood_sugar} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex gap-1 items-center"><Wind size={10} className="text-cyan-400" /> SpO2 (%)</label>
                        <input type="number" step="0.1" name="spo2_pct" placeholder="98" value={vitals.spo2_pct} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex gap-1 items-center"><Activity size={10} className="text-emerald-500" /> Heart Rate</label>
                        <input type="number" name="heart_rate" placeholder="72" value={vitals.heart_rate} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex gap-1 items-center"><Thermometer size={10} className="text-orange-400" /> Temp (°C)</label>
                        <input type="number" step="0.1" name="temp_celsius" placeholder="36.5" value={vitals.temp_celsius} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex gap-1 items-center"><Weight size={10} className="text-purple-400" /> Weight (kg)</label>
                        <input type="number" step="0.1" name="weight_kg" placeholder="70" value={vitals.weight_kg} onChange={handleChange} className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 font-medium text-slate-900 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
                    </div>
                </div>

                <button type="submit" disabled={loading} className="w-full h-10 mt-2 flex items-center justify-center bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors active:scale-[0.98]">
                    {loading ? <Loader2 className="animate-spin" size={12} /> : "Record Vitals"}
                </button>
            </form>
        </div>
    );
}
