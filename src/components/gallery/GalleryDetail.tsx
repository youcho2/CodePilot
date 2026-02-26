'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Download04Icon,
  Delete02Icon,
  PaintBrush01Icon,
  Message02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from '@hugeicons/core-free-icons';
import { cn, parseDBDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { TagManager, type Tag } from './TagManager';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { GalleryItem } from './GalleryGrid';

interface GalleryDetailProps {
  item: GalleryItem | null;
  tags: Tag[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => void;
  onTagsChange?: (id: string, tags: string[]) => void;
}

function imageUrl(img: GalleryItem['images'][0]): string {
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
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function GalleryDetail({
  item,
  tags,
  open,
  onOpenChange,
  onDelete,
  onTagsChange,
}: GalleryDetailProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset image index when item changes
  useEffect(() => {
    setCurrentImageIndex(0);
    setConfirmDelete(false);
  }, [item?.id]);

  const handleDownload = useCallback(async () => {
    if (!item) return;
    const img = item.images[currentImageIndex];
    if (!img) return;

    const url = imageUrl(img);
    const ext = img.mimeType.split('/')[1] || 'png';
    const filename = `generated-${item.id}-${currentImageIndex + 1}.${ext}`;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  }, [item, currentImageIndex]);

  const handleDelete = useCallback(() => {
    if (!item) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete?.(item.id);
    onOpenChange(false);
    setConfirmDelete(false);
  }, [item, confirmDelete, onDelete, onOpenChange]);

  const handleToggleTag = useCallback((tagId: string) => {
    if (!item) return;
    const current = item.tags || [];
    const next = current.includes(tagId)
      ? current.filter((t) => t !== tagId)
      : [...current, tagId];
    onTagsChange?.(item.id, next);
  }, [item, onTagsChange]);

  if (!item) return null;

  const currentImage = item.images[currentImageIndex];
  const hasMultipleImages = item.images.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0" showCloseButton>
        <DialogTitle className="sr-only">
          {t('gallery.imageDetail' as TranslationKey)}
        </DialogTitle>

        {/* Image preview */}
        <div className="relative bg-muted/20 flex items-center justify-center min-h-[300px]">
          {currentImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(currentImage)}
              alt={item.prompt}
              className="max-w-full max-h-[60vh] object-contain"
            />
          )}

          {hasMultipleImages && (
            <>
              <button
                type="button"
                onClick={() => setCurrentImageIndex((i) => (i > 0 ? i - 1 : item.images.length - 1))}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentImageIndex((i) => (i < item.images.length - 1 ? i + 1 : 0))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition"
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="h-5 w-5" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
                {currentImageIndex + 1} / {item.images.length}
              </div>
            </>
          )}
        </div>

        {/* Details */}
        <div className="p-4 space-y-4">
          {/* Prompt */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {t('gallery.prompt' as TranslationKey)}
            </div>
            <p className="text-sm text-foreground leading-relaxed">{item.prompt}</p>
          </div>

          {/* Metadata badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.model && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <HugeiconsIcon icon={PaintBrush01Icon} className="h-3 w-3" />
                {item.model}
              </Badge>
            )}
            {item.aspectRatio && (
              <Badge variant="outline" className="text-[10px]">
                {item.aspectRatio}
              </Badge>
            )}
            {item.imageSize && (
              <Badge variant="outline" className="text-[10px]">
                {item.imageSize}
              </Badge>
            )}
          </div>

          {/* Reference images (垫图) */}
          {item.referenceImages && item.referenceImages.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                {t('imageGen.referenceImages' as TranslationKey)}
              </div>
              <div className="flex gap-2 flex-wrap">
                {item.referenceImages.map((ref, i) => {
                  const src = ref.localPath
                    ? `/api/media/serve?path=${encodeURIComponent(ref.localPath)}`
                    : '';
                  if (!src) return null;
                  return (
                    <div key={i} className="w-14 h-14 rounded-md border border-border/30 overflow-hidden bg-muted/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Date */}
          <div className="text-xs text-muted-foreground">
            {formatDate(item.created_at)}
          </div>

          {/* Tags */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              {t('gallery.tags' as TranslationKey)}
            </div>
            <TagManager
              tags={tags}
              selectedTags={item.tags}
              onToggleTag={handleToggleTag}
              editable={false}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
            {item.session_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  router.push(`/chat/${item.session_id}`);
                }}
              >
                <HugeiconsIcon icon={Message02Icon} className="h-3.5 w-3.5" />
                {t('gallery.openChat' as TranslationKey)}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <HugeiconsIcon icon={Download04Icon} className="h-3.5 w-3.5" />
              {t('gallery.download' as TranslationKey)}
            </Button>
            <div className="ml-auto">
              <Button
                variant={confirmDelete ? 'destructive' : 'ghost'}
                size="sm"
                onClick={handleDelete}
              >
                <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                {confirmDelete
                  ? t('gallery.confirmDelete' as TranslationKey)
                  : t('gallery.delete' as TranslationKey)}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
