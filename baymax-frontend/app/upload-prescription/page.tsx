"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { dataService, authService } from "@/lib/api";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    UploadCloud, FileText, CheckCircle, AlertCircle, Loader2, ArrowLeft,
    Clock, Activity, Pill, ChevronRight, X, ChevronDown, Eye, ShoppingCart,
    Package, Building2, User, Calendar, AlertTriangle, ArrowRightLeft,
    PackageCheck, PackageX, PackageMinus, Stethoscope, Edit3, Save,
    CreditCard, Plus, Minus, Trash2
} from "lucide-react";
import Link from "next/link";
import Script from "next/script";

type UploadState = "idle" | "uploading" | "processing" | "completed" | "error";

// ── OCR helpers ──────────────────────────────────────────────

function extractPrescriptionImage(rawText: string): string | null {
    if (!rawText) return null;
    const idx = rawText.indexOf("![");
    if (idx === -1) return null;
    const parenOpen = rawText.indexOf("(", idx);
    if (parenOpen === -1) return null;
    const dataStart = rawText.indexOf("data:image/", parenOpen);
    if (dataStart === -1 || dataStart - parenOpen > 10) return null;
    const parenClose = rawText.indexOf(")", dataStart);
    if (parenClose === -1) return null;
    return rawText.slice(dataStart, parenClose);
}

