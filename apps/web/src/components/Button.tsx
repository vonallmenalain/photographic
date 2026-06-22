import { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  icon?: ReactNode;
};

export function Button({
  children,
  className = "",
  variant = "primary",
  icon,
  ...props
}: ButtonProps) {
  const variantClass = variant === "primary" ? "" : variant;
  return (
    <button className={`button ${variantClass} ${className}`.trim()} {...props}>
      {icon}
      {children}
    </button>
  );
}
