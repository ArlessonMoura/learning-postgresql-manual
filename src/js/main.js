// ============================================================
// PG//MANUAL — main.js
// Gerencia: nav dinâmica, roteamento por hash (SPA sem reload),
// fetch + parse dos módulos em Markdown, highlight de código,
// efeito de digitação no HERO e cópia da chave Pix.
// ============================================================

import 'bootstrap-icons/font/bootstrap-icons.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import '../styles/main.css';

import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/themes/prism-tomorrow.css';

/* ------------------------------------------------------------
 * 1. Metadados dos 9 módulos
 * ---------------------------------------------------------- */
const MODULES = [
  {
    id: 1,
    file: '/content/modulo-1.md',
    title: 'Fundamentos de Dados, SGBDs e Arquitetura de Software',
  },
  {
    id: 2,
    file: '/content/modulo-2.md',
    title: 'Instalação Guiada, Configuração e Boas Práticas',
  },
  {
    id: 3,
    file: '/content/modulo-modelagem.md',
    title: 'Modelagem Relacional, DER e Planejamento de Bancos SQL',
  },
  {
    id: 4,
    file: '/content/modulo-3.md',
    title: 'DDL e DML — Manipulação Fundamental de Dados',
  },
  {
    id: 5,
    file: '/content/modulo-4.md',
    title: 'DQL — Consultas e Segurança em Primeiro Lugar',
  },
  { id: 6, file: '/content/modulo-5.md', title: 'Recursos Avançados do PostgreSQL' },
  {
    id: 7,
    file: '/content/modulo-6.md',
    title: 'Programação no Banco e Integração com C',
  },
  { id: 8, file: '/content/modulo-7.md', title: 'Performance, Indexação e Manutenção' },
  {
    id: 9,
    file: '/content/modulo-8.md',
    title: 'Projeto Prático Guiado e Arquitetura Real',
  },
];

const cache = new Map();

/* ------------------------------------------------------------
 * 2. Configuração do marked (usa a mesma classe language-*
 *    que o Prism espera a partir do info string dos fences)
 * ---------------------------------------------------------- */
marked.setOptions({
  gfm: true,
  breaks: false,
});

/* ------------------------------------------------------------
 * 3. Referências de DOM
 * ---------------------------------------------------------- */
const heroEl = document.getElementById('hero');
const appMainEl = document.getElementById('app');
const moduleNavEl = document.getElementById('moduleNav');
const contentEl = document.getElementById('content');
const offcanvasEl = document.getElementById('navOffcanvas');
const pagerCurrentEl = document.querySelector('[data-pager-current]');
const pagerPrevBtn = document.querySelector('[data-pager="prev"]');
const pagerNextBtn = document.querySelector('[data-pager="next"]');
const pagerPrevLabel = document.querySelector('[data-pager-prev-label]');
const pagerNextLabel = document.querySelector('[data-pager-next-label]');

let bsOffcanvas = null;

/* ------------------------------------------------------------
 * 3.b Sanitização do Markdown
 * Remove resíduos do processo de geração em chat que não fazem
 * parte do conteúdo didático: o título de capa repetido em todo
 * arquivo, e a frase de encerramento conversacional no final
 * ("Fim do Módulo X. Aguardando confirmação para prosseguir...").
 * O lugar dessa frase é ocupado pela paginação própria (seção 7).
 * ---------------------------------------------------------- */
