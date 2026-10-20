import { supabase } from './supabase.js';

// Thin data layer. Every permission check happens in Postgres (RLS policies and
// SECURITY DEFINER functions in supabase/schema.sql); this file only calls them
// and turns failures into readable errors.

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function friendly(error) {
  if (!error) return new ApiError('Something went wrong.');
  const msg = error.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new ApiError("Can't reach the server. Check your connection and try again.", 'network');
  if (/JWT expired|invalid JWT/i.test(msg)) return new ApiError('Your session expired. Sign in again.', 'auth');
  if (/permission denied|row-level security/i.test(msg)) return new ApiError("You don't have permission to do that.", 'forbidden');
  if (/profiles_username_lower_key|duplicate key.*username/i.test(msg)) return new ApiError('That username is taken.', 'conflict');
  if (/duplicate key/i.test(msg)) return new ApiError('That already exists.', 'conflict');
  if (/violates check constraint "profiles_username_check"/i.test(msg)) return new ApiError('Usernames are 3–20 letters, numbers or underscores.', 'invalid');
  if (/violates check constraint/i.test(msg)) return new ApiError('Some of those values are not allowed. Check the form and try again.', 'invalid');
  return new ApiError(msg, error.code);
}

async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw friendly(error);
  return data;
}

export const rpc = (name, args = {}) => unwrap(supabase.rpc(name, args));

// ---------- profile ----------
export const getMyProfile = (id) => unwrap(supabase.from('profiles').select('*').eq('id', id).maybeSingle());
export const updateMyProfile = (id, fields) => unwrap(supabase.from('profiles').update(fields).eq('id', id).select('*').single());
export const isUsernameAvailable = (username) => rpc('is_username_available', { p_username: username });
export const heartbeat = () => rpc('heartbeat');
export const amIModerator = () => rpc('am_i_moderator');

export async function uploadAvatar(userId, file) {
  if (!file.type.startsWith('image/')) throw new ApiError('Choose an image file (PNG, JPG, WebP or GIF).');
  if (file.size > 2 * 1024 * 1024) throw new ApiError('Images must be 2 MB or smaller.');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) {
    if (/bucket/i.test(error.message)) throw new ApiError('Avatar uploads need the "avatars" storage bucket. Run schema.sql, or pick a preset avatar for now.');
    throw friendly(error);
  }
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

// ---------- games ----------
let gamesCache = null;
export async function getGames() {
  if (!gamesCache) gamesCache = unwrap(supabase.from('games').select('*').eq('is_active', true).order('sort_order'));
  try { return await gamesCache; } catch (e) { gamesCache = null; throw e; }
}
export const getMyGameProfiles = (userId) =>
  unwrap(supabase.from('user_game_profiles').select('*').eq('user_id', userId).order('created_at'));
export const createGameProfile = (fields) => unwrap(supabase.from('user_game_profiles').insert(fields).select('*').single());
export const updateGameProfile = (id, fields) => unwrap(supabase.from('user_game_profiles').update(fields).eq('id', id).select('*').single());
export const deleteGameProfile = (id) => unwrap(supabase.from('user_game_profiles').delete().eq('id', id));

// ---------- discovery ----------
export const findPlayers = (filters) => rpc('find_players', filters);
export const getPlayerProfile = (id) => rpc('get_player_profile', { p_user: id });
export const quickMatch = (game) => rpc('quick_match', { p_game: game || null });
export const getDashboard = () => rpc('get_dashboard');

