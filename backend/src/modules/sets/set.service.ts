// DART CODE GUIDE | backend/src/modules/sets/set.service.ts
// Server-authoritative CRUD/read model for Sets. Sets reference existing models; they never create inventory.
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import { applyPercentMinor, clampPercent } from "./set-pricing.js";

export interface SetComponentInput {
  modelId: string;
  quantity: number;
}

export interface SetWriteInput {
  setId: string;
  name: string;
  description: string;
  shortDescription?: string | undefined;
  showOnHomepage?: boolean | undefined;
  homepageOrder?: number | undefined;
  basePriceMinor: number;
  discountPercent: number;
  images: string[];
  components: SetComponentInput[];
}

interface ModelRow {
  model_id: string;
  name: string;
  category: string;
  description: string;
  cost_minor: string;
  selling_minor: string;
  size_options: unknown;
  color_options: unknown;
  active: boolean;
  is_archived: boolean;
  is_deleted: boolean;
}

interface SetRow {
  set_id: string;
  name: string;
  description: string;
  short_description: string;
  show_on_homepage: boolean;
  homepage_order: number;
  base_price_minor: string;
  discount_percent: string;
  images: unknown;
  active: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  version: string;
  created_at: Date;
  updated_at: Date;
}

function cleanId(value: unknown): string {
  return String(value || "").trim();
}

function safeImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30);
}

function normalizeComponents(value: SetComponentInput[]): SetComponentInput[] {
  const byModel = new Map<string, number>();
  for (const item of Array.isArray(value) ? value : []) {
    const modelId = cleanId(item?.modelId);
    const quantity = Math.max(1, Math.min(20, Math.trunc(Number(item?.quantity) || 1)));
    if (!modelId) continue;
    byModel.set(modelId, (byModel.get(modelId) || 0) + quantity);
  }
  return [...byModel.entries()].map(([modelId, quantity]) => ({ modelId, quantity }));
}

function finalMinor(basePriceMinor: number, discountPercent: number): number {
  return applyPercentMinor(basePriceMinor, discountPercent);
}

// Older clients can omit these fields on update without clearing the saved presentation.
function homepagePresentation(input: Partial<SetWriteInput>, before?: SetRow) {
  const shortDescription = String(input.shortDescription ?? before?.short_description ?? "").trim();
  const showOnHomepage = input.showOnHomepage ?? before?.show_on_homepage ?? false;
  const homepageOrder = input.homepageOrder ?? before?.homepage_order ?? 0;
  if (showOnHomepage && !safeImages(input.images).length) {
    throw new AppError(422, "SET_HOMEPAGE_IMAGE_REQUIRED", "Upload a Set image before showing it on the homepage");
  }
  return { shortDescription, showOnHomepage, homepageOrder };
}

export class SetService {
  public constructor(private readonly pool: Pool) {}

