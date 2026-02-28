// ─── Admin Mock Data & Service ──────────────────────────────
// Provides fallback mock data when the backend is unavailable.
// All admin pages use this layer so CRUD is fully testable offline.

export interface Medicine {
    id: string;
    name: string;
    brand: string;
    category: string;
    price: number;
    duration_days: number;
    rx_required: boolean;
    status: "active" | "disabled";
}

export interface InventoryItem {
    id: string;
    drug_name: string;
    brand: string;
    category: string;
    stock_left: number;
    reorder_level: number;
    expiry_date: string;
    batch_no: string;
    status: "in_stock" | "low_stock" | "out_of_stock";
}

export interface Prescription {
    id: string;
    patient_name: string;
    patient_phone: string;
    drug_name: string;
    dosage: string;
    frequency: string;
    prescribed_by: string;
    prescribed_at: string;
    status: "active" | "completed" | "cancelled";
}

export interface AdminOrder {
    id: string;
    order_number: string;
    patient_name: string;
    drug_name: string;
    quantity: number;
    total_price: number;
    status: "pending" | "processing" | "delivered" | "cancelled";
    ordered_at: string;
}

// ─── Seed Data ──────────────────────────────────────────────

const MOCK_MEDICINES: Medicine[] = [
    { id: "m1", name: "Minoxidil", brand: "Minoxidil", category: "Cosmetic", price: 550, duration_days: 90, rx_required: false, status: "active" },
    { id: "m2", name: "Dolo650", brand: "Micro Labs", category: "Fever", price: 50, duration_days: 5, rx_required: false, status: "active" },
    { id: "m3", name: "Paracetamol 650mg", brand: "Crocin", category: "Pain Relief", price: 50, duration_days: 5, rx_required: false, status: "active" },
    { id: "m4", name: "Amoxicillin 500mg", brand: "Amoxil", category: "Antibiotic", price: 120, duration_days: 7, rx_required: true, status: "active" },
    { id: "m5", name: "Insulin", brand: "Huminsulin", category: "Diabetes", price: 450, duration_days: 30, rx_required: false, status: "active" },
    { id: "m6", name: "Metformin 500mg", brand: "Glycomet", category: "Diabetes", price: 80, duration_days: 30, rx_required: true, status: "active" },
    { id: "m7", name: "Azithromycin 500mg", brand: "Zithromax", category: "Antibiotic", price: 150, duration_days: 5, rx_required: true, status: "active" },
    { id: "m8", name: "Cetirizine 10mg", brand: "Zyrtec", category: "Allergy", price: 30, duration_days: 10, rx_required: false, status: "active" },
];

const MOCK_INVENTORY: InventoryItem[] = [
    { id: "inv1", drug_name: "Paracetamol 650mg", brand: "Crocin", category: "Pain Relief", stock_left: 240, reorder_level: 50, expiry_date: "2027-03-15", batch_no: "B2024-001", status: "in_stock" },
    { id: "inv2", drug_name: "Amoxicillin 500mg", brand: "Amoxil", category: "Antibiotic", stock_left: 18, reorder_level: 30, expiry_date: "2026-08-20", batch_no: "B2024-002", status: "low_stock" },
    { id: "inv3", drug_name: "Insulin", brand: "Huminsulin", category: "Diabetes", stock_left: 0, reorder_level: 20, expiry_date: "2026-12-01", batch_no: "B2024-003", status: "out_of_stock" },
    { id: "inv4", drug_name: "Metformin 500mg", brand: "Glycomet", category: "Diabetes", stock_left: 320, reorder_level: 100, expiry_date: "2027-06-10", batch_no: "B2024-004", status: "in_stock" },
    { id: "inv5", drug_name: "Dolo650", brand: "Micro Labs", category: "Fever", stock_left: 500, reorder_level: 100, expiry_date: "2027-01-18", batch_no: "B2024-005", status: "in_stock" },
    { id: "inv6", drug_name: "Azithromycin 500mg", brand: "Zithromax", category: "Antibiotic", stock_left: 12, reorder_level: 25, expiry_date: "2026-05-30", batch_no: "B2024-006", status: "low_stock" },
];

const MOCK_PRESCRIPTIONS: Prescription[] = [
    { id: "rx1", patient_name: "Rahul Sharma", patient_phone: "+919876543210", drug_name: "Amoxicillin 500mg", dosage: "500mg", frequency: "3x daily", prescribed_by: "Dr. Mehta", prescribed_at: "2026-02-20T10:30:00Z", status: "active" },
    { id: "rx2", patient_name: "Priya Patel", patient_phone: "+919876543211", drug_name: "Metformin 500mg", dosage: "500mg", frequency: "2x daily", prescribed_by: "Dr. Gupta", prescribed_at: "2026-02-15T14:00:00Z", status: "active" },
    { id: "rx3", patient_name: "Ankit Kumar", patient_phone: "+919876543212", drug_name: "Cetirizine 10mg", dosage: "10mg", frequency: "1x daily", prescribed_by: "Dr. Singh", prescribed_at: "2026-02-10T09:15:00Z", status: "completed" },
    { id: "rx4", patient_name: "Sneha Reddy", patient_phone: "+919876543213", drug_name: "Paracetamol 650mg", dosage: "650mg", frequency: "As needed", prescribed_by: "Dr. Rao", prescribed_at: "2026-02-18T16:45:00Z", status: "active" },
];

