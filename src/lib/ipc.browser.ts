import communityFixture from '@content/fixtures/community.json';
import cryptoQuotes from '@content/fixtures/crypto_quotes.json';
import stockQuotes from '@content/fixtures/stock_quotes.json';
import searchIndex from '@content/fixtures/search_index.json';
import newsFixture from '@content/fixtures/news.json';
import chartFixture from '@content/fixtures/chart_series.json';
import type {
  AiContextItem,
  AiConversation,
  AiMessage,
  AiOutboundEntry,
  AiStatus,
  Asset,
  AssetSearchResult,
  ChartPoint,
  ChartRange,
  CommunityPost,
  NewsArticle,
  LearningProgress,
  Note,
  Preferences,
  ProfileSummary,
  ProviderInfo,
  Quote,
  Watchlist,
  WatchlistItem,
} from '@/types/domain';
import type { Envelope, EnvelopeMeta } from '@/types/envelope';
import type { MockBehavior } from './ipc';
import { scoreMatch } from './fuzzy';

/**
 * Browser harness.
 *
 * Serves the same fixture files the Rust mock provider reads via `include_str!`, so there is
 * exactly one copy of the development data. This exists because (a) `npm run dev` in a browser
 * is a far faster loop than a Tauri rebuild on a 2016 Intel machine, and (b) there is no macOS
 * WebDriver for Tauri, so a mocked-invoke harness carries real test coverage there.
 *
 * It is NOT a second implementation of the app's logic — it is a fixture server. Anything with
 * actual business logic belongs in Rust.
 */

const PROVIDER_ID = 'mock';
const PROVIDER_NAME = 'Mock provider (fixtures)';

let mockBehavior: MockBehavior = 'normal';

/** Provider state for the harness. The real app keeps this in SQLite plus the OS keychain. */
const providerState: Record<string, { enabled: boolean; hasCredential: boolean }> = {
  coingecko: { enabled: true, hasCredential: false },
  finnhub: { enabled: false, hasCredential: false },
  mock: { enabled: true, hasCredential: false },
  // Enabled here so the opt-in preference is the only gate in the harness. In the real app the
  // provider is seeded disabled too; the preference is what the UI actually toggles.
  'mock-community': { enabled: true, hasCredential: false },
};

const GLOBAL_REGION = {
  id: 'global',
  displayName: 'Global',
  description: 'Widely recognised assets across markets. No endorsement implied.',
};
const US_REGION = {
  id: 'us',
  displayName: 'United States',
  description: 'US-listed equities and ETFs.',
};

function harnessProviders(): ProviderInfo[] {
  const health = (id: string, requiresCredential: boolean): ProviderInfo['health'] => {
    const state = providerState[id];
    if (!state?.enabled) return 'disabled';
    if (requiresCredential && !state.hasCredential) return 'not-configured';
    return 'ok';
  };

  return [
    {
      id: 'coingecko',
      displayName: 'CoinGecko',
      kind: 'market',
      enabled: providerState.coingecko?.enabled ?? false,
      requiresCredential: false,
      hasCredential: providerState.coingecko?.hasCredential ?? false,
      health: health('coingecko', false),
      attribution: 'Data provided by CoinGecko',
      docsUrl: 'https://www.coingecko.com/en/api',
      supportedAssetTypes: ['crypto'],
      supportedRanges: [],
      supportedRegions: [GLOBAL_REGION],
    },
    {
      id: 'finnhub',
      displayName: 'Finnhub',
      kind: 'market',
      enabled: providerState.finnhub?.enabled ?? false,
      requiresCredential: true,
      hasCredential: providerState.finnhub?.hasCredential ?? false,
      health: health('finnhub', true),
      attribution: 'Market data by Finnhub',
      docsUrl: 'https://finnhub.io/docs/api',
      supportedAssetTypes: ['stock'],
      supportedRanges: [],
      supportedRegions: [US_REGION],
    },
    {
      id: PROVIDER_ID,
      displayName: PROVIDER_NAME,
      kind: 'market',
      enabled: providerState.mock?.enabled ?? false,
      requiresCredential: false,
      hasCredential: false,
      health: health(PROVIDER_ID, false),
      attribution: 'Development fixtures. Not real market data.',
      docsUrl: null,
      supportedAssetTypes: ['crypto', 'stock', 'etf'],
      supportedRanges: ['1D', '1W', '1M', '3M', '1Y', 'MAX'],
      supportedRegions: [GLOBAL_REGION, US_REGION],
    },
  ];
}

