import { useId, type SVGProps } from "react";
import type { PackIcon as PackIconData } from "../pack.js";

export interface PackIconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "ref"> {
  readonly icon: PackIconData;
  /** Width and height. Default 24. */
  readonly size?: number | string;
  /** Accessible name. Without one the icon is decorative and hidden from assistive technology. */
  readonly title?: string;
}

/** Renders an icon from a pack (`@hedronite/lts-icons/packs/<id>`), in its own grid and paint. */
export function PackIcon({ icon, size = 24, title, ...rest }: PackIconProps) {
  const titleId = useId();
  const a11y = title === undefined ? { "aria-hidden": true } : { role: "img", "aria-labelledby": titleId };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={icon.viewBox} {...icon.paint} {...a11y} {...rest}>
      {title === undefined ? null : <title id={titleId}>{title}</title>}
      {icon.paths.map((path, index) => (
        // Paths have no identity beyond their order, and an icon never reorders them.
        <path key={index} {...path} />
      ))}
    </svg>
  );
}
