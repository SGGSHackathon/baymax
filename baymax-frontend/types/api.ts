// ─── User & Auth ────────────────────────────────────────────

export interface UserProfile {
    id: string;
    name: string;
    email: string;
    phone: string;
    age?: number | null;
    gender?: string | null;
    pincode?: string | null;
    city?: string | null;
    country?: string | null;
    preferred_language?: string | null;
    blood_group?: string | null;
    weight_kg?: number | null;
    height_cm?: number | null;
    bmi?: number | null;
    overall_adherence?: number;
    risk_tier?: number;
    onboarded?: boolean;
    allergies?: string[];
    chronic_conditions?: string[];
}

export interface AuthResponse {
    token: string;
    user: UserProfile;
}

export interface Language {
    code: string;
    name: string;
}

// ─── Chat ───────────────────────────────────────────────────

export interface OrderItem {
    drug_name: string;
    brand_name: string;
    stock_qty: number;
    price_per_unit: number;
    unit: string;
    strength: string;
    is_otc: boolean;
    category: string;
}

export interface ChatResponse {
    reply: string;
    session_id: string;
    agent_used: string;
    emergency: boolean;
    safety_flags: string[];
    triage_level: string;
    requires_action: string | null;
    risk_tier: number;
    channel: string;
    dfe_triggered: boolean;
    web_search_used: boolean;
    order_items?: OrderItem[] | null;
}

export interface VoiceResponse {
    transcript: string;
    detected_language: string;
    reply: string;
    reply_english: string;
    audio_base64: string;
    session_id: string;
    agent_used: string;
    emergency: boolean;
}

// ─── Vitals ─────────────────────────────────────────────────

export interface VitalsPayload {
    phone: string;
    bp_systolic?: number;
    bp_diastolic?: number;
    blood_sugar?: number;
    spo2_pct?: number;
    temp_celsius?: number;
    heart_rate?: number;
    weight_kg?: number;
}

export interface VitalsResponse {
    status: string;
    alerts: string[];
}

// ─── Profile Tabs ───────────────────────────────────────────

export interface TimelineEvent {
    event_type: string;
    timestamp: string;
    details: Record<string, unknown>;
}

export interface AdherenceRecord {
    drug_name: string;
    score: number;
    risk_flag: string;
    week_start: string;
    total_taken: number;
    total_skipped: number;
}

export interface AdherenceData {
    overall: number;
    records: AdherenceRecord[];
}

export interface EpisodeData {
    primary_symptom: string;
    severity: string;
    start_date: string;
    related_symptoms: string[];
}

export interface RiskData {
    risk_tier: number;
    tier_constraints: Record<string, boolean>;
    abuse_score: number;
    abuse_flags: string[];
    abuse_blocked: boolean;
}

export interface DFEQuestion {
    question?: string;
    dfe_question?: string;
    answer?: string;
    context?: string;
    created_at: string;
}

// ─── Admin ──────────────────────────────────────────────────

export interface AbuseFlag {
    phone: string;
    name: string;
    score: number;
    flags: string[];
    review_required: boolean;
    blocked: boolean;
}

export interface LowStockItem {
    drug_name?: string;
    name?: string;
    stock_left: number;
}

// ─── Error ──────────────────────────────────────────────────

export interface ApiError {
    message: string;
    status: number;
    detail?: string | Record<string, unknown>[];
}

export interface ActiveMedication {
    id: string;
    drug_name: string;
    dosage?: string;
    dose_per_intake?: string;
    frequency?: string;
    start_date?: string;
    end_date?: string;
    prescribed_by?: string;
    is_active: boolean;
}

export interface Order {
    id: string;
    order_number: string;
    drug_name: string;
    quantity: number;
    total_price: number;
    status: string;
    ordered_at: string;
    unit_price?: number;
}

export interface Reminder {
    id: string;
    order_id?: string;
    drug_name: string;
    dose?: string;
    meal_instruction?: string;
    remind_times: string[];
    start_date?: string;
    end_date?: string;
    is_active: boolean;
    total_qty?: number;
    qty_remaining?: number;
}

export interface MedicineCourse {
    id: string;
    user_id: string;
    reminder_id?: string;
    order_id?: string;
    drug_name: string;
    dose?: string;
    frequency: number;
    times: string[];
    meal_instruction?: string;
    duration_days?: number;
    start_date?: string;
    end_date?: string;
    total_qty?: number;
    qty_remaining?: number;
    doses_taken: number;
    doses_skipped: number;
    status: 'active' | 'completed' | 'paused' | 'cancelled';
    created_at?: string;
}

export interface HealthEvent {
    id: string;
    event_type: string;
    title: string;
    description?: string;
    occurred_at: string;
}

export interface AdherenceScore {
    week_start: string;
    drug_name: string;
    score: number;
    risk_flag: string;
    total_taken: number;
    total_scheduled: number;
}

export interface AdverseReaction {
    id: string;
    drug_name: string;
    reaction: string;
    severity: string;
    reported_at: string;
}

export interface FullHistory {
    user: UserProfile;
    active_medications: ActiveMedication[];
    orders: Order[];
    reminders: Reminder[];
    medicine_courses: MedicineCourse[];
    health_timeline: HealthEvent[];
    adherence_scores: AdherenceScore[];
    adverse_reactions: AdverseReaction[];
    generated_at: string;
}

// ─── Prescriptions ─────────────────────────────────────────

export interface PrescriptionSummary {
    id: string;
    s3_key: string;
    file_type: string;
    ocr_status: string;
    error_message?: string | null;
    processed_at?: string | null;
    created_at: string;
    drugs_found: number;
    observations_found: number;
}

export interface PrescriptionDrug {
    drug_name_raw: string;
    drug_name_matched?: string | null;
    match_score?: number | null;
    brand_name?: string | null;
    dosage?: string | null;
    frequency?: string | null;
    frequency_raw?: string | null;
    morning_dose?: string | null;
    afternoon_dose?: string | null;
    night_dose?: string | null;
    duration?: string | null;
    duration_days?: number | null;
    instructions?: string | null;
    meal_relation?: string | null;
}

export interface PrescriptionObservation {
    observation_type: string;
    observation_text: string;
    body_part?: string | null;
    severity?: string | null;
}

export interface PrescriptionDetail {
    id: string;
    user_id: string;
    s3_key: string;
    file_type: string;
    ocr_status: string;
    sarvam_job_id?: string | null;
    raw_extracted_text?: string | null;
    error_message?: string | null;
    processed_at?: string | null;
    created_at: string;
    drugs: PrescriptionDrug[];
    observations: PrescriptionObservation[];
}

export interface UserPrescriptionsResponse {
    user_id: string;
    count: number;
    prescriptions: PrescriptionSummary[];
}
