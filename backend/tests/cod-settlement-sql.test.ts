// DART CODE GUIDE | backend/tests/cod-settlement-sql.test.ts
// الغرض: يمنع رجوع خطأ PostgreSQL 42P08 عند حفظ تحصيل COD بسبب استنتاج أنواع parameters بشكل متعارض.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const financeSource = readFileSync(
  new URL("../src/modules/finance/finance.service.ts", import.meta.url),
  "utf8",
);

describe("COD settlement SQL parameter typing", () => {
  it("pins settlement amount parameters to bigint before assignment and comparison", () => {
    expect(financeSource).toContain("SET cod_settled_minor=$2::bigint,");
    expect(financeSource).toContain(
      "cod_settled_at=CASE WHEN $2::bigint >= $3::bigint THEN now() ELSE NULL END,",
    );
  });
});
