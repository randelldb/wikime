import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { ArticleRepository } from "../data/repository";
import { WikiConfig } from "../data/config";
import { deleteSavedArticle, upsertSavedArticle } from "../data/db";
import { RateLimitedError } from "../data/types";
import { classifyArticleLink, normalizeArticleHtml } from "../data/wikihtml";
import { SavedIcon, SavedOutlineIcon } from "./TabIcons";
import Logo from "./Logo";
import { useLang } from "../i18n";

const repository = new ArticleRepository();

/** Article reading view: always the summary first (hero + intro extract),
 * then a button whose meaning depends on the full-article setting. Setting
 * on: "Lees meer" replaces the summary with the complete article HTML
 * (`action=parse&prop=text`) rendered inside the app in app style, and wiki
 * links navigate in-app. Setting off: "Lees verder op Wikipedia" links out to
 * m.wikipedia.org — the web equivalent of the in-app WebView from the
 * Android/Flutter versions. */
export default function ArticleView({
  title,
  savedTitles,
  refreshSaved,
  onClose,
  onOpenArticle,
  fullArticle,
}: {
  title: string;
  savedTitles: Set<string>;
  refreshSaved: () => void;
  onClose: () => void;
  onOpenArticle: (title: string) => void;
  /** Feature flag from the settings: render the full page in-app. */
  fullArticle: boolean;
}) {
  const { t, lang } = useLang();
  const [extract, setExtract] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  // Full article HTML keyed by the title it was loaded for, so a title or
  // flag change derives to "no content yet" during render instead of
  // resetting state inside the effect.
  const [full, setFull] = useState<{
    title: string;
    html: string | null;
    error: string | null;
  } | null>(null);
  // "Lees meer" pressed for this title; keyed by title so navigating to
  // another article collapses back to the summary view.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === title;

  useEffect(() => {
    let cancelled = false;
    repository
      .article(title)
      .then((article) => {
        if (cancelled || !article) return;
        setExtract(article.extract);
        setThumbnailUrl(article.thumbnailUrl);
      })
      .catch((e) => {
        console.error(`WikiMe: fetching article "${title}" failed:`, e);
        if (!cancelled) setExtract("");
      });
    return () => {
      cancelled = true;
    };
  }, [title]);

  // Full article HTML, fetched only when the feature flag is on AND the
  // user pressed "Lees meer". The lead extract is still loaded in the
  // background: it backs the save action.
  useEffect(() => {
    if (!fullArticle || !expanded) return;
    let cancelled = false;
    repository
      .articleHtml(title)
      .then((raw) => {
        if (!cancelled) setFull({ title, html: normalizeArticleHtml(raw), error: null });
      })
      .catch((e) => {
        console.error(`WikiMe: fetching full article "${title}" failed:`, e);
        if (!cancelled) {
          setFull({
            title,
            html: null,
            error:
              e instanceof RateLimitedError ? t("errors.rateLimited") : t("errors.loadFailed"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [title, fullArticle, expanded, t]);

  const html = fullArticle && expanded && full?.title === title ? full.html : null;
  const htmlError = fullArticle && expanded && full?.title === title ? full.error : null;
  // Once the full article is expanded and loaded, the summary (hero + lead)
  // is replaced by it: the article HTML already contains the lead and image.
  const showSummary = !fullArticle || !expanded || html === null;

  // Link clicks inside the rendered article: main-namespace wiki links open
  // in-app, everything else in a new tab, fragments scroll natively.
  const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const link = classifyArticleLink(anchor.getAttribute("href") ?? "", WikiConfig.apiBase(lang));
    if (link.kind === "article") {
      e.preventDefault();
      onOpenArticle(link.title);
    } else if (link.kind === "external") {
      e.preventDefault();
      window.open(link.url, "_blank", "noreferrer");
    }
  };

  const saved = savedTitles.has(title);

  const toggleSaved = async () => {
    if (saved) {
      await deleteSavedArticle(title);
    } else {
      // Pages reached through links may have no summary yet; fetch intro +
      // thumbnail, and if that fails still save the title.
      let savedSummary = "";
      let savedThumb: string | undefined;
      try {
        const article = await repository.article(title);
        savedSummary = article?.extract ?? "";
        savedThumb = article?.thumbnailUrl;
      } catch (e) {
        console.error(
          `WikiMe: fetching article "${title}" before saving failed, saving title only:`,
          e,
        );
        setMessage(t("article.summaryFailed"));
      }
      await upsertSavedArticle({
        title,
        summary: savedSummary,
        thumbnailUrl: savedThumb,
        savedAt: Date.now(),
        language: lang,
      });
    }
    refreshSaved();
  };

  return (
    <div className="screen article">
      <header className="appbar">
        <button className="icon-btn" aria-label={t("article.close")} onClick={onClose}>
          ←
        </button>
        <h1 className="with-logo">
          <Logo size={18} />
          <span className="appbar-title">{title}</span>
        </h1>
      </header>

      <button
        className={saved ? "saved-bar saved" : "saved-bar"}
        onClick={toggleSaved}
        aria-label={saved ? t("feed.unsave") : t("feed.save")}
        aria-pressed={saved}
      >
        {saved ? <SavedIcon size={18} /> : <SavedOutlineIcon size={18} />}
      </button>

      <main className="content">
        {showSummary && (
          <>
            {thumbnailUrl && <img className="hero" src={thumbnailUrl} alt="" />}
            <div className="article-body">
              {extract === null ? (
                <div className="status" role="status" aria-label={t("feed.loading")}>
                  <div className="spinner" />
                </div>
              ) : extract === "" ? (
                <p className="empty">{t("feed.noSummary")}</p>
              ) : (
                <p className="lead">{extract}</p>
              )}
              {fullArticle ? (
                <>
                  {(!expanded || htmlError !== null) && (
                    <button className="btn" onClick={() => setExpandedFor(title)}>
                      {t("article.readMoreInApp")}
                    </button>
                  )}
                  {expanded && html === null && htmlError === null && (
                    <div className="status" role="status" aria-label={t("feed.loading")}>
                      <div className="spinner" />
                    </div>
                  )}
                  {expanded && htmlError !== null && <p className="error">{htmlError}</p>}
                </>
              ) : (
                <a
                  className="btn"
                  href={WikiConfig.mobileArticleUrl(title)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("article.readMore")}
                </a>
              )}
            </div>
          </>
        )}
        {fullArticle && expanded && html !== null && (
          <div
            className="wiki-content"
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={onContentClick}
          />
        )}

        {message && (
          <div className="snackbar" onClick={() => setMessage(null)}>
            {message}
          </div>
        )}
      </main>
    </div>
  );
}