/**
 * Per-command invocation counts.
 *
 * A test seam, not app state. It exists so a test can assert that rendering N rows issues one
 * batched `get_quotes` rather than N single fetches — a regression that would be invisible in
 * a rendered snapshot but would quietly exhaust a provider's request budget.
 */
const callCounts = new Map<string, number>();

export function __harnessCallCount(command: string): number {
  return callCounts.get(command) ?? 0;
}

// Durable-enough state for a browser session. Real persistence is SQLite in Rust.
const STORAGE_KEY = 'brew.harness.state';

interface HarnessState {
  preferences: Preferences;
  watchlists: Watchlist[];
  items: WatchlistItem[];
  notes: Note[];
  progress: LearningProgress[];
}

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  region: 'global',
  displayCurrency: 'USD',
  refreshIntervalSecs: 60,
  refreshWhenUnfocused: true,
  reducedMotion: 'system',
  communityEnabled: false,
  aiEnabled: false,
  aiMode: 'local',
  navRailExpanded: false,
  onboardingCompleted: false,
};

function defaultState(): HarnessState {
  return {
    preferences: { ...DEFAULT_PREFERENCES },
    watchlists: [{ id: 'wl-default', name: 'My watchlist', position: 0, isDefault: true }],
    items: [
      { watchlistId: 'wl-default', assetId: 'crypto:cg:bitcoin', position: 0, addedAt: 0 },
      { watchlistId: 'wl-default', assetId: 'crypto:cg:ethereum', position: 1, addedAt: 0 },
      { watchlistId: 'wl-default', assetId: 'stock:us:AAPL', position: 2, addedAt: 0 },
    ],
    notes: [],
    progress: [],
  };
}

function loadState(): HarnessState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<HarnessState>;
    const base = defaultState();
    return {
      preferences: { ...base.preferences, ...parsed.preferences },
      watchlists: parsed.watchlists ?? base.watchlists,
      items: parsed.items ?? base.items,
      notes: parsed.notes ?? base.notes,
      progress: parsed.progress ?? base.progress,
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: HarnessState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Private browsing or a full quota — the session still works, it just will not persist. */
  }
}

let state = loadState();

const allQuotes: Quote[] = [...(cryptoQuotes as Quote[]), ...(stockQuotes as Quote[])];
const allAssets: Asset[] = searchIndex as Asset[];
/**
 * Fixture timestamps are frozen so tests stay deterministic, but a fixed base date drifts into
 * the past and every headline renders as "last yr". Rebasing at load keeps the relative spacing
 * while making the stories plausibly recent. Mirrors `rebase_to_now` in the Rust mock provider.
 */