function sanitizeMarkdown(raw) {
  let text = raw;

  // Remove o H1 de capa ("# Manual Definitivo do PostgreSQL...")
  // que se repete no topo de todo módulo, junto das linhas em
  // branco seguintes — cada módulo já tem seu próprio H2 "Módulo N".
  text = text.replace(/^#{1}\s*Manual Definitivo do PostgreSQL[^\n]*\n+/i, '');

  // Remove o padrão "---" + "*Fim do Módulo/Manual ... *" no final.
  text = text.replace(/\n+-{3,}\s*\n+\*Fim do[^\n]*\*\s*$/i, '');
  // Cobre também o caso sem o "---" antecedendo (ex.: fim do último módulo).
  text = text.replace(/\n+\*Fim do[^\n]*\*\s*$/i, '');
  // Qualquer resquício isolado de "Aguardando confirmação..." remanescente.
  text = text.replace(/\n+Aguardando confirmação[^\n]*$/i, '');

  return text.trim();
}

/* ------------------------------------------------------------
 * 4. Construção dinâmica do menu (offcanvas)
 * ---------------------------------------------------------- */
function buildNav() {
  const fragment = document.createDocumentFragment();

  MODULES.forEach((mod) => {
    const li = document.createElement('li');
    li.className = 'module-nav__item';

    const link = document.createElement('a');
    link.href = `#modulo-${mod.id}`;
    link.className = 'module-nav__link';
    link.dataset.moduleId = String(mod.id);
    link.innerHTML = `
      <span class="module-nav__index">0${mod.id}</span>
      <span class="module-nav__label">${mod.title}</span>
    `;

    li.appendChild(link);
    fragment.appendChild(li);
  });

  moduleNavEl.appendChild(fragment);
}

function setActiveNav(moduleId) {
  document.querySelectorAll('.module-nav__link').forEach((el) => {
    el.classList.toggle('is-active', Number(el.dataset.moduleId) === moduleId);
  });
}

/* ------------------------------------------------------------
 * 5. Renderização de um módulo
 * ---------------------------------------------------------- */
async function fetchModuleMarkdown(mod) {
  if (cache.has(mod.id)) return cache.get(mod.id);

  const response = await fetch(mod.file);
  if (!response.ok) {
    throw new Error(`Não foi possível carregar ${mod.file} (HTTP ${response.status})`);
  }
  const text = await response.text();
  cache.set(mod.id, text);
  return text;
}

function showLoadingState() {
  contentEl.innerHTML = `
    <div class="content-loading d-flex flex-column align-items-center justify-content-center gap-3 text-muted">
      <div class="loader-ring" aria-hidden="true"></div>
      <p>Carregando módulo…</p>
    </div>
  `;
}

function showErrorState(mod, error) {
  contentEl.innerHTML = `
    <div class="content-loading d-flex flex-column align-items-center justify-content-center gap-3 text-center">
      <i class="bi bi-exclamation-triangle" style="font-size:2rem;color:var(--neon-magenta);"></i>
      <p class="text-muted mb-0">Não foi possível carregar o Módulo ${mod.id}.</p>
      <p class="small text-muted">${error.message}</p>
    </div>
  `;
}

function updatePager(currentIndex) {
  const prevMod = MODULES[currentIndex - 1];
  const nextMod = MODULES[currentIndex + 1];

  pagerPrevBtn.disabled = !prevMod;
  pagerNextBtn.disabled = !nextMod;
  pagerPrevBtn.dataset.targetId = prevMod ? String(prevMod.id) : '';
  pagerNextBtn.dataset.targetId = nextMod ? String(nextMod.id) : '';

  pagerPrevLabel.textContent = prevMod ? `Módulo ${prevMod.id}` : 'Anterior';
  pagerNextLabel.textContent = nextMod ? `Módulo ${nextMod.id}` : 'Próximo';
  pagerCurrentEl.textContent = `Módulo ${currentIndex + 1} de ${MODULES.length}`;
}

/* ------------------------------------------------------------
 * 6.b Paginação própria inserida ao final de cada módulo
 * Ocupa exatamente o lugar onde antes aparecia o texto residual
 * "Fim do Módulo X. Aguardando confirmação...". Botão "Anterior"
 * desabilitado no Módulo 1; "Próximo" leva até o Módulo 9, onde
 * fica desabilitado.
 * ---------------------------------------------------------- */
function buildBottomPagerHTML(currentIndex) {
  const prevMod = MODULES[currentIndex - 1];
  const nextMod = MODULES[currentIndex + 1];

  return `
    <nav class="module-pager module-pager--bottom d-flex align-items-center justify-content-between flex-wrap gap-2 mt-5 pt-4" aria-label="Ir para o módulo anterior ou próximo">
      <button type="button"
              class="pager-btn"
              data-pager-bottom="prev"
              data-target-id="${prevMod ? prevMod.id : ''}"
              ${prevMod ? '' : 'disabled'}>
        <i class="bi bi-chevron-left" aria-hidden="true"></i>
        Módulo Anterior
      </button>
      <span class="pager-current text-muted small">Módulo ${currentIndex + 1} de ${MODULES.length}</span>
      <button type="button"
              class="pager-btn"
              data-pager-bottom="next"
              data-target-id="${nextMod ? nextMod.id : ''}"
              ${nextMod ? '' : 'disabled'}>
        Próximo Módulo
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>
    </nav>
  `;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderModule(moduleId, { scrollTop = true } = {}) {
  const index = MODULES.findIndex((m) => m.id === moduleId);
  if (index === -1) return;
  const mod = MODULES[index];

  showLoadingState();
  setActiveNav(moduleId);
  updatePager(index);

  try {
    const rawMarkdown = await fetchModuleMarkdown(mod);
    const cleanMarkdown = sanitizeMarkdown(rawMarkdown);
    const html = marked.parse(cleanMarkdown);

    contentEl.innerHTML = `<div class="md-body">${html}</div>${buildBottomPagerHTML(index)}`;
    Prism.highlightAllUnder(contentEl);

    if (scrollTop) {
      scrollToTop();
    }
  } catch (error) {
    showErrorState(mod, error);
  }
}

/* ------------------------------------------------------------
 * 6. Roteamento por hash — sem reload
 *    #home (ou hash vazio)  -> Landing Page (HERO + Footer)
 *    #modulo-N              -> Leitor de Módulos (HERO oculto)
 * ---------------------------------------------------------- */
function parseModuleIdFromHash() {
  const match = window.location.hash.match(/^#modulo-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isHomeHash(hash) {
  return hash === '' || hash === '#' || hash === '#home';
}

function showLanding() {
  heroEl.classList.remove('d-none');
  appMainEl.classList.add('d-none');
  setActiveNav(null);
  scrollToTop();
}

function showModuleView() {
  heroEl.classList.add('d-none');
  appMainEl.classList.remove('d-none');
}

function goHome() {
  if (isHomeHash(window.location.hash)) {
    // Hash já é "home": não dispara hashchange, então alterna manualmente.
    showLanding();
    closeOffcanvas();
  } else {
    window.location.hash = 'home';
  }
}

function navigateTo(moduleId) {
  const targetHash = `modulo-${moduleId}`;
  if (window.location.hash === `#${targetHash}`) {
    // Já estamos nesse módulo (ex.: clique repetido): apenas garante a view certa.
    showModuleView();
    renderModule(moduleId);
  } else {
    window.location.hash = targetHash;
  }
}

function handleRoute() {
  const hash = window.location.hash;

  if (isHomeHash(hash)) {
    showLanding();
    closeOffcanvas();
    return;
  }

  const id = parseModuleIdFromHash();
  if (id && MODULES.some((m) => m.id === id)) {
    showModuleView();
    renderModule(id);
    closeOffcanvas();
  } else {
    // Hash desconhecido: volta para a Landing Page com segurança.
    showLanding();
  }
}

window.addEventListener('hashchange', handleRoute);

/* ------------------------------------------------------------
 * 7. Interações: cliques na nav, pager (topo e rodapé), CTA, Home
 * ---------------------------------------------------------- */
function closeOffcanvas() {
  if (bsOffcanvas) bsOffcanvas.hide();
}

moduleNavEl.addEventListener('click', (event) => {
  const link = event.target.closest('.module-nav__link');
  if (!link) return;
  event.preventDefault();
  navigateTo(Number(link.dataset.moduleId));
});

pagerPrevBtn.addEventListener('click', () => {
  if (pagerPrevBtn.dataset.targetId) navigateTo(Number(pagerPrevBtn.dataset.targetId));
});
pagerNextBtn.addEventListener('click', () => {
  if (pagerNextBtn.dataset.targetId) navigateTo(Number(pagerNextBtn.dataset.targetId));
});

// Paginação inserida dinamicamente no rodapé de cada módulo (seção 6.b):
// usa delegação de evento, já que o HTML é recriado a cada renderModule().
contentEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-pager-bottom]');
  if (!btn || btn.disabled) return;
  const targetId = btn.dataset.targetId;
  if (!targetId) return;
  navigateTo(Number(targetId));
});

