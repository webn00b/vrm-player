# Language Hosts

Language hosts are locale-specific VRM profiles used by the top-level `Hosts`
tab preview. They are independent from the main Player avatar.

## Asset contract

Host VRM files are served from:

- `/models/hosts/en-US/host.vrm`
- `/models/hosts/ja-JP/host.vrm`
- `/models/hosts/es-ES/host.vrm`
- `/models/hosts/fr-FR/host.vrm`
- `/models/hosts/ru-RU/host.vrm`

The supported locale set is:

- `en-US`
- `ja-JP`
- `es-ES`
- `fr-FR`
- `ru-RU`

Each asset should be a complete VRM host model for that locale. The preview
expects a valid VRM humanoid model loadable by the normal VRM loader.

## Profile fields

Profiles live in `src/languageHosts.ts` as `LanguageHostProfile` records. Each
profile contains:

- `label`: English display name.
- `nativeLabel`: locale-native display name.
- `modelUrl`: VRM URL, matching `/models/hosts/<locale>/host.vrm`.
- `voiceId`: voice/runtime identifier reserved for language-specific voice work.
- `greetingAnimation`: greeting animation identifier reserved by the profile.
- `idleAnimations`: ordered idle animation identifiers reserved by the profile.
- `expressionPreset`: expression style hint for the host.
- `cameraPreset`: camera framing hint for the preview.

## Locale resolution

`en-US` is the fallback default. `normalizeLocale()` accepts supported BCP-47
locale strings, normalizes case, maps language-only inputs to the supported
locale for that language, and falls back to `en-US` when no supported locale is
found.

Hosts are displayed in this order:

1. `en-US`
2. `ja-JP`
3. `es-ES`
4. `fr-FR`
5. `ru-RU`

## Preview behavior

Selecting a host swaps only the VRM inside the isolated Hosts preview scene. The
selected locale is persisted in `localStorage['vrm-player.language-locale']`.

If a host asset is missing or cannot be loaded, the Hosts tab keeps the main app
running and shows an unavailable status for that profile.

## Out of scope

- Clothing transfer between hosts.
- Main Player avatar replacement.
- Runtime language-change event dispatch or consumption.
- `SceneToolbar` language selector.
