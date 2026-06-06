-- ============================================================================
-- Promote a user to admin (the coach / founder account).
--
-- 1. First sign up normally in the app with the email you want to be admin.
-- 2. Then run this in the Supabase SQL Editor, replacing the email below.
-- ============================================================================

update public.users
set role = 'admin'
where email = 'you@example.com';

-- Verify:
select id, email, full_name, role from public.users order by created_at;
