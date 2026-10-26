import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-foreground shadow-none transition-[border-color,box-shadow] duration-[var(--motion-quick)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";
