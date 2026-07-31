'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SortDescending, SpinnerGap } from '@/components/ui/icon';
import {
  CodePilotIcon,
  type CodePilotIconName,
} from '@/components/ui/semantic-icon';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GalleryGrid, type GalleryItem } from '@/components/gallery/GalleryGrid';
import {
  GalleryDetail,
  type AssetMutationResult,
} from '@/components/gallery/GalleryDetail';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

const PAGE_SIZE = 20;

type SortOrder = 'newest' | 'oldest';

const KIND_ICONS: Readonly<Record<string, CodePilotIconName>> = {
  image: 'image',
  video: 'media_video',
  audio: 'media_audio',
  html_bundle: 'web',
};

export default function GalleryPage() {
  const { t, locale } = useTranslation();

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  // Filters
  const [sort, setSort] = useState<SortOrder>('newest');
  const [showFilters, setShowFilters] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [kinds, setKinds] = useState<Array<{
    id: string;
    displayName: { en: string; zh: string };
  }>>([]);

  // Detail
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchItems = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (favoritesOnly) params.set('favoritesOnly', '1');
      if (query.trim()) params.set('query', query.trim());
      if (kind) params.set('kind', kind);
      params.set('sort', sort);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', reset ? '0' : String(offset));

      const res = await fetch(`/api/media/gallery?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (reset) {
          setItems(data.items || []);
          setOffset(PAGE_SIZE);
        } else {
          setItems((prev) => [...prev, ...(data.items || [])]);
          setOffset((prev) => prev + PAGE_SIZE);
        }
        setTotal(data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [
    favoritesOnly,
    kind,
    offset,
    query,
    sort,
  ]);

  useEffect(() => {
    fetch('/api/assets/kinds')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (Array.isArray(data?.kinds)) setKinds(data.kinds);
      })
      .catch(() => {});
  }, []);

  // Initial load and reload on filter changes
  useEffect(() => {
    setOffset(0);
    fetchItems(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, favoritesOnly, query, kind]);

  const handleSelect = useCallback((item: GalleryItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string): Promise<AssetMutationResult> => {
    try {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setTotal((prev) => prev - 1);
        return { ok: true };
      }
      return {
        ok: false,
        error: data.error,
        code: data.code,
        consumers: data.consumers,
      };
    } catch {
      return { ok: false };
    }
  }, []);

  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}/favorite`, { method: 'PUT' });
      if (res.ok) {
        const data = await res.json();
        const favorited = !!data.favorited;
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, favorited } : item
          )
        );
        setSelectedItem((prev) =>
          prev && prev.id === id ? { ...prev, favorited } : prev
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const hasMore = items.length < total;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          loadingRef.current = true;
          fetchItems(false).finally(() => {
            loadingRef.current = false;
          });
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, fetchItems]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search is the primary control; kind filters stay expanded directly
          below it so the toolbar reads top-to-bottom by information priority. */}
      <header className="shrink-0 px-6 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('gallery.searchPlaceholder')}
            className="mr-1 h-8 min-w-64 flex-1 text-xs"
          />
          <Button
            variant={favoritesOnly ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <CodePilotIcon
              name="favorite"
              size="sm"
              strokeWidth={favoritesOnly ? 2 : undefined}
              className={cn(favoritesOnly && 'text-status-error-foreground')}
              aria-hidden
            />
            {t('gallery.favoritesOnly' as TranslationKey)}
          </Button>
          <Button
            variant={showFilters ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
          >
            <CodePilotIcon name="filter" size="sm" aria-hidden />
            {t('gallery.filters' as TranslationKey)}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
          >
            <SortDescending size={14} />
            {sort === 'newest'
              ? t('gallery.newestFirst' as TranslationKey)
              : t('gallery.oldestFirst' as TranslationKey)}
          </Button>
        </div>
        {showFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button
              variant={kind === '' ? 'secondary' : 'outline'}
              size="xs"
              className="gap-1.5 rounded-full px-3"
              onClick={() => setKind('')}
            >
              <CodePilotIcon name="artifact" size={12} aria-hidden />
              {t('gallery.kindAll')}
            </Button>
            {kinds.map((entry) => (
              <Button
                key={entry.id}
                variant={kind === entry.id ? 'secondary' : 'outline'}
                size="xs"
                className="gap-1.5 rounded-full px-3"
                onClick={() => setKind(entry.id)}
              >
                <CodePilotIcon
                  name={KIND_ICONS[entry.id] || 'artifact'}
                  size={12}
                  aria-hidden
                />
                {entry.displayName[locale]}
              </Button>
            ))}
          </div>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-5">
        {/* Gallery content */}
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <CodePilotIcon name="appearance" size={40} className="opacity-30" aria-hidden />
            <p className="text-sm">{t('gallery.empty' as TranslationKey)}</p>
            <p className="text-xs opacity-70">{t('gallery.emptyHint' as TranslationKey)}</p>
          </div>
        ) : (
          <div>
            <GalleryGrid
              items={items}
              onSelect={handleSelect}
            />
            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loading && (
                <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <GalleryDetail
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={handleDelete}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
