-- Assignment is reversible preparation. Existing outbound orders stay outbound;
-- migration never creates notification events for historical dispatches.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'New','Accepted','Preparing','Ready for Dispatch','Out With Representative',
  'Representative On The Way','Delivered','Refused','Cancelled','Returned','Needs Attention'
));
