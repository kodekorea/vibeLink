// DESIGN.md(Anthropic 크림/코랄/네이비) 단일 출처. 모든 화면이 여기서만 색/간격/라운드를 가져온다.
export const color = {
  primary: '#cc785c', primaryActive: '#a9583e', primaryDisabled: '#e6dfd8',
  ink: '#141413', body: '#3d3d3a', bodyStrong: '#252523', muted: '#6c6a64', mutedSoft: '#8e8b82',
  hairline: '#e6dfd8', canvas: '#faf9f5', surfaceSoft: '#f5f0e8', surfaceCard: '#efe9de',
  surfaceCreamStrong: '#e8e0d2', surfaceDark: '#181715', surfaceDarkElevated: '#252320',
  surfaceDarkSoft: '#1f1e1b', onPrimary: '#ffffff', onDark: '#faf9f5', onDarkSoft: '#a09d96',
  accentTeal: '#5db8a6', success: '#5db872', warning: '#d4a017', error: '#c64545',
} as const;

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 9999 } as const;
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 } as const;

export const font = {
  display: 'CormorantGaramond_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  code: 'JetBrainsMono_400Regular',
} as const;
