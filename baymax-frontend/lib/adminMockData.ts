import type {
  StockPredictionItem,
  StockPredictionResponse,
  StockDrugDetail,
  RefillAlert,
  RefillForecastResponse,
  ExpiryRiskResponse,
} from "@/lib/adminApi";

const MOCK_STOCK_ITEMS: StockPredictionItem[] = [
  {
    drug_name: "Paracetamol",
    brand_name: "Dolo 650",
    current_stock: 420,
    reorder_level: 300,
    hist_daily_demand: 22,
    active_daily_demand: 18,
    blended_daily_rate: 20,
    predicted_stock: 120,
    days_until_stockout: 21,
    reorder_flag: "reorder_soon",
  },
  {
    drug_name: "Azithromycin",
    brand_name: "Azithral 500",
    current_stock: 120,
    reorder_level: 150,
    hist_daily_demand: 9,
    active_daily_demand: 10,
    blended_daily_rate: 9.5,
    predicted_stock: -15,
    days_until_stockout: 10,
    reorder_flag: "reorder_now",
  },
  {
    drug_name: "Levocetirizine",
    brand_name: "Levocet",
    current_stock: 260,
    reorder_level: 140,
    hist_daily_demand: 7,
    active_daily_demand: 6,
    blended_daily_rate: 6.5,
    predicted_stock: 70,
    days_until_stockout: 33,
    reorder_flag: "sufficient",
  },
  {
    drug_name: "Pantoprazole + Domperidone",
    brand_name: "Pan-D",
    current_stock: 85,
    reorder_level: 120,
    hist_daily_demand: 6,
    active_daily_demand: 8,
    blended_daily_rate: 7,
    predicted_stock: -5,
    days_until_stockout: 12,
    reorder_flag: "reorder_now",
  },
  {
    drug_name: "Ascorbic Acid",
    brand_name: "Limcee",
    current_stock: 700,
    reorder_level: 250,
    hist_daily_demand: 12,
    active_daily_demand: 10,
    blended_daily_rate: 11,
    predicted_stock: 370,
    days_until_stockout: 64,
    reorder_flag: "sufficient",
  },
];

