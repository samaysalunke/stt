import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, BASE } from './helpers.mjs';

const SLUG = 'qa-trip-default-roundtrip';
const QUESTION = 'QA trip default round-trip question?';

async function postForm(path, values, cookie) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.append(key, value);
  return fetch(`${BASE}${path}`, { method: 'POST', body: form, headers: { cookie }, redirect: 'manual' });
}

test('global FAQ default flag round-trips while /faq visibility stays unchanged', async () => {
  const { cookie } = await adminLogin();
  try {
    let res = await postForm('/api/admin/faqs/create', {
      slug: SLUG,
      question: QUESTION,
      answer: 'Visible globally and initially defaulted on trips.',
      category: 'QA',
      order: '999',
      defaultOnTripPages: 'on',
    }, cookie);
    assert.ok(res.status >= 300 && res.status < 400);

    let html = await (await fetch(`${BASE}/admin/faqs/${SLUG}/`, { headers: { cookie } })).text();
    assert.match(html, /name="defaultOnTripPages"[^>]*checked/);
    assert.match(await (await fetch(`${BASE}/faq/`)).text(), new RegExp(QUESTION.replace('?', '\\?')));

    res = await postForm('/api/admin/faqs/update', {
      slug: SLUG,
      question: QUESTION,
      answer: 'Still visible globally but no longer a trip default.',
      category: 'QA',
      order: '999',
    }, cookie);
    assert.ok(res.status >= 300 && res.status < 400);

    html = await (await fetch(`${BASE}/admin/faqs/${SLUG}/`, { headers: { cookie } })).text();
    assert.doesNotMatch(html, /name="defaultOnTripPages"[^>]*checked/);
    assert.match(await (await fetch(`${BASE}/faq/`)).text(), new RegExp(QUESTION.replace('?', '\\?')));
  } finally {
    await postForm('/api/admin/faqs/delete', { slug: SLUG }, cookie);
  }
});
