-- Removes ALL PartyUp demo data (players, their game profiles, parties, chats, friendships).
-- Real user accounts are never touched: only rows flagged is_demo = true are deleted.
begin;
delete from public.parties where is_demo;
delete from public.communities where is_demo;
delete from auth.users where id in (select id from public.profiles where is_demo);
commit;
