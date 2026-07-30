'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Printer } from 'lucide-react';
import { fetchAssetLabel } from '@/lib/endpoints';
import { assetTag, type Asset } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

type LabelFormat = 'svg' | 'png';
type LabelSize = '2x1' | '3x2';

/**
 * Renders the label endpoint output — inline SVG (default) or an <img> for
 * PNG — with a print button (window.print on a print-styled container) and a
 * copy-scan-URL action. The /scan page resolves the copied URL's `code` param.
 */
export function AssetLabelPanel({ asset }: { asset: Asset }) {
  const { toast } = useToast();
  const [format, setFormat] = React.useState<LabelFormat>('svg');
  const [size, setSize] = React.useState<LabelSize>('2x1');
  const [pngUrl, setPngUrl] = React.useState<string | null>(null);

  const labelQuery = useQuery({
    queryKey: ['assets', 'label', asset.id, format, size],
    queryFn: async ({ signal }) => {
      const { blob, contentType } = await fetchAssetLabel(asset.id, { format, size }, signal);
      if (contentType.includes('svg') || contentType.startsWith('text/')) {
        return { kind: 'svg' as const, text: await blob.text() };
      }
      return { kind: 'binary' as const, blob, contentType };
    },
    staleTime: 5 * 60_000,
  });

  // Object URL lifecycle for binary (PNG) labels.
  React.useEffect(() => {
    const data = labelQuery.data;
    if (data?.kind === 'binary') {
      const url = URL.createObjectURL(data.blob);
      setPngUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setPngUrl(null);
      };
    }
    setPngUrl(null);
    return undefined;
  }, [labelQuery.data]);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyScanUrl = async () => {
    const url = `${window.location.origin}/scan?code=${encodeURIComponent(assetTag(asset))}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Scan URL copied', description: url, variant: 'success' });
    } catch {
      toast({
        title: 'Could not copy automatically',
        description: url,
        variant: 'destructive',
        durationMs: 12_000,
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Label</CardTitle>
        <CardDescription>Tag, Code 128 barcode, and QR scan token.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs font-medium">
            Format
            <Select
              aria-label="Label format"
              value={format}
              onChange={(event) => setFormat(event.target.value as LabelFormat)}
            >
              <option value="svg">SVG (crisp print)</option>
              <option value="png">PNG</option>
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Size
            <Select
              aria-label="Label size"
              value={size}
              onChange={(event) => setSize(event.target.value as LabelSize)}
            >
              <option value="2x1">2×1 in (50.8×25.4 mm)</option>
              <option value="3x2">3×2 in (76.2×50.8 mm)</option>
            </Select>
          </label>
        </div>

        {labelQuery.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : labelQuery.isError ? (
          <ErrorState error={labelQuery.error} onRetry={() => labelQuery.refetch()} />
        ) : labelQuery.data ? (
          <div className="asset-label-print-area overflow-x-auto rounded-md border bg-white p-3">
            {labelQuery.data.kind === 'svg' ? (
              <div
                className="mx-auto w-fit [&_svg]:h-auto [&_svg]:max-w-full"
                // SVG comes from our own authenticated API label renderer.
                dangerouslySetInnerHTML={{ __html: labelQuery.data.text }}
              />
            ) : pngUrl ? (
              // Plain <img>: the label blob is an authenticated object URL,
              // which next/image cannot optimize (and must not re-fetch).
              <img
                src={pngUrl}
                alt={`Label for ${assetTag(asset)}`}
                className="mx-auto max-w-full"
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handlePrint} disabled={!labelQuery.data}>
            <Printer aria-hidden /> Print label
          </Button>
          <Button variant="outline" onClick={handleCopyScanUrl}>
            <Copy aria-hidden /> Copy scan URL
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
