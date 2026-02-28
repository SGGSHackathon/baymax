"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dataService } from "@/lib/api";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useToast } from "@/hooks/useToast";
import { Hospital, ShieldAlert, Package, AlertTriangle, ArrowLeft, Activity, FileText } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import Link from "next/link";

function AdminContent() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [abuseFlags, setAbuseFlags] = useState<any[]>([]);
    const [lowStock, setLowStock] = useState<any[]>([]);
    const [vitalTrends, setVitalTrends] = useState<any[]>([]);
    const [cdeLog, setCdeLog] = useState<any[]>([]);
    const [error, setError] = useState("");

    useEffect(() => {
        const fetchAdminData = async () => {
            try {
                const [abuseRes, stockRes, trendsRes, cdeRes] = await Promise.all([
                    dataService.getAdminAbuse(),
                    dataService.getLowStock(),
                    dataService.getVitalTrends().catch(() => []),
                    dataService.getCDELog().catch(() => []),
                ]);
                setAbuseFlags(Array.isArray(abuseRes) ? abuseRes : []);
                setLowStock(Array.isArray(stockRes) ? stockRes : []);
                setVitalTrends(Array.isArray(trendsRes) ? trendsRes : []);
                setCdeLog(Array.isArray(cdeRes) ? cdeRes : []);
            } catch (err: any) {
                const msg = err.apiError?.message || "Unable to retrieve admin data.";
                setError(msg);
                toast(msg, "error");
            } finally {
                setLoading(false);
            }
        };

        fetchAdminData();
    }, [router]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground p-8">
                <div className="max-w-6xl mx-auto space-y-6">
                    <SkeletonCard />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col font-sans relative">
            <div className="bg-noise" />

            {/* Top Navigation */}
            <nav className="h-16 border-b border-border/50 bg-black/40 backdrop-blur-xl flex items-center justify-between px-6 z-20 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-500 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                        <ShieldAlert size={16} />
                    </div>
                    <span className="font-bold tracking-tight text-lg">Baymax<span className="text-muted-foreground font-medium">.OS</span> <span className="uppercase text-xs tracking-widest text-red-400 ml-2 font-mono">Administrative Control</span></span>
                </div>

                <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-accent flex items-center gap-2 transition-colors">
                    <ArrowLeft size={16} /> Back to Patient View
                </Link>
            </nav>

            {/* Main Layout */}
            <main className="flex-1 p-6 lg:p-10 z-10 max-w-[1400px] w-full mx-auto">

                {error && (
                    <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-mon flex items-center gap-3">
                        <AlertTriangle size={16} /> {error}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Account Risk Board */}
                    <div className="glass-panel border-border/50 rounded-2xl flex flex-col h-[700px] overflow-hidden">
                        <div className="p-6 border-b border-border/50 bg-black/20 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldAlert size={18} className="text-yellow-500" /> Account Abuse Flags</h2>
                                <p className="text-xs text-muted-foreground mt-1">Users flagged by the CDE for controlled drug seeking behavior or rapid refills.</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#0a0a0a]">
                            {abuseFlags.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-3 opacity-50">
                                    <ShieldAlert size={32} />
                                    <span className="text-sm font-medium uppercase tracking-widest font-mono">No abuse flags active</span>
                                </div>
                            ) : (
                                abuseFlags.map((flag, i) => (
                                    <div key={i} className="bg-black/40 border border-white/5 p-5 rounded-xl flex flex-col gap-3">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="font-medium text-foreground">{flag.name}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{flag.phone}</div>
                                            </div>
                                            <div className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest border ${flag.blocked ? 'bg-red-500/20 text-red-500 border-red-500/30' : 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30'}`}>
                                                Score: {flag.score}/10
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {flag.flags?.map((f: string, j: number) => (
                                                <span key={j} className="text-[10px] uppercase font-mono bg-white/5 border border-white/10 px-2 py-1 flex items-center gap-1 rounded text-red-300">
                                                    <AlertTriangle size={10} /> {f.replace('_', ' ')}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Inventory Board */}
                    <div className="glass-panel border-border/50 rounded-2xl flex flex-col h-[700px] overflow-hidden">
                        <div className="p-6 border-b border-border/50 bg-black/20 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold flex items-center gap-2"><Package size={18} className="text-blue-500" /> Pharmacy Inventory Alerts</h2>
                                <p className="text-xs text-muted-foreground mt-1">Low-stock and expiring medication metrics.</p>
                            </div>

                            <button onClick={() => router.push('/admin/inventory')} className="shrink-0 h-9 px-4 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-semibold hover:bg-blue-500/20 transition-colors">
                                Master Database
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#0a0a0a]">
                            {lowStock.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-3 opacity-50">
                                    <Package size={32} />
                                    <span className="text-sm font-medium uppercase tracking-widest font-mono">Stock volumes nominal</span>
                                </div>
                            ) : (
                                lowStock.map((item, i) => (
                                    <div key={i} className="bg-black/40 border border-white/5 p-5 rounded-xl flex items-center justify-between">
                                        <div>
                                            <div className="font-medium text-foreground capitalize text-blue-400">{item.drug_name || item.name}</div>
                                            <div className="text-xs text-muted-foreground mt-1">Supply depleted below threshold</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xl font-bold font-mono text-red-400">{item.stock_left || 0} left</div>
                                            <button className="text-[10px] text-muted-foreground hover:text-foreground uppercase tracking-wider font-mono mt-1 underline decoration-border underline-offset-4">Dispatch Order</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>

                {/* Second Row — Vital Trends + CDE Log */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">

                    {/* Vital Trend Alerts */}
                    <div className="glass-panel border-border/50 rounded-2xl flex flex-col h-[500px] overflow-hidden">
                        <div className="p-6 border-b border-border/50 bg-black/20">
                            <h2 className="text-lg font-semibold flex items-center gap-2"><Activity size={18} className="text-green-500" /> Vital Trend Alerts</h2>
                            <p className="text-xs text-muted-foreground mt-1">Patients with sustained abnormal vital patterns.</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#0a0a0a]">
                            {vitalTrends.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-3 opacity-50">
                                    <Activity size={32} />
                                    <span className="text-sm font-medium uppercase tracking-widest font-mono">No trend alerts</span>
                                </div>
                            ) : (
                                vitalTrends.map((t: any, i: number) => (
                                    <div key={i} className="bg-black/40 border border-white/5 p-4 rounded-xl flex items-center justify-between">
                                        <div>
                                            <div className="font-medium text-foreground capitalize">{t.vital_type || t.vital}</div>
                                            <div className="text-xs text-muted-foreground mt-1">{t.message || `Trend detected for user ${t.user_id}`}</div>
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase border ${t.alert_sent ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'}`}>
                                            {t.alert_sent ? 'Sent' : 'Pending'}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* CDE Decision Log */}
                    <div className="glass-panel border-border/50 rounded-2xl flex flex-col h-[500px] overflow-hidden">
                        <div className="p-6 border-b border-border/50 bg-black/20">
                            <h2 className="text-lg font-semibold flex items-center gap-2"><FileText size={18} className="text-purple-500" /> Clinical Decision Engine Log</h2>
                            <p className="text-xs text-muted-foreground mt-1">Recent AI-powered clinical decisions and override history.</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-[#0a0a0a]">
                            {cdeLog.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-3 opacity-50">
                                    <FileText size={32} />
                                    <span className="text-sm font-medium uppercase tracking-widest font-mono">No decision records</span>
                                </div>
                            ) : (
                                cdeLog.map((entry: any, i: number) => (
                                    <div key={i} className="bg-black/40 border border-white/5 p-4 rounded-xl">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="font-medium text-sm text-foreground">{entry.decision_type || entry.action || 'Decision'}</div>
                                            <time className="text-[10px] font-mono text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</time>
                                        </div>
                                        <div className="text-xs text-muted-foreground leading-relaxed">
                                            {entry.reasoning || entry.details || JSON.stringify(entry).slice(0, 200)}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>

            </main>

        </div>
    );
}

export default function AdminDashboardPage() {
    return (
        <ProtectedRoute>
            <AdminContent />
        </ProtectedRoute>
    );
}
