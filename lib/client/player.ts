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
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
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

/** Player states the IFrame API reports. Only ENDED and PLAYING matter here. */
export const PLAYER_STATE = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
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
      },
      events: {
        onReady: () => resolve(player),
        onError: (event) => handlers.onError(event.data),
      },
    });
  });
}
