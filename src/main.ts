import {
  Archive as ArchiveIcon,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Check,
  Copy,
  createIcons,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
  Share2,
  WifiOff,
  X
} from "lucide";
import "./styles.css";
import type { Archive, Issue, Material } from "./types";

type View = "issue" | "saved";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("App root was not found");
}

const app: HTMLDivElement = appElement;

const savedKey = "vneshniy-internet:saved";
let archive: Archive;
let selectedDate = "";
let query = "";
let selectedTopic = "Все";
let view: View = "issue";
let saved = new Set<string>(JSON.parse(localStorage.getItem(savedKey) ?? "[]") as string[]);
let installPrompt: InstallPromptEvent | null = null;
let updateRegistration: ServiceWorkerRegistration | null = null;

const iconSet = {
  Archive: ArchiveIcon,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Check,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
  Share2,
  WifiOff,
  X
};

function renderIcons() {
  createIcons({ icons: iconSet });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(date: string, withYear = true) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {})
  }).format(new Date(`${date}T12:00:00`));
}

function formatHeadingDate(date: string) {
  return formatDate(date).replace(/\s*г\.$/u, "");
}

function wordForm(count: number, forms: [string, string, string]) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function persistSaved() {
  localStorage.setItem(savedKey, JSON.stringify([...saved]));
}

function getSelectedIssue() {
  return archive.issues.find((issue) => issue.date === selectedDate) ?? archive.issues[0];
}

function findMaterial(id: string) {
  for (const issue of archive.issues) {
    const material = issue.materials.find((item) => item.id === id);
    if (material) return { issue, material };
  }
  return null;
}

function searchableText(issue: Issue, material: Material) {
  return [
    issue.label,
    issue.date,
    material.title,
    material.topic,
    ...material.body,
    ...material.sources.map((source) => source.label)
  ]
    .join(" ")
    .toLocaleLowerCase("ru");
}

function getFilteredMaterials() {
  const needle = query.trim().toLocaleLowerCase("ru");

  return archive.issues.flatMap((issue) =>
    issue.materials
      .filter((material) => {
        const topicMatches = selectedTopic === "Все" || material.topic === selectedTopic;
        const queryMatches = !needle || searchableText(issue, material).includes(needle);
        return topicMatches && queryMatches;
      })
      .map((material) => ({ issue, material }))
  );
}

function topicButton(topic: string) {
  const active = topic === selectedTopic;
  return `
    <button
      class="topic-button${active ? " is-active" : ""}"
      type="button"
      data-topic="${escapeHtml(topic)}"
      aria-pressed="${active}"
    >
      ${escapeHtml(topic)}
    </button>
  `;
}

function archiveButton(issue: Issue) {
  const active = issue.date === selectedDate && view === "issue" && !query && selectedTopic === "Все";
  return `
    <button
      class="archive-date${active ? " is-active" : ""}"
      type="button"
      data-date="${issue.date}"
      aria-current="${active ? "page" : "false"}"
    >
      <span>${formatDate(issue.date, false)}</span>
      <small>${issue.materials.length}</small>
    </button>
  `;
}

