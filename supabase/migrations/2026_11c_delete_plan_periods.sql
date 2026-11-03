-- Lets signed-in staff delete a plan period and its hours blocks from Maintenance & Hours (Edit plan period > Delete period).
-- Safe to run more than once. Only needed if the delete in the app says "the database refused".
-- If your tables don't have row level security turned on, nothing here changes behaviour.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'maintenance_plan_period' and cmd = 'DELETE') then
    execute 'create policy "Staff delete plan periods" on public.maintenance_plan_period for delete to authenticated using (public.ol_is_staff())';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hours_grant' and cmd = 'DELETE') then
    execute 'create policy "Staff delete hours grants" on public.hours_grant for delete to authenticated using (public.ol_is_staff())';
  end if;
end $$;
