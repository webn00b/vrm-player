import type { PlayerContext } from './types';

export function requireScene(ctx: PlayerContext): NonNullable<PlayerContext['scene']> {
  if (!ctx.scene) throw new Error('Player scene is required before this module runs');
  return ctx.scene;
}

export function requireVrm(ctx: PlayerContext): NonNullable<PlayerContext['vrm']> {
  if (!ctx.vrm) throw new Error('Player VRM is required before this module runs');
  return ctx.vrm;
}

export function requirePlayback(ctx: PlayerContext): NonNullable<PlayerContext['playback']> {
  if (!ctx.playback) throw new Error('Player playback systems are required before this module runs');
  return ctx.playback;
}

export function requireMocap(ctx: PlayerContext): NonNullable<PlayerContext['mocap']> {
  if (!ctx.mocap) throw new Error('Player mocap systems are required before this module runs');
  return ctx.mocap;
}

export function requireTooling(ctx: PlayerContext): NonNullable<PlayerContext['tooling']> {
  if (!ctx.tooling) throw new Error('Player tooling systems are required before this module runs');
  return ctx.tooling;
}

export function requireAnimation(ctx: PlayerContext): NonNullable<PlayerContext['animation']> {
  if (!ctx.animation) throw new Error('Player animation bridge is required before this module runs');
  return ctx.animation;
}