// ---------- parties ----------
export const listParties = (filters) => rpc('list_parties', filters);
export const getParty = (id) => rpc('get_party', { p_party: id });
export const createParty = (fields) => rpc('create_party', fields);
export const updateParty = (fields) => rpc('update_party', fields);
export const requestJoin = (party, role, message) => rpc('request_join_party', { p_party: party, p_role: role || null, p_message: message || '' });
export const cancelJoinRequest = (id) => rpc('cancel_join_request', { p_request: id });
export const respondJoinRequest = (id, accept) => rpc('respond_join_request', { p_request: id, p_accept: accept });
export const inviteToParty = (party, user) => rpc('invite_to_party', { p_party: party, p_user: user });
export const respondInvite = (id, accept, role) => rpc('respond_party_invite', { p_invite: id, p_accept: accept, p_role: role || null });
export const cancelInvite = (id) => rpc('cancel_party_invite', { p_invite: id });
export const leaveParty = (id) => rpc('leave_party', { p_party: id });
export const removeMember = (party, user) => rpc('remove_party_member', { p_party: party, p_user: user });
export const transferLeadership = (party, user) => rpc('transfer_party_leadership', { p_party: party, p_user: user });
export const closeParty = (id) => rpc('close_party', { p_party: id });

// ---------- friends & safety ----------
export const listFriends = () => rpc('list_friends');
export const sendFriendRequest = (user) => rpc('send_friend_request', { p_user: user });
export const respondFriendRequest = (user, accept) => rpc('respond_friend_request', { p_user: user, p_accept: accept });
export const removeFriend = (user) => rpc('remove_friend', { p_user: user });
export const blockUser = (user) => rpc('block_user', { p_user: user });
export const unblockUser = (user) => rpc('unblock_user', { p_user: user });
export const muteUser = (user) => rpc('mute_user', { p_user: user });
export const unmuteUser = (user) => rpc('unmute_user', { p_user: user });
export const listBlockedAndMuted = () => rpc('list_blocked_and_muted');
export const submitReport = (fields) => rpc('submit_report', fields);
export const myReports = () => rpc('my_reports');

// ---------- messaging ----------
export const openDirectConversation = (user) => rpc('get_or_create_direct_conversation', { p_user: user });
export const listConversations = () => rpc('list_conversations');
export const getConversation = (id) => rpc('get_conversation', { p_conversation: id });
export const getMessages = (id, before) => rpc('get_messages', { p_conversation: id, p_before: before ?? null, p_limit: 50 });
export const sendMessage = (id, body, replyTo) => rpc('send_message', { p_conversation: id, p_body: body, p_reply_to: replyTo ?? null });
export const editMessage = (id, body) => rpc('edit_message', { p_message: id, p_body: body });
export const deleteMessage = (id) => rpc('delete_message', { p_message: id });
export const toggleReaction = (id, emoji) => rpc('toggle_reaction', { p_message: id, p_emoji: emoji });
export const pinMessage = (id, pinned) => rpc('pin_message', { p_message: id, p_pinned: pinned });
export const listPins = (conv) => rpc('list_pins', { p_conversation: conv });
export const searchMessages = (conv, q) => rpc('search_messages', { p_conversation: conv, p_query: q, p_limit: 25 });
export const setTyping = (conv) => rpc('set_typing', { p_conversation: conv });
export const getTyping = (conv) => rpc('get_typing', { p_conversation: conv });
export const setConversationMuted = (conv, muted) => rpc('set_conversation_muted', { p_conversation: conv, p_muted: muted });

// ---------- group DMs ----------
export const createGroupDm = (users, name) => rpc('create_group_dm', { p_users: users, p_name: name || null });
export const renameGroupDm = (conv, name) => rpc('rename_group_dm', { p_conversation: conv, p_name: name });
export const addGroupMember = (conv, user) => rpc('add_group_member', { p_conversation: conv, p_user: user });
export const removeGroupMember = (conv, user) => rpc('remove_group_member', { p_conversation: conv, p_user: user });
export const leaveGroupDm = (conv) => rpc('leave_group_dm', { p_conversation: conv });

