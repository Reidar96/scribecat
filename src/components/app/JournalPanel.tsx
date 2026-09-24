import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  PanelLeft,
  PanelLeftOpen,
  Pencil,
  Plus,
  X
} from "lucide-react";
import MarkdownIt from "markdown-it";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { extractTags } from "@/lib/documentFrontmatter";
import {
  ABSOLUTE_URL_PATTERN,
  getRelativeDisplayPath,
  getRelativeImageMarkdownPath,
  guessImageMimeType,
  saveImageToFolder
} from "@/lib/fileSystem";
import {
  composeJournalMarkdown,
  createJournalMarkdown,
  journalDateFromRelativePath,
  journalDateKey,
  journalRelativePath,
  parseJournalMarkdown,
  type JournalDate,
  type JournalImage
} from "@/lib/journal";
import { cn } from "@/lib/utils";
import { getVaultCapabilities, platform, vaultCapabilityHint } from "@/platform";
import { dirname, join } from "@/platform/paths";
import type { PickedImageFile } from "@/platform/types";
import { readFile } from "@/platform/vaultFs";
import { useEditorSettingsStore } from "@/store/useEditorSettingsStore";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
const renderer = new MarkdownIt({ html: false, linkify: true, breaks: true });

type JournalPanelProps = {
  folderPath: string;
  filePaths: string[];
  selectedFilePath: string | null;
  selectedFileContent: string | null;
  sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void;
  onOpenSidebar: () => void;
  onClose: () => void;
  onOpenDate: (
    date: JournalDate,
    relativePath: string,
    initialMarkdown: string
  ) => Promise<string | null>;
  onOpenMarkdown: () => void;
  onMarkdownChange: (markdown: string) => void;
};

function dateParts(date: Date): JournalDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

