import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './env';
import type {
  AiContextItem,
  AiConversation,
  AiMode,
  AiMessage,
  AiOutboundEntry,
  AiSendPreview,
  AiSendResult,
  AiStatus,
  AppInfo,
  Asset,
  AssetSearchResult,
  AssetType,
  CacheStats,
  ChartPoint,
  ChartRange,
  CommunityFilter,
  CommunityPost,
  FeedPreview,
  LearningProgress,
  LocalModelOverview,
  DownloadProgress,
  NewsArticle,
  NewsCategory,
  NewsFeed,
  NewsFilter,
  Note,
  ProgressStatus,
  Preferences,
  ProviderInfo,
  Quote,
  UpdateCheck,
  ExportResult,
  ImportMode,
  ImportResult,
  ProfileSummary,
  Watchlist,
  WatchlistItem,
} from '@/types/domain';
import type { Envelope } from '@/types/envelope';

/**
 * The IPC surface.
 *
 * The frontend never sends SQL and never sends a URL — commands are verb-shaped and typed.
 * This map is the whole contract; anything not listed here cannot be called. See ADR-002.
 */

/** Dev-only lever for forcing the mock provider into a particular failure mode. */
export type MockBehavior =
  'normal' | 'slow' | 'empty' | 'stale' | 'rate-limited' | 'error' | 'not-configured';

export interface ProviderTestResult {
  ok: boolean;
  /** User-safe: never carries a key, a URL, or a provider body. */
  message: string;
}

export interface AiTestResult {
  ok: boolean;
  /** User-safe: never carries a key, a URL, or an endpoint body. */
  message: string;
  /** Whether the configured model name was one the endpoint listed. */
  modelAvailable: boolean | null;
  reachLabel: string;
}

export interface IpcContract {
  // --- app ---
  get_app_info: { args: undefined; result: AppInfo };

  // --- settings ---
  get_preferences: { args: undefined; result: Preferences };
  set_preference: { args: { key: string; value: string }; result: null };
  list_providers: { args: undefined; result: ProviderInfo[] };
  set_provider_enabled: { args: { providerId: string; enabled: boolean }; result: null };
  /**
   * The only command that carries a credential, and only inward. The result is a masked
   * hint — the key itself is never sent back. See THREAT_MODEL.md §4.
   */
  save_provider_credential: { args: { providerId: string; apiKey: string }; result: string };
  delete_provider_credential: { args: { providerId: string }; result: null };
  test_provider: { args: { providerId: string }; result: ProviderTestResult };

  // --- watchlists ---
  list_watchlists: { args: undefined; result: Watchlist[] };
  get_watchlist_items: { args: { watchlistId: string }; result: WatchlistItem[] };
  create_watchlist: { args: { name: string }; result: Watchlist };
  rename_watchlist: { args: { watchlistId: string; name: string }; result: null };
  delete_watchlist: { args: { watchlistId: string }; result: null };
  add_watchlist_item: { args: { watchlistId: string; assetId: string }; result: null };
  remove_watchlist_item: { args: { watchlistId: string; assetId: string }; result: null };
  reorder_watchlist_items: { args: { watchlistId: string; assetIds: string[] }; result: null };

  // --- market ---
  search_assets: { args: { query: string; limit: number }; result: Envelope<AssetSearchResult[]> };
  get_market_list: {
    args: { assetType: AssetType; region: string; limit: number };
    result: Envelope<Quote[]>;
  };
  /** Batched by construction — there is deliberately no single-quote command. */
  get_quotes: { args: { assetIds: string[] }; result: Envelope<Quote[]> };
  get_asset: { args: { assetId: string }; result: Asset | null };
  get_chart: { args: { assetId: string; range: ChartRange }; result: Envelope<ChartPoint[]> };

  // --- learn ---
  list_progress: { args: undefined; result: LearningProgress[] };
  set_progress: {
    args: { itemId: string; pathId: string; status: ProgressStatus };
    result: null;
  };
  /** `pathId: null` resets everything. */
  reset_progress: { args: { pathId: string | null }; result: null };

  // --- notes ---
  list_notes: { args: { assetId: string }; result: Note[] };
  upsert_note: {
    args: {
      noteId: string | null;
      assetId: string | null;
      title: string;
      bodyMd: string;
    };
    result: Note;
  };
  delete_note: { args: { noteId: string }; result: null };
  search_notes: { args: { query: string; limit: number }; result: Note[] };

  // --- news ---
  get_news: { args: { filter: NewsFilter }; result: Envelope<NewsArticle[]> };
  list_news_feeds: { args: undefined; result: NewsFeed[] };
  /** Fetches and parses a candidate feed without storing anything. */
  preview_news_feed: { args: { url: string }; result: FeedPreview };
  add_news_feed: {
    args: { url: string; title: string; category: NewsCategory };
    result: NewsFeed;
  };
  remove_news_feed: { args: { feedId: string }; result: void };
  set_news_feed_enabled: { args: { feedId: string; enabled: boolean }; result: void };
  restore_default_news_feeds: { args: undefined; result: NewsFeed[] };

  /**
   * Asks GitHub whether a newer release exists. User-initiated only — nothing calls this on
   * launch or on a timer, and it downloads nothing.
   */
  check_for_updates: { args: undefined; result: UpdateCheck };

