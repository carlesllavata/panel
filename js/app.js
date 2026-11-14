import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config.js';
import { supabaseApi } from './data.js';
import { demoApi } from './demo.js';

const demo = new URLSearchParams(location.search).has('demo');
const api = demo ? demoApi() : supabaseApi(window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY));

const root = document.getElementById('app');
const state = {
  ready: false,
  user: null,
  access: true,
  tab: 'queue',
  sequences: [],
  studios: [],
  /** The studio whose emails are open, by enrollment id. */
  open: null,
  /** Text typed and not saved yet: the subject, and each email by message id. */
  edits: { subject: null, bodies: {} },
  asking: false,
  busy: false,
  added: null,
};

// --- Small helpers ---------------------------------------------------------------------------

/** Builds an element: h('button', { class: 'primary', onclick: fn }, 'Text'). */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'class') element.className = value;
    else if (key === 'value') element.value = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

const languageNames = new Intl.DisplayNames(['es'], { type: 'language' });
const countryNames = new Intl.DisplayNames(['es'], { type: 'region' });
const languageName = (code) => { try { return languageNames.of(code) ?? code; } catch { return code; } };
const countryName = (code) => { try { return countryNames.of(code) ?? code; } catch { return code; } };
const domain = (website) => (website ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
const words = (text) => text.replace(/\bhttps?:\/\/\S+/g, ' ').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const STEP_TITLE = { 1: 'Primer correo', 2: 'Seguimiento 1', 3: 'Seguimiento 2' };
const STEP_NOTE = { 1: 'sale primero', 2: 'unos días después, si no responde', 3: 'el último, una semana más tarde' };

const RESEARCH = {
  pending: 'En cola, esperando su turno', researching: 'Investigando', done: 'Ficha completa', unreachable: 'Web inaccesible',
  insufficient_info: 'Información insuficiente', low_fit: 'No es un estudio de arquitectura', no_valid_email: 'Sin correo válido',
  failed: 'Falló la investigación', excluded: 'Excluido', duplicate: 'Duplicado', no_website: 'Sin web',
};
const SEQUENCE = {
  queued: 'Correos por aprobar o enviar', active: 'Secuencia en curso', replied: 'Ha respondido', completed: 'Secuencia terminada',
  bounced: 'Rebotó', unsubscribed: 'Pidió no recibir más', invalid: 'Correo no válido', skipped: 'Descartado',
};

// The notice lives outside the redrawn area, so showing or hiding it never disturbs what is being typed.
const toast = h('div', { class: 'notice', hidden: true, onclick: () => { toast.hidden = true; } });
document.body.append(toast);
let toastTimer;

function notify(kind, text) {
  clearTimeout(toastTimer);
  toast.className = `notice ${kind}`;
  toast.textContent = text;
  toast.hidden = false;
  if (kind === 'ok') toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}

/** Runs something that talks to the database, showing a failure instead of losing it. */
async function run(action, done) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await action();
    state.busy = false;
    render();
    if (done) notify('ok', done);
  } catch (error) {
    state.busy = false;
    render();
    notify('error', error instanceof Error ? error.message : String(error));
  }
}

async function loadSequences() {
  state.sequences = await api.listSequences();
  if (state.open !== null && !state.sequences.some((s) => s.enrollmentId === state.open)) closeSequence();
}

function openSequence(enrollmentId) {
  state.open = enrollmentId;
  state.edits = { subject: null, bodies: {} };
  state.asking = false;
  render();
  window.scrollTo(0, 0);
}

function closeSequence() {
  state.open = null;
  state.edits = { subject: null, bodies: {} };
  state.asking = false;
}

// --- Saving what was typed ---------------------------------------------------------------------

async function saveEdits(sequence) {
  const subject = state.edits.subject?.trim();
  if (subject && subject !== sequence.subject) await api.saveSubject(sequence.enrollmentId, subject);
  for (const message of sequence.messages) {
    const body = state.edits.bodies[message.id];
    if (body !== undefined && body.trim() && body !== message.body) await api.saveEmail(message.id, body.trimEnd());
  }
  state.edits = { subject: null, bodies: {} };
}

const approve = (sequence, messages) =>
  run(async () => {
    await saveEdits(sequence);
    await api.approve(messages.map((m) => m.id), state.user);
    await loadSequences();
  }, messages.length > 1 ? 'Secuencia aprobada' : 'Correo aprobado');

