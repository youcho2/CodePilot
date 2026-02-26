'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import { PaintBrush01Icon } from '@hugeicons/core-free-icons';
import { parseDBDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Tag } from './TagManager';

export interface GalleryItem {
  id: string;
  prompt: string;
  images: Array<{ data?: string; mimeType: string; localPath?: string }>;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags: string[];
  created_at: string;
  session_id?: string;
  referenceImages?: Array<{ mimeType: string; localPath: string }>;
}

interface GalleryGridProps {
  items: GalleryItem[];
  tags: Tag[];
  onSelect: (item: GalleryItem) => void;
}

function thumbnailUrl(item: GalleryItem): string {
  const img = item.images[0];
  if (!img) return '';
  if (img.localPath) {
    return `/api/media/serve?path=${encodeURIComponent(img.localPath)}`;
  }
  if (img.data) {
    return `data:${img.mimeType};base64,${img.data}`;
  }
  return '';
}

function formatDate(dateStr: string): string {
  try {
    const date = parseDBDate(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function GalleryGrid({ items, tags, onSelect }: GalleryGridProps) {
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const url = thumbnailUrl(item);
        const itemTags = item.tags
          .map((tid) => tagMap.get(tid))
          .filter((t): t is Tag => !!t);

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className="group text-left rounded-lg border border-border/50 bg-card overflow-hidden hover:border-border transition-colors"
          >
            {/* Thumbnail */}
            <div className="relative aspect-square bg-muted/30 overflow-hidden">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={item.prompt}
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <HugeiconsIcon icon={PaintBrush01Icon} className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
              {item.images.length > 1 && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white font-medium">
                  {item.images.length}
                </span>
              )}
            </div>

            {/* Info */}
            <div className="p-2.5 space-y-1.5">
              <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                {item.prompt}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {formatDate(item.created_at)}
                </span>
                {itemTags.length > 0 && (
                  <div className="flex items-center gap-1 overflow-hidden">
                    {itemTags.slice(0, 2).map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color || '#6b7280' }}
                        title={tag.name}
                      />
                    ))}
                    {itemTags.length > 2 && (
                      <span className="text-[9px] text-muted-foreground">+{itemTags.length - 2}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
