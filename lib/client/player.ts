'use client';

/**
 * A thin wrapper over the YouTube IFrame Player API.
 *
 * One player instance per tab, created once and never destroyed between songs. Songs are
 * changed with `loadVideoById` on the existing instance — unmounting the iframe, or
 * hiding it with `display: none`, causes some browsers to pause playback.
 *
 * Types are declared here rather than pulling in `@types/youtube`: this is the entire
 * surface the app uses.
 */

export type YouTubePlayer = {
  loadVideoById(options: {
    videoId: string;
    startSeconds?: number;
    /** Advisory. The frame is 160×90, so the smallest stream looks identical. */
    suggestedQuality?: string;
  }): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
};

type PlayerConstructor = new (
  element: HTMLElement,
  options: {
    height?: string;
    width?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: () => void;
      onError?: (event: { data: number }) => void;
      onStateChange?: (event: { data: number }) => void;
    };
  },
) => YouTubePlayer;

declare global {
  interface Window {
    YT?: { Player: PlayerConstructor };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Player states the IFrame API reports. */
export const PLAYER_STATE = {
  /** Before a load, and after `stopVideo`. Shows the poster. */
  UNSTARTED: -1,
  /** The video finished. Shows YouTube's end screen — share, watch-on-YouTube, suggestions. */
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  /** Stalled mid-song. A spinner, no furniture — not worth covering for. */
  BUFFERING: 3,
  /** Loaded but not playing — where a blocked autoplay attempt lands. */
  CUED: 5,
} as const;

let apiReady: Promise<void> | null = null;

/** Loads the IFrame API script once per tab, however many callers ask for it. */
function loadIframeApi(): Promise<void> {
  if (apiReady) return apiReady;

  apiReady = new Promise<void>((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }

    // The API calls this global when it finishes loading. Chain rather than clobber, in
    // case anything else is already waiting.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return apiReady;
}

export type PlayerHandlers = {
  onError: (code: number) => void;
  /** Fires on every state change; used to re-sync when a local pause is resumed. */
  onStateChange?: (state: number) => void;
};

export async function createPlayer(
  element: HTMLElement,
  handlers: PlayerHandlers,
): Promise<YouTubePlayer> {
  await loadIframeApi();

  const Player = window.YT?.Player;
  if (!Player) throw new Error('YouTube IFrame API failed to load');

  return new Promise<YouTubePlayer>((resolve) => {
    const player = new Player(element, {
      height: '100%',
      width: '100%',
      playerVars: {
        // No related videos, no interfering keyboard shortcuts. The station decides what
        // plays next, not the player.
        rel: 0,
        modestbranding: 1,
        disablekb: 1,
        playsinline: 1,
        // No transport controls at all. You cannot pause a radio, so there must not be a
        // pause button — and since the player auto-resumes anything that pauses it,
        // leaving one visible would just look broken.
        controls: 0,
        // The rest of YouTube's furniture: annotation cards, the fullscreen button, and
        // the end-of-video suggestion grid. None of it belongs on a station display.
        iv_load_policy: 3,
        fs: 0,
        // Muted autoplay is the one kind browsers permit without a gesture. The station
        // therefore runs from the moment the page opens; unmuting is what needs the
        // click, and that click is the gesture.
        autoplay: 1,
        mute: 1,
      },
      events: {
        onReady: () => resolve(player),
        onError: (event) => handlers.onError(event.data),
        onStateChange: (event) => handlers.onStateChange?.(event.data),
      },
    });
  });
}