  private async lockKey(client: PoolClient, value: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:set:${value}`]);
  }

  private async modelsForComponents(
    client: PoolClient,
    components: SetComponentInput[],
  ): Promise<Map<string, ModelRow>> {
    const ids = components.map((row) => row.modelId);
    if (!ids.length) {
      throw new AppError(422, "SET_COMPONENTS_REQUIRED", "A Set must contain at least one model");
    }
    const rows = await client.query<ModelRow>(
      `SELECT model_id,name,category,description,cost_minor::text,selling_minor::text,
              size_options,color_options,active,is_archived,is_deleted
         FROM catalog_models
        WHERE model_id = ANY($1::text[])
        FOR SHARE`,
      [ids],
    );
    const map = new Map(rows.rows.map((row) => [row.model_id, row]));
    for (const component of components) {
      const model = map.get(component.modelId);
      if (!model || model.is_deleted) {
        throw new AppError(422, "SET_MODEL_NOT_FOUND", `Model ${component.modelId} does not exist`);
      }
    }
    return map;
  }

  private pricingSummary(
    row: Pick<SetRow, "base_price_minor" | "discount_percent">,
    components: SetComponentInput[],
    models: Map<string, ModelRow>,
  ) {
    const costTotalMinor = components.reduce(
      (sum, component) => sum + Number(models.get(component.modelId)?.cost_minor || 0) * component.quantity,
      0,
    );
    const componentsSellingTotalMinor = components.reduce(
      (sum, component) => sum + Number(models.get(component.modelId)?.selling_minor || 0) * component.quantity,
      0,
    );
    const basePriceMinor = Math.max(0, Number(row.base_price_minor || 0));
    const discountPercent = clampPercent(row.discount_percent);
    const setFinalMinor = finalMinor(basePriceMinor, discountPercent);
    return {
      costTotalMinor,
      componentsSellingTotalMinor,
      basePriceMinor,
      discountPercent,
      finalMinor: setFinalMinor,
      savingVsSeparateMinor: Math.max(0, componentsSellingTotalMinor - setFinalMinor),
      marginVsCostMinor: setFinalMinor - costTotalMinor,
      belowCost: setFinalMinor < costTotalMinor,
    };
  }

  private async assertBelowCostAllowed(
    client: PoolClient,
    actorId: string,
    finalPriceMinor: number,
    costTotalMinor: number,
  ): Promise<boolean> {
    if (finalPriceMinor >= costTotalMinor) return false;
    const result = await client.query<{ is_owner: boolean }>(
      "SELECT is_owner FROM staff_users WHERE user_id=$1 FOR SHARE",
      [actorId],
    );
    if (!result.rows[0]?.is_owner) {
      throw new AppError(
        403,
        "SET_BELOW_COST_OWNER_REQUIRED",
        "Only the protected Dart owner account can save a Set below its current cost",
      );
    }
    return true;
  }

  private componentView(
    components: SetComponentInput[],
    models: Map<string, ModelRow>,
    includeCost: boolean,
  ) {
    return components.map((component, position) => {
      const model = models.get(component.modelId)!;
      const unitCostMinor = Number(model.cost_minor || 0);
      const unitSellingMinor = Number(model.selling_minor || 0);
      return {
        modelId: model.model_id,
        name: model.name,
        category: model.category,
        description: model.description,
        quantity: component.quantity,
        position,
        sellingMinor: unitSellingMinor,
        ...(includeCost
          ? {
              costMinor: unitCostMinor,
              totalCostMinor: unitCostMinor * component.quantity,
            }
          : {}),
        sizes: Array.isArray(model.size_options) ? model.size_options : [],
        colors: Array.isArray(model.color_options) ? model.color_options : [],
        active: model.active && !model.is_archived && !model.is_deleted,
      };
    });
  }

  private async componentsForSet(
    client: PoolClient,
    setId: string,
  ): Promise<SetComponentInput[]> {
    const result = await client.query<{ model_id: string; quantity: number }>(
      `SELECT model_id,quantity
         FROM catalog_set_components
        WHERE set_id=$1
        ORDER BY position,id`,
      [setId],
    );
    return result.rows.map((row) => ({ modelId: row.model_id, quantity: Number(row.quantity) }));
  }

  private async viewSet(
    client: PoolClient,
    row: SetRow,
    includeCost: boolean,
  ) {
    const components = await this.componentsForSet(client, row.set_id);
    const models = await this.modelsForComponents(client, components);
    const pricing = this.pricingSummary(row, components, models);
    return {
      setId: row.set_id,
      name: row.name,
      category: "Sets",
      description: row.description,
      shortDescription: row.short_description,
      showOnHomepage: row.show_on_homepage,
      homepageOrder: Number(row.homepage_order),
      images: safeImages(row.images),
      active: row.active,
      isArchived: row.is_archived,
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      components: this.componentView(components, models, includeCost),
      pieceCount: components.reduce((sum, item) => sum + item.quantity, 0),
      pricing: includeCost
        ? pricing
        : {
            componentsSellingTotalMinor: pricing.componentsSellingTotalMinor,
            basePriceMinor: pricing.basePriceMinor,
            discountPercent: pricing.discountPercent,
            finalMinor: pricing.finalMinor,
            savingVsSeparateMinor: pricing.savingVsSeparateMinor,
          },
    };
  }

  public async publicSets() {
    const client = await this.pool.connect();
    try {
      const rows = await client.query<SetRow>(
        `SELECT set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                active,is_archived,is_deleted,version::text,created_at,updated_at
           FROM catalog_sets
          WHERE active AND NOT is_archived AND NOT is_deleted
          ORDER BY created_at DESC,set_id`,
      );
      const output = [];
      for (const row of rows.rows) output.push(await this.viewSet(client, row, false));
      return { sets: output };
    } finally {
      client.release();
    }
  }

  public async adminSets() {
    const client = await this.pool.connect();
    try {
      const rows = await client.query<SetRow>(
        `SELECT set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                active,is_archived,is_deleted,version::text,created_at,updated_at
           FROM catalog_sets
          WHERE NOT is_deleted
          ORDER BY created_at DESC,set_id`,
      );
      const output = [];
      for (const row of rows.rows) output.push(await this.viewSet(client, row, true));
      return { sets: output };
    } finally {
      client.release();
    }
  }

  public async publicSet(setId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<SetRow>(
        `SELECT set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                active,is_archived,is_deleted,version::text,created_at,updated_at
           FROM catalog_sets
          WHERE set_id=$1 AND active AND NOT is_archived AND NOT is_deleted`,
        [cleanId(setId)],
      );
      if (!result.rows[0]) throw new AppError(404, "SET_NOT_FOUND", "Set not found");
      return { set: await this.viewSet(client, result.rows[0], false) };
    } finally {
      client.release();
    }
  }

  public async createSet(actorId: string, input: SetWriteInput, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const setId = cleanId(input.setId);
      const components = normalizeComponents(input.components);
      await this.lockKey(client, setId);
      if (!setId || !/^[A-Za-z0-9_-]{1,120}$/.test(setId)) {
        throw new AppError(422, "SET_ID_INVALID", "Set ID must use letters, numbers, underscore or dash");
      }
      const models = await this.modelsForComponents(client, components);
      const basePriceMinor = Math.max(0, Math.trunc(Number(input.basePriceMinor) || 0));
      const discountPercent = clampPercent(input.discountPercent);
      const pricing = this.pricingSummary(
        { base_price_minor: String(basePriceMinor), discount_percent: String(discountPercent) },
        components,
        models,
      );
      const belowCostOverride = await this.assertBelowCostAllowed(
        client,
        actorId,
        pricing.finalMinor,
        pricing.costTotalMinor,
      );
      const homepage = homepagePresentation(input);
      const inserted = await client.query<SetRow>(
        `INSERT INTO catalog_sets(
           set_id,name,description,base_price_minor,discount_percent,images,
           short_description,show_on_homepage,homepage_order,created_by,updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10)
         RETURNING set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                   active,is_archived,is_deleted,version::text,created_at,updated_at`,
        [
          setId,
          String(input.name || "").trim(),
          String(input.description || "").trim(),
          basePriceMinor,
          discountPercent,
          JSON.stringify(safeImages(input.images)),
          homepage.shortDescription,
          homepage.showOnHomepage,
          homepage.homepageOrder,
          actorId,
        ],
      );
      for (let position = 0; position < components.length; position += 1) {
        const component = components[position]!;
        await client.query(
          `INSERT INTO catalog_set_components(set_id,model_id,quantity,position)
           VALUES ($1,$2,$3,$4)`,
          [setId, component.modelId, component.quantity, position],
        );
      }
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ('staff',$1,'SET_CREATED','sets',$2,$3,$4::jsonb)`,
        [actorId, setId, requestId, JSON.stringify({ pricing, belowCostOverride, components, homepage })],
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='sets'",
      );
      const view = await this.viewSet(client, inserted.rows[0]!, true);
      await client.query("COMMIT");
      return { set: view, belowCostOverride };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateSet(
    actorId: string,
    setIdInput: string,
    expectedVersion: number,
    input: Omit<SetWriteInput, "setId">,
    requestId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const setId = cleanId(setIdInput);
      await this.lockKey(client, setId);
      const current = await client.query<SetRow>(
        `SELECT set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                active,is_archived,is_deleted,version::text,created_at,updated_at
           FROM catalog_sets WHERE set_id=$1 AND NOT is_deleted FOR UPDATE`,
        [setId],
      );
      const before = current.rows[0];
      if (!before) throw new AppError(404, "SET_NOT_FOUND", "Set not found");
      if (Number(before.version) !== Number(expectedVersion)) {
        throw new AppError(409, "SET_VERSION_CONFLICT", "This Set changed in another session. Refresh and try again");
      }
      const components = normalizeComponents(input.components);
      const models = await this.modelsForComponents(client, components);
      const basePriceMinor = Math.max(0, Math.trunc(Number(input.basePriceMinor) || 0));
      const discountPercent = clampPercent(input.discountPercent);
      const pricing = this.pricingSummary(
        { base_price_minor: String(basePriceMinor), discount_percent: String(discountPercent) },
        components,
        models,
      );
      const belowCostOverride = await this.assertBelowCostAllowed(
        client,
        actorId,
        pricing.finalMinor,
        pricing.costTotalMinor,
      );
      const homepage = homepagePresentation(input, before);
      const updated = await client.query<SetRow>(
        `UPDATE catalog_sets
            SET name=$2,description=$3,base_price_minor=$4,discount_percent=$5,images=$6::jsonb,
                short_description=$7,show_on_homepage=$8,homepage_order=$9,
                version=version+1,updated_by=$10,updated_at=now()
          WHERE set_id=$1
          RETURNING set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                    active,is_archived,is_deleted,version::text,created_at,updated_at`,
        [
          setId,
          String(input.name || "").trim(),
          String(input.description || "").trim(),
          basePriceMinor,
          discountPercent,
          JSON.stringify(safeImages(input.images)),
          homepage.shortDescription,
          homepage.showOnHomepage,
          homepage.homepageOrder,
          actorId,
        ],
      );
      await client.query("DELETE FROM catalog_set_components WHERE set_id=$1", [setId]);
      for (let position = 0; position < components.length; position += 1) {
        const component = components[position]!;
        await client.query(
          `INSERT INTO catalog_set_components(set_id,model_id,quantity,position)
           VALUES ($1,$2,$3,$4)`,
          [setId, component.modelId, component.quantity, position],
        );
      }
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ('staff',$1,'SET_UPDATED','sets',$2,$3,$4::jsonb)`,
        [
          actorId,
          setId,
          requestId,
          JSON.stringify({
            previousVersion: Number(before.version), pricing, belowCostOverride, components,
            homepage: {
              before: {
                shortDescription: before.short_description,
                showOnHomepage: before.show_on_homepage,
                homepageOrder: before.homepage_order,
              },
              after: homepage,
            },
          }),
        ],
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='sets'",
      );
      const view = await this.viewSet(client, updated.rows[0]!, true);
      await client.query("COMMIT");
      return { set: view, belowCostOverride };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async setState(
    actorId: string,
    setIdInput: string,
    action: "archive" | "restore",
    expectedVersion: number,
    requestId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const setId = cleanId(setIdInput);
      await this.lockKey(client, setId);
      const result = await client.query<SetRow>(
        `UPDATE catalog_sets
            SET is_archived=$2,active=CASE WHEN $2 THEN false ELSE true END,
                version=version+1,updated_by=$3,updated_at=now()
          WHERE set_id=$1 AND version=$4 AND NOT is_deleted
          RETURNING set_id,name,description,short_description,show_on_homepage,homepage_order,
                base_price_minor::text,discount_percent::text,images,
                    active,is_archived,is_deleted,version::text,created_at,updated_at`,
        [setId, action === "archive", actorId, expectedVersion],
      );
      if (!result.rows[0]) {
        const exists = await client.query("SELECT 1 FROM catalog_sets WHERE set_id=$1 AND NOT is_deleted", [setId]);
        if (!exists.rowCount) throw new AppError(404, "SET_NOT_FOUND", "Set not found");
        throw new AppError(409, "SET_VERSION_CONFLICT", "This Set changed in another session. Refresh and try again");
      }
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ('staff',$1,$2,'sets',$3,$4,$5::jsonb)`,
        [actorId, action === "archive" ? "SET_ARCHIVED" : "SET_RESTORED", setId, requestId, JSON.stringify({ expectedVersion })],
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='sets'",
      );
      const view = await this.viewSet(client, result.rows[0], true);
      await client.query("COMMIT");
      return { set: view };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async discountSettings() {
    const result = await this.pool.query<{
      birthday_percent: string;
      dart_card_percent: string;
      version: string;
      updated_at: Date;
    }>(
      `SELECT birthday_percent::text,dart_card_percent::text,version::text,updated_at
         FROM set_discount_settings WHERE id='main'`,
    );
    const row = result.rows[0];
    return {
      birthdayPercent: Number(row?.birthday_percent || 10),
      dartCardPercent: Number(row?.dart_card_percent || 10),
      version: Number(row?.version || 1),
      updatedAt: row?.updated_at || null,
    };
  }