function rebaseToNow(articles: NewsArticle[]): NewsArticle[] {
  const stamps = articles
    .map((a) => a.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  if (stamps.length === 0) return articles;

  const newest = Math.max(...stamps);
  const offset = Math.floor(Date.now() / 1000) - newest - 120;

  return articles.map((article) =>
    article.publishedAt === null
      ? article
      : { ...article, publishedAt: article.publishedAt + offset },
  );
}

const allNews: NewsArticle[] = rebaseToNow(newsFixture as NewsArticle[]);

/** The same rebasing for community posts, and for the same reason. */
const allCommunity: CommunityPost[] = (() => {
  const posts = communityFixture as CommunityPost[];
  const stamps = posts.map((p) => p.postedAt).filter((t): t is number => typeof t === 'number');
  if (stamps.length === 0) return posts;

  const newest = Math.max(...stamps);
  const offset = Math.floor(Date.now() / 1000) - newest - 120;

  return posts.map((post) =>
    post.postedAt === null ? post : { ...post, postedAt: post.postedAt + offset },
  );
})();

function meta(overrides: Partial<EnvelopeMeta> = {}): EnvelopeMeta {
  return {
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    fetchedAt: new Date().toISOString(),
    source: 'mock',
    stale: false,
    degraded: null,
    ...overrides,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies the dev panel's forced behaviour. Every UI state — including every failure — is
 * reachable here without a network connection, which is what makes the Phase 1 state coverage
 * testable at all.
 */
async function envelope<T>(data: T, emptyValue: T): Promise<Envelope<T>> {
  switch (mockBehavior) {
    case 'slow':
      await delay(2500);
      return { data, meta: meta() };
    case 'empty':
      return { data: emptyValue, meta: meta() };
    case 'stale':
      return {
        data,
        meta: meta({
          stale: true,
          fetchedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
          source: 'cache',
        }),
      };
    case 'rate-limited':
      return {
        data,
        meta: meta({
          stale: true,
          source: 'cache',
          fetchedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
          degraded: {
            reason: 'rate_limited',
            retryAfter: new Date(Date.now() + 60_000).toISOString(),
            message: 'Provider request limit reached. Showing cached values; retrying shortly.',
          },
        }),
      };
    case 'error':
      return {
        data,
        meta: meta({
          stale: true,
          source: 'cache',
          fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
          degraded: {
            reason: 'provider_error',
            retryAfter: null,
            message: 'The provider did not respond as expected. Showing the last known values.',
          },
        }),
      };
    case 'not-configured':
      return {
        data: emptyValue,
        meta: meta({
          degraded: {
            reason: 'not_configured',
            retryAfter: null,
            message: 'No provider is set up for this data yet. Add one in Settings → Providers.',
          },
        }),
      };
    default:
      await delay(120);
      return { data, meta: meta() };
  }
}

function reindex(items: WatchlistItem[], watchlistId: string): WatchlistItem[] {
  const inList = items
    .filter((i) => i.watchlistId === watchlistId)
    .sort((a, b) => a.position - b.position)
    .map((item, index) => ({ ...item, position: index }));
  return [...items.filter((i) => i.watchlistId !== watchlistId), ...inList];
}

/*
 * Model Desk state for the harness.
 *
 * This is a fixture server, not a second implementation: there is no real endpoint, so a send
 * returns a canned educational answer. What it *does* faithfully reproduce is the shape of the
 * chain — status, preview arithmetic, the outbound log growing on every send — because that is
 * what the UI is built and tested against. The guardrail prompt itself lives only in Rust.
 */
const HARNESS_SYSTEM_PROMPT_CHARS = 2751;

interface HarnessAiProvider {
  endpoint: string | null;
  model: string | null;
  hasCredential: boolean;
}

interface HarnessAi {
  local: HarnessAiProvider;
  cloud: HarnessAiProvider;
  conversations: AiConversation[];
  messages: AiMessage[];
  outbound: AiOutboundEntry[];
  nextId: number;
}

function emptyAi(): HarnessAi {
  return {
    local: { endpoint: null, model: null, hasCredential: false },
    cloud: { endpoint: null, model: null, hasCredential: false },
    conversations: [],
    messages: [],
    outbound: [],
    nextId: 1,
  };
}

let ai: HarnessAi = emptyAi();

/** Mirrors `providers::ai::resolve_reach` for the shapes a browser can decide without DNS. */
function harnessReach(endpoint: string | null): 'loopback' | 'network' | null {
  if (!endpoint) return null;
  try {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === '::1' || host === 'localhost' ? 'loopback' : 'network';
  } catch {
    return null;
  }
}

function summarise(provider: HarnessAiProvider) {
  return {
    configured: provider.endpoint !== null && provider.model !== null,
    endpoint: provider.endpoint,
    model: provider.model,
    hasCredential: provider.hasCredential,
  };
}

function harnessAiStatus(): AiStatus {
  const mode = state.preferences.aiMode;
  const active = mode === 'cloud' ? ai.cloud : ai.local;
  const reach = harnessReach(active.endpoint);

  const label =
    mode === 'cloud'
      ? active.endpoint
        ? 'Cloud \u00b7 API'
        : null
      : reach === 'loopback'
        ? 'Local \u00b7 offline'
        : reach === 'network'
          ? 'Local endpoint \u00b7 network'
          : null;

  const requiresCredential = mode === 'cloud';

  return {
    configured:
      active.endpoint !== null &&
      active.model !== null &&
      (!requiresCredential || active.hasCredential),
    enabled: state.preferences.aiEnabled,
    mode,
    endpoint: active.endpoint,
    model: active.model,
    reach,
    reachLabel: label,
    leavesDevice: mode === 'cloud' || reach === 'network',
    requiresCredential,
    hasCredential: active.hasCredential,
    systemPromptVersion: 'v1',
    local: summarise(ai.local),
    cloud: summarise(ai.cloud),
  };
}

function harnessHistoryChars(conversationId: string | null): number {
  if (!conversationId) return 0;
  return ai.messages
    .filter((m) => m.conversationId === conversationId)
    .reduce((total, m) => total + m.content.length, 0);
}

function harnessContextChars(context: AiContextItem[]): number {
  // Matches the Rust wrapper: open tag, text, close tag, newlines.
  return context.reduce((total, item) => total + item.text.length + 41, 0);
}

/*
 * Encrypted-profile state for the harness.
 *
 * There is no filesystem and no crypto here — a "file" is an in-memory record keyed by the fake
 * path `lib/dialog.ts` returns outside Tauri. What this reproduces faithfully is the *shape* of
 * the flow the UI is built against: a wrong password fails, a summary is produced before
 * anything is written, and merge and replace differ. The real construction and its guarantees
 * live in Rust and are tested there — see `src-tauri/src/security/profile.rs`.
 */
interface HarnessProfileFile {
  password: string;
  summary: ProfileSummary;
}

const harnessFiles = new Map<string, HarnessProfileFile>();

function harnessSummary(): ProfileSummary {
  return {
    schemaVersion: 2,
    appVersion: '0.1.0-dev',
    exportedAt: Math.floor(Date.now() / 1000),
    watchlists: state.watchlists.length,
    watchlistItems: state.items.length,
    notes: state.notes.length,
    progress: state.progress.length,
    bookmarks: 0,
    preferences: Object.keys(state.preferences).length,
    providers: Object.keys(providerState).length,
    assets: state.items.length,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the typed contract is enforced at the `ipc()` call site; this is the untyped seam.
export async function browserInvoke(command: string, args?: any): Promise<unknown> {
  callCounts.set(command, (callCounts.get(command) ?? 0) + 1);

  switch (command) {
    case 'get_app_info':
      return {
        version: '0.1.0-dev',
        dataDir: '(browser harness — no local database)',
        dbPath: '(browser harness — no local database)',
        schemaVersion: 0,
        isMockMode: true,
      };

    case 'get_preferences':
      return state.preferences;

    case 'set_preference': {
      const key = args.key as keyof Preferences;
      state = {
        ...state,
        preferences: { ...state.preferences, [key]: JSON.parse(args.value) as unknown },
      };
      saveState(state);
      return null;
    }

    case 'list_providers':
      /*
       * Mirrors the provider set the Rust registry seeds, so the Settings UI can be built and
       * checked in the harness. State is held in `harnessProviders` below rather than being a
       * constant, so enabling a provider or saving a key visibly changes the page.
       */
      return harnessProviders();

    case 'list_watchlists':
      return state.watchlists;

    case 'get_watchlist_items':
      return state.items
        .filter((i) => i.watchlistId === args.watchlistId)
        .sort((a, b) => a.position - b.position);

    case 'create_watchlist': {
      const created: Watchlist = {
        id: `wl-${Date.now()}`,
        name: args.name,
        position: state.watchlists.length,
        isDefault: false,
      };
      state = { ...state, watchlists: [...state.watchlists, created] };
      saveState(state);
      return created;
    }

    case 'rename_watchlist':
      state = {
        ...state,
        watchlists: state.watchlists.map((w) =>
          w.id === args.watchlistId ? { ...w, name: args.name } : w,
        ),
      };
      saveState(state);
      return null;

    case 'delete_watchlist':
      state = {
        ...state,
        watchlists: state.watchlists.filter((w) => w.id !== args.watchlistId),
        items: state.items.filter((i) => i.watchlistId !== args.watchlistId),
      };
      saveState(state);
      return null;

    case 'add_watchlist_item': {
      const exists = state.items.some(
        (i) => i.watchlistId === args.watchlistId && i.assetId === args.assetId,
      );
      if (!exists) {
        const position = state.items.filter((i) => i.watchlistId === args.watchlistId).length;
        state = {
          ...state,
          items: [
            ...state.items,
            {
              watchlistId: args.watchlistId,
              assetId: args.assetId,
              position,
              addedAt: Math.floor(Date.now() / 1000),
            },
          ],
        };
        saveState(state);
      }
      return null;
    }

    case 'remove_watchlist_item':
      state = {
        ...state,
        items: reindex(
          state.items.filter(
            (i) => !(i.watchlistId === args.watchlistId && i.assetId === args.assetId),
          ),
          args.watchlistId,
        ),
      };
      saveState(state);
      return null;

    case 'reorder_watchlist_items': {
      const order = args.assetIds as string[];
      state = {
        ...state,
        items: state.items.map((i) =>
          i.watchlistId === args.watchlistId && order.includes(i.assetId)
            ? { ...i, position: order.indexOf(i.assetId) }
            : i,
        ),
      };
      saveState(state);
      return null;
    }

    case 'search_assets': {
      const query = String(args.query ?? '').trim();
      if (!query) return envelope<AssetSearchResult[]>([], []);
      const results = allAssets
        .map((asset) => ({
          asset,
          score: Math.max(scoreMatch(query, asset.symbol) * 1.2, scoreMatch(query, asset.name)),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit ?? 20);
      return envelope<AssetSearchResult[]>(results, []);
    }

    case 'get_market_list': {
      // Mirrors the Rust mock: region lives on the canonical asset, not on the quote.
      const regionOf = new Map(allAssets.map((asset) => [asset.id, asset.region]));
      const rows = allQuotes
        .filter((q) => q.assetType === args.assetType)
        .filter((q) => args.region === 'global' || regionOf.get(q.assetId) === args.region)
        .slice(0, args.limit ?? 50);
      return envelope<Quote[]>(rows, []);
    }

    case 'get_quotes': {
      const ids = new Set(args.assetIds as string[]);
      return envelope<Quote[]>(
        allQuotes.filter((q) => ids.has(q.assetId)),
        [],
      );
    }

    case 'get_asset':
      return allAssets.find((a) => a.id === args.assetId) ?? null;

    case 'get_chart': {
      // Mirrors the Rust mock: the fixture is a year of daily closes, so a range is a tail.
      const series = (chartFixture as Record<string, ChartPoint[]>)[args.assetId as string];
      if (!series) return envelope<ChartPoint[]>([], []);

      const days: Record<ChartRange, number> = {
        '1D': 2,
        '1W': 7,
        '1M': 30,
        '3M': 90,
        '1Y': series.length,
        MAX: series.length,
      };
      const take = days[args.range as ChartRange] ?? series.length;
      return envelope<ChartPoint[]>(series.slice(Math.max(0, series.length - take)), []);
    }

    case 'get_news': {
      const filter = args.filter as { category: string; limit: number };
      const rows = allNews
        .filter((n) => filter.category === 'all' || n.category === filter.category)
        .slice(0, filter.limit ?? 20);
      return envelope<NewsArticle[]>(rows, []);
    }

    case 'set_provider_enabled': {
      const entry = providerState[args.providerId as string];
      if (entry) entry.enabled = Boolean(args.enabled);
      return null;
    }

    case 'save_provider_credential': {
      // The hosted model provider stores its key under the same one-way path as the market
      // providers, so it is handled here rather than in a Model Desk command of its own.
      if (args.providerId === 'cloud-openai') {
        ai.cloud = { ...ai.cloud, hasCredential: true };
      }
      const entry = providerState[args.providerId as string];
      if (entry) {
        entry.hasCredential = true;
        // A provider the user just keyed is one they want on.
        entry.enabled = true;
      }
      // The harness has no keychain. It returns the same masked shape the real command does,
      // and deliberately never echoes the key back.
      const key = String(args.apiKey);
      return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '…'.repeat(4);
    }

    case 'delete_provider_credential': {
      if (args.providerId === 'cloud-openai') {
        ai.cloud = { ...ai.cloud, hasCredential: false };
      }
      const entry = providerState[args.providerId as string];
      if (entry) {
        entry.hasCredential = false;
        entry.enabled = false;
      }
      return null;
    }

    case 'test_provider':
      return { ok: true, message: 'Connected. Mock provider (fixtures) answered with data.' };

    case 'list_progress':
      return state.progress;

    case 'set_progress': {
      const now = Math.floor(Date.now() / 1000);
      const record: LearningProgress = {
        itemId: args.itemId,
        pathId: args.pathId,
        status: args.status,
        completedAt: args.status === 'completed' ? now : null,
        updatedAt: now,
      };
      state = {
        ...state,
        progress: [...state.progress.filter((p) => p.itemId !== record.itemId), record],
      };
      saveState(state);
      return null;
    }

    case 'reset_progress':
      state = {
        ...state,
        progress: args.pathId ? state.progress.filter((p) => p.pathId !== args.pathId) : [],
      };
      saveState(state);
      return null;

    case 'list_notes':
      return state.notes
        .filter((note) => note.assetId === args.assetId)
        .sort((a, b) => b.updatedAt - a.updatedAt);

    case 'upsert_note': {
      const now = Math.floor(Date.now() / 1000);
      const existing = state.notes.find((note) => note.id === args.noteId);

      const note: Note = existing
        ? { ...existing, title: args.title, bodyMd: args.bodyMd, updatedAt: now }
        : {
            id: `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
            assetId: args.assetId ?? null,
            title: args.title,
            bodyMd: args.bodyMd,
            createdAt: now,
            updatedAt: now,
          };

      state = {
        ...state,
        notes: existing
          ? state.notes.map((n) => (n.id === note.id ? note : n))
          : [...state.notes, note],
      };
      saveState(state);
      return note;
    }

    case 'delete_note':
      state = { ...state, notes: state.notes.filter((note) => note.id !== args.noteId) };
      saveState(state);
      return null;

    case 'search_notes': {
      // The real command uses SQLite FTS5; substring matching is close enough to drive the UI.
      const needle = String(args.query).trim().toLowerCase();
      if (!needle) return [];
      return state.notes
        .filter(
          (note) =>
            note.title.toLowerCase().includes(needle) || note.bodyMd.toLowerCase().includes(needle),
        )
        .slice(0, args.limit ?? 20);
    }

    case 'get_ai_status':
      return harnessAiStatus();

    case 'save_ai_endpoint': {
      const reach = harnessReach(args.endpoint as string);
      if (reach === null) {
        throw { kind: 'validation', message: 'The value for "endpoint" is not valid.' };
      }
      if (reach === 'network' && !(args.endpoint as string).startsWith('https://')) {
        throw { kind: 'validation', message: 'The value for "endpoint" is not valid.' };
      }
      ai.local = {
        ...ai.local,
        endpoint: args.endpoint as string,
        model: args.model as string,
      };
      return harnessAiStatus();
    }

    case 'save_ai_cloud_endpoint': {
      // No loopback exemption: a hosted endpoint carries a key.
      if (!(args.endpoint as string).startsWith('https://')) {
        throw { kind: 'validation', message: 'The value for "endpoint" is not valid.' };
      }
      ai.cloud = {
        ...ai.cloud,
        endpoint: args.endpoint as string,
        model: args.model as string,
      };
      return harnessAiStatus();
    }

    case 'clear_ai_endpoint': {
      const which = args.mode === 'cloud' ? 'cloud' : 'local';
      ai[which] = { ...ai[which], endpoint: null, model: null };
      return harnessAiStatus();
    }

    case 'test_ai_endpoint': {
      const status = harnessAiStatus();
      if (!status.configured)
        throw { kind: 'ai_not_configured', message: 'No model is set up yet.' };
      return {
        ok: true,
        message: 'Connected. 3 models available, including the one you named.',
        modelAvailable: true,
        reachLabel: status.reachLabel ?? '',
      };
    }

    case 'preview_ai_send': {
      const context = (args.context ?? []) as AiContextItem[];
      const prompt = args.prompt as string;
      const historyChars = harnessHistoryChars(args.conversationId as string | null);
      const contextChars = harnessContextChars(context);
      const status = harnessAiStatus();

      return {
        charCount: HARNESS_SYSTEM_PROMPT_CHARS + historyChars + prompt.length + contextChars,
        systemPromptChars: HARNESS_SYSTEM_PROMPT_CHARS,
        historyChars,
        promptChars: prompt.length,
        contextChars,
        contextLabels: context.map((item) => item.label),
        leavesDevice: status.leavesDevice,
        reachLabel: status.reachLabel,
      };
    }

    case 'send_ai_message': {
      const status = harnessAiStatus();
      if (!status.configured || !status.enabled) {
        throw { kind: 'ai_not_configured', message: 'No model is set up yet.' };
      }

      const prompt = args.prompt as string;
      const context = (args.context ?? []) as AiContextItem[];
      const now = Math.floor(Date.now() / 1000);
      const conversationId = (args.conversationId as string | null) ?? `conv-${ai.nextId++}`;
      const providerId = status.mode === 'cloud' ? 'cloud-openai' : 'local-openai';

      if (!ai.conversations.some((c) => c.id === conversationId)) {
        ai.conversations = [
          {
            id: conversationId,
            title: prompt.split('\n')[0]?.slice(0, 80) || 'Untitled',
            providerId,
            mode: status.mode,
            modelName: status.model,
            systemPromptVersion: 'v1',
            createdAt: now,
            updatedAt: now,
          },
          ...ai.conversations,
        ];
      }

      const userMessage: AiMessage = {
        id: `msg-${ai.nextId++}`,
        conversationId,
        role: 'user',
        content: prompt,
        createdAt: now,
      };
      const assistantMessage: AiMessage = {
        id: `msg-${ai.nextId++}`,
        conversationId,
        role: 'assistant',
        content:
          'This is the browser harness, not a model. In the desktop app your own endpoint ' +
          'answers here, governed by the guardrail prompt. Educational information only.',
        createdAt: now,
      };
      ai.messages = [...ai.messages, userMessage, assistantMessage];

      ai.outbound = [
        {
          id: `out-${ai.nextId++}`,
          providerId,
          mode: status.mode,
          conversationId,
          charCount: HARNESS_SYSTEM_PROMPT_CHARS + prompt.length + harnessContextChars(context),
          includedContext: JSON.stringify(
            context.map((item) => ({ kind: item.kind, label: item.label })),
          ),
          createdAt: now,
        },
        ...ai.outbound,
      ];

      await delay(200);
      return { conversationId, userMessage, assistantMessage };
    }

    case 'list_ai_conversations':
      return ai.conversations;

    case 'get_ai_messages':
      return ai.messages.filter((m) => m.conversationId === args.conversationId);

    case 'delete_ai_conversation':
      ai.conversations = ai.conversations.filter((c) => c.id !== args.conversationId);
      ai.messages = ai.messages.filter((m) => m.conversationId !== args.conversationId);
      return null;

    case 'clear_ai_conversations':
      ai.conversations = [];
      ai.messages = [];
      return null;

    case 'list_ai_outbound_log':
      return ai.outbound;

    case 'clear_ai_outbound_log':
      ai.outbound = [];
      return null;

    case 'export_profile': {
      const password = String(args.password);
      if ([...password].length < 12) {
        throw { kind: 'validation', message: 'The value for "password" is not valid.' };
      }
      const path = String(args.path);
      harnessFiles.set(path, { password, summary: harnessSummary() });
      return { path, bytes: 4096 };
    }

    case 'inspect_profile':
    case 'import_profile': {
      const path = String(args.path);
      const file = harnessFiles.get(path);
      if (!file) {
        throw { kind: 'validation', message: 'That is not a Brew Terminal profile.' };
      }
      if (file.password !== String(args.password)) {
        // The same variant for a wrong password and a tampered file, as in Rust.
        throw {
          kind: 'profile_auth_failed',
          message:
            'That password did not open the file, or the file has been altered since it was written. Nothing was imported.',
        };
      }
      if (command === 'inspect_profile') return file.summary;

      const mode = args.mode === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace') {
        state = { ...state, notes: [], progress: [] };
        saveState(state);
      }
      return {
        mode,
        summary: file.summary,
        backupPath: '/harness/brew.pre-import-00000000-000000.bak',
      };
    }

    case 'get_community_posts': {
      // Both gates, mirrored from the service: the preference and an enabled provider.
      if (!state.preferences.communityEnabled || !providerState['mock-community']?.enabled) {
        throw {
          kind: 'not_configured',
          message: 'No provider is set up for this data yet. Add one in Settings → Providers.',
          providerId: 'community',
        };
      }
      const posts = allCommunity
        .slice()
        .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
        .slice(0, args.filter?.limit ?? 20);
      await delay(80);
      return { data: posts, meta: meta() };
    }

    case 'get_cache_stats':
      return { entryCount: 0, totalBytes: 0, oldestFetchedAt: null };

    case 'clear_cache':
      return null;

    case 'set_mock_behavior':
      mockBehavior = args.behavior as MockBehavior;
      return null;

    default:
      throw new Error(`Browser harness has no handler for "${command}".`);
  }
}

/** Test seam: resets harness state between test cases. */
export function __resetHarness(): void {
  state = defaultState();
  mockBehavior = 'normal';
  callCounts.clear();
  providerState.coingecko = { enabled: true, hasCredential: false };
  providerState.finnhub = { enabled: false, hasCredential: false };
  providerState.mock = { enabled: true, hasCredential: false };
  providerState['mock-community'] = { enabled: true, hasCredential: false };
  ai = emptyAi();
  harnessFiles.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
