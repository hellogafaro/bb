import { Image } from "expo-image";
import { useTheme } from "@/theme/ThemeProvider";
import {
  ICON_SIZE_DEFAULT,
  PhosphorIcon,
  type IconProps,
} from "./PhosphorIcon";
import {
  SF_SYMBOL_WEIGHT,
  SF_SYMBOL_WEIGHTS,
  sfSymbolFor,
} from "./sf-symbol-map";

export function Icon({
  name,
  size = ICON_SIZE_DEFAULT,
  color,
  weight = SF_SYMBOL_WEIGHT,
  symbol: symbolOverride,
  effect,
  style,
  accessibilityLabel,
}: IconProps) {
  const { tokens } = useTheme();
  const symbol = symbolOverride ?? sfSymbolFor(name);
  if (symbol === undefined) {
    return (
      <PhosphorIcon
        name={name}
        size={size}
        color={color}
        style={style}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  return (
    <Image
      source={`sf:${symbol}`}
      tintColor={color ?? tokens.foreground}
      contentFit="contain"
      sfEffect={effect}
      style={[
        {
          width: size,
          height: size,
          fontSize: size,
          fontWeight: SF_SYMBOL_WEIGHTS[weight],
        },
        style,
      ]}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={
        accessibilityLabel === undefined ? "no-hide-descendants" : "auto"
      }
    />
  );
}

export { isIconName, type IconName } from "./icon-names";