const unapprove = (sequence, message) =>
  run(async () => {
    await saveEdits(sequence);
    await api.unapprove(message.id);
    await loadSequences();
  });

const saveOnly = (sequence) =>
  run(async () => {
    await saveEdits(sequence);
    await loadSequences();
  }, 'Cambios guardados');

function requestNewVersion(sequence, text) {
  if (!text.trim()) return notify('error', 'Escribe qué quieres que cambie');
  return run(async () => {
    await api.requestNewVersion(sequence.enrollmentId, text.trim());
    closeSequence();
    await loadSequences();
  }, 'Petición enviada: se redactará otra versión');
}

function discard(sequence) {
  if (!confirm(`¿Descartar ${sequence.studio.name ?? 'este estudio'}? No se le enviará ningún correo.`)) return;
  run(async () => {
    await api.discard(sequence.enrollmentId);
    closeSequence();
    await loadSequences();
  }, 'Estudio descartado');
}

// --- Screens ---------------------------------------------------------------------------------

/** The wordmark. It is drawn in the text colour, so it shows on both the light and the dark theme. */
function logo(size = '') {
  return h('span', { class: `logo ${size}`, role: 'img', 'aria-label': 'Pospo' });
}

function loginScreen() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'tu@correo.com' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  return h(
    'form',
    {
      class: 'login',
      onsubmit: (event) => {
        event.preventDefault();
        run(async () => {
          await api.signIn(email.value.trim(), password.value);
          await start();
        });
      },
    },
    logo(),
    h('p', { class: 'muted tagline' }, 'Email Marketing Platform'),
    h('label', {}, 'Correo', email),
    h('label', {}, 'Contraseña', password),
    h('button', { class: 'primary', disabled: state.busy }, state.busy ? 'Entrando…' : 'Entrar'),
  );
}

function noAccessScreen() {
  return h(
    'div',
    { class: 'login' },
    h('h1', {}, 'Sin acceso'),
    h('p', {}, `El usuario ${state.user} existe, pero no está en la lista de quienes pueden usar el panel.`),
    h('button', { onclick: () => run(async () => { await api.signOut(); state.user = null; }) }, 'Salir'),
  );
}

function findingsList(findings) {
  if (findings.length === 0) return null;
  return h(
    'ul',
    { class: 'findings' },
    findings.map((finding) =>
      h('li', { class: finding.level }, finding.message, finding.quote ? h('q', {}, finding.quote) : null),
    ),
  );
}

function sequenceCard(sequence) {
  const approved = sequence.messages.filter((m) => m.status === 'approved').length;
  const to = sequence.recipient.name ? `${sequence.recipient.name}${sequence.recipient.role ? ` · ${sequence.recipient.role}` : ''}` : sequence.recipient.email;
  return h(
    'button',
    { class: 'card', onclick: () => openSequence(sequence.enrollmentId) },
    h('strong', {}, sequence.studio.name ?? domain(sequence.studio.website)),
    h('span', { class: 'muted' }, to),
    h(
      'span',
      { class: 'chips' },
      h('span', { class: 'chip' }, languageName(sequence.language ?? 'es')),
      sequence.verdict === 'review' ? h('span', { class: 'chip warn' }, 'Con avisos') : null,
      h('span', { class: `chip ${approved === sequence.messages.length ? 'good' : ''}` }, `${approved} de ${sequence.messages.length} aprobados`),
    ),
  );
}

function queueScreen() {
  const pending = state.sequences.filter((s) => s.pending);
  const waiting = state.sequences.filter((s) => !s.pending);
  return h(
    'section',
    {},
    h('h2', {}, 'Por aprobar'),
    pending.length === 0 ? h('p', { class: 'empty' }, 'No hay correos esperando tu aprobación.') : pending.map(sequenceCard),
    waiting.length > 0 ? h('h2', {}, 'Aprobados, a la espera de envío') : null,
    waiting.map(sequenceCard),
  );
}

