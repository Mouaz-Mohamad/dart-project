import { describe, expect, it } from "vitest";
import {
  buildProductSitemap,
  productPathForModel,
  seoSlugPart,
} from "../src/modules/catalog/catalog.seo.js";

describe("catalog SEO sitemap", () => {
  it("keeps frontend-compatible stable product slugs", () => {
    expect(seoSlugPart("Cairo Wide Leg Jeans")).toBe("cairo-wide-leg-jeans");
    expect(productPathForModel({ modelId: "DW-101", name: "Cairo Wide Leg Jeans" }))
      .toBe("/products/cairo-wide-leg-jeans--dw-101");
    expect(productPathForModel({ modelId: "DR-7", name: "بنطلون شبابي" }))
      .toBe("/products/بنطلون-شبابي--dr-7");
  });

  it("builds an XML sitemap from public catalog models", () => {
    const xml = buildProductSitemap({
      models: [
        {
          modelId: "DW-101",
          name: "Cairo Wide Leg Jeans",
          updatedAt: "2026-10-02T12:00:00.000Z",
        },
        {
          modelId: "DR-7",
          name: "بنطلون شبابي & عصري",
          updatedAt: "2026-10-01T08:30:00.000Z",
        },
      ],
    });

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("https://dart-project-psi.vercel.app/products/cairo-wide-leg-jeans--dw-101");
    expect(xml).toContain(encodeURI("https://dart-project-psi.vercel.app/products/بنطلون-شبابي-عصري--dr-7"));
    expect(xml).toContain("<lastmod>2026-10-02T12:00:00.000Z</lastmod>");
    expect(xml).not.toContain("& عصري");
  });

  it("ignores malformed and duplicate public models", () => {
    const xml = buildProductSitemap({
      models: [
        { modelId: "A-1", name: "Basic Tee" },
        { modelId: "A-1", name: "Basic Tee" },
        { modelId: "", name: "Missing code" },
        { modelId: "B-2", name: "" },
      ],
    });
    expect((xml.match(/<url>/g) || []).length).toBe(1);
  });
});
