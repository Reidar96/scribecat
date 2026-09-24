import {
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  Search,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageLightbox } from "@/components/ImageLightbox";
import { Button } from "@/components/ui/button";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { extractTags, normalizeTag, setTags } from "@/lib/documentFrontmatter";
import {
  ABSOLUTE_URL_PATTERN,
  getRelativeDisplayPath,
  getRelativeImageMarkdownPath,
  guessImageMimeType,
  readMarkdownFile,
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
const EARLIEST_PICKER_YEAR = 1900;

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
  onMarkdownChange: (markdown: string) => void;
};

type JournalFileRecord = {
  filePath: string;
  date: JournalDate;
};

type JournalIndexEntry = JournalFileRecord & {
  markdown: string;
  tags: string[];
  text: string;
};

type ImageRatioClass = "wide" | "landscape" | "square" | "portrait" | "tall";

function dateParts(date: Date): JournalDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

function dateToNumber(date: JournalDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

function sameDate(left: JournalDate | null, right: JournalDate): boolean {
  return Boolean(left && dateToNumber(left) === dateToNumber(right));
}

function shiftDate(date: JournalDate, days: number): JournalDate {
  const shifted = new Date(date.year, date.month - 1, date.day + days);
  return dateParts(shifted);
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

function formatJournalDate(date: JournalDate, locale: string, weekday = true): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    ...(weekday ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(date.year, date.month - 1, date.day));

  return formatted.charAt(0).toLocaleUpperCase(locale) + formatted.slice(1);
}

function imageRatioClass(width: number, height: number): ImageRatioClass {
  if (width <= 0 || height <= 0) return "landscape";

  const ratio = width / height;
  if (ratio >= 1.58) return "wide";
  if (ratio >= 1.12) return "landscape";
  if (ratio >= 0.88) return "square";
  if (ratio >= 0.64) return "portrait";
  return "tall";
}

function plainExcerpt(value: string, maxLength = 180): string {
  const plain = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`|\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return plain.length > maxLength ? plain.slice(0, maxLength).trimEnd() + "…" : plain;
}

function useJournalImageUrl(image: JournalImage, filePath: string) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!image.src) {
      setLoadError(true);
      setObjectUrl(null);
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

  return { objectUrl, loadError };
}

function JournalImageLightbox({
  images,
  filePath,
  index,
  onIndexChange,
  onClose
}: {
  images: JournalImage[];
  filePath: string;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const { objectUrl } = useJournalImageUrl(image, filePath);

  if (!objectUrl) return null;

  return (
    <ImageLightbox
      src={objectUrl}
      alt={image.alt}
      onClose={onClose}
      onPrevious={
        images.length > 1
          ? () => onIndexChange((index - 1 + images.length) % images.length)
          : undefined
      }
      onNext={
        images.length > 1
          ? () => onIndexChange((index + 1) % images.length)
          : undefined
      }
      positionLabel={images.length > 1 ? `${index + 1} / ${images.length}` : undefined}
    />
  );
}

function JournalImageCard({
  image,
  filePath,
  index,
  count,
  onMove,
  onDragStart,
  onDrop,
  onOpen
}: {
  image: JournalImage;
  filePath: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const { t } = useTranslation();
  const { objectUrl, loadError } = useJournalImageUrl(image, filePath);
  const [ratioClass, setRatioClass] = useState<ImageRatioClass>("landscape");

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
          className={cn(
            "journal-entry__image-open",
            `journal-entry__image-open--${ratioClass}`
          )}
          onClick={() => onOpen(index)}
          aria-label={t("journal.openImage", { name: image.alt || index + 1 })}
        >
          <img
            src={objectUrl}
            alt={image.alt}
            onLoad={(event) =>
              setRatioClass(
                imageRatioClass(
                  event.currentTarget.naturalWidth,
                  event.currentTarget.naturalHeight
                )
              )
            }
          />
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
    </article>
  );
}

function JournalTagEditor({
  tags,
  draft,
  onDraftChange,
  onAdd,
  onRemove
}: {
  tags: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="journal-entry__tag-editor">
      <div className="journal-entry__tag-list">
        {tags.map((tag) => (
          <span key={tag} className="journal-entry__tag">
            #{tag}
            <button
              type="button"
              aria-label={t("journal.removeTag", { tag })}
              title={t("journal.removeTag", { tag })}
              onClick={() => onRemove(tag)}
            >
              <X aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>

      <div className="journal-entry__tag-input-row">
        <input
          type="text"
          value={draft}
          placeholder={t("journal.addTag")}
          aria-label={t("journal.addTag")}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              onAdd();
            }
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={!normalizeTag(draft)}
          onClick={onAdd}
          aria-label={t("journal.addTag")}
          title={t("journal.addTag")}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function JournalEntryView({
  folderPath,
  filePath,
  markdown,
  dateLabel,
  tags,
  tagDraft,
  isPhone,
  canPreviousDay,
  canNextDay,
  onTagDraftChange,
  onAddTag,
  onRemoveTag,
  onPreviousDay,
  onNextDay,
  onShowCalendar,
  onMarkdownChange
}: {
  folderPath: string;
  filePath: string;
  markdown: string;
  dateLabel: string;
  tags: string[];
  tagDraft: string;
  isPhone: boolean;
  canPreviousDay: boolean;
  canNextDay: boolean;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onShowCalendar: () => void;
  onMarkdownChange: (markdown: string) => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseJournalMarkdown(markdown), [markdown]);
  const [draftText, setDraftText] = useState(parsed.textMarkdown);
  const [draggedImage, setDraggedImage] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageDropActive, setImageDropActive] = useState(false);

  useEffect(() => {
    setDraftText(parsed.textMarkdown);
  }, [filePath, parsed.textMarkdown]);

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

  const persistImages = async (picked: PickedImageFile[]) => {
    if (picked.length === 0) return;

    setImageError(null);

    if (!getVaultCapabilities().images) {
      setImageError(vaultCapabilityHint());
      return;
    }

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

  const handleAddImages = async () => {
    try {
      const picked = await platform.imagePicker.pickImages({
        defaultPath: folderPath,
        title: t("journal.addImages"),
        filterName: t("editor.imageDialogFilter"),
        extensions: IMAGE_EXTENSIONS
      });
      await persistImages(picked);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDroppedImages = async (
    event: ReactDragEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    setImageDropActive(false);

    const picked: PickedImageFile[] = Array.from(event.dataTransfer.files)
      .filter((file) => {
        const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
        return file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extension);
      })
      .map((file) => ({
        fileName: file.name,
        read: async () => ({
          mimeType: file.type || guessImageMimeType(file.name),
          data: new Uint8Array(await file.arrayBuffer())
        })
      }));

    await persistImages(picked);
  };

  return (
    <section className="journal-entry">
      {isPhone ? (
        <div className="journal-entry__mobile-nav">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={!canPreviousDay}
            onClick={onPreviousDay}
            aria-label={t("journal.previousDay")}
            title={t("journal.previousDay")}
          >
            <ChevronLeft />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onShowCalendar}>
            <CalendarDays />
            {t("journal.showCalendar")}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={!canNextDay}
            onClick={onNextDay}
            aria-label={t("journal.nextDay")}
            title={t("journal.nextDay")}
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}

      <div className="journal-entry__date-field" aria-label={t("journal.entryDate")}>
        {dateLabel}
      </div>

      <JournalTagEditor
        tags={tags}
        draft={tagDraft}
        onDraftChange={onTagDraftChange}
        onAdd={onAddTag}
        onRemove={onRemoveTag}
      />

      <textarea
        className="journal-entry__text-editor"
        value={draftText}
        onChange={(event) => commitText(event.target.value)}
        aria-label={t("journal.text")}
        spellCheck
      />

      <div className="journal-entry__gallery-head">
        <h3>{t("journal.images")}</h3>
      </div>

      {imageError ? (
        <p className="journal-entry__image-error" role="alert">
          {imageError}
        </p>
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
            onOpen={setPreviewIndex}
          />
        ))}

        <button
          type="button"
          className={cn(
            "journal-entry__add-card",
            imageDropActive && "journal-entry__add-card--drop-active"
          )}
          onClick={() => void handleAddImages()}
          onDragEnter={(event) => {
            event.preventDefault();
            setImageDropActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setImageDropActive(true);
          }}
          onDragLeave={() => setImageDropActive(false)}
          onDrop={(event) => void handleDroppedImages(event)}
          aria-label={t("journal.addImages")}
        >
          <Plus aria-hidden="true" />
          <span>{t("journal.addImagesDrop")}</span>
        </button>
      </div>

      {previewIndex !== null && parsed.images[previewIndex] ? (
        <JournalImageLightbox
          images={parsed.images}
          filePath={filePath}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </section>
  );
}

function JournalResults({
  title,
  entries,
  locale,
  onOpen,
  onClear
}: {
  title: string;
  entries: JournalIndexEntry[];
  locale: string;
  onOpen: (date: JournalDate) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="journal-results">
      <header className="journal-results__header">
        <div>
          <h2>{title}</h2>
          <span>{t("journal.resultCount", { count: entries.length })}</span>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onClear}>
          <X aria-hidden="true" />
        </Button>
      </header>

      {entries.length === 0 ? (
        <div className="journal-results__empty">{t("journal.noResults")}</div>
      ) : (
        <div className="journal-results__list">
          {entries.map((entry) => (
            <button
              key={entry.filePath}
              type="button"
              className="journal-results__item"
              onClick={() => onOpen(entry.date)}
            >
              <strong>{formatJournalDate(entry.date, locale)}</strong>
              {entry.text ? <p>{plainExcerpt(entry.text)}</p> : null}
              {entry.tags.length > 0 ? (
                <div className="journal-results__tags">
                  {entry.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
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
  onMarkdownChange
}: JournalPanelProps) {
  const { t, i18n } = useTranslation();
  const layout = useLayoutMode();
  const settings = useEditorSettingsStore((state) => state.journalSettings);
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => dateParts(now), [now]);
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
  const isPhone = layout === "phone";

  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [selectedDate, setSelectedDate] = useState<JournalDate | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showMobileCalendar, setShowMobileCalendar] = useState(true);
  const [markdownByPath, setMarkdownByPath] = useState<Record<string, string>>({});

  const journalFiles = useMemo<JournalFileRecord[]>(() => {
    const result: JournalFileRecord[] = [];

    for (const filePath of filePaths) {
      const relativePath = getRelativeDisplayPath(folderPath, filePath);
      const date = journalDateFromRelativePath(relativePath, settings);
      if (date) result.push({ filePath, date });
    }

    return result;
  }, [filePaths, folderPath, settings]);

  const journalFileByDate = useMemo(() => {
    const byDate = new Map<string, string>();
    for (const entry of journalFiles) {
      byDate.set(journalDateKey(entry.date), entry.filePath);
    }
    return byDate;
  }, [journalFiles]);

  useEffect(() => {
    let active = true;

    void Promise.all(
      journalFiles.map(async ({ filePath }) => {
        try {
          return [filePath, await readMarkdownFile(filePath)] as const;
        } catch {
          return [filePath, ""] as const;
        }
      })
    ).then((entries) => {
      if (active) setMarkdownByPath(Object.fromEntries(entries));
    });

    return () => {
      active = false;
    };
  }, [journalFiles]);

  const activeMarkdown =
    activeFilePath && selectedFilePath === activeFilePath
      ? selectedFileContent
      : null;

  useEffect(() => {
    if (!activeFilePath || activeMarkdown === null) return;

    setMarkdownByPath((current) =>
      current[activeFilePath] === activeMarkdown
        ? current
        : { ...current, [activeFilePath]: activeMarkdown }
    );
  }, [activeFilePath, activeMarkdown]);

  useEffect(() => {
    if (!selectedFilePath) return;

    const relativePath = getRelativeDisplayPath(folderPath, selectedFilePath);
    const date = journalDateFromRelativePath(relativePath, settings);
    if (!date) return;

    setSelectedDate(date);
    setActiveFilePath(selectedFilePath);
    setYear(date.year);
    setMonth(date.month);
  }, [folderPath, selectedFilePath, settings]);

  useEffect(() => {
    setTagDraft("");
  }, [activeFilePath]);

  const indexedEntries = useMemo<JournalIndexEntry[]>(() => {
    return journalFiles
      .map((record) => {
        const markdown = markdownByPath[record.filePath] ?? "";
        const parsed = parseJournalMarkdown(markdown);
        return {
          ...record,
          markdown,
          tags: extractTags(markdown),
          text: parsed.textMarkdown
        };
      })
      .sort((left, right) => dateToNumber(right.date) - dateToNumber(left.date));
  }, [journalFiles, markdownByPath]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();

    for (const entry of indexedEntries) {
      for (const tag of entry.tags) {
        const key = tag.toLocaleLowerCase();
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { label: tag, count: 1 });
      }
    }

    return [...counts.values()].sort(
      (left, right) =>
        left.label.localeCompare(right.label, locale, { sensitivity: "base" })
    );
  }, [indexedEntries, locale]);

  const resultEntries = useMemo(() => {
    if (selectedTag) {
      const key = selectedTag.toLocaleLowerCase();
      return indexedEntries.filter((entry) =>
        entry.tags.some((tag) => tag.toLocaleLowerCase() === key)
      );
    }

    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];

    return indexedEntries.filter((entry) => {
      const haystack = [
        entry.text,
        entry.tags.join(" "),
        formatJournalDate(entry.date, locale),
        journalDateKey(entry.date)
      ]
        .join("\n")
        .toLocaleLowerCase();

      return haystack.includes(query);
    });
  }, [indexedEntries, locale, searchQuery, selectedTag]);

  const earliestYear = useMemo(
    () =>
      Math.min(
        EARLIEST_PICKER_YEAR,
        ...journalFiles.map((entry) => entry.date.year)
      ),
    [journalFiles]
  );

  const years = useMemo(
    () =>
      Array.from(
        { length: today.year - earliestYear + 1 },
        (_, index) => today.year - index
      ),
    [earliestYear, today.year]
  );

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
    if (day < 1 || day > count) return null;

    const date = { year, month, day };
    return dateToNumber(date) <= dateToNumber(today) ? day : null;
  });

  const atCurrentMonth = year === today.year && month === today.month;

  const openJournalDate = async (date: JournalDate) => {
    if (dateToNumber(date) > dateToNumber(today)) return;

    const key = journalDateKey(date);
    const relativePath = journalRelativePath(date, settings);
    const title = formatJournalDate(date, locale, false);

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
      setYear(date.year);
      setMonth(date.month);
      setSelectedTag(null);
      setSearchQuery("");
      setSearchDraft("");
      if (isPhone) setShowMobileCalendar(false);
    } finally {
      setOpeningKey(null);
    }
  };

  const goToMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    const nextDate = {
      year: next.getFullYear(),
      month: next.getMonth() + 1,
      day: 1
    };

    if (
      nextDate.year < earliestYear ||
      dateToNumber(nextDate) >
        dateToNumber({ year: today.year, month: today.month, day: 1 })
    ) {
      return;
    }

    setYear(nextDate.year);
    setMonth(nextDate.month);
  };

  const goToday = () => {
    setYear(today.year);
    setMonth(today.month);
  };

  const activeTags = useMemo(
    () => (activeMarkdown ? extractTags(activeMarkdown) : []),
    [activeMarkdown]
  );

  const selectedDateLabel = useMemo(
    () => (selectedDate ? formatJournalDate(selectedDate, locale) : ""),
    [locale, selectedDate]
  );

  const commitTags = (tags: string[]) => {
    if (!activeMarkdown) return;
    onMarkdownChange(setTags(activeMarkdown, tags));
  };

  const addTag = () => {
    const tag = normalizeTag(tagDraft);
    if (!tag) return;
    commitTags([...activeTags, tag]);
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    const key = tag.toLocaleLowerCase();
    commitTags(activeTags.filter((candidate) => candidate.toLocaleLowerCase() !== key));
  };

  const runSearch = () => {
    const query = searchDraft.trim();
    setSearchQuery(query);
    setSelectedTag(null);
    if (query && isPhone) setShowMobileCalendar(false);
  };

  const chooseTag = (tag: string) => {
    setSelectedTag(tag);
    setSearchDraft("");
    setSearchQuery("");
    if (isPhone) setShowMobileCalendar(false);
  };

  const clearResults = () => {
    setSelectedTag(null);
    setSearchQuery("");
    setSearchDraft("");
    if (isPhone) setShowMobileCalendar(true);
  };

  const showResults = Boolean(selectedTag || searchQuery.trim());
  const previousDate = selectedDate ? shiftDate(selectedDate, -1) : null;
  const nextDate = selectedDate ? shiftDate(selectedDate, 1) : null;
  const canPreviousDay = Boolean(
    previousDate && previousDate.year >= earliestYear
  );
  const canNextDay = Boolean(
    nextDate && dateToNumber(nextDate) <= dateToNumber(today)
  );

  return (
    <section className="journal-view" aria-label={t("journal.label")}>
      <header className="journal-view__header">
        <div className="journal-view__header-leading">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t(
              isPhone
                ? "app.openSidebar"
                : sidebarVisible
                  ? "sidebar.hide"
                  : "sidebar.show"
            )}
            title={t(
              isPhone
                ? "app.openSidebar"
                : sidebarVisible
                  ? "sidebar.hide"
                  : "sidebar.show"
            )}
            onClick={isPhone ? onOpenSidebar : onSidebarVisibilityToggle}
          >
            {isPhone || sidebarVisible ? <PanelLeft /> : <PanelLeftOpen />}
          </Button>

          <div className="journal-view__title">
            <CalendarDays aria-hidden="true" />
            <h2>{t("journal.title")}</h2>
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

      <div
        className={cn(
          "journal-view__layout",
          isPhone && showMobileCalendar && "journal-view__layout--mobile-calendar",
          isPhone && !showMobileCalendar && "journal-view__layout--mobile-content"
        )}
      >
        <aside className="journal-calendar">
          <div className="journal-calendar__controls">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={year === earliestYear && month === 1}
              onClick={() => goToMonth(-1)}
              aria-label={t("journal.previousMonth")}
              title={t("journal.previousMonth")}
            >
              <ChevronLeft />
            </Button>

            <select
              value={month}
              onChange={(event) => {
                const nextMonth = Number.parseInt(event.target.value, 10);
                setMonth(
                  year === today.year
                    ? Math.min(nextMonth, today.month)
                    : nextMonth
                );
              }}
              aria-label={t("journal.month")}
            >
              {monthNames.map((name, index) => (
                <option
                  key={name}
                  value={index + 1}
                  disabled={year === today.year && index + 1 > today.month}
                >
                  {name}
                </option>
              ))}
            </select>

            <select
              value={year}
              onChange={(event) => {
                const nextYear = Number.parseInt(event.target.value, 10);
                setYear(nextYear);
                if (nextYear === today.year && month > today.month) {
                  setMonth(today.month);
                }
              }}
              aria-label={t("journal.year")}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
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
                if (day) void openJournalDate({ year, month, day });
              }}
              aria-label={t("journal.date")}
            >
              <option value="">{t("journal.date")}</option>
              {Array.from(
                {
                  length:
                    year === today.year && month === today.month
                      ? today.day
                      : count
                },
                (_, index) => index + 1
              ).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>

            <Button type="button" variant="outline" size="sm" onClick={goToday}>
              {t("journal.today")}
            </Button>

            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={atCurrentMonth}
              onClick={() => goToMonth(1)}
              aria-label={t("journal.nextMonth")}
              title={t("journal.nextMonth")}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="journal-calendar__weekdays" aria-hidden="true">
            {weekdayNames.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>

          <div className="journal-calendar__grid">
            {slots.map((day, index) => {
              if (day === null) {
                return (
                  <span
                    key={"empty-" + index}
                    className="journal-calendar__empty"
                  />
                );
              }

              const date = { year, month, day };
              const key = journalDateKey(date);
              const hasNote = journalFileByDate.has(key);
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
                  onClick={() => void openJournalDate(date)}
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

          <div className="journal-calendar__search">
            <div className="journal-calendar__search-row">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={searchDraft}
                placeholder={t("journal.searchPlaceholder")}
                aria-label={t("journal.search")}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runSearch();
                  }
                }}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={!searchDraft.trim()}
                onClick={runSearch}
                aria-label={t("journal.search")}
                title={t("journal.search")}
              >
                <Search />
              </Button>
            </div>
          </div>

          <div className="journal-calendar__tags">
            <h3>{t("journal.tags")}</h3>
            <div className="journal-calendar__tag-list">
              {tagCounts.map(({ label, count: tagCount }) => (
                <button
                  key={label.toLocaleLowerCase()}
                  type="button"
                  className={cn(
                    "journal-calendar__tag-filter",
                    selectedTag?.toLocaleLowerCase() === label.toLocaleLowerCase() &&
                      "journal-calendar__tag-filter--active"
                  )}
                  onClick={() => chooseTag(label)}
                >
                  <span>#{label}</span>
                  <small>{tagCount}</small>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="journal-view__entry-area">
          {showResults ? (
            <JournalResults
              title={
                selectedTag
                  ? t("journal.tagResults", { tag: selectedTag })
                  : t("journal.searchResults", { query: searchQuery })
              }
              entries={resultEntries}
              locale={locale}
              onOpen={(date) => void openJournalDate(date)}
              onClear={clearResults}
            />
          ) : activeFilePath && activeMarkdown !== null ? (
            <JournalEntryView
              folderPath={folderPath}
              filePath={activeFilePath}
              markdown={activeMarkdown}
              dateLabel={selectedDateLabel}
              tags={activeTags}
              tagDraft={tagDraft}
              isPhone={isPhone}
              canPreviousDay={canPreviousDay}
              canNextDay={canNextDay}
              onTagDraftChange={setTagDraft}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              onPreviousDay={() => {
                if (previousDate) void openJournalDate(previousDate);
              }}
              onNextDay={() => {
                if (nextDate) void openJournalDate(nextDate);
              }}
              onShowCalendar={() => setShowMobileCalendar(true)}
              onMarkdownChange={onMarkdownChange}
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
        </main>
      </div>
    </section>
  );
}
