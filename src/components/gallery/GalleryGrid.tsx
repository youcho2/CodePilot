'use client';

import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export interface GalleryItem {
  id: string;
  /** Generation provider (e.g. 'gemini', 'codex', 'cli-import'). Used by
   *  the UI to label the engine that produced the image. */
  provider?: string;
  prompt: string;
  title?: string;
  images: Array<{ data?: string; mimeType: string; localPath?: string }>;
  type?: 'image' | 'video' | 'audio' | 'html_bundle';
  kind?: 'image' | 'video' | 'audio' | 'html_bundle';
  previewUrl?: string;
  producerId?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags: string[];
  favorited?: boolean;
  created_at: string;
  session_id?: string;
  projectId?: string;
  runtimeId?: string;
  methodRef?: string;
  contentHash?: string;
  integrityState?: 'valid' | 'missing' | 'modified';
  integrityReason?: string;
  trustTier?: string;
  referenceImages?: Array<{ mimeType: string; localPath: string }>;
}

interface GalleryGridProps {
  items: GalleryItem[];
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

function isVideoItem(item: GalleryItem): boolean {
  if (item.type === 'video') return true;
  const img = item.images[0];
  return !!img?.mimeType?.startsWith('video/');
}

function isAudioItem(item: GalleryItem): boolean {
  if (item.type === 'audio') return true;
  const media = item.images[0];
  return !!media?.mimeType?.startsWith('audio/');
}

export function GalleryGrid({ items, onSelect }: GalleryGridProps) {
  const { t } = useTranslation();
  return (
    <div
      className="grid items-start gap-3"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, 16rem)',
      }}
    >
      {items.map((item) => {
        const url = thumbnailUrl(item);
        const isVideo = isVideoItem(item);
        const isAudio = isAudioItem(item);
        const isHtml = item.type === 'html_bundle';
        const displayTitle =
          isHtml && item.title?.trim() ? item.title.trim() : item.prompt;
        const integrityFailed =
          item.integrityState && item.integrityState !== 'valid';
        const promptPreview = displayTitle.length > 80
          ? `${displayTitle.slice(0, 80)}…`
          : displayTitle;
        const ariaKey: TranslationKey = isVideo
          ? 'gallery.playVideoAria'
          : isAudio
            ? 'gallery.playAudioAria'
            : 'gallery.openItemAria';

        return (
          // role="button" + tabIndex + Enter/Space handler — image
          // tiles are the primary activator on this page; without
          // these the a11y tree only exposes them as "image" and
          // keyboard / screen-reader users have no way in.
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={t(ariaKey, { prompt: promptPreview })}
            className="w-64 cursor-pointer overflow-hidden rounded-lg bg-card ring-0 transition-all hover:ring-2 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(item);
              }
            }}
          >
            <div className="relative bg-muted/30">
              {integrityFailed ? (
                <div
                  className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center"
                  title={item.integrityReason}
                >
                  <CodePilotIcon name="warning" size="lg" className="text-status-warning-foreground" aria-hidden />
                  <span className="text-xs text-muted-foreground">
                    {t(
                      item.integrityState === 'missing'
                        ? 'gallery.integrity.missing'
                        : 'gallery.integrity.modified',
                    )}
                  </span>
                </div>
              ) : isHtml && item.previewUrl ? (
                <div className="relative aspect-video w-full overflow-hidden bg-background">
                  <iframe
                    src={item.previewUrl}
                    sandbox=""
                    loading="lazy"
                    title={displayTitle}
                    className="pointer-events-none absolute left-0 top-0 h-[720px] w-[1280px] origin-top-left scale-[0.2] border-0 bg-white"
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[10px] text-foreground shadow-sm backdrop-blur-sm">
                    <CodePilotIcon name="web" size={12} className="mr-1 inline" aria-hidden />
                    {t('gallery.staticWebPreview')}
                  </span>
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-2 pt-8 text-xs font-medium text-white">
                    <span className="block truncate">{displayTitle}</span>
                  </span>
                </div>
              ) : isAudio && url ? (
                <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted/40">
                  <CodePilotIcon name="media_audio" size="xl" className="text-muted-foreground" aria-hidden />
                  <span className="px-3 text-center text-xs text-muted-foreground">
                    {t('gallery.audioPreview')}
                  </span>
                </div>
              ) : url ? (
                isVideo ? (
                   
                  <video
                    src={url}
                    muted
                    preload="metadata"
                    className="block w-full h-auto"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={item.prompt}
                    className="block w-full h-auto"
                    loading="lazy"
                  />
                )
              ) : (
                <div className="flex aspect-square items-center justify-center">
                  <CodePilotIcon name="appearance" size="xl" className="text-muted-foreground/30" aria-hidden />
                </div>
              )}
              {isVideo && url && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                    <CodePilotIcon name="play" size="lg" strokeWidth={2} className="text-white ml-0.5" aria-hidden />
                  </span>
                </span>
              )}
              {isAudio && url && (
                <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/55 px-2 py-1 text-center text-[10px] text-white backdrop-blur-sm">
                  {t('gallery.audioPreview')}
                </span>
              )}
              {item.images.length > 1 && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white font-medium">
                  {item.images.length}
                </span>
              )}
              {item.favorited && (
                <span className={isHtml
                  ? 'absolute right-2 top-2'
                  : 'absolute left-1.5 top-1.5'}
                >
                  <CodePilotIcon name="favorite" size="md" strokeWidth={2} className="text-status-error-foreground drop-shadow" aria-hidden />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
