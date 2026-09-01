/**
 * One place for the app's visual language, so the lobby and the battle
 * screen don't drift into looking like two different apps.
 */
export const theme = {
  color: {
    bg: '#12161f',
    surface: '#1b2130',
    surfaceRaised: '#232b3d',
    border: '#2f3950',
    text: '#eef2f8',
    textMuted: '#8b97ad',
    accent: '#4c8dff',
    accentText: '#ffffff',
    good: '#3fb950',
    warn: '#d29922',
    bad: '#f0533f',
    tera: '#b070ff',
  },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  space: (n: number) => n * 4,
} as const;

/** HP bar colour, matching the official client's green/yellow/red thresholds. */
export function hpColor(fraction: number): string {
  if (fraction > 0.5) return theme.color.good;
  if (fraction > 0.2) return theme.color.warn;
  return theme.color.bad;
}

/** Status condition badge colours. */
export const STATUS_COLORS: Record<string, string> = {
  brn: '#eb7434',
  par: '#e0c341',
  slp: '#8b97ad',
  frz: '#4fc3f7',
  psn: '#b45ec7',
  tox: '#a03fb0',
};
