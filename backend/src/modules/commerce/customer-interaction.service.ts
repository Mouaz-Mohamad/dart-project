import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

type JsonRow = Record<string, unknown>;

interface CustomerIdentity {
  userId: string;
  clientCode: string;
  name: string;
  email: string;
  phone1: string;
  phone2: string;
}

export interface ContactInput {
  fullName: string;
  email: string;
  phone1: string;
  phone2?: string;
  message: string;
}

export interface ReviewInput {
  rating: number;
  title: string;
  review: string;
}

export interface ReturnInput {
  itemCode: string;
  requestType: "Refund" | "Exchange";
  reason: string;
  notes?: string;
  requestedColor?: string;
  requestedSize?: string;
  address: {
    country: string;
    governorate: "Cairo" | "Giza";
    area: string;
    street: string;
    building: string;
    floor: string;
    latitude: number;
    longitude: number;
    fullAddress?: string;
    addressSource?: string;
  };
}

export class CustomerInteractionService {
  constructor(private readonly pool: Pool) {}

  async submitContact(input: ContactInput, requestId: string): Promise<{ id: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const now = new Date().toISOString();
      const record: JsonRow = {
        id,
        source: "Contact Us",
        recordType: "contact",
        clientId: "-",
        clientName: input.fullName,
        rating: "-",
        title: "-",
        review: input.message,
        phone1: input.phone1,
        phone2: input.phone2 || "-",
        email: input.email,
        status: "-",
        date: now,
        createdAt: now,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      };
      await this.appendDomain(client, "reviews", record);
      await this.appendNotification(client, {
        type: "contact_created",
        title: "New contact message",
        message: `${input.fullName} sent a Contact Us message.`,
        relatedEntityType: "reviews",
        relatedEntityId: id,
        severity: "info",
      });
      await client.query(
        `INSERT INTO audit_logs (
          actor_type, action, entity_type, entity_id, request_id, metadata
        ) VALUES ('system','CONTACT_CREATED','reviews',$1,$2,$3::jsonb)`,
        [id, requestId, JSON.stringify({ source: "Contact Us" })],
      );
      await client.query("COMMIT");
      return { id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submitReview(
    customerUserId: string,
    input: ReviewInput,
    requestId: string,
  ): Promise<{ id: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await this.customerIdentity(client, customerUserId);
      const delivered = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM orders
           WHERE customer_user_id=$1 AND status='Delivered' AND NOT is_deleted
         ) AS exists`,
        [customerUserId],
      );
      if (!delivered.rows[0]?.exists) {
        throw new AppError(403, "REVIEW_NOT_ELIGIBLE", "A delivered order is required before submitting a review");
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const record: JsonRow = {
        id,
        source: "Review",
        recordType: "review",
        clientId: identity.clientCode,
        clientName: identity.name,
        rating: input.rating,
        title: input.title,
        review: input.review,
        phone1: identity.phone1,
        phone2: identity.phone2 || "-",
        email: identity.email,
        status: "Pending",
        date: now,
        createdAt: now,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      };
      await this.appendDomain(client, "reviews", record);
      await this.appendNotification(client, {
        type: "review_created",
        title: "New customer review",
        message: `${identity.clientCode} submitted a review for moderation.`,
        relatedEntityType: "reviews",
        relatedEntityId: id,
        severity: "info",
      });
      await client.query(
        `INSERT INTO audit_logs (
          actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
        ) VALUES ('customer',$1,'REVIEW_CREATED','reviews',$2,$3,$4::jsonb)`,
        [customerUserId, id, requestId, JSON.stringify({ clientCode: identity.clientCode })],
      );
      await client.query("COMMIT");
      return { id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submitReturn(
    customerUserId: string,
    input: ReturnInput,
    requestId: string,
  ): Promise<{ id: string; returnId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await this.customerIdentity(client, customerUserId);

      const orderLine = await client.query<{
        order_id: string;
        order_code: string;
        delivered_at: Date | null;
        item_id: string;
        item_code: string;
        model_id: string;
        color: string;
        size: string;
        model_name: string;
        final_unit_minor: string;
      }>(
        `SELECT o.id::text AS order_id, o.order_code, o.delivered_at,
                oi.inventory_item_id AS item_id, oi.item_code, oi.model_id,
                oi.color, oi.size, oi.model_name, oi.final_unit_minor::text
           FROM orders o
           JOIN order_items oi ON oi.order_id=o.id
          WHERE o.customer_user_id=$1
            AND o.status='Delivered'
            AND NOT o.is_deleted
            AND oi.item_code=$2
          ORDER BY o.delivered_at DESC NULLS LAST, o.created_at DESC
          LIMIT 1
          FOR UPDATE OF o`,
        [customerUserId, input.itemCode],
      );
      const line = orderLine.rows[0];
      if (!line || !line.delivered_at) {
        throw new AppError(422, "RETURN_NOT_ELIGIBLE", "The item must belong to a delivered order");
      }
      if (Date.now() - line.delivered_at.getTime() > 14 * 86_400_000) {
        throw new AppError(422, "RETURN_WINDOW_EXPIRED", "The 14-day return window has expired");
      }

      const returnsState = await this.lockDomain(client, "returns");
      const existingReturns = returnsState.data;
      const hasOpen = existingReturns.some((raw) => {
        const row = raw as JsonRow;
        return String(row.itemCode || "") === input.itemCode
          && !row.isDeleted
          && !["Rejected","Closed","Completed","Good","Damaged","Bad"].includes(String(row.status || ""));
      });
      if (hasOpen) {
        throw new AppError(409, "RETURN_ALREADY_OPEN", "There is already an active request for this item");
      }
      const alreadyRefunded = existingReturns.some((raw) => {
        const row = raw as JsonRow;
        return String(row.itemCode || "") === input.itemCode
          && String(row.requestType || "") === "Refund"
          && !row.isDeleted
          && ["Completed","Good","Damaged","Bad"].includes(String(row.status || ""));
      });
      if (alreadyRefunded) {
        throw new AppError(409, "ITEM_ALREADY_REFUNDED", "This physical item has already been refunded");
      }

      let replacementCandidateCount = 0;
      if (input.requestType === "Exchange") {
        if (input.requestedColor !== line.color || input.requestedSize !== line.size) {
          throw new AppError(
            422,
            "EXCHANGE_VARIANT_MISMATCH",
            "Exchange is only allowed for the same color and size",
          );
        }
        const replacement = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM inventory_items
            WHERE model_id=$1 AND color=$2 AND size=$3
              AND active AND NOT is_archived AND NOT is_deleted
              AND lower(status)='in stock'`,
          [line.model_id, line.color, line.size],
        );
        replacementCandidateCount = Number(replacement.rows[0]?.count || 0);
        if (!replacementCandidateCount) {
          throw new AppError(409, "EXCHANGE_STOCK_UNAVAILABLE", "No replacement item is currently available");
        }
      }

