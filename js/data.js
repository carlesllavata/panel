// Everything the panel reads from or writes to Supabase. The same functions run in the browser and,
// for testing, in Node. What they are allowed to do is decided by the database, not here.

const OPEN = ['pending_approval', 'approved'];
/** What the panel shows of a sequence: what is still to go out, and what already went. */
const SHOWN = [...OPEN, 'sent'];

/** "https://www.Estudio.es/contacto" -> "estudio.es", the way the database derives a studio's domain. */
export function domainOf(website) {
  return website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/^www\./, '')
    .replace(/[/:?#].*$/, '');
}

function fail(step, error) {
  if (error) throw new Error(`${step}: ${error.message}`);
}

/** Groups message rows into one entry per studio, first email first. */
export function groupSequences(rows) {
  const byEnrollment = new Map();
  for (const row of rows) {
    const enrollment = row.enrollments;
    let sequence = byEnrollment.get(row.enrollment_id);
    if (!sequence) {
      const contact = enrollment.contacts;
      const isPerson = Boolean(contact && contact.role_category !== 'generic');
      const report = row.qa_report ?? {};
      sequence = {
        enrollmentId: row.enrollment_id,
        studio: enrollment.studios ?? {},
        recipient: { email: enrollment.email, name: isPerson ? contact.full_name : null, role: isPerson ? contact.role : null },
        language: row.language,
        subject: row.subject ?? '',
        verdict: report.verdict ?? 'ok',
        studioFact: report.studio_fact ?? '',
        rewrittenBecause: report.rewritten_because ?? [],
        /** "queued" until the first email goes out, "active" after that. */
        status: enrollment.status,
        nextSendAt: enrollment.next_send_at ?? null,
        messages: [],
      };
      byEnrollment.set(row.enrollment_id, sequence);
    }
    const findings = row.qa_report?.findings ?? [];
    if (row.qa_report?.verdict === 'review') sequence.verdict = 'review';
    sequence.messages.push({
      id: row.id,
      step: row.step,
      status: row.status,
      sentAt: row.sent_at ?? null,
      body: row.body,
      translation: row.review_translation ?? '',
      project: row.portfolio_items ?? null,
      findings,
    });
  }
  const sequences = [...byEnrollment.values()];
  for (const sequence of sequences) {
    sequence.messages.sort((a, b) => a.step - b.step);
    sequence.pending = sequence.messages.some((message) => message.status === 'pending_approval');
    sequence.sent = sequence.messages.filter((message) => message.status === 'sent').length;
  }
  // A sequence with nothing left to approve or send is finished and is not shown.
  return sequences.filter((sequence) => sequence.messages.some((message) => OPEN.includes(message.status)));
}

export function supabaseApi(client) {
  return {
    demo: false,

    async currentUser() {
      const { data } = await client.auth.getSession();
      return data.session?.user?.email ?? null;
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message);
    },

    async signOut() {
      await client.auth.signOut();
    },

    /** The portfolio is never empty, so seeing none of it means this user is not on the panel's list. */
    async hasAccess() {
      const { data, error } = await client.from('portfolio_items').select('id').limit(1);
      return !error && data.length > 0;
    },

    /** Every studio whose emails are written and not yet sent, with what the reviewer said about them. */
    async listSequences() {
      const { data, error } = await client
        .from('messages')
        .select(
          'id, enrollment_id, step, status, sent_at, subject, body, review_translation, language, qa_report, ' +
            'portfolio_items(title, url), ' +
            'enrollments!inner(email, status, next_send_at, studios(id, name, website, city, country), contacts(full_name, role, role_category))',
        )
        .in('status', SHOWN)
        .in('enrollments.status', ['queued', 'active'])
        .order('enrollment_id')
        .order('step');
      fail('No se pudieron leer los correos', error);
      return groupSequences(data);
    },

    async saveEmail(messageId, body) {
      const { error } = await client.from('messages').update({ body }).eq('id', messageId).in('status', OPEN);
      fail('No se pudo guardar el correo', error);
    },

    async saveSubject(enrollmentId, subject) {
      const { error } = await client.from('messages').update({ subject }).eq('enrollment_id', enrollmentId).in('status', OPEN);
      fail('No se pudo guardar el asunto', error);
      const { error: threadError } = await client
        .from('enrollments')
        .update({ thread_subject: subject, updated_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      fail('No se pudo guardar el asunto', threadError);
    },

    async approve(messageIds, approvedBy) {
      const { error } = await client
        .from('messages')
        .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: approvedBy })
        .in('id', messageIds)
        .eq('status', 'pending_approval');
      fail('No se pudo aprobar', error);
    },

    async unapprove(messageId) {
      const { error } = await client
        .from('messages')
        .update({ status: 'pending_approval', approved_at: null, approved_by: null })
        .eq('id', messageId)
        .eq('status', 'approved');
      fail('No se pudo retirar la aprobación', error);
    },

    /** Sends the three emails back; the next writing run produces a new version following the request. */
    async requestNewVersion(enrollmentId, instructions) {
      const { error } = await client
        .from('messages')
        .update({ status: 'superseded', instructions })
        .eq('enrollment_id', enrollmentId)
        .in('status', OPEN);
      fail('No se pudo pedir otra versión', error);
    },

    /** The studio answered: whatever was still to go out is withdrawn and the sequence ends. */
    async markReplied(enrollmentId) {
      const { error } = await client.from('messages').update({ status: 'superseded' }).eq('enrollment_id', enrollmentId).in('status', OPEN);
      fail('No se pudo marcar la respuesta', error);
      const { error: enrollmentError } = await client
        .from('enrollments')
        .update({ status: 'replied', status_detail: 'marcado en el panel', updated_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      fail('No se pudo marcar la respuesta', enrollmentError);
    },

    /** Drops the studio: its emails are rejected and nothing will be sent to it. */
    async discard(enrollmentId) {
      const { error } = await client.from('messages').update({ status: 'rejected' }).eq('enrollment_id', enrollmentId).in('status', OPEN);
      fail('No se pudo descartar', error);
      const { error: enrollmentError } = await client
        .from('enrollments')
        .update({ status: 'skipped', status_detail: 'descartado en el panel', updated_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      fail('No se pudo descartar', enrollmentError);
    },

    async listStudios() {
      const { data, error } = await client
        .from('v_pipeline')
        .select('studio_id, name, website, country, city, research_status, sequence_status, emails_sent, sent_to, contact_name, updated_at')
        .order('updated_at', { ascending: false })
        .limit(300);
      fail('No se pudieron leer los estudios', error);
      return data;
    },

    /** Adds studios by website, skipping the ones already there. Returns what was added and what was skipped. */
    async addStudios(websites) {
      const wanted = new Map();
      for (const website of websites) {
        const domain = domainOf(website);
        if (domain.includes('.') && !wanted.has(domain)) wanted.set(domain, website.trim());
      }
      if (wanted.size === 0) return { added: [], skipped: [] };

      const { data: existing, error } = await client.from('studios').select('domain').in('domain', [...wanted.keys()]);
      fail('No se pudo comprobar si ya estaban', error);
      const known = new Set(existing.map((row) => row.domain));
      const fresh = [...wanted].filter(([domain]) => !known.has(domain));

      if (fresh.length > 0) {
        const { error: insertError } = await client.from('studios').insert(fresh.map(([, website]) => ({ website, source: 'panel' })));
        fail('No se pudieron añadir', insertError);
      }
      return { added: fresh.map(([domain]) => domain), skipped: [...known] };
    },
  };
}
