import { freshToken } from './auth';

const CRM_URL = import.meta.env.VITE_CRM_URL || 'http://localhost:8083/graphql';

async function crm(query, variables = {}) {
  const response = await fetch(CRM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await freshToken()}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

/** Indica si el cliente todavía no respondió ni omitió el cuestionario inicial. */
export async function needsOnboarding() {
  const { getMyProfile } = await crm('{ getMyProfile { styleProfile { onboardedAt } } }');
  return !getMyProfile?.styleProfile?.onboardedAt;
}

export function saveStyleProfile(input) {
  return crm('mutation ($input: StyleProfileInput!) { updateMyStyleProfile(input: $input) { id } }', { input });
}
