import React from 'react';

export type AppThemeName = 'dark' | 'light';

export type ThemeColors = {
  bgApp: string;
  bgSurface1: string;
  bgSurface2: string;
  bgSurface3: string;
  bgOverlay: string;
  bgDim: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textFaint: string;
  stroke: string;
  strokeStrong: string;
  accentFeed: string;
  accentPractice: string;
  accentGold: string;
  accentSuccess: string;
  accentError: string;
  accentOrange: string;
  accentBlue: string;
  accentPink: string;
  textOnAccent: string;
  heart: string;
  bookmark: string;
  wordDim: string;
  wordSpoken: string;
  wordActive: string;
  cefrA: string;
  cefrB1: string;
  cefrB2: string;
  cefrC1: string;
  cefrC2: string;
  maskBg: string;
  maskBgSpoken: string;
  progressBg: string;
  progressFill: string;
  shadow: string;
};

const darkColors: ThemeColors = {
  bgApp: '#0C0C0E',
  bgSurface1: 'rgba(255,255,255,0.05)',
  bgSurface2: 'rgba(255,255,255,0.06)',
  bgSurface3: 'rgba(255,255,255,0.10)',
  bgOverlay: 'rgba(12,12,14,0.97)',
  bgDim: 'rgba(0,0,0,0.62)',
  textPrimary: 'rgba(255,255,255,0.87)',
  textSecondary: 'rgba(255,255,255,0.55)',
  textTertiary: 'rgba(255,255,255,0.30)',
  textFaint: 'rgba(255,255,255,0.15)',
  stroke: 'rgba(255,255,255,0.05)',
  strokeStrong: 'rgba(255,255,255,0.14)',
  accentFeed: '#8B9CF7',
  accentPractice: '#A855F7',
  accentGold: '#C4A96E',
  accentSuccess: '#22C55E',
  accentError: '#EF4444',
  accentOrange: '#F97316',
  accentBlue: '#3B82F6',
  accentPink: '#F472B6',
  textOnAccent: '#09090B',
  heart: '#ff4466',
  bookmark: '#ffc34d',
  wordDim: 'rgba(255,255,255,0.20)',
  wordSpoken: 'rgba(255,255,255,0.93)',
  wordActive: '#8B9CF7',
  cefrA: 'rgba(255,255,255,0.87)',
  cefrB1: '#7AAFC4',
  cefrB2: '#C4A96E',
  cefrC1: '#C47A6E',
  cefrC2: '#C97BDB',
  maskBg: 'rgba(255,255,255,0.10)',
  maskBgSpoken: 'rgba(255,255,255,0.15)',
  progressBg: 'rgba(255,255,255,0.15)',
  progressFill: '#8B9CF7',
  shadow: 'rgba(0,0,0,0.28)',
};

const lightColors: ThemeColors = {
  bgApp: '#F2F2F7',
  bgSurface1: '#FFFFFF',
  bgSurface2: 'rgba(0,0,0,0.04)',
  bgSurface3: 'rgba(0,0,0,0.08)',
  bgOverlay: 'rgba(255,255,255,0.95)',
  bgDim: 'rgba(0,0,0,0.18)',
  textPrimary: 'rgba(0,0,0,0.85)',
  textSecondary: 'rgba(0,0,0,0.60)',
  textTertiary: 'rgba(0,0,0,0.40)',
  textFaint: 'rgba(0,0,0,0.20)',
  stroke: 'rgba(0,0,0,0.06)',
  strokeStrong: 'rgba(0,0,0,0.12)',
  accentFeed: '#6B7CDB',
  accentPractice: '#8E63D6',
  accentGold: '#A88B4E',
  accentSuccess: '#16A34A',
  accentError: '#EF4444',
  accentOrange: '#F97316',
  accentBlue: '#2563EB',
  accentPink: '#DB2777',
  textOnAccent: '#FFFFFF',
  heart: '#ff3b30',
  bookmark: '#ff9500',
  wordDim: 'rgba(0,0,0,0.20)',
  wordSpoken: 'rgba(0,0,0,0.85)',
  wordActive: '#6B7CDB',
  cefrA: 'rgba(0,0,0,0.80)',
  cefrB1: '#5A96A8',
  cefrB2: '#A88B4E',
  cefrC1: '#A85A4E',
  cefrC2: '#9C27B0',
  maskBg: 'rgba(0,0,0,0.08)',
  maskBgSpoken: 'rgba(0,0,0,0.12)',
  progressBg: 'rgba(0,0,0,0.08)',
  progressFill: '#6B7CDB',
  shadow: 'rgba(0,0,0,0.10)',
};

const ThemeContext = React.createContext<{
  theme: AppThemeName;
  colors: ThemeColors;
}>({
  theme: 'dark',
  colors: darkColors,
});

type AppThemeProviderProps = {
  theme: AppThemeName;
  children: React.ReactNode;
};

export function AppThemeProvider({ theme, children }: AppThemeProviderProps) {
  const value = React.useMemo(
    () => ({
      theme,
      colors: theme === 'light' ? lightColors : darkColors,
    }),
    [theme]
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme() {
  return React.useContext(ThemeContext);
}
