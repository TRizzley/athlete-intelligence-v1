-- ---------------------------------------------------------------------------
-- sync-role-to-jwt.sql
--
-- Stores the user's role in auth.users.raw_app_meta_data so it is embedded
-- in the JWT. This eliminates the second DB round-trip in requireAdmin() /
-- checkAdmin() — the role is readable from user.app_metadata.role immediately
-- after supabase.auth.getUser(), with no extra query.
--
-- Run once against your Supabase project (SQL Editor or psql).
-- Safe to re-run; uses CREATE OR REPLACE + DROP IF EXISTS.
-- ---------------------------------------------------------------------------

-- 1. Function: copies role from public.users → auth.users app_metadata.
CREATE OR REPLACE FUNCTION public.sync_user_role_to_jwt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb) ||
    jsonb_build_object('role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- 2. Trigger: fires on INSERT or role UPDATE in public.users.
DROP TRIGGER IF EXISTS on_user_role_change ON public.users;
CREATE TRIGGER on_user_role_change
  AFTER INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_role_to_jwt();

-- 3. Backfill: sync roles for all existing users immediately.
UPDATE auth.users au
SET raw_app_meta_data =
  COALESCE(au.raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object('role', u.role)
FROM public.users u
WHERE au.id = u.id
  AND u.role IS NOT NULL;
