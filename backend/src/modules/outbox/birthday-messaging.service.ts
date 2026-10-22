import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
export const BIRTHDAY_CONSENT_VERSION = "birthday-whatsapp-v1";
export class BirthdayMessagingService {
    constructor(private readonly pool: Pool, private readonly template: string) { }
    async preference(userId: string): Promise<{
        birthdayMarketing: boolean;
        consentVersion: string;
    }> {
        const result = await this.pool.query<{
            birthday_marketing: boolean;
        }>(`SELECT
      (p.birthday_marketing AND p.consented_at IS NOT NULL AND p.consent_version=$2) AS birthday_marketing
      FROM customer_whatsapp_preferences p JOIN account_phones ph ON ph.user_id=p.customer_user_id
      AND ph.is_primary AND ph.phone_normalized=p.phone_normalized WHERE p.customer_user_id=$1`, [userId, BIRTHDAY_CONSENT_VERSION]);
        return { birthdayMarketing: result.rows[0]?.birthday_marketing === true, consentVersion: BIRTHDAY_CONSENT_VERSION };
    }
    async setPreference(userId: string, enabled: boolean, requestId: string): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const phone = await client.query<{
                phone_normalized: string;
            }>(`SELECT phone_normalized FROM account_phones
        WHERE user_id=$1 AND is_primary AND account_type='customer' FOR SHARE`, [userId]);
            if (!phone.rows[0])
                throw new AppError(422, "CUSTOMER_PHONE_REQUIRED", "Save your phone number before changing WhatsApp preferences");
            await client.query(`INSERT INTO customer_whatsapp_preferences(customer_user_id,birthday_marketing,phone_normalized,consent_version,consented_at)
        VALUES($1,$2,$3,$4,CASE WHEN $2 THEN now() ELSE NULL END)
        ON CONFLICT(customer_user_id) DO UPDATE SET birthday_marketing=$2,phone_normalized=$3,consent_version=$4,
          consented_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now()`, [userId, enabled, phone.rows[0].phone_normalized, BIRTHDAY_CONSENT_VERSION]);
            await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,new_values)
        VALUES('customer',$1::uuid,'BIRTHDAY_WHATSAPP_PREFERENCE_UPDATED','customer_whatsapp_preferences',$1::text,$2,$3::jsonb)`, [userId, requestId, JSON.stringify({ birthdayMarketing: enabled, consentVersion: BIRTHDAY_CONSENT_VERSION })]);
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
    async queue(customerRefs: string[], birthdayDate: string, actorId: string, requestId: string) {
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
            const customers = await client.query<{
                user_id: string;
                client_code: string;
                full_name: string;
                phone_normalized: string;
                consented: boolean;
            }>(`
        SELECT c.user_id::text,c.client_code,c.full_name,ph.phone_normalized,
          COALESCE(p.birthday_marketing AND p.phone_normalized=ph.phone_normalized AND p.consented_at IS NOT NULL AND p.consent_version=$3,false) AS consented
        FROM customers c JOIN users u ON u.id=c.user_id
        JOIN account_phones ph ON ph.user_id=c.user_id AND ph.is_primary AND ph.account_type='customer'
        LEFT JOIN customer_whatsapp_preferences p ON p.customer_user_id=c.user_id
        WHERE (c.user_id::text=ANY($1::text[]) OR c.client_code=ANY($1::text[]))
          AND u.status='active' AND u.deleted_at IS NULL
          AND to_char(c.birthday,'MM-DD')=to_char($2::date,'MM-DD') ORDER BY c.user_id FOR SHARE OF c,u,ph`, [customerRefs, birthdayDate, BIRTHDAY_CONSENT_VERSION]);
            let queued = 0, alreadyQueued = 0;
            const matched = new Set(customers.rows.flatMap(row => [row.user_id, row.client_code]));
            const skipped: string[] = customerRefs.filter(ref => !matched.has(ref));
            for (const row of customers.rows) {
                if (!row.consented) {
                    skipped.push(row.client_code);
                    continue;
                }
                const id = randomUUID(), key = `birthday:${row.user_id}:${birthdayDate}`, recordId = `BDAY-${birthdayDate}-${row.client_code}`;
                const inserted = await client.query<{
                    id: string;
                }>(`INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,deduplication_key,available_at)
          VALUES($1,'customer',$2,'CUSTOMER_BIRTHDAY_MESSAGE',$3::jsonb,$4,$5::date::timestamp AT TIME ZONE 'Africa/Cairo')
          ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING RETURNING id::text`, [id, row.user_id, JSON.stringify({ channel: "whatsapp", to: row.phone_normalized, template: this.template,
                        birthdayDate, category: "marketing", consentVersion: BIRTHDAY_CONSENT_VERSION, parameters: [row.full_name, String(percent), "7"] }), key, birthdayDate]);
                if (!inserted.rows.length) {
                    alreadyQueued += 1;
                    continue;
                }
                const record = { id: recordId, messageKey: key, clientId: row.client_code, customerRecordId: row.user_id,
                    birthdayDate, outboxEventId: id, queuedAt: new Date().toISOString(), status: "Queued", channel: "whatsapp" };
                for (const domain of ["birthday_messages", "message_queue"])
                    await client.query(`INSERT INTO message_records(domain,record_id,position,payload)
          VALUES($1,$2,0,$3::jsonb) ON CONFLICT(domain,record_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`, [domain, recordId, JSON.stringify(record)]);
                queued += 1;
            }
            if (!queued && !alreadyQueued)
                throw new AppError(422, "BIRTHDAY_RECIPIENTS_NOT_ELIGIBLE", "No eligible customers with recorded WhatsApp birthday consent were selected");
            if (queued)
                await client.query(`UPDATE dashboard_domain_state SET version=version+1,updated_by=$1,updated_at=now()
        WHERE domain IN ('birthday_messages','message_queue')`, [actorId]);
            await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
        VALUES('staff',$1,'BIRTHDAY_MESSAGES_QUEUED','messaging',$2,$3,$4::jsonb)`, [actorId, birthdayDate, requestId, JSON.stringify({ queued, alreadyQueued, skipped: skipped.length })]);
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
