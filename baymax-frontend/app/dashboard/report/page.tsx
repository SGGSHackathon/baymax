"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authService, dataService } from "@/lib/api";
import { Loader2, ArrowLeft, Printer, FileText, HeartPulse, ShieldAlert, Activity } from "lucide-react";
import Link from "next/link";

export default function ClinicalReportPage() {
    const router = useRouter();
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!authService.isAuthenticated()) {
            router.push("/login");
            return;
        }

        const fetchReport = async () => {
            try {
                // Get current user phone
                const userData = await authService.getMe();
                const phone = userData.phone;

                // Fetch clinical report
                const reportData = await dataService.getClinicalReport(phone);
                setReport(reportData);
            } catch (err: any) {
                console.warn("Failed to load clinical report.");
                setError("Unable to generate clinical report. Please try again later.");
            } finally {
                setLoading(false);
            }
        };

        fetchReport();
    }, [router]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] text-slate-900">
                <Loader2 className="animate-spin text-emerald-600" size={32} />
            </div>
        );
    }

    if (error || !report) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafbfc] text-slate-900 gap-4">
                <ShieldAlert size={48} className="text-red-400 opacity-50" />
                <h2 className="text-xl font-bold tracking-tight">Report Generation Failed</h2>
                <p className="text-slate-500 text-sm max-w-md text-center font-medium">{error}</p>
                <Link href="/dashboard" className="px-4 py-2 mt-4 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors text-sm font-bold text-slate-700">
                    Return to Dashboard
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#fafbfc] text-slate-900 relative p-4 md:p-8 font-sans selection:bg-emerald-100 selection:text-emerald-900">
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
            </div>

            <div className="max-w-4xl mx-auto relative z-10 flex flex-col gap-8">

                {/* Header Actions */}
                <div className="flex items-center justify-between no-print mb-4">
                    <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors text-sm font-bold">
                        <ArrowLeft size={16} /> Dashboard
                    </Link>

                    <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-emerald-800 transition-colors text-sm font-bold tracking-wide active:scale-[0.98]">
                        <Printer size={16} /> Print Report
                    </button>
                </div>

                {/* The Report Document */}
                <div className="bg-white p-8 md:p-12 rounded-[32px] border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] printable-document">

                    {/* Document Header */}
                    <div className="flex justify-between items-start border-b border-slate-100 pb-8 mb-8">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <FileText className="text-emerald-600" size={24} />
                                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Clinical Summary</h1>
                            </div>
                            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest font-bold">
                                Generated: {new Date(report.generated_at || Date.now()).toLocaleString()}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-xl font-bold tracking-tight text-slate-900">Baymax<span className="text-emerald-600 font-medium tracking-normal">.OS</span></div>
                            <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-1 font-bold">Diagnostic Intelligence</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

                        {/* Left Column - Patient Meta */}
                        <div className="md:col-span-1 space-y-8">

                            <section>
                                <h3 className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold mb-3 flex items-center gap-2"><HeartPulse size={12} className="text-emerald-500" /> Patient Profile</h3>
                                <div className="space-y-3">
                                    <div>
                                        <div className="text-lg font-bold text-slate-900">{report.patient?.name}</div>
                                        <div className="text-sm text-slate-500 capitalize font-medium">{report.patient?.age} yrs • {report.patient?.gender}</div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs space-y-3 mt-4">
                                        <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">Risk Tier</span> <span className={`font-black px-2 py-0.5 rounded-md ${report.patient?.risk_tier >= 3 ? "bg-red-50 text-red-600" : report.patient?.risk_tier >= 2 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>Tier {report.patient?.risk_tier || 1}</span></div>
                                        <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">Adherence</span> <span className="font-mono font-bold text-slate-700">{report.patient?.overall_adherence || 0}%</span></div>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold mb-3">Allergies</h3>
                                {report.patient?.allergies?.length > 0 ? (
                                    <ul className="list-disc list-inside text-sm text-red-500 space-y-1 font-medium">
                                        {report.patient.allergies.map((al: string, i: number) => <li key={i} className="capitalize">{al}</li>)}
                                    </ul>
                                ) : <span className="text-sm text-slate-400 font-medium">No known allergies.</span>}
                            </section>

                            <section>
                                <h3 className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold mb-3">Chronic Conditions</h3>
                                {report.patient?.chronic_conditions?.length > 0 ? (
                                    <ul className="list-disc list-inside text-sm text-slate-700 space-y-1 font-medium">
                                        {report.patient.chronic_conditions.map((cc: string, i: number) => <li key={i} className="capitalize">{cc}</li>)}
                                    </ul>
                                ) : <span className="text-sm text-slate-400 font-medium">None reported.</span>}
                            </section>

                        </div>

                        {/* Right Column - Clinical Data */}
                        <div className="md:col-span-2 space-y-10">

                            <section>
                                <h3 className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold mb-4 border-b border-slate-100 pb-2">Active Medications</h3>
                                {report.active_medications?.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {report.active_medications.map((m: any, i: number) => (
                                            <div key={i} className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                                                <div className="font-bold text-sm capitalize text-slate-900 mb-1">{m.drug_name}</div>
                                                <div className="text-xs text-slate-500 font-medium">{m.dose} • {m.meal_instruction}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : <span className="text-sm text-slate-400 font-medium">No active prescriptions.</span>}
                            </section>

                            <section>
                                <h3 className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold mb-4 border-b border-slate-100 pb-2 flex items-center gap-2"><Activity size={12} className="text-emerald-500" /> Recent Health Episodes</h3>
                                {report.health_episodes?.length > 0 ? (
                                    <div className="space-y-4">
                                        {report.health_episodes.map((epi: any, i: number) => (
                                            <div key={i} className="relative pl-5 border-l-2 border-slate-100">
                                                <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-emerald-500"></div>
                                                <div className="flex justify-between items-start mb-1">
                                                    <div className="font-bold text-sm text-slate-800">{epi.primary_symptom}</div>
                                                    <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded">{epi.severity} Risk</span>
                                                </div>
                                                <div className="text-xs text-slate-500 mb-2 font-medium">Diagnosed: {new Date(epi.start_date).toLocaleDateString()}</div>
                                                {epi.related_symptoms?.length > 0 && <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg inline-block border border-slate-100 font-medium">Related: {epi.related_symptoms.join(', ')}</div>}
                                            </div>
                                        ))}
                                    </div>
                                ) : <span className="text-sm text-slate-400 font-medium">No recent episodes recorded in the last 30 days.</span>}
                            </section>

                            <section>
                                <h3 className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold mb-4 border-b border-slate-100 pb-2">Recent Vitals Log</h3>
                                {report.recent_vitals?.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm whitespace-nowrap">
                                            <thead className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold bg-slate-50">
                                                <tr>
                                                    <th className="px-3 py-2 rounded-l-lg font-normal">Date</th>
                                                    <th className="px-3 py-2 font-normal">BP</th>
                                                    <th className="px-3 py-2 font-normal">Sugar</th>
                                                    <th className="px-3 py-2 font-normal">SpO2</th>
                                                    <th className="px-3 py-2 rounded-r-lg font-normal">HR</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {report.recent_vitals.map((v: any, i: number) => (
                                                    <tr key={i} className="text-xs font-medium text-slate-700 hover:bg-slate-50/50 transition-colors">
                                                        <td className="px-3 py-3 text-slate-500">{new Date(v.timestamp).toLocaleDateString()}</td>
                                                        <td className="px-3 py-3">{v.bp_systolic && v.bp_diastolic ? <span className="font-bold text-slate-900">{v.bp_systolic}/{v.bp_diastolic}</span> : '-'}</td>
                                                        <td className="px-3 py-3">{v.blood_sugar ? <span className="font-bold text-slate-900">{v.blood_sugar}</span> : '-'}</td>
                                                        <td className="px-3 py-3">{v.spo2_pct ? <span className="font-bold text-slate-900">{v.spo2_pct}%</span> : '-'}</td>
                                                        <td className="px-3 py-3">{v.heart_rate ? <span className="font-bold text-slate-900">{v.heart_rate}</span> : '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : <span className="text-sm text-slate-400 font-medium">No vitals recorded recently.</span>}
                            </section>

                        </div>
                    </div>

                    <div className="mt-12 pt-8 border-t border-slate-100 text-[10px] text-slate-400 text-center max-w-2xl mx-auto leading-relaxed uppercase tracking-wider font-mono font-bold">
                        {report.disclaimer || "This report was auto-generated by the Baymax.OS Clinical Intelligence System. This summary is intended to assist medical professionals and does not constitute a definitive medical diagnosis. All algorithmic triaging should be independently verified."}
                    </div>

                </div>
            </div>
        </div>
    );
}
