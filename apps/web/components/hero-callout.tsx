import { cn } from '@/lib/utils'

const CALLOUT = 'This is a real video editor, click it!'

export function HeroCallout({ hidden, className }: { hidden: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden flex-col items-start gap-1 pt-10 text-muted-foreground transition-opacity duration-300 select-none motion-reduce:transition-none xl:flex',
        hidden && 'opacity-0',
        className,
      )}
    >
      <svg
        viewBox="0 0 72 40"
        className="-ml-3 h-10 w-auto shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M68 34c-10 2-19-2-28-6-8-4-14-9-20-14-3-3-6-5-9-8" />
        <path d="M12 18c-1-4-1-8-1-12 4 1 8 1 12 2" />
      </svg>
      <span className="ml-4 max-w-[12rem] -rotate-2 text-[1.35rem] leading-tight" style={{ fontFamily: "var(--font-hand), 'Caveat', cursive" }}>
        {CALLOUT}
      </span>
    </div>
  )
}
