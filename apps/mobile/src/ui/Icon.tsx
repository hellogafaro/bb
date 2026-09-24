import { RemixIcon, type IconProps } from "./RemixIcon";

export function Icon(props: IconProps) {
  return <RemixIcon {...props} />;
}

export { isIconName, type IconName } from "./icon-names";
