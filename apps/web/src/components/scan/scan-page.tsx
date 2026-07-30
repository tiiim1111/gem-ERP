'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Camera, Keyboard, PackageSearch, ScanLine, TextCursorInput } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { resolveScanCode } from '@/lib/endpoints';
import {
  scanKind,
  scanSummaryDetail,
  scanSummaryText,
  scanTargetId,
  type ScanResolution,
} from '@/lib/types';
import { cn, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { CameraScanner, isBarcodeDetectorSupported } from './camera-scanner';

type ScanMode = 'wedge' | 'camera' | 'manual';

/** Success beep / error buzz via AudioContext (no audio assets needed). */
function useScanSounds() {
  const contextRef = React.useRef<AudioContext | null>(null);

  const play = React.useCallback((kind: 'success' | 'error') => {
    try {
      type AudioContextCtor = new () => AudioContext;
      const Ctor =
        (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      contextRef.current = contextRef.current ?? new Ctor();
      const context = contextRef.current;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = 'square';
      oscillator.frequency.value = kind === 'success' ? 1400 : 220;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    } catch {
      // Audio feedback is best-effort only.
    }
  }, []);

  return play;
}

interface RecentScan {
  code: string;
  at: number;
  kind?: string;
  label?: string;
  id?: string | null;
  error?: string;
}

export function ScanPage({ initialCode }: { initialCode?: string }) {
  const { canAny } = useSession();
  const playSound = useScanSounds();

  const cameraSupported = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    () => isBarcodeDetectorSupported(),
    () => false,
  );

  const [mode, setMode] = React.useState<ScanMode>('wedge');
  const [wedgeValue, setWedgeValue] = React.useState('');
  const [manualValue, setManualValue] = React.useState('');
  const [result, setResult] = React.useState<{ code: string; resolution: ScanResolution } | null>(null);
  const [resolveError, setResolveError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<RecentScan[]>([]);
  const wedgeInputRef = React.useRef<HTMLInputElement>(null);
  const lastScanRef = React.useRef<{ code: string; at: number } | null>(null);

  const resolveMutation = useMutation({
    mutationFn: (code: string) => resolveScanCode(code),
    onSuccess: (resolution, code) => {
      playSound('success');
      navigator.vibrate?.(80);
      setResolveError(null);
      setResult({ code, resolution });
      setRecent((current) =>
        [
          {
            code,
            at: Date.now(),
            kind: scanKind(resolution),
            label: scanSummaryText(resolution),
            id: scanTargetId(resolution),
          },
          ...current,
        ].slice(0, 5),
      );
    },
    onError: (error, code) => {
      playSound('error');
      navigator.vibrate?.([60, 60, 60]);
      const message =
        isApiClientError(error) && error.status === 404
          ? `No record matches “${code}”.`
          : getErrorMessage(error);
      setResolveError(message);
      setRecent((current) => [{ code, at: Date.now(), error: message }, ...current].slice(0, 5));
    },
  });

  const submitCode = React.useCallback(
    (raw: string, options: { dedupe?: boolean } = {}) => {
      const code = raw.trim();
      if (!code || resolveMutation.isPending) return;
      if (options.dedupe) {
        const last = lastScanRef.current;
        // Duplicate-scan guard: ignore the same code within 3 seconds.
        if (last && last.code === code && Date.now() - last.at < 3000) return;
      }
      lastScanRef.current = { code, at: Date.now() };
      setResolveError(null);
      resolveMutation.mutate(code);
    },
    [resolveMutation],
  );

  // Auto-resolve a ?code= arriving from a copied scan URL.
  const initialResolved = React.useRef(false);
  React.useEffect(() => {
    if (initialCode && !initialResolved.current) {
      initialResolved.current = true;
      submitCode(initialCode);
    }
  }, [initialCode, submitCode]);

  // Keyboard-wedge mode: keep the input focused so scanners can type + Enter,
  // but never steal focus from another control the user tabbed/clicked into.
  const resultOpen = result !== null;
  React.useEffect(() => {
    if (mode !== 'wedge' || resultOpen) return;
    const focus = () => wedgeInputRef.current?.focus();
    focus();
    const interval = setInterval(() => {
      if (document.activeElement === document.body) focus();
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, resultOpen]);

  const modes: Array<{ id: ScanMode; label: string; icon: typeof Keyboard; available: boolean }> = [
    { id: 'wedge', label: 'Scanner', icon: Keyboard, available: true },
    { id: 'camera', label: 'Camera', icon: Camera, available: cameraSupported },
    { id: 'manual', label: 'Manual', icon: TextCursorInput, available: true },
  ];

  const resolution = result?.resolution ?? null;
  const kind = resolution ? scanKind(resolution) : '';
  const targetId = resolution ? scanTargetId(resolution) : null;
  const canQuickAssign =
    kind === 'asset' &&
    canAny([PERMISSIONS.asset.assign]) &&
    (resolution?.permittedActions?.includes('assign') ?? false);
  const canQuickReturn =
    kind === 'asset' &&
    canAny([PERMISSIONS.asset.assign, PERMISSIONS.asset.return]) &&
    (resolution?.permittedActions?.includes('return') ?? false);

  return (
    <>
      <PageHeader
        title="Scan"
        description="USB/Bluetooth scanner, camera, or manual entry — resolve any tag, SKU, lot, or bin."
      />

      <div className="mx-auto max-w-xl space-y-4">
        {/* Mode switch — thumb-friendly */}
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Scan input mode">
          {modes
            .filter((entry) => entry.available)
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={mode === entry.id}
                onClick={() => setMode(entry.id)}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mode === entry.id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'hover:border-primary/40',
                )}
              >
                <entry.icon className="h-5 w-5" aria-hidden />
                {entry.label}
              </button>
            ))}
        </div>
        {!cameraSupported ? (
          <p className="text-xs text-muted-foreground">
            Camera scanning needs a browser with the BarcodeDetector API (Chrome/Edge on Android or
            desktop). Scanner and manual entry work everywhere.
          </p>
        ) : null}

        <FormError message={resolveError} />

        {mode === 'wedge' ? (
          <Card>
            <CardContent className="space-y-3 pt-4 sm:pt-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ScanLine className="h-4 w-4" aria-hidden />
                Ready — point the scanner and pull the trigger. The field stays focused.
              </div>
              <Input
                ref={wedgeInputRef}
                value={wedgeValue}
                onChange={(event) => setWedgeValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitCode(wedgeValue);
                    setWedgeValue('');
                  }
                }}
                placeholder="Waiting for scan…"
                aria-label="Scanned code"
                autoComplete="off"
                className="h-14 text-center font-mono text-lg"
              />
            </CardContent>
          </Card>
        ) : null}

        {mode === 'camera' && cameraSupported ? (
          <CameraScanner active={mode === 'camera' && !resultOpen} onDetect={(code) => submitCode(code, { dedupe: true })} />
        ) : null}

        {mode === 'manual' ? (
          <Card>
            <CardContent className="pt-4 sm:pt-5">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCode(manualValue);
                  setManualValue('');
                }}
              >
                <Input
                  value={manualValue}
                  onChange={(event) => setManualValue(event.target.value)}
                  placeholder="Type a tag, SKU, lot, or bin code…"
                  aria-label="Code to resolve"
                  autoComplete="off"
                  className="h-12 font-mono"
                />
                <Button
                  type="submit"
                  className="h-12 sm:w-32"
                  loading={resolveMutation.isPending}
                  disabled={!manualValue.trim()}
                >
                  Resolve
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {/* Recent scans */}
        {recent.length > 0 ? (
          <Card>
            <CardContent className="pt-4 sm:pt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent scans
              </p>
              <ul className="divide-y">
                {recent.map((entry, index) => (
                  <li key={`${entry.code}-${entry.at}-${index}`} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">{entry.code}</span>
                      <span className={cn('block truncate text-xs', entry.error ? 'text-destructive' : 'text-muted-foreground')}>
                        {entry.error ?? entry.label}
                      </span>
                    </span>
                    {entry.kind ? <Badge variant="outline">{humanize(entry.kind)}</Badge> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Result action sheet (bottom sheet on mobile) */}
      <Dialog open={resultOpen} onOpenChange={(open) => !open && setResult(null)}>
        <DialogHeader>
          <DialogTitle>{resolution ? scanSummaryText(resolution) : ''}</DialogTitle>
          <DialogDescription>
            {resolution
              ? [humanize(kind || 'record'), scanSummaryDetail(resolution)].filter(Boolean).join(' · ')
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {kind === 'asset' && targetId ? (
            <>
              <Link
                href={`/assets/${targetId}`}
                className={cn(buttonVariants({}), 'h-12 w-full')}
                onClick={() => setResult(null)}
              >
                <PackageSearch aria-hidden /> View asset
              </Link>
              {canQuickAssign ? (
                <Link
                  href={`/assets/${targetId}?action=assign`}
                  className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full')}
                  onClick={() => setResult(null)}
                >
                  Assign to employee
                </Link>
              ) : null}
              {canQuickReturn ? (
                <Link
                  href={`/assets/${targetId}?action=return`}
                  className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full')}
                  onClick={() => setResult(null)}
                >
                  Return from custody
                </Link>
              ) : null}
            </>
          ) : null}

          {kind === 'item' && targetId ? (
            <>
              {canAny([PERMISSIONS.item.view]) ? (
                <Link
                  href={`/items/${targetId}`}
                  className={cn(buttonVariants({}), 'h-12 w-full')}
                  onClick={() => setResult(null)}
                >
                  <PackageSearch aria-hidden /> View item
                </Link>
              ) : null}
              {canAny([PERMISSIONS.inventory.view]) ? (
                <Link
                  href={`/inventory/balances?itemId=${targetId}`}
                  className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full')}
                  onClick={() => setResult(null)}
                >
                  View stock balances
                </Link>
              ) : null}
            </>
          ) : null}

          {kind === 'lot' ? (
            canAny([PERMISSIONS.inventory.view]) ? (
              <Link
                href="/inventory/lots"
                className={cn(buttonVariants({}), 'h-12 w-full')}
                onClick={() => setResult(null)}
              >
                <PackageSearch aria-hidden /> View lots
              </Link>
            ) : null
          ) : null}

          {kind === 'location' && targetId ? (
            canAny([PERMISSIONS.inventory.view]) ? (
              <Link
                href={`/inventory/balances?locationId=${targetId}`}
                className={cn(buttonVariants({}), 'h-12 w-full')}
                onClick={() => setResult(null)}
              >
                <PackageSearch aria-hidden /> View bin contents
              </Link>
            ) : null
          ) : null}

          <Button variant="ghost" className="h-12 w-full" onClick={() => setResult(null)}>
            Scan next
          </Button>
        </DialogBody>
      </Dialog>
    </>
  );
}
