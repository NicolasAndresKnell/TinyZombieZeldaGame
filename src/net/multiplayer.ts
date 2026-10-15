// =====================================================================
// NET — everyone with the page open shares one room. Only hero positions
// travel; zombies and brains stay local to each player.
// Inside claude.ai the page's built-in room is used; elsewhere (e.g. Vercel)
// a Supabase Realtime channel. With neither, the game plays solo.
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import { NET } from '../config';
import type { HeroState, Peer } from '../types';

export interface Connection {
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

export async function connect() {
  let room: ClaudeRoom | null = null;
  try { room = (await window.claude?.use?.('room')) ?? null; } catch { room = null; }
  if (room) return connectClaudeRoom(room);
  const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) connectSupabase(url, anonKey);
}

function connectClaudeRoom(room: ClaudeRoom) {
  let peers: Peer[] = [];
  room.onPeers(c => {
    peers = c.peers.flatMap(p => (!p.sameTab && p.presence?.hero ? [{ id: p.peer, hero: p.presence.hero }] : []));
  });
  connection = {
    send: hero => { room.presence({ hero }).catch(() => {}); },
    get peers() { return peers; },
  };
}

// Positions go out as broadcasts; presence tells us when someone closes the page.
function connectSupabase(url: string, anonKey: string) {
  const me = Math.random().toString(36).slice(2, 10);
  const channel = createClient(url, anonKey).channel(NET.channel, {
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
