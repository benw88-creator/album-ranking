-- Push bid_wars changes to connected clients.
--
-- Without this, the player who bid first sees nothing until they reload: the
-- war resolves inside the opponent's submit, on the opponent's machine. Adding
-- the table to the realtime publication lets the app flip straight to the
-- reveal the moment the second bid lands.
--
-- Realtime honours RLS, and bid_wars already restricts SELECT to the two
-- participants, so nobody receives a war they are not in. bid_war_bids and
-- bid_war_values are deliberately NOT published: the bids are sealed and the
-- values are hidden, and streaming either would undo that.

alter publication supabase_realtime add table public.bid_wars;
