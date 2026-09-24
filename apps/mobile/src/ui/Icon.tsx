import { PhosphorIcon, type IconProps } from "./PhosphorIcon";

export function Icon(props: IconProps) {
  return <PhosphorIcon {...props} />;
}

export { isIconName, type IconName } from "./icon-names";
