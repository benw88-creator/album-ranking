-- Blanc is withdrawn from the shop. Refund anyone who bought it rather than
-- taking both the discs and the theme, and move them off it if they had it on.
update public.profiles
   set discs = coalesce(discs, 0) + 400,
       owned_themes = array_remove(owned_themes, 'blanc'),
       active_theme = case when active_theme = 'blanc' then 'classic' else active_theme end
 where 'blanc' = any(coalesce(owned_themes, '{}'::text[]));

delete from public.shop_items where kind = 'theme' and key = 'blanc';
