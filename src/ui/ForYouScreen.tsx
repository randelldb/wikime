import { useCallback, useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import { upsertSavedArticle, deleteSavedArticle, clearShownArticles } from "../data/db";
import { ForYouFeed } from "../data/foryou";
import { RateLimitedError } from "../data/types";
import type { Article } from "../data/types";
import { ArticleCard, EMPTY_FEED, FeedStatus, type FeedUiState } from "./FeedParts";
import PullToRefresh from "./PullToRefresh";
import { useLang } from "../i18n";

const forYouFeed = new ForYouFeed();

/** The personal feed: batches of morelike articles seeded by the saved
 * favorites. Welcome state below two saved articles; same infinite scroll,
 * error states and article cards as the theme feed. */
export default function ForYouScreen({
  savedCount,
  savedTitles,
  refreshSaved,
  onGoToThemes,
  onOpenArticle,
}: {
  savedCount: number;
  savedTitles: Set<string>;
  refreshSaved: () => void;
  onGoToThemes: () => void;
  onOpenArticle: (title: string) => void;
}) {
  const { t, lang } = useLang();
  const welcome = savedCount < 2;
  // Start in the loading state when the feed can load at all, so the first
  // paint never flashes the "no articles found" empty message.
  const [state, setState] = useState<FeedUiState>(() =>
    welcome ? EMPTY_FEED : { ...EMPTY_FEED, isLoading: true },
  );
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (welcome) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const batch = await forYouFeed.nextBatch();
      setState((s) => {
        const known = new Set(s.articles.map((a) => a.title));
        const fresh = batch.filter((a) => !known.has(a.title));
        return {
          articles: [...s.articles, ...fresh],
          isLoading: false,
          error: null,
          exhausted: fresh.length === 0,
        };
      });
    } catch (e) {
      console.error("WikiMe: loading Voor jou batch failed:", e);
      const message =
        e instanceof RateLimitedError
          ? t("errors.rateLimited")
          : `${t("errors.loadFailed")}: ${e instanceof Error ? e.message : String(e)}`;
      setState((s) => ({ ...s, isLoading: false, error: message }));
    } finally {
      loadingRef.current = false;
    }
  }, [welcome, t]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null, exhausted: false }));
    loadMore();
  }, [loadMore]);

  // Pull-to-refresh: clear the shown-buffer so the morelike feed can show
  // articles again, then reload the first batch from scratch.
  const refresh = useCallback(async () => {
    if (welcome) return;
    setState({ articles: [], isLoading: true, error: null, exhausted: false });
    await clearShownArticles();
    await loadMore();
  }, [loadMore, welcome]);

  // Kick off the first load once the feed has two or more favorites. Each
  // (re)open of the screen clears the shown-buffer first, so a new visit can
  // show articles again instead of filtering everything as "already shown".
  useEffect(() => {
    if (welcome) return;
    // Show the loader during the shown-buffer clear too, not just the fetch.
    setState((s) => ({ ...s, isLoading: true, error: null }));
    clearShownArticles().then(() => loadMore());
  }, [loadMore, welcome]);

  // Same "near the end of the page" prefetch as the theme feed.
  useEffect(() => {
    const onScroll = () => {
      const nearEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 600;
      if (nearEnd) {
        setState((s) => {
          if (s.error === null && !s.exhausted) loadMore();
          return s;
        });
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  const toggleSaved = async (article: Article) => {
    if (savedTitles.has(article.title)) {
      await deleteSavedArticle(article.title);
    } else {
      await upsertSavedArticle({
        title: article.title,
        summary: article.extract,
        thumbnailUrl: article.thumbnailUrl,
        savedAt: Date.now(),
        language: lang,
      });
    }
    refreshSaved();
  };

  return (
    <PullToRefresh onRefresh={refresh} disabled={welcome || state.isLoading}>
    <div className="screen">
      <header className="appbar">
        <h1>
          <Logo /> WikiMe
        </h1>
      </header>

      <main className="content">
        {welcome ? (
          <div className="status">
            <p>{t("foryou.welcomeTitle")}</p>
            <p className="hint">{t("foryou.welcomeHint")}</p>
            <button className="btn" onClick={onGoToThemes}>{t("foryou.goThemes")}</button>
          </div>
        ) : state.articles.length === 0 ? (
          <FeedStatus
            state={state}
            onRetry={retry}
            emptyMessage={t("feed.emptyGeneric")}
          />
        ) : (
          <>
            {state.articles.map((article) => (
              <ArticleCard
                key={article.title}
                article={article}
                saved={savedTitles.has(article.title)}
                onClick={() => onOpenArticle(article.title)}
                onToggleSaved={() => toggleSaved(article)}
              />
            ))}
            {(state.isLoading || state.error !== null || state.exhausted) && (
              <FeedStatus
                state={state}
                onRetry={retry}
                emptyMessage={t("feed.emptyGeneric")}
              />
            )}
          </>
        )}
      </main>
    </div>
    </PullToRefresh>
  );
}
