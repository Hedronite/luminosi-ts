import { useId, type SVGProps } from "react";
import { ICON_VIEW_BOX, type IconData } from "../icon.js";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "ref"> {
  /** Width and height. Default 24. */
  readonly size?: number | string;
  /** Accessible name. Without one the icon is decorative and hidden from assistive technology. */
  readonly title?: string;
}

/** Renders any icon's data. The generated components (`ArrowRight`, …) wrap this. */
export function Icon({ icon, size = 24, title, strokeWidth = 2, ...rest }: IconProps & { readonly icon: IconData }) {
  const titleId = useId();
  const a11y = title === undefined ? { "aria-hidden": true } : { role: "img", "aria-labelledby": titleId };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      {title === undefined ? null : <title id={titleId}>{title}</title>}
      {icon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
