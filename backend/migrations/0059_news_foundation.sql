-- DART CODE GUIDE | backend/migrations/0059_news_foundation.sql
-- News is independent of stock/orders; drafts and archived records are staff-only.
CREATE TABLE news_articles (
  news_id TEXT PRIMARY KEY CHECK (news_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  excerpt TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 280),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 30000),
  cover_asset_id TEXT NOT NULL REFERENCES catalog_assets(asset_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  sort_order INTEGER CHECK (sort_order BETWEEN 0 AND 9999),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX news_public_order_idx ON news_articles(sort_order ASC NULLS LAST,published_at DESC,news_id)
  WHERE status='published' AND NOT is_archived;
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON news_articles FROM PUBLIC;
DO $$
DECLARE target_role TEXT;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON news_articles FROM %I',target_role);
    END IF;
  END LOOP;
END $$;
INSERT INTO permissions(key,description) VALUES
  ('news.read','Read and preview News, including drafts and archive'),
  ('news.manage','Create, edit, publish, order, archive and restore News')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.key IN ('news.read','news.manage')
WHERE r.name='Owner' ON CONFLICT DO NOTHING;
