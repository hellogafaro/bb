import type { SFSymbolEffect } from "expo-image";
import type { ImageStyle, StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { ICON_MAP } from "./icon-map";
import type { IconName } from "./icon-names";
import type { SFSymbol, SFSymbolWeight } from "./sf-symbol-map";

export const ICON_SIZE_DEFAULT = 20;

export type IconStyle = ViewStyle & ImageStyle;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  weight?: SFSymbolWeight;
  symbol?: SFSymbol;
  effect?: SFSymbolEffect;
  style?: StyleProp<IconStyle>;
  accessibilityLabel?: string;
}

export function PhosphorIcon({
  name,
  size = ICON_SIZE_DEFAULT,
  color,
  style,
  accessibilityLabel,
}: IconProps) {
  const { tokens } = useTheme();
  const Glyph = ICON_MAP[name];
  return (
    <View
      style={style}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel === undefined ? undefined : "image"}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={
        accessibilityLabel === undefined ? "no-hide-descendants" : "auto"
      }
    >
      <Glyph size={size} color={color ?? tokens.foreground} weight="bold" />
    </View>
  );
}
