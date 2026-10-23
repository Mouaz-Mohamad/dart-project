// Read-only commerce projections; SQL and returned field shapes are preserved.
import type { Pool } from "pg";
import { readRelationalDashboardDomain } from "../dashboard/relational-domain.store.js";
import { adaptiveSuggestedStopOrder } from "./commerce.routing.js";

export async function readAdminLiveOperations(pool: Pool): Promise<{
    capturedAt: string;
    totals: {
      totalOrders: number;
      deliveredOrders: number;
      deliveringNow: number;
      activeRepresentatives: number;
    };
    representatives: Record<string, unknown>[];
    orders: Record<string, unknown>[];
  }> {
    const representativeResult = await pool.query<{
      representative_user_id: string;
      representative_code: string;
      representative_name: string;
      latitude: number | null;
      longitude: number | null;
      accuracy_meters: number | null;
      location_updated_at: Date | null;
      round_started_at: Date;
    }>(
      `WITH active_reps AS (
         SELECT representative_user_id,
                MIN(updated_at) AS round_started_at
           FROM orders
          WHERE representative_user_id IS NOT NULL
            AND status NOT IN ('Delivered','Cancelled','Refused','Returned')
            AND NOT is_deleted
            AND NOT is_archived
          GROUP BY representative_user_id
       )
       SELECT r.user_id::text AS representative_user_id,
              r.representative_code,
              r.full_name AS representative_name,
              rl.latitude,
              rl.longitude,
              rl.accuracy_meters,
              rl.updated_at AS location_updated_at,
              active_reps.round_started_at
         FROM active_reps
         JOIN representatives r ON r.user_id=active_reps.representative_user_id
         LEFT JOIN representative_locations rl
           ON rl.representative_user_id=r.user_id
        ORDER BY r.full_name`,
    );

    const representativeIds = representativeResult.rows.map(
      (row) => row.representative_user_id,
    );
    const ordersResult = await pool.query<{
      id: string;
      order_code: string;
      representative_user_id: string;
      status: string;
      contact_snapshot: Record<string, unknown>;
      delivery_address: Record<string, unknown>;
      final_minor: string;
      updated_at: Date;
      delivered_at: Date | null;
      route_state: string | null;
      sequence_number: number | null;
      manually_ordered: boolean;
      route_note: string | null;
    }>(
      `SELECT o.id::text,
              o.order_code,
              o.representative_user_id::text,
              o.status,
              o.contact_snapshot,
              o.delivery_address,
              o.final_minor::text,
              o.updated_at,
              o.delivered_at,
              drs.route_state,
              drs.sequence_number,
              COALESCE(drs.manually_ordered, false) AS manually_ordered,
              drs.note AS route_note
         FROM orders o
         LEFT JOIN delivery_route_stops drs
           ON drs.order_id=o.id
          AND drs.representative_user_id=o.representative_user_id
        WHERE o.representative_user_id = ANY($1::uuid[])
          AND NOT o.is_deleted
          AND NOT o.is_archived
        ORDER BY o.created_at`,
      [representativeIds],
    );

    const mapOrdersResult = await pool.query<{
      id: string;
      order_code: string;
      representative_user_id: string | null;
      representative_code: string | null;
      representative_name: string | null;
      status: string;
      contact_snapshot: Record<string, unknown>;
      delivery_address: Record<string, unknown>;
      final_minor: string;
      delivered_at: Date | null;
      route_state: string | null;
    }>(
      `SELECT o.id::text,
              o.order_code,
              o.representative_user_id::text,
              r.representative_code,
              r.full_name AS representative_name,
              o.status,
              o.contact_snapshot,
              o.delivery_address,
              o.final_minor::text,
              o.delivered_at,
              drs.route_state
         FROM orders o
         LEFT JOIN representatives r ON r.user_id=o.representative_user_id
         LEFT JOIN delivery_route_stops drs
           ON drs.order_id=o.id
          AND drs.representative_user_id=o.representative_user_id
        WHERE NOT o.is_deleted
          AND NOT o.is_archived
          AND o.status NOT IN ('Refused','Cancelled','Returned')
          AND (
            o.status <> 'Delivered'
            OR (o.delivered_at AT TIME ZONE 'Africa/Cairo')::date =
               (now() AT TIME ZONE 'Africa/Cairo')::date
          )
        ORDER BY o.created_at`,
    );

    const routeStateFor = (status: string, savedState: string | null): string =>
      status === "Delivered"
        ? "delivered"
        : status === "Representative On The Way"
          ? "current"
          : ["waiting", "problem"].includes(String(savedState || ""))
            ? String(savedState)
            : "upcoming";

    const mapOrders = mapOrdersResult.rows
      .filter((order) => !order.representative_user_id)
      .flatMap((order) => {
      const address = order.delivery_address || {};
      const latitude = Number(address.latitude);
      const longitude = Number(address.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const assigned = Boolean(order.representative_user_id);
      return [{
        id: order.id,
        orderId: order.order_code,
        status: order.status,
        routeState: routeStateFor(order.status, order.route_state),
        clientName: String(order.contact_snapshot?.name || "Customer"),
        country: String(address.country || ""),
        governorate: String(address.governorate || ""),
        area: String(address.area || ""),
        street: String(address.street || ""),
        building: String(address.building || ""),
        fullAddress: String(
          address.fullAddress ||
          [address.building, address.street, address.area, address.governorate, address.country]
            .filter(Boolean)
            .join(", "),
        ),
        latitude,
        longitude,
        finalAmount: Number(order.final_minor) / 100,
        deliveredAt: order.delivered_at?.toISOString() || null,
        assigned,
        representativeId: order.representative_user_id,
        representativeCode: order.representative_code,
        representativeName: order.representative_name,
      }];
      });

    const nowMs = Date.now();
    const representatives = representativeResult.rows.map((representative) => {
      const roundStartedAt = representative.round_started_at.getTime();
      const visible = ordersResult.rows.filter((order) => {
        if (order.representative_user_id !== representative.representative_user_id) return false;
        if (["Refused", "Cancelled", "Returned"].includes(order.status)) return false;
        if (order.status !== "Delivered") return true;
        const terminalAt = order.delivered_at?.getTime() ?? order.updated_at.getTime();
        return terminalAt >= roundStartedAt;
      });

      const normalizedStops = visible.map((order) => {
        const address = order.delivery_address || {};
        const latitude = Number(address.latitude);
        const longitude = Number(address.longitude);
        return {
          id: order.id,
          orderId: order.order_code,
          status: order.status,
          routeState: routeStateFor(order.status, order.route_state),
          sequenceNumber: Number(order.sequence_number ?? 0),
          manuallyOrdered: Boolean(order.manually_ordered),
          suggestedSequence: 0,
          note: order.route_note || "",
          clientName: String(order.contact_snapshot?.name || "Customer"),
          country: String(address.country || ""),
          governorate: String(address.governorate || ""),
          area: String(address.area || ""),
          street: String(address.street || ""),
          building: String(address.building || ""),
          fullAddress: String(
            address.fullAddress ||
            [address.building, address.street, address.area, address.governorate, address.country]
              .filter(Boolean)
              .join(", "),
          ),
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          finalAmount: Number(order.final_minor) / 100,
          deliveredAt: order.delivered_at?.toISOString() || null,
          assigned: true,
          representativeId: representative.representative_user_id,
          representativeCode: representative.representative_code,
          representativeName: representative.representative_name,
        };
      });

      const routable = normalizedStops.filter(
        (stop) =>
          ["current", "upcoming", "waiting", "problem"].includes(stop.routeState) &&
          stop.latitude !== null &&
          stop.longitude !== null,
      ) as Array<(typeof normalizedStops)[number] & { latitude: number; longitude: number }>;
      const suggested = adaptiveSuggestedStopOrder(
        representative.latitude,
        representative.longitude,
        routable,
      );
      const suggestedIndex = new Map(
        suggested.map((stop, index) => [stop.orderId, index + 1]),
      );
      normalizedStops.forEach((stop) => {
        stop.suggestedSequence = suggestedIndex.get(stop.orderId) || 0;
      });
      normalizedStops.sort((first, second) => {
        if (first.routeState === "current" && second.routeState !== "current") return -1;
        if (second.routeState === "current" && first.routeState !== "current") return 1;
        const firstActive = ["upcoming", "waiting", "problem"].includes(first.routeState);
        const secondActive = ["upcoming", "waiting", "problem"].includes(second.routeState);
        if (firstActive !== secondActive) return firstActive ? -1 : 1;
        if (firstActive && secondActive) {
          const firstSaved = first.manuallyOrdered && first.sequenceNumber > 0;
          const secondSaved = second.manuallyOrdered && second.sequenceNumber > 0;
          if (firstSaved !== secondSaved) return firstSaved ? -1 : 1;
          if (firstSaved && secondSaved) return first.sequenceNumber - second.sequenceNumber;
        }
        return Number(first.suggestedSequence || 9999) - Number(second.suggestedSequence || 9999);
      });

      const locationAgeMs = representative.location_updated_at
        ? Math.max(0, nowMs - representative.location_updated_at.getTime())
        : Number.POSITIVE_INFINITY;
      const connectionStatus =
        locationAgeMs <= 15_000
          ? "Online"
          : locationAgeMs <= 60_000
            ? "Location Stale"
            : "Offline";
      const current = normalizedStops.find((stop) => stop.routeState === "current") || null;
      const next = normalizedStops.find((stop) => stop.routeState === "upcoming") || null;

      return {
        id: representative.representative_user_id,
        repId: representative.representative_code,
        name: representative.representative_name,
        connectionStatus,
        lastLocationAt: representative.location_updated_at?.toISOString() || null,
        location: representative.latitude !== null && representative.longitude !== null
          ? {
              lat: representative.latitude,
              lng: representative.longitude,
              accuracy: representative.accuracy_meters,
            }
          : null,
        currentOrderId: current?.orderId || null,
        nextOrderId: next?.orderId || null,
        orders: normalizedStops,
      };
    });

    return {
      capturedAt: new Date().toISOString(),
      totals: {
        totalOrders: mapOrdersResult.rows.length,
        deliveredOrders: mapOrdersResult.rows.filter((order) => order.status === "Delivered").length,
        deliveringNow: mapOrdersResult.rows.filter((order) => order.status === "Representative On The Way").length,
        activeRepresentatives: representatives.length,
      },
      representatives,
      orders: mapOrders,
    };
  }

export async function readRepresentativeWork(pool: Pool, representativeUserId: string): Promise<{ orders: Record<string, unknown>[]; returns: Record<string, unknown>[] }> {
    const ordersResult = await pool.query<{
      id: string;
      order_code: string;
      status: string;
      payment_method: string;
      payment_status: string;
      final_minor: string;
      contact_snapshot: Record<string, unknown>;
      delivery_address: Record<string, unknown>;
      delivery_notes: string;
      created_at: Date;
      delivery_started_at: Date | null;
      route_state: string | null;
      sequence_number: number | null;
      manually_ordered: boolean;
      item_rows: Array<Record<string, unknown>>;
    }>(
      `SELECT o.id::text, o.order_code, o.status, o.payment_method, o.payment_status,
              o.final_minor::text, o.contact_snapshot, o.delivery_address,
              o.delivery_notes, o.created_at, o.delivery_started_at,
              drs.route_state, drs.sequence_number, COALESCE(drs.manually_ordered, false) AS manually_ordered,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'itemId', oi.inventory_item_id,
                    'itemCode', oi.item_code,
                    'modelCode', oi.model_id,
                    'name', oi.model_name,
                    'color', oi.color,
                    'size', oi.size,
                    'qty', 1,
                    'finalUnitPrice', oi.final_unit_minor / 100.0
                  )
                  ORDER BY oi.created_at
                )
                FROM order_items oi
                WHERE oi.order_id=o.id
              ), '[]'::jsonb) AS item_rows
         FROM orders o
         LEFT JOIN delivery_route_stops drs
           ON drs.order_id=o.id
          AND drs.representative_user_id=o.representative_user_id
        WHERE o.representative_user_id=$1
          AND NOT o.is_deleted
          AND NOT o.is_archived
          AND o.status NOT IN ('Delivered','Refused','Cancelled','Returned')
        ORDER BY o.created_at`,
      [representativeUserId],
    );

    const representative = await pool.query<{ representative_code: string }>(
      "SELECT representative_code FROM representatives WHERE user_id=$1",
      [representativeUserId],
    );
    const repCode = representative.rows[0]?.representative_code || "";
    const locationResult = await pool.query<{
      latitude: number | null;
      longitude: number | null;
    }>(
      "SELECT latitude, longitude FROM representative_locations WHERE representative_user_id=$1",
      [representativeUserId],
    );
    const representativeLocation = locationResult.rows[0] || {
      latitude: null,
      longitude: null,
    };

    const returnRows = await readRelationalDashboardDomain(
      pool,
      "returns",
    );
    const returns = returnRows.filter((raw) => {
      const row = raw as Record<string, unknown>;
      return (
        [representativeUserId, repCode].includes(String(row.representativeId || "")) &&
        !row.isDeleted &&
        !row.isArchived &&
        ["Representative Assigned", "Pickup On The Way"].includes(String(row.status || ""))
      );
    }) as Record<string, unknown>[];

    const suggested = adaptiveSuggestedStopOrder(
      representativeLocation.latitude,
      representativeLocation.longitude,
      ordersResult.rows.flatMap((row) => {
        const address = row.delivery_address || {};
        const latitude = Number(address.latitude);
        const longitude = Number(address.longitude);
        const routeState =
          row.status === "Representative On The Way"
            ? "current"
            : ["waiting", "problem"].includes(String(row.route_state || ""))
              ? String(row.route_state)
              : "upcoming";
        return Number.isFinite(latitude) && Number.isFinite(longitude)
          ? [{ orderId: row.order_code, latitude, longitude, routeState }]
          : [];
      }),
    );
    const suggestedSequence = new Map(
      suggested.map((stop, index) => [stop.orderId, index + 1]),
    );

    return {
      orders: ordersResult.rows.map((row) => {
        const contact = row.contact_snapshot || {};
        const address = row.delivery_address || {};
        return {
          id: row.id,
          orderId: row.order_code,
          status: row.status,
          paymentMethod: row.payment_method,
          paymentStatus: row.payment_status,
          finalAmount: Number(row.final_minor) / 100,
          clientName: contact.name || "Customer",
          phone1: contact.phone1 || "",
          phone2: contact.phone2 || "",
          email: contact.email || "",
          country: address.country || "",
          governorate: address.governorate || "",
          area: address.area || "",
          street: address.street || "",
          building: address.building || "",
          floor: address.floor || "",
          latitude: address.latitude || "",
          longitude: address.longitude || "",
          fullAddress: address.fullAddress || "",
          deliveryNotes: row.delivery_notes,
          createdAt: row.created_at.toISOString(),
          deliveryStartedAt: row.delivery_started_at?.toISOString() || null,
          routeState:
            row.status === "Representative On The Way"
              ? "current"
              : ["waiting", "problem"].includes(String(row.route_state || ""))
                ? String(row.route_state)
                : "upcoming",
          routeSequence: Number(row.sequence_number || 0),
          manuallyOrdered: Boolean(row.manually_ordered),
          suggestedSequence: suggestedSequence.get(row.order_code) || 0,
          priceSnapshot: row.item_rows || [],
          items: (row.item_rows || []).map((item) => item.itemCode),
        };
      }),
      returns,
    };
  }
