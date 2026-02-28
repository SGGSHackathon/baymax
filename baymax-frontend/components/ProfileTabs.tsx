"use client";

import { useEffect, useState } from "react";
import { dataService } from "@/lib/api";
import { SkeletonText } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Clock, Pill, Activity, Calendar } from "lucide-react";

const TABS = [
    { key: "vitals", label: "Vitals History", icon: Activity },
    { key: "meds", label: "Medications", icon: Pill },
    { key: "timeline", label: "Timeline", icon: Calendar },
];

export default function ProfileTabs({ phone }: { phone: string }) {
    const [tab, setTab] = useState("vitals");
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!phone) return;
        setLoading(true);
        setData(null);

        const fetchData = async () => {
            try {
                if (tab === "vitals") {
                    const res = await dataService.getVitals(phone);
                    setData(res);
                } else if (tab === "meds") {
                    const res = await dataService.getProfile(phone);
                    setData(res?.current_meds || []);
                } else if (tab === "timeline") {
                    const res = await dataService.getTimeline(phone);
                    setData(res);
                }
            } catch { setData(null); } finally { setLoading(false); }
        };
        fetchData();
    }, [tab, phone]);

    return (
        <div className="bg-white rounded-[28px] border border-slate-200 shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex flex-col h-full overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-slate-100 bg-slate-50/50 px-2 pt-2">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex-1 h-10 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 rounded-t-xl transition-all ${tab === t.key
                                ? "bg-white text-slate-900 border border-slate-200 border-b-white -mb-px shadow-sm"
                                : "text-slate-400 hover:text-slate-600"
                            }`}
                    >
                        <t.icon size={12} className={tab === t.key ? "text-emerald-500" : ""} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                    <div className="space-y-4 py-2">
                        <SkeletonText lines={3} />
                        <SkeletonText lines={2} />
                    </div>
                ) : !data || (Array.isArray(data) && data.length === 0) ? (
                    <EmptyState title={`No ${tab} data`} description="Records will appear here once logged." />
                ) : tab === "vitals" ? (
                    <div className="space-y-3">
                        {(Array.isArray(data) ? data : [data]).slice(0, 10).map((v: any, i: number) => (
                            <div key={i} className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-wrap items-center gap-4 text-xs">
                                {v.heart_rate && <span className="flex items-center gap-1 text-slate-600 font-bold"><Activity size={10} className="text-emerald-500" /> {v.heart_rate} bpm</span>}
                                {v.bp_systolic && <span className="flex items-center gap-1 text-slate-600 font-bold">BP {v.bp_systolic}/{v.bp_diastolic}</span>}
                                {v.spo2_pct && <span className="flex items-center gap-1 text-slate-600 font-bold">SpO2 {v.spo2_pct}%</span>}
                                {v.blood_sugar && <span className="flex items-center gap-1 text-slate-600 font-bold">Sugar {v.blood_sugar}</span>}
                                {v.temp_celsius && <span className="flex items-center gap-1 text-slate-600 font-bold">{v.temp_celsius}°C</span>}
                                <span className="ml-auto text-slate-400 flex items-center gap-1 font-bold"><Clock size={10} /> {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}</span>
                            </div>
                        ))}
                    </div>
                ) : tab === "meds" ? (
                    <ul className="space-y-3">
                        {data.map((med: string, i: number) => (
                            <li key={i} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl p-4">
                                <span className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-400">{i + 1}</span>
                                <span className="capitalize text-sm font-bold text-slate-700">{med}</span>
                                <span className="ml-auto text-[10px] uppercase tracking-widest text-slate-400 font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md">Active</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="space-y-3">
                        {(Array.isArray(data) ? data : []).slice(0, 10).map((event: any, i: number) => (
                            <div key={i} className="flex gap-4 items-start py-3 border-b border-slate-100 last:border-0">
                                <div className="w-3 h-3 rounded-full bg-emerald-500 border-4 border-emerald-50 mt-1 shrink-0" />
                                <div>
                                    <p className="text-sm font-bold text-slate-800">{event.event_type || "Event"}</p>
                                    <p className="text-xs text-slate-400 mt-0.5 font-bold flex items-center gap-1"><Clock size={10} /> {event.created_at ? new Date(event.created_at).toLocaleDateString() : "—"}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
