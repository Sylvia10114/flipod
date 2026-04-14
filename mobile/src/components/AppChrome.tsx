import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, radii, spacing, typography } from '../design';

type ScreenSurfaceProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenSurface({ children, style }: ScreenSurfaceProps) {
  return <SafeAreaView style={[styles.surface, style]}>{children}</SafeAreaView>;
}

type ScreenHeaderProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  title: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeader({ leading, trailing, title, subtitle, style }: ScreenHeaderProps) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.headerSlot}>{leading}</View>
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.headerSlot, styles.headerSlotEnd]}>{trailing}</View>
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
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pillButton,
        subtle && styles.pillButtonSubtle,
        active && styles.pillButtonActive,
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
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  style,
}: ActionButtonProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        variant === 'secondary' && styles.actionButtonSecondary,
        variant === 'success' && styles.actionButtonSuccess,
        variant === 'danger' && styles.actionButtonDanger,
        disabled && styles.actionButtonDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          variant === 'secondary' && styles.actionButtonTextSecondary,
          disabled && styles.actionButtonTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type GlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'feed' | 'practice';
};

export function GlassCard({ children, style, tone = 'default' }: GlassCardProps) {
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

export function StepDots({ count = 4, active, accent = colors.accentPractice }: StepDotsProps) {
  return (
    <View style={styles.stepDots}>
      {Array.from({ length: count }).map((_, index) => {
        const dotIndex = index + 1;
        return (
          <View
            key={`dot-${dotIndex}`}
            style={[
              styles.stepDot,
              dotIndex === active && { backgroundColor: accent, width: 14, height: 14 },
              dotIndex !== active && dotIndex < active && { backgroundColor: `${accent}88` },
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
  return (
    <View style={[styles.playerLayout, style]}>
      <View style={styles.playerHeader}>{header}</View>
      <View style={styles.playerContent}>{children}</View>
      <View style={styles.playerControls}>{controls}</View>
      {overlays}
    </View>
  );
}

type StatBlockProps = {
  value: string | number;
  label: string;
  accent?: string;
};

export function StatBlock({ value, label, accent = colors.textPrimary }: StatBlockProps) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type EmptyStateProps = {
  title: string;
  body: string;
};

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  header: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerSlot: {
    minWidth: 52,
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
    minHeight: 36,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
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
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accentFeed,
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
    paddingHorizontal: layout.pagePadding,
  },
  playerHeader: {
    height: layout.playerHeaderHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerControls: {
    height: layout.playerControlsHeight,
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
