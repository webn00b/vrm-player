export type AppPage = 'player' | 'retarget' | 'tools' | 'hosts';
export type UiMode = 'play' | 'capture' | 'inspect';

export interface ShellOption<T extends string> {
  label: string;
  value: T;
}

export const pageOptions: Array<ShellOption<AppPage>> = [
  { label: 'Player', value: 'player' },
  { label: 'Retarget', value: 'retarget' },
  { label: 'Export', value: 'tools' },
  { label: 'Hosts', value: 'hosts' },
];

export const modeOptions: Array<ShellOption<UiMode>> = [
  { label: 'Play', value: 'play' },
  { label: 'Capture', value: 'capture' },
  { label: 'Inspect', value: 'inspect' },
];

export function isAppPage(value: string | null): value is AppPage {
  return value === 'player' || value === 'retarget' || value === 'tools' || value === 'hosts';
}

export function isUiMode(value: string | null): value is UiMode {
  return value === 'play' || value === 'capture' || value === 'inspect';
}