      const sequence = await client.query<{ value: string }>(
        "SELECT nextval('dart_return_request_seq')::text AS value",
      );
      const returnId = `R-${sequence.rows[0]!.value}`;
      const id = randomUUID();
      const now = new Date().toISOString();
      const amount = Number(line.final_unit_minor) / 100;
      const record: JsonRow = {
        id,
        returnId,
        orderId: line.order_code,
        clientId: identity.clientCode,
        clientName: identity.name,
        itemCode: line.item_code,
        modelId: line.model_id,
        phone1: identity.phone1,
        phone2: identity.phone2 || "-",
        email: identity.email,
        requestType: input.requestType,
        reason: input.reason,
        status: "Pending Request",
        inspectionStatus: "Pending",
        notes: input.notes || "",
        originalLineSnapshot: {
          itemId: line.item_id,
          itemCode: line.item_code,
          modelCode: line.model_id,
          name: line.model_name,
          color: line.color,
          size: line.size,
          qty: 1,
          finalUnitPrice: amount,
        },
        originalNetAmount: amount,
        refundAmount: input.requestType === "Refund" ? amount : 0,
        exchangeValue: input.requestType === "Exchange" ? amount : 0,
        exchangeChainId: line.item_code,
        completedExchangesBeforeRequest: existingReturns.filter((raw) => {
          const row = raw as JsonRow;
          return String(row.exchangeChainId || row.itemCode || "") === line.item_code
            && String(row.requestType || "") === "Exchange"
            && ["Completed","Good","Damaged","Bad"].includes(String(row.status || ""));
        }).length,
        requestedColor: input.requestType === "Exchange" ? line.color : "",
        requestedSize: input.requestType === "Exchange" ? line.size : "",
        replacementCandidateCount,
        customerCourierFee: input.requestType === "Refund" ? 100 : 0,
        brandCourierFee: input.requestType === "Exchange" ? 50 : 0,
        courierFeePayer: input.requestType === "Refund" ? "Customer" : "Brand",
        customerCourierFeeStatus: input.requestType === "Refund" ? "Due to Representative" : "Not Applicable",
        brandCourierFeeStatus: input.requestType === "Exchange" ? "Due to Representative" : "Not Applicable",
        ...input.address,
        isPostDeliveryReturn: true,
        date: now,
        createdAt: now,
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      };

