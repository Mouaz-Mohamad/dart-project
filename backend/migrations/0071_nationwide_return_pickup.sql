-- Expand pickup locations without changing existing returns or checkout policy.
SET LOCAL lock_timeout = '3s';
ALTER TABLE return_requests
  DROP CONSTRAINT return_requests_governorate_typed_check,
  ADD CONSTRAINT return_requests_governorate_typed_check CHECK (
    pickup_governorate IN ('', 'Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Sharqia', 'Dakahlia',
      'Gharbia', 'Monufia', 'Beheira', 'Kafr El Sheikh', 'Damietta', 'Port Said',
      'Ismailia', 'Suez', 'North Sinai', 'South Sinai', 'Red Sea', 'Fayoum',
      'Beni Suef', 'Minya', 'Assiut', 'Sohag', 'Qena', 'Luxor', 'Aswan', 'New Valley', 'Matrouh')
  ) NOT VALID;
