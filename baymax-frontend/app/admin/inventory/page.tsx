"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { dataService } from "@/lib/api";
import { Loader2, Package, Search, AlertTriangle, CheckCircle, ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";

export default function InventoryDashboardPage() {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [recallActive, setRecallActive] = useState<{ [key: string]: any }>({});
    const [recallLoading, setRecallLoading] = useState<{ [key: string]: boolean }>({});
    const [expiring, setExpiring] = useState<any[]>([]);
    const [expiringLoading, setExpiringLoading] = useState(true);

    useEffect(() => {
        dataService.getExpiringMeds()
            .then(res => setExpiring(Array.isArray(res) ? res : []))
            .catch(() => setExpiring([]))
            .finally(() => setExpiringLoading(false));
    }, []);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim().length < 2) return;

        setLoading(true);
        try {
            const res = await dataService.searchInventory(query);
            setResults(Array.isArray(res) ? res : []);
        } catch (err) {
            console.warn("Search failed");
        } finally {
            setLoading(false);
        }
    };

    const checkRecall = async (drugName: string) => {
        setRecallLoading(prev => ({ ...prev, [drugName]: true }));
        try {
            const res = await dataService.checkRecall(drugName);
            setRecallActive(prev => ({ ...prev, [drugName]: res }));
        } catch (err) {
            console.warn("Recall check failed");
        } finally {
            setRecallLoading(prev => ({ ...prev, [drugName]: false }));
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col font-sans relative">
            <div className="bg-noise" />

            {/* Top Navigation */}
            <nav className="h-16 border-b border-border/50 bg-black/40 backdrop-blur-xl flex items-center justify-between px-6 z-20 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-500 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                        <Package size={16} />
                    </div>
                    <span className="font-bold tracking-tight text-lg">Baymax<span className="text-muted-foreground font-medium">.OS</span> <span className="uppercase text-xs tracking-widest text-blue-400 ml-2 font-mono">Inventory Control</span></span>
                </div>

                <Link href="/admin" className="text-sm font-medium text-muted-foreground hover:text-accent flex items-center gap-2 transition-colors">
                    <ArrowLeft size={16} /> Back to Admin
                </Link>
            </nav>

            <main className="flex-1 p-6 lg:p-10 z-10 max-w-[1000px] w-full mx-auto flex flex-col gap-8">

                <div className="glass-panel p-8 rounded-3xl border border-border/50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 blur-[100px] rounded-full pointer-events-none" />

                    <h1 className="text-2xl font-bold tracking-tight mb-2">Pharmacological Database</h1>
                    <p className="text-muted-foreground text-sm mb-8">Search the master inventory list and perform real-time FDA recall verification.</p>

                    <form onSubmit={handleSearch} className="relative flex items-center max-w-xl">
                        <Search size={18} className="absolute left-4 text-muted-foreground" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search medicines (e.g. Paracetamol)..."
                            className="w-full h-14 bg-black/40 border border-border/50 rounded-xl pl-12 pr-24 text-sm focus:outline-none focus:border-blue-500/50 transition-all font-medium placeholder:text-muted-foreground/50"
                        />
                        <button
                            type="submit"
                            disabled={loading || query.length < 2}
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-4 flex items-center justify-center bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors text-xs font-semibold tracking-wide"
                        >
                            {loading ? <Loader2 className="animate-spin" size={14} /> : "Search DB"}
                        </button>
                    </form>
                </div>

                {results.length > 0 && (
                    <div className="space-y-4">
                        <h3 className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground ml-2">Search Results ({results.length})</h3>
                        <div className="grid grid-cols-1 gap-4">
                            {results.map((item, i) => {
                                const drugName = item.drug_name || item.name;
                                const recallData = recallActive[drugName];
                                const isValidating = recallLoading[drugName];

                                return (
                                    <div key={i} className="glass-panel p-5 rounded-2xl border border-border/50 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center hover:bg-white/5 transition-colors">
                                        <div>
                                            <div className="font-semibold text-lg capitalize">{drugName}</div>
                                            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
                                                <span className="font-mono bg-black/30 px-2 py-0.5 rounded border border-white/5">Stock: {item.stock_left || 'N/A'}</span>
                                                <span className="capitalize">{item.category || 'General'}</span>
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex items-center gap-3 w-full sm:w-auto mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-border/50 sm:pl-4 sm:border-l">
                                            {!recallData && !isValidating ? (
                                                <button
                                                    onClick={() => checkRecall(drugName)}
                                                    className="w-full sm:w-auto h-9 px-4 rounded-lg bg-black/40 border border-border/50 text-xs font-medium hover:text-accent hover:border-accent/40 transition-colors"
                                                >
                                                    Check FDA Recall
                                                </button>
                                            ) : isValidating ? (
                                                <div className="h-9 px-4 flex items-center gap-2 text-xs text-muted-foreground">
                                                    <Loader2 className="animate-spin" size={14} /> Checking Server...
                                                </div>
                                            ) : recallData.recall_detected ? (
                                                <div className="flex flex-col items-end gap-1 text-right">
                                                    <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-400/10 px-3 py-1.5 rounded-lg border border-red-400/20 font-medium">
                                                        <AlertTriangle size={14} /> Recall Active
                                                    </span>
                                                    <a href="#" className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-border underline-offset-2">View Source</a>
                                                </div>
                                            ) : (
                                                <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-400/10 px-3 py-1.5 rounded-lg border border-green-400/20 font-medium w-full sm:w-auto justify-center">
                                                    <CheckCircle size={14} /> Cleared
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Expiring Medications Panel */}
                <div className="glass-panel rounded-2xl border border-border/50 overflow-hidden">
                    <div className="p-6 border-b border-border/50 bg-black/20">
                        <h2 className="text-lg font-semibold flex items-center gap-2"><Clock size={18} className="text-orange-500" /> Expiring Medications</h2>
                        <p className="text-xs text-muted-foreground mt-1">Medications nearing their expiration date.</p>
                    </div>
                    <div className="p-6 bg-[#0a0a0a]">
                        {expiringLoading ? (
                            <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>
                        ) : expiring.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground opacity-50 space-y-2">
                                <Clock size={28} />
                                <span className="text-sm font-mono uppercase tracking-widest">No expiring medications</span>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {expiring.map((med: any, i: number) => (
                                    <div key={i} className="bg-black/40 border border-white/5 p-4 rounded-xl flex items-center justify-between">
                                        <div>
                                            <div className="font-medium text-foreground capitalize text-orange-400">{med.drug_name || med.name}</div>
                                            <div className="text-xs text-muted-foreground mt-1">Expires: {new Date(med.expiry_date || med.expires_at).toLocaleDateString()}</div>
                                        </div>
                                        <span className="text-xs font-mono bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded border border-orange-500/20">
                                            {med.stock_qty || med.stock_left || 0} units
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

            </main>

        </div>
    );
}
