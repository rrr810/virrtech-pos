// VirrTech Duka POS — demo seed data (pure logic).
//
// A realistic small-shop basket for a Kenyan duka, with GS1 629 (Kenya)
// EAN-13 barcodes that carry valid check digits, so scanning a printed
// demo label behaves exactly like a real product.

import { ean13WithCheck } from './barcodes.js';

export function defaultShop() {
  return {
    name: 'VirrTech Duka',
    location: 'Eldoret, Kenya',
    phone: '0700 000 000',
  };
}

let n = 0;
function P(sku, name, category, priceKES, stock) {
  n += 1;
  // 629 104 150 0X X — Kenyan GS1 prefix + deterministic item reference.
  const base = '6291041500' + String(n).padStart(2, '0');
  return { id: `demo-p${String(n).padStart(2, '0')}`, sku, name, category, priceKES, stock, barcode: ean13WithCheck(base) };
}

export function demoProducts() {
  n = 0;
  return [
    // Staples
    P('STP-001', 'Super Grain Flour (2kg)', 'Staples', 295, 40),
    P('STP-002', 'Maize Flour (2kg)', 'Staples', 185, 35),
    P('STP-003', 'Mandi Rice (1kg)', 'Staples', 165, 50),
    P('STP-004', 'Basmati Rice (1kg)', 'Staples', 215, 30),
    P('STP-005', 'Semolina (1kg)', 'Staples', 95, 25),
    P('STP-006', 'Fine Salt (500g)', 'Staples', 35, 40),
    P('STP-007', 'Sugar (1kg)', 'Staples', 140, 45),
    P('STP-008', 'Cooking Oil (1L)', 'Staples', 245, 24),
    // Drinks
    P('DRK-001', 'Aqua Water (50cl)', 'Drinks', 40, 96),
    P('DRK-002', 'Coca-Cola (50cl)', 'Drinks', 55, 48),
    P('DRK-003', 'Kola (500ml)', 'Drinks', 50, 36),
    P('DRK-004', 'Sip (330ml)', 'Drinks', 45, 30),
    P('DRK-005', 'Milo (400g)', 'Drinks', 465, 12),
    // Snacks
    P('SNK-001', 'Indomie Chicken (1 pc)', 'Snacks', 20, 120),
    P('SNK-002', 'Milkmaid Noodles (1 pc)', 'Snacks', 25, 100),
    P('SNK-003', 'Cream Biscuits (150g)', 'Snacks', 45, 40),
    // Dairy
    P('DRY-001', 'Fresh Milk (1L)', 'Dairy', 135, 20),
    P('DRY-002', 'Yogurt (200ml)', 'Dairy', 60, 24),
    P('DRY-003', 'Margarine (200g)', 'Dairy', 95, 18),
    P('DRY-004', 'Farm Eggs (1 tray)', 'Dairy', 170, 15),
    // Fresh produce
    P('FRH-001', 'White Bread (Loaf)', 'Fresh Produce', 55, 14),
    P('FRH-002', 'Potatoes (1kg)', 'Fresh Produce', 80, 25),
    P('FRH-003', 'Onions (1kg)', 'Fresh Produce', 95, 22),
    P('FRH-004', 'Tomatoes (1kg)', 'Fresh Produce', 70, 20),
    // Household
    P('HHD-001', 'Dish Soap (250ml)', 'Household', 90, 16),
    P('HHD-002', 'Laundry Soap (500g)', 'Household', 135, 20),
    P('HHD-003', 'Bleach (500ml)', 'Household', 110, 18),
    // Personal care
    P('PCL-001', 'Bath Soap (100g)', 'Personal Care', 35, 30),
    P('PCL-002', 'Toothpaste (100ml)', 'Personal Care', 150, 14),
  ];
}
