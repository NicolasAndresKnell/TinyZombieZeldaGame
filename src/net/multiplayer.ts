import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MULTIPLAYER } from '../config';
import type { NetworkPlayerState, RemotePlayer } from '../types';

export interface Connection {
  readonly name: string;
  send(hero: NetworkPlayerState): void;
  readonly peers: readonly RemotePlayer[];
}

interface ClaudeRoom {
  presence(state: { hero: NetworkPlayerState }): Promise<unknown>;
  onPeers(cb: (update: { peers: { peer: string; sameTab?: boolean; presence?: { hero?: NetworkPlayerState } }[] }) => void): void;
}
declare global {
  interface Window { claude?: { use?: (name: 'room') => Promise<ClaudeRoom | null> } }
}

let connection: Connection | null = null;

export const getConnection = () => connection;

// The name this player picked; empty until they press Play.
let playerName = '';
export const getPlayerName = () => playerName;

export const cleanName = (raw: unknown) =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MULTIPLAYER.maxNameLength) : '';

export async function connect(name: string) {
  playerName = name;
  let room: ClaudeRoom | null = null;
  try { room = (await window.claude?.use?.('room')) ?? null; } catch { room = null; }
  if (room) return connectClaudeRoom(room, name);
  const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) await connectSupabase(url, anonKey, name);
}

function connectClaudeRoom(room: ClaudeRoom, name: string) {
  let peers: RemotePlayer[] = [];
  room.onPeers(update => {
    peers = update.peers.flatMap(peer => (!peer.sameTab && peer.presence?.hero ? [{ id: peer.peer, hero: peer.presence.hero }] : []));
  });
  connection = {
    name,
    send: hero => { room.presence({ hero }).catch(() => {}); },
    get peers() { return peers; },
  };
}

async function connectSupabase(url: string, anonKey: string, name: string) {
  const client = createClient(url, anonKey);
  const localPlayerId = await playerId(client);
  const channel = client.channel(MULTIPLAYER.channel, {
    config: { broadcast: { self: false }, presence: { key: localPlayerId } },
  });
  const heroes = new Map<string, { hero: NetworkPlayerState; receivedAt: number }>();
  let peers: RemotePlayer[] = [];
  const refresh = () => { peers = [...heroes].map(([id, entry]) => ({ id, hero: entry.hero })); };
  channel
    .on('broadcast', { event: 'hero' }, ({ payload }) => {
      if (typeof payload?.peer !== 'string' || payload.peer === localPlayerId) return;
      heroes.set(payload.peer, { hero: payload.hero, receivedAt: Date.now() });
      refresh();
    })
    .on('presence', { event: 'leave' }, ({ key }) => { heroes.delete(key); refresh(); })
    .subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      channel.track({});
      connection = {
        name,
        send: hero => { channel.send({ type: 'broadcast', event: 'hero', payload: { peer: localPlayerId, hero } }); },
        get peers() { return peers; },
      };
    });

  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of heroes) if (now - entry.receivedAt > MULTIPLAYER.staleMs) heroes.delete(id);
    refresh();
  }, 1000);
}

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
