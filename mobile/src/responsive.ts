import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from './design';

function clampToAvailable(value: number, min: number, max: number) {
  const cappedMax = Math.min(max, value);
  const cappedMin = Math.min(min, cappedMax);
  return Math.max(cappedMin, cappedMax);
}

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return useMemo(() => {
    const shortestSide = Math.min(width, height);
    const isLandscape = width > height;
    const isTablet = shortestSide >= layout.tabletBreakpoint;
    const isCompactPhone = !isTablet && shortestSide < layout.compactPhoneBreakpoint;
    const pageHorizontalPadding = isTablet
      ? layout.pagePaddingTablet
      : isCompactPhone
        ? layout.pagePaddingCompact
        : layout.pagePadding;
    const availableWidth = Math.max(0, width - pageHorizontalPadding * 2);
    const contentMaxWidth = isTablet
      ? Math.min(
          availableWidth,
          isLandscape ? layout.contentMaxWidthLandscape : layout.contentMaxWidthTablet
        )
      : availableWidth;
    const modalMaxWidth = isTablet
      ? Math.min(
          availableWidth,
          isLandscape ? layout.modalMaxWidthLandscape : layout.modalMaxWidthTablet
        )
      : availableWidth;
    const menuWidth = Math.min(
      availableWidth,
      isTablet ? layout.menuMaxWidthTablet : layout.menuMaxWidthPhone,
      width * (isTablet ? 0.42 : 0.86)
    );
    const playerMaxWidth = isTablet
      ? isLandscape
        ? layout.playerContentMaxWidthLandscape
        : layout.playerContentMaxWidthTablet
      : layout.playerContentMaxWidthPhone;
    const playerContentWidth = clampToAvailable(
      availableWidth,
      layout.playerContentMinWidth,
      playerMaxWidth
    );

    return {
      windowWidth: width,
      windowHeight: height,
      insets,
      isLandscape,
      isTablet,
      isCompactPhone,
      pageHorizontalPadding,
      contentMaxWidth,
      modalMaxWidth,
      menuWidth,
      playerContentWidth,
      playerHeaderHeight: isTablet ? layout.playerHeaderHeightTablet : layout.playerHeaderHeight,
      playerControlsHeight: isTablet ? layout.playerControlsHeightTablet : layout.playerControlsHeight,
      touchTarget: layout.minTouchTarget,
    };
  }, [height, insets, width]);
}