function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function emailCard(sequence, message) {
  const text = state.edits.bodies[message.id] ?? message.body;
  const count = h('span', { class: 'muted small' }, `${words(text)} palabras`);
  const textarea = h('textarea', {
    class: 'body',
    spellcheck: 'true',
    lang: sequence.language ?? 'es',
    value: text,
    oninput: (event) => {
      state.edits.bodies[message.id] = event.target.value;
      count.textContent = `${words(event.target.value)} palabras`;
      grow(event.target);
    },
  });
  const approved = message.status === 'approved';
  return h(
    'article',
    { class: `email ${approved ? 'approved' : ''}` },
    h('header', {}, h('h3', {}, STEP_TITLE[message.step] ?? `Correo ${message.step}`), h('span', { class: 'muted small' }, STEP_NOTE[message.step] ?? '')),
    findingsList(message.findings),
    textarea,
    h(
      'div',
      { class: 'meta' },
      count,
      message.project ? h('a', { href: message.project.url, target: '_blank', rel: 'noopener' }, `Enlaza: ${message.project.title}`) : null,
    ),
    message.translation && sequence.language !== 'es'
      ? h('details', {}, h('summary', {}, 'Ver traducción al español'), h('p', { class: 'translation' }, message.translation))
      : null,
    approved
      ? h('div', { class: 'row' }, h('span', { class: 'chip good' }, 'Aprobado'), h('button', { class: 'link', onclick: () => unapprove(sequence, message) }, 'Retirar aprobación'))
      : h('button', { class: 'primary', disabled: state.busy, onclick: () => approve(sequence, [message]) }, 'Aprobar este correo'),
  );
}

function sequenceScreen(sequence) {
  const pending = sequence.messages.filter((m) => m.status === 'pending_approval');
  const request = h('textarea', { class: 'request', placeholder: 'Por ejemplo: más corto, y enlaza el proyecto del restaurante.' });
  const { studio, recipient } = sequence;
  const place = [studio.city, studio.country ? countryName(studio.country) : null].filter(Boolean).join(', ');

  return h(
    'section',
    { class: 'sequence' },
    h('button', { class: 'link back', onclick: () => { closeSequence(); render(); } }, '‹ Volver'),
    h('h2', {}, studio.name ?? domain(studio.website)),
    h(
      'p',
      { class: 'muted' },
      place ? `${place} · ` : '',
      studio.website ? h('a', { href: studio.website, target: '_blank', rel: 'noopener' }, domain(studio.website)) : null,
    ),
    h(
      'dl',
      {},
      h('dt', {}, 'Para'),
      h('dd', {}, recipient.name ? `${recipient.name}${recipient.role ? ` (${recipient.role})` : ''}, ${recipient.email}` : `${recipient.email} (buzón general)`),
      h('dt', {}, 'Idioma'),
      h('dd', {}, languageName(sequence.language ?? 'es')),
      sequence.studioFact ? h('dt', {}, 'En qué se apoya') : null,
      sequence.studioFact ? h('dd', {}, sequence.studioFact) : null,
    ),
    sequence.rewrittenBecause.length > 0
      ? h('details', {}, h('summary', {}, 'Esta versión es una reescritura'), h('p', { class: 'muted' }, 'El primer borrador se descartó por esto:'), findingsList(sequence.rewrittenBecause))
      : null,
    h(
      'label',
      { class: 'subject' },
      'Asunto',
      h('input', { type: 'text', value: state.edits.subject ?? sequence.subject, oninput: (event) => { state.edits.subject = event.target.value; } }),
    ),
    sequence.messages.map((message) => emailCard(sequence, message)),
    h(
      'div',
      { class: 'actions' },
      pending.length > 1 ? h('button', { class: 'primary', disabled: state.busy, onclick: () => approve(sequence, pending) }, `Aprobar los ${pending.length} pendientes`) : null,
      h('button', { disabled: state.busy, onclick: () => saveOnly(sequence) }, 'Guardar cambios sin aprobar'),
      h('button', { disabled: state.busy, onclick: () => { state.asking = !state.asking; render(); } }, 'Pedir otra versión'),
      state.asking
        ? h('div', { class: 'asking' }, h('p', { class: 'muted small' }, 'Los tres correos se retiran y se redactan de nuevo siguiendo lo que pidas.'), request, h('button', { class: 'primary', disabled: state.busy, onclick: () => requestNewVersion(sequence, request.value) }, 'Enviar petición'))
        : null,
      h('button', { class: 'danger', disabled: state.busy, onclick: () => discard(sequence) }, 'Descartar este estudio'),
    ),
  );
}

