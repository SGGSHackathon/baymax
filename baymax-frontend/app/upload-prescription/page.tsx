"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { dataService, authService } from "@/lib/api";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    UploadCloud, FileText, CheckCircle, AlertCircle, Loader2, ArrowLeft,
    Clock, Activity, Pill, ChevronRight, X
} from "lucide-react";
import Link from "next/link";

type UploadState = "idle" | "uploading" | "processing" | "completed" | "error";

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

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        authService.getMe().then(setUser).catch(() => { });
    }, []);

    const handleFile = (selectedFile: File) => {
        if (!selectedFile) return;

        const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'application/zip', 'application/x-zip-compressed'];
        if (!validTypes.includes(selectedFile.type)) {
            setErrorMsg("Unsupported file type. Please upload a PDF, PNG, JPG, or ZIP.");
            return;
        }

        if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit roughly
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
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const processUpload = async () => {
        if (!file || !user) return;

        setStatus("uploading");
        setProgress(10);
        setErrorMsg("");

        try {
            // 1. Get Presigned URL
            setProgress(20);
            const uploadParams = await dataService.getPrescriptionUploadUrl({
                user_id: user.id,
                file_name: file.name,
                content_type: file.type
            });

            // 2. Upload to S3
            setProgress(40);
            await dataService.uploadToS3(uploadParams.upload_url, file);

            // 3. Trigger Processing
            setProgress(60);
            setStatus("processing");
            const processRes = await dataService.processPrescription({
                prescription_id: uploadParams.prescription_id,
                s3_key: uploadParams.s3_key
            });

            setPrescriptionId(processRes.prescription_id);
            pollStatus(processRes.prescription_id);

        } catch (err: any) {
            console.error(err);
            setStatus("error");
            setErrorMsg(err.response?.data?.detail || err.message || "Failed to process prescription.");
        }
    };

    const pollStatus = async (id: string) => {
        let attempts = 0;
        const maxAttempts = 200; // 200 * 3s = 10 minutes max polling

        const interval = setInterval(async () => {
            attempts++;
            if (attempts > maxAttempts) {
                clearInterval(interval);
                setStatus("error");
                setErrorMsg("Processing timed out. Please try again later.");
                return;
            }

            try {
                const res = await dataService.getPrescriptionStatus(id);
                setProgress(Math.min(60 + (attempts * 2), 95));

                if (res.ocr_status === "completed") {
                    clearInterval(interval);
                    setProgress(100);
                    setExtractedData(res);
                    setStatus("completed");
                } else if (res.ocr_status === "failed") {
                    clearInterval(interval);
                    setStatus("error");
                    setErrorMsg(res.error_message || "OCR Processing failed on the server.");
                }
            } catch (err) {
                // Ignore 404s while waiting or minor network hiccups
                console.warn("Polling error...", err);
            }
        }, 3000);
    };

    const reset = () => {
        setFile(null);
        setStatus("idle");
        setProgress(0);
        setErrorMsg("");
        setExtractedData(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

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

                <div className="bg-white p-8 md:p-12 rounded-[32px] border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <UploadCloud size={24} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Upload Prescription</h1>
                            <p className="text-slate-500 font-medium">Auto-digitize and check for clinical safety.</p>
                        </div>
                    </div>

                    <div className="mt-10">
                        {status === "idle" || status === "error" ? (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className="flex flex-col items-center"
                            >
                                <div
                                    className={`w-full border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center transition-all cursor-pointer ${dragActive ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-400 hover:bg-slate-50"
                                        }`}
                                    onDragEnter={() => setDragActive(true)}
                                    onDragLeave={() => setDragActive(false)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        ref={fileInputRef} type="file" className="hidden"
                                        accept=".pdf, .png, .jpg, .jpeg, .zip"
                                        onChange={handleChange}
                                    />

                                    <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center text-emerald-600 mb-6 group-hover:scale-110 transition-transform">
                                        <FileText size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-800 mb-2">Drag & Drop your file here</h3>
                                    <p className="text-slate-400 text-sm mb-6 text-center max-w-sm">
                                        Supports PDF, PNG, JPG, JPEG, or ZIP up to 10MB
                                    </p>

                                    <button className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-emerald-800 transition-colors shadow-sm">
                                        Browse Files
                                    </button>
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
                                            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                                <FileText size={20} />
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
                                                <p className="text-xs text-slate-500 font-medium">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button onClick={(e) => { e.stopPropagation(); reset(); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                                                <X size={18} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); processUpload(); }}
                                                className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-emerald-800 transition-colors shadow-sm"
                                            >
                                                Upload & Extract
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : status === "uploading" || status === "processing" ? (
                            <motion.div
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                className="w-full py-16 flex flex-col items-center justify-center text-center"
                            >
                                <div className="relative w-24 h-24 mb-8">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                        <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                                        <motion.circle
                                            cx="50" cy="50" r="45" fill="none" stroke="#059669" strokeWidth="8"
                                            strokeLinecap="round"
                                            initial={{ strokeDasharray: "0 283" }}
                                            animate={{ strokeDasharray: `${(progress / 100) * 283} 283` }}
                                            transition={{ duration: 0.5 }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                                        {status === "uploading" ? (
                                            <UploadCloud size={24} className="text-emerald-600 animate-bounce" />
                                        ) : (
                                            <Loader2 size={24} className="text-emerald-600 animate-spin" />
                                        )}
                                    </div>
                                </div>

                                <h3 className="text-xl font-bold text-slate-900 mb-2">
                                    {status === "uploading" ? "Uploading Document..." : "Extracting Data..."}
                                </h3>
                                <p className="text-slate-500 text-sm font-medium">
                                    {status === "processing" ? "Running Sarvam OCR & clinical intelligence..." : "Securely transferring to cloud storage..."}
                                </p>
                            </motion.div>
                        ) : status === "completed" && extractedData ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                                className="w-full flex flex-col items-center text-center pt-6 pb-2"
                            >
                                <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6">
                                    <CheckCircle size={40} />
                                </div>
                                <h3 className="text-2xl font-bold text-slate-900 mb-2">Extraction Complete</h3>
                                <p className="text-slate-500 font-medium mb-8 max-w-md">
                                    We've successfully digitized your prescription. Check the details below.
                                </p>

                                <button onClick={reset} className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors">
                                    Upload Another
                                </button>
                            </motion.div>
                        ) : null}
                    </div>
                </div>

                {/* Results View */}
                <AnimatePresence>
                    {status === "completed" && extractedData && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col gap-6"
                        >
                            {/* Drugs Table */}
                            <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                    <Pill className="text-emerald-600" size={24} /> Prescribed Medications
                                </h3>

                                {extractedData.drugs && extractedData.drugs.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-100 text-slate-400">
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Medication</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Dosage</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Frequency</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Duration</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Notes</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {extractedData.drugs.map((drug: any, i: number) => (
                                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="py-4 font-bold text-slate-900">
                                                            {drug.drug_name_matched || drug.drug_name_raw}
                                                            {drug.drug_name_matched && (
                                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase">Matched</span>
                                                            )}
                                                        </td>
                                                        <td className="py-4 text-slate-600 font-medium">{drug.dosage || "-"}</td>
                                                        <td className="py-4 text-slate-600">
                                                            <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                                                                {drug.frequency_raw || drug.frequency || "-"}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 text-slate-600 font-medium">{drug.duration || "-"}</td>
                                                        <td className="py-4 text-slate-500 text-xs leading-relaxed max-w-[200px]">{drug.instructions || drug.meal_relation || "-"}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                                        No medications detected in this document.
                                    </div>
                                )}
                            </div>

                            {/* Observations List */}
                            <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                    <Activity className="text-emerald-600" size={24} /> Clinical Observations
                                </h3>

                                {extractedData.observations && extractedData.observations.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {extractedData.observations.map((obs: any, i: number) => (
                                            <div key={i} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex flex-col gap-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                                                        {obs.observation_type.replace('_', ' ')}
                                                    </span>
                                                    {obs.severity && (
                                                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${obs.severity === 'severe' ? 'bg-red-100 text-red-600' :
                                                            obs.severity === 'moderate' ? 'bg-orange-100 text-orange-600' :
                                                                'bg-green-100 text-green-600'
                                                            }`}>
                                                            {obs.severity}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="font-semibold text-slate-800 text-sm">{obs.observation_text}</p>
                                                {obs.body_part && (
                                                    <p className="text-xs text-slate-500 font-medium mt-1">Area: {obs.body_part}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                                        No clinical observations found.
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
