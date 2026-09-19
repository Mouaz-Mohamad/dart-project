import type { PoolClient } from "pg";

export interface DevelopmentSeeder {
  name: string;
  run: (client: PoolClient) => Promise<void>;
}

export const developmentSeeders: DevelopmentSeeder[] = [
  {
    name: "foundation-audit-marker",
    async run(client) {
      await client.query(
        `
          INSERT INTO audit_logs (
            id,
            actor_type,
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES (
            '00000000-0000-4000-8000-000000000001',
            'system',
            'DEVELOPMENT_SEED_APPLIED',
            'system',
            'development-seed',
            '{"synthetic": true, "productionAllowed": false}'::jsonb
          )
          ON CONFLICT (id) DO NOTHING
        `,
      );
    },
  },
];
