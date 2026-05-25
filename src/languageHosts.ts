export type SupportedLocale = 'en-US' | 'ja-JP' | 'es-ES' | 'fr-FR' | 'ru-RU';

export interface LanguageHostProfile {
  locale: SupportedLocale;
  label: string;
  nativeLabel: string;
  modelUrl: string;
  voiceId: string;
  greetingAnimation: string;
  idleAnimations: readonly string[];
  expressionPreset: 'neutral' | 'warm-subtle' | 'bright' | 'reserved';
  cameraPreset: 'portrait-medium';
}

export const DEFAULT_LOCALE: SupportedLocale = 'en-US';

const freezeProfile = (profile: LanguageHostProfile): LanguageHostProfile => Object.freeze({
  ...profile,
  idleAnimations: Object.freeze([...profile.idleAnimations]),
});

export const LANGUAGE_HOSTS: Readonly<Record<SupportedLocale, LanguageHostProfile>> = Object.freeze({
  'en-US': freezeProfile({
    locale: 'en-US',
    label: 'English',
    nativeLabel: 'English',
    modelUrl: '/models/hosts/en-US/host.vrm',
    voiceId: 'en-US-host',
    greetingAnimation: 'en-US-greeting',
    idleAnimations: ['en-US-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'warm-subtle',
    cameraPreset: 'portrait-medium',
  }),
  'ja-JP': freezeProfile({
    locale: 'ja-JP',
    label: 'Japanese',
    nativeLabel: '日本語',
    modelUrl: '/models/hosts/ja-JP/host.vrm',
    voiceId: 'ja-JP-host',
    greetingAnimation: 'ja-JP-greeting',
    idleAnimations: ['ja-JP-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'reserved',
    cameraPreset: 'portrait-medium',
  }),
  'es-ES': freezeProfile({
    locale: 'es-ES',
    label: 'Spanish',
    nativeLabel: 'Español',
    modelUrl: '/models/hosts/es-ES/host.vrm',
    voiceId: 'es-ES-host',
    greetingAnimation: 'es-ES-greeting',
    idleAnimations: ['es-ES-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'bright',
    cameraPreset: 'portrait-medium',
  }),
  'fr-FR': freezeProfile({
    locale: 'fr-FR',
    label: 'French',
    nativeLabel: 'Français',
    modelUrl: '/models/hosts/fr-FR/host.vrm',
    voiceId: 'fr-FR-host',
    greetingAnimation: 'fr-FR-greeting',
    idleAnimations: ['fr-FR-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'neutral',
    cameraPreset: 'portrait-medium',
  }),
  'ru-RU': freezeProfile({
    locale: 'ru-RU',
    label: 'Russian',
    nativeLabel: 'Русский',
    modelUrl: '/models/hosts/ru-RU/host.vrm',
    voiceId: 'ru-RU-host',
    greetingAnimation: 'ru-RU-greeting',
    idleAnimations: ['ru-RU-idle-01', 'shared-idle-breathing'],
    expressionPreset: 'warm-subtle',
    cameraPreset: 'portrait-medium',
  }),
});

const DISPLAY_ORDER: readonly SupportedLocale[] = Object.freeze([
  'en-US',
  'ja-JP',
  'es-ES',
  'fr-FR',
  'ru-RU',
]);

const LANGUAGE_ONLY_TO_LOCALE: Readonly<Record<string, SupportedLocale>> = Object.freeze({
  en: 'en-US',
  ja: 'ja-JP',
  es: 'es-ES',
  fr: 'fr-FR',
  ru: 'ru-RU',
});

function canonicalizeLocale(input: string): string {
  const [language, region] = input.split('-');
  if (!language) return '';
  if (!region) return language.toLowerCase();
  return `${language.toLowerCase()}-${region.toUpperCase()}`;
}

export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (!input) return DEFAULT_LOCALE;
  const canonical = canonicalizeLocale(input);
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_HOSTS, canonical)) {
    return canonical as SupportedLocale;
  }
  const language = canonical.split('-')[0];
  return LANGUAGE_ONLY_TO_LOCALE[language] ?? DEFAULT_LOCALE;
}

export function isSupportedLocale(input: string | null | undefined): boolean {
  if (!input) return false;
  const canonical = canonicalizeLocale(input);
  return Object.prototype.hasOwnProperty.call(LANGUAGE_HOSTS, canonical);
}

export function resolveLanguageHostProfile(input: string | null | undefined): LanguageHostProfile {
  return LANGUAGE_HOSTS[normalizeLocale(input)];
}

export function getLanguageHostProfiles(): readonly LanguageHostProfile[] {
  return Object.freeze(DISPLAY_ORDER.map((locale) => LANGUAGE_HOSTS[locale]));
}
