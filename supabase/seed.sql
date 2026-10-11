-- Local development data only. Never run against a cloud project.
-- Logins (password123): owner@3dquote.local (owner), operator@3dquote.local (operator).

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'owner@3dquote.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'operator@3dquote.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

insert into public.staff (user_id, display_name, role, language) values
  ('00000000-0000-4000-8000-000000000001', 'Owner', 'owner', 'it'),
  ('00000000-0000-4000-8000-000000000002', 'Operator', 'operator', 'it');

update public.settings set
  shop_name = '3D Quote Lab',
  shop_email = 'info@3dquote.local',
  energy_price_kwh = 0.30,
  failure_allowance_pct = 5,
  setup_fee = 3.00,
  default_markup_pct = 40,
  minimum_item_price = 10.00
where id = 1;

insert into public.printers (name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w) values
  ('MK4 #1', 'Prusa MK4', 250, 210, 220, 1.50, 120),
  ('X1C #1', 'Bambu Lab X1 Carbon', 256, 256, 256, 2.00, 180);

insert into public.materials (name, type, color, density_g_cm3, cost_per_kg) values
  ('Prusament PLA Galaxy Black', 'PLA', 'Black', 1.24, 25.00),
  ('Prusament PETG Signal White', 'PETG', 'White', 1.27, 27.00),
  ('Generic TPU 95A', 'TPU', 'Red', 1.21, 35.00);

insert into public.clients (name, company, email) values
  ('Mario Rossi', 'Rossi Meccanica', 'mario.rossi@example.com');
