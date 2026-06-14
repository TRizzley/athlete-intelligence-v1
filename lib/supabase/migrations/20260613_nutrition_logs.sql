-- ----------------------------------------------------------------------------
-- Migration: nutrition_logs
--
-- Stores individual food entries logged by athletes via Nutritionix natural
-- language parsing or manual entry. Daily totals are aggregated and synced
-- into daily_checkins (calories, protein_g, carbs_g, fat_g) by the server
-- action syncNutritionToCheckin().
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date              date        NOT NULL,
  food_name             text        NOT NULL,
  brand_name            text,
  nix_item_id           text,                    -- Nutritionix branded item ID (null for common foods)
  serving_qty           numeric     NOT NULL,
  serving_unit          text        NOT NULL,
  serving_weight_grams  numeric,
  calories              numeric     NOT NULL,
  protein_g             numeric,
  carbs_g               numeric,
  fat_g                 numeric,
  fiber_g               numeric,
  sodium_mg             numeric,
  meal_type             text        CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  raw_input             text,                    -- original natural language string the user typed
  source                text        NOT NULL DEFAULT 'nutritionix',  -- 'nutritionix' | 'manual'
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Index for fast per-user per-date queries (the most common access pattern)
CREATE INDEX IF NOT EXISTS nutrition_logs_user_date_idx
  ON nutrition_logs (user_id, log_date DESC);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;

-- Athletes can only read their own logs
CREATE POLICY "nutrition_logs_select_own"
  ON nutrition_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Athletes can insert their own logs
CREATE POLICY "nutrition_logs_insert_own"
  ON nutrition_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Athletes can delete their own logs
CREATE POLICY "nutrition_logs_delete_own"
  ON nutrition_logs FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypasses RLS automatically — no extra policy needed.

-- ----------------------------------------------------------------------------
-- Helper: daily nutrition totals
--
-- Returns aggregated macros for a user on a given date. Used by
-- syncNutritionToCheckin() and the dashboard summary card.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_daily_nutrition_totals(
  p_user_id uuid,
  p_date    date
)
RETURNS TABLE (
  total_calories  numeric,
  total_protein_g numeric,
  total_carbs_g   numeric,
  total_fat_g     numeric,
  total_fiber_g   numeric,
  meal_count      bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM(calories), 0)   AS total_calories,
    COALESCE(SUM(protein_g), 0)  AS total_protein_g,
    COALESCE(SUM(carbs_g), 0)    AS total_carbs_g,
    COALESCE(SUM(fat_g), 0)      AS total_fat_g,
    COALESCE(SUM(fiber_g), 0)    AS total_fiber_g,
    COUNT(*)                      AS meal_count
  FROM nutrition_logs
  WHERE user_id = p_user_id
    AND log_date = p_date;
$$;
