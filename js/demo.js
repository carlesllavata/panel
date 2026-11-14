// Example data for trying the panel without signing in (open it with ?demo at the end of the address).
// Nothing here touches Supabase, and nothing is saved.
import { domainOf } from './data.js';

const SIGNATURE = 'Ana Soler\nDirectora\nEstudio Render\nestudiorender.example';

function sequence(enrollmentId, studio, recipient, language, subject, studioFact, verdict, emails) {
  return {
    enrollmentId,
    studio,
    recipient,
    language,
    subject,
    verdict,
    studioFact,
    rewrittenBecause: [],
    status: 'queued',
    nextSendAt: null,
    sent: 0,
    pending: true,
    messages: emails.map((email, index) => ({
      id: enrollmentId * 10 + index + 1,
      step: index + 1,
      status: 'pending_approval',
      body: `${email.body}\n${SIGNATURE}`,
      translation: email.translation ?? '',
      project: email.project ?? null,
      findings: email.findings ?? [],
    })),
  };
}

const HOUSE = { title: 'Casa del Lago', url: 'https://estudiorender.example/proyectos/casa-del-lago' };
const LOFT = { title: 'Piso Antiguo', url: 'https://estudiorender.example/proyectos/piso-antiguo' };
const CH = { title: 'Casa Patio', url: 'https://estudiorender.example/proyectos/casa-patio' };

function sampleSequences() {
  return [
    sequence(
      1,
      { id: 1, name: 'Estudio Ejemplo Arquitectura', website: 'https://estudioejemplo.es', city: 'Sevilla', country: 'ES' },
      { email: 'marta@estudioejemplo.es', name: 'Marta Ruiz', role: 'Socia fundadora' },
      'es',
      'Imágenes para vuestras viviendas',
      'Se apoya en la Casa del Acantilado que aparece en su web; enlaza Casa del Lago por ser también una vivienda unifamiliar ligada al paisaje.',
      'ok',
      [
        {
          body: `Hola, Marta:\n\nHe visto en vuestra web la Casa del Acantilado y me ha hecho pensar en cuánto depende una casa así de cómo se cuenta su relación con el paisaje.\n\nSomos Estudio Render, un estudio de visualización arquitectónica. Todos nos formamos como arquitectos y hacemos imágenes de exteriores e interiores, también para concursos.\n\nEste proyecto es el más cercano a lo vuestro:\n\n${HOUSE.url}\n\n¿Trabajáis con visualizadores externos o lo resolvéis dentro del estudio?\n\nUn saludo,`,
          project: HOUSE,
        },
        {
          body: `Hola, Marta:\n\nTe enseño otro trabajo, esta vez de interior: la reforma de un piso antiguo con ladrillo visto y vigas de madera.\n\n${LOFT.url}\n\nSi me dices quién lleva este tema en el estudio, le escribo directamente.\n\nUn saludo,`,
          project: LOFT,
        },
        { body: 'Hola, Marta:\n\nEste es mi último correo, no quiero ocupar más tu bandeja. Si en algún momento necesitáis imágenes de un proyecto, será un placer hablar.\n\nUn saludo,' },
      ],
    ),
    sequence(
      2,
      { id: 2, name: 'Atelier Exemple', website: 'https://atelier-exemple.fr', city: 'Paris', country: 'FR' },
      { email: 'contact@atelier-exemple.fr', name: null, role: null },
      'fr',
      'Perspectives 3D pour vos projets',
      'Se apoya en su torre de madera; enlaza Casa Patio por la presencia de la madera y la luz natural.',
      'review',
      [
        {
          body: `Bonjour,\n\nEn parcourant votre site, je me suis arrêté sur votre tour en bois. Rendre la présence du bois à cette échelle est une belle question d'image.\n\nNous sommes un studio de visualisation architecturale. Nous réalisons des perspectives d'extérieur et d'intérieur.\n\n${CH.url}\n\nFaites-vous parfois appel à des perspectivistes extérieurs ?\n\nBien cordialement,`,
          translation: `Buenos días:\n\nRecorriendo su web me detuve en su torre de madera. Transmitir la presencia de la madera a esa escala es una bonita cuestión de imagen.\n\nSomos un estudio de visualización arquitectónica. Hacemos imágenes de exterior y de interior.\n\n${CH.url}\n\n¿Recurren a veces a visualizadores externos?\n\nUn cordial saludo,`,
          project: CH,
          findings: [{ step: 1, level: 'warning', source: 'review', message: 'El saludo no nombra a nadie porque el correo va a un buzón general.' }],
        },
        {
          body: `Bonjour,\n\nJe me permets de revenir vers vous avec un autre aspect de notre travail, en extérieur cette fois.\n\n${HOUSE.url}\n\nBien cordialement,`,
          translation: `Buenos días:\n\nMe permito volver a escribirles con otra faceta de nuestro trabajo, esta vez en exterior.\n\n${HOUSE.url}\n\nUn cordial saludo,`,
          project: HOUSE,
          findings: [{ step: 2, level: 'error', source: 'review', message: 'Ejemplo de aviso grave: el seguimiento afirma algo que la ficha del estudio no respalda.', quote: 'un autre aspect de notre travail' }],
        },
        {
          body: 'Bonjour,\n\nCe sera mon dernier message. Si un jour vous avez besoin d\'images pour un projet ou un concours, je serai ravi d\'en parler.\n\nBien cordialement,',
          translation: 'Buenos días:\n\nEste será mi último mensaje. Si algún día necesitan imágenes para un proyecto o un concurso, estaré encantado de hablarlo.\n\nUn cordial saludo,',
        },
      ],
    ),
  ];
}