// ---------- communities ----------
export const listMyCommunities = () => rpc('list_my_communities');
export const exploreCommunities = (search, game, offset = 0) => rpc('explore_communities', { p_search: search || null, p_game: game || null, p_limit: 24, p_offset: offset });
export const getCommunity = (id) => rpc('get_community', { p_community: id });
export const createCommunity = (f) => rpc('create_community', { p_name: f.name, p_description: f.description || '', p_is_public: f.is_public, p_game: f.game_id || null, p_icon_color: f.icon_color });
export const updateCommunity = (id, f) => rpc('update_community', { p_community: id, p_name: f.name ?? null, p_description: f.description ?? null,
  p_is_public: f.is_public ?? null, p_game: f.game_id || null, p_icon_color: f.icon_color ?? null, p_clear_game: !f.game_id });
export const deleteCommunity = (id, name) => rpc('delete_community', { p_community: id, p_confirm_name: name });
export const joinCommunity = (id) => rpc('join_community', { p_community: id });
export const leaveCommunity = (id) => rpc('leave_community', { p_community: id });
export const createInvite = (id, maxUses, hours) => rpc('create_invite', { p_community: id, p_max_uses: maxUses ?? null, p_expires_hours: hours ?? null });
export const getInvite = (code) => rpc('get_invite', { p_code: code });
export const acceptInvite = (code) => rpc('accept_invite', { p_code: code });
export const listInvites = (id) => rpc('list_invites', { p_community: id });
export const revokeInvite = (code) => rpc('revoke_invite', { p_code: code });
export const listCommunityMembers = (id) => rpc('list_community_members', { p_community: id });
export const setMemberRole = (id, user, role) => rpc('set_member_role', { p_community: id, p_user: user, p_role: role });
export const transferCommunity = (id, user) => rpc('transfer_community_ownership', { p_community: id, p_user: user });
export const kickMember = (id, user) => rpc('kick_community_member', { p_community: id, p_user: user });
export const banMember = (id, user, reason) => rpc('ban_community_member', { p_community: id, p_user: user, p_reason: reason || '' });
export const unbanMember = (id, user) => rpc('unban_community_member', { p_community: id, p_user: user });
export const listBans = (id) => rpc('list_community_bans', { p_community: id });
export const createChannel = (id, name, topic, kind) => rpc('create_channel', { p_community: id, p_name: name, p_topic: topic || '', p_kind: kind || 'text' });
export const updateChannel = (id, f) => rpc('update_channel', { p_channel: id, p_name: f.name ?? null, p_topic: f.topic ?? null, p_kind: f.kind ?? null, p_position: f.position ?? null });
export const deleteChannel = (id) => rpc('delete_channel', { p_channel: id });
export const markConversationRead = (id) => rpc('mark_conversation_read', { p_conversation: id });

// ---------- notifications ----------
export const getCounts = () => rpc('get_counts');
export const listNotifications = (limit = 30, offset = 0, unreadOnly = false) =>
  rpc('list_notifications', { p_limit: limit, p_offset: offset, p_unread_only: unreadOnly });
export const markNotificationsRead = (ids = null) => rpc('mark_notifications_read', { p_ids: ids });

// ---------- moderation ----------
export const modListReports = (status, offset = 0) => rpc('mod_list_reports', { p_status: status, p_limit: 25, p_offset: offset });
export const modGetReport = (id) => rpc('mod_get_report', { p_report: id });
export const modUpdateReport = (fields) => rpc('mod_update_report', fields);

// ---------- account ----------
export const deleteMyAccount = (username) => rpc('delete_my_account', { p_confirm_username: username });

// ---------- realtime ----------
/**
 * Subscribe to Postgres changes. Calls onStatus(true|false) so callers can fall
 * back to polling when Realtime is not available. Returns an unsubscribe function.
 */
export function subscribe(name, changes, onChange, onStatus) {
  let channel;
  try {
    channel = supabase.channel(name);
    for (const c of changes) channel = channel.on('postgres_changes', { schema: 'public', ...c }, onChange);
    channel.subscribe((status) => onStatus?.(status === 'SUBSCRIBED'));
  } catch {
    onStatus?.(false);
    return () => {};
  }
  return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
}
