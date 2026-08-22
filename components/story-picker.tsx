"use client";

import { useEffect, useState } from "react";

/**
 * Picks one of the account's currently-active stories.
 *
 * Deliberately simpler than PostPicker: stories have no captions (nothing to
 * search), never exceed a 24-hour window (nothing to paginate), and expire
 * constantly — so it always fetches live rather than reading the session
 * cache, where a hit would offer a story that is already gone.
 *
 * Only the story id is reported upward. Meta forbids storing story media, so
 * thumbnails stay live-fetched and are never persisted.
 */

interface InstagramStory {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
}

interface StoryPickerProps {
  selectedStoryId: string | null;
  instagramAccountId?: string | null;
  onSelect: (storyId: string) => void;
}

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** "expires in 7h" / "expires in 40m" from the story's post time. */
function expiresIn(timestamp: string): string | null {
  const left = new Date(timestamp).getTime() + STORY_LIFETIME_MS - Date.now();
  if (!Number.isFinite(left) || left <= 0) return null;
  const hours = Math.floor(left / (60 * 60 * 1000));
  if (hours >= 1) return `expires in ${hours}h`;
  return `expires in ${Math.max(1, Math.round(left / 60000))}m`;
}

export function StoryPicker({
  selectedStoryId,
  instagramAccountId,
  onSelect,
}: StoryPickerProps) {
  const [stories, setStories] = useState<InstagramStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Resetting on an account switch is a legitimate effect use — same
    // exception post-picker.tsx takes for its cache hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    const params = new URLSearchParams();
    if (instagramAccountId) params.set("instagramAccountId", instagramAccountId);

    fetch(`/api/instagram/stories${params.size ? `?${params}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) setStories(data.data);
        else setError(data.error ?? "Failed to load stories");
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load stories");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instagramAccountId]);

  if (loading) {
    return <p className="px-1 py-2 text-xs text-muted">Loading stories…</p>;
  }

  if (error) {
    return <p className="px-1 py-2 text-xs text-error">{error}</p>;
  }

  // A campaign can be pinned to a story that has since expired. Say so plainly
  // instead of rendering an empty grid that looks broken.
  const selectedIsGone =
    selectedStoryId !== null && !stories.some((s) => s.id === selectedStoryId);

  if (stories.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-muted">
        No active stories right now. Post a story, then pick it here — or choose
        “any story” above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {selectedIsGone && (
        <p className="px-1 text-[11px] text-warning">
          The story this campaign was pinned to has expired, so it no longer
          triggers. Pick a current story below.
        </p>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 auto-rows-min content-start overflow-y-auto p-1">
        {stories.map((story) => {
          const isSelected = selectedStoryId === story.id;
          const thumb = story.thumbnail_url ?? story.media_url;
          const left = expiresIn(story.timestamp);
          return (
            <button
              key={story.id}
              type="button"
              onClick={() => onSelect(story.id)}
              aria-pressed={isSelected}
              title={left ?? undefined}
              className={`
                relative aspect-square rounded overflow-hidden border-2
                ${isSelected ? "border-accent" : "border-border hover:border-border-hover"}
              `}
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface text-[10px] text-muted">
                  {story.media_type}
                </div>
              )}
              {left && (
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-[9px] text-white">
                  {left}
                </span>
              )}
              {isSelected && (
                <span className="absolute inset-x-0 top-0 bg-accent px-1 py-0.5 text-[9px] font-semibold text-white">
                  Selected
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default StoryPicker;