  // --- local models ---
  get_local_models: { args: undefined; result: LocalModelOverview };
  /** Downloads and unpacks the inference engine for this platform. */
  install_engine: { args: undefined; result: LocalModelOverview };
  download_model: { args: { modelId: string }; result: LocalModelOverview };
  /** Polled while a download runs. Null when nothing is downloading. */
  get_download_progress: { args: undefined; result: DownloadProgress | null };
  cancel_download: { args: undefined; result: void };
  delete_local_model: { args: { modelId: string }; result: LocalModelOverview };
  start_local_model: { args: { modelId: string }; result: LocalModelOverview };
  stop_local_model: { args: undefined; result: LocalModelOverview };

  // --- model desk ---
  get_ai_status: { args: undefined; result: AiStatus };
  save_ai_endpoint: { args: { endpoint: string; model: string }; result: AiStatus };
  /**
   * Address and model only. The key travels through `save_provider_credential` — the single
   * inward path for every secret in the app.
   */
  save_ai_cloud_endpoint: { args: { endpoint: string; model: string }; result: AiStatus };
  clear_ai_endpoint: { args: { mode: AiMode }; result: AiStatus };
  /** One real request to the endpoint. Only ever called from a button press. */
  test_ai_endpoint: { args: undefined; result: AiTestResult };
  /**
   * Computes what a send would transmit. Sends nothing. The consent panel renders this rather
   * than counting characters itself, so the figure shown is the figure sent.
   */
  preview_ai_send: {
    args: { conversationId: string | null; prompt: string; context: AiContextItem[] };
    result: AiSendPreview;
  };
  /** The only command in the app that sends the user's own words anywhere. */
  send_ai_message: {
    args: { conversationId: string | null; prompt: string; context: AiContextItem[] };
    result: AiSendResult;
  };
  list_ai_conversations: { args: undefined; result: AiConversation[] };
  get_ai_messages: { args: { conversationId: string }; result: AiMessage[] };
  delete_ai_conversation: { args: { conversationId: string }; result: null };
  clear_ai_conversations: { args: undefined; result: null };
  list_ai_outbound_log: { args: undefined; result: AiOutboundEntry[] };
  clear_ai_outbound_log: { args: undefined; result: null };

  // --- encrypted profile ---
  /**
   * Writes the file in Rust. The frontend supplies a path and a password and receives neither
   * the payload nor the file bytes back.
   */
  export_profile: { args: { path: string; password: string }; result: ExportResult };
  /** Decrypts and validates. Writes nothing — this is what the summary is built from. */
  inspect_profile: { args: { path: string; password: string }; result: ProfileSummary };
  import_profile: {
    args: { path: string; password: string; mode: ImportMode };
    result: ImportResult;
  };

  // --- community ---
  /**
   * Fails with `not_configured` when the opt-in preference is off or no provider is enabled.
   * Both gates live in Rust — a frontend-only opt-in would be a checkbox that does nothing.
   */
  get_community_posts: { args: { filter: CommunityFilter }; result: Envelope<CommunityPost[]> };

  // --- cache ---
  get_cache_stats: { args: undefined; result: CacheStats };
  clear_cache: { args: { kind: string | null }; result: null };

  // --- dev ---
  set_mock_behavior: { args: { behavior: MockBehavior }; result: null };
}

export type IpcCommand = keyof IpcContract;

/**
 * Errors crossing the IPC boundary. Rust guarantees these are user-safe: no credential, no raw
 * URL with a query string, no raw provider body. See ARCHITECTURE.md §11.
 */
export class IpcError extends Error {
  readonly kind: string;
  readonly providerId: string | null;

  constructor(kind: string, message: string, providerId: string | null = null) {
    super(message);
    this.name = 'IpcError';
    this.kind = kind;
    this.providerId = providerId;
  }
}

function toIpcError(raw: unknown): IpcError {
  if (raw instanceof IpcError) return raw;

  if (typeof raw === 'object' && raw !== null && 'kind' in raw && 'message' in raw) {
    const r = raw as { kind: unknown; message: unknown; providerId?: unknown };
    return new IpcError(
      String(r.kind),
      String(r.message),
      typeof r.providerId === 'string' ? r.providerId : null,
    );
  }

  return new IpcError('unknown', typeof raw === 'string' ? raw : 'Something went wrong.');
}

type ArgsOf<K extends IpcCommand> = IpcContract[K]['args'];
type ResultOf<K extends IpcCommand> = IpcContract[K]['result'];

/**
 * Call a Tauri command. Outside Tauri (plain `npm run dev`, or component tests) this routes to
 * the browser harness, which serves the same fixtures the Rust mock provider reads.
 *
 * The harness is imported **dynamically**, and that matters for more than tidiness: it
 * statically imports every fixture file, and `chart_series.json` alone is 30 KB gzipped. A
 * static import put all of it in the entry chunk of the shipped desktop app, which never runs
 * the harness at all. As a lazy chunk it is fetched only when the app finds itself outside
 * Tauri, so a release pays nothing for it.
 */
export async function ipc<K extends IpcCommand>(
  command: K,
  ...rest: ArgsOf<K> extends undefined ? [] : [args: ArgsOf<K>]
): Promise<ResultOf<K>> {
  const args = rest[0];
  try {
    if (!isTauri()) {
      const { browserInvoke } = await import('./ipc.browser');
      return (await browserInvoke(command, args)) as ResultOf<K>;
    }
    return (await invoke(command, args as Record<string, unknown> | undefined)) as ResultOf<K>;
  } catch (error) {
    throw toIpcError(error);
  }
}

/** Typed convenience wrapper — JSON-encodes the value the way the Rust side expects. */
export async function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Promise<void> {
  await ipc('set_preference', { key, value: JSON.stringify(value) });
}