      await this.writeLockedDomain(client, "returns", returnsState.version, [...existingReturns, record]);
      await this.appendNotification(client, {
        type: "return_created",
        title: `Return ${returnId}`,
        message: `${line.item_code}: ${input.requestType} requested by customer.`,
        relatedEntityType: "returns",
        relatedEntityId: id,
        severity: "info",
      });
      await client.query(
        `INSERT INTO audit_logs (
          actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
        ) VALUES ('customer',$1,'RETURN_CREATED','returns',$2,$3,$4::jsonb)`,
        [customerUserId, id, requestId, JSON.stringify({ returnId, orderCode: line.order_code, itemCode: line.item_code })],
      );
      await client.query("COMMIT");
      return { id, returnId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async customerIdentity(client: PoolClient, userId: string): Promise<CustomerIdentity> {
    const result = await client.query<{
      user_id: string;
      client_code: string;
      full_name: string;
      email: string;
      phones: Array<{ phone_display: string; is_primary: boolean }>;
    }>(
      `SELECT c.user_id::text, c.client_code, c.full_name, u.email,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object('phone_display', p.phone_display, 'is_primary', p.is_primary)
                  ORDER BY p.is_primary DESC, p.created_at
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::jsonb
              ) AS phones
         FROM customers c
         JOIN users u ON u.id=c.user_id
         LEFT JOIN account_phones p ON p.user_id=c.user_id AND p.account_type='customer'
        WHERE c.user_id=$1
        GROUP BY c.user_id, c.client_code, c.full_name, u.email`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
    const phones = Array.isArray(row.phones) ? row.phones : [];
    return {
      userId: row.user_id,
      clientCode: row.client_code,
      name: row.full_name,
      email: row.email,
      phone1: phones.find((phone) => phone.is_primary)?.phone_display || phones[0]?.phone_display || "",
      phone2: phones.find((phone) => !phone.is_primary)?.phone_display || "",
    };
  }

  private async lockDomain(client: PoolClient, domain: string): Promise<{ version: number; data: unknown[] }> {
    const result = await client.query<{ version: string; data: unknown[] }>(
      "SELECT version::text, data FROM dashboard_domain_state WHERE domain=$1 FOR UPDATE",
      [domain],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(500, "DOMAIN_STATE_MISSING", `Missing dashboard domain: ${domain}`);
    return { version: Number(row.version), data: Array.isArray(row.data) ? row.data : [] };
  }

  private async writeLockedDomain(
    client: PoolClient,
    domain: string,
    version: number,
    data: unknown[],
  ): Promise<void> {
    await client.query(
      `UPDATE dashboard_domain_state
          SET data=$2::jsonb, version=$3, updated_at=now()
        WHERE domain=$1`,
      [domain, JSON.stringify(data), version + 1],
    );
  }

  private async appendDomain(client: PoolClient, domain: string, record: JsonRow): Promise<void> {
    const state = await this.lockDomain(client, domain);
    await this.writeLockedDomain(client, domain, state.version, [record, ...state.data]);
  }

  private async appendNotification(
    client: PoolClient,
    input: {
      type: string;
      title: string;
      message: string;
      relatedEntityType: string;
      relatedEntityId: string;
      severity: string;
    },
  ): Promise<void> {
    const record = {
      id: randomUUID(),
      ...input,
      timestamp: new Date().toISOString(),
      read: false,
      resolved: false,
    };
    await this.appendDomain(client, "notifications", record);
  }
}
