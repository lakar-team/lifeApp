-- ============================================
-- ADAMTOOL — Seed Data
-- Run this AFTER schema.sql
-- ============================================

-- Categories
insert into app_categories (name, slug, icon) values
  ('All Tools',  'all',       'grid-2x2'),
  ('AI',         'ai',        'brain'),
  ('Finance',    'finance',   'trending-up'),
  ('Utilities',  'utilities', 'wrench'),
  ('Islamic',    'islamic',   'book-open')
on conflict (slug) do nothing;

-- Apps
insert into apps (slug, name, description, icon, path, status) values
  (
    'math-genie',
    'Math Genie',
    'Quick-fire calculations and formula evaluation. Drop in an equation, get instant results.',
    'calculator',
    '/apps/math-genie/',
    'live'
  ),
  (
    'ai-summariser',
    'AI Summariser',
    'Paste any text, document, or URL and get a clean, structured summary in seconds.',
    'brain',
    '/apps/ai-summariser/',
    'coming_soon'
  ),
  (
    'islamic-advisor',
    'Islamic Advisor',
    'Scholarly AI guidance grounded in Quran and Hadith. Authenticated by tradition, verified by intelligence.',
    'book-open',
    '/apps/islamic-advisor/',
    'coming_soon'
  )
on conflict (slug) do nothing;

-- Link apps to categories
insert into app_category_map (app_id, category_id)
select a.id, c.id
from apps a, app_categories c
where (a.slug = 'math-genie'      and c.slug = 'utilities')
   or (a.slug = 'ai-summariser'   and c.slug = 'ai')
   or (a.slug = 'islamic-advisor' and c.slug = 'islamic')
   or (a.slug = 'islamic-advisor' and c.slug = 'ai')
on conflict do nothing;
