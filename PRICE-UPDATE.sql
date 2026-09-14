-- Bestbite Enterprise: requested menu and delivery pricing update
-- Run this in Supabase SQL Editor once. Money values are stored in Naira.

update public.products set price = 1500, updated_at = now() where name = 'Bread';
update public.products set price = 800, updated_at = now() where name = 'Eggroll';
update public.products set price = 400, updated_at = now() where name = 'Bounce';
update public.products set price = 1500, updated_at = now() where name = 'Rice & Beans';
update public.products set price = 1500, updated_at = now() where name = 'Rice';
update public.products set price = 1000, updated_at = now() where name = 'Yam & Sauce';

insert into public.products (name, description, category, price, is_available)
select 'Eggroll', 'Freshly prepared eggroll', 'Breakfast', 800, true
where not exists (select 1 from public.products where name = 'Eggroll');

insert into public.products (name, description, category, price, is_available)
select 'Bounce', 'Freshly prepared Bounce snack', 'Breakfast', 400, true
where not exists (select 1 from public.products where name = 'Bounce');

insert into public.products (name, description, category, price, is_available)
select 'Rice', 'Freshly prepared rice', 'Rice & Beans', 1500, true
where not exists (select 1 from public.products where name = 'Rice');

-- Delivery fee is selected at checkout: ₦1,500 or ₦2,000 depending on the customer's location.
-- The backend validates the selected fee so customers cannot submit arbitrary delivery charges.
