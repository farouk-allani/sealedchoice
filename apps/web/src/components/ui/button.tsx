import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";
import { Icon } from "./icon.tsx";

type ButtonStyle = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "small" | "medium";
  children: ReactNode;
};

function buttonClass(
  { variant = "primary", size = "medium" }: Omit<ButtonStyle, "children">,
  className = "",
) {
  return `ui-button ui-button--${variant} ui-button--${size} ${className}`.trim();
}

export function Button({
  variant,
  size,
  loading = false,
  disabled,
  children,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonStyle & { loading?: boolean }) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClass({ variant, size }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Icon name="refresh" className="ui-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonStyle) {
  return (
    <a {...props} className={buttonClass({ variant, size }, className)}>
      {children}
    </a>
  );
}