  public async updateDiscountSettings(
    actorId: string,
    expectedVersion: number,
    birthdayPercent: number,
    dartCardPercent: number,
    requestId: string,
  ) {
    const result = await this.pool.query<{
      birthday_percent: string;
      dart_card_percent: string;
      version: string;
      updated_at: Date;
    }>(
      `UPDATE set_discount_settings
          SET birthday_percent=$2,dart_card_percent=$3,version=version+1,updated_by=$4,updated_at=now()
        WHERE id='main' AND version=$1
        RETURNING birthday_percent::text,dart_card_percent::text,version::text,updated_at`,
      [expectedVersion, clampPercent(birthdayPercent), clampPercent(dartCardPercent), actorId],
    );
    if (!result.rows[0]) {
      throw new AppError(409, "SET_SETTINGS_VERSION_CONFLICT", "Set discount settings changed in another session. Refresh and try again");
    }
    const row = result.rows[0];
    await this.pool.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
       VALUES ('staff',$1,'SET_DISCOUNT_SETTINGS_UPDATED','set_settings','main',$2,$3::jsonb)`,
      [
        actorId,
        requestId,
        JSON.stringify({ birthdayPercent: Number(row.birthday_percent), dartCardPercent: Number(row.dart_card_percent) }),
      ],
    );
    return {
      birthdayPercent: Number(row.birthday_percent),
      dartCardPercent: Number(row.dart_card_percent),
      version: Number(row.version),
      updatedAt: row.updated_at,
    };
  }
}
