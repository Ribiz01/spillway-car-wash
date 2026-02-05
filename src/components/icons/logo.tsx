import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-8 text-primary", className)}
    >
      <path d="M12 22a10 10 0 1 0-2.5-4" />
      <path d="m16 13.5 4 4" />
      <path d="M16 8.5 20 12" />
      <path d="m14 15.5 4 4" />
      <path d="m14 6.5 4 4" />
      <path d="M4 16.5c.5.5 1.4.5 2 0" />
      <path d="M4 12.5c.5.5 1.4.5 2 0" />
      <path d="M4 8.5c.5.5 1.4.5 2 0" />
    </svg>
  );
}
