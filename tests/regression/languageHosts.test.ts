import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LANGUAGE_HOSTS,
  getLanguageHostProfiles,
  isSupportedLocale,
  normalizeLocale,
  resolveLanguageHostProfile,
} from '../../src/languageHosts';

describe('language host profiles', () => {
  it('contains the initial five language hosts', () => {
    expect(Object.keys(LANGUAGE_HOSTS).sort()).toEqual([
      'en-US',
      'es-ES',
      'fr-FR',
      'ja-JP',
      'ru-RU',
    ]);
  });

  it('returns profiles in display order', () => {
    expect(getLanguageHostProfiles().map((profile) => profile.locale)).toEqual([
      'en-US',
      'ja-JP',
      'es-ES',
      'fr-FR',
      'ru-RU',
    ]);
  });

  it('normalizes common language-only locale inputs', () => {
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('ja')).toBe('ja-JP');
    expect(normalizeLocale('es')).toBe('es-ES');
    expect(normalizeLocale('fr')).toBe('fr-FR');
    expect(normalizeLocale('ru')).toBe('ru-RU');
  });

  it('normalizes mixed-case BCP-47 inputs', () => {
    expect(normalizeLocale('JA-jp')).toBe('ja-JP');
    expect(normalizeLocale('ru-ru')).toBe('ru-RU');
  });

  it('returns the exact profile for supported BCP-47 locale inputs', () => {
    const profile = resolveLanguageHostProfile('ja-JP');
    expect(profile.locale).toBe('ja-JP');
    expect(profile.modelUrl).toBe('/models/hosts/ja-JP/host.vrm');
    expect(profile.voiceId).toBe('ja-JP-host');
  });

  it('falls back to the default host for unsupported locales', () => {
    const profile = resolveLanguageHostProfile('de-DE');
    expect(profile.locale).toBe(DEFAULT_LOCALE);
    expect(profile.modelUrl).toBe('/models/hosts/en-US/host.vrm');
  });

  it('checks supported locales after normalization', () => {
    expect(isSupportedLocale('fr-FR')).toBe(true);
    expect(isSupportedLocale('FR-fr')).toBe(true);
    expect(isSupportedLocale('de-DE')).toBe(false);
  });

  it('keeps profile arrays readonly at runtime by returning frozen objects', () => {
    const profile = resolveLanguageHostProfile('en-US');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.idleAnimations)).toBe(true);
    expect(Object.isFrozen(getLanguageHostProfiles())).toBe(true);
  });
});
