import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { normalizeEgyptianPhone } from "../../security/normalization.js";
export const BIRTHDAY_CONSENT_VERSION = "birthday-whatsapp-v1";
export const REVIEW_CONSENT_VERSION = "post-delivery-whatsapp-v1";
export class BirthdayMessagingService {
    constructor(private readonly pool: Pool, private readonly template: string) { }
    async preference(userId: string): Promise<{
        birthdayMarketing: boolean;
        consentVersion: string;
        postDeliveryReview: boolean;
        reviewConsentVersion: string;
    }> {
        const result = await this.pool.query<{
            birthday_marketing: boolean;
            post_delivery_review: boolean;
        }>(`SELECT
      (p.birthday_marketing AND p.consented_at IS NOT NULL AND p.consent_version=$2) AS birthday_marketing,
      (p.post_delivery_review AND p.review_consented_at IS NOT NULL AND p.review_consent_version=$3) AS post_delivery_review
      FROM customer_whatsapp_preferences p JOIN account_phones ph ON ph.user_id=p.customer_user_id
      AND ph.is_primary AND ph.phone_normalized=p.phone_normalized WHERE p.customer_user_id=$1`, [userId, BIRTHDAY_CONSENT_VERSION, REVIEW_CONSENT_VERSION]);
        return { birthdayMarketing: result.rows[0]?.birthday_marketing === true, consentVersion: BIRTHDAY_CONSENT_VERSION,
            postDeliveryReview: result.rows[0]?.post_delivery_review === true, reviewConsentVersion: REVIEW_CONSENT_VERSION };
    }
    async setPreference(userId: string, enabled: boolean, requestId: string, reviewEnabled?: boolean): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const phone = await client.query<{
                phone_normalized: string;
            }>(`SELECT phone_normalized FROM account_phones
        WHERE user_id=$1 AND is_primary AND account_type='customer' FOR SHARE`, [userId]);
            if (!phone.rows[0])
                throw new AppError(422, "CUSTOMER_PHONE_REQUIRED", "Save your phone number before changing WhatsApp preferences");
            await client.query(`INSERT INTO customer_whatsapp_preferences(customer_user_id,birthday_marketing,phone_normalized,consent_version,consented_at,
          post_delivery_review,review_consented_at,review_consent_version)
        VALUES($1,$2,$3,$4,CASE WHEN $2 THEN now() ELSE NULL END,COALESCE($5::boolean,false),CASE WHEN $5 THEN now() ELSE NULL END,$6)
        ON CONFLICT(customer_user_id) DO UPDATE SET birthday_marketing=$2,phone_normalized=$3,consent_version=$4,
          consented_at=CASE WHEN $2 THEN now() ELSE NULL END,
          post_delivery_review=COALESCE($5::boolean,CASE WHEN customer_whatsapp_preferences.phone_normalized=$3 THEN customer_whatsapp_preferences.post_delivery_review ELSE false END),
          review_consented_at=CASE WHEN $5::boolean IS NOT NULL THEN CASE WHEN $5 THEN now() ELSE NULL END
            WHEN customer_whatsapp_preferences.phone_normalized=$3 THEN customer_whatsapp_preferences.review_consented_at ELSE NULL END,
          review_consent_version=CASE WHEN $5::boolean IS NOT NULL THEN $6
            WHEN customer_whatsapp_preferences.phone_normalized=$3 THEN customer_whatsapp_preferences.review_consent_version ELSE NULL END,
          updated_at=now()`, [userId, enabled, phone.rows[0].phone_normalized, BIRTHDAY_CONSENT_VERSION, reviewEnabled ?? null, REVIEW_CONSENT_VERSION]);
            await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,new_values)
        VALUES('customer',$1::uuid,'BIRTHDAY_WHATSAPP_PREFERENCE_UPDATED','customer_whatsapp_preferences',$1::text,$2,$3::jsonb)`, [userId, requestId, JSON.stringify({ birthdayMarketing: enabled, consentVersion: BIRTHDAY_CONSENT_VERSION,
            ...(reviewEnabled === undefined ? {} : { postDeliveryReview: reviewEnabled, reviewConsentVersion: REVIEW_CONSENT_VERSION }) })]);
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }

    async queueToday(): Promise<{ queued: number }> {
        if (!this.template) return { queued: 0 };
        // Account and manual dashboard clients are equally eligible when a birthday and phone exist.
        const result = await this.pool.query<{ ref: string; birthday_date: string }>(`
          WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS date)
          SELECT c.user_id::text AS ref,t.date::text AS birthday_date
          FROM customers c JOIN users u ON u.id=c.user_id
          JOIN account_phones ph ON ph.user_id=c.user_id AND ph.is_primary AND ph.account_type='customer'
          CROSS JOIN today t
          WHERE u.status='active' AND u.deleted_at IS NULL
            AND to_char(c.birthday,'MM-DD')=to_char(t.date,'MM-DD')
          UNION ALL
          SELECT COALESCE(NULLIF(p.data->>'clientId',''),NULLIF(p.data->>'id','')) AS ref,
                 t.date::text AS birthday_date
          FROM dashboard_domain_state d CROSS JOIN LATERAL jsonb_array_elements(d.data) AS p(data)
          CROSS JOIN today t
          WHERE d.domain='customers' AND p.data->>'birthday' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND substring(p.data->>'birthday' FROM 6 FOR 5)=to_char(t.date,'MM-DD')
            AND COALESCE(p.data->>'isDeleted','false')<>'true'
            AND COALESCE(p.data->>'isArchived','false')<>'true'
          ORDER BY ref LIMIT 200`);
        if (!result.rows.length) return { queued: 0 };
        return this.queue([...new Set(result.rows.map(row => row.ref).filter(Boolean))].slice(0,100),
          result.rows[0]!.birthday_date, null, "whatsapp-auto-birthday");
    }
        async queue(customerRefs: string[], birthdayDate: string, actorId: string | null, requestId: string) {
        if (!this.template)
            throw new AppError(503, "BIRTHDAY_TEMPLATE_NOT_CONFIGURED", "Configure the approved birthday WhatsApp template before sending");
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const window = await client.query<{
                allowed: boolean;
            }>(`SELECT ($1::date=(now() AT TIME ZONE 'Africa/Cairo')::date OR
        ($1::date=(now() AT TIME ZONE 'Africa/Cairo')::date+1 AND EXTRACT(HOUR FROM now() AT TIME ZONE 'Africa/Cairo')>=20)) AS allowed`, [birthdayDate]);
            if (!window.rows[0]?.allowed)
                throw new AppError(422, "BIRTHDAY_DATE_INVALID", "Select today's birthday batch, or tomorrow's after 8 PM Cairo");
            // Match the existing domain lock order before modifying either projection.
            await client.query(`SELECT domain FROM dashboard_domain_state WHERE domain IN ('birthday_messages','message_queue') ORDER BY domain FOR UPDATE`);
            const settings = await client.query<{
                data: Record<string, unknown>;
            }>("SELECT data FROM site_settings WHERE id='main'");
            const percent = Math.max(0, Math.min(100, Number(settings.rows[0]?.data.birthdayDiscountPercent ?? 30)));
            const accounts = await client.query<{
                user_id: string; client_code: string; full_name: string; phone_normalized: string;
            }>(`
              SELECT c.user_id::text,c.client_code,c.full_name,ph.phone_normalized
              FROM customers c JOIN users u ON u.id=c.user_id
              JOIN account_phones ph ON ph.user_id=c.user_id AND ph.is_primary AND ph.account_type='customer'
              WHERE (c.user_id::text=ANY($1::text[]) OR c.client_code=ANY($1::text[]))
                AND u.status='active' AND u.deleted_at IS NULL
                AND to_char(c.birthday,'MM-DD')=to_char($2::date,'MM-DD')
              ORDER BY c.user_id FOR SHARE OF c,u,ph`, [customerRefs,birthdayDate]);
            const manual = await client.query<{
                user_id: null; client_code: string; full_name: string; phone_normalized: string;
            }>(`
              SELECT NULL::text AS user_id,
                COALESCE(NULLIF(p.data->>'clientId',''),NULLIF(p.data->>'id','')) AS client_code,
                COALESCE(NULLIF(p.data->>'clientName',''),'Dart customer') AS full_name,
                p.data->>'phone1' AS phone_normalized
              FROM dashboard_domain_state d CROSS JOIN LATERAL jsonb_array_elements(d.data) AS p(data)
              WHERE d.domain='customers'
                AND (p.data->>'clientId'=ANY($1::text[]) OR p.data->>'id'=ANY($1::text[]))
                AND p.data->>'birthday' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                AND substring(p.data->>'birthday' FROM 6 FOR 5)=to_char($2::date,'MM-DD')
                AND COALESCE(p.data->>'isDeleted','false')<>'true'
                AND COALESCE(p.data->>'isArchived','false')<>'true'`,
              [customerRefs,birthdayDate]);
            // Prefer registered account data when a phone appears in both projections.
            const recipients = [...accounts.rows,...manual.rows];
            const matched = new Set(recipients.flatMap(row => [row.user_id,row.client_code].filter(Boolean)));
            const skipped: string[] = customerRefs.filter(ref => !matched.has(ref));
            const seenPhones = new Set<string>();
            let queued = 0, alreadyQueued = 0;
            for (const row of recipients) {
                let phone: string;
                try { phone=normalizeEgyptianPhone(row.phone_normalized || ""); }
                catch { skipped.push(row.client_code); continue; }
                if (seenPhones.has(phone)) { alreadyQueued++; continue; }
                seenPhones.add(phone);
                // Respect a customer's explicit opt-out, but do not require an online account or opt-in row.
                if (row.user_id) {
                    const optedOut = await client.query<{ denied: boolean }>(`
                      SELECT EXISTS(SELECT 1 FROM customer_whatsapp_preferences
                        WHERE customer_user_id=$1 AND NOT birthday_marketing
                          AND consent_version=$2) AS denied`,
                      [row.user_id,BIRTHDAY_CONSENT_VERSION]);
                    if (optedOut.rows[0]?.denied) { skipped.push(row.client_code); continue; }
                }
                const existing = await client.query<{ already: boolean }>(`
                  SELECT EXISTS(SELECT 1 FROM outbox_events
                    WHERE event_type='CUSTOMER_BIRTHDAY_MESSAGE'
                      AND payload->>'to'=$1 AND payload->>'birthdayDate'=$2) AS already`,
                  [phone,birthdayDate]);
                if (existing.rows[0]?.already) { alreadyQueued++; continue; }
                const id=randomUUID(), key=`birthday:${phone}:${birthdayDate}`;
                const recordId=`BDAY-${birthdayDate}-${row.client_code}`;
                const inserted=await client.query<{ id: string }>(`
                  INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,deduplication_key,available_at)
                  VALUES($1,'customer',$2,'CUSTOMER_BIRTHDAY_MESSAGE',$3::jsonb,$4,
                    ($5::date+time '13:00') AT TIME ZONE 'Africa/Cairo')
                  ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
                  RETURNING id::text`,
                  [id,row.user_id || row.client_code,JSON.stringify({channel:"whatsapp",to:phone,
                    template:this.template,birthdayDate,category:"marketing",
                    parameters:[row.full_name,String(percent),"7"]}),key,birthdayDate]);
                if (!inserted.rows.length) { alreadyQueued++; continue; }
                const record={id:recordId,messageKey:key,clientId:row.client_code,
                    customerRecordId:row.user_id || null,birthdayDate,outboxEventId:id,
                    queuedAt:new Date().toISOString(),status:"Queued",channel:"whatsapp"};
                for (const domain of ["birthday_messages","message_queue"])
                    await client.query(`INSERT INTO message_records(domain,record_id,position,payload)
                      VALUES($1,$2,0,$3::jsonb)
                      ON CONFLICT(domain,record_id)
                      DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,
                      [domain,recordId,JSON.stringify(record)]);
                queued++;
            }
            if (!queued && !alreadyQueued)
                throw new AppError(422, "BIRTHDAY_RECIPIENTS_NOT_ELIGIBLE", "No eligible customers with recorded WhatsApp birthday consent were selected");
            if (queued)
                await client.query(`UPDATE dashboard_domain_state SET version=version+1,updated_by=$1,updated_at=now()
        WHERE domain IN ('birthday_messages','message_queue')`, [actorId]);
            await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
        VALUES(CASE WHEN $1::uuid IS NULL THEN 'system' ELSE 'staff' END,$1,'BIRTHDAY_MESSAGES_QUEUED','messaging',$2,$3,$4::jsonb)`, [actorId, birthdayDate, requestId, JSON.stringify({ queued, alreadyQueued, skipped: skipped.length, category: 'marketing' })]);
            await client.query("COMMIT");
            return { queued, alreadyQueued, skipped };
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
}
