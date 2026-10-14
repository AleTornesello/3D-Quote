-- Column-level write grant for the new setting, like the others in grants_and_setup (owners only, through RLS).
grant update (vat_rate_pct) on public.settings to authenticated;
