// Execute the actual Brand SQL against isolated PostgreSQL, never production data.
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { FinanceService } from "../src/modules/finance/finance.service.js";

describe("Brand detail SQL", () => {
  it("reconciles each ledger and values stock/Waiting with complete, paginated server results", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE orders(id text PRIMARY KEY,order_code text,customer_user_id text,final_minor bigint,delivery_cost_minor bigint,
          payment_method text,payment_status text,amount_paid_minor bigint,amount_refunded_minor bigint,delivered_at timestamptz,updated_at timestamptz,status text);
        CREATE TABLE order_items(id text,order_id text,item_code text,model_id text,model_name text,color text,size text,cost_snapshot_minor bigint);
        CREATE TABLE catalog_models(model_id text,name text,selling_minor bigint,cost_minor bigint,discount_percent numeric,color_options jsonb,size_options jsonb,is_deleted boolean DEFAULT false);
        CREATE TABLE inventory_items(item_code text,cost_snapshot_minor bigint,model_id text,color text,size text,status text,active boolean,is_archived boolean DEFAULT false,is_deleted boolean DEFAULT false,created_at timestamptz);
        CREATE TABLE return_requests(record_id text,position int,payload jsonb);
        CREATE TABLE damage_records(record_id text,position int,payload jsonb);
        CREATE TABLE finance_records(domain text,record_id text,position int,payload jsonb);
        CREATE TABLE waitlist_entries(model_id text,desired_color text,size text,status text);
        CREATE TABLE set_waiting_entries(selections jsonb,status text);
        INSERT INTO orders VALUES ('o1','O1','c1',50001,0,'COD','Paid',50001,0,'2026-10-10T12:00Z','2026-10-10T12:00Z','Delivered');
        INSERT INTO order_items VALUES ('l1','o1','sold','M1','Hoodie','Black','M',12001);
        INSERT INTO catalog_models(model_id,name,selling_minor,cost_minor,discount_percent,color_options,size_options)
          VALUES ('M1','Hoodie',50001,12001,15,'["Black"]','["M"]');
        INSERT INTO inventory_items(item_code,cost_snapshot_minor,model_id,color,size,status,active,created_at) VALUES
          ('sold',12001,'M1','Black','M','Sold',true,'2026-10-01T12:00Z'),
          ('stock',13002,'M1','Black','M','In stock',true,'2026-09-01T12:00Z'),
          ('held',14003,'M1','Black','M','Cart reserved',true,'2026-09-01T12:00Z'),
          ('damaged',15004,'M1','Black','M','Damaged',true,'2026-10-01T12:00Z');
        INSERT INTO waitlist_entries VALUES ('M1','Black','M','waiting'),('M1','Black','M','cancelled');
        INSERT INTO set_waiting_entries VALUES ('[{"modelId":"M1","color":"Black","size":"M"},{"modelId":"M1","color":"Black","size":"M"}]','waiting');
        INSERT INTO finance_records VALUES ('finance_expenses','e1',1,'{"id":"e1","date":"2026-10-04","amount":10.01,"status":"Paid"}');
        INSERT INTO damage_records VALUES ('d1',1,'{"id":"d1","itemCode":"damaged","status":"Damaged","date":"2026-10-12","costSnapshot":150.04}');
        INSERT INTO return_requests VALUES ('r1',1,'{"id":"r1","orderId":"O1","itemCode":"sold","status":"Completed","completedAt":"2026-10-15","isPostDeliveryReturn":true,"requestType":"Refund","refundAmount":100.01}');
      `);
      const queries: string[] = [];
      const pool = { connect: async () => ({ query: async (sql: string, values: unknown[] = []) => {
        queries.push(sql); return db.query(sql, values);
      }, release() {} }) } as unknown as Pool;
      const service = new FinanceService(pool);
      const visibility = { costs: true, waiting: true, sales: true };
      for (const metric of ["sales", "cost", "damage", "profit"] as const) {
        const report = await service.brandDetails(metric, "2026-10-01", "2026-10-30", 1, 100, visibility);
        const ledger = report as { rows: Array<{ lane: string; amountMinor: number }>; totals: { amountMinor: number } };
        expect(ledger.rows.reduce((sum, row) => sum + (metric === "profit" && row.lane === "outgoing" ? -row.amountMinor : row.amountMinor), 0)).toBe(ledger.totals.amountMinor);
        if (metric !== "profit") expect(ledger.totals).not.toHaveProperty("incomeMinor");
      }
      const overview = await service.brandDetails("overview", "2026-10-01", "2026-10-30", 1, 100, visibility);
      expect(overview).toMatchObject({ totals: { pieces: 2, models: 1, costMinor: 27005, sellingMinor: 85002 }, top: { models: { waiting: 3, total: 4, sold: 0 } } });
      const limited = await service.brandDetails("cost", "2026-10-01", "2026-10-30", 2, 1, visibility);
      expect(limited).toMatchObject({ page: 2, limit: 1, total: 3 });
      expect((limited as { rows: unknown[] }).rows).toHaveLength(1);
      const restricted = await service.brandDetails("stockSelling", "2026-10-01", "2026-10-30", 1, 100, { costs: false, waiting: false, sales: false });
      expect(JSON.stringify(restricted)).not.toContain('"costMinor"');
      expect(queries.some((sql) => /UPDATE|INSERT|DELETE/.test(sql))).toBe(false);
      expect(queries.filter((sql) => sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).toHaveLength(7);
    } finally { await db.close(); }
  }, 20000);
});