function buildDailySeries(currentStock: number, rate: number, days: number) {
  return Array.from({ length: Math.max(7, days) }, (_, idx) => {
    const day = idx + 1;
    return {
      day,
      date: new Date(Date.now() + day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      predicted_stock: Math.max(0, currentStock - rate * day),
    };
  });
}

export function getMockStockPrediction(daysAhead: number): StockPredictionResponse {
  const reorder_now = MOCK_STOCK_ITEMS.filter((i) => i.reorder_flag === "reorder_now").length;
  const reorder_soon = MOCK_STOCK_ITEMS.filter((i) => i.reorder_flag === "reorder_soon").length;

  return {
    days_ahead: daysAhead,
    reorder_now,
    reorder_soon,
    total_items: MOCK_STOCK_ITEMS.length,
    data: MOCK_STOCK_ITEMS,
  };
}

export function getMockStockDrugDetail(drugName: string, daysAhead: number): StockDrugDetail | null {
  const item = MOCK_STOCK_ITEMS.find((d) => d.drug_name.toLowerCase() === drugName.toLowerCase());
  if (!item) return null;

  return {
    drug_name: item.drug_name,
    inventory_batches: [
      {
        brand_name: item.brand_name,
        stock_qty: Math.max(1, Math.round(item.current_stock * 0.55)),
        expiry_date: "2026-07-15",
      },
      {
        brand_name: item.brand_name,
        stock_qty: Math.max(1, Math.round(item.current_stock * 0.45)),
        expiry_date: "2026-10-12",
      },
    ],
    total_current_stock: item.current_stock,
    demand: {
      historic_daily_avg: item.hist_daily_demand,
      active_daily_consumption: item.active_daily_demand,
      blended_daily_rate: item.blended_daily_rate,
    },
    forecast: {
      days_ahead: daysAhead,
      days_until_stockout: item.days_until_stockout,
      predicted_reorder_date:
        item.days_until_stockout !== null
          ? new Date(Date.now() + item.days_until_stockout * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          : null,
      predicted_stock_at_end: Math.round(item.predicted_stock),
      daily: buildDailySeries(item.current_stock, item.blended_daily_rate, daysAhead),
    },
    active_patients: [
      { name: "Riya Sharma", phone: "9876543210" },
      { name: "Amit Patil", phone: "9123456780" },
    ],
    active_patient_count: 2,
    recent_orders: [],
  };
}

export const MOCK_REFILL_ALERTS: RefillAlert[] = [
  {
    record_id: "demo-rf-1",
    source: "reminder",
    user_id: "demo-u-1",
    phone: "9876543210",
    patient_name: "Riya Sharma",
    drug_name: "Paracetamol",
    qty_remaining: 4,
    refill_alert_at: Date.now(),
    end_date: "2026-03-12",
    is_active: true,
    urgency: "critical",
    updated_at: new Date().toISOString(),
  },
  {
    record_id: "demo-rf-2",
    source: "course",
    user_id: "demo-u-2",
    phone: "9123456780",
    patient_name: "Amit Patil",
    drug_name: "Azithromycin",
    qty_remaining: 0,
    refill_alert_at: Date.now(),
    end_date: "2026-03-05",
    is_active: true,
    urgency: "out_of_stock",
    updated_at: new Date().toISOString(),
  },
  {
    record_id: "demo-rf-3",
    source: "reminder",
    user_id: "demo-u-3",
    phone: "9000011111",
    patient_name: "Sneha Rao",
    drug_name: "Levocetirizine",
    qty_remaining: 8,
    refill_alert_at: Date.now(),
    end_date: "2026-03-21",
    is_active: true,
    urgency: "low",
    updated_at: new Date().toISOString(),
  },
];

export function getMockRefillForecast(daysAhead: number): RefillForecastResponse {
  const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    days_ahead: daysAhead,
    cutoff_date: cutoff,
    patients_needing_refill: 3,
    data: [
      {
        record_id: "demo-ff-1",
        source: "reminder",
        user_id: "demo-u-1",
        phone: "9876543210",
        patient_name: "Riya Sharma",
        drug_name: "Paracetamol",
        qty_remaining: 4,
        daily_doses: 2,
        remaining_days: 2,
        predicted_runout: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        end_date: "2026-03-12",
        updated_at: new Date().toISOString(),
      },
      {
        record_id: "demo-ff-2",
        source: "course",
        user_id: "demo-u-2",
        phone: "9123456780",
        patient_name: "Amit Patil",
        drug_name: "Azithromycin",
        qty_remaining: 1,
        daily_doses: 1,
        remaining_days: 1,
        predicted_runout: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        end_date: "2026-03-05",
        updated_at: new Date().toISOString(),
      },
      {
        record_id: "demo-ff-3",
        source: "reminder",
        user_id: "demo-u-3",
        phone: "9000011111",
        patient_name: "Sneha Rao",
        drug_name: "Levocetirizine",
        qty_remaining: 10,
        daily_doses: 1,
        remaining_days: 10,
        predicted_runout: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        end_date: "2026-03-21",
        updated_at: new Date().toISOString(),
      },
    ],
  };
}

export function getMockExpiryRisk(daysAhead: number): ExpiryRiskResponse {
  const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    days_ahead: daysAhead,
    cutoff_date: cutoff,
    expiring_items: 3,
    total_estimated_waste_value: 4850,
    data: [
      {
        drug_name: "Azithromycin",
        brand_name: "Azithral 500",
        stock_qty: 70,
        expiry_date: "2026-03-18",
        days_left: 17,
        daily_demand: 3.5,
        units_consumed_before_expiry: 59,
        estimated_waste_units: 11,
        estimated_waste_value: 770,
        risk_level: "warning",
      },
      {
        drug_name: "Paracetamol",
        brand_name: "Dolo 650",
        stock_qty: 120,
        expiry_date: "2026-03-10",
        days_left: 9,
        daily_demand: 5.2,
        units_consumed_before_expiry: 47,
        estimated_waste_units: 73,
        estimated_waste_value: 2920,
        risk_level: "critical",
      },
      {
        drug_name: "Levocetirizine",
        brand_name: "Levocet",
        stock_qty: 90,
        expiry_date: "2026-04-12",
        days_left: 42,
        daily_demand: 1.7,
        units_consumed_before_expiry: 71,
        estimated_waste_units: 19,
        estimated_waste_value: 1160,
        risk_level: "low",
      },
    ],
  };
}
