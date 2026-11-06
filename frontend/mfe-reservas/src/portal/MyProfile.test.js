import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../auth';
import MyProfile from './MyProfile.vue';

// Token real en su forma: solo se decodifica su contenido
const b64 = (value) => btoa(JSON.stringify(value)).replace(/=/g, '');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'x', salon_id: 'cli-1', name: 'Ana', realm_access: { roles: ['CLIENT'] } })}.f`;

let requests;
const CLIENT = {
  id: 'cli-1', fullName: 'Ana', email: 'ana@example.com', phone: '700', loyaltyPoints: 150, whatsappOptIn: false,
  styleProfile: { gender: 'FEMALE', ageRange: '30_44', preferredLength: null, maintenance: null, vibe: null },
};

describe('Mi perfil', () => {
  beforeEach(() => {
    requests = [];
    setPlatform({ getToken: async () => TOKEN, onSessionLost: vi.fn(), offline: null, params: {} });
    vi.stubGlobal('fetch', vi.fn(async (_, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const data = body.query.includes('getLoyaltyHistory') ? { getLoyaltyHistory: [] } : { getMyProfile: CLIENT };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }));
  });

  async function montar() {
    const wrapper = mount(MyProfile);
    await flushPromises();
    await flushPromises();
    return wrapper;
  }

  it('muestra los datos reales y lo que respondió el cliente', async () => {
    const wrapper = await montar();
    expect(wrapper.get('#profile-name').text()).toBe('Ana');
    expect(wrapper.get('#profile-points').text()).toBe('150');
    expect(wrapper.get('#style-gender').element.value).toBe('FEMALE');
    expect(wrapper.get('#style-ageRange').element.value).toBe('30_44');
  });

  it('al guardar no envía como respuesta lo que quedó sin responder', async () => {
    const wrapper = await montar();
    await wrapper.get('#style-maintenance').setValue('LOW');
    await wrapper.get('#style-gender').setValue('');
    await wrapper.get('#style-save').element.form.dispatchEvent(new Event('submit'));
    await flushPromises();
    const guardado = requests.find((request) => request.query.includes('updateMyStyleProfile'));
    expect(guardado.variables.input).toEqual({ ageRange: '30_44', maintenance: 'LOW' });
  });

  it('el WhatsApp empieza sin autorizar y se autoriza a petición del cliente', async () => {
    const wrapper = await montar();
    const casilla = wrapper.get('#profile-whatsapp');
    expect(casilla.element.checked).toBe(false);
    await casilla.setValue(true);
    await flushPromises();
    const cambio = requests.find((request) => request.query.includes('setMyWhatsappOptIn'));
    expect(cambio.variables.enabled).toBe(true);
  });

  it('sin teléfono no se puede autorizar el WhatsApp', async () => {
    const wrapper = await montar();
    await wrapper.get('#profile-phone').setValue('');
    expect(wrapper.get('#profile-whatsapp').element.disabled).toBe(true);
  });
});