function studiosScreen() {
  return h(
    'section',
    {},
    h('h2', {}, `Estudios (${state.studios.length})`),
    state.studios.length === 0 ? h('p', { class: 'empty' }, 'Todavía no hay estudios. Añade el primero en «Añadir».') : null,
    state.studios.map((studio) => {
      const status = studio.sequence_status ? SEQUENCE[studio.sequence_status] : RESEARCH[studio.research_status];
      const place = [studio.city, studio.country ? countryName(studio.country) : null].filter(Boolean).join(', ');
      return h(
        'div',
        { class: 'card static' },
        h('strong', {}, studio.name ?? domain(studio.website)),
        h('span', { class: 'muted' }, [place, studio.name ? domain(studio.website) : null].filter(Boolean).join(' · ')),
        h(
          'span',
          { class: 'chips' },
          h('span', { class: 'chip' }, status ?? studio.research_status),
          studio.sent_to ? h('span', { class: 'chip' }, studio.contact_name ?? studio.sent_to) : null,
          studio.emails_sent ? h('span', { class: 'chip good' }, `${studio.emails_sent} enviados`) : null,
        ),
      );
    }),
  );
}

function addScreen() {
  const box = h('textarea', { class: 'request', placeholder: 'estudio-uno.com\nwww.estudio-dos.es', rows: '6' });
  return h(
    'section',
    {},
    h('h2', {}, 'Añadir estudios'),
    h('p', { class: 'muted' }, 'Pega la web de cada estudio, una por línea. Puedes añadir todos los que quieras: cada día laborable el sistema coge 10 de la cola, por orden de llegada, rellena su ficha, busca a quién escribir y te deja los correos aquí para aprobarlos. Los demás esperan su turno.'),
    box,
    h(
      'button',
      {
        class: 'primary',
        disabled: state.busy,
        onclick: () => {
          const websites = box.value.split(/[\n,;\s]+/).map((line) => line.trim()).filter(Boolean);
          if (websites.length === 0) return notify('error', 'Pega al menos una web');
          return run(async () => {
            state.added = await api.addStudios(websites);
            state.studios = await api.listStudios();
          });
        },
      },
      'Añadir',
    ),
    state.added
      ? h(
          'div',
          { class: 'result' },
          state.added.added.length > 0 ? h('p', {}, `Añadidos: ${state.added.added.join(', ')}`) : null,
          state.added.skipped.length > 0 ? h('p', { class: 'muted' }, `Ya estaban: ${state.added.skipped.join(', ')}`) : null,
          state.added.added.length + state.added.skipped.length === 0 ? h('p', { class: 'muted' }, 'No he reconocido ninguna web en lo que has pegado.') : null,
        )
      : null,
  );
}

function tabButton(tab, label, badge) {
  return h(
    'button',
    {
      class: state.tab === tab ? 'active' : '',
      onclick: () => {
        state.tab = tab;
        closeSequence();
        state.added = null;
        render();
        if (tab === 'studios') run(async () => { state.studios = await api.listStudios(); });
        if (tab === 'queue') run(loadSequences);
      },
    },
    label,
    badge ? h('span', { class: 'badge' }, badge) : null,
  );
}

function render() {
  if (!state.ready) return root.replaceChildren(h('p', { class: 'loading' }, 'Cargando…'));
  if (!state.user) return root.replaceChildren(loginScreen());
  if (!state.access) return root.replaceChildren(noAccessScreen());

  const open = state.open === null ? null : state.sequences.find((s) => s.enrollmentId === state.open);
  const screen = open ? sequenceScreen(open) : state.tab === 'studios' ? studiosScreen() : state.tab === 'add' ? addScreen() : queueScreen();
  const pending = state.sequences.filter((s) => s.pending).length;

  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      logo('small'),
      api.demo ? h('span', { class: 'chip warn' }, 'Demostración: datos de ejemplo') : null,
      h('button', { class: 'link', onclick: () => run(async () => { await api.signOut(); state.user = null; }) }, 'Salir'),
    ),
    h('main', {}, screen),
    h('nav', {}, tabButton('queue', 'Por aprobar', pending || null), tabButton('studios', 'Estudios'), tabButton('add', 'Añadir')),
  );
  root.querySelectorAll('textarea.body').forEach(grow);
}

async function start() {
  state.user = await api.currentUser();
  if (state.user) {
    state.access = await api.hasAccess();
    if (state.access) await loadSequences();
  }
  state.ready = true;
}

start()
  .catch((error) => { state.ready = true; notify('error', error.message); })
  .finally(render);

// Lets the panel be installed on a phone's home screen and open even with a poor connection.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
