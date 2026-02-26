'use client';

import { useState, useEffect, useCallback } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  PaintBrush01Icon,
  SortingDownIcon,
  FilterIcon,
  Loading02Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GalleryGrid, type GalleryItem } from '@/components/gallery/GalleryGrid';
import { GalleryDetail } from '@/components/gallery/GalleryDetail';
import { TagManager, useTags, type Tag } from '@/components/gallery/TagManager';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

const PAGE_SIZE = 20;

type SortOrder = 'newest' | 'oldest';

export default function GalleryPage() {
  const { t } = useTranslation();
  const { tags, loading: tagsLoading, addTag, removeTag, fetchTags } = useTags();

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  // Filters
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [showFilters, setShowFilters] = useState(false);

  // Detail
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchItems = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedTags.length > 0) params.set('tags', selectedTags.join(','));
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
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
  }, [selectedTags, dateFrom, dateTo, sort, offset]);

  // Initial load and reload on filter changes
  useEffect(() => {
    setOffset(0);
    fetchItems(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTags, dateFrom, dateTo, sort]);

  const handleToggleTag = useCallback((tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    );
  }, []);

  const handleSelect = useCallback((item: GalleryItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setTotal((prev) => prev - 1);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleTagsChange = useCallback(async (id: string, newTags: string[]) => {
    try {
      const res = await fetch(`/api/media/${id}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, tags: newTags } : item
          )
        );
        // Update selected item too
        setSelectedItem((prev) =>
          prev && prev.id === id ? { ...prev, tags: newTags } : prev
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const hasMore = items.length < total;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">
            {t('gallery.title' as TranslationKey)}
          </h1>
          <div className="flex items-center gap-2">
            {/* Filter toggle */}
            <Button
              variant={showFilters ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <HugeiconsIcon icon={FilterIcon} className="h-3.5 w-3.5" />
              {t('gallery.filters' as TranslationKey)}
            </Button>

            {/* Sort */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
            >
              <HugeiconsIcon icon={SortingDownIcon} className="h-3.5 w-3.5" />
              {sort === 'newest'
                ? t('gallery.newestFirst' as TranslationKey)
                : t('gallery.oldestFirst' as TranslationKey)}
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="mt-3 space-y-2.5">
            {/* Tag filter */}
            {!tagsLoading && tags.length > 0 && (
              <div>
                <TagManager
                  tags={tags}
                  selectedTags={selectedTags}
                  onToggleTag={handleToggleTag}
                  compact
                />
              </div>
            )}

            {/* Date range */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">
                {t('gallery.dateFrom' as TranslationKey)}
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <label className="text-xs text-muted-foreground">
                {t('gallery.dateTo' as TranslationKey)}
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              {(dateFrom || dateTo || selectedTags.length > 0) && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setSelectedTags([]);
                  }}
                >
                  {t('gallery.clearFilters' as TranslationKey)}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <HugeiconsIcon icon={PaintBrush01Icon} className="h-10 w-10 opacity-30" />
            <p className="text-sm">{t('gallery.empty' as TranslationKey)}</p>
            <p className="text-xs opacity-70">{t('gallery.emptyHint' as TranslationKey)}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <GalleryGrid
              items={items}
              tags={tags}
              onSelect={handleSelect}
            />
            {hasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchItems(false)}
                  disabled={loading}
                >
                  {loading ? (
                    <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t('gallery.loadMore' as TranslationKey)
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <GalleryDetail
        item={selectedItem}
        tags={tags}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={handleDelete}
        onTagsChange={handleTagsChange}
      />
    </div>
  );
}
