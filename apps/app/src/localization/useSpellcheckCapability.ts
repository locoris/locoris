import { useEffect, type RefObject } from "react";

import {
  detectSpellcheckLanguage,
  type SpellcheckConfiguration
} from "./spellcheckCapabilities";

const BLOCK_SELECTOR = ".bn-block-content";
const MANAGED_LANGUAGE_ATTRIBUTE = "data-locoris-spellcheck-language";

function clearManagedBlockLanguages(root: HTMLElement) {
  for (const block of root.querySelectorAll<HTMLElement>(`[${MANAGED_LANGUAGE_ATTRIBUTE}]`)) {
    block.removeAttribute("lang");
    block.removeAttribute(MANAGED_LANGUAGE_ATTRIBUTE);
  }
}

function applySpellcheckHints(root: HTMLElement, configuration: SpellcheckConfiguration) {
  const editor = root.querySelector<HTMLElement>(".locoris-editor-surface");

  if (!editor) {
    return;
  }

  editor.spellcheck = configuration.enabled;
  editor.lang = configuration.primaryLanguage;
  editor.dataset.spellcheckPlatform = configuration.adapter.platform;
  editor.dataset.spellcheckLanguages = configuration.languages.join(",");

  if (!configuration.enabled || !configuration.adapter.blockLanguageHints) {
    clearManagedBlockLanguages(editor);
    return;
  }

  for (const block of editor.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    const language = detectSpellcheckLanguage(
      block.textContent ?? "",
      configuration.languages,
      configuration.primaryLanguage
    );
    block.lang = language;
    block.setAttribute(MANAGED_LANGUAGE_ATTRIBUTE, language);
    block.spellcheck = true;
  }
}

export function useSpellcheckCapability(
  rootRef: RefObject<HTMLElement | null>,
  configuration: SpellcheckConfiguration
) {
  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => applySpellcheckHints(root, configuration));
    };
    const observer = new MutationObserver(scheduleUpdate);

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
    root.addEventListener("input", scheduleUpdate);
    scheduleUpdate();

    return () => {
      observer.disconnect();
      root.removeEventListener("input", scheduleUpdate);
      window.cancelAnimationFrame(frame);
      clearManagedBlockLanguages(root);
    };
  }, [configuration, rootRef]);
}
