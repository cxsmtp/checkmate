import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration, parseGithubUrl } from '../src/validation.js';

const valid = {
  name: 'Ada Lovelace', email: 'ada@example.com', company: 'Acme',
  technicalName: 'Grace Hopper', technicalEmail: 'grace@example.com',
  contacts: [{ name: 'Ops One', email: 'one@example.com' }, { name: 'Ops Two', email: 'two@example.com' }],
  githubUrl: 'https://github.com/acme/shop.git', branch: 'main', consent: true,
};

test('accepts a complete registration', () => {
  const { value, errors } = validateRegistration(valid);
  assert.equal(errors, undefined);
  assert.equal(value.repo.url, 'https://github.com/acme/shop');
  assert.equal(value.pocs.length, 2);
});

test('requires two operations contacts, consent and a GitHub URL', () => {
  const { errors } = validateRegistration({ ...valid, contacts: [valid.contacts[0]], consent: false, githubUrl: 'https://gitlab.com/a/b' });
  assert.ok(errors.contacts);
  assert.ok(errors.consent);
  assert.ok(errors.githubUrl);
});

test('rejects bad emails', () => {
  const { errors } = validateRegistration({ ...valid, technicalEmail: 'nope', contacts: [valid.contacts[0], { name: 'X', email: 'bad@' }] });
  assert.ok(errors.technicalEmail);
  assert.ok(errors['contacts.1.email']);
});

test('parses GitHub URLs strictly', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/org/repo/'), { owner: 'org', repo: 'repo', url: 'https://github.com/org/repo' });
  assert.equal(parseGithubUrl('http://github.com/org/repo'), null);
  assert.equal(parseGithubUrl('https://github.com/org/repo/tree/main'), null);
  assert.equal(parseGithubUrl('https://github.com.evil.com/org/repo'), null);
});

test('only a known city name is kept with a registration, never anything else', () => {
  assert.equal(validateRegistration({ ...valid, theme: 'dubai' }).value.theme, 'dubai');
  assert.equal(validateRegistration({ ...valid, theme: '25.2,55.27' }).value.theme, null);
  assert.equal(validateRegistration({ ...valid, theme: { lat: 1 } }).value.theme, null);
  assert.equal(validateRegistration(valid).value.theme, null);
});

test('places: keys for any city, and only the city is kept with a registration', async () => {
  const { placeKey, featuredKey, isPlaceKey } = await import('../src/places.js');
  assert.equal(placeKey('Kuala Lumpur', 'MY'), 'kuala-lumpur-my');
  assert.equal(placeKey('São Paulo', 'br'), 'sao-paulo-br');
  assert.equal(featuredKey('Dubai', 'AE'), 'dubai');
  assert.equal(featuredKey('Dubai', 'US'), null);
  assert.ok(isPlaceKey('kuala-lumpur-my'));
  assert.ok(!isPlaceKey('../etc'));
});