// Stock status helpers
const STOCK_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
    in_stock: { label: "In Stock", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", icon: PackageCheck },
    low_stock: { label: "Low Stock", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", icon: PackageMinus },
    out_of_stock: { label: "Out of Stock", color: "text-red-700", bg: "bg-red-50", border: "border-red-200", icon: PackageX },
    not_found: { label: "Not in Inventory", color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", icon: Package },
};

// Form type badges
const FORM_COLORS: Record<string, string> = {
    tablet: "bg-blue-50 text-blue-700",
    capsule: "bg-orange-50 text-orange-700",
    syrup: "bg-purple-50 text-purple-700",
    injection: "bg-red-50 text-red-700",
    ointment: "bg-teal-50 text-teal-700",
    cream: "bg-pink-50 text-pink-700",
    drops: "bg-cyan-50 text-cyan-700",
    gel: "bg-indigo-50 text-indigo-700",
    suspension: "bg-violet-50 text-violet-700",
    inhaler: "bg-sky-50 text-sky-700",
    powder: "bg-lime-50 text-lime-700",
    sachet: "bg-rose-50 text-rose-700",
};

export default function UploadPrescriptionPage() {
    return (
        <ProtectedRoute>
            <UploadContent />
        </ProtectedRoute>
    );
}

function UploadContent() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const [status, setStatus] = useState<UploadState>("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const [progress, setProgress] = useState(0);

    // Results
    const [prescriptionId, setPrescriptionId] = useState("");
    const [extractedData, setExtractedData] = useState<any>(null);
    const [processingStage, setProcessingStage] = useState("");
    const [showRawOcr, setShowRawOcr] = useState(false);

    // Order modal — now supports multi-item checkout
    const [orderModal, setOrderModal] = useState<{ medicine: string; qty: number; unitPrice: number; inventoryId?: string; drugIndex: number } | null>(null);
    const [checkoutItems, setCheckoutItems] = useState<Array<{ drug_name: string; quantity: number; unit_price: number; inventory_id?: string | null }>>([]);
    const [showCheckout, setShowCheckout] = useState(false);
    const [orderResult, setOrderResult] = useState<{ loading: boolean; reply: string | null; error: string | null }>({ loading: false, reply: null, error: null });
    const [razorpayLoaded, setRazorpayLoaded] = useState(false);

    // Duration edit
    const [editingDuration, setEditingDuration] = useState<number | null>(null);
    const [durationInput, setDurationInput] = useState("");
    const [durationSaving, setDurationSaving] = useState(false);

    const [prescriptionImage, setPrescriptionImage] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const STORAGE_KEY = "baymax_processing_rx";
    const SESSION_TTL_MS = 10 * 60 * 1000;

    useEffect(() => {
        // Prefer the presigned S3 URL from the backend; fall back to base64 from OCR text
        if (extractedData?.image_url) {
            setPrescriptionImage(extractedData.image_url);
        } else if (extractedData?.raw_extracted_text) {
            setPrescriptionImage(extractPrescriptionImage(extractedData.raw_extracted_text));
        } else {
            setPrescriptionImage(null);
        }
    }, [extractedData]);

    useEffect(() => {
        authService.getMe().then((u) => {
            setUser(u);
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) {
                try {
                    const saved = JSON.parse(raw);
                    const elapsed = Date.now() - (saved.ts || 0);
                    if (saved.id && elapsed < SESSION_TTL_MS) {
                        setPrescriptionId(saved.id);
                        setStatus("processing");
                        setProgress(65);
                        setProcessingStage("Resuming -- checking status...");
                        pollStatus(saved.id);
                    } else {
                        sessionStorage.removeItem(STORAGE_KEY);
                    }
                } catch {
                    sessionStorage.removeItem(STORAGE_KEY);
                }
            }
        }).catch(() => {});
        return () => { if (pollRef.current) clearTimeout(pollRef.current); };
    }, []);

    const handleFile = (selectedFile: File) => {
        if (!selectedFile) return;
        const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "application/zip", "application/x-zip-compressed"];
        if (!validTypes.includes(selectedFile.type)) {
            setErrorMsg("Unsupported file type. Please upload a PDF, PNG, JPG, or ZIP.");
            return;
        }
        if (selectedFile.size > 10 * 1024 * 1024) {
            setErrorMsg("File is too large. Maximum size is 10MB.");
            return;
        }
        setFile(selectedFile);
        setErrorMsg("");
        setStatus("idle");
        setExtractedData(null);
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    };

    const processUpload = async () => {
        if (!file || !user) return;
        setStatus("uploading");
        setProgress(10);
        setErrorMsg("");
        try {
            setProgress(20);
            const uploadParams = await dataService.getPrescriptionUploadUrl({
                user_id: user.id, file_name: file.name, content_type: file.type,
            });
            setProgress(40);
            await dataService.uploadToS3(uploadParams.upload_url, file);
            setProgress(60);
            setStatus("processing");
            const processRes = await dataService.processPrescription({
                prescription_id: uploadParams.prescription_id, s3_key: uploadParams.s3_key,
            });
            setPrescriptionId(processRes.prescription_id);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: processRes.prescription_id, ts: Date.now() }));
            pollStatus(processRes.prescription_id);
        } catch (err: any) {
            console.error(err);
            setStatus("error");
            setErrorMsg(err.response?.data?.detail || err.message || "Failed to process prescription.");
        }
    };

    const stageProgress: Record<string, { pct: number; label: string }> = {
        pending: { pct: 55, label: "Queued for processing..." },
        downloading: { pct: 60, label: "Downloading file from storage..." },
        processing: { pct: 65, label: "Processing document..." },
        ocr_running: { pct: 70, label: "Running Sarvam Vision OCR -- this may take a minute..." },
        extracting: { pct: 85, label: "Extracting drugs & observations with AI..." },
        matching: { pct: 92, label: "Matching drugs & checking stock availability..." },
    };

    const pollStatus = (id: string) => {
        if (pollRef.current) clearTimeout(pollRef.current);
        let attempts = 0;
        const maxAttempts = 60;
        const getDelay = (stage: string, n: number): number => {
            if (stage === "ocr_running") return 8000;
            if (stage === "extracting" || stage === "matching") return 3000;
            if (n < 3) return 3000;
            return 5000;
        };
        let lastStage = "";
        const tick = async () => {
            attempts++;
            if (attempts > maxAttempts) {
                sessionStorage.removeItem(STORAGE_KEY);
                setStatus("error");
                setErrorMsg("Processing timed out. Please try again later.");
                return;
            }
            try {
                const res = await dataService.getPrescriptionStatus(id);
                const stage = stageProgress[res.ocr_status];
                if (stage) {
                    setProgress(stage.pct);
                    setProcessingStage(stage.label);
                    lastStage = res.ocr_status;
                } else {
                    setProgress(Math.min(60 + (attempts * 2), 95));
                }
                if (res.ocr_status === "completed") {
                    pollRef.current = null;
                    sessionStorage.removeItem(STORAGE_KEY);
                    setProgress(100);
                    setExtractedData(res);
                    setStatus("completed");
                    return;
                } else if (res.ocr_status === "failed") {
                    pollRef.current = null;
                    sessionStorage.removeItem(STORAGE_KEY);
                    setStatus("error");
                    setErrorMsg(res.error_message || "OCR Processing failed on the server.");
                    return;
                }
            } catch (err: any) {
                const errStatus = err?.response?.status || err?.status;
                if (errStatus === 404) {
                    pollRef.current = null;
                    sessionStorage.removeItem(STORAGE_KEY);
                    setStatus("error");
                    setErrorMsg("Prescription not found. Please upload again.");
                    return;
                }
                console.warn("Polling error...", err);
            }
            pollRef.current = setTimeout(tick, getDelay(lastStage, attempts));
        };
        pollRef.current = setTimeout(tick, 2000);
    };

    const addToCheckout = (drug: any, qty: number = 10) => {
        const drugName = drug.drug_name_matched || drug.drug_name_raw;
        const unitPrice = drug.price_per_unit || drug.unit_price || 15;
        const invId = drug.matched_inventory_id || null;

        setCheckoutItems(prev => {
            const existing = prev.findIndex(i => i.drug_name === drugName);
            if (existing >= 0) {
                const updated = [...prev];
                updated[existing].quantity = qty;
                return updated;
            }
            return [...prev, { drug_name: drugName, quantity: qty, unit_price: unitPrice, inventory_id: invId }];
        });
        setShowCheckout(true);
        setOrderModal(null);
    };

    const removeFromCheckout = (index: number) => {
        setCheckoutItems(prev => prev.filter((_, i) => i !== index));
    };

    const updateCheckoutQty = (index: number, delta: number) => {
        setCheckoutItems(prev => {
            const updated = [...prev];
            updated[index].quantity = Math.max(1, Math.min(200, updated[index].quantity + delta));
            return updated;
        });
    };

    const checkoutTotal = checkoutItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

    const placeOrder = async () => {
        if (!user || checkoutItems.length === 0) return;
        setOrderResult({ loading: true, reply: null, error: null });

        try {
            // 1. Create order on backend (returns Razorpay order ID)
            const orderRes = await dataService.createOrder({
                user_id: user.id,
                items: checkoutItems,
                prescription_id: prescriptionId || null,
            });

            // 2. Open Razorpay checkout
            if (!window.Razorpay) {
                throw new Error("Razorpay SDK not loaded. Please refresh the page.");
            }

            const rzp = new window.Razorpay({
                key: orderRes.key_id || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
                amount: Math.round(orderRes.amount * 100),
                currency: orderRes.currency || "INR",
                name: "BayMax Pharmacy",
                description: `${checkoutItems.length} medicine(s) — Prescription Order`,
                order_id: orderRes.razorpay_order_id,
                prefill: {
                    name: orderRes.user_name || user.name,
                    email: orderRes.user_email || user.email,
                    contact: orderRes.user_phone || user.phone,
                },
                theme: { color: "#059669" },
                handler: async (response) => {
                    // 3. Verify payment
                    try {
                        const verifyRes = await dataService.verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        });
                        setOrderResult({ loading: false, reply: `Order ${verifyRes.order_number} confirmed! Payment ID: ${verifyRes.payment_id}`, error: null });

                        // 4. Redirect to payment success page
                        setTimeout(() => {
                            window.location.href = `/payment-success?razorpay_order_id=${response.razorpay_order_id}&payment_id=${response.razorpay_payment_id}`;
                        }, 1500);
                    } catch (err: any) {
                        setOrderResult({ loading: false, reply: null, error: "Payment received but verification failed. Contact support." });
                    }
                },
                modal: {
                    ondismiss: () => {
                        setOrderResult({ loading: false, reply: null, error: null });
                    },
                },
            });
            rzp.open();
        } catch (err: any) {
            setOrderResult({
                loading: false,
                reply: null,
                error: err?.apiError?.message || err?.response?.data?.detail || err?.message || "Order failed. Please try again.",
            });
        }
    };

    const saveDuration = async (drugIndex: number) => {
        const days = parseInt(durationInput);
        if (!days || days < 1 || days > 365 || !prescriptionId) return;
        setDurationSaving(true);
        try {
            const res = await dataService.updateDrugDuration(prescriptionId, drugIndex, days);
            if (res.success && extractedData) {
                const updated = { ...extractedData };
                const drugs = [...(updated.drugs || [])];
                if (drugs[drugIndex]) {
                    drugs[drugIndex] = {
                        ...drugs[drugIndex],
                        duration_days: days,
                        duration: `${days} days`,
                        course_start_date: res.course_start_date,
                        course_end_date: res.course_end_date,
                    };
                }
                updated.drugs = drugs;
                setExtractedData(updated);
            }
            setEditingDuration(null);
            setDurationInput("");
        } catch (err: any) {
            console.error("Duration update failed:", err);
        }
        setDurationSaving(false);
    };

    const reset = () => {
        if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
        sessionStorage.removeItem(STORAGE_KEY);
        setFile(null);
        setStatus("idle");
        setProgress(0);
        setErrorMsg("");
        setExtractedData(null);
        setProcessingStage("");
        setShowRawOcr(false);
        setPrescriptionImage(null);
        setOrderModal(null);
        setCheckoutItems([]);
        setShowCheckout(false);
        setOrderResult({ loading: false, reply: null, error: null });
        setEditingDuration(null);
        setDurationInput("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // Name match score from backend
    const nameMatchScore = extractedData?.name_match_score ?? 0;
    const nameMatchWarning = extractedData?.name_match_warning;

    return (
        <div className="min-h-screen bg-[#fafbfc] text-slate-900 font-sans relative flex flex-col p-4 md:p-8">
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
            </div>

            <div className="max-w-4xl mx-auto w-full relative z-10 flex flex-col">
                <div className="mb-8 flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors text-sm font-bold">
                        <ArrowLeft size={16} /> Back to Dashboard
                    </Link>
                </div>

                <div className="bg-white p-8 md:p-12 rounded-4xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <UploadCloud size={24} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Upload Prescription</h1>
                            <p className="text-slate-500 font-medium">Auto-digitize, check stock & clinical safety.</p>
                        </div>
                    </div>

                    <div className="mt-10">
                        {status === "idle" || status === "error" ? (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
                                <div
                                    className={`w-full border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center transition-all cursor-pointer ${dragActive ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-400 hover:bg-slate-50"}`}
                                    onDragEnter={() => setDragActive(true)}
                                    onDragLeave={() => setDragActive(false)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input ref={fileInputRef} type="file" className="hidden" accept=".pdf, .png, .jpg, .jpeg, .zip" onChange={handleChange} />
                                    <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center text-emerald-600 mb-6">
                                        <FileText size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-800 mb-2">Drag & Drop your file here</h3>
                                    <p className="text-slate-400 text-sm mb-6 text-center max-w-sm">Supports PDF, PNG, JPG, JPEG, or ZIP up to 10MB</p>
                                    <button className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-emerald-800 transition-colors shadow-sm">Browse Files</button>
                                </div>

                                {errorMsg && (
                                    <div className="w-full mt-4 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl flex items-start gap-3">
                                        <AlertCircle size={20} className="shrink-0 mt-0.5" />
                                        <p className="text-sm font-medium">{errorMsg}</p>
                                    </div>
                                )}

                                {file && (
                                    <div className="w-full mt-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><FileText size={20} /></div>
                                            <div className="overflow-hidden">
                                                <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
                                                <p className="text-xs text-slate-500 font-medium">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={(e) => { e.stopPropagation(); reset(); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><X size={18} /></button>
                                            <button onClick={(e) => { e.stopPropagation(); processUpload(); }} className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-emerald-800 transition-colors shadow-sm">Upload & Extract</button>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : status === "uploading" || status === "processing" ? (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full py-16 flex flex-col items-center justify-center text-center">
                                <div className="relative w-24 h-24 mb-8">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                        <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                                        <motion.circle cx="50" cy="50" r="45" fill="none" stroke="#059669" strokeWidth="8" strokeLinecap="round"
                                            initial={{ strokeDasharray: "0 283" }}
                                            animate={{ strokeDasharray: `${(progress / 100) * 283} 283` }}
                                            transition={{ duration: 0.5 }} />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        {status === "uploading" ? <UploadCloud size={24} className="text-emerald-600 animate-bounce" /> : <Loader2 size={24} className="text-emerald-600 animate-spin" />}
                                    </div>
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 mb-2">{status === "uploading" ? "Uploading Document..." : "Extracting Data..."}</h3>
                                <p className="text-slate-500 text-sm font-medium max-w-sm text-center">
                                    {status === "processing" ? (processingStage || "Running Sarvam OCR & clinical intelligence...") : "Securely transferring to cloud storage..."}
                                </p>
                                {status === "processing" && (
                                    <div className="mt-6 w-full max-w-xs">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                                            <Clock size={12} /> Pipeline Progress
                                        </div>
                                        <div className="space-y-2">
                                            {Object.entries(stageProgress).map(([key, val]) => {
                                                const isActive = val.pct <= progress + 5 && val.pct >= progress - 10;
                                                const isDone = val.pct < progress - 5;
                                                return (
                                                    <div key={key} className={`flex items-center gap-2 text-xs font-medium transition-all ${isDone ? "text-emerald-600" : isActive ? "text-blue-600" : "text-slate-300"}`}>
                                                        {isDone ? <CheckCircle size={12} /> : isActive ? <Loader2 size={12} className="animate-spin" /> : <div className="w-3 h-3 rounded-full border border-slate-200" />}
                                                        <span className="capitalize">{key.replace("_", " ")}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : status === "completed" && extractedData ? (
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full flex flex-col items-center text-center pt-6 pb-2">
                                <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6"><CheckCircle size={40} /></div>
                                <h3 className="text-2xl font-bold text-slate-900 mb-2">Extraction Complete</h3>
                                <p className="text-slate-500 font-medium mb-8 max-w-md">Successfully digitized your prescription. Check the details below.</p>
                                <button onClick={reset} className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors">Upload Another</button>
                            </motion.div>
                        ) : null}
                    </div>
                </div>

                {/* ─── Results ────────────────────────────────────── */}
                <AnimatePresence>
                    {status === "completed" && extractedData && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">

                            {/* Name Match Warning */}
                            {nameMatchWarning && (
                                <div className="p-5 bg-amber-50 border border-amber-200 rounded-3xl flex items-start gap-4">
                                    <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={22} />
                                    <div>
                                        <h4 className="font-bold text-amber-800 text-sm mb-1">Patient Name Mismatch</h4>
                                        <p className="text-amber-700 text-sm font-medium leading-relaxed">{nameMatchWarning}</p>
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Match Score</span>
                                            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${nameMatchScore >= 0.7 ? "bg-emerald-100 text-emerald-700" : nameMatchScore >= 0.4 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                                                {Math.round(nameMatchScore * 100)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Prescription Header Info */}
                            {(extractedData.hospital_name || extractedData.doctor_name || extractedData.patient_name_ocr || extractedData.prescription_date) && (
                                <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                        <Building2 className="text-emerald-600" size={24} /> Prescription Details
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {extractedData.hospital_name && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Hospital / Clinic</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.hospital_name}</p>
                                            </div>
                                        )}
                                        {extractedData.doctor_name && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Doctor</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.doctor_name}</p>
                                            </div>
                                        )}
                                        {extractedData.patient_name_ocr && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Patient Name</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.patient_name_ocr}</p>
                                                {nameMatchScore > 0 && nameMatchScore < 1 && (
                                                    <span className={`mt-1 inline-block px-2 py-0.5 rounded text-[10px] font-bold ${nameMatchScore >= 0.7 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                                        {Math.round(nameMatchScore * 100)}% match with your account
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {extractedData.prescription_date && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Prescription Date</span>
                                                <p className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                                    <Calendar size={14} className="text-slate-400" />
                                                    {new Date(extractedData.prescription_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                                                </p>
                                            </div>
                                        )}
                                        {extractedData.patient_age_ocr && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Age</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.patient_age_ocr}</p>
                                            </div>
                                        )}
                                        {extractedData.patient_gender_ocr && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Gender</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.patient_gender_ocr}</p>
                                            </div>
                                        )}
                                        {extractedData.patient_weight_ocr && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Weight</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.patient_weight_ocr}</p>
                                            </div>
                                        )}
                                        {extractedData.patient_height_ocr && (
                                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Height</span>
                                                <p className="font-bold text-slate-900 text-sm">{extractedData.patient_height_ocr}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Original Prescription Image */}
                            {prescriptionImage && (
                                <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                        <Eye className="text-slate-500" size={24} /> Original Prescription
                                        <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">For comparison</span>
                                    </h3>
                                    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-center">
                                        <img src={prescriptionImage} alt="Original prescription" className="max-h-150 w-auto object-contain" />
                                    </div>
                                </div>
                            )}

                            {/* Drugs Table */}
                            <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                    <Pill className="text-emerald-600" size={24} /> Prescribed Medications
                                    {extractedData.drugs?.length > 0 && (
                                        <span className="ml-auto text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                                            {extractedData.drugs.length} found
                                        </span>
                                    )}
                                </h3>

                                {extractedData.drugs && extractedData.drugs.length > 0 ? (
                                    <div className="flex flex-col gap-4">
                                        {extractedData.drugs.map((drug: any, i: number) => {
                                            const score = drug.match_score ? Math.round(drug.match_score * 100) : 0;
                                            const stockCfg = STOCK_CONFIG[drug.stock_status] || STOCK_CONFIG.not_found;
                                            const StockIcon = stockCfg.icon;
                                            const formColor = FORM_COLORS[drug.form] || "bg-slate-50 text-slate-600";

                                            return (
                                                <div key={i} className="p-5 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 transition-colors">
                                                    {/* Drug header row */}
                                                    <div className="flex items-start justify-between gap-4 mb-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-bold text-slate-900 text-base">
                                                                    {drug.drug_name_matched || drug.drug_name_raw}
                                                                </span>
                                                                {drug.form && (
                                                                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${formColor}`}>
                                                                        {drug.form}
                                                                    </span>
                                                                )}
                                                                {score >= 50 && (
                                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${score >= 80 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                                                        {score}% match
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {drug.drug_name_matched && drug.drug_name_raw !== drug.drug_name_matched && (
                                                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">OCR: {drug.drug_name_raw}</p>
                                                            )}
                                                        </div>
                                                        {/* Stock badge */}
                                                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 ${stockCfg.bg} ${stockCfg.color} border ${stockCfg.border}`}>
                                                            <StockIcon size={14} />
                                                            {stockCfg.label}
                                                            {drug.stock_qty_available > 0 && (
                                                                <span className="ml-1 opacity-75">({drug.stock_qty_available})</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Drug details grid */}
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                                        <div>
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Dosage</span>
                                                            <span className="text-sm font-bold text-slate-700">{drug.dosage || "-"}</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Frequency</span>
                                                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold inline-block mt-0.5">
                                                                {drug.frequency_raw || drug.frequency || "-"}
                                                            </span>
                                                            {(drug.morning_dose > 0 || drug.afternoon_dose > 0 || drug.night_dose > 0) && (
                                                                <div className="flex items-center gap-1.5 mt-1">
                                                                    <span className="text-[10px] text-slate-400" title="Morning">{"\u2600\uFE0F"}{drug.morning_dose || 0}</span>
                                                                    <span className="text-[10px] text-slate-400" title="Afternoon">{"\u2600"}{drug.afternoon_dose || 0}</span>
                                                                    <span className="text-[10px] text-slate-400" title="Night">{"\uD83C\uDF19"}{drug.night_dose || 0}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Duration</span>
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-sm font-bold text-slate-700">{drug.duration || "-"}</span>
                                                                {!drug.duration_days && (
                                                                    <button
                                                                        onClick={() => { setEditingDuration(i); setDurationInput(""); }}
                                                                        className="p-0.5 text-blue-500 hover:text-blue-700 transition-colors"
                                                                        title="Set duration manually"
                                                                    >
                                                                        <Edit3 size={12} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {editingDuration === i && (
                                                                <div className="flex items-center gap-1 mt-1">
                                                                    <input
                                                                        type="number" min={1} max={365} placeholder="days"
                                                                        value={durationInput}
                                                                        onChange={(e) => setDurationInput(e.target.value)}
                                                                        className="w-16 px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400"
                                                                    />
                                                                    <button onClick={() => saveDuration(i)} disabled={durationSaving} className="p-1 text-emerald-600 hover:text-emerald-800 disabled:opacity-50">
                                                                        {durationSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                                    </button>
                                                                    <button onClick={() => setEditingDuration(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={12} /></button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Instructions</span>
                                                            <span className="text-sm text-slate-600">{drug.instructions || drug.meal_relation?.replace("_", " ") || "-"}</span>
                                                        </div>
                                                    </div>

                                                    {/* Course dates + alternative */}
                                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                                        <div className="flex items-center gap-3 flex-wrap">
                                                            {drug.course_start_date && (
                                                                <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                                                                    <Calendar size={11} />
                                                                    Start: {new Date(drug.course_start_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                                                </span>
                                                            )}
                                                            {drug.course_end_date && (
                                                                <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                                                                    <Calendar size={11} />
                                                                    End: {new Date(drug.course_end_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                                                </span>
                                                            )}
                                                            {drug.alternative_drug && (
                                                                <span className="text-[11px] text-blue-600 font-bold flex items-center gap-1 px-2 py-0.5 bg-blue-50 rounded-lg">
                                                                    <ArrowRightLeft size={11} /> Alt: {drug.alternative_drug}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => addToCheckout(drug)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                                                        >
                                                            <ShoppingCart size={12} /> Add to Cart
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                                        No medications detected in this document.
                                    </div>
                                )}
                            </div>

                            {/* Observations */}
                            <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                    <Stethoscope className="text-emerald-600" size={24} /> Clinical Observations
                                </h3>
                                {extractedData.observations && extractedData.observations.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {extractedData.observations.map((obs: any, i: number) => (
                                            <div key={i} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex flex-col gap-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                                                        {obs.observation_type.replace("_", " ")}
                                                    </span>
                                                    {obs.severity && (
                                                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${obs.severity === "severe" ? "bg-red-100 text-red-600" : obs.severity === "moderate" ? "bg-orange-100 text-orange-600" : "bg-green-100 text-green-600"}`}>
                                                            {obs.severity}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="font-semibold text-slate-800 text-sm">{obs.observation_text}</p>
                                                {obs.body_part && <p className="text-xs text-slate-500 font-medium mt-1">Area: {obs.body_part}</p>}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">No clinical observations found.</div>
                                )}
                            </div>

                            {/* Raw OCR Output */}
                            {extractedData.raw_extracted_text && (
                                <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                    <button onClick={() => setShowRawOcr(!showRawOcr)} className="w-full flex items-center justify-between">
                                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                                            <Eye className="text-slate-500" size={24} /> Raw OCR Output
                                            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{extractedData.raw_extracted_text.length.toLocaleString()} chars</span>
                                        </h3>
                                        <ChevronDown size={20} className={`text-slate-400 transition-transform duration-200 ${showRawOcr ? "rotate-180" : ""}`} />
                                    </button>
                                    <AnimatePresence>
                                        {showRawOcr && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                                <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-6 max-h-125 overflow-y-auto">
                                                    <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed">{extractedData.raw_extracted_text}</pre>
                                                </div>
                                                <p className="mt-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">This is the raw text extracted by Sarvam Vision OCR from your prescription document.</p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Checkout Drawer ────────────────────────────── */}
            <AnimatePresence>
                {showCheckout && checkoutItems.length > 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                        onClick={(e) => { if (e.target === e.currentTarget && !orderResult.loading) setShowCheckout(false); }}>
                        <motion.div initial={{ opacity: 0, y: 40, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
                            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">

                            {/* Header */}
                            <div className="px-8 pt-8 pb-4 flex items-start justify-between border-b border-slate-100 shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600"><ShoppingCart size={20} /></div>
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-900">Quick Checkout</h2>
                                        <p className="text-xs text-slate-500 font-medium mt-0.5">{checkoutItems.length} item{checkoutItems.length > 1 ? "s" : ""} — BayMax Pharmacy</p>
                                    </div>
                                </div>
                                {!orderResult.loading && <button onClick={() => setShowCheckout(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-xl"><X size={18} /></button>}
                            </div>

                            {/* Items */}
                            <div className="flex-1 overflow-y-auto px-8 py-5">
                                <div className="flex flex-col gap-3">
                                    {checkoutItems.map((item, i) => (
                                        <div key={i} className="flex items-center gap-4 py-3 px-4 rounded-2xl bg-slate-50 border border-slate-100">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-900 text-sm truncate">{item.drug_name}</p>
                                                <p className="text-xs text-slate-400 font-medium">₹{item.unit_price.toFixed(2)} per unit</p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button onClick={() => updateCheckoutQty(i, -1)} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                                                    <Minus size={12} />
                                                </button>
                                                <span className="w-8 text-center font-bold text-slate-900 text-sm">{item.quantity}</span>
                                                <button onClick={() => updateCheckoutQty(i, 1)} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                                                    <Plus size={12} />
                                                </button>
                                            </div>
                                            <span className="font-bold text-slate-900 text-sm w-16 text-right">₹{(item.unit_price * item.quantity).toFixed(0)}</span>
                                            <button onClick={() => removeFromCheckout(i)} className="p-1 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                                        </div>
                                    ))}
                                </div>

                                {/* Quick add all */}
                                {extractedData?.drugs && checkoutItems.length < extractedData.drugs.length && (
                                    <button
                                        onClick={() => {
                                            const existingNames = new Set(checkoutItems.map(i => i.drug_name));
                                            extractedData.drugs.forEach((d: any) => {
                                                const name = d.drug_name_matched || d.drug_name_raw;
                                                if (!existingNames.has(name)) addToCheckout(d);
                                            });
                                        }}
                                        className="mt-3 w-full py-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-xs font-bold text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Plus size={14} /> Add All Remaining Medicines
                                    </button>
                                )}
                            </div>

                            {/* Footer — Total + Pay */}
                            <div className="px-8 py-6 border-t border-slate-100 bg-slate-50/50 shrink-0">
                                {orderResult.reply && (
                                    <div className="mb-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                                        <div className="flex items-center gap-2 mb-1"><CheckCircle size={16} className="text-emerald-600 shrink-0" /><span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Payment Successful</span></div>
                                        <p className="text-sm text-emerald-900 font-medium">{orderResult.reply}</p>
                                    </div>
                                )}
                                {orderResult.error && (
                                    <div className="mb-4 bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-2">
                                        <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                                        <p className="text-sm text-red-700 font-medium">{orderResult.error}</p>
                                    </div>
                                )}

                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm font-bold text-slate-500 uppercase tracking-wide">Total</span>
                                    <span className="text-2xl font-bold text-slate-900">₹{checkoutTotal.toFixed(2)}</span>
                                </div>

                                {!orderResult.reply ? (
                                    <div className="flex gap-3">
                                        <button onClick={() => setShowCheckout(false)} disabled={orderResult.loading} className="flex-1 px-4 py-3.5 bg-white text-slate-700 rounded-2xl font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50">
                                            Continue Shopping
                                        </button>
                                        <button onClick={placeOrder} disabled={orderResult.loading || checkoutItems.length === 0} className="flex-1 px-4 py-3.5 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2">
                                            {orderResult.loading ? <><Loader2 size={16} className="animate-spin" /> Processing...</> : <><CreditCard size={16} /> Pay ₹{checkoutTotal.toFixed(0)}</>}
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => { setShowCheckout(false); setCheckoutItems([]); setOrderResult({ loading: false, reply: null, error: null }); }} className="w-full px-4 py-3.5 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm">
                                        Done
                                    </button>
                                )}

                                <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                    <CreditCard size={10} /> Secured by Razorpay
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Floating cart button */}
            {checkoutItems.length > 0 && !showCheckout && status === "completed" && (
                <motion.button
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={() => setShowCheckout(true)}
                    className="fixed bottom-6 right-6 z-40 flex items-center gap-3 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl shadow-xl shadow-emerald-200 transition-colors"
                >
                    <ShoppingCart size={18} />
                    <span className="font-bold text-sm">{checkoutItems.length} item{checkoutItems.length > 1 ? "s" : ""} — ₹{checkoutTotal.toFixed(0)}</span>
                </motion.button>
            )}

            {/* Razorpay SDK */}
            <Script
                src="https://checkout.razorpay.com/v1/checkout.js"
                onLoad={() => setRazorpayLoaded(true)}
            />
        </div>
    );
}