/** A third example: the first email has gone out and the follow-ups are approved, waiting for their day. */
function inProgress() {
  const example = sequence(
    3,
    { id: 4, name: 'Studio Esempio', website: 'https://studioesempio.it', city: 'Milano', country: 'IT' },
    { email: 'davide@studioesempio.it', name: 'Davide Rossi', role: 'Socio' },
    'it',
    'Visualizzazioni per i vostri progetti',
    'Se apoya en un proyecto residencial de su web.',
    'ok',
    [
      {
        body: `Buongiorno Davide,\n\nho visto sul vostro sito il progetto residenziale a Milano.\n\n${LOFT.url}\n\nVi capita di affidare le visualizzazioni a studi esterni?\n\nUn cordiale saluto,`,
        translation: 'Buenos días, Davide:\n\nHe visto en vuestra web el proyecto residencial de Milán.\n\n¿Soléis encargar las visualizaciones a estudios externos?\n\nUn cordial saludo,',
        project: LOFT,
      },
      {
        body: `Buongiorno Davide,\n\nriprendo il messaggio per aggiungere un lavoro diverso.\n\n${HOUSE.url}\n\nUn cordiale saluto,`,
        translation: 'Buenos días, Davide:\n\nRetomo el mensaje para añadir un trabajo distinto.\n\nUn cordial saludo,',
        project: HOUSE,
      },
      {
        body: 'Buongiorno Davide,\n\nquesta è la mia ultima mail. Se in futuro vi servissero immagini, sarò felice di sentirvi.\n\nUn cordiale saluto,',
        translation: 'Buenos días, Davide:\n\nEste es mi último correo. Si en el futuro necesitáis imágenes, estaré encantado de saber de vosotros.\n\nUn cordial saludo,',
      },
    ],
  );
  const day = 24 * 3_600_000;
  example.status = 'active';
  example.sent = 1;
  example.pending = false;
  example.nextSendAt = new Date(Date.now() + 2 * day).toISOString();
  example.messages[0].status = 'sent';
  example.messages[0].sentAt = new Date(Date.now() - day).toISOString();
  example.messages[1].status = 'approved';
  example.messages[2].status = 'approved';
  return example;
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

export function demoApi() {
  let sequences = [...sampleSequences(), inProgress()];
  const studios = [
    { studio_id: 1, name: 'Estudio Ejemplo Arquitectura', website: 'https://estudioejemplo.es', country: 'ES', city: 'Sevilla', research_status: 'done', sequence_status: 'queued', emails_sent: 0, sent_to: 'marta@estudioejemplo.es', contact_name: 'Marta Ruiz' },
    { studio_id: 2, name: 'Atelier Exemple', website: 'https://atelier-exemple.fr', country: 'FR', city: 'Paris', research_status: 'done', sequence_status: 'queued', emails_sent: 0, sent_to: 'contact@atelier-exemple.fr', contact_name: null },
    { studio_id: 3, name: null, website: 'https://studio-esempio.it', country: null, city: null, research_status: 'pending', sequence_status: null, emails_sent: null, sent_to: null, contact_name: null },
  ];
  const find = (enrollmentId) => sequences.find((s) => s.enrollmentId === enrollmentId);
  const message = (id) => sequences.flatMap((s) => s.messages).find((m) => m.id === id);
  const refresh = (s) => { s.pending = s.messages.some((m) => m.status === 'pending_approval'); };

  return {
    demo: true,
    async currentUser() { return 'demo@ejemplo.es'; },
    async signIn() {},
    async signOut() {},
    async hasAccess() { return true; },
    async listSequences() { await wait(); return structuredClone(sequences); },
    async saveEmail(messageId, body) { message(messageId).body = body; },
    async saveSubject(enrollmentId, subject) { find(enrollmentId).subject = subject; },
    async approve(messageIds) {
      for (const id of messageIds) message(id).status = 'approved';
      sequences.forEach(refresh);
    },
    async unapprove(messageId) {
      message(messageId).status = 'pending_approval';
      sequences.forEach(refresh);
    },
    async requestNewVersion(enrollmentId) { sequences = sequences.filter((s) => s.enrollmentId !== enrollmentId); },
    async markReplied(enrollmentId) { sequences = sequences.filter((s) => s.enrollmentId !== enrollmentId); },
    async discard(enrollmentId) { sequences = sequences.filter((s) => s.enrollmentId !== enrollmentId); },
    async listStudios() { await wait(); return structuredClone(studios); },
    async addStudios(websites) {
      const added = [];
      const skipped = [];
      for (const website of websites) {
        const domain = domainOf(website);
        if (!domain.includes('.')) continue;
        if (studios.some((s) => domainOf(s.website) === domain)) { skipped.push(domain); continue; }
        studios.unshift({ studio_id: studios.length + 1, name: null, website: `https://${domain}`, country: null, city: null, research_status: 'pending', sequence_status: null, emails_sent: null, sent_to: null, contact_name: null });
        added.push(domain);
      }
      return { added, skipped };
    },
  };
}
