// VirrTech Duka POS — Settings: shop details, theme, demo data, about.

import { toast } from './toast.js';
import { confirmDialog } from './modal.js';

export function mountSettings(root, { store, onInstall }) {
  const shopForm = root.querySelector('#shop-form');
  const themeRadios = root.querySelectorAll('[data-theme-radio]');
  const shopError = root.querySelector('#shop-error');
  const demoStatus = root.querySelector('#demo-status');

  function fillShop() {
    const s = store.state.shop;
    root.querySelector('#shop-name').value = s.name;
    root.querySelector('#shop-location').value = s.location;
    root.querySelector('#shop-phone').value = s.phone;
    for (const r of themeRadios) r.checked = r.dataset.themeRadio === store.state.theme;
    demoStatus.textContent = store.state.demoSeeded
      ? `${store.state.products.length} demo products · ${store.state.sales.length} sales recorded`
      : 'No data loaded';
  }

  shopForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    shopError.hidden = true;
    const res = await store.setShop({
      name: root.querySelector('#shop-name').value,
      location: root.querySelector('#shop-location').value,
      phone: root.querySelector('#shop-phone').value,
    });
    if (!res.ok) {
      shopError.textContent = res.error;
      shopError.hidden = false;
      return;
    }
    toast('Shop details saved', { type: 'success' });
    fillShop();
  });

  root.addEventListener('change', (e) => {
    const radio = e.target.closest('[data-theme-radio]');
    if (radio) {
      store.setTheme(radio.dataset.themeRadio);
    }
  });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('#load-demo')) {
      const ok = await confirmDialog({
        title: 'Load demo data',
        message: 'This resets ALL current data and replaces it with a fresh demo catalogue, movements and an empty day of sales. Continue?',
        confirmLabel: 'Reset & load demo',
        danger: true,
      });
      if (!ok) return;
      await store.resetDemo();
      toast('Demo data loaded', { type: 'success' });
      fillShop();
      return;
    }
    if (e.target.closest('#install-app')) {
      onInstall();
    }
  });

  const unsubscribe = store.subscribe(fillShop);
  fillShop();
  return { render: fillShop, destroy: unsubscribe };
}
