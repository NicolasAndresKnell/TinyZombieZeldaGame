// =====================================================================
// NET — everyone with the page open shares one room. Only hero positions
// travel; zombies and brains stay local to each player.
// Inside claude.ai the page's built-in room is used; elsewhere (e.g. Vercel)
// a Supabase Realtime channel. With neither, the game plays solo.
// =====================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NET } from '../config';
import type { HeroState, Peer } from '../types';

export interface Connection {
  readonly name: string;
  send(hero: HeroState): void;
  readonly peers: readonly Peer[];
}

// The shape of claude.ai's room capability, as far as we use it.
interface ClaudeRoom {
  presence(state: { hero: HeroState }): Promise<unknown>;
  onPeers(cb: (c: { peers: { peer: string; sameTab?: boolean; presence?: { hero?: HeroState } }[] }) => void): void;
}
declare global {
  interface Window { claude?: { use?: (name: 'room') => Promise<ClaudeRoom | null> } }
}

let connection: Connection | null = null;

// The current connection, or null while connecting / playing solo.
export const getConnection = () => connection;

// Trim, squash whitespace and cap the length; used for our own name and everyone else's.
export const cleanName = (raw: unknown) =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, NET.maxNameLength) : '';

export async function connect(name: string) {
  let room: ClaudeRoom | null = null;
  try { room = (await window.claude?.use?.('room')) ?? null; } catch { room = null; }
  if (room) return connectClaudeRoom(room, name);
  const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) await connectSupabase(url, anonKey, name);
}

function connectClaudeRoom(room: ClaudeRoom, name: string) {
  let peers: Peer[] = [];
  room.onPeers(c => {
    peers = c.peers.flatMap(p => (!p.sameTab && p.presence?.hero ? [{ id: p.peer, hero: p.presence.hero }] : []));
  });
  connection = {
    name,
    send: hero => { room.presence({ hero }).catch(() => {}); },
    get peers() { return peers; },
  };
}

// Each browser signs in anonymously, so it keeps one player id across reloads.
// Positions go out as broadcasts; presence tells us when someone closes the page.
async function connectSupabase(url: string, anonKey: string, name: string) {
  const client = createClient(url, anonKey);
  const me = await playerId(client);
  const channel = client.channel(NET.channel, {
    config: { broadcast: { self: false }, presence: { key: me } },
  });
  const heroes = new Map<string, { hero: HeroState; at: number }>();
  let peers: Peer[] = [];
  const refresh = () => { peers = [...heroes].map(([id, v]) => ({ id, hero: v.hero })); };
  channel
    .on('broadcast', { event: 'hero' }, ({ payload }) => {
      if (typeof payload?.peer !== 'string' || payload.peer === me) return;
      heroes.set(payload.peer, { hero: payload.hero, at: Date.now() });
      refresh();
    })
    .on('presence', { event: 'leave' }, ({ key }) => { heroes.delete(key); refresh(); })
    .subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      channel.track({});
      connection = {
        name,
        send: hero => { channel.send({ type: 'broadcast', event: 'hero', payload: { peer: me, hero } }); },
        get peers() { return peers; },
      };
    });
  // Drop anyone we haven't heard from in a while (closed laptop, lost connection).
  setInterval(() => {
    const now = Date.now();
    for (const [id, v] of heroes) if (now - v.at > NET.staleMs) heroes.delete(id);
    refresh();
  }, 1000);
}

// Reuse this browser's saved session, or sign in as a new anonymous player.
// If anonymous sign-ins are off in Supabase, play on with a throwaway id.
async function playerId(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signedIn, error } = await client.auth.signInAnonymously();
  if (error || !signedIn.user) {
    console.warn('Anonymous sign-in failed; playing without an account.', error?.message);
    return Math.random().toString(36).slice(2, 10);
  }
  return signedIn.user.id;
}