function sameDate(left: JournalDate | null, right: JournalDate): boolean {
  return Boolean(
    left &&
      left.year === right.year &&
      left.month === right.month &&
      left.day === right.day
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function weekdayOffsetMonday(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

function normalizeLocale(value: string): string {
  return value || "en";
}

function JournalImageCard({
  image,
  filePath,
  index,
  count,
  onMove,
  onDragStart,
  onDrop
}: {
  image: JournalImage;
  filePath: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!image.src) {
      setLoadError(true);
      return;
    }

    if (ABSOLUTE_URL_PATTERN.test(image.src)) {
      setObjectUrl(image.src);
      setLoadError(false);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;

    void (async () => {
      try {
        const absolutePath = await join(await dirname(filePath), image.src);
        const data = await readFile(absolutePath);
        createdUrl = URL.createObjectURL(
          new Blob([data], { type: guessImageMimeType(absolutePath) })
        );

        if (active) {
          setObjectUrl(createdUrl);
          setLoadError(false);
        }
      } catch {
        if (active) {
          setLoadError(true);
          setObjectUrl(null);
        }
      }
    })();

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [filePath, image.src]);

  return (
    <article
      className="journal-entry__image-card"
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(index);
      }}
    >
      {objectUrl ? (
        <button
          type="button"
          className="journal-entry__image-open"
          onClick={() => setPreviewOpen(true)}
          aria-label={t("journal.openImage", { name: image.alt || index + 1 })}
        >
          <img src={objectUrl} alt={image.alt} />
        </button>
      ) : (
        <div className="journal-entry__image-missing">
          {loadError ? t("journal.imageMissing") : t("imageView.loading")}
        </div>
      )}

      <div className="journal-entry__image-order">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={t("journal.moveImageLeft")}
          title={t("journal.moveImageLeft")}
        >
          <ChevronLeft />
        </Button>
        <span>{index + 1}</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={index >= count - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={t("journal.moveImageRight")}
          title={t("journal.moveImageRight")}
        >
          <ChevronRight />
        </Button>
      </div>

      {previewOpen && objectUrl ? (
        <ImageLightbox
          src={objectUrl}
          alt={image.alt}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </article>
  );
}

function JournalEntryView({
  folderPath,
  filePath,
  markdown,
  onMarkdownChange,
  onOpenMarkdown
}: {
  folderPath: string;
  filePath: string;
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  onOpenMarkdown: () => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseJournalMarkdown(markdown), [markdown]);
  const tags = useMemo(() => extractTags(markdown), [markdown]);
  const [editingText, setEditingText] = useState(false);
  const [draftText, setDraftText] = useState(parsed.textMarkdown);
  const [draggedImage, setDraggedImage] = useState<number | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingText) setDraftText(parsed.textMarkdown);
  }, [editingText, parsed.textMarkdown]);

  const commitText = (nextText: string) => {
    setDraftText(nextText);
    onMarkdownChange(composeJournalMarkdown(markdown, nextText, parsed.images));
  };

  const moveImage = (from: number, to: number) => {
    if (from === to || to < 0 || to >= parsed.images.length) return;

    const next = [...parsed.images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onMarkdownChange(composeJournalMarkdown(markdown, parsed.textMarkdown, next));
  };

  const handleAddImages = async () => {
    setImageError(null);

    if (!getVaultCapabilities().images) {
      setImageError(vaultCapabilityHint());
      return;
    }

    let picked: PickedImageFile[];

    try {
      picked = await platform.imagePicker.pickImages({
        defaultPath: folderPath,
        title: t("journal.addImages"),
        filterName: t("editor.imageDialogFilter"),
        extensions: IMAGE_EXTENSIONS
      });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (picked.length === 0) return;

    const nextImages = [...parsed.images];

    for (const pickedImage of picked) {
      try {
        const payload = await pickedImage.read();
        const rootRelativePath = await saveImageToFolder(
          folderPath,
          filePath,
          pickedImage.fileName,
          payload.mimeType,
          payload.data
        );
        const src = await getRelativeImageMarkdownPath(
          folderPath,
          filePath,
          rootRelativePath
        );
        nextImages.push({
          alt: pickedImage.fileName.replace(/\.[^.]+$/, ""),
          src
        });
      } catch (error) {
        setImageError(error instanceof Error ? error.message : String(error));
      }
    }

    onMarkdownChange(
      composeJournalMarkdown(markdown, parsed.textMarkdown, nextImages)
    );
  };

  const renderedText = useMemo(
    () => renderer.render(parsed.textMarkdown || t("journal.emptyText")),
    [parsed.textMarkdown, t]
  );

  return (
    <section className="journal-entry">
      <div className="journal-entry__toolbar">
        <div className="journal-entry__tags">
          {tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>

        <div className="journal-entry__toolbar-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditingText((value) => !value)}
          >
            {editingText ? <Check /> : <Pencil />}
            {t(editingText ? "journal.doneText" : "journal.editText")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onOpenMarkdown}>
            {t("journal.openMarkdown")}
          </Button>
        </div>
      </div>

      {editingText ? (
        <textarea
          className="journal-entry__text-editor"
          value={draftText}
          onChange={(event) => commitText(event.target.value)}
          aria-label={t("journal.text")}
          spellCheck
        />
      ) : (
        <div
          className="journal-entry__text"
          dangerouslySetInnerHTML={{ __html: renderedText }}
        />
      )}

      <div className="journal-entry__gallery-head">
        <div>
          <h3>{t("journal.images")}</h3>
          <p>{t("journal.imagesHint")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleAddImages()}
        >
          <ImagePlus />
          {t("journal.addImages")}
        </Button>
      </div>

      {imageError ? (
        <p className="journal-entry__image-error" role="alert">{imageError}</p>
      ) : null}

      <div className="journal-entry__gallery">
        {parsed.images.map((image, index) => (
          <JournalImageCard
            key={image.src + ":" + index}
            image={image}
            filePath={filePath}
            index={index}
            count={parsed.images.length}
            onMove={moveImage}
            onDragStart={setDraggedImage}
            onDrop={(targetIndex) => {
              if (draggedImage !== null) moveImage(draggedImage, targetIndex);
              setDraggedImage(null);
            }}
          />
        ))}

        <button
          type="button"
          className="journal-entry__add-card"
          onClick={() => void handleAddImages()}
        >
          <Plus aria-hidden="true" />
          <span>{t("journal.addImages")}</span>
        </button>
      </div>
    </section>
  );
}

export function JournalPanel({
  folderPath,
  filePaths,
  selectedFilePath,
  selectedFileContent,
  sidebarVisible,
  onSidebarVisibilityToggle,
  onOpenSidebar,
  onClose,
  onOpenDate,
  onOpenMarkdown,
  onMarkdownChange
}: JournalPanelProps) {
  const { t, i18n } = useTranslation();
  const layout = useLayoutMode();
  const settings = useEditorSettingsStore((state) => state.journalSettings);
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => dateParts(now), [now]);
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [selectedDate, setSelectedDate] = useState<JournalDate | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);

  const journalFiles = useMemo(() => {
    const byDate = new Map<string, string>();

    for (const filePath of filePaths) {
      const relativePath = getRelativeDisplayPath(folderPath, filePath);
      const date = journalDateFromRelativePath(relativePath, settings);
      if (date) byDate.set(journalDateKey(date), filePath);
    }

    return byDate;
  }, [filePaths, folderPath, settings]);

  const years = useMemo(() => {
    const values = new Set<number>();
    for (let candidate = today.year - 5; candidate <= today.year + 5; candidate += 1) {
      values.add(candidate);
    }
    for (const key of journalFiles.keys()) {
      values.add(Number.parseInt(key.slice(0, 4), 10));
    }
    values.add(year);
    return [...values].sort((left, right) => left - right);
  }, [journalFiles, today.year, year]);

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: "long" }).format(
          new Date(2026, index, 1)
        )
      ),
    [locale]
  );

  const weekdayNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
          new Date(2021, 10, 1 + index)
        )
      ),
    [locale]
  );

  const count = daysInMonth(year, month);
  const offset = weekdayOffsetMonday(year, month);
  const slotCount = Math.ceil((offset + count) / 7) * 7;
  const slots = Array.from({ length: slotCount }, (_, index) => {
    const day = index - offset + 1;
    return day >= 1 && day <= count ? day : null;
  });

  const goToMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const openDay = async (day: number) => {
    const date = { year, month, day };
    const key = journalDateKey(date);
    const title = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date(year, month - 1, day));
    const relativePath = journalRelativePath(date, settings);

    setOpeningKey(key);

    try {
      const opened = await onOpenDate(
        date,
        relativePath,
        createJournalMarkdown(title)
      );
      if (!opened) return;

      setSelectedDate(date);
      setActiveFilePath(opened);
    } finally {
      setOpeningKey(null);
    }
  };

  const goToday = () => {
    setYear(today.year);
    setMonth(today.month);
  };

  const activeMarkdown =
    activeFilePath && selectedFilePath === activeFilePath
      ? selectedFileContent
      : null;

  return (
    <section className="journal-view" aria-label={t("journal.label")}>
      <header className="journal-view__header">
        <div className="journal-view__header-leading">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t(
              layout === "phone"
                ? "app.openSidebar"
                : sidebarVisible
                  ? "sidebar.hide"
                  : "sidebar.show"
            )}
            title={t(
              layout === "phone"
                ? "app.openSidebar"
                : sidebarVisible
                  ? "sidebar.hide"
                  : "sidebar.show"
            )}
            onClick={layout === "phone" ? onOpenSidebar : onSidebarVisibilityToggle}
          >
            {layout === "phone" || sidebarVisible ? <PanelLeft /> : <PanelLeftOpen />}
          </Button>

          <div className="journal-view__title">
            <CalendarDays aria-hidden="true" />
            <div>
              <h2>{t("journal.title")}</h2>
              <p>{settings.folder}</p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("journal.close")}
          title={t("journal.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      <div className="journal-view__layout">
        <div className="journal-calendar">
          <div className="journal-calendar__controls">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => goToMonth(-1)}
              aria-label={t("journal.previousMonth")}
              title={t("journal.previousMonth")}
            >
              <ChevronLeft />
            </Button>

            <select
              value={month}
              onChange={(event) => setMonth(Number.parseInt(event.target.value, 10))}
              aria-label={t("journal.month")}
            >
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>

            <select
              value={year}
              onChange={(event) => setYear(Number.parseInt(event.target.value, 10))}
              aria-label={t("journal.year")}
            >
              {years.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>

            <select
              value={
                selectedDate &&
                selectedDate.year === year &&
                selectedDate.month === month
                  ? selectedDate.day
                  : ""
              }
              onChange={(event) => {
                const day = Number.parseInt(event.target.value, 10);
                if (day) void openDay(day);
              }}
              aria-label={t("journal.date")}
            >
              <option value="">{t("journal.date")}</option>
              {Array.from({ length: count }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>

            <Button type="button" variant="outline" size="sm" onClick={goToday}>
              {t("journal.today")}
            </Button>

            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => goToMonth(1)}
              aria-label={t("journal.nextMonth")}
              title={t("journal.nextMonth")}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="journal-calendar__weekdays" aria-hidden="true">
            {weekdayNames.map((name) => <span key={name}>{name}</span>)}
          </div>

          <div className="journal-calendar__grid">
            {slots.map((day, index) => {
              if (day === null) {
                return <span key={"empty-" + index} className="journal-calendar__empty" />;
              }

              const date = { year, month, day };
              const key = journalDateKey(date);
              const hasNote = journalFiles.has(key);
              const isToday = sameDate(today, date);
              const isSelected = sameDate(selectedDate, date);
              const busy = openingKey === key;

              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "journal-calendar__day",
                    hasNote && "journal-calendar__day--has-note",
                    isToday && "journal-calendar__day--today",
                    isSelected && "journal-calendar__day--selected"
                  )}
                  onClick={() => void openDay(day)}
                  aria-label={t(
                    hasNote ? "journal.openDate" : "journal.createDate",
                    { date: key }
                  )}
                  aria-busy={busy || undefined}
                >
                  <span>{day}</span>
                  {hasNote ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <p className="journal-calendar__hint">{t("journal.calendarHint")}</p>
        </div>

        <div className="journal-view__entry-area">
          {activeFilePath && activeMarkdown !== null ? (
            <JournalEntryView
              folderPath={folderPath}
              filePath={activeFilePath}
              markdown={activeMarkdown}
              onMarkdownChange={onMarkdownChange}
              onOpenMarkdown={onOpenMarkdown}
            />
          ) : selectedDate ? (
            <div className="journal-view__placeholder">
              <p>{t("journal.loadingEntry")}</p>
            </div>
          ) : (
            <div className="journal-view__placeholder">
              <CalendarDays aria-hidden="true" />
              <p>{t("journal.selectDate")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