document.querySelector('[data-start-reading]').addEventListener('click', () => {
  navigateTo(1);
});

document.querySelectorAll('[data-nav-home], [data-nav-home-top]').forEach((el) => {
  el.addEventListener('click', (event) => {
    event.preventDefault();
    goHome();
  });
});

/* ------------------------------------------------------------
 * 8. Efeito de digitação no HERO
 * ---------------------------------------------------------- */
function typeEffect(
  el,
  phrases,
  { typeSpeed = 55, deleteSpeed = 28, pause = 1800 } = {},
) {
  let phraseIndex = 0;
  let charIndex = 0;
  let deleting = false;

  function tick() {
    const current = phrases[phraseIndex];

    if (!deleting) {
      charIndex += 1;
      el.textContent = current.slice(0, charIndex);
      if (charIndex === current.length) {
        deleting = true;
        setTimeout(tick, pause);
        return;
      }
      setTimeout(tick, typeSpeed);
    } else {
      charIndex -= 1;
      el.textContent = current.slice(0, charIndex);
      if (charIndex === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
      }
      setTimeout(tick, deleteSpeed);
    }
  }

  tick();
}

/* ------------------------------------------------------------
 * 9. Cópia da chave Pix
 * ---------------------------------------------------------- */
function setupPixCopy() {
  const button = document.querySelector('[data-copy-pix]');
  const keyEl = document.getElementById('pix-key');
  if (!button || !keyEl) return;

  button.addEventListener('click', async () => {
    const key = keyEl.textContent.trim();
    const icon = button.querySelector('i');

    try {
      await navigator.clipboard.writeText(key);
    } catch {
      // Fallback para navegadores sem suporte à Clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = key;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    button.classList.add('is-copied');
    button.setAttribute('aria-label', 'Chave Pix copiada');
    if (icon) {
      icon.classList.remove('bi-clipboard');
      icon.classList.add('bi-clipboard-check');
    }

    setTimeout(() => {
      button.classList.remove('is-copied');
      button.setAttribute('aria-label', 'Copiar chave Pix');
      if (icon) {
        icon.classList.remove('bi-clipboard-check');
        icon.classList.add('bi-clipboard');
      }
    }, 2200);
  });
}

/* ------------------------------------------------------------
 * 10. Inicialização
 * ---------------------------------------------------------- */
function respectMotionPreference() {
  // Aplicada em JS (matchMedia), não em CSS, para manter o main.css
  // totalmente livre de regras @media, conforme a diretriz do projeto.
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => document.body.classList.toggle('reduce-motion', query.matches);
  apply();
  query.addEventListener('change', apply);
}

function init() {
  buildNav();
  setupPixCopy();
  respectMotionPreference();

  bsOffcanvas = window.bootstrap
    ? window.bootstrap.Offcanvas.getOrCreateInstance(offcanvasEl)
    : null;

  typeEffect(document.getElementById('heroTyping'), [
    "CREATE TABLE conhecimento (nivel TEXT DEFAULT 'avançado');",
    'SELECT * FROM boas_praticas WHERE seguranca = TRUE;',
    '// libpq: PQexecParams() — zero SQL Injection.',
  ]);

  // Estado inicial: respeita o hash da URL. Sem hash (ou "#home"),
  // a Landing Page (HERO) é a única coisa visível — o leitor de
  // módulos só aparece quando o usuário escolhe entrar nele.
  handleRoute();
}

document.addEventListener('DOMContentLoaded', init);
