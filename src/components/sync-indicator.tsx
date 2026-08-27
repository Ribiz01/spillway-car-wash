'use client';

import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/firebase/sync-status';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Small always-visible badge telling the attendant whether their washes have
 * actually reached the server. Silence here is dangerous: an attendant who
 * doesn't know they're offline will assume the day's takings are safely saved.
 */
export function SyncIndicator({ className }: { className?: string }) {
  const { isOnline, isServerReachable, pendingWrites } = useSyncStatus();

  // 'unreachable' is the case navigator.onLine alone cannot see: the tablet has
  // a connection, but it is too slow or too filtered for Firestore to hold a
  // channel open. Reporting that as "Synced" is the dangerous lie here.
  const state = !isOnline
    ? 'offline'
    : !isServerReachable
      ? 'unreachable'
      : pendingWrites > 0
        ? 'syncing'
        : 'synced';

  const config = {
    offline: {
      icon: CloudOff,
      label: pendingWrites > 0 ? `Offline · ${pendingWrites} queued` : 'Offline',
      tooltip:
        pendingWrites > 0
          ? `${pendingWrites} wash${pendingWrites === 1 ? '' : 'es'} saved on this device. They will upload automatically once you have signal — don't clear the browser data.`
          : 'No connection. You can keep recording washes; they will upload when signal returns.',
      classes: 'bg-destructive/10 text-destructive border-destructive/30',
      spin: false,
    },
    unreachable: {
      icon: CloudOff,
      label: pendingWrites > 0 ? `No server · ${pendingWrites} queued` : 'No server',
      tooltip:
        pendingWrites > 0
          ? `This tablet has a connection but cannot reach the server, so ${pendingWrites} wash${pendingWrites === 1 ? '' : 'es'} ${pendingWrites === 1 ? 'is' : 'are'} still only saved here. Keep working — they upload once the connection improves.`
          : 'This tablet has a connection but cannot reach the server right now. Washes are saved here and will upload once the connection improves.',
      classes: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      spin: false,
    },
    syncing: {
      icon: RefreshCw,
      label: `Syncing ${pendingWrites}`,
      tooltip: `${pendingWrites} wash${pendingWrites === 1 ? '' : 'es'} uploading now.`,
      classes: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      spin: true,
    },
    synced: {
      icon: Cloud,
      label: 'Synced',
      tooltip: "All of today's washes are saved to the server.",
      classes: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      spin: false,
    },
  }[state];

  const Icon = config.icon;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              config.classes,
              className
            )}
          >
            <Icon className={cn('h-3.5 w-3.5', config.spin && 'animate-spin')} />
            <span className="hidden sm:inline">{config.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          {config.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