function materialCard(issue: Issue, material: Material, showDate: boolean) {
  const isSaved = saved.has(material.id);
  return `
    <article class="material" id="${material.id}" data-material="${material.id}">
      <header class="material-header">
        <div class="material-meta">
          ${showDate ? `<button class="date-link" type="button" data-date="${issue.date}">${formatDate(issue.date)}</button>` : ""}
          <span class="topic-label">${escapeHtml(material.topic)}</span>
          ${material.isAi ? `<span class="ai-label">AI</span>` : ""}
        </div>
        <div class="material-actions">
          <button
            class="icon-button"
            type="button"
            data-action="save"
            data-id="${material.id}"
            aria-label="${isSaved ? "Убрать из сохраненных" : "Сохранить материал"}"
            title="${isSaved ? "Убрать из сохраненных" : "Сохранить"}"
          >
            <i data-lucide="${isSaved ? "bookmark-check" : "bookmark"}"></i>
          </button>
          <button
            class="icon-button"
            type="button"
            data-action="share"
            data-id="${material.id}"
            aria-label="Поделиться материалом"
            title="Поделиться"
          >
            <i data-lucide="share-2"></i>
          </button>
        </div>
      </header>

      <h2>${escapeHtml(material.title)}</h2>

      <div class="material-body">
        ${material.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      </div>

      <div class="sources">
        <span>Источник:</span>
        ${material.sources
          .map(
            (source) => `
              <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
                ${escapeHtml(source.label)}, ${formatDate(source.date)}
                <i data-lucide="external-link"></i>
              </a>
            `
          )
          .join("")}
      </div>

      ${
        material.check.length
          ? `
            <details class="checks">
              <summary>Проверить перед публикацией</summary>
              ${material.check.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
            </details>
          `
          : ""
      }
    </article>
  `;
}

function emptyState(title: string, text: string) {
  return `
    <div class="empty-state">
      <span class="empty-mark">∅</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
      <button type="button" class="text-button" data-action="clear-filters">Сбросить фильтры</button>
    </div>
  `;
}

function mainContent() {
  const isFiltering = Boolean(query.trim()) || selectedTopic !== "Все";

  if (view === "saved") {
    const materials = archive.issues.flatMap((issue) =>
      issue.materials
        .filter((material) => saved.has(material.id))
        .map((material) => ({ issue, material }))
    );

    return `
      <section class="issue-heading compact">
        <div>
          <span class="eyebrow">Личная подборка</span>
          <h1>Сохраненные</h1>
        </div>
        <p>${materials.length} ${wordForm(materials.length, ["материал", "материала", "материалов"])}</p>
      </section>
      <div class="materials">
        ${
          materials.length
            ? materials.map(({ issue, material }) => materialCard(issue, material, true)).join("")
            : emptyState("Пока ничего не сохранено", "Нажмите на закладку у материала, чтобы он появился здесь.")
        }
      </div>
    `;
  }

  if (isFiltering) {
    const materials = getFilteredMaterials();
    const title = query.trim() ? `Поиск: «${query.trim()}»` : selectedTopic;
    return `
      <section class="issue-heading compact">
        <div>
          <span class="eyebrow">По всему архиву</span>
          <h1>${escapeHtml(title)}</h1>
        </div>
        <p>${materials.length} ${wordForm(materials.length, ["совпадение", "совпадения", "совпадений"])}</p>
      </section>
      <div class="materials">
        ${
          materials.length
            ? materials.map(({ issue, material }) => materialCard(issue, material, true)).join("")
            : emptyState("Ничего не найдено", "Попробуйте другой запрос или снимите фильтр темы.")
        }
      </div>
    `;
  }

  const issue = getSelectedIssue();
  return `
    <section class="issue-heading">
      <div>
        <span class="eyebrow">${escapeHtml(issue.label)}</span>
        <h1>${formatHeadingDate(issue.date)}</h1>
      </div>
      <p>${escapeHtml(issue.summary)}</p>
    </section>
    <div class="materials">
      ${issue.materials.map((material) => materialCard(issue, material, false)).join("")}
    </div>
  `;
}

function render() {
  const currentIssue = getSelectedIssue();
  const savedCount = saved.size;

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="./icon.svg" width="42" height="42" alt="" />
          <div>
            <strong>Внешний интернет</strong>
            <span>Архив инфоповодов</span>
          </div>
        </div>

        <nav class="primary-nav" aria-label="Основная навигация">
          <button class="${view === "issue" ? "is-active" : ""}" type="button" data-action="latest">
            <i data-lucide="archive"></i>
            Архив
          </button>
          <button class="${view === "saved" ? "is-active" : ""}" type="button" data-action="show-saved">
            <i data-lucide="bookmark"></i>
            Сохраненные
            ${savedCount ? `<span class="nav-count">${savedCount}</span>` : ""}
          </button>
        </nav>

        <div class="archive-list">
          <div class="section-label">
            <span>Выпуски</span>
            <small>${archive.issueCount}</small>
          </div>
          ${archive.issues.map(archiveButton).join("")}
        </div>

        <div class="sidebar-footer">
          <div class="connection-state" data-connection>
            <span class="status-dot"></span>
            <span>${navigator.onLine ? "Архив обновлен" : "Офлайн-режим"}</span>
          </div>
          <button class="install-button${installPrompt ? "" : " is-hidden"}" type="button" data-action="install">
            <i data-lucide="download"></i>
            Установить приложение
          </button>
        </div>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <button class="mobile-brand" type="button" data-action="latest" aria-label="Открыть свежий выпуск">
            <img src="./icon.svg" width="32" height="32" alt="" />
            <strong>Внешний интернет</strong>
          </button>

          <label class="search-box">
            <i data-lucide="search"></i>
            <input
              type="search"
              placeholder="Поиск по архиву"
              value="${escapeHtml(query)}"
              aria-label="Поиск по архиву"
              data-search
            />
            ${
              query
                ? `<button type="button" data-action="clear-search" aria-label="Очистить поиск"><i data-lucide="x"></i></button>`
                : ""
            }
          </label>

          <button class="topbar-saved" type="button" data-action="show-saved" aria-label="Открыть сохраненные">
            <i data-lucide="${view === "saved" ? "bookmark-check" : "bookmark"}"></i>
            ${savedCount ? `<span>${savedCount}</span>` : ""}
          </button>
        </header>

        <div class="topic-strip" aria-label="Темы">
          ${["Все", ...archive.topics].map(topicButton).join("")}
        </div>

        <main>
          ${mainContent()}
        </main>

        <footer class="page-footer">
          <span>Обновлено ${formatDate(currentIssue.date)}</span>
          <span>Данные хранятся в GitHub</span>
        </footer>
      </div>
    </div>

    <div class="toast" role="status" aria-live="polite" data-toast></div>
    <div class="update-banner${updateRegistration ? " is-visible" : ""}" data-update-banner>
      <span>Доступна свежая версия приложения</span>
      <button type="button" data-action="update">
        <i data-lucide="refresh-cw"></i>
        Обновить
      </button>
    </div>
  `;

  bindEvents();
  renderIcons();
}

function bindEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDate = button.dataset.date ?? selectedDate;
      view = "issue";
      query = "";
      selectedTopic = "Все";
      history.replaceState(null, "", location.pathname);
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-topic]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTopic = button.dataset.topic ?? "Все";
      view = "issue";
      render();
    });
  });

  const search = app.querySelector<HTMLInputElement>("[data-search]");
  search?.addEventListener("input", () => {
    query = search.value;
    view = "issue";
    render();
    requestAnimationFrame(() => {
      const nextSearch = app.querySelector<HTMLInputElement>("[data-search]");
      nextSearch?.focus();
      nextSearch?.setSelectionRange(query.length, query.length);
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button));
  });
}

async function handleAction(button: HTMLButtonElement) {
  const action = button.dataset.action;

  if (action === "latest") {
    selectedDate = archive.issues[0].date;
    query = "";
    selectedTopic = "Все";
    view = "issue";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (action === "show-saved") {
    query = "";
    selectedTopic = "Все";
    view = "saved";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (action === "save") {
    const id = button.dataset.id;
    if (!id) return;
    if (saved.has(id)) {
      saved.delete(id);
      showToast("Убрано из сохраненных");
    } else {
      saved.add(id);
      showToast("Сохранено");
    }
    persistSaved();
    render();
  }

  if (action === "share") {
    const id = button.dataset.id;
    const found = id ? findMaterial(id) : null;
    if (!found) return;
    await shareMaterial(found.issue, found.material);
  }

  if (action === "clear-search") {
    query = "";
    render();
    app.querySelector<HTMLInputElement>("[data-search]")?.focus();
  }

  if (action === "clear-filters") {
    query = "";
    selectedTopic = "Все";
    view = "issue";
    render();
  }

  if (action === "install" && installPrompt) {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") showToast("Приложение установлено");
    installPrompt = null;
    render();
  }

  if (action === "update" && updateRegistration?.waiting) {
    updateRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

async function shareMaterial(issue: Issue, material: Material) {
  const baseUrl = `${location.origin}${location.pathname}`;
  const url = `${baseUrl}#${material.id}`;
  const text = `${material.title}\n\n${material.body[0]}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: material.title, text, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  await navigator.clipboard.writeText(`${text}\n\n${url}`);
  showToast(`Ссылка на выпуск от ${formatDate(issue.date)} скопирована`);
}

function showToast(message: string) {
  const toast = app.querySelector<HTMLDivElement>("[data-toast]");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function updateConnectionState() {
  const state = app.querySelector<HTMLElement>("[data-connection]");
  if (!state) return;
  state.classList.toggle("is-offline", !navigator.onLine);
  state.innerHTML = navigator.onLine
    ? `<span class="status-dot"></span><span>Архив обновлен</span>`
    : `<i data-lucide="wifi-off"></i><span>Офлайн-режим</span>`;
  renderIcons();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.register("./sw.js");

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        updateRegistration = registration;
        render();
      }
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
}

async function init() {
  try {
    const response = await fetch("./archive.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Archive request failed: ${response.status}`);
    archive = (await response.json()) as Archive;
    if (!archive.issues.length) throw new Error("Archive is empty");

    const hashId = location.hash.slice(1);
    const deepLink = hashId ? findMaterial(hashId) : null;
    selectedDate = deepLink?.issue.date ?? archive.issues[0].date;

    render();

    if (hashId) {
      requestAnimationFrame(() => document.getElementById(hashId)?.scrollIntoView({ behavior: "smooth" }));
    }

    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event as InstallPromptEvent;
      render();
    });
    window.addEventListener("appinstalled", () => {
      installPrompt = null;
      render();
    });

    if (import.meta.env.PROD) {
      await registerServiceWorker();
    }
  } catch (error) {
    console.error(error);
    app.innerHTML = `
      <div class="fatal-error">
        <img src="./icon.svg" width="56" height="56" alt="" />
        <h1>Архив пока не открылся</h1>
        <p>Проверьте соединение и попробуйте еще раз. Уже сохраненные выпуски останутся доступны офлайн.</p>
        <button type="button" onclick="location.reload()"><i data-lucide="refresh-cw"></i>Повторить</button>
      </div>
    `;
    renderIcons();
  }
}

void init();
