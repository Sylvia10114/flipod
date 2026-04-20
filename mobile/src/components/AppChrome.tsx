import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { radii, spacing, typography } from '../design';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';

type ScreenSurfaceProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
};

export function ScreenSurface({ children, style, edges }: ScreenSurfaceProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return <SafeAreaView edges={edges} style={[styles.surface, style]}>{children}</SafeAreaView>;
}

type ScreenHeaderProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  title: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeader({ leading, trailing, title, subtitle, style }: ScreenHeaderProps) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.headerOuter, style]}>
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            minHeight: metrics.touchTarget + 14,
            maxWidth: metrics.contentMaxWidth,
          },
        ]}
      >
        <View style={[styles.headerSlot, { minWidth: metrics.touchTarget + 8, minHeight: metrics.touchTarget }]}>
          {leading}
        </View>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <View
          style={[
            styles.headerSlot,
            styles.headerSlotEnd,
            { minWidth: metrics.touchTarget + 8, minHeight: metrics.touchTarget },
          ]}
        >
          {trailing}
        </View>
      </View>
    </View>
  );
}

type PillButtonProps = {
  label: string;
  onPress?: () => void;
  active?: boolean;
  subtle?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function PillButton({ label, onPress, active = false, subtle = false, style, textStyle }: PillButtonProps) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pillButton,
        { minHeight: metrics.touchTarget, paddingHorizontal: metrics.isTablet ? 16 : 14 },
        subtle && styles.pillButtonSubtle,
        active && styles.pillButtonActive,
        pressed && !active && styles.pillButtonPressed,
        pressed && active && styles.pillButtonActivePressed,
        style,
      ]}
    >
      <Text style={[styles.pillButtonText, active && styles.pillButtonTextActive, textStyle]}>{label}</Text>
    </Pressable>
  );
}

type ActionButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: ActionButtonProps) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.actionButton,
        { minHeight: metrics.isTablet ? 52 : 48 },
        variant === 'secondary' && styles.actionButtonSecondary,
        variant === 'success' && styles.actionButtonSuccess,
        variant === 'danger' && styles.actionButtonDanger,
        pressed && !(disabled || loading) && styles.actionButtonPressed,
        pressed && variant === 'secondary' && styles.actionButtonSecondaryPressed,
        pressed && variant === 'success' && styles.actionButtonSuccessPressed,
        pressed && variant === 'danger' && styles.actionButtonDangerPressed,
        disabled && styles.actionButtonDisabled,
        style,
      ]}
    >
      <View style={styles.actionButtonContent}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'secondary' ? colors.textPrimary : colors.textOnAccent}
          />
        ) : null}
        <Text
          style={[
            styles.actionButtonText,
            variant === 'secondary' && styles.actionButtonTextSecondary,
            disabled && styles.actionButtonTextDisabled,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

type GlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'feed' | 'practice';
};

export function GlassCard({ children, style, tone = 'default' }: GlassCardProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      style={[
        styles.card,
        tone === 'feed' && styles.cardFeed,
        tone === 'practice' && styles.cardPractice,
        style,
      ]}
    >
      {children}
    </View>
  );
}

type StepDotsProps = {
  count?: number;
  active: number;
  accent?: string;
};

export function StepDots({ count = 4, active, accent }: StepDotsProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const resolvedAccent = accent || colors.accentPractice;
  return (
    <View style={styles.stepDots}>
      {Array.from({ length: count }).map((_, index) => {
        const dotIndex = index + 1;
        return (
          <View
            key={`dot-${dotIndex}`}
            style={[
              styles.stepDot,
              dotIndex === active && { backgroundColor: resolvedAccent, width: 14, height: 14 },
              dotIndex !== active && dotIndex < active && { backgroundColor: `${resolvedAccent}88` },
            ]}
          />
        );
      })}
    </View>
  );
}

type PlayerLayoutProps = {
  header?: ReactNode;
  children: ReactNode;
  controls?: ReactNode;
  overlays?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function PlayerLayout({ header, children, controls, overlays, style }: PlayerLayoutProps) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      style={[
        styles.playerLayout,
        {
          paddingHorizontal: metrics.pageHorizontalPadding,
          width: '100%',
          maxWidth: metrics.contentMaxWidth,
          alignSelf: 'center',
        },
        style,
      ]}
    >
      <View style={[styles.playerHeader, { minHeight: metrics.playerHeaderHeight }]}>{header}</View>
      <View style={styles.playerContent}>{children}</View>
      <View style={[styles.playerControls, { minHeight: metrics.playerControlsHeight }]}>{controls}</View>
      {overlays}
    </View>
  );
}

type StatBlockProps = {
  value: string | number;
  label: string;
  accent?: string;
};

export function StatBlock({ value, label, accent }: StatBlockProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const resolvedAccent = accent || colors.textPrimary;
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color: resolvedAccent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type EmptyStateProps = {
  title: string;
  body: string;
};

export function EmptyState({ title, body }: EmptyStateProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
return StyleSheet.create({
  surface: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  headerOuter: {
    width: '100%',
    alignItems: 'center',
  },
  header: {
    width: '100%',
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerSlot: {
    justifyContent: 'center',
  },
  headerSlotEnd: {
    alignItems: 'flex-end',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: typography.hero,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  pillButton: {
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgSurface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  pillButtonSubtle: {
    backgroundColor: 'transparent',
  },
  pillButtonActive: {
    backgroundColor: colors.accentFeed,
    borderColor: colors.accentFeed,
  },
  pillButtonPressed: {
    backgroundColor: colors.bgSurface3,
    borderColor: colors.strokeStrong,
  },
  pillButtonActivePressed: {
    backgroundColor: '#7A8AF0',
    borderColor: '#7A8AF0',
  },
  pillButtonText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  pillButtonTextActive: {
    color: colors.textOnAccent,
  },
  actionButton: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accentFeed,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.strokeStrong,
  },
  actionButtonSuccess: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.26)',
  },
  actionButtonDanger: {
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.26)',
  },
  actionButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  actionButtonSecondaryPressed: {
    backgroundColor: colors.bgSurface2,
    borderColor: colors.accentFeed,
  },
  actionButtonSuccessPressed: {
    backgroundColor: 'rgba(34,197,94,0.24)',
    borderColor: 'rgba(34,197,94,0.34)',
  },
  actionButtonDangerPressed: {
    backgroundColor: 'rgba(239,68,68,0.22)',
    borderColor: 'rgba(239,68,68,0.34)',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionButtonText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  actionButtonTextSecondary: {
    color: colors.textPrimary,
  },
  actionButtonTextDisabled: {
    color: colors.textSecondary,
  },
  card: {
    borderRadius: radii.xl,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  cardFeed: {
    backgroundColor: 'rgba(139,156,247,0.10)',
    borderColor: 'rgba(139,156,247,0.24)',
  },
  cardPractice: {
    backgroundColor: 'rgba(168,85,247,0.10)',
    borderColor: 'rgba(168,85,247,0.24)',
  },
  stepDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.textFaint,
  },
  playerLayout: {
    flex: 1,
  },
  playerHeader: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerControls: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  statBlock: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: typography.stat,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: typography.micro,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 80,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: typography.bodyLg,
    lineHeight: 22,
    textAlign: 'center',
  },
});
}
