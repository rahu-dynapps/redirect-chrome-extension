// Traduction de l'interface. Les messages vivent dans _locales/<langue>/messages.json ;
// l'anglais est la langue par défaut, le français est fourni.

/** Message traduit. `substitutions` alimente les jetons $1, $2… du catalogue. */
export function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Applique les traductions à un arbre DOM :
 *   data-i18n              → textContent
 *   data-i18n-rich         → textContent + balisage simple (voir renderRich)
 *   data-i18n-placeholder  → attribut placeholder
 *   data-i18n-title        → attribut title
 *   data-i18n-label        → attribut aria-label
 */
export function applyI18n(root = document) {
  if (root === document) document.documentElement.lang = chrome.i18n.getUILanguage();

  for (const [attribute, apply] of Object.entries(APPLIERS)) {
    for (const node of nodesWith(root, attribute)) {
      apply(node, t(node.getAttribute(attribute)));
    }
  }
}

const APPLIERS = {
  'data-i18n': (node, message) => {
    node.textContent = message;
  },
  'data-i18n-rich': renderRich,
  'data-i18n-placeholder': (node, message) => {
    node.placeholder = message;
  },
  'data-i18n-title': (node, message) => {
    node.title = message;
  },
  'data-i18n-label': (node, message) => node.setAttribute('aria-label', message)
};

function nodesWith(root, attribute) {
  const selector = `[${attribute}]`;
  const nodes = [...root.querySelectorAll(selector)];
  if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) nodes.unshift(root);
  return nodes;
}

/**
 * Balisage minimal autorisé dans les messages : `code` et [[touche]].
 * Les nœuds sont construits un par un — aucun innerHTML, donc aucune injection possible.
 */
function renderRich(node, message) {
  node.textContent = '';
  for (const part of message.split(/(`[^`]+`|\[\[[^\]]+\]\])/g)) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`')) {
      node.append(element('code', part.slice(1, -1)));
    } else if (part.startsWith('[[') && part.endsWith(']]')) {
      node.append(element('kbd', part.slice(2, -2)));
    } else {
      node.append(document.createTextNode(part));
    }
  }
}

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