const MOCK_ORDERS: AdminOrder[] = [
    { id: "ord1", order_number: "ORD-2026-0001", patient_name: "Rahul Sharma", drug_name: "Amoxicillin 500mg", quantity: 21, total_price: 2520, status: "delivered", ordered_at: "2026-02-20T10:30:00Z" },
    { id: "ord2", order_number: "ORD-2026-0002", patient_name: "Priya Patel", drug_name: "Metformin 500mg", quantity: 60, total_price: 4800, status: "processing", ordered_at: "2026-02-22T11:00:00Z" },
    { id: "ord3", order_number: "ORD-2026-0003", patient_name: "Ankit Kumar", drug_name: "Cetirizine 10mg", quantity: 10, total_price: 300, status: "delivered", ordered_at: "2026-02-18T08:20:00Z" },
    { id: "ord4", order_number: "ORD-2026-0004", patient_name: "Sneha Reddy", drug_name: "Dolo650", quantity: 10, total_price: 500, status: "pending", ordered_at: "2026-02-27T15:30:00Z" },
    { id: "ord5", order_number: "ORD-2026-0005", patient_name: "Vikram Joshi", drug_name: "Insulin", quantity: 5, total_price: 2250, status: "cancelled", ordered_at: "2026-02-25T09:45:00Z" },
];

// ─── In-memory store (simulates DB) ────────────────────────

let medicines = [...MOCK_MEDICINES];
let inventory = [...MOCK_INVENTORY];
let prescriptions = [...MOCK_PRESCRIPTIONS];
let orders = [...MOCK_ORDERS];

function delay(ms = 300): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ─── Admin Mock Service ─────────────────────────────────────

export const adminMockService = {
    // ── Medicines CRUD ──
    getMedicines: async (): Promise<Medicine[]> => {
        await delay();
        return [...medicines];
    },
    addMedicine: async (data: Omit<Medicine, "id">): Promise<Medicine> => {
        await delay();
        const med: Medicine = { ...data, id: `m${Date.now()}` };
        medicines = [med, ...medicines];
        return med;
    },
    updateMedicine: async (id: string, data: Partial<Medicine>): Promise<Medicine> => {
        await delay();
        medicines = medicines.map((m) => (m.id === id ? { ...m, ...data } : m));
        const updated = medicines.find((m) => m.id === id);
        if (!updated) throw new Error("Medicine not found");
        return updated;
    },
    toggleMedicineStatus: async (id: string): Promise<Medicine> => {
        await delay();
        medicines = medicines.map((m) =>
            m.id === id ? { ...m, status: m.status === "active" ? "disabled" : "active" } : m
        );
        const updated = medicines.find((m) => m.id === id);
        if (!updated) throw new Error("Medicine not found");
        return updated;
    },
    deleteMedicine: async (id: string): Promise<void> => {
        await delay();
        medicines = medicines.filter((m) => m.id !== id);
    },

    // ── Inventory CRUD ──
    getInventory: async (): Promise<InventoryItem[]> => {
        await delay();
        return [...inventory];
    },
    updateInventory: async (id: string, data: Partial<InventoryItem>): Promise<InventoryItem> => {
        await delay();
        inventory = inventory.map((i) => (i.id === id ? { ...i, ...data } : i));
        const updated = inventory.find((i) => i.id === id);
        if (!updated) throw new Error("Inventory item not found");
        return updated;
    },
    addInventoryItem: async (data: Omit<InventoryItem, "id">): Promise<InventoryItem> => {
        await delay();
        const item: InventoryItem = { ...data, id: `inv${Date.now()}` };
        inventory = [item, ...inventory];
        return item;
    },

    // ── Prescriptions ──
    getPrescriptions: async (): Promise<Prescription[]> => {
        await delay();
        return [...prescriptions];
    },
    updatePrescriptionStatus: async (id: string, status: Prescription["status"]): Promise<Prescription> => {
        await delay();
        prescriptions = prescriptions.map((p) => (p.id === id ? { ...p, status } : p));
        const updated = prescriptions.find((p) => p.id === id);
        if (!updated) throw new Error("Prescription not found");
        return updated;
    },

    // ── Orders ──
    getOrders: async (): Promise<AdminOrder[]> => {
        await delay();
        return [...orders];
    },
    updateOrderStatus: async (id: string, status: AdminOrder["status"]): Promise<AdminOrder> => {
        await delay();
        orders = orders.map((o) => (o.id === id ? { ...o, status } : o));
        const updated = orders.find((o) => o.id === id);
        if (!updated) throw new Error("Order not found");
        return updated;
    },

    // ── Dashboard Stats ──
    getDashboardStats: async () => {
        await delay();
        return {
            totalMedicines: medicines.length,
            activeMedicines: medicines.filter((m) => m.status === "active").length,
            totalInventory: inventory.reduce((s, i) => s + i.stock_left, 0),
            lowStockCount: inventory.filter((i) => i.status === "low_stock" || i.status === "out_of_stock").length,
            activePrescriptions: prescriptions.filter((p) => p.status === "active").length,
            pendingOrders: orders.filter((o) => o.status === "pending").length,
            totalOrders: orders.length,
            totalRevenue: orders.filter((o) => o.status === "delivered").reduce((s, o) => s + o.total_price, 0),
        };
    },
};
