-- Optional starter data. Run after the migration, in the SQL editor.
-- On the original Watchbird project your devices already exist, so only the
-- farms are added; link devices to them in Admin -> Devices.
-- On a fresh project, load telemetry with bird_data_300m_dist.sql (device 3).

insert into public.farms (id, name, location_name, center_lat, center_lng) values
  ('6a1c1d1e-0000-4000-8000-000000000001', 'DeKUT Demo Plot', 'Nyeri, KE', -0.3981, 36.9616),
  ('6a1c1d1e-0000-4000-8000-000000000002', 'Nairobi Test Field', 'Nairobi, KE', -1.2638, 36.8420)
on conflict (id) do nothing;

insert into public."Devices" ("Device_id", "Device_name", "Status", "Color_1", "Color_2", farm_id, kind) values
  (1, 'wb_1', 'Active', '#34b36b', '#34b36b', '6a1c1d1e-0000-4000-8000-000000000001', 'Livestock'),
  (2, 'wb_2', 'Active', '#3aa0d8', '#3aa0d8', '6a1c1d1e-0000-4000-8000-000000000001', 'Livestock'),
  (3, 'wb_3', 'Active', '#e8a317', '#e8a317', '6a1c1d1e-0000-4000-8000-000000000002', 'Bird'),
  (4, 'wb_4', 'Active', '#c45ab3', '#c45ab3', '6a1c1d1e-0000-4000-8000-000000000001', 'ESP32 tracker (firmware Device_id = 4)')
on conflict ("Device_id") do nothing;

-- After you sign up in the web app, make yourself admin:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
